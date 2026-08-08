-- AlterTable
ALTER TABLE "supplier_prices" DROP COLUMN "discount_pct";



-- @erp:business-sql-injected
-- ===========================================================================
--  SQL MÉTIER — injecté par scripts/prepare-migrations.mjs
--
--  NE PAS DÉPLACER hors de ce fichier : il doit faire partie de l'historique
--  de migration, faute de quoi Prisma détectera une dérive de schéma et
--  proposera une réinitialisation de la base.
--
--  Source : prisma/sql/ — modifier là-bas, puis regénérer une migration.
-- ===========================================================================


-- ─── 01_business_constraints.sql ─────────────────────────────────

-- ===========================================================================
--  INVARIANTS — LOT 1 : SOCLE & RÉFÉRENTIELS
--  Réf. SPECIFICATIONS.md § 5.4, § 6.4, § 8.3, § 9.2, § 11, § 14.2
--
--  Ce fichier porte les règles au seul endroit qu'aucun bug applicatif,
--  aucun script d'administration et aucune refonte future de l'API ne peut
--  contourner : le moteur PostgreSQL.
--
--  Il est injecté DANS la migration Prisma par scripts/prepare-migrations.mjs.
--  Ne jamais l'appliquer « à côté » : Prisma détecterait une dérive de schéma.
--
--  Les invariants transactionnels (verrou finance, verrou HSE, facture sur
--  relevé faisant autorité) arrivent au lot 2 avec les entités Deal et
--  Opération.
--
--  Idempotent — pas de BEGIN/COMMIT : la migration fournit sa transaction.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  A. RÉFÉRENTIEL MONÉTAIRE  (§ 9.2)
-- ---------------------------------------------------------------------------

ALTER TABLE currencies
  DROP CONSTRAINT IF EXISTS chk_currencies_decimals_range,
  ADD  CONSTRAINT chk_currencies_decimals_range
       CHECK (decimal_places BETWEEN 0 AND 4),

  DROP CONSTRAINT IF EXISTS chk_currencies_peg_consistency,
  ADD  CONSTRAINT chk_currencies_peg_consistency
       CHECK (
         (peg_currency_code IS NULL AND peg_rate IS NULL)
         OR (peg_currency_code IS NOT NULL AND peg_rate IS NOT NULL AND peg_rate > 0)
       ),

  DROP CONSTRAINT IF EXISTS chk_currencies_no_self_peg,
  ADD  CONSTRAINT chk_currencies_no_self_peg
       CHECK (peg_currency_code IS NULL OR peg_currency_code <> code),

  DROP CONSTRAINT IF EXISTS chk_currencies_active_period,
  ADD  CONSTRAINT chk_currencies_active_period
       CHECK (active_to IS NULL OR active_from IS NULL OR active_to >= active_from);

-- Une seule devise pivot, une seule devise fonctionnelle. Deux pivots
-- rendraient le risque et la marge consolidée incomparables.
DROP INDEX IF EXISTS uq_currencies_single_pivot;
CREATE UNIQUE INDEX uq_currencies_single_pivot
  ON currencies ((true)) WHERE is_pivot;

DROP INDEX IF EXISTS uq_currencies_single_functional;
CREATE UNIQUE INDEX uq_currencies_single_functional
  ON currencies ((true)) WHERE is_functional;

COMMENT ON COLUMN currencies.decimal_places IS
  'Décimales de restitution. XOF = 0 : tout montant imprimé en francs CFA est un entier.';

ALTER TABLE fx_rates
  DROP CONSTRAINT IF EXISTS chk_fx_rates_positive,
  ADD  CONSTRAINT chk_fx_rates_positive
       CHECK (rate > 0),

  DROP CONSTRAINT IF EXISTS chk_fx_rates_distinct_currencies,
  ADD  CONSTRAINT chk_fx_rates_distinct_currencies
       CHECK (base_currency_code <> quote_currency_code),

  DROP CONSTRAINT IF EXISTS chk_fx_rates_period_valid,
  ADD  CONSTRAINT chk_fx_rates_period_valid
       CHECK (effective_to IS NULL OR effective_to >= effective_from);

-- Une parité fixe réglementaire (XOF/EUR = 655,957) ne se saisit pas à la main.
CREATE OR REPLACE FUNCTION enforce_pegged_fx_rate()
RETURNS TRIGGER AS $$
DECLARE
  declared_peg      char(3);
  declared_peg_rate numeric;
BEGIN
  SELECT peg_currency_code, peg_rate INTO declared_peg, declared_peg_rate
    FROM currencies WHERE code = NEW.quote_currency_code;

  IF declared_peg IS NOT NULL AND declared_peg = NEW.base_currency_code THEN
    IF NEW.rate_type::text <> 'PEG' THEN
      RAISE EXCEPTION
        'La parité %/% est fixe et réglementaire (% = %). Type PEG obligatoire, reçu %.',
        NEW.base_currency_code, NEW.quote_currency_code,
        NEW.base_currency_code, declared_peg_rate, NEW.rate_type
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.rate <> declared_peg_rate THEN
      RAISE EXCEPTION
        'Taux de parité fixe incorrect pour %/% : attendu %, reçu %.',
        NEW.base_currency_code, NEW.quote_currency_code, declared_peg_rate, NEW.rate
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fx_rates_peg ON fx_rates;
CREATE TRIGGER trg_fx_rates_peg
  BEFORE INSERT OR UPDATE ON fx_rates
  FOR EACH ROW EXECUTE FUNCTION enforce_pegged_fx_rate();


-- ---------------------------------------------------------------------------
--  B. TIERS  (§ 6.1)
-- ---------------------------------------------------------------------------

ALTER TABLE partners
  DROP CONSTRAINT IF EXISTS chk_partners_credit_limit_positive,
  ADD  CONSTRAINT chk_partners_credit_limit_positive
       CHECK (credit_limit >= 0),

  -- Une exonération de TVA doit être justifiée par une référence opposable.
  DROP CONSTRAINT IF EXISTS chk_partners_vat_exemption_justified,
  ADD  CONSTRAINT chk_partners_vat_exemption_justified
       CHECK (
         NOT is_vat_exempt
         OR (vat_exemption_reference IS NOT NULL AND length(trim(vat_exemption_reference)) >= 3)
       ),

  -- Un client porte toujours un segment : il détermine la formule de prix
  -- par défaut et la grille de seuils applicable (§ 5.1).
  DROP CONSTRAINT IF EXISTS chk_partners_client_has_segment,
  ADD  CONSTRAINT chk_partners_client_has_segment
       CHECK (type::text <> 'CLIENT' OR segment IS NOT NULL),

  DROP CONSTRAINT IF EXISTS chk_partners_terms_range,
  ADD  CONSTRAINT chk_partners_terms_range
       CHECK (payment_terms_days >= 0 AND supplier_terms_days BETWEEN -365 AND 365);

COMMENT ON COLUMN partners.credit_limit IS
  'Exprimée en devise pivot. Ne jamais y stocker une devise locale : le contrôle crédit ne compare jamais deux devises.';

COMMENT ON COLUMN partners.supplier_terms_days IS
  'Négatif = prépaiement avant livraison. Cas courant chez Elyon (§ 14.6) : aucun flottant fournisseur n''amortit le cycle de trésorerie.';

ALTER TABLE partner_sites
  DROP CONSTRAINT IF EXISTS chk_partner_sites_coordinates,
  ADD  CONSTRAINT chk_partner_sites_coordinates
       CHECK (
         (latitude IS NULL AND longitude IS NULL)
         OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
       );


-- ---------------------------------------------------------------------------
--  C. PRODUITS  (§ 6.2)
-- ---------------------------------------------------------------------------

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS chk_products_density_range,
  ADD  CONSTRAINT chk_products_density_range
       CHECK (reference_density_15 > 0.4 AND reference_density_15 < 1.2);

-- ---------------------------------------------------------------------------
--  D. POSTES DE COÛTS, ABSORPTION ET SEUILS  (§ 5.4, § 6.5, § 14.2)
-- ---------------------------------------------------------------------------

-- Un poste indirect suppose un regroupement d'absorption ET une assiette ;
-- un poste direct n'en a pas. Sans cela, le coût complet n'est pas calculable.
ALTER TABLE cost_posts
  DROP CONSTRAINT IF EXISTS chk_cost_posts_allocation_coherence,
  ADD  CONSTRAINT chk_cost_posts_allocation_coherence
       CHECK (
         (nature::text = 'DIRECT'   AND cost_pool_id IS NULL     AND allocation_basis IS NULL)
         OR
         (nature::text = 'INDIRECT' AND cost_pool_id IS NOT NULL AND allocation_basis IS NOT NULL)
       );

COMMENT ON COLUMN cost_posts.variability IS
  'Axe INDÉPENDANT de la nature. Une location de dépôt dédiée est directe et fixe ; une commission bancaire proportionnelle est indirecte et variable. Sans cet axe, le point mort (§ 14.5) n''est pas calculable.';

ALTER TABLE absorption_rates
  DROP CONSTRAINT IF EXISTS chk_absorption_positive,
  ADD  CONSTRAINT chk_absorption_positive
       CHECK (budgeted_amount >= 0 AND budgeted_base > 0 AND rate_per_unit >= 0),

  DROP CONSTRAINT IF EXISTS chk_absorption_year_range,
  ADD  CONSTRAINT chk_absorption_year_range
       CHECK (fiscal_year BETWEEN 2000 AND 2200),

  -- Le taux DOIT être le quotient du budget par l'assiette budgétée.
  -- Une saisie libre du taux ouvrirait la porte à un coût complet arbitraire.
  DROP CONSTRAINT IF EXISTS chk_absorption_rate_derived,
  ADD  CONSTRAINT chk_absorption_rate_derived
       CHECK (abs(rate_per_unit - round(budgeted_amount / budgeted_base, 6)) <= 0.000001);

-- Un seul taux courant par regroupement et par exercice.
DROP INDEX IF EXISTS uq_absorption_current_per_pool_year;
CREATE UNIQUE INDEX uq_absorption_current_per_pool_year
  ON absorption_rates (cost_pool_id, fiscal_year) WHERE is_current;

COMMENT ON COLUMN absorption_rates.budgeted_base IS
  'Assiette BUDGÉTÉE, jamais réalisée glissante (§ 14.2) : un dénominateur réalisé déclencherait la spirale d''absorption — moins de volume, charge unitaire plus élevée, davantage d''affaires bloquées, moins de volume encore.';

ALTER TABLE margin_thresholds
  DROP CONSTRAINT IF EXISTS chk_margin_thresholds_non_negative,
  ADD  CONSTRAINT chk_margin_thresholds_non_negative
       CHECK (
         (direct_floor   IS NULL OR direct_floor   >= 0) AND
         (minimum_margin IS NULL OR minimum_margin >= 0)
       ),

  -- Le plancher dur est nécessairement inférieur ou égal au seuil d'alerte :
  -- l'inverse rendrait la zone d'arbitrage du DG inexistante.
  DROP CONSTRAINT IF EXISTS chk_margin_thresholds_ordering,
  ADD  CONSTRAINT chk_margin_thresholds_ordering
       CHECK (
         direct_floor IS NULL OR minimum_margin IS NULL
         OR direct_floor <= minimum_margin
       ),

  DROP CONSTRAINT IF EXISTS chk_margin_thresholds_period,
  ADD  CONSTRAINT chk_margin_thresholds_period
       CHECK (effective_to IS NULL OR effective_to >= effective_from),

  DROP CONSTRAINT IF EXISTS chk_margin_thresholds_not_empty,
  ADD  CONSTRAINT chk_margin_thresholds_not_empty
       CHECK (direct_floor IS NOT NULL OR minimum_margin IS NOT NULL);

ALTER TABLE ullage_tolerances
  DROP CONSTRAINT IF EXISTS chk_ullage_thresholds_non_negative,
  ADD  CONSTRAINT chk_ullage_thresholds_non_negative
       CHECK (
         normal_threshold_pct   >= 0 AND
         alert_threshold_pct    >= 0 AND
         critical_threshold_pct >= 0 AND
         (absolute_franchise IS NULL OR absolute_franchise >= 0)
       ),

  -- Normal ≤ alerte ≤ critique. Un ordre inversé rendrait la grille
  -- silencieusement inopérante.
  DROP CONSTRAINT IF EXISTS chk_ullage_thresholds_ordering,
  ADD  CONSTRAINT chk_ullage_thresholds_ordering
       CHECK (normal_threshold_pct <= alert_threshold_pct
              AND alert_threshold_pct <= critical_threshold_pct),

  DROP CONSTRAINT IF EXISTS chk_ullage_period,
  ADD  CONSTRAINT chk_ullage_period
       CHECK (effective_to IS NULL OR effective_to >= effective_from);

COMMENT ON TABLE ullage_tolerances IS
  'Tolérances CONTRACTUELLES, non physiques (§ 8.3) : les contrats de transport en stipulent la franchise, les polices d''assurance le seuil indemnisable. Les normes ASTM et API définissent comment mesurer, pas combien de perte est acceptable.';


-- ---------------------------------------------------------------------------
--  E. TRANSPORT & CONFORMITÉ  (§ 6.4)
--
--  « Un sous-traitant, véhicule ou chauffeur non conforme ne devra pas être
--    affecté sans dérogation formalisée. » — dérogation réservée au DG.
--  L'interdiction d'affectation est portée au lot 2, avec l'Opération ;
--  ce lot pose la conformité elle-même.
-- ---------------------------------------------------------------------------

ALTER TABLE vehicles
  DROP CONSTRAINT IF EXISTS chk_vehicles_capacity_positive,
  ADD  CONSTRAINT chk_vehicles_capacity_positive
       CHECK (capacity > 0 AND (compartment_count IS NULL OR compartment_count > 0));

ALTER TABLE compliance_records
  -- Une pièce se rattache à EXACTEMENT un porteur.
  DROP CONSTRAINT IF EXISTS chk_compliance_single_owner,
  ADD  CONSTRAINT chk_compliance_single_owner
       CHECK (
         (partner_id IS NOT NULL)::int
       + (vehicle_id IS NOT NULL)::int
       + (driver_id  IS NOT NULL)::int = 1
       ),

  DROP CONSTRAINT IF EXISTS chk_compliance_dates,
  ADD  CONSTRAINT chk_compliance_dates
       CHECK (expiry_date IS NULL OR expiry_date >= issue_date);

-- Le statut d'une pièce se déduit de sa date d'expiration : il ne se saisit
-- pas. Une pièce expirée déclarée valide viderait le verrou de conformité.
CREATE OR REPLACE FUNCTION derive_compliance_status()
RETURNS TRIGGER AS $$
DECLARE
  notice_days int;
BEGIN
  IF NEW.status::text = 'SUSPENDED' THEN
    RETURN NEW; -- Suspension administrative : décision explicite, on la respecte.
  END IF;

  SELECT COALESCE(NULLIF(value, '')::int, 60) INTO notice_days
    FROM system_settings WHERE key = 'DOC_EXPIRY_ALERT_DAYS';
  notice_days := COALESCE(notice_days, 60);

  IF NEW.expiry_date IS NULL THEN
    NEW.status := 'VALID';
  ELSIF NEW.expiry_date < CURRENT_DATE THEN
    NEW.status := 'EXPIRED';
  ELSIF NEW.expiry_date <= CURRENT_DATE + notice_days THEN
    NEW.status := 'EXPIRING';
  ELSE
    NEW.status := 'VALID';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compliance_status ON compliance_records;
CREATE TRIGGER trg_compliance_status
  BEFORE INSERT OR UPDATE OF expiry_date, status ON compliance_records
  FOR EACH ROW EXECUTE FUNCTION derive_compliance_status();


-- ---------------------------------------------------------------------------
--  F. SUPPLÉANCE ET REGISTRE DES DÉROGATIONS  (§ 3.4, § 11.4)
-- ---------------------------------------------------------------------------

ALTER TABLE delegations
  -- Un suppléant et un seul : soit interne (le DG, suppléant de droit),
  -- soit un autre agent terrain.
  DROP CONSTRAINT IF EXISTS chk_delegation_single_delegate,
  ADD  CONSTRAINT chk_delegation_single_delegate
       CHECK (
         (delegate_user_id IS NOT NULL)::int
       + (delegate_field_user_id IS NOT NULL)::int = 1
       ),

  -- Une suppléance est temporaire par nature : elle a une fin.
  DROP CONSTRAINT IF EXISTS chk_delegation_period,
  ADD  CONSTRAINT chk_delegation_period
       CHECK (ends_at > starts_at),

  DROP CONSTRAINT IF EXISTS chk_delegation_reason,
  ADD  CONSTRAINT chk_delegation_reason
       CHECK (length(trim(reason)) >= 10);

ALTER TABLE derogations
  DROP CONSTRAINT IF EXISTS chk_derogation_reason,
  ADD  CONSTRAINT chk_derogation_reason
       CHECK (length(trim(reason)) >= 10),

  DROP CONSTRAINT IF EXISTS chk_derogation_period,
  ADD  CONSTRAINT chk_derogation_period
       CHECK (expires_at IS NULL OR expires_at > granted_at);

-- Qui peut déroger à quoi. Vérifié en base, pas seulement dans un guard :
-- c'est la garantie que réclamera un auditeur ou un assureur après incident.
CREATE OR REPLACE FUNCTION enforce_derogation_authority()
RETURNS TRIGGER AS $$
DECLARE
  authority_role text;
BEGIN
  SELECT role::text INTO authority_role FROM users WHERE id = NEW.authority_id;

  IF authority_role IS NULL THEN
    RAISE EXCEPTION 'Autorité de dérogation introuvable.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Réservées au DG exclusivement.
  IF NEW.type::text IN ('TRANSPORT_NON_COMPLIANCE', 'MARGIN_BELOW_DIRECT_FLOOR', 'HSE_DELEGATION')
     AND authority_role <> 'DG' THEN
    RAISE EXCEPTION
      'Dérogation de type % réservée au DG (§ 11.2). Rôle fourni : %.',
      NEW.type, authority_role
      USING ERRCODE = 'check_violation';
  END IF;

  -- Marge sous le seuil complet : DG, conformément au § 5.4.
  IF NEW.type::text = 'MARGIN_BELOW_THRESHOLD' AND authority_role <> 'DG' THEN
    RAISE EXCEPTION
      'L''accord sur une marge sous le seuil est réservé au DG. Rôle fourni : %.',
      authority_role
      USING ERRCODE = 'check_violation';
  END IF;

  -- Acquittement d'un écart de volume : CCOO, CFO ou DG (§ 8.3).
  IF NEW.type::text = 'ULLAGE_ACKNOWLEDGEMENT'
     AND authority_role NOT IN ('CCOO', 'FINANCE_CFO', 'DG') THEN
    RAISE EXCEPTION
      'L''acquittement d''un écart de volume est réservé au CCOO, au CFO ou au DG. Rôle fourni : %.',
      authority_role
      USING ERRCODE = 'check_violation';
  END IF;

  -- Le franchissement du plancher direct est exceptionnel : il passe
  -- obligatoirement en revue mensuelle (§ 5.4).
  IF NEW.type::text = 'MARGIN_BELOW_DIRECT_FLOOR' THEN
    NEW.requires_monthly_review := true;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_derogation_authority ON derogations;
CREATE TRIGGER trg_derogation_authority
  BEFORE INSERT OR UPDATE OF authority_id, type ON derogations
  FOR EACH ROW EXECUTE FUNCTION enforce_derogation_authority();


-- ---------------------------------------------------------------------------
--  G. SOCLE
-- ---------------------------------------------------------------------------

ALTER TABLE number_sequences
  -- month = 0 pour une séquence annuelle (OP-2026-000154),
  -- 1 à 12 pour une séquence mensuelle (DEAL-2026-08-001).
  DROP CONSTRAINT IF EXISTS chk_number_sequences_period,
  ADD  CONSTRAINT chk_number_sequences_period
       CHECK (month BETWEEN 0 AND 12 AND year BETWEEN 2000 AND 2200),

  DROP CONSTRAINT IF EXISTS chk_number_sequences_monotonic,
  ADD  CONSTRAINT chk_number_sequences_monotonic
       CHECK (last_value >= 0);

ALTER TABLE system_settings
  DROP CONSTRAINT IF EXISTS chk_system_settings_value_type,
  ADD  CONSTRAINT chk_system_settings_value_type
       CHECK (value_type IN ('string', 'number', 'boolean', 'json'));


-- ─── 02_audit_immutability.sql ───────────────────────────────────

-- ===========================================================================
--  IMMUABILITÉ DES JOURNAUX
--  Réf. SPECIFICATIONS.md § 1.4, § 11.4
--
--  Un journal d'audit modifiable ne vaut rien : le premier réflexe de qui
--  couvre une manipulation de prix, de marge ou de conformité est d'effacer
--  la trace. L'immuabilité est portée par le moteur, en deux couches
--  indépendantes :
--    1. un trigger refusant UPDATE et DELETE, quel que soit le rôle ;
--    2. le retrait des privilèges au rôle applicatif (04_grants.sql).
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

CREATE OR REPLACE FUNCTION append_only_guard()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'Table en ajout seul : % interdit sur % (SPECIFICATIONS.md § 1.4).',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

-- --- Journal d'audit -------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON audit_logs;
CREATE TRIGGER trg_audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();

DROP TRIGGER IF EXISTS trg_audit_logs_no_delete ON audit_logs;
CREATE TRIGGER trg_audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();

-- --- Registre des dérogations ---------------------------------------------
-- C'est la pièce qu'un auditeur ou un assureur demandera après un incident.
-- Une dérogation ne se supprime pas : elle se révoque ou se clôture, ce qui
-- laisse une trace. Les colonnes de statut restent modifiables.
DROP TRIGGER IF EXISTS trg_derogations_no_delete ON derogations;
CREATE TRIGGER trg_derogations_no_delete
  BEFORE DELETE ON derogations
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();

DROP TRIGGER IF EXISTS trg_delegations_no_delete ON delegations;
CREATE TRIGGER trg_delegations_no_delete
  BEFORE DELETE ON delegations
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();

-- --- Historiques de prix et de taux ---------------------------------------
-- Même principe : un prix administré ou un taux de change effacé rendrait
-- irreproductible une pièce déjà émise. On clôt une période, on n'efface pas.
DROP TRIGGER IF EXISTS trg_fx_rates_no_delete ON fx_rates;
CREATE TRIGGER trg_fx_rates_no_delete
  BEFORE DELETE ON fx_rates
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();

DROP TRIGGER IF EXISTS trg_administered_prices_no_delete ON administered_prices;
CREATE TRIGGER trg_administered_prices_no_delete
  BEFORE DELETE ON administered_prices
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();

-- --- Taux d'absorption -----------------------------------------------------
-- Une révision crée une version, elle n'écrase pas la précédente (§ 14.2).
DROP TRIGGER IF EXISTS trg_absorption_rates_no_delete ON absorption_rates;
CREATE TRIGGER trg_absorption_rates_no_delete
  BEFORE DELETE ON absorption_rates
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();


-- ─── 03_views_and_functions.sql ──────────────────────────────────

-- ===========================================================================
--  VUES ET FONCTIONS DE SERVICE — LOT 1
--
--  Les règles de résolution vivent en base, pas en mémoire applicative :
--  deux implémentations de la même règle finissent toujours par diverger.
--
--  ⚠️ La vue d'en-cours crédit v_partner_credit_exposure et la fonction
--     check_credit_capacity reviennent au LOT 2, avec les entités Deal
--     et Invoice dont elles dépendent (§ 9.1 de la v2, à réécrire sur la
--     hiérarchie à trois niveaux).
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Taux de change applicable à une date  (§ 9.2)
--
--  Retourne le taux en vigueur le plus récent à la date demandée, pour un
--  type de taux donné. Toute pièce émise conserve ensuite l'identifiant du
--  taux employé : elle reste reproductible à l'identique des années plus tard.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS resolve_fx_rate(char, char, date, text);

CREATE OR REPLACE FUNCTION resolve_fx_rate(
    p_from      char(3),
    p_to        char(3),
    p_on        date,
    p_rate_type text DEFAULT NULL
)
RETURNS TABLE (fx_rate_id uuid, rate numeric, rate_type text) AS $$
BEGIN
    -- Parité identique : taux de 1, aucune conversion.
    IF p_from = p_to THEN
        RETURN QUERY SELECT NULL::uuid, 1::numeric, 'IDENTITY'::text;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT f.id, f.rate, f.rate_type::text
      FROM fx_rates f
     WHERE f.base_currency_code  = p_from
       AND f.quote_currency_code = p_to
       AND f.effective_from     <= p_on
       AND (f.effective_to IS NULL OR f.effective_to >= p_on)
       AND (p_rate_type IS NULL OR f.rate_type::text = p_rate_type)
     -- La parité fixe l'emporte : elle n'est pas révisable.
     ORDER BY (f.rate_type::text = 'PEG') DESC,
              f.effective_from DESC,
              f.created_at DESC
     LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;


-- ---------------------------------------------------------------------------
--  Prix administré applicable à une date  (§ 5.3)
--
--  Simple lecture de référence, consultée au moment de fixer un prix de vente.
--  Aucune décomposition, aucune dérivation : le prix de vente reste une valeur
--  que le commercial fixe, et le coût d'achat vient d'un supplier_prices validé.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS resolve_administered_price(text, uuid, text, date);

CREATE OR REPLACE FUNCTION resolve_administered_price(
    p_reference_type text,
    p_product_id     uuid,
    p_zone           text,
    p_on             date
)
RETURNS TABLE (
    price_id      uuid,
    price         numeric,
    currency_code char(3),
    uom           text,
    published_by  text,
    effective_from date
) AS $$
BEGIN
    -- Chaque colonne est castée explicitement vers le type déclaré :
    -- PostgreSQL refuse un varchar(n) là où le RETURNS TABLE annonce text.
    RETURN QUERY
    SELECT a.id, a.price, a.currency_code, a.uom::text, a.published_by::text, a.effective_from
      FROM administered_prices a
     WHERE a.reference_type::text = p_reference_type
       AND a.product_id = p_product_id
       AND (p_zone IS NULL OR a.zone IS NOT DISTINCT FROM p_zone)
       AND a.effective_from <= p_on
       AND (a.effective_to IS NULL OR a.effective_to >= p_on)
     ORDER BY a.effective_from DESC, a.created_at DESC
     LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;


-- ---------------------------------------------------------------------------
--  Conformité des moyens de transport  (§ 6.4)
--
--  Un sous-traitant, véhicule ou chauffeur non conforme ne peut être affecté
--  sans dérogation du DG. Cette vue est la source unique de l'état de
--  conformité : elle ne se saisit pas, elle se déduit des pièces à échéance.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_transport_compliance AS
WITH blocking AS (
    SELECT
        partner_id, vehicle_id, driver_id,
        COUNT(*) FILTER (WHERE status::text = 'EXPIRED')   AS expired_count,
        COUNT(*) FILTER (WHERE status::text = 'SUSPENDED') AS suspended_count,
        COUNT(*) FILTER (WHERE status::text = 'EXPIRING')  AS expiring_count,
        MIN(expiry_date) FILTER (WHERE status::text IN ('VALID', 'EXPIRING')) AS next_expiry
      FROM compliance_records
     WHERE is_blocking
     GROUP BY partner_id, vehicle_id, driver_id
)
SELECT
    'CARRIER'::text                                   AS subject_kind,
    p.id                                              AS subject_id,
    p.code                                            AS subject_code,
    p.legal_name                                      AS subject_label,
    COALESCE(b.expired_count, 0)                      AS expired_count,
    COALESCE(b.suspended_count, 0)                    AS suspended_count,
    COALESCE(b.expiring_count, 0)                     AS expiring_count,
    b.next_expiry,
    (COALESCE(b.expired_count, 0) + COALESCE(b.suspended_count, 0)) = 0 AS is_compliant
  FROM partners p
  LEFT JOIN blocking b ON b.partner_id = p.id
 WHERE p.type::text IN ('CARRIER', 'SUPPLIER')

UNION ALL

SELECT
    'VEHICLE'::text, v.id, v.registration, COALESCE(v.brand_model, v.registration),
    COALESCE(b.expired_count, 0),
    COALESCE(b.suspended_count, 0),
    COALESCE(b.expiring_count, 0),
    b.next_expiry,
    (COALESCE(b.expired_count, 0) + COALESCE(b.suspended_count, 0)) = 0
  FROM vehicles v
  LEFT JOIN blocking b ON b.vehicle_id = v.id

UNION ALL

SELECT
    'DRIVER'::text, d.id, COALESCE(d.employee_number, d.id::text), d.full_name,
    COALESCE(b.expired_count, 0),
    COALESCE(b.suspended_count, 0),
    COALESCE(b.expiring_count, 0),
    b.next_expiry,
    (COALESCE(b.expired_count, 0) + COALESCE(b.suspended_count, 0)) = 0
  FROM drivers d
  LEFT JOIN blocking b ON b.driver_id = d.id;

COMMENT ON VIEW v_transport_compliance IS
  'État de conformité des tiers, véhicules et chauffeurs — SPECIFICATIONS.md § 6.4. Source unique du verrou de conformité : déduite des pièces à échéance, jamais saisie.';


-- ---------------------------------------------------------------------------
--  Échéancier documentaire  (§ 6.6)
--
--  Alimente le moteur d'alerte avant expiration. Cette seule vue a déjà de la
--  valeur avant tout le reste de l'ERP : agréments, assurances, contrôles
--  techniques et habilitations qui arrivent à échéance.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_compliance_expiry_watch AS
SELECT
    cr.id,
    cr.type,
    cr.reference,
    cr.expiry_date,
    (cr.expiry_date - CURRENT_DATE)         AS days_remaining,
    cr.status,
    cr.is_blocking,
    cr.expiry_alert_sent_at,
    CASE
        WHEN cr.partner_id IS NOT NULL THEN 'PARTNER'
        WHEN cr.vehicle_id IS NOT NULL THEN 'VEHICLE'
        ELSE 'DRIVER'
    END                                      AS owner_kind,
    COALESCE(p.legal_name, v.registration, d.full_name) AS owner_label,
    COALESCE(cr.partner_id, cr.vehicle_id, cr.driver_id) AS owner_id
  FROM compliance_records cr
  LEFT JOIN partners p ON p.id = cr.partner_id
  LEFT JOIN vehicles v ON v.id = cr.vehicle_id
  LEFT JOIN drivers  d ON d.id = cr.driver_id
 WHERE cr.expiry_date IS NOT NULL
   AND cr.status::text IN ('VALID', 'EXPIRING', 'EXPIRED')
 ORDER BY cr.expiry_date;

COMMENT ON VIEW v_compliance_expiry_watch IS
  'Échéancier des pièces légales et de conformité — SPECIFICATIONS.md § 6.6.';


-- ---------------------------------------------------------------------------
--  Seuils applicables à un couple segment / produit  (§ 5.4)
--
--  Le seuil le plus spécifique l'emporte : une ligne portant le produit prime
--  sur une ligne segment seul.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS resolve_margin_threshold(text, uuid, date);

CREATE OR REPLACE FUNCTION resolve_margin_threshold(
    p_segment    text,
    p_product_id uuid,
    p_on         date
)
RETURNS TABLE (
    threshold_id   uuid,
    direct_floor   numeric,
    minimum_margin numeric,
    currency_code  char(3),
    uom            text
) AS $$
BEGIN
    RETURN QUERY
    SELECT m.id, m.direct_floor, m.minimum_margin, m.currency_code, m.uom::text
      FROM margin_thresholds m
     WHERE m.segment::text = p_segment
       AND (m.product_id IS NULL OR m.product_id = p_product_id)
       AND m.effective_from <= p_on
       AND (m.effective_to IS NULL OR m.effective_to >= p_on)
     ORDER BY (m.product_id IS NOT NULL) DESC, m.effective_from DESC
     LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;


-- ---------------------------------------------------------------------------
--  Tolérance d'ullage applicable  (§ 8.3)
--
--  Résolution du plus spécifique au plus général :
--  (segment, mode, produit) → (segment, mode) → (segment) → défaut global.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS resolve_ullage_tolerance(text, text, uuid, date);

CREATE OR REPLACE FUNCTION resolve_ullage_tolerance(
    p_segment        text,
    p_transport_mode text,
    p_product_id     uuid,
    p_on             date
)
RETURNS TABLE (
    tolerance_id    uuid,
    normal_pct      numeric,
    alert_pct       numeric,
    critical_pct    numeric,
    franchise       numeric,
    franchise_uom   text
) AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.normal_threshold_pct, u.alert_threshold_pct,
           u.critical_threshold_pct, u.absolute_franchise, u.franchise_uom::text
      FROM ullage_tolerances u
     WHERE (u.segment IS NULL        OR u.segment::text = p_segment)
       AND (u.transport_mode IS NULL OR u.transport_mode::text = p_transport_mode)
       AND (u.product_id IS NULL     OR u.product_id = p_product_id)
       AND u.effective_from <= p_on
       AND (u.effective_to IS NULL OR u.effective_to >= p_on)
     ORDER BY (u.product_id IS NOT NULL)::int
            + (u.transport_mode IS NOT NULL)::int
            + (u.segment IS NOT NULL)::int DESC,
              u.effective_from DESC
     LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;


-- ─── 05_lot2_invariants.sql ──────────────────────────────────────

-- ===========================================================================
--  INVARIANTS — LOT 2 : CŒUR COMMERCIAL & EXÉCUTION
--  Réf. SPECIFICATIONS.md § 5.4, § 7, § 9, § 11
--
--  Trois verrous, une chaîne de facturation, et les contrôles anti-détournement.
--  Portés par PostgreSQL : aucun bug applicatif, aucun script d'administration
--  et aucune refonte de l'API ne peut les contourner.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  A. PRIX D'ACHAT — JAMAIS LIBRE
--
--  Le levier le plus simple pour détourner de la valeur est de gonfler un coût
--  d'achat : la marge affichée baisse, l'affaire passe le seuil, et la
--  différence part ailleurs. On ferme ce levier à la source.
-- ---------------------------------------------------------------------------

-- Un prix fournisseur n'est validé que par le DG.
CREATE OR REPLACE FUNCTION enforce_supplier_price_validator()
RETURNS TRIGGER AS $$
DECLARE
  validator_role text;
BEGIN
  IF NEW.validated_by_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role::text INTO validator_role FROM users WHERE id = NEW.validated_by_id;
  IF validator_role IS DISTINCT FROM 'DG' THEN
    RAISE EXCEPTION
      'La validation d''un prix fournisseur est réservée au DG. Rôle fourni : %.',
      COALESCE(validator_role, 'utilisateur inconnu')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_price_validator ON supplier_prices;
CREATE TRIGGER trg_supplier_price_validator
  BEFORE INSERT OR UPDATE OF validated_by_id ON supplier_prices
  FOR EACH ROW EXECUTE FUNCTION enforce_supplier_price_validator();

-- Un prix validé ne se modifie plus : une évolution crée une nouvelle ligne.
-- Sans cela, changer un prix passé réécrirait rétroactivement le coût de
-- toutes les affaires qui s'y adossent.
CREATE OR REPLACE FUNCTION enforce_supplier_price_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.validated_at IS NULL THEN
    RETURN NEW; -- Brouillon non validé : librement modifiable.
  END IF;

  IF NEW.unit_price   IS DISTINCT FROM OLD.unit_price
  OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
  OR NEW.uom          IS DISTINCT FROM OLD.uom
  OR NEW.supplier_id  IS DISTINCT FROM OLD.supplier_id
  OR NEW.product_id   IS DISTINCT FROM OLD.product_id
  OR NEW.effective_from IS DISTINCT FROM OLD.effective_from THEN
    RAISE EXCEPTION
      'Prix fournisseur déjà validé : il ne se modifie pas. Créer une nouvelle ligne datée (§ 6.3).'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW; -- Clôture de période (effective_to) admise.
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_price_immutable ON supplier_prices;
CREATE TRIGGER trg_supplier_price_immutable
  BEFORE UPDATE ON supplier_prices
  FOR EACH ROW EXECUTE FUNCTION enforce_supplier_price_immutable();

-- Le prix d'achat d'un deal provient d'un prix fournisseur validé et en vigueur.
CREATE OR REPLACE FUNCTION enforce_deal_purchase_price_sourced()
RETURNS TRIGGER AS $$
DECLARE
  sp RECORD;
BEGIN
  -- Un brouillon sans prix d'achat n'est pas encore contraint.
  IF NEW.unit_purchase_price = 0 AND NEW.supplier_price_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.supplier_price_id IS NULL THEN
    RAISE EXCEPTION
      'Le prix d''achat du deal % doit provenir d''un prix fournisseur validé — il ne se saisit pas librement.',
      NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT unit_price, validated_at, effective_from, effective_to, product_id, currency_code
    INTO sp
    FROM supplier_prices WHERE id = NEW.supplier_price_id;

  IF sp IS NULL THEN
    RAISE EXCEPTION 'Prix fournisseur introuvable pour le deal %.', NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  IF sp.validated_at IS NULL THEN
    RAISE EXCEPTION
      'Le prix fournisseur adossé au deal % n''est pas validé par le DG.', NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  IF sp.product_id <> NEW.product_id THEN
    RAISE EXCEPTION
      'Le prix fournisseur adossé au deal % ne concerne pas le produit vendu.', NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.unit_purchase_price <> sp.unit_price THEN
    RAISE EXCEPTION
      'Prix d''achat du deal % (%) différent du prix fournisseur validé (%).',
      NEW.reference, NEW.unit_purchase_price, sp.unit_price
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deal_purchase_price_sourced ON deals;
CREATE TRIGGER trg_deal_purchase_price_sourced
  BEFORE INSERT OR UPDATE OF unit_purchase_price, supplier_price_id, product_id ON deals
  FOR EACH ROW EXECUTE FUNCTION enforce_deal_purchase_price_sourced();


-- ---------------------------------------------------------------------------
--  B. TOUTE MODIFICATION DE PRIX ANNULE L'APPROBATION
--
--  Sans cela, un deal approuvé à 45 FCFA de marge peut être ramené à 31 sans
--  repasser devant personne : l'approbation ne vaudrait rien.
--
--  On n'interdit pas la modification — on retire l'approbation, ce qui renvoie
--  l'affaire devant le CFO. La trace reste au journal des transitions.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION revoke_approval_on_price_change()
RETURNS TRIGGER AS $$
DECLARE
  economics_changed boolean;
BEGIN
  economics_changed :=
       NEW.unit_sale_price     IS DISTINCT FROM OLD.unit_sale_price
    OR NEW.unit_purchase_price IS DISTINCT FROM OLD.unit_purchase_price
    OR NEW.contracted_volume   IS DISTINCT FROM OLD.contracted_volume
    OR NEW.discount_mode       IS DISTINCT FROM OLD.discount_mode
    OR NEW.discount_value      IS DISTINCT FROM OLD.discount_value
    OR NEW.currency_code       IS DISTINCT FROM OLD.currency_code;

  IF NOT economics_changed OR OLD.credit_approved_by_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Une opération déjà engagée interdit la modification : le coût est réel.
  IF EXISTS (SELECT 1 FROM operations
              WHERE deal_id = NEW.id
                AND status::text NOT IN ('DRAFT', 'CANCELLED')) THEN
    RAISE EXCEPTION
      'Le deal % a des opérations engagées : ses prix ne peuvent plus changer. Corriger par avoir.',
      NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.credit_approved_by_id := NULL;
  NEW.credit_approved_at    := NULL;
  NEW.dg_approved_by_id     := NULL;
  NEW.dg_approved_at        := NULL;
  NEW.status                := 'PENDING_RISK';

  INSERT INTO deal_status_transitions (id, deal_id, from_status, to_status, actor_type, reason)
  VALUES (gen_random_uuid(), NEW.id, OLD.status, 'PENDING_RISK', 'SYSTEM',
          'Approbation annulée : modification des conditions économiques après approbation.');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deal_revoke_approval_on_price_change ON deals;
CREATE TRIGGER trg_deal_revoke_approval_on_price_change
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION revoke_approval_on_price_change();


-- ---------------------------------------------------------------------------
--  C. VERROU FINANCIER  (§ 11.2)
--
--  « Aucune Opération ne peut exister sur un Deal non approuvé. »
--  Un seul point de contrôle verrouille toute l'exécution en amont.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_operation_requires_approval()
RETURNS TRIGGER AS $$
DECLARE
  d RECORD;
BEGIN
  SELECT reference, status::text AS status, credit_approved_by_id
    INTO d FROM deals WHERE id = NEW.deal_id;

  IF d.credit_approved_by_id IS NULL THEN
    RAISE EXCEPTION
      'VERROU FINANCIER — le deal % est en statut % et n''a pas reçu l''approbation de la Finance : aucune opération ne peut être créée.',
      d.reference, d.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF d.status IN ('CANCELLED', 'CREDIT_BLOCKED', 'REJECTED_BY_CLIENT', 'PENDING_RISK', 'PENDING_DG_APPROVAL') THEN
    RAISE EXCEPTION
      'VERROU FINANCIER — le deal % est en statut % : exécution refusée.', d.reference, d.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_operation_requires_approval ON operations;
CREATE TRIGGER trg_operation_requires_approval
  BEFORE INSERT OR UPDATE OF deal_id ON operations
  FOR EACH ROW EXECUTE FUNCTION enforce_operation_requires_approval();

-- Qui approuve quoi, vérifié en base et non seulement dans un guard.
CREATE OR REPLACE FUNCTION enforce_deal_approver_roles_lot2()
RETURNS TRIGGER AS $$
DECLARE
  r text;
BEGIN
  IF NEW.credit_approved_by_id IS NOT NULL THEN
    SELECT role::text INTO r FROM users WHERE id = NEW.credit_approved_by_id;
    IF r IS NULL OR r NOT IN ('FINANCE_CFO', 'DG') THEN
      RAISE EXCEPTION
        'L''approbation financière du deal % est réservée au CFO (ou au DG). Rôle fourni : %.',
        NEW.reference, COALESCE(r, 'inconnu')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.dg_approved_by_id IS NOT NULL THEN
    SELECT role::text INTO r FROM users WHERE id = NEW.dg_approved_by_id;
    IF r IS DISTINCT FROM 'DG' THEN
      RAISE EXCEPTION
        'La dérogation sur marge du deal % est réservée au DG. Rôle fourni : %.',
        NEW.reference, COALESCE(r, 'inconnu')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deal_approver_roles_lot2 ON deals;
CREATE TRIGGER trg_deal_approver_roles_lot2
  BEFORE INSERT OR UPDATE OF credit_approved_by_id, dg_approved_by_id ON deals
  FOR EACH ROW EXECUTE FUNCTION enforce_deal_approver_roles_lot2();


-- ---------------------------------------------------------------------------
--  D. VERROU HSE  (§ 11.2)
--
--  Pas de chargement sans contrôles bloquants validés. Et surtout :
--  L'AGENT QUI EXÉCUTE NE VALIDE JAMAIS SES PROPRES CONTRÔLES BLOQUANTS.
--  Sans cette séparation, le verrou ne vaut rien.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_hse_separation_of_duties()
RETURNS TRIGGER AS $$
DECLARE
  recorder uuid;
  validator_role text;
BEGIN
  IF NEW.validated_by_field_user_id IS NOT NULL THEN
    SELECT role::text INTO validator_role
      FROM field_users WHERE id = NEW.validated_by_field_user_id;

    IF validator_role IS DISTINCT FROM 'HSE_CONTROLLER' THEN
      RAISE EXCEPTION
        'VERROU HSE — la validation est réservée au contrôleur HSE. Rôle fourni : %.',
        COALESCE(validator_role, 'inconnu')
        USING ERRCODE = 'check_violation';
    END IF;

    -- Séparation des tâches : celui qui a renseigné un point BLOQUANT ne peut
    -- pas être celui qui valide la checklist.
    SELECT i.recorded_by_field_user_id INTO recorder
      FROM operation_hse_check_items i
     WHERE i.check_id = NEW.id
       AND i.level::text = 'BLOCKING'
       AND i.recorded_by_field_user_id = NEW.validated_by_field_user_id
     LIMIT 1;

    IF recorder IS NOT NULL THEN
      RAISE EXCEPTION
        'VERROU HSE — l''agent qui a renseigné un contrôle bloquant ne peut pas valider la checklist (§ 3.2).'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Suppléance : seul le DG peut valider en l'absence du contrôleur (§ 3.4).
  IF NEW.validated_by_user_id IS NOT NULL THEN
    SELECT role::text INTO validator_role FROM users WHERE id = NEW.validated_by_user_id;
    IF validator_role IS DISTINCT FROM 'DG' THEN
      RAISE EXCEPTION
        'VERROU HSE — la suppléance du contrôleur HSE est réservée au DG. Rôle fourni : %.',
        COALESCE(validator_role, 'inconnu')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hse_separation_of_duties ON operation_hse_checks;
CREATE TRIGGER trg_hse_separation_of_duties
  BEFORE INSERT OR UPDATE OF validated_by_field_user_id, validated_by_user_id ON operation_hse_checks
  FOR EACH ROW EXECUTE FUNCTION enforce_hse_separation_of_duties();

-- Pas de chargement tant qu'un contrôle bloquant n'est pas satisfait.
CREATE OR REPLACE FUNCTION enforce_hse_gate_before_loading()
RETURNS TRIGGER AS $$
DECLARE
  pending int;
BEGIN
  IF NEW.status::text NOT IN ('LOADING', 'IN_TRANSIT', 'DELIVERING', 'FINAL_CHECK', 'CLOSED') THEN
    RETURN NEW;
  END IF;
  IF OLD.status::text = NEW.status::text THEN
    RETURN NEW;
  END IF;

  -- Une dérogation HSE du DG lève le verrou (§ 11.2).
  IF NEW.hse_derogation_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.hse_validated_by_id IS NULL AND NEW.hse_validated_by_user_id IS NULL THEN
    RAISE EXCEPTION
      'VERROU HSE — l''opération % ne peut pas passer au chargement : contrôles non validés.',
      NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO pending
    FROM operation_hse_check_items i
    JOIN operation_hse_checks c ON c.id = i.check_id
   WHERE c.operation_id = NEW.id
     AND i.level::text = 'BLOCKING'
     AND i.outcome::text <> 'PASSED';

  IF pending > 0 THEN
    RAISE EXCEPTION
      'VERROU HSE — % contrôle(s) bloquant(s) non satisfait(s) sur l''opération %.',
      pending, NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hse_gate_before_loading ON operations;
CREATE TRIGGER trg_hse_gate_before_loading
  BEFORE UPDATE OF status ON operations
  FOR EACH ROW EXECUTE FUNCTION enforce_hse_gate_before_loading();


-- ---------------------------------------------------------------------------
--  E. VERROU DE CONFORMITÉ  (§ 6.4, § 11.2)
--
--  Un sous-traitant, véhicule ou chauffeur non conforme ne peut être affecté
--  sans dérogation DU DG. Le statut de conformité est dérivé des pièces à
--  échéance : il ne se saisit pas.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_assignment_compliance()
RETURNS TRIGGER AS $$
DECLARE
  offenders text := '';
BEGIN
  IF NEW.compliance_derogation_id IS NOT NULL THEN
    RETURN NEW; -- Dérogation DG déjà accordée (rôle vérifié à sa création).
  END IF;

  SELECT string_agg(subject_kind || ' ' || subject_label, ', ')
    INTO offenders
    FROM v_transport_compliance
   WHERE NOT is_compliant
     AND subject_id IN (
       COALESCE(NEW.carrier_id, '00000000-0000-0000-0000-000000000000'::uuid),
       COALESCE(NEW.vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid),
       COALESCE(NEW.driver_id,  '00000000-0000-0000-0000-000000000000'::uuid)
     );

  IF offenders IS NOT NULL AND offenders <> '' THEN
    RAISE EXCEPTION
      'VERROU CONFORMITÉ — moyen(s) non conforme(s) : %. Une dérogation du DG est requise (§ 6.4).',
      offenders
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assignment_compliance ON operation_assignments;
CREATE TRIGGER trg_assignment_compliance
  BEFORE INSERT OR UPDATE OF carrier_id, vehicle_id, driver_id, compliance_derogation_id
  ON operation_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_assignment_compliance();


-- ---------------------------------------------------------------------------
--  F. CHAÎNE DE FACTURATION  (§ 9)
--
--     Prix TTC × Quantité  =  brut
--   − Réduction            =  TOTAL FACTURE
--     TVA = Total × taux ÷ (100 + taux)   si applicable — extraite, non ajoutée
-- ---------------------------------------------------------------------------

ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS chk_invoices_positive,
  ADD  CONSTRAINT chk_invoices_positive
       CHECK (billed_volume > 0 AND unit_price >= 0 AND total_amount >= 0
              AND discount_amount >= 0 AND vat_amount >= 0
              AND paid_amount >= 0 AND paid_amount <= total_amount),

  DROP CONSTRAINT IF EXISTS chk_invoices_vat_rate_range,
  ADD  CONSTRAINT chk_invoices_vat_rate_range
       CHECK (vat_rate_pct >= 0 AND vat_rate_pct <= 100),

  -- La TVA n'existe que si la case est cochée.
  DROP CONSTRAINT IF EXISTS chk_invoices_vat_requires_flag,
  ADD  CONSTRAINT chk_invoices_vat_requires_flag
       CHECK (is_vat_applicable OR vat_amount = 0),

  -- Brut = volume × prix unitaire.
  DROP CONSTRAINT IF EXISTS chk_invoices_gross_derived,
  ADD  CONSTRAINT chk_invoices_gross_derived
       CHECK (abs(gross_amount - round(billed_volume * unit_price, 4)) <= 0.01),

  -- Total = brut − réduction.
  DROP CONSTRAINT IF EXISTS chk_invoices_total_derived,
  ADD  CONSTRAINT chk_invoices_total_derived
       CHECK (abs(total_amount - (gross_amount - discount_amount)) <= 0.01),

  -- TVA EXTRAITE du total : total × taux ÷ (100 + taux).
  DROP CONSTRAINT IF EXISTS chk_invoices_vat_extracted,
  ADD  CONSTRAINT chk_invoices_vat_extracted
       CHECK (
         NOT is_vat_applicable
         OR abs(vat_amount - round(total_amount * vat_rate_pct / (100 + vat_rate_pct), 4)) <= 0.01
       ),

  -- Un avoir référence la pièce qu'il corrige.
  DROP CONSTRAINT IF EXISTS chk_invoices_credit_note_origin,
  ADD  CONSTRAINT chk_invoices_credit_note_origin
       CHECK (type::text <> 'CREDIT_NOTE' OR corrected_invoice_id IS NOT NULL),

  -- La facture simple est une DÉCISION INTERNE : décideur et motif obligatoires.
  DROP CONSTRAINT IF EXISTS chk_invoices_simple_decision,
  ADD  CONSTRAINT chk_invoices_simple_decision
       CHECK (
         type::text <> 'SIMPLE'
         OR status::text = 'DRAFT'
         OR (simple_invoice_decided_by_id IS NOT NULL
             AND simple_invoice_decided_at IS NOT NULL
             AND simple_invoice_reason IS NOT NULL
             AND length(trim(simple_invoice_reason)) >= 10)
       );

COMMENT ON COLUMN invoices.vat_amount IS
  'TVA EXTRAITE du total (total × taux ÷ (100 + taux)), jamais ajoutée. Affichée pour information. N''entre pas dans le calcul de marge.';

-- Une proforma ne génère ni créance, ni transmission fiscale (§ 9.3).
CREATE OR REPLACE FUNCTION enforce_proforma_has_no_fiscal_effect()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.type::text = 'PROFORMA' THEN
    IF NEW.paid_amount <> 0 THEN
      RAISE EXCEPTION
        'Une proforma ne porte pas d''encaissement : elle ne crée aucune créance (§ 9.3).'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM fne_transmissions WHERE invoice_id = NEW.id) THEN
      RAISE EXCEPTION
        'Une proforma ne se transmet pas au dispositif fiscal (§ 9.3).'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_proforma_no_fiscal_effect ON invoices;
CREATE TRIGGER trg_proforma_no_fiscal_effect
  BEFORE INSERT OR UPDATE OF type, paid_amount ON invoices
  FOR EACH ROW EXECUTE FUNCTION enforce_proforma_has_no_fiscal_effect();


-- ---------------------------------------------------------------------------
--  G. ÉCART D'ULLAGE  (§ 8)
--
--  Contrôle opérationnel et HSE — plus un verrou de facturation. Un écart
--  au-delà du seuil critique ouvre une non-conformité d'office : le produit
--  est allé quelque part.
-- ---------------------------------------------------------------------------

ALTER TABLE measurement_records
  DROP CONSTRAINT IF EXISTS chk_measurement_volumes_positive,
  ADD  CONSTRAINT chk_measurement_volumes_positive
       CHECK (loaded_volume_15 > 0 AND discharged_volume_15 > 0),

  -- L'écart est calculé, pas déclaré.
  DROP CONSTRAINT IF EXISTS chk_measurement_ullage_computed,
  ADD  CONSTRAINT chk_measurement_ullage_computed
       CHECK (
         abs(ullage_variance_pct
             - round(((loaded_volume_15 - discharged_volume_15) / loaded_volume_15) * 100, 6)
            ) <= 0.000001
       ),

  DROP CONSTRAINT IF EXISTS chk_measurement_ack_complete,
  ADD  CONSTRAINT chk_measurement_ack_complete
       CHECK (
         ullage_ack_at IS NULL
         OR (ullage_ack_by_id IS NOT NULL
             AND ullage_ack_reason IS NOT NULL
             AND length(trim(ullage_ack_reason)) >= 10)
       );

-- Un seul relevé fait autorité par opération.
DROP INDEX IF EXISTS uq_measurement_single_authoritative;
CREATE UNIQUE INDEX uq_measurement_single_authoritative
  ON measurement_records (operation_id) WHERE is_authoritative;

-- L'acquittement d'un écart est réservé au CCOO, au CFO et au DG.
CREATE OR REPLACE FUNCTION enforce_ullage_ack_role_lot2()
RETURNS TRIGGER AS $$
DECLARE
  r text;
BEGIN
  IF NEW.ullage_ack_by_id IS NOT NULL THEN
    SELECT role::text INTO r FROM users WHERE id = NEW.ullage_ack_by_id;
    IF r IS NULL OR r NOT IN ('CCOO', 'FINANCE_CFO', 'DG') THEN
      RAISE EXCEPTION
        'L''acquittement d''un écart de volume est réservé au CCOO, au CFO ou au DG. Rôle fourni : %.',
        COALESCE(r, 'inconnu')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ullage_ack_role_lot2 ON measurement_records;
CREATE TRIGGER trg_ullage_ack_role_lot2
  BEFORE INSERT OR UPDATE OF ullage_ack_by_id ON measurement_records
  FOR EACH ROW EXECUTE FUNCTION enforce_ullage_ack_role_lot2();


-- ---------------------------------------------------------------------------
--  H. DOCUMENTS SCELLÉS  (§ 12.2)
--
--  Une pièce signée et transmise au client ne se modifie plus. La correction
--  produit un NOUVEAU document « annule et remplace ».
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_sealed_document_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_sealed AND (
       NEW.storage_key IS DISTINCT FROM OLD.storage_key
    OR NEW.sha256      IS DISTINCT FROM OLD.sha256
    OR NEW.size_bytes  IS DISTINCT FROM OLD.size_bytes
    OR NEW.is_sealed   IS DISTINCT FROM OLD.is_sealed
  ) THEN
    RAISE EXCEPTION
      'Document scellé : il ne se modifie pas. Émettre une pièce « annule et remplace » (§ 12.2).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sealed_document_immutable ON generated_documents;
CREATE TRIGGER trg_sealed_document_immutable
  BEFORE UPDATE ON generated_documents
  FOR EACH ROW EXECUTE FUNCTION enforce_sealed_document_immutable();

-- Une pièce qui en remplace une autre doit dire pourquoi.
ALTER TABLE generated_documents
  DROP CONSTRAINT IF EXISTS chk_document_supersession_reason,
  ADD  CONSTRAINT chk_document_supersession_reason
       CHECK (
         supersedes_id IS NULL
         OR (supersession_reason IS NOT NULL AND length(trim(supersession_reason)) >= 10)
       );

-- Une signature externe porte toujours la qualité du signataire : sans elle,
-- le document n'est pas opposable.
ALTER TABLE signatures
  DROP CONSTRAINT IF EXISTS chk_signature_capacity,
  ADD  CONSTRAINT chk_signature_capacity
       CHECK (length(trim(signatory_name)) >= 2 AND length(trim(signatory_capacity)) >= 2);


-- ─── 06_lot2_views.sql ───────────────────────────────────────────

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
WITH band AS (
    SELECT COALESCE(NULLIF(value, '')::numeric, 15) AS pct
      FROM system_settings WHERE key = 'MARGIN_BAND_ALERT_PCT'
),
thresholds AS (
    SELECT DISTINCT ON (segment) segment, minimum_margin, direct_floor, uom, currency_code
      FROM margin_thresholds
     WHERE product_id IS NULL
       AND effective_from <= CURRENT_DATE
       AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
     ORDER BY segment, effective_from DESC
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


-- ─── 04_grants.sql ───────────────────────────────────────────────

-- ===========================================================================
--  MOINDRE PRIVILÈGE EN BASE
--  Réf. SPECIFICATIONS.md § 1.4
--
--  Deux rôles PostgreSQL, jamais confondus :
--    · erp_migrator — propriétaire du schéma, DDL. Utilisé UNIQUEMENT par
--                     les migrations, jamais par l'application.
--    · erp_app      — DML seul. Aucun DDL. Aucun effacement de journal.
--
--  Conséquence : une injection SQL réussie contre l'application ne permet
--  ni de supprimer une table, ni d'effacer une trace d'audit ou une dérogation.
--
--  Le bloc teste l'existence du rôle : la migration doit pouvoir se rejouer
--  sur la base de travail de Prisma ou sur un poste de développement où
--  erp_app n'existe pas.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

DO $grants$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    RAISE NOTICE 'Rôle erp_app absent : attribution des privilèges ignorée (base de travail ou poste de développement).';
    RETURN;
  END IF;

  EXECUTE 'GRANT USAGE ON SCHEMA public TO erp_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app';

  -- --- Journaux : insertion seule -----------------------------------------
  EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM erp_app';
  EXECUTE 'GRANT SELECT, INSERT ON audit_logs TO erp_app';

  -- --- Registre des dérogations : pas d'effacement -------------------------
  -- Une dérogation se révoque ou se clôture ; elle ne disparaît jamais.
  EXECUTE 'REVOKE DELETE, TRUNCATE ON derogations FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON delegations FROM erp_app';

  -- --- Historiques opposables : pas d'effacement ---------------------------
  -- Taux de change, prix administrés et taux d'absorption rendent reproductibles
  -- des pièces déjà émises. On clôt une période, on n'efface pas.
  EXECUTE 'REVOKE DELETE, TRUNCATE ON fx_rates FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON supplier_prices FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON deal_status_transitions FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON operation_status_transitions FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON generated_documents FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON signatures FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON administered_prices FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON absorption_rates FROM erp_app';

  -- --- Référentiels administrés : pas de suppression -----------------------
  -- Devises, postes de coûts et grilles de seuils se désactivent (is_active),
  -- ils ne se suppriment pas : l'historique doit rester lisible.
  EXECUTE 'REVOKE DELETE, TRUNCATE ON currencies FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON cost_posts FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON margin_thresholds FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON ullage_tolerances FROM erp_app';

  -- --- Vues et fonctions de service ---------------------------------------
  EXECUTE 'GRANT SELECT ON v_transport_compliance TO erp_app';
  EXECUTE 'GRANT SELECT ON v_partner_credit_exposure TO erp_app';
  EXECUTE 'GRANT SELECT ON v_margin_band_watch TO erp_app';
  EXECUTE 'GRANT SELECT ON v_margin_band_by_owner TO erp_app';
  EXECUTE 'GRANT SELECT ON v_margin_variance TO erp_app';
  EXECUTE 'GRANT SELECT ON v_cost_reconciliation TO erp_app';
  EXECUTE 'GRANT SELECT ON v_compliance_expiry_watch TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION resolve_fx_rate(char, char, date, text) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION resolve_administered_price(text, uuid, text, date) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION resolve_margin_threshold(text, uuid, date) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION resolve_ullage_tolerance(text, text, uuid, date) TO erp_app';

  -- --- Aucun DDL -----------------------------------------------------------
  EXECUTE 'REVOKE CREATE ON SCHEMA public FROM erp_app';

  -- --- Héritage pour les migrations futures --------------------------------
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO erp_app';

  RAISE NOTICE 'Privilèges erp_app appliqués.';
END
$grants$;
