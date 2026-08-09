-- ===========================================================================
--  L'AUDIT PERMANENT DOIT COUVRIR TOUS LES INVARIANTS
--  Réf. SPECIFICATIONS.md § 11
--
--  ⚠️ `v_invariant_breaches` RENVOYAIT ZÉRO, ET CE ZÉRO NE PROUVAIT PRESQUE
--     RIEN.
--
--     Elle couvrait 4 règles. Au moins cinq autres invariants ont été posés
--     depuis, chacun par un déclencheur — donc valable pour l'AVENIR SEUL. Les
--     enregistrements antérieurs y échappent en silence, et rien ne les
--     signalait.
--
--     Pire : la clause de la ligne de coût commence par `standard_amount IS
--     NOT NULL`. Or la reprise du barème n'a jamais rempli cette colonne sur
--     les lignes antérieures. Ces lignes étaient donc EXCLUES DE L'AUDIT par
--     la condition même censée les examiner — un transport chiffré à 45 FCFA/L
--     contre un barème à 30 ne remontait nulle part.
--
--     J'ai présenté ce zéro comme une garantie. Il ne mesurait que ce qu'on
--     lui avait appris à voir.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  REPRISE PRÉALABLE — le barème n'avait jamais été appliqué à l'existant.
--
--  `standard_amount` n'était recopié qu'à l'écriture. Sans cette reprise, les
--  lignes antérieures restent invisibles quoi qu'on écrive dans la vue.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  -- La cible d'un UPDATE ne peut pas être référencée depuis un LATERAL de sa
  -- propre clause FROM : la résolution se fait donc dans une sous-requête.
  UPDATE deal_cost_lines l
     SET standard_amount        = s.montant,
         standard_tolerance_pct = s.tolerance
    FROM (
      SELECT dl.id AS ligne_id, r.amount AS montant, r.tolerance_pct AS tolerance
        FROM deal_cost_lines dl
        JOIN deals d ON d.id = dl.deal_id
        CROSS JOIN LATERAL resolve_cost_standard(
          dl.cost_post_id, d.segment::text, NULL, d.product_id, CURRENT_DATE) r
       WHERE dl.standard_amount IS NULL
    ) s
   WHERE s.ligne_id = l.id
     AND s.montant IS NOT NULL;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'Reprise : barème rattaché à % ligne(s) de coût antérieures.', n;
  END IF;
END $$;


-- ---------------------------------------------------------------------------
--  DATE D'ENTRÉE EN VIGUEUR DU VERROU DE PREUVE.
--
--  Consignée en PARAMÈTRE à la première installation du verrou, et non écrite
--  en dur : la date diffère d'un environnement à l'autre, et une date recopiée
--  serait fausse partout sauf sur la base où on l'a relevée.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION date_verrou_preuve()
RETURNS timestamptz AS $$
  -- Consignée par 12_exigence_photo.sql à la première installation du verrou.
  -- Lue dans les PARAMÈTRES, jamais dans `_prisma_migrations` : cette table
  -- est interne à Prisma et absente de la base de travail des migrations —
  -- l'y chercher faisait échouer toute migration ultérieure.
  SELECT COALESCE(
    (SELECT NULLIF(value, '')::timestamptz FROM system_settings
      WHERE key = 'PROOF_LOCK_INSTALLED_AT'),
    -- Paramètre absent : on ne masque rien. Mieux vaut signaler l'antérieur
    -- que de laisser passer le réel.
    '-infinity'::timestamptz);
$$ LANGUAGE sql STABLE;


-- ---------------------------------------------------------------------------
--  LA VUE, COMPLÈTE.
--
--  Chaque invariant tenu par un déclencheur DOIT avoir sa clause ici. C'est la
--  règle : un verrou sans clause d'audit ne protège que l'avenir, et personne
--  ne sait ce que le passé contient.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_invariant_breaches AS

-- 1. Prix fournisseur validé par un rôle non habilité (le DG seul, § 6.3).
SELECT
  'Prix fournisseur validé par un rôle non habilité'::text AS regle,
  'supplier_prices'::text                                  AS relation,
  sp.id::text                                              AS enregistrement,
  COALESCE(u.role::text, 'inconnu')                        AS detail
FROM supplier_prices sp
JOIN users u ON u.id = sp.validated_by_id
WHERE u.role::text <> 'DG'

UNION ALL
-- 2. Affaire approuvée sans prix d'achat sourcé (§ 5.4).
SELECT
  'Affaire approuvée sans prix d''achat sourcé',
  'deals',
  d.reference,
  'approuvée le ' || COALESCE(d.credit_approved_at::date::text, '?')
FROM deals d
WHERE d.credit_approved_by_id IS NOT NULL
  AND (d.supplier_price_id IS NULL OR d.unit_purchase_price = 0)

UNION ALL
-- 3. Ligne de coût hors barème sans motif (§ 5.4).
--    La condition `standard_amount IS NOT NULL` est CONSERVÉE — une ligne sans
--    barème résolu n'est pas une infraction — mais la reprise ci-dessus a
--    rempli la colonne, donc elle n'exclut plus l'antérieur.
SELECT
  'Ligne de coût s''écartant du barème sans motif',
  'deal_cost_lines',
  d.reference || ' · ' || cp.code,
  'retenu ' || l.estimated_amount || ' contre ' || l.standard_amount
FROM deal_cost_lines l
JOIN deals d ON d.id = l.deal_id
JOIN cost_posts cp ON cp.id = l.cost_post_id
WHERE l.standard_amount IS NOT NULL
  AND l.standard_amount > 0
  AND abs(l.estimated_amount - l.standard_amount)
      > l.standard_amount * (COALESCE(l.standard_tolerance_pct, 0) / 100 + 0.0001)
  AND (l.variance_reason IS NULL OR length(trim(l.variance_reason)) < 5)

UNION ALL
-- 4. Avance apurée sans contrepartie (§ 14.6).
SELECT
  'Avance apurée sans contrepartie constatée',
  'supplier_invoices',
  si.reference,
  'apurée le ' || si.settled_at::text
FROM supplier_invoices si
WHERE si.settled_at IS NOT NULL
  AND si.settled_amount < si.prepaid_amount - 0.01

UNION ALL
-- =========================================================================
--  CE QUI MANQUAIT — cinq invariants posés sans clause d'audit.
-- =========================================================================

-- 5. Affaire approuvée SOUS LE PLANCHER DIRECT sans dérogation opposable.
--    Le déclencheur date du 2 août ; tout ce qui a été approuvé avant n'a
--    jamais été confronté au plancher.
SELECT
  'Affaire approuvée sous le plancher direct',
  'deals',
  d.reference,
  'marge directe ' || round(d.estimated_direct_margin, 2) ||
  ' pour un plancher de ' || round(t.direct_floor, 2) ||
  CASE WHEN d.margin_derogation_id IS NULL THEN ', sans dérogation'
       ELSE ', dérogation non opposable' END
FROM deals d
CROSS JOIN LATERAL resolve_margin_threshold(
  d.segment::text, d.product_id, d.currency_code, d.uom::text, CURRENT_DATE) t
WHERE d.credit_approved_by_id IS NOT NULL
  AND t.direct_floor IS NOT NULL
  AND d.estimated_direct_margin < t.direct_floor
  AND (d.margin_derogation_id IS NULL
       OR NOT derogation_opposable(
            d.margin_derogation_id, 'MARGIN_BELOW_DIRECT_FLOOR', d.reference))

UNION ALL
-- 6. Affaire approuvée HORS BANDE DE PRIX D'ACHAT sans dérogation opposable.
SELECT
  'Affaire approuvée hors bande de prix d''achat',
  'deals',
  d.reference,
  'retenu ' || round(d.unit_purchase_price, 4) || ' contre ' || round(sp.unit_price, 4) ||
  ' validé, soit ' ||
  round(abs(d.unit_purchase_price - sp.unit_price) / sp.unit_price * 100, 2) ||
  ' %% pour une bande de ' || round(purchase_price_band_pct(), 2) || ' %%'
FROM deals d
JOIN supplier_prices sp ON sp.id = d.supplier_price_id
WHERE d.credit_approved_by_id IS NOT NULL
  AND sp.unit_price > 0
  AND abs(d.unit_purchase_price - sp.unit_price) / sp.unit_price * 100
      > purchase_price_band_pct()
  AND (d.purchase_price_derogation_id IS NULL
       OR NOT derogation_opposable(
            d.purchase_price_derogation_id, 'PURCHASE_PRICE_VARIANCE', d.reference))

UNION ALL
-- 7. Dérogations invoquées alors qu'elles n'ouvrent rien (§ 11.2).
SELECT regle, 'derogations', enregistrement, detail FROM v_derogations_abusives

UNION ALL
-- 8. Point de contrôle enregistré sans la preuve exigée (§ 7.1 bis).
--    Photo, valeur relevée ou signature : ce sont les pièces qu'on produira
--    après un litige. On ne peut pas les fabriquer après coup.
--    ⚠️ SEULS LES CONTRÔLES POSTÉRIEURS AU VERROU y figurent.
--
--       Le verrou date du 6 août 2026. Ce qui a été enregistré AVANT lui n'a
--       jamais eu à s'y confronter — et on ne fabrique pas après coup une
--       photo qui n'a pas été prise. Les y laisser aurait installé 52 lignes
--       permanentes dans une vue qui doit rester VIDE : au bout d'une semaine,
--       plus personne ne l'aurait lue, et la 53ᵉ — la vraie — serait passée
--       inaperçue.
--
--       L'antérieur n'est pas effacé pour autant : il reste intégralement
--       dans `v_controles_sans_preuve`, qui existe pour cela.
SELECT
  'Contrôle enregistré sans la preuve exigée',
  'operation_hse_check_items',
  operation || ' · ' || point_code,
  'manque : ' || preuves_manquantes
FROM v_controles_sans_preuve
-- ⚠️ FILTRÉ SUR LA DATE SYSTÈME DE LA LIGNE, pas sur `recorded_at`.
--
--    `recorded_at` est une date MÉTIER — l'heure à laquelle l'agent dit avoir
--    contrôlé. Elle peut être antérieure au verrou sur une ligne écrite après,
--    et postérieure sur une ligne écrite avant : le jeu de démonstration en
--    porte de futures. Seule la date d'inscription en base dit ce que le
--    verrou pouvait effectivement empêcher.
WHERE inscrit_le >= date_verrou_preuve()

UNION ALL
-- 9. Opération sans type — aucun contrôle HSE ne peut s'y attacher (§ 7.1 bis).
SELECT
  'Opération sans type d''opération',
  'operations',
  o.reference,
  'statut ' || o.status::text || ' — aucune checklist ne peut s''y attacher'
FROM operations o
WHERE o.status::text <> 'DRAFT'
  AND NOT EXISTS (
    SELECT 1 FROM operation_type_assignments a WHERE a.operation_id = o.id
  )

UNION ALL
-- 10. Moyens affectés à une opération alors qu'ils ne sont PLUS conformes.
--     Le verrou joue à l'affectation ; une pièce peut expirer ensuite, et
--     l'opération continue. Ce n'est pas une fraude, c'est un signal : la
--     pièce doit être renouvelée avant le prochain départ.
SELECT
  'Moyens devenus non conformes après affectation',
  'operation_assignments',
  o.reference,
  string_agg(DISTINCT c.subject_kind || ' ' || c.subject_label, ', ')
FROM operation_assignments a
JOIN operations o ON o.id = a.operation_id
JOIN v_transport_compliance c
  ON c.subject_id IN (a.carrier_id, a.vehicle_id, a.driver_id)
WHERE NOT c.is_compliant
  AND o.status::text NOT IN ('CLOSED', 'CANCELLED')
  AND a.compliance_derogation_id IS NULL
GROUP BY o.reference

UNION ALL
-- 11. Paramètre supprimé alors qu'un verrou en dépend.
--     Le contrôle ne tombe pas en erreur : il tourne sur son repli, donc sur
--     une valeur que personne n'a choisie. Un préavis de conformité revenu à
--     sa valeur de secours n'alerte pas — il alerte simplement AILLEURS que là
--     où le coordinateur croit l'avoir réglé.
SELECT
  'Paramètre requis absent — un verrou tourne sur son repli',
  'system_settings',
  pr.parametre,
  'lu par ' || pr.objets
FROM v_parametres_requis pr
WHERE NOT pr.present

UNION ALL
-- 12. La dérivation de la règle 11 ne reconnaît plus aucune lecture.
--     Sans ceci, une réécriture du SQL qui changerait la forme des requêtes
--     ferait passer la règle 11 de « rien à signaler » à « je ne regarde plus
--     rien » sans que la différence se voie.
SELECT
  'Détection des paramètres requis devenue aveugle',
  'system_settings',
  'v_parametres_requis',
  'aucune lecture de paramètre reconnue dans le catalogue'
FROM v_parametres_requis_sonde s
WHERE s.parametres_detectes = 0

UNION ALL
-- 13. Opération partie au chargement sans AUCUN point de contrôle HSE.
--     Le verrou refuse désormais ce cas, mais il ne juge que les écritures
--     postérieures à sa pose : ce qui est déjà en base lui échappe. Vérifié
--     vide au moment de l'ajout — cette ligne le maintiendra vide.
SELECT
  'Opération engagée sans aucun point de contrôle HSE',
  'operations',
  o.reference,
  'statut ' || o.status::text || ', validée sans checklist'
FROM operations o
WHERE o.status::text IN ('LOADING', 'IN_TRANSIT', 'DELIVERING', 'FINAL_CHECK', 'CLOSED')
  AND o.hse_derogation_id IS NULL
  AND NOT EXISTS (
    SELECT 1
      FROM operation_hse_check_items i
      JOIN operation_hse_checks c ON c.id = i.check_id
     WHERE c.operation_id = o.id
  )

UNION ALL
-- 14. Prévision de vente hors des bornes de son exercice.
--     Le déclencheur refuse désormais ces lignes, et refuse aussi qu'on
--     raccourcisse un exercice sous ses prévisions. Cette règle couvre ce qui
--     était déjà en base avant la pose des deux gardes.
SELECT
  'Prévision de vente hors des bornes de son exercice',
  'sales_forecasts',
  f.year::text || ' · ' || s.segment::text || ' · mois ' || s.month_index::text,
  'l''exercice compte ' || nb_mois_exercice(s.fiscal_year_id)::text || ' mois'
FROM sales_forecasts s
JOIN fiscal_years f ON f.id = s.fiscal_year_id
WHERE s.month_index > nb_mois_exercice(s.fiscal_year_id)

UNION ALL
-- 15. Affaire facturée au-delà de son volume contracté.
--     Le verrou de 30_facturation_bornee.sql refuse ce cas depuis sa pose ; cette
--     règle couvre ce qui existait avant. Une pièce fiscale ne s'efface pas : la
--     régularisation passe par un avoir ou une annulation, jamais par un DELETE.
SELECT
  'Affaire facturée au-delà de son volume contracté',
  'invoices',
  r.affaire,
  'facturé ' || round(r.deja_facture, 2) || ' pour ' || round(r.contracte, 2) || ' contractés'
FROM v_reste_a_facturer r
WHERE r.sur_facturee

UNION ALL
-- 16. Solde de facture divergent du journal des règlements.
--     Le solde est désormais dérivé et sa saisie manuelle refusée ; cette règle
--     couvre l'antérieur et détecterait toute réintroduction du défaut.
SELECT
  'Solde de facture divergent du journal des règlements',
  'invoices',
  e.piece,
  'porté ' || round(e.solde_porte, 2) || ' contre ' || round(e.somme_du_journal, 2) || ' au journal'
FROM v_rapprochement_encaissements e
WHERE abs(e.ecart) > tolerance_arrondi(e.currency_code)

UNION ALL
-- 17. Poste de charge rangé dans un pool de l'autre nature.
--     Les charges fixes du point mort sont la somme des budgets des pools
--     FIXES. Un poste variable logé dans un pool fixe y fait entrer une charge
--     proportionnelle que la marge sur coût variable compte déjà — comptée deux
--     fois, elle gonfle le point mort. Le déclencheur refuse ce cas depuis sa
--     pose ; cette règle couvre l'antérieur.
SELECT
  'Poste de charge rangé dans un pool de nature différente',
  'cost_posts',
  p.code || ' · pool ' || cp.code,
  'poste ' || p.variability::text || ' dans un pool ' || cp.variability::text
FROM cost_posts p
JOIN cost_pools cp ON cp.id = p.cost_pool_id
WHERE p.variability::text <> cp.variability::text

UNION ALL
-- 18. Assiette d'absorption divergente de la prévision budgétée.
--     L'assiette est DÉRIVÉE de la prévision depuis 34_budget_indirect_derive :
--     tout écart signale soit une écriture ayant contourné le déclencheur, soit
--     un recalcul qui a échoué, soit des prévisions aux unités mêlées — auquel
--     cas la fonction rend un volume nul plutôt que d'additionner des litres et
--     des tonnes. Dans les trois cas la charge au litre est calée sur un volume
--     que plus personne n'attend, et le seuil de marge avec elle.
SELECT
  'Assiette d''absorption divergente de la prévision budgétée',
  'absorption_rates',
  cp.code || ' · exercice ' || f.year::text,
  'assiette ' || round(ar.budgeted_base, 2) || ' contre ' ||
    CASE
      WHEN a.unites > 1 THEN 'des prévisions en ' || a.uom || ' — unités mêlées'
      WHEN a.volume IS NULL THEN 'aucune prévision budgétée sur ses segments'
      ELSE round(a.volume, 2)::text
    END
FROM absorption_rates ar
JOIN cost_pools cp ON cp.id = ar.cost_pool_id
JOIN fiscal_years f ON f.id = ar.fiscal_year_id
CROSS JOIN LATERAL assiette_absorption(ar.cost_pool_id, ar.fiscal_year_id) a
WHERE ar.is_current
  AND ar.budgeted_base IS DISTINCT FROM a.volume;

COMMENT ON VIEW v_invariant_breaches IS
  'Enregistrements passés au travers d''un invariant, ou antérieurs à lui (§ 11). Doit rester vide — toute ligne est une anomalie à traiter. COUVRE DIX-HUIT RÈGLES : tout verrou ajouté sans clause ici ne protège que l''avenir.';
