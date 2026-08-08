-- ===========================================================================
--  REPRISE DES DONNÉES ANTÉRIEURES AUX INVARIANTS
--  Réf. SPECIFICATIONS.md § 11
--
--  ⚠️ CLASSE DE DÉFAUT RENCONTRÉE TROIS FOIS. Un trigger ne s'applique qu'aux
--     écritures POSTÉRIEURES à sa création. Les lignes déjà en base, elles,
--     ne sont jamais confrontées à la règle qu'on vient d'écrire.
--
--     Le système se croit alors protégé, et il l'est — pour tout ce qui
--     arrivera. Ce qui est déjà là échappe au contrôle en silence, et c'est
--     précisément ce qu'un audit ira chercher.
--
--  Ce fichier CONFRONTE l'existant aux invariants et corrige ce qui peut
--  l'être. Il est idempotent : sur une base conforme, il ne fait rien.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Prix fournisseurs validés par un rôle qui n'en a pas le droit.
--
--  La règle — « la validation d'un prix fournisseur est réservée au DG » —
--  est la clé de voûte du dispositif anti-détournement : elle garantit que le
--  coût d'achat sur lequel se calcule toute marge a été arbitré par une seule
--  autorité. Des lignes validées par un autre rôle rendent cette garantie
--  fausse pour les affaires qui s'y adossent.
--
--  ON NE RÉÉCRIT PAS L'HISTOIRE en réattribuant la validation au DG : ce
--  serait affirmer qu'il a validé ce qu'il n'a pas vu. On RETIRE la
--  validation. Le prix redevient un projet, et les affaires qui s'y adossent
--  ne pourront plus être approuvées tant que le DG n'a pas tranché — ce qui
--  est exactement le comportement attendu.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  touched int;
BEGIN
  UPDATE supplier_prices sp
     SET validated_by_id = NULL,
         validated_at = NULL
    FROM users u
   WHERE u.id = sp.validated_by_id
     AND u.role::text <> 'DG';

  GET DIAGNOSTICS touched = ROW_COUNT;
  IF touched > 0 THEN
    RAISE NOTICE
      'Reprise : % prix fournisseur(s) portaient une validation d''un rôle non habilité. Validation retirée — le DG doit se prononcer.',
      touched;
  END IF;
END $$;


-- ---------------------------------------------------------------------------
--  2. Affaires approuvées sans prix d'achat sourcé.
--
--  Elles datent d'avant que la tolérance accordée au brouillon ne se referme à
--  l'approbation. Leur marge affichée valait le prix de vente entier — 765
--  FCFA/L au lieu de 55 — et elles ont franchi tous les seuils sur ce chiffre.
--
--  On RETIRE l'approbation. Elle a été donnée sur une fiction ; la maintenir
--  reviendrait à valider rétroactivement ce que l'invariant refuse désormais.
--  L'affaire retourne au contrôle du risque, où elle devra être sourcée.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  touched int;
BEGIN
  UPDATE deals
     SET credit_approved_by_id = NULL,
         credit_approved_at = NULL,
         status = CASE WHEN status::text IN ('APPROVED', 'PENDING_DG_APPROVAL')
                       THEN 'PENDING_RISK'::deal_status ELSE status END
   WHERE credit_approved_by_id IS NOT NULL
     AND (supplier_price_id IS NULL OR unit_purchase_price = 0);

  GET DIAGNOSTICS touched = ROW_COUNT;
  IF touched > 0 THEN
    RAISE NOTICE
      'Reprise : % affaire(s) approuvée(s) sans prix d''achat. Approbation retirée — la marge affichée valait le prix de vente entier.',
      touched;
  END IF;
END $$;


-- ---------------------------------------------------------------------------
--  3. Vérification permanente : la conformité de l'existant devient lisible.
--
--  Une reprise ponctuelle ne protège que du passé connu. Cette vue rend
--  l'écart visible en permanence, y compris pour les invariants qu'on
--  ajoutera demain.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_invariant_breaches AS
SELECT
  'Prix fournisseur validé par un rôle non habilité'::text AS regle,
  'supplier_prices'::text                                  AS relation,
  sp.id::text                                              AS enregistrement,
  COALESCE(u.role::text, 'inconnu')                        AS detail
FROM supplier_prices sp
JOIN users u ON u.id = sp.validated_by_id
WHERE u.role::text <> 'DG'

UNION ALL

SELECT
  'Affaire approuvée sans prix d''achat sourcé',
  'deals',
  d.reference,
  'approuvée le ' || COALESCE(d.credit_approved_at::date::text, '?')
FROM deals d
WHERE d.credit_approved_by_id IS NOT NULL
  AND (d.supplier_price_id IS NULL OR d.unit_purchase_price = 0)

UNION ALL

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

SELECT
  'Avance apurée sans contrepartie constatée',
  'supplier_invoices',
  si.reference,
  'apurée le ' || si.settled_at::text
FROM supplier_invoices si
WHERE si.settled_at IS NOT NULL
  AND si.settled_amount < si.prepaid_amount - 0.01;

COMMENT ON VIEW v_invariant_breaches IS
  'Enregistrements antérieurs à un invariant, ou passés au travers. Doit rester vide — toute ligne est une anomalie à traiter (§ 11).';
