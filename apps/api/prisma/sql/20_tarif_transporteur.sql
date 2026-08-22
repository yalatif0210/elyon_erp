-- ===========================================================================
--  LE COÛT DU TRANSPORT EST ADMINISTRABLE ET RATTACHÉ À UN TRANSPORTEUR
--  Réf. SPECIFICATIONS.md § 5.4, § 6.4
--
--  Décision de la direction, 7 août 2026 :
--
--    « Assure-toi que le coût du transport est administrable et lié à un
--      transporteur enregistré. »
--
--  ⚠️ CE QUI EXISTAIT : UN NOMBRE LIBRE, SANS CONTREPARTIE.
--
--     `freight_cost` se saisissait sans tarif de référence, et `carrier_id`
--     était FACULTATIF. On engageait donc un coût de transport sans pouvoir
--     dire, à la lecture, avec qui il avait été négocié ni s'il correspondait
--     à ce qui avait été convenu.
--
--     C'est le poste de charge le plus lourd d'une opération de distribution.
--     Un franc d'écart porté sur dix millions de litres crée un préjudice —
--     c'est la règle que la direction a posée pour le barème de coûts, et elle
--     vaut ici pour la même raison.
--
--  ⚠️ REVU LE 22/08/2026 — LE FRET SE FIXE DÉSORMAIS AU CHIFFRAGE, PAS À
--     L'AFFECTATION DES MOYENS.
--
--     Le fret vivait sur `operation_assignments`, comparé au tarif du
--     transporteur choisi à ce moment-là — alors que `deal_cost_lines`
--     portait déjà, séparément, un chiffrage du même poste comparé au
--     BARÈME interne (une valeur générique, pas liée à un transporteur).
--     Deux montants pour un seul coût, dont un seul comptait réellement dans
--     la marge (l'affectation, matérialisée en `OperationCostLine` système) :
--     la marge ESTIMÉE au chiffrage ignorait donc le fret réel jusqu'à ce
--     qu'une opération existe.
--
--     Décision de la direction : le transporteur se choisit au chiffrage,
--     avec son coût. La comparaison au tarif négocié s'y fait aussi,
--     BLOQUANTE — même règle que le barème juste à côté, jamais un écart
--     silencieux. Le verrou et ses trois contrôles (transporteur exigé, tarif
--     comparé, tiers de type transporteur) migrent donc de
--     `operation_assignments` vers `deal_cost_lines`, sur le SEUL poste dont
--     le code est TRANSPORT — les autres postes directs (manutention,
--     inspection...) gardent leur fournisseur facultatif et leur seule
--     comparaison au barème.
--
--     Conséquence assumée : `resolve_carrier_tariff` compare un tarif sur un
--     trajet à DEUX bouts. Le chiffrage ne connaît que la destination
--     (`deals.site_id`) — l'origine (quel dépôt charge) est une décision de
--     sourcing qui n'existe qu'à l'opération. La résolution se fait donc ici
--     avec une origine NULLE : elle retient un tarif général du transporteur
--     ou un tarif ne nommant que la destination, jamais un tarif à trajet
--     complet. Léger recul de précision, accepté comme contrepartie du choix
--     de tout regrouper au chiffrage.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Résolution du tarif : DU PLUS SPÉCIFIQUE AU PLUS GÉNÉRAL.
--
--  Même pondération que `resolve_cost_standard`, et pour la même raison : un
--  tarif négocié pour un site précis doit l'emporter sur le tarif général du
--  transporteur, sinon le paramétrage fin ne sert à rien.
--
--    destination        8
--    origine            4
--    mode de transport  2
--    produit            1
--
--  À spécificité égale, le plus RÉCEMMENT entré en vigueur l'emporte.
-- ---------------------------------------------------------------------------
-- ⚠️ La signature a CHANGÉ (le trajet a deux bouts). `CREATE OR REPLACE` ne
--    remplace pas une fonction dont les paramètres diffèrent : il en crée une
--    SECONDE, et l'appelant tombe sur l'une ou l'autre selon les types. On
--    dépose donc l'ancienne explicitement.
DROP FUNCTION IF EXISTS resolve_carrier_tariff(uuid, text, uuid, uuid, date);

CREATE OR REPLACE FUNCTION resolve_carrier_tariff(
  p_carrier_id       uuid,
  p_transport_mode   text,
  p_product_id       uuid,
  p_origin_site_id      uuid,
  p_destination_site_id uuid,
  p_on               date
)
RETURNS TABLE (
  tariff_id     uuid,
  basis         text,
  amount        numeric,
  currency_code char(3),
  uom           text,
  tolerance_pct numeric
) AS $$
  SELECT t.id, t.basis::text, t.amount, t.currency_code, t.uom::text, t.tolerance_pct
    FROM carrier_tariffs t
   WHERE t.carrier_id = p_carrier_id
     AND t.is_active
     AND t.effective_from <= p_on
     AND (t.effective_to IS NULL OR t.effective_to >= p_on)
     AND (t.transport_mode IS NULL OR t.transport_mode::text = p_transport_mode)
     AND (t.product_id IS NULL OR t.product_id = p_product_id)
     AND (t.origin_site_id IS NULL OR t.origin_site_id = p_origin_site_id)
     AND (t.destination_site_id IS NULL OR t.destination_site_id = p_destination_site_id)
   -- Un tarif qui nomme les DEUX bouts du trajet l'emporte sur celui qui n'en
   -- nomme qu'un : « Abidjan → Man » est plus précis que « vers Man ».
   ORDER BY (CASE WHEN t.destination_site_id IS NOT NULL THEN 8 ELSE 0 END
           + CASE WHEN t.origin_site_id      IS NOT NULL THEN 4 ELSE 0 END
           + CASE WHEN t.transport_mode      IS NOT NULL THEN 2 ELSE 0 END
           + CASE WHEN t.product_id          IS NOT NULL THEN 1 ELSE 0 END) DESC,
            t.effective_from DESC
   LIMIT 1;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION resolve_carrier_tariff IS
  'Tarif applicable à un transporteur pour un trajet donné (§ 5.4). Du plus spécifique au plus général ; à égalité, le plus récent.';


-- ---------------------------------------------------------------------------
--  VERROUS 1 À 3 — le poste TRANSPORT d'une affaire suppose un transporteur
--  enregistré, comparé à son tarif négocié, l'écart motivé au-delà de la
--  tolérance. Un seul déclencheur porte les trois : ils partagent le même
--  chemin de lecture (poste, tiers, tarif) et la même ligne à corriger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_deal_transport_tariff()
RETURNS TRIGGER AS $$
DECLARE
  poste_code text;
  aff        record;
  transporteur_type text;
  transporteur_nom  text;
  t          record;
  attendu    numeric;
  ecart_pct  numeric;
  tolerance  numeric;
BEGIN
  SELECT code INTO poste_code FROM cost_posts WHERE id = NEW.cost_post_id;

  -- Cette règle ne porte que sur le poste TRANSPORT. Les autres postes
  -- directs (manutention, inspection...) gardent un fournisseur facultatif,
  -- sans comparaison à un tarif de transporteur.
  IF poste_code IS DISTINCT FROM 'TRANSPORT' THEN
    RETURN NEW;
  END IF;

  -- VERROU 1 — un fret engagé suppose un TRANSPORTEUR ENREGISTRÉ.
  --
  -- Un coût sans contrepartie identifiée ne se rapproche d'aucune facture, ne
  -- s'impute à aucun contrat, et ne se conteste devant personne. Le fret NUL
  -- reste admis sans transporteur : un enlèvement par le client n'engage
  -- aucun coût externe.
  IF NEW.estimated_amount > 0 AND NEW.supplier_id IS NULL THEN
    RAISE EXCEPTION
      'TRANSPORT : un coût de transport engagé exige un transporteur enregistré comme fournisseur de la ligne.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.supplier_id IS NULL THEN
    NEW.carrier_tariff_id := NULL;
    NEW.tariff_amount := NULL;
    NEW.tariff_tolerance_pct := NULL;
    RETURN NEW;
  END IF;

  -- VERROU 3 — le transporteur doit être un TIERS DE TYPE TRANSPORTEUR.
  --
  -- Rien n'empêche de désigner un client comme fournisseur d'une ligne de
  -- coût : la clé pointe sur `partners`, qui porte aussi bien les clients
  -- que les fournisseurs. Sans ce contrôle, une erreur de sélection passait,
  -- et le rapprochement des coûts la découvrait des mois plus tard.
  SELECT type::text, legal_name INTO transporteur_type, transporteur_nom
    FROM partners WHERE id = NEW.supplier_id;
  IF transporteur_type IS DISTINCT FROM 'CARRIER' THEN
    RAISE EXCEPTION
      'TRANSPORTEUR : « % » est enregistré comme %, pas comme transporteur. Le poste TRANSPORT doit être rattaché à un transporteur du référentiel : sans contrepartie identifiée, le coût ne se rapproche d''aucune facture.',
      COALESCE(transporteur_nom, 'ce tiers'), COALESCE(transporteur_type, 'tiers inconnu')
      USING ERRCODE = 'check_violation';
  END IF;

  -- VERROU 2 — l'écart au tarif négocié doit être MOTIVÉ.
  --
  -- Le montant reste saisissable : une négociation ponctuelle existe. Ce qui
  -- ne doit pas exister, c'est un écart SILENCIEUX — celui que personne ne
  -- voit passer et que personne ne saura expliquer six mois plus tard.
  --
  -- ⚠️ ORIGINE NULLE, VOIR L'EN-TÊTE DU FICHIER : le chiffrage ne connaît que
  --    la destination de l'affaire, jamais le dépôt d'origine (décidé au
  --    sourcing, à l'opération). Un tarif nommant une origine précise ne
  --    peut donc jamais s'appliquer ici — c'est le recul de précision assumé.
  SELECT d.site_id, d.transport_mode::text AS mode, d.product_id, d.contracted_volume
    INTO aff
    FROM deals d WHERE d.id = NEW.deal_id;

  SELECT * INTO t FROM resolve_carrier_tariff(
    NEW.supplier_id, aff.mode, aff.product_id, NULL::uuid, aff.site_id, CURRENT_DATE);

  -- Aucun tarif négocié pour ce transporteur : on ne bloque pas. Exiger un
  -- tarif avant tout chiffrage empêcherait de travailler avec un
  -- transporteur d'appoint — et c'est précisément ce jour-là qu'il faut
  -- pouvoir chiffrer.
  IF t.tariff_id IS NULL THEN
    NEW.carrier_tariff_id := NULL;
    NEW.tariff_amount := NULL;
    NEW.tariff_tolerance_pct := NULL;
    RETURN NEW;
  END IF;

  attendu := CASE WHEN t.basis = 'PER_UNIT'
                  THEN t.amount * COALESCE(aff.contracted_volume, 0)
                  ELSE t.amount END;

  -- FIGÉS au chiffrage : un tarif révisé ensuite ne doit pas requalifier un
  -- écart déjà motivé.
  NEW.carrier_tariff_id := t.tariff_id;
  NEW.tariff_amount := attendu;
  NEW.tariff_tolerance_pct := t.tolerance_pct;

  IF attendu = 0 THEN
    RETURN NEW;
  END IF;

  tolerance := COALESCE(t.tolerance_pct, 0);
  ecart_pct := abs(NEW.estimated_amount - attendu) / attendu * 100;

  IF ecart_pct <= tolerance THEN
    RETURN NEW;
  END IF;

  IF NEW.variance_reason IS NULL
     OR length(trim(NEW.variance_reason)) < 10 THEN
    RAISE EXCEPTION
      'TARIF TRANSPORT : coût retenu à % contre % au tarif négocié, soit % %% d''écart pour une tolérance de % %%. Un motif circonstancié d''au moins dix caractères est exigé : un écart que personne n''explique aujourd''hui, personne ne l''expliquera dans six mois.',
      round(NEW.estimated_amount, 2), round(attendu, 2), round(ecart_pct, 2), round(tolerance, 2)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deal_transport_tariff ON deal_cost_lines;
CREATE TRIGGER trg_deal_transport_tariff
  BEFORE INSERT OR UPDATE OF cost_post_id, supplier_id, estimated_amount, variance_reason
  ON deal_cost_lines
  FOR EACH ROW EXECUTE FUNCTION enforce_deal_transport_tariff();


-- ---------------------------------------------------------------------------
--  Le tarif d'un transporteur ne se pose que sur un TRANSPORTEUR.
--  (Inchangé — ce verrou porte sur `carrier_tariffs` lui-même, jamais sur
--  l'affectation ni le chiffrage.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_tariff_on_carrier()
RETURNS TRIGGER AS $$
DECLARE
  t text;
BEGIN
  SELECT type::text INTO t FROM partners WHERE id = NEW.carrier_id;
  IF t IS DISTINCT FROM 'CARRIER' THEN
    RAISE EXCEPTION
      'Un tarif de transport ne se négocie qu''avec un transporteur : ce tiers est enregistré comme %.',
      COALESCE(t, 'tiers inconnu')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tariff_on_carrier ON carrier_tariffs;
CREATE TRIGGER trg_tariff_on_carrier
  BEFORE INSERT OR UPDATE OF carrier_id ON carrier_tariffs
  FOR EACH ROW EXECUTE FUNCTION enforce_tariff_on_carrier();

ALTER TABLE carrier_tariffs
  DROP CONSTRAINT IF EXISTS chk_carrier_tariff_amount,
  ADD  CONSTRAINT chk_carrier_tariff_amount CHECK (amount >= 0),

  DROP CONSTRAINT IF EXISTS chk_carrier_tariff_dates,
  ADD  CONSTRAINT chk_carrier_tariff_dates
       CHECK (effective_to IS NULL OR effective_to >= effective_from),

  -- Une base au litre suppose une unité : sans elle, « 12 » ne dit pas si
  -- c'est 12 par litre ou 12 par mètre cube.
  DROP CONSTRAINT IF EXISTS chk_carrier_tariff_uom,
  ADD  CONSTRAINT chk_carrier_tariff_uom
       CHECK (basis::text <> 'PER_UNIT' OR uom IS NOT NULL);


-- ---------------------------------------------------------------------------
--  Anciens verrous sur `operation_assignments` — déposés.
--
--  Le fret ne s'y saisit plus : la table ne porte plus les colonnes
--  correspondantes (voir schema.prisma, revu le 22/08/2026). Les fonctions
--  et le déclencheur qui les vérifiaient n'ont donc plus d'objet.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_freight_tariff ON operation_assignments;
DROP FUNCTION IF EXISTS enforce_freight_tariff();
DROP TRIGGER IF EXISTS trg_carrier_is_carrier ON operation_assignments;
DROP FUNCTION IF EXISTS enforce_carrier_is_carrier();

ALTER TABLE operation_assignments
  DROP CONSTRAINT IF EXISTS chk_assignment_freight_needs_carrier;


-- ---------------------------------------------------------------------------
--  Coûts de transport engagés hors tarif — l'antérieur, et ce qui échappe
--  encore. Portait sur `operation_assignments`, porte désormais sur
--  `deal_cost_lines`, au même titre que tout le reste du chiffrage.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_fret_hors_tarif AS
SELECT d.id                                 AS deal_id,
       d.reference                          AS affaire,
       p.legal_name                         AS transporteur,
       l.estimated_amount                   AS freight_cost,
       l.currency_code,
       l.tariff_amount                      AS tarif_attendu,
       CASE WHEN l.tariff_amount > 0
            THEN round(abs(l.estimated_amount - l.tariff_amount) / l.tariff_amount * 100, 2)
            ELSE NULL END                   AS ecart_pct,
       l.tariff_tolerance_pct               AS tolerance_pct,
       l.variance_reason                    AS motif
  FROM deal_cost_lines l
  JOIN cost_posts cp ON cp.id = l.cost_post_id
  JOIN deals d ON d.id = l.deal_id
  LEFT JOIN partners p ON p.id = l.supplier_id
 WHERE cp.code = 'TRANSPORT'
   AND l.estimated_amount > 0
   AND (l.supplier_id IS NULL
        OR l.carrier_tariff_id IS NULL
        OR (l.tariff_amount > 0
            AND abs(l.estimated_amount - l.tariff_amount) / l.tariff_amount * 100
                > COALESCE(l.tariff_tolerance_pct, 0)
            AND (l.variance_reason IS NULL
                 OR length(trim(l.variance_reason)) < 10)));

COMMENT ON VIEW v_fret_hors_tarif IS
  'Coûts de transport engagés au chiffrage sans transporteur, sans tarif négocié, ou s''en écartant sans motif (§ 5.4). Le déclencheur l''empêche désormais pour toute nouvelle ligne ; ceci montre l''antérieur.';
