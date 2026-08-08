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
--  VERROU 1 — un fret suppose un TRANSPORTEUR ENREGISTRÉ.
--
--  Un coût sans contrepartie identifiée ne se rapproche d'aucune facture, ne
--  s'impute à aucun contrat, et ne se conteste devant personne. Le champ était
--  facultatif ; il ne l'est plus dès qu'un montant est engagé.
--
--  Le fret NUL reste admis sans transporteur : un transport pour compte propre
--  ou un enlèvement par le client n'engagent aucun coût externe.
-- ---------------------------------------------------------------------------
ALTER TABLE operation_assignments
  DROP CONSTRAINT IF EXISTS chk_assignment_freight_needs_carrier,
  ADD  CONSTRAINT chk_assignment_freight_needs_carrier
       CHECK (freight_cost = 0 OR carrier_id IS NOT NULL);


-- ---------------------------------------------------------------------------
--  VERROU 2 — l'écart au tarif négocié doit être MOTIVÉ.
--
--  Le montant reste saisissable : une attente facturée, un déplacement
--  exceptionnel, une négociation ponctuelle existent. Ce qui ne doit pas
--  exister, c'est un écart SILENCIEUX — celui que personne ne voit passer et
--  que personne ne saura expliquer six mois plus tard.
--
--  La tolérance vient du tarif lui-même. Vide ou nulle : tout écart se motive.
--  C'est la règle STRICTE retenue par la direction pour le barème de coûts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_freight_tariff()
RETURNS TRIGGER AS $$
DECLARE
  op        record;
  t         record;
  attendu   numeric;
  ecart_pct numeric;
  tolerance numeric;
BEGIN
  IF NEW.carrier_id IS NULL OR NEW.freight_cost = 0 THEN
    RETURN NEW;
  END IF;

  SELECT o.transport_mode::text AS mode, o.planned_volume,
         o.origin_site_id, d.product_id, ps.site_id AS destination_site_id
    INTO op
    FROM operations o
    JOIN deals d ON d.id = o.deal_id
    LEFT JOIN partner_sites ps ON ps.id = o.destination_site_id
   WHERE o.id = NEW.operation_id;

  SELECT * INTO t FROM resolve_carrier_tariff(
    NEW.carrier_id, op.mode, op.product_id,
    op.origin_site_id, op.destination_site_id, CURRENT_DATE);

  -- Aucun tarif négocié pour ce transporteur : on ne bloque pas. Exiger un
  -- tarif avant toute affectation empêcherait de travailler avec un
  -- transporteur d'appoint un jour de rupture — et c'est précisément ce
  -- jour-là qu'il faut pouvoir rouler.
  IF t.tariff_id IS NULL THEN
    NEW.carrier_tariff_id := NULL;
    NEW.tariff_amount := NULL;
    NEW.tariff_tolerance_pct := NULL;
    RETURN NEW;
  END IF;

  -- Le tarif RAMENÉ au montant attendu pour cette opération.
  attendu := CASE WHEN t.basis = 'PER_UNIT'
                  THEN t.amount * COALESCE(op.planned_volume, 0)
                  ELSE t.amount END;

  -- FIGÉS sur l'affectation : un tarif révisé ensuite ne doit pas requalifier
  -- un écart déjà motivé.
  NEW.carrier_tariff_id := t.tariff_id;
  NEW.tariff_amount := attendu;
  NEW.tariff_tolerance_pct := t.tolerance_pct;

  IF attendu = 0 THEN
    RETURN NEW;
  END IF;

  tolerance := COALESCE(t.tolerance_pct, 0);
  ecart_pct := abs(NEW.freight_cost - attendu) / attendu * 100;

  IF ecart_pct <= tolerance THEN
    RETURN NEW;
  END IF;

  IF NEW.freight_variance_reason IS NULL
     OR length(trim(NEW.freight_variance_reason)) < 10 THEN
    RAISE EXCEPTION
      'TARIF TRANSPORT — fret retenu à % contre % au tarif négocié, soit % %% d''écart pour une tolérance de % %%. Un motif circonstancié est exigé : un écart que personne n''explique aujourd''hui, personne ne l''expliquera dans six mois.',
      round(NEW.freight_cost, 2), round(attendu, 2), round(ecart_pct, 2), round(tolerance, 2)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_freight_tariff ON operation_assignments;
CREATE TRIGGER trg_freight_tariff
  BEFORE INSERT OR UPDATE OF carrier_id, freight_cost, freight_variance_reason
  ON operation_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_freight_tariff();


-- ---------------------------------------------------------------------------
--  VERROU 3 — le transporteur doit être un TIERS DE TYPE TRANSPORTEUR.
--
--  Rien n'empêchait de désigner un client comme transporteur. La clé étrangère
--  pointe sur `partners`, qui porte aussi bien les clients que les
--  fournisseurs : sans ce contrôle, une erreur de sélection passait, et le
--  rapprochement des coûts la découvrait des mois plus tard.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_carrier_is_carrier()
RETURNS TRIGGER AS $$
DECLARE
  t text;
  nom text;
BEGIN
  IF NEW.carrier_id IS NULL THEN RETURN NEW; END IF;

  SELECT type::text, legal_name INTO t, nom FROM partners WHERE id = NEW.carrier_id;
  IF t IS DISTINCT FROM 'CARRIER' THEN
    RAISE EXCEPTION
      'TRANSPORTEUR — « % » est enregistré comme %, pas comme transporteur. Le fret doit être rattaché à un transporteur du référentiel : sans contrepartie identifiée, le coût ne se rapproche d''aucune facture.',
      COALESCE(nom, 'ce tiers'), COALESCE(t, 'tiers inconnu')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_carrier_is_carrier ON operation_assignments;
CREATE TRIGGER trg_carrier_is_carrier
  BEFORE INSERT OR UPDATE OF carrier_id ON operation_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_carrier_is_carrier();


-- ---------------------------------------------------------------------------
--  Le tarif d'un transporteur ne se pose que sur un TRANSPORTEUR.
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
--  Frets engagés hors tarif — l'antérieur, et ce qui échappe encore.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_fret_hors_tarif AS
SELECT o.reference                         AS operation,
       p.legal_name                        AS transporteur,
       a.freight_cost,
       a.currency_code,
       a.tariff_amount                     AS tarif_attendu,
       CASE WHEN a.tariff_amount > 0
            THEN round(abs(a.freight_cost - a.tariff_amount) / a.tariff_amount * 100, 2)
            ELSE NULL END                  AS ecart_pct,
       a.tariff_tolerance_pct              AS tolerance_pct,
       a.freight_variance_reason           AS motif
  FROM operation_assignments a
  JOIN operations o ON o.id = a.operation_id
  LEFT JOIN partners p ON p.id = a.carrier_id
 WHERE a.freight_cost > 0
   AND (a.carrier_id IS NULL
        OR a.carrier_tariff_id IS NULL
        OR (a.tariff_amount > 0
            AND abs(a.freight_cost - a.tariff_amount) / a.tariff_amount * 100
                > COALESCE(a.tariff_tolerance_pct, 0)
            AND (a.freight_variance_reason IS NULL
                 OR length(trim(a.freight_variance_reason)) < 10)));

COMMENT ON VIEW v_fret_hors_tarif IS
  'Frets engagés sans transporteur, sans tarif négocié, ou s''en écartant sans motif (§ 5.4). Le déclencheur l''empêche désormais ; ceci montre l''antérieur et les transporteurs sans grille.';
