-- ===========================================================================
--  BARÈME DE COÛTS ET ÉCARTS AU CHIFFRAGE
--  Réf. SPECIFICATIONS.md § 5.4
--
--  Principe arrêté avec la direction le 3 août 2026 :
--
--    « Les coûts sont sélectionnés, leur valeur individuelle saisie — si elle
--      diffère sur le moment de la valeur pré-paramétrée — le cumul est fait
--      par le système et ramené au litre vendu. »
--
--  Sans valeur de référence, il n'y a RIEN DONT S'ÉCARTER : un transport
--  chiffré à 45 FCFA/L au lieu de 30 ne se voit pas. C'est l'écart au barème
--  qui porte le signal, jamais le montant seul.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Reprise : les lignes de coût antérieures à la base de saisie.
--
--  Elles portaient un montant TOTAL sans dire s'il était unitaire ou
--  forfaitaire. Le forfait est la lecture fidèle : le montant valait pour
--  l'affaire entière. Idempotent — seules les lignes non renseignées bougent.
-- ---------------------------------------------------------------------------
UPDATE deal_cost_lines
   SET input_amount = estimated_amount
 WHERE input_amount = 0 AND estimated_amount <> 0;


-- ---------------------------------------------------------------------------
--  Cohérence de la ligne de coût.
-- ---------------------------------------------------------------------------
ALTER TABLE deal_cost_lines
  DROP CONSTRAINT IF EXISTS chk_deal_cost_line_positive,
  ADD  CONSTRAINT chk_deal_cost_line_positive
       CHECK (input_amount >= 0 AND estimated_amount >= 0),

  -- Un écart au barème sans motif est indistinguable d'une faute de frappe.
  --
  -- La tolérance retenue est celle FIGÉE AU CHIFFRAGE, pas celle du jour : un
  -- barème assoupli ensuite ne doit pas absoudre rétroactivement un écart qui
  -- exigeait alors une justification.
  --
  -- Par défaut elle vaut ZÉRO : conserver la valeur proposée ou la justifier,
  -- il n'y a pas de troisième voie.
  DROP CONSTRAINT IF EXISTS chk_deal_cost_line_variance_justified,
  ADD  CONSTRAINT chk_deal_cost_line_variance_justified
       CHECK (
         standard_amount IS NULL
         OR standard_amount = 0
         OR abs(estimated_amount - standard_amount)
            <= standard_amount * (COALESCE(standard_tolerance_pct, 0) / 100 + 0.0001)
         OR (variance_reason IS NOT NULL AND length(trim(variance_reason)) >= 5)
       );

COMMENT ON COLUMN deal_cost_lines.input_amount IS
  'Ce que le commercial a tapé, dans la base choisie (au litre ou forfait). Conservé tel quel pour lui être réaffiché.';
COMMENT ON COLUMN deal_cost_lines.estimated_amount IS
  'Montant TOTAL pour l''affaire, dérivé de la base de saisie. C''est lui que la chaîne de marge additionne.';


-- ---------------------------------------------------------------------------
--  Barème : cohérence de la base et des bornes.
-- ---------------------------------------------------------------------------
ALTER TABLE cost_standards
  DROP CONSTRAINT IF EXISTS chk_cost_standard_amount,
  ADD  CONSTRAINT chk_cost_standard_amount CHECK (amount >= 0),

  -- Une valeur AU LITRE sans unité de référence n'est pas interprétable.
  DROP CONSTRAINT IF EXISTS chk_cost_standard_unit_requires_uom,
  ADD  CONSTRAINT chk_cost_standard_unit_requires_uom
       CHECK (basis::text <> 'PER_UNIT' OR uom IS NOT NULL),

  DROP CONSTRAINT IF EXISTS chk_cost_standard_tolerance_range,
  ADD  CONSTRAINT chk_cost_standard_tolerance_range
       CHECK (tolerance_pct IS NULL OR (tolerance_pct >= 0 AND tolerance_pct <= 100)),

  DROP CONSTRAINT IF EXISTS chk_cost_standard_period,
  ADD  CONSTRAINT chk_cost_standard_period
       CHECK (effective_to IS NULL OR effective_to >= effective_from);


-- ---------------------------------------------------------------------------
--  Résolution du barème applicable — du plus spécifique au plus général.
--
--  Produit (4) > mode de transport (2) > segment (1). Un barème sans contexte
--  déclaré sert de filet : il s'applique quand rien de plus précis n'existe,
--  et n'empêche jamais une ligne dédiée de primer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_cost_standard(
  p_cost_post_id uuid,
  p_segment text,
  p_transport_mode text,
  p_product_id uuid,
  p_on date
)
RETURNS TABLE (
  standard_id uuid,
  basis text,
  amount numeric,
  currency_code char(3),
  uom text,
  tolerance_pct numeric
) AS $$
  SELECT cs.id, cs.basis::text, cs.amount, cs.currency_code, cs.uom::text, cs.tolerance_pct
    FROM cost_standards cs
   WHERE cs.cost_post_id = p_cost_post_id
     AND cs.effective_from <= p_on
     AND (cs.effective_to IS NULL OR cs.effective_to >= p_on)
     AND (cs.segment IS NULL OR cs.segment::text = p_segment)
     AND (cs.transport_mode IS NULL OR cs.transport_mode::text = p_transport_mode)
     AND (cs.product_id IS NULL OR cs.product_id = p_product_id)
   ORDER BY
     (CASE WHEN cs.product_id IS NOT NULL THEN 4 ELSE 0 END
    + CASE WHEN cs.transport_mode IS NOT NULL THEN 2 ELSE 0 END
    + CASE WHEN cs.segment IS NOT NULL THEN 1 ELSE 0 END) DESC,
     cs.effective_from DESC
   LIMIT 1;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION resolve_cost_standard IS
  'Barème applicable à un poste dans un contexte donné. Du plus spécifique au plus général — SPECIFICATIONS.md § 5.4.';


-- ---------------------------------------------------------------------------
--  PRIX D'ACHAT : bande de tolérance, arbitrage du DG au-delà.
--
--  Décision du 3 août 2026. Le prix d'achat reste ADOSSÉ à une ligne
--  fournisseur validée par le DG, mais peut s'en écarter dans une bande
--  paramétrable — les conditions du jour ne sont pas celles du barème.
--
--  ⚠️ LES DEUX SENS SONT DANGEREUX, pour des raisons opposées :
--
--     gonflé  → la marge affichée baisse, mais si elle reste au-dessus du
--               seuil personne ne bronche. Le surcoût part chez un
--               fournisseur complaisant et revient. C'est le vecteur classique.
--
--     minoré  → la marge est flattée, l'approbation est obtenue à tort. La
--               réalité rattrape à l'exécution, quand la facture arrive.
--
--  D'où : bande symétrique, motif obligatoire dès qu'on en sort, et
--  dérogation du DG pour approuver au-delà.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION purchase_price_band_pct()
RETURNS numeric AS $$
  SELECT COALESCE(
    NULLIF((SELECT value FROM system_settings WHERE key = 'PURCHASE_PRICE_BAND_PCT'), '')::numeric,
    3
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION enforce_purchase_price_band()
RETURNS TRIGGER AS $$
DECLARE
  sp_price numeric;
  band numeric;
  ecart numeric;
  derog_type text;
BEGIN
  IF NEW.supplier_price_id IS NULL THEN
    RETURN NEW; -- l'absence de prix est traitée par l'invariant de sourçage
  END IF;

  SELECT unit_price INTO sp_price FROM supplier_prices WHERE id = NEW.supplier_price_id;
  IF sp_price IS NULL OR sp_price = 0 THEN
    RETURN NEW;
  END IF;

  band := purchase_price_band_pct();
  ecart := abs(NEW.unit_purchase_price - sp_price) / sp_price * 100;

  IF ecart <= band THEN
    RETURN NEW;
  END IF;

  -- Hors bande : un motif est exigé, quel que soit l'état de l'affaire.
  IF NEW.purchase_price_variance_reason IS NULL
     OR length(trim(NEW.purchase_price_variance_reason)) < 10 THEN
    RAISE EXCEPTION
      'Prix d''achat du deal % : écart de % pour cent avec le prix fournisseur validé (% contre %), au-delà de la bande de % pour cent. Un motif circonstancié est exigé.',
      NEW.reference, round(ecart, 2), NEW.unit_purchase_price, sp_price, band
      USING ERRCODE = 'check_violation';
  END IF;

  -- Et l'approbation exige l'arbitrage du DG.
  IF NEW.credit_approved_by_id IS NOT NULL THEN
    IF NEW.purchase_price_derogation_id IS NULL THEN
      RAISE EXCEPTION
        'Prix d''achat du deal % hors bande : écart de % pour cent, tolérance de % pour cent. L''approbation exige une dérogation du DG.',
        NEW.reference, round(ecart, 2), band
        USING ERRCODE = 'check_violation';
    END IF;

    -- Opposabilité, et non plus seulement le type : révoquée, expirée ou
    -- accordée pour une autre affaire, elle n'ouvre pas la bande.
    IF NOT derogation_opposable(
             NEW.purchase_price_derogation_id, 'PURCHASE_PRICE_VARIANCE', NEW.reference) THEN
      RAISE EXCEPTION
        'Prix d''achat du deal % hors bande : %.',
        NEW.reference,
        derogation_motif_refus(
          NEW.purchase_price_derogation_id, 'PURCHASE_PRICE_VARIANCE', NEW.reference)
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_purchase_price_band ON deals;
CREATE TRIGGER trg_purchase_price_band
  BEFORE INSERT OR UPDATE OF unit_purchase_price, supplier_price_id,
                             purchase_price_variance_reason,
                             purchase_price_derogation_id,
                             credit_approved_by_id ON deals
  FOR EACH ROW EXECUTE FUNCTION enforce_purchase_price_band();


-- ---------------------------------------------------------------------------
--  Surveillance : les écarts au barème et au prix fournisseur, par commercial.
--
--  Un écart isolé est banal. Un commercial dont la moitié des lignes s'écarte
--  du barème ne l'est pas — et c'est le motif, pas le cas, qui alerte.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_quotation_variance AS
SELECT
  d.reference,
  d.status::text                                   AS status,
  p.legal_name                                     AS client,
  u.full_name                                      AS owner,
  cp.code                                          AS cost_post,
  l.standard_amount,
  l.estimated_amount,
  (l.estimated_amount - l.standard_amount)         AS variance,
  CASE WHEN l.standard_amount > 0
       THEN round((l.estimated_amount - l.standard_amount) / l.standard_amount * 100, 2)
  END                                              AS variance_pct,
  l.variance_reason,
  d.created_at
FROM deal_cost_lines l
JOIN deals d    ON d.id = l.deal_id
JOIN partners p ON p.id = d.client_id
LEFT JOIN users u ON u.id = d.owner_id
JOIN cost_posts cp ON cp.id = l.cost_post_id
WHERE l.standard_amount IS NOT NULL
  AND l.standard_amount > 0
  AND abs(l.estimated_amount - l.standard_amount) > l.standard_amount * 0.0001
ORDER BY abs(l.estimated_amount - l.standard_amount) / NULLIF(l.standard_amount, 0) DESC;

COMMENT ON VIEW v_quotation_variance IS
  'Écarts entre le chiffrage retenu et le barème (§ 5.4). Le motif alerte, pas le cas isolé.';
