-- ===========================================================================
--  LE CUMUL FACTURÉ EST BORNÉ PAR LE VOLUME CONTRACTÉ
--  Réf. SPECIFICATIONS.md § 4, § 9 — issu de l'audit, défaut 1
--
--  LE MODÈLE D'ELYON, RAPPELÉ PAR LE DIRIGEANT
--  -------------------------------------------
--  « Le volume commandé lors de la création de l'affaire sera le volume livré. »
--  Les relevés terrain, la correction ASTM et l'écart d'ullage servent à améliorer
--  les pratiques opérationnelles — ils n'interviennent NI dans les coûts NI dans la
--  facturation (§ 18).
--
--  « La facture au client n'attend pas l'exécution de la livraison. » Une proforma est
--  émise ou non, puis une facture simple ou une FNE.
--
--  ⚠️ CONSÉQUENCE DIRECTE : LA RÉFÉRENCE EST L'AFFAIRE, JAMAIS L'OPÉRATION.
--
--     Rattacher la facture à une opération livrée bloquerait le cycle commercial en
--     subordonnant l'émission à une livraison qui n'a pas encore eu lieu. Ce n'est pas
--     ce qu'on veut. Ce qu'on veut, c'est qu'on ne facture pas DEUX FOIS ce qui n'a été
--     vendu qu'une.
--
--  LE DÉFAUT CORRIGÉ ICI
--  ---------------------
--  `billed_volume` venait de la requête et n'était confronté à rien. Les 9 contraintes
--  de la table vérifient la cohérence INTERNE de la pièce — montant dérivé du volume et
--  du prix, TVA extraite du total — et aucune ne regarde l'affaire.
--
--  Constaté en base au moment de l'audit : une affaire de 30 000 L portait 144 166 L
--  facturés sur 6 pièces, soit 4,8 fois le volume vendu, sans qu'aucun contrôle ne se
--  déclenche.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Le volume déjà engagé sur une affaire.
--
--  ⚠️ CE QUI COMPTE, ET CE QUI NE COMPTE PAS.
--
--     · PROFORMA        n'engage rien (§ 9.3) — exclue.
--     · CANCELLED       annulée — exclue.
--     · SIMPLE et FNE   engagent — comptées.
--     · CREDIT_NOTE     un avoir REND du volume : il se retranche. Sans cela, corriger
--                       une facture par un avoir puis refacturer serait refusé, alors
--                       que c'est précisément la voie de correction prévue.
--
--  `p_exclure` permet d'évaluer le cumul SANS une pièce donnée : indispensable pour
--  qu'une modification de pièce ne se compare pas à elle-même.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION volume_facture_affaire(p_deal_id uuid, p_exclure uuid DEFAULT NULL)
RETURNS numeric AS $$
  SELECT COALESCE(sum(
    CASE WHEN i.type::text = 'CREDIT_NOTE' THEN -i.billed_volume ELSE i.billed_volume END
  ), 0)
    FROM invoices i
   WHERE i.deal_id = p_deal_id
     AND i.type::text IN ('SIMPLE', 'FNE', 'CREDIT_NOTE')
     AND i.status::text <> 'CANCELLED'
     AND (p_exclure IS NULL OR i.id <> p_exclure);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION volume_facture_affaire(uuid, uuid) IS
  'Volume déjà engagé en facturation sur une affaire (§ 9). Proformas exclues — elles n''engagent rien ; avoirs retranchés — ils rendent du volume.';


-- ---------------------------------------------------------------------------
--  Le verrou.
--
--  ⚠️ LA TOLÉRANCE EST UNE TOLÉRANCE DE VOLUME, PAS UNE TOLÉRANCE MONÉTAIRE.
--
--     Premier réflexe : réutiliser `tolerance_arrondi(devise)`, déjà paramétrée. Elle
--     vaut une demi-unité de la plus petite subdivision — 0,5 en XOF, 0,005 en USD.
--     Appliquée à un volume, elle n'a aucun sens : 0,5 litre sur 30 000 est arbitraire,
--     et 0,005 litre sur 12 000 000 refuserait une facturation légitime.
--
--     On retient donc un écart RELATIF au contrat : un dix-millième. Sur 30 000 L cela
--     fait 3 L, sur 12 000 000 L cela fait 1 200 L — proportionné dans les deux cas.
-- ---------------------------------------------------------------------------
-- ⚠️ UN VERROU NE DOIT JAMAIS EMPÊCHER DE RÉPARER CE QU'IL DÉNONCE.
--
--    Première version : le contrôle se déclenchait sur toute écriture. Conséquence
--    découverte en l'utilisant — annuler une pièce en double devenait IMPOSSIBLE.
--    L'annulation modifie le statut ; le recalcul du solde modifie le statut ; le
--    déclencheur se rejouait, constatait le dépassement PRÉEXISTANT, et refusait.
--    Le seul geste de régularisation que le message lui-même recommandait était
--    interdit par le verrou.
--
--    La règle correcte n'est pas « le cumul doit être conforme » mais « cette
--    écriture ne doit pas AGGRAVER le cumul ». Une annulation, une réduction de
--    volume, un passage en avoir diminuent l'engagement : ils passent toujours.
--    Seule une augmentation est confrontée au contrat.
--
--    C'est aussi ce qui rend la reprise possible sans dérogation : l'existant se
--    corrige, il ne se contourne pas.
CREATE OR REPLACE FUNCTION enforce_facturation_bornee()
RETURNS TRIGGER AS $$
DECLARE
  contracte numeric;
  deja      numeric;
  total     numeric;
  tol       numeric;
  ref_deal  text;
  part_new  numeric;
  part_old  numeric;
BEGIN
  -- Ce que CETTE pièce engage, avant et après l'écriture. Une proforma n'engage
  -- rien (§ 9.3) ; une pièce annulée non plus.
  part_new := CASE WHEN NEW.type::text IN ('SIMPLE', 'FNE')
                    AND NEW.status::text <> 'CANCELLED'
                   THEN NEW.billed_volume ELSE 0 END;

  IF TG_OP = 'UPDATE' THEN
    part_old := CASE WHEN OLD.type::text IN ('SIMPLE', 'FNE')
                      AND OLD.status::text <> 'CANCELLED'
                     THEN OLD.billed_volume ELSE 0 END;
    -- L'écriture allège ou laisse inchangé : rien à contrôler.
    IF part_new <= part_old AND NEW.deal_id = OLD.deal_id THEN
      RETURN NEW;
    END IF;
  END IF;

  IF part_new = 0 THEN
    RETURN NEW;
  END IF;

  SELECT d.contracted_volume, d.reference INTO contracte, ref_deal
    FROM deals d WHERE d.id = NEW.deal_id;

  IF contracte IS NULL OR contracte <= 0 THEN
    RETURN NEW;
  END IF;

  deja  := volume_facture_affaire(NEW.deal_id, NEW.id);
  total := deja + part_new;
  tol   := contracte * 0.0001;

  IF total > contracte + tol THEN
    RAISE EXCEPTION
      'Facturation de % : l''affaire % porte % % au contrat, dont % déjà facturés. Cette pièce porterait le cumul à %, soit % de trop. Corriger le volume, ou émettre un avoir sur la pièce en excès — une affaire ne se facture pas deux fois.',
      NEW.number, ref_deal, round(contracte, 4), NEW.uom,
      round(deja, 4), round(total, 4), round(total - contracte, 4)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_facturation_bornee ON invoices;
CREATE TRIGGER trg_facturation_bornee
  BEFORE INSERT OR UPDATE OF billed_volume, type, status, deal_id ON invoices
  FOR EACH ROW EXECUTE FUNCTION enforce_facturation_bornee();


-- ---------------------------------------------------------------------------
--  CE QUI RESTE À FACTURER — la lecture qui manquait.
--
--  Le défaut n'était pas seulement l'absence de verrou : rien, dans l'application,
--  ne disait combien il restait à facturer sur une affaire. Le comptable ouvrait
--  l'écran et retapait un nombre de mémoire.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_reste_a_facturer AS
SELECT d.id                                        AS deal_id,
       d.reference                                 AS affaire,
       p.legal_name                                AS client,
       pr.code                                     AS produit,
       d.status::text                              AS statut_affaire,
       d.contracted_volume                         AS contracte,
       d.uom::text                                 AS uom,
       volume_facture_affaire(d.id)                AS deja_facture,
       round(d.contracted_volume - volume_facture_affaire(d.id), 4) AS reste,
       d.unit_sale_price,
       d.currency_code,
       -- Une affaire close et non facturée est de l'argent qu'on a livré et
       -- qu'on n'a pas réclamé. C'est le sens le plus coûteux de l'écart.
       (d.status::text IN ('IN_EXECUTION', 'CLOSED')
        AND volume_facture_affaire(d.id) < d.contracted_volume * 0.9999)
                                                   AS a_facturer,
       (volume_facture_affaire(d.id) > d.contracted_volume * 1.0001)
                                                   AS sur_facturee
  FROM deals d
  JOIN partners p ON p.id = d.client_id
  JOIN products pr ON pr.id = d.product_id
 WHERE d.status::text NOT IN ('DRAFT', 'CANCELLED', 'REJECTED_BY_CLIENT');

COMMENT ON VIEW v_reste_a_facturer IS
  'Reliquat à facturer par affaire (§ 9). `a_facturer` = affaire engagée dont tout n''a pas été facturé ; `sur_facturee` = cumul au-delà du contrat, qui ne devrait plus jamais apparaître depuis la pose du verrou.';


-- ---------------------------------------------------------------------------
--  REPRISE — un déclencheur ne juge que ce qui vient après lui.
--
--  On ne supprime rien : une facture émise porte un numéro de séquence fiscale, et
--  l'effacer ouvrirait un trou dans une numérotation que la loi veut continue. Les
--  pièces en excès sont SIGNALÉES, à traiter par avoir ou par annulation explicite.
-- ---------------------------------------------------------------------------
DO $reprise$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM v_reste_a_facturer WHERE sur_facturee;
  IF n > 0 THEN
    RAISE WARNING
      '% affaire(s) déjà sur-facturée(s) avant la pose du verrou. Elles restent en base — une pièce fiscale ne s''efface pas — et remontent dans v_invariant_breaches jusqu''à régularisation par avoir ou annulation.',
      n;
  END IF;
END
$reprise$;
