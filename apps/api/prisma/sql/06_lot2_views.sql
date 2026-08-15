-- ===========================================================================
--  VUES DE PILOTAGE ET DE CONTRÔLE — LOT 2
--  Réf. SPECIFICATIONS.md § 5.4, § 9.1, § 14.6
--
--  Les seuils empêchent de vendre trop bas. Ils n'empêchent PAS de se placer
--  juste au-dessus. Ces vues servent l'autre menace : le détournement de
--  valeur par ajustement des prix.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Bande de surveillance au-dessus du seuil minimum
--
--  Une affaire à 31 FCFA n'est pas anormale. Un commercial dont TOUTES les
--  affaires atterrissent entre 30 et 35 l'est. Cette vue fait apparaître le
--  motif, pas le cas isolé.
--
--  ⚠️ La bande se mesure au-dessus du SEUIL MINIMUM, pas du plancher direct :
--     c'est le seuil qu'un vendeur chercherait à effleurer pour éviter de
--     passer devant le DG.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_margin_band_watch AS
-- ⚠️ CE CTE EST EN `CROSS JOIN` PLUS BAS : S'IL NE REND AUCUNE LIGNE, LA VUE
--    ENTIÈRE EST VIDE.
--
--    Écrit `SELECT COALESCE(…, 15) FROM system_settings WHERE key = '…'`, il ne
--    protégeait que d'une valeur vide. Paramètre SUPPRIMÉ — et il l'est depuis
--    l'écran d'administration — le CTE rend zéro ligne, le CROSS JOIN annule
--    tout, et la surveillance des marges affiche « rien à signaler ». Vérifié
--    en base : 2 affaires dans la bande avant suppression, 0 après.
--
--    Une vide qui dit « rien » et une vue aveugle qui dit « rien » se
--    ressemblent trop pour qu'on accepte l'ambiguïté ici.
--
--    Sans `FROM`, le SELECT rend toujours exactement une ligne.
WITH band AS (
    SELECT COALESCE(
      (SELECT NULLIF(value, '')::numeric FROM system_settings WHERE key = 'MARGIN_BAND_ALERT_PCT'),
      15
    ) AS pct
),
thresholds AS (
    SELECT DISTINCT ON (segment, currency_code, uom)
           segment, minimum_margin, direct_floor, uom, currency_code
      FROM margin_thresholds
     WHERE product_id IS NULL
       AND is_active
       AND effective_from <= CURRENT_DATE
       AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
     ORDER BY segment, currency_code, uom, effective_from DESC
)
SELECT
    d.id                              AS deal_id,
    d.reference,
    d.segment,
    d.status,
    p.legal_name                      AS client,
    u.id                              AS owner_id,
    u.full_name                       AS owner,
    d.estimated_full_margin,
    t.minimum_margin,
    t.direct_floor,
    t.currency_code,
    t.uom,
    round(d.estimated_full_margin - t.minimum_margin, 4) AS above_threshold,
    round((d.estimated_full_margin - t.minimum_margin) / NULLIF(t.minimum_margin, 0) * 100, 2)
                                      AS above_threshold_pct,
    d.credit_approved_at,
    d.created_at
  FROM deals d
  JOIN thresholds t ON t.segment = d.segment
                   AND t.currency_code = d.currency_code
                   AND t.uom = d.uom
  JOIN partners   p ON p.id = d.client_id
  LEFT JOIN users u ON u.id = d.owner_id
  CROSS JOIN band b
 WHERE d.status::text NOT IN ('DRAFT', 'CANCELLED', 'REJECTED_BY_CLIENT')
   AND d.estimated_full_margin >= t.minimum_margin
   AND d.estimated_full_margin <= t.minimum_margin * (1 + b.pct / 100);

COMMENT ON VIEW v_margin_band_watch IS
  'Affaires dont la marge atterrit dans une bande étroite au-dessus du seuil minimum — SPECIFICATIONS.md § 5.4. Sert à détecter un ajustement systématique des prix, pas à bloquer une affaire.';


-- ---------------------------------------------------------------------------
--  Concentration par vendeur — c'est le motif qui alerte, pas le cas isolé.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_margin_band_by_owner AS
SELECT
    w.owner_id,
    w.owner,
    count(*)                                   AS deals_in_band,
    (SELECT count(*) FROM deals d2
      WHERE d2.owner_id = w.owner_id
        AND d2.status::text NOT IN ('DRAFT', 'CANCELLED', 'REJECTED_BY_CLIENT'))
                                               AS deals_total,
    round(100.0 * count(*) / NULLIF((SELECT count(*) FROM deals d3
      WHERE d3.owner_id = w.owner_id
        AND d3.status::text NOT IN ('DRAFT', 'CANCELLED', 'REJECTED_BY_CLIENT')), 0), 1)
                                               AS band_share_pct,
    round(avg(w.above_threshold_pct), 2)       AS avg_above_threshold_pct
  FROM v_margin_band_watch w
 GROUP BY w.owner_id, w.owner
 ORDER BY band_share_pct DESC NULLS LAST;

COMMENT ON VIEW v_margin_band_by_owner IS
  'Part des affaires atterrissant dans la bande de surveillance, par commercial. Une concentration élevée est le signal à examiner.';


-- ---------------------------------------------------------------------------
--  Écart entre marge approuvée et marge réalisée  (§ 5.4)
--
--  Un écart significatif remonte, dans les DEUX sens : une marge
--  systématiquement meilleure que prévu est aussi un signal.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_margin_variance AS
SELECT
    d.id           AS deal_id,
    d.reference,
    d.segment,
    p.legal_name   AS client,
    u.full_name    AS owner,
    d.estimated_full_margin,
    d.realized_full_margin,
    round(d.realized_full_margin - d.estimated_full_margin, 4) AS variance,
    round((d.realized_full_margin - d.estimated_full_margin)
          / NULLIF(abs(d.estimated_full_margin), 0) * 100, 2)  AS variance_pct,
    d.closed_at
  FROM deals d
  JOIN partners p ON p.id = d.client_id
  LEFT JOIN users u ON u.id = d.owner_id
 WHERE d.realized_full_margin IS NOT NULL
 ORDER BY abs(d.realized_full_margin - d.estimated_full_margin) DESC;

COMMENT ON VIEW v_margin_variance IS
  'Écart entre marge approuvée et marge réalisée — SPECIFICATIONS.md § 5.4. Un écart notable dans un sens comme dans l''autre appelle un examen.';


-- ---------------------------------------------------------------------------
--  Rapprochement du coût enregistré avec l'argent réellement sorti  (§ 14.6)
--
--  Le contrôle le plus solide : il ne repose pas sur une déclaration mais sur
--  un flux bancaire. Un coût enregistré sans facture fournisseur en face, ou
--  divergent du montant payé, ressort ici.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_cost_reconciliation AS
WITH recorded AS (
    SELECT o.deal_id,
           COALESCE(SUM(cl.actual_amount * cl.fx_rate_to_pivot), 0) AS recorded_pivot,
           COALESCE(SUM(CASE WHEN cl.supplier_invoice_id IS NULL
                             THEN cl.actual_amount * cl.fx_rate_to_pivot ELSE 0 END), 0)
                                                                    AS unsupported_pivot
      FROM operation_cost_lines cl
      JOIN operations o ON o.id = cl.operation_id
     WHERE cl.actual_amount IS NOT NULL
     GROUP BY o.deal_id
),
billed AS (
    SELECT si.deal_id,
           COALESCE(SUM(si.amount_pivot), 0)      AS supplier_billed_pivot,
           COALESCE(SUM(si.paid_amount_pivot), 0) AS supplier_paid_pivot,
           COALESCE(SUM(si.prepaid_amount_pivot), 0) AS prepaid_pivot
      FROM supplier_invoices si
     WHERE si.deal_id IS NOT NULL
       AND si.status::text <> 'CANCELLED'
     GROUP BY si.deal_id
)
SELECT
    d.id         AS deal_id,
    d.reference,
    d.status,
    p.legal_name AS client,
    COALESCE(r.recorded_pivot, 0)      AS recorded_cost_pivot,
    COALESCE(b.supplier_billed_pivot, 0) AS supplier_billed_pivot,
    COALESCE(b.supplier_paid_pivot, 0)   AS supplier_paid_pivot,
    COALESCE(b.prepaid_pivot, 0)         AS prepaid_pivot,
    round(COALESCE(r.recorded_pivot, 0) - COALESCE(b.supplier_billed_pivot, 0), 4)
                                         AS unreconciled_pivot,
    COALESCE(r.unsupported_pivot, 0)     AS cost_without_invoice_pivot
  FROM deals d
  JOIN partners p ON p.id = d.client_id
  LEFT JOIN recorded r ON r.deal_id = d.id
  LEFT JOIN billed   b ON b.deal_id = d.id
 WHERE d.status::text NOT IN ('DRAFT', 'CANCELLED');

COMMENT ON VIEW v_cost_reconciliation IS
  'Rapprochement entre coûts enregistrés et factures fournisseurs du dossier — SPECIFICATIONS.md § 14.6. Fait ressortir les coûts sans pièce justificative.';


-- ---------------------------------------------------------------------------
--  En-cours crédit — réécrit sur la hiérarchie du lot 2  (§ 9.1)
--
--  En-cours = créances nées + engagements non facturés − garanties actives.
--  Source UNIQUE du contrôle crédit : le Module 2 la lit, il ne recalcule rien.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_partner_credit_exposure AS
WITH receivables AS (
    SELECT i.partner_id,
           COALESCE(SUM(
             CASE WHEN i.type::text = 'CREDIT_NOTE'
                  THEN -(i.total_amount_pivot - i.paid_amount_pivot)
                  ELSE  (i.total_amount_pivot - i.paid_amount_pivot)
             END), 0) AS amount
      FROM invoices i
     WHERE i.type::text   IN ('SIMPLE', 'FNE', 'CREDIT_NOTE')
       AND i.status::text IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'DISPUTED')
     GROUP BY i.partner_id
),
invoiced_per_deal AS (
    SELECT i.deal_id, COALESCE(SUM(i.total_amount_pivot), 0) AS invoiced_pivot
      FROM invoices i
     WHERE i.type::text   IN ('SIMPLE', 'FNE')
       AND i.status::text NOT IN ('CANCELLED', 'DRAFT')
     GROUP BY i.deal_id
),
commitments AS (
    -- Engagement dès qu'une opération existe : le deal est approuvé et
    -- l'exécution lancée. On retranche le déjà-facturé pour ne rien compter
    -- deux fois.
    SELECT d.client_id AS partner_id,
           COALESCE(SUM(GREATEST(0, d.sale_amount_pivot - COALESCE(f.invoiced_pivot, 0))), 0) AS amount
      FROM deals d
      LEFT JOIN invoiced_per_deal f ON f.deal_id = d.id
     WHERE d.status::text IN ('IN_EXECUTION', 'DELIVERED', 'PARTIALLY_DELIVERED', 'QUALITY_CLAIM')
     GROUP BY d.client_id
),
covers AS (
    SELECT g.partner_id, COALESCE(SUM(g.amount_pivot), 0) AS amount
      FROM guarantees g
     WHERE g.status::text = 'ACTIVE'
       AND (g.expiry_date IS NULL OR g.expiry_date >= CURRENT_DATE)
     GROUP BY g.partner_id
)
SELECT
    p.id           AS partner_id,
    p.code         AS partner_code,
    p.legal_name   AS partner_name,
    p.credit_status,
    p.credit_limit AS credit_limit_pivot,
    COALESCE(r.amount, 0) AS receivables_pivot,
    COALESCE(c.amount, 0) AS commitments_pivot,
    COALESCE(g.amount, 0) AS guarantees_pivot,
    GREATEST(0, COALESCE(r.amount, 0) + COALESCE(c.amount, 0) - COALESCE(g.amount, 0))
                          AS exposure_pivot,
    p.credit_limit - GREATEST(0, COALESCE(r.amount, 0) + COALESCE(c.amount, 0) - COALESCE(g.amount, 0))
                          AS available_credit_pivot,
    CASE WHEN p.credit_limit > 0
         THEN round(GREATEST(0, COALESCE(r.amount, 0) + COALESCE(c.amount, 0) - COALESCE(g.amount, 0))
                    / p.credit_limit * 100, 2)
         ELSE NULL END    AS utilisation_pct
  FROM partners p
  LEFT JOIN receivables r ON r.partner_id = p.id
  LEFT JOIN commitments c ON c.partner_id = p.id
  LEFT JOIN covers      g ON g.partner_id = p.id
 WHERE p.type::text = 'CLIENT';

COMMENT ON VIEW v_partner_credit_exposure IS
  'En-cours crédit par client — SPECIFICATIONS.md § 9.1. Source unique du contrôle crédit. Montants en devise pivot.';
