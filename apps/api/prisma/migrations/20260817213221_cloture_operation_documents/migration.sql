-- ─── Préambule joué AVANT le DDL : voir scripts/prepare-migrations.mjs ───
-- Les vues bloqueraient toute suppression de table ou de colonne.

-- ===========================================================================
--  PRÉAMBULE — DÉPOSE DES VUES QUI DÉPENDENT DE FONCTIONS RECRÉÉES ENSUITE
--
--  LE PROBLÈME
--  -----------
--  Tout le SQL métier est REJOUÉ à chaque migration : c'est ce qui garantit
--  que les invariants survivent aux évolutions de schéma. Or plusieurs
--  fichiers redéfinissent des fonctions (`resolve_margin_threshold`,
--  `resolve_cost_standard`, `compliance_statut_effectif`…), et PostgreSQL
--  refuse de remplacer une fonction dont une VUE dépend :
--
--    ERROR: cannot drop function resolve_margin_threshold(...) because other
--           objects depend on it
--           DETAIL: view v_invariant_breaches depends on function ...
--
--  La migration échouait donc dès qu'une vue d'audit avait été créée par la
--  migration PRÉCÉDENTE. Le symptôme est trompeur : il apparaît une migration
--  APRÈS celle qui l'a causé.
--
--  LA SOLUTION
--  -----------
--  Les vues d'analyse sont déposées ICI, en tête de séquence, et recréées plus
--  bas par les fichiers qui les portent. Elles ne contiennent aucune donnée :
--  les déposer ne coûte rien et ne perd rien.
--
--  ⚠️ TOUTE NOUVELLE VUE QUI APPELLE UNE FONCTION MÉTIER DOIT ÊTRE AJOUTÉE
--     ICI. L'oubli ne se voit pas tout de suite — il se voit à la migration
--     suivante, sur une modification sans rapport.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

DROP VIEW IF EXISTS v_taches_par_role CASCADE;
DROP VIEW IF EXISTS v_taches CASCADE;
DROP VIEW IF EXISTS v_invariant_breaches CASCADE;
DROP VIEW IF EXISTS v_tableau_operationnel_compte CASCADE;
DROP VIEW IF EXISTS v_tableau_operationnel CASCADE;
DROP VIEW IF EXISTS v_performance_commerciale CASCADE;
DROP VIEW IF EXISTS v_crm_conversion CASCADE;
DROP VIEW IF EXISTS v_crm_alertes CASCADE;
DROP VIEW IF EXISTS v_crm_pipeline_par_etape CASCADE;
DROP VIEW IF EXISTS v_crm_pipeline CASCADE;
DROP VIEW IF EXISTS v_absorption_reelle CASCADE;
-- Remplacée par `v_absorption_reelle` : l'assiette étant dérivée, l'écart
-- qu'elle mesurait est nul par construction. Le DROP reste pour les bases qui
-- la portent encore.
DROP VIEW IF EXISTS v_assiette_absorption CASCADE;
DROP VIEW IF EXISTS v_creances_echues CASCADE;
DROP VIEW IF EXISTS v_rapprochement_encaissements CASCADE;
DROP VIEW IF EXISTS v_reste_a_facturer CASCADE;
DROP VIEW IF EXISTS v_prevision_vente CASCADE;
DROP VIEW IF EXISTS v_prevision_en_vigueur CASCADE;
DROP VIEW IF EXISTS v_bfr_exploitation CASCADE;
DROP VIEW IF EXISTS v_point_mort CASCADE;
DROP VIEW IF EXISTS v_marge_cout_variable CASCADE;
-- APRÈS v_point_mort, qui la lit — même si le CASCADE suffirait, l'ordre dit
-- la dépendance à qui relit ce fichier.
DROP VIEW IF EXISTS v_charges_fixes_exercice CASCADE;
DROP VIEW IF EXISTS v_couverture_budgetaire CASCADE;
DROP VIEW IF EXISTS v_parametres_requis_sonde CASCADE;
DROP VIEW IF EXISTS v_parametres_requis CASCADE;
DROP VIEW IF EXISTS v_derogations_abusives CASCADE;
DROP VIEW IF EXISTS v_derogations_effectives CASCADE;
DROP VIEW IF EXISTS v_controles_sans_preuve CASCADE;
DROP VIEW IF EXISTS v_controles_sans_photo CASCADE;
DROP VIEW IF EXISTS v_conformite_statut_perime CASCADE;
DROP VIEW IF EXISTS v_transport_compliance CASCADE;
DROP VIEW IF EXISTS v_compliance_expiry_watch CASCADE;
DROP VIEW IF EXISTS v_exigences_site CASCADE;
DROP VIEW IF EXISTS v_fret_hors_tarif CASCADE;
DROP VIEW IF EXISTS v_sites_partages CASCADE;
DROP VIEW IF EXISTS v_field_clock_drift CASCADE;
DROP VIEW IF EXISTS v_field_rejections CASCADE;
DROP VIEW IF EXISTS v_ullage_statistiques CASCADE;
DROP VIEW IF EXISTS v_credit_depasse CASCADE;
DROP VIEW IF EXISTS v_partner_credit_exposure CASCADE;
DROP VIEW IF EXISTS v_fret_hors_tarif CASCADE;


-- ─── Fin du préambule — DDL généré par Prisma ci-dessous ───

-- AlterTable
ALTER TABLE "cost_pools" ALTER COLUMN "variability" SET DEFAULT 'FIXED';



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


-- ─── 00_prelude.sql ──────────────────────────────────────────────

-- ===========================================================================
--  PRÉAMBULE — DÉPOSE DES VUES QUI DÉPENDENT DE FONCTIONS RECRÉÉES ENSUITE
--
--  LE PROBLÈME
--  -----------
--  Tout le SQL métier est REJOUÉ à chaque migration : c'est ce qui garantit
--  que les invariants survivent aux évolutions de schéma. Or plusieurs
--  fichiers redéfinissent des fonctions (`resolve_margin_threshold`,
--  `resolve_cost_standard`, `compliance_statut_effectif`…), et PostgreSQL
--  refuse de remplacer une fonction dont une VUE dépend :
--
--    ERROR: cannot drop function resolve_margin_threshold(...) because other
--           objects depend on it
--           DETAIL: view v_invariant_breaches depends on function ...
--
--  La migration échouait donc dès qu'une vue d'audit avait été créée par la
--  migration PRÉCÉDENTE. Le symptôme est trompeur : il apparaît une migration
--  APRÈS celle qui l'a causé.
--
--  LA SOLUTION
--  -----------
--  Les vues d'analyse sont déposées ICI, en tête de séquence, et recréées plus
--  bas par les fichiers qui les portent. Elles ne contiennent aucune donnée :
--  les déposer ne coûte rien et ne perd rien.
--
--  ⚠️ TOUTE NOUVELLE VUE QUI APPELLE UNE FONCTION MÉTIER DOIT ÊTRE AJOUTÉE
--     ICI. L'oubli ne se voit pas tout de suite — il se voit à la migration
--     suivante, sur une modification sans rapport.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

DROP VIEW IF EXISTS v_taches_par_role CASCADE;
DROP VIEW IF EXISTS v_taches CASCADE;
DROP VIEW IF EXISTS v_invariant_breaches CASCADE;
DROP VIEW IF EXISTS v_tableau_operationnel_compte CASCADE;
DROP VIEW IF EXISTS v_tableau_operationnel CASCADE;
DROP VIEW IF EXISTS v_performance_commerciale CASCADE;
DROP VIEW IF EXISTS v_crm_conversion CASCADE;
DROP VIEW IF EXISTS v_crm_alertes CASCADE;
DROP VIEW IF EXISTS v_crm_pipeline_par_etape CASCADE;
DROP VIEW IF EXISTS v_crm_pipeline CASCADE;
DROP VIEW IF EXISTS v_absorption_reelle CASCADE;
-- Remplacée par `v_absorption_reelle` : l'assiette étant dérivée, l'écart
-- qu'elle mesurait est nul par construction. Le DROP reste pour les bases qui
-- la portent encore.
DROP VIEW IF EXISTS v_assiette_absorption CASCADE;
DROP VIEW IF EXISTS v_creances_echues CASCADE;
DROP VIEW IF EXISTS v_rapprochement_encaissements CASCADE;
DROP VIEW IF EXISTS v_reste_a_facturer CASCADE;
DROP VIEW IF EXISTS v_prevision_vente CASCADE;
DROP VIEW IF EXISTS v_prevision_en_vigueur CASCADE;
DROP VIEW IF EXISTS v_bfr_exploitation CASCADE;
DROP VIEW IF EXISTS v_point_mort CASCADE;
DROP VIEW IF EXISTS v_marge_cout_variable CASCADE;
-- APRÈS v_point_mort, qui la lit — même si le CASCADE suffirait, l'ordre dit
-- la dépendance à qui relit ce fichier.
DROP VIEW IF EXISTS v_charges_fixes_exercice CASCADE;
DROP VIEW IF EXISTS v_couverture_budgetaire CASCADE;
DROP VIEW IF EXISTS v_parametres_requis_sonde CASCADE;
DROP VIEW IF EXISTS v_parametres_requis CASCADE;
DROP VIEW IF EXISTS v_derogations_abusives CASCADE;
DROP VIEW IF EXISTS v_derogations_effectives CASCADE;
DROP VIEW IF EXISTS v_controles_sans_preuve CASCADE;
DROP VIEW IF EXISTS v_controles_sans_photo CASCADE;
DROP VIEW IF EXISTS v_conformite_statut_perime CASCADE;
DROP VIEW IF EXISTS v_transport_compliance CASCADE;
DROP VIEW IF EXISTS v_compliance_expiry_watch CASCADE;
DROP VIEW IF EXISTS v_exigences_site CASCADE;
DROP VIEW IF EXISTS v_fret_hors_tarif CASCADE;
DROP VIEW IF EXISTS v_sites_partages CASCADE;
DROP VIEW IF EXISTS v_field_clock_drift CASCADE;
DROP VIEW IF EXISTS v_field_rejections CASCADE;
DROP VIEW IF EXISTS v_ullage_statistiques CASCADE;
DROP VIEW IF EXISTS v_credit_depasse CASCADE;
DROP VIEW IF EXISTS v_partner_credit_exposure CASCADE;
DROP VIEW IF EXISTS v_fret_hors_tarif CASCADE;


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

  -- ⚠️ `chk_absorption_year_range` A DISPARU AVEC LA COLONNE QU'ELLE BORNAIT.
  --
  --    L'exercice était un entier libre : il fallait bien interdire l'an 2062.
  --    Il est désormais une CLÉ ÉTRANGÈRE vers les exercices comptables — un
  --    millésime qui n'existe pas ne peut plus s'écrire du tout, ce qu'aucune
  --    borne numérique ne savait garantir.

  -- Le taux DOIT être le quotient du budget par l'assiette budgétée.
  -- Une saisie libre du taux ouvrirait la porte à un coût complet arbitraire.
  DROP CONSTRAINT IF EXISTS chk_absorption_rate_derived,
  ADD  CONSTRAINT chk_absorption_rate_derived
       CHECK (abs(rate_per_unit - round(budgeted_amount / budgeted_base, 6)) <= 0.000001);

-- L'unicité « un taux courant par pool et par exercice » est reposée dans
-- 24_exercice_et_budget.sql, sur `fiscal_year_id`. Celle-ci portait sur la
-- colonne supprimée.
DROP INDEX IF EXISTS uq_absorption_current_per_pool_year;

COMMENT ON COLUMN absorption_rates.budgeted_base IS
  'Assiette BUDGÉTÉE, jamais réalisée glissante (§ 14.2) : un dénominateur réalisé déclencherait la spirale d''absorption — moins de volume, charge unitaire plus élevée, davantage d''affaires bloquées, moins de volume encore. CALCULÉE depuis la prévision de vente, plus saisie.';

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


-- ---------------------------------------------------------------------------
--  La tolérance d'arrondi d'une devise.
--
--  Fonction et non constante : le nombre de décimales est une donnée du
--  référentiel des devises, administrable, et non un fait figé dans un CHECK.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION tolerance_arrondi(p_currency_code char(3))
RETURNS numeric AS $$
  -- Une demi-unité de la plus petite subdivision : c'est ce qu'un arrondi
  -- correct peut écarter, ni plus ni moins. Le repli à 2 décimales ne sert que
  -- si la devise a disparu du référentiel — auquel cas la pièce a d'autres
  -- problèmes.
  SELECT COALESCE(
    (SELECT 0.5 / power(10, c.decimal_places)::numeric
       FROM currencies c WHERE c.code = p_currency_code),
    0.005);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION tolerance_arrondi IS
  'Écart maximal admissible entre un montant stocké et son calcul exact, DÉRIVÉ du nombre de décimales de la devise (§ 9.2). Une tolérance écrite en dur ne tolère rien en XOF et trop ailleurs.';


-- ---------------------------------------------------------------------------
--  REPRISE — les pièces déjà émises portent des fractions qui n'existent pas.
--
--  ⚠️ SANS ELLE, LA CONTRAINTE CI-DESSOUS REFUSE DE S'INSTALLER : les pièces
--     antérieures ont été calculées à quatre décimales quelle que soit la
--     devise, et violent donc la règle qu'on pose.
--
--  Le montant retenu est celui du plan DOCUMENT — c'est-à-dire ce que le
--  client a RÉELLEMENT reçu et ce qu'il paiera. Aligner la transaction sur le
--  document, et non l'inverse, est le seul choix défendable : la pièce
--  imprimée fait foi, et c'est le stock qui s'en était écarté.
--
--  ⚠️ Les pièces dont le plan document est libellé dans une AUTRE devise sont
--     écartées : leur montant imprimé n'est pas comparable au montant de
--     transaction, et l'aligner dessus serait une conversion déguisée. Elles
--     sont simplement arrondies à la précision de leur propre devise.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  UPDATE invoices i
     SET gross_amount    = round(i.gross_amount,    c.decimal_places),
         discount_amount = round(i.discount_amount, c.decimal_places),
         total_amount    = round(i.total_amount,    c.decimal_places),
         vat_amount      = round(i.vat_amount,      c.decimal_places),
         paid_amount     = round(i.paid_amount,     c.decimal_places)
    FROM currencies c
   WHERE c.code = i.currency_code
     AND (i.gross_amount <> round(i.gross_amount, c.decimal_places)
       OR i.total_amount <> round(i.total_amount, c.decimal_places)
       OR i.vat_amount   <> round(i.vat_amount,   c.decimal_places)
       OR i.paid_amount  <> round(i.paid_amount,  c.decimal_places));

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'Reprise : % pièce(s) ramenée(s) à la précision de leur devise.', n;
  END IF;

  -- Le brut doit ensuite RESTER cohérent avec volume × prix : l'arrondi du
  -- brut peut l'écarter de son produit exact au-delà de la tolérance quand le
  -- produit lui-même tombe loin d'un entier. On réaligne le prix unitaire, qui
  -- porte quatre décimales et supporte l'ajustement sans se voir.
  UPDATE invoices i
     SET unit_price = round(i.gross_amount / i.billed_volume, 4)
    FROM currencies c
   WHERE c.code = i.currency_code
     AND i.billed_volume > 0
     AND abs(i.gross_amount - i.billed_volume * i.unit_price)
         > 0.5 / power(10, c.decimal_places)::numeric;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'Reprise : prix unitaire réaligné sur % pièce(s).', n;
  END IF;
END $$;


-- ─── 13_derogations_opposables.sql ───────────────────────────────

-- ===========================================================================
--  UNE DÉROGATION N'EST OPPOSABLE QUE SI ELLE EST VALIDE
--  Réf. SPECIFICATIONS.md § 11.2, § 5.4
--
--  ⚠️ CE QUI EXISTAIT ÉTAIT UN JETON AU PORTEUR.
--
--     Quatre verrous s'appuient sur une dérogation. Deux ne vérifiaient QUE
--     SA PRÉSENCE (HSE, conformité), deux vérifiaient en plus son TYPE (marge,
--     bande de prix d'achat). AUCUN ne regardait :
--
--       · son statut — une dérogation RÉVOQUÉE ouvrait toujours ;
--       · sa date d'expiration — une dérogation périmée ouvrait toujours ;
--       · son sujet — une dérogation accordée pour l'affaire A ouvrait
--         l'affaire B.
--
--     Une dérogation accordée une fois par le DG, puis révoquée le lendemain,
--     restait un passe-partout permanent. Sur 10 000 000 L, la différence
--     entre un plancher de marge respecté et contourné se compte en dizaines
--     de millions de FCFA.
--
--     C'est aussi la pièce qu'un assureur ou un auditeur demandera après un
--     incident : « sur quelle autorisation cette opération est-elle partie ? »
--     Une réponse valable au moment des faits, pas un identifiant qui
--     traînait.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  LA fonction. Un seul endroit décide qu'une dérogation vaut quelque chose.
--
--  `p_sujet` est facultatif : certaines dérogations sont générales. Mais si la
--  dérogation DÉSIGNE un sujet, il doit correspondre — une autorisation
--  nominative ne se prête pas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION derogation_opposable(
  p_id    uuid,
  p_type  text,
  p_sujet text DEFAULT NULL
)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM derogations d
     WHERE d.id = p_id
       AND d.type::text = p_type
       AND d.status::text = 'ACTIVE'
       AND d.revoked_at IS NULL
       -- Sans échéance = permanente. Avec échéance = elle cesse d'agir.
       AND (d.expires_at IS NULL OR d.expires_at > now())
       -- Sujet non désigné = générale. Sujet désigné = il doit correspondre.
       AND (d.subject_id IS NULL OR p_sujet IS NULL OR d.subject_id = p_sujet)
  );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION derogation_opposable IS
  'Vrai si la dérogation existe, est du type attendu, est ACTIVE, non révoquée, non expirée, et porte sur le bon sujet (§ 11.2). Tout verrou qui accepte une dérogation DOIT passer par ici.';

/**
 * Motif de refus, rédigé pour l'utilisateur.
 *
 * Dire « dérogation invalide » n'aide personne : il faut dire LAQUELLE des
 * quatre conditions manque, sans quoi on renvoie chercher au hasard.
 */
CREATE OR REPLACE FUNCTION derogation_motif_refus(p_id uuid, p_type text, p_sujet text)
RETURNS text AS $$
DECLARE
  d   record;
  nom text;
BEGIN
  SELECT * INTO d FROM derogations WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN 'la dérogation invoquée n''existe pas';
  END IF;

  -- La table ne porte pas de référence lisible : on désigne la dérogation par
  -- son sujet, ou à défaut par le début de son identifiant. Dire « la
  -- dérogation » sans la nommer obligerait à chercher laquelle.
  nom := COALESCE(d.subject_label, d.subject_id, substr(d.id::text, 1, 8));

  IF d.type::text <> p_type THEN
    RETURN format('la dérogation %s est de type %s, or %s est attendu', nom, d.type, p_type);
  END IF;
  IF d.revoked_at IS NOT NULL OR d.status::text = 'REVOKED' THEN
    RETURN format('la dérogation %s a été RÉVOQUÉE%s', nom,
                  COALESCE(' le ' || to_char(d.revoked_at, 'DD/MM/YYYY'), ''));
  END IF;
  IF d.status::text <> 'ACTIVE' THEN
    RETURN format('la dérogation %s est au statut %s', nom, d.status);
  END IF;
  IF d.expires_at IS NOT NULL AND d.expires_at <= now() THEN
    RETURN format('la dérogation %s a EXPIRÉ le %s', nom,
                  to_char(d.expires_at, 'DD/MM/YYYY'));
  END IF;
  IF d.subject_id IS NOT NULL AND p_sujet IS NOT NULL AND d.subject_id <> p_sujet THEN
    RETURN format('la dérogation porte sur %s, pas sur %s', d.subject_id, p_sujet);
  END IF;
  RETURN 'la dérogation n''est pas opposable';
END;
$$ LANGUAGE plpgsql STABLE;


-- ---------------------------------------------------------------------------
--  LES QUATRE VERROUS L'APPELLENT — mais ils ne sont PAS redéfinis ici.
--
--  Ils vivent dans 05_lot2_invariants.sql et 08_bareme_de_couts.sql, et c'est
--  là qu'ils sont corrigés. Les recopier ici pour « juste changer la
--  vérification de dérogation » obligerait à recopier aussi tout le reste de
--  leur corps — seuils, motifs circonstanciés, messages — et la copie
--  divergerait de l'original à la première évolution. On a failli y perdre
--  l'exigence de motif sur la bande de prix d'achat.
--
--  ⚠️ CE FICHIER EST DONC INJECTÉ AVANT EUX dans chaque migration : la
--     fonction doit exister quand ils l'invoquent.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
--  EXPIRATION AUTOMATIQUE DU STATUT.
--
--  `status` et `expires_at` disaient deux choses différentes : une dérogation
--  échue restait ACTIVE en base. La fonction ci-dessus s'appuie sur les deux,
--  donc le trou était déjà refermé — mais un écran qui lit `status` continuait
--  d'afficher « active » sur une dérogation morte.
--
--  Le statut est donc CALCULÉ à l'écriture, et une vue le rend à jour en
--  lecture. Pas d'ordonnanceur : il n'y en a pas dans cette pile, et en
--  introduire un pour cela seul serait disproportionné.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_derogations_effectives AS
SELECT d.*,
       CASE
         WHEN d.revoked_at IS NOT NULL THEN 'REVOKED'
         WHEN d.status::text <> 'ACTIVE' THEN d.status::text
         WHEN d.expires_at IS NOT NULL AND d.expires_at <= now() THEN 'EXPIRED'
         ELSE 'ACTIVE'
       END AS statut_effectif,
       derogation_opposable(d.id, d.type::text, d.subject_id) AS opposable
  FROM derogations d;

COMMENT ON VIEW v_derogations_effectives IS
  'Dérogations avec leur statut RÉEL à l''instant de la lecture : une dérogation échue reste ACTIVE en colonne, elle ne l''est plus en fait (§ 11.2).';


-- ---------------------------------------------------------------------------
--  REPRISE — ce qui est déjà passé avec une dérogation qui n'ouvrait rien.
--
--  Un déclencheur ne vaut que pour l'avenir. Les affaires approuvées et les
--  opérations parties sous une dérogation révoquée, expirée ou étrangère
--  restent en base, et rien ne les signale. On ne peut pas les défaire — elles
--  ont eu lieu — mais elles doivent être VUES.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_derogations_abusives AS
SELECT 'Affaire approuvée sous le plancher avec une dérogation non opposable' AS regle,
       d.reference AS enregistrement,
       derogation_motif_refus(d.margin_derogation_id, 'MARGIN_BELOW_DIRECT_FLOOR', d.reference) AS detail
  FROM deals d
 WHERE d.status::text = 'APPROVED'
   AND d.margin_derogation_id IS NOT NULL
   AND NOT derogation_opposable(d.margin_derogation_id, 'MARGIN_BELOW_DIRECT_FLOOR', d.reference)

UNION ALL
SELECT 'Affaire approuvée hors bande de prix avec une dérogation non opposable',
       d.reference,
       derogation_motif_refus(d.purchase_price_derogation_id, 'PURCHASE_PRICE_VARIANCE', d.reference)
  FROM deals d
 WHERE d.status::text = 'APPROVED'
   AND d.purchase_price_derogation_id IS NOT NULL
   AND NOT derogation_opposable(d.purchase_price_derogation_id, 'PURCHASE_PRICE_VARIANCE', d.reference)

UNION ALL
SELECT 'Opération partie sous une dérogation HSE non opposable',
       o.reference,
       derogation_motif_refus(o.hse_derogation_id, 'HSE_BLOCKING_OVERRIDE', o.reference)
  FROM operations o
 WHERE o.hse_derogation_id IS NOT NULL
   AND NOT derogation_opposable(o.hse_derogation_id, 'HSE_BLOCKING_OVERRIDE', o.reference)

UNION ALL
SELECT 'Moyens affectés sous une dérogation de conformité non opposable',
       o.reference,
       derogation_motif_refus(a.compliance_derogation_id, 'TRANSPORT_NON_COMPLIANCE', o.reference)
  FROM operation_assignments a
  JOIN operations o ON o.id = a.operation_id
 WHERE a.compliance_derogation_id IS NOT NULL
   AND NOT derogation_opposable(a.compliance_derogation_id, 'TRANSPORT_NON_COMPLIANCE', o.reference);

COMMENT ON VIEW v_derogations_abusives IS
  'Enregistrements passés sous une dérogation qui ne les autorisait pas (§ 11.2). On ne peut pas les défaire ; ils doivent être vus.';


-- ─── 14_conformite_dans_le_temps.sql ─────────────────────────────

-- ===========================================================================
--  LA CONFORMITÉ DOIT SUIVRE LE TEMPS
--  Réf. SPECIFICATIONS.md § 6.4, § 6.6
--
--  ⚠️ LE VERROU DE CONFORMITÉ ÉTAIT AVEUGLE AU TEMPS.
--
--     `derive_compliance_status()` est un déclencheur BEFORE INSERT/UPDATE :
--     le statut est figé À L'ÉCRITURE. `v_transport_compliance` — que le
--     verrou d'affectation interroge — lit le statut STOCKÉ. Et il n'existe
--     aucun ordonnanceur dans cette pile.
--
--     Conséquence démontrée : un permis de conduire expirant le 3 septembre
--     porte le statut EXPIRING. Le 4 septembre, il porte TOUJOURS EXPIRING,
--     `is_compliant` reste vrai, et le chauffeur reste affectable. Il faudrait
--     que quelqu'un réécrive la ligne pour que la base s'aperçoive de la date.
--
--     Autrement dit : le verrou du § 6.4 ne se refermait jamais tout seul.
--
--  LA CORRECTION
--  -------------
--  Le statut est CALCULÉ À LA LECTURE. Pas d'ordonnanceur — il n'y en a pas
--  ici, et en introduire un pour cela seul serait disproportionné et
--  fragile : une tâche qui ne tourne pas laisse le verrou ouvert sans que
--  personne ne le sache. Une vue, elle, est juste à chaque interrogation.
--
--  La colonne `status` est CONSERVÉE : elle sert d'index et d'affichage. Elle
--  reste une projection du dernier calcul ; c'est la vue qui fait foi.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Le statut réel d'une pièce, à l'instant où on le demande.
--
--  Une SUSPENSION est une décision administrative explicite : elle survit au
--  calcul. Le reste se déduit de la date.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compliance_statut_effectif(
  p_status      text,
  p_expiry_date date
)
RETURNS text AS $$
DECLARE
  preavis int;
BEGIN
  IF p_status = 'SUSPENDED' THEN
    RETURN 'SUSPENDED';
  END IF;
  IF p_expiry_date IS NULL THEN
    RETURN 'VALID';
  END IF;
  IF p_expiry_date < CURRENT_DATE THEN
    RETURN 'EXPIRED';
  END IF;

  -- Le préavis est PARAMÉTRÉ (DOC_EXPIRY_ALERT_DAYS). Un agrément douanier et
  -- un permis de conduire ne se renouvellent pas dans les mêmes délais.
  SELECT COALESCE(NULLIF(value, '')::int, 60) INTO preavis
    FROM system_settings WHERE key = 'DOC_EXPIRY_ALERT_DAYS';
  preavis := COALESCE(preavis, 60);

  IF p_expiry_date <= CURRENT_DATE + preavis THEN
    RETURN 'EXPIRING';
  END IF;
  RETURN 'VALID';
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION compliance_statut_effectif IS
  'Statut RÉEL d''une pièce de conformité à l''instant de la lecture (§ 6.4). La colonne `status` n''est qu''une projection du dernier calcul : elle ne se met pas à jour toute seule quand la date passe.';


-- ---------------------------------------------------------------------------
--  LA VUE DU VERROU EST CORRIGÉE À LA SOURCE, dans 03_views_and_functions.sql.
--
--  Elle n'est PAS recopiée ici : recopier une vue de cinquante lignes pour en
--  changer trois, c'est en garantir la divergence — et on s'y est déjà repris
--  à deux fois sur les colonnes exactes. Ce fichier ne porte que ce qui est
--  NEUF ; le correctif vit là où vit la vue.
--
--  ⚠️ CE FICHIER EST DONC INJECTÉ AVANT 03 : la fonction ci-dessus doit
--     exister quand la vue l'invoque.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
--  Pièces dont le statut STOCKÉ ment sur la réalité.
--
--  Aucune tâche ne les rafraîchit — et c'est un choix. Cette vue rend l'écart
--  visible : elle doit rester à zéro sur un système qui écrit régulièrement,
--  et une ligne qui s'y installe signale une pièce que plus personne ne touche.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_conformite_statut_perime AS
SELECT r.id,
       r.reference,
       r.type::text                                          AS nature,
       r.expiry_date,
       r.status::text                                        AS statut_stocke,
       compliance_statut_effectif(r.status::text, r.expiry_date) AS statut_reel,
       r.is_blocking,
       COALESCE(p.legal_name, v.registration, d.full_name)    AS porteur
  FROM compliance_records r
  LEFT JOIN partners p ON p.id = r.partner_id
  LEFT JOIN vehicles v ON v.id = r.vehicle_id
  LEFT JOIN drivers  d ON d.id = r.driver_id
 WHERE r.status::text IS DISTINCT FROM compliance_statut_effectif(r.status::text, r.expiry_date);

COMMENT ON VIEW v_conformite_statut_perime IS
  'Pièces dont la colonne `status` ne dit plus la vérité (§ 6.6). Sans conséquence sur le verrou — il lit le statut effectif — mais un écran qui affiche la colonne induit en erreur.';


-- ---------------------------------------------------------------------------
--  Le préavis d'alerte : une seule valeur, celle qui est paramétrée.
--
--  Trois seuils indépendants coexistaient pour un même paramètre : 60 jours en
--  base, 90 jours codés en dur dans deux écrans, et un troisième à 30 jours
--  pour la teinte d'affichage. Le coordinateur qui ramène le préavis à 30
--  jours ne voyait rien bouger.
--
--  La fonction ci-dessous rend LA valeur ; les écrans doivent la lire au lieu
--  d'en porter une.
-- ---------------------------------------------------------------------------
--  ⚠️ LE REPLI DOIT ÊTRE HORS DU `FROM`, PAS DEDANS.
--
--     `SELECT COALESCE(…, 60) FROM system_settings WHERE key = '…'` ne protège
--     que d'une valeur VIDE. Si la LIGNE est absente, la requête ne rend aucune
--     ligne, la fonction rend NULL, et le repli de 60 jours ne s'applique
--     jamais. Or ce paramètre est administrable : il est supprimable depuis
--     l'écran.
--
--     Constaté en base : paramètre supprimé → `compliance_preavis_jours()` rend
--     NULL → `expiry_date <= CURRENT_DATE + NULL` est NULL → les trois échéances
--     de conformité disparaissent de la file de tâches, dont un contrôle
--     technique PÉRIMÉ qui est bloquant. Le contrôle s'éteint en silence, et
--     c'est la pire façon de s'éteindre.
--
--     Un sous-select scalaire rend NULL quand la ligne manque — et là, le
--     COALESCE fait son travail.
CREATE OR REPLACE FUNCTION compliance_preavis_jours()
RETURNS int AS $$
  SELECT COALESCE(
    (SELECT NULLIF(value, '')::int FROM system_settings WHERE key = 'DOC_EXPIRY_ALERT_DAYS'),
    60
  );
$$ LANGUAGE sql STABLE;


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
WITH pieces AS (
    -- ⚠️ STATUT CALCULÉ, PAS STATUT STOCKÉ.
    --
    --    La colonne `status` est posée par un déclencheur BEFORE INSERT/UPDATE :
    --    elle est figée à la dernière écriture de la pièce. Et il n'y a aucun
    --    ordonnanceur dans cette pile. Un permis expirant le 3 septembre
    --    portait donc encore EXPIRING le 4, `is_compliant` restait vrai, et le
    --    chauffeur restait affectable — indéfiniment, tant que personne ne
    --    réécrivait la ligne. Le verrou du § 6.4 ne se refermait jamais seul.
    --
    --    Calculé ici, il suit le calendrier sans qu'aucune tâche n'ait à
    --    tourner — et une tâche qui ne tourne pas laisse un verrou ouvert sans
    --    que personne ne le sache.
    SELECT partner_id, vehicle_id, driver_id, expiry_date,
           compliance_statut_effectif(status::text, expiry_date) AS statut
      FROM compliance_records
     WHERE is_blocking
),
blocking AS (
    SELECT
        partner_id, vehicle_id, driver_id,
        COUNT(*) FILTER (WHERE statut = 'EXPIRED')   AS expired_count,
        COUNT(*) FILTER (WHERE statut = 'SUSPENDED') AS suspended_count,
        COUNT(*) FILTER (WHERE statut = 'EXPIRING')  AS expiring_count,
        MIN(expiry_date) FILTER (WHERE statut IN ('VALID', 'EXPIRING')) AS next_expiry
      FROM pieces
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
    -- Statut effectif : l'échéancier sert à décider quoi renouveler, il ne
    -- peut pas afficher « en cours de validité » sur une pièce périmée.
    -- Recasté vers l'énumération : `CREATE OR REPLACE VIEW` refuse de changer
    -- le type d'une colonne existante, et les appelants attendent l'énumération.
    compliance_statut_effectif(cr.status::text, cr.expiry_date)::compliance_status AS status,
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
--  Seuils applicables  (§ 5.4)
--
--  La résolution exige une correspondance EXACTE de devise et d'unité : on ne
--  compare pas 30 FCFA/L à une marge exprimée en USD/MT. Le seuil le plus
--  spécifique l'emporte — une ligne portant le produit prime sur une ligne
--  segment seul.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS resolve_margin_threshold(text, uuid, date);
DROP FUNCTION IF EXISTS resolve_margin_threshold(text, uuid, char, text, date);

CREATE OR REPLACE FUNCTION resolve_margin_threshold(
    p_segment    text,
    p_product_id uuid,
    p_currency   char(3),
    p_uom        text,
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
       AND m.currency_code = p_currency
       AND m.uom::text     = p_uom
       AND m.is_active
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
       AND u.is_active
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
  -- Un brouillon sans prix d'achat n'est pas encore contraint : le commercial
  -- construit son devis avant de savoir à qui il achètera.
  --
  -- ⚠️ MAIS CETTE TOLÉRANCE SE REFERME À L'APPROBATION. Sans cela, une affaire
  --    sans prix d'achat affiche une marge égale au prix de vente entier —
  --    765 FCFA/L au lieu de 55 — et franchit tous les seuils. Le dispositif
  --    anti-détournement suppose le prix d'achat SOURCÉ ; il faut donc aussi
  --    exiger qu'il soit PRÉSENT.
  IF NEW.unit_purchase_price = 0 AND NEW.supplier_price_id IS NULL THEN
    IF NEW.credit_approved_by_id IS NOT NULL OR NEW.dg_approved_by_id IS NOT NULL THEN
      RAISE EXCEPTION
        'Le deal % ne porte aucun prix d''achat : la marge affichée vaut le prix de vente entier. Rattacher un prix fournisseur validé avant toute approbation.',
        NEW.reference
        USING ERRCODE = 'check_violation';
    END IF;
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

  -- L'ÉCART AU PRIX VALIDÉ N'EST PLUS INTERDIT ICI (décision du 3 août 2026).
  -- Les conditions du jour ne sont pas celles du barème, et exiger une
  -- nouvelle ligne validée par le DG à chaque variation de cours ferait
  -- attendre le commercial pour chiffrer.
  --
  -- Ce que cet invariant garantit reste entier : le prix est ADOSSÉ à une
  -- ligne fournisseur validée, du bon produit, en vigueur. L'ampleur de
  -- l'écart, elle, relève de la bande de tolérance — voir
  -- `enforce_purchase_price_band` dans 08_bareme_de_couts.sql, qui exige un
  -- motif au-delà et une dérogation du DG pour approuver.

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deal_purchase_price_sourced ON deals;
-- Les colonnes d'APPROBATION sont surveillées au même titre que le prix :
-- la tolérance accordée au brouillon doit se refermer au moment précis où
-- quelqu'un engage l'entreprise, et ce moment est une écriture sur ces
-- colonnes-là, pas sur le prix.
CREATE TRIGGER trg_deal_purchase_price_sourced
  BEFORE INSERT OR UPDATE OF unit_purchase_price, supplier_price_id, product_id,
                             credit_approved_by_id, dg_approved_by_id ON deals
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

  IF NOT economics_changed THEN
    RETURN NEW;
  END IF;

  -- ⚠️ L'ACCORD DU DG SURVIVAIT À UNE BAISSE DE PRIX.
  --
  --    La condition portait sur `credit_approved_by_id` : rien ne se
  --    déclenchait tant que le CFO n'avait pas approuvé. Or la séquence
  --    normale est SOUMISSION → ACCORD DU DG SUR MARGE BASSE → APPROBATION
  --    CFO. Dans cette fenêtre — celle qui compte — le garde-fou ne s'armait
  --    jamais.
  --
  --    Conséquence démontrée : le DG arbitre sur 28 FCFA/L, le prix baisse de
  --    15, l'affaire s'engage à 13 sans que rien ne signale que la décision
  --    portait sur autre chose. Sur 10 000 000 L : 150 000 000 FCFA.
  --
  --    Un accord porte sur une ÉCONOMIE, pas sur un numéro d'affaire. Que
  --    l'économie change, et l'accord ne porte plus sur rien.
  IF OLD.credit_approved_by_id IS NULL AND OLD.dg_approved_by_id IS NULL THEN
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
          CASE
            WHEN OLD.credit_approved_by_id IS NOT NULL
              THEN 'Approbation annulée : modification des conditions économiques après approbation.'
            ELSE 'Accord du DG annulé : les conditions économiques ont changé depuis son arbitrage.'
          END);

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

  -- Une dérogation HSE du DG lève le verrou (§ 11.2) — SI ELLE EST OPPOSABLE.
  --
  -- ⚠️ La seule présence d'un identifiant suffisait. Une dérogation révoquée,
  --    expirée, ou accordée pour une AUTRE opération ouvrait donc le verrou
  --    HSE avant chargement, indéfiniment. C'est la pièce qu'un assureur
  --    demande après un incident : elle doit avoir été valide au moment des
  --    faits, pas avoir simplement existé un jour.
  IF NEW.hse_derogation_id IS NOT NULL THEN
    IF derogation_opposable(NEW.hse_derogation_id, 'HSE_BLOCKING_OVERRIDE', NEW.reference) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'VERROU HSE — l''opération % invoque une dérogation qui ne l''ouvre pas : %. Le verrou reste fermé.',
      NEW.reference,
      derogation_motif_refus(NEW.hse_derogation_id, 'HSE_BLOCKING_OVERRIDE', NEW.reference)
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.hse_validated_by_id IS NULL AND NEW.hse_validated_by_user_id IS NULL THEN
    RAISE EXCEPTION
      'VERROU HSE — l''opération % ne peut pas passer au chargement : contrôles non validés.',
      NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  -- ⚠️ UNE VALIDATION SANS AUCUN POINT DE CONTRÔLE EST UNE SIGNATURE À VIDE.
  --
  --    Le comptage ci-dessous ne peut refuser que ce qu'il trouve : sur une
  --    opération DÉPOURVUE de points, il rend 0 et le verrou s'ouvre. Le
  --    contrôle HSE se réduit alors à une case cochée par le contrôleur, sur
  --    rien.
  --
  --    Le cas n'est pas théorique : les points naissent d'un modèle de
  --    checklist, et un modèle ne s'applique qu'aux segments et modes de
  --    transport qu'il déclare. Aujourd'hui, un seul modèle existe — B2B et
  --    RETAIL, par camion. Une opération MARITIME n'en trouve aucun, donc
  --    n'obtient aucun point, donc franchit le verrou dès qu'on la valide.
  --
  --    C'est exactement la pièce qu'un assureur réclame après un incident.
  --    Mieux vaut refuser le départ que produire une attestation vide.
  SELECT count(*) INTO pending
    FROM operation_hse_check_items i
    JOIN operation_hse_checks c ON c.id = i.check_id
   WHERE c.operation_id = NEW.id;

  IF pending = 0 THEN
    RAISE EXCEPTION
      'VERROU HSE — l''opération % ne porte AUCUN point de contrôle : la validation ne s''appuierait sur rien. Vérifier qu''un modèle de checklist couvre son segment et son mode de transport.',
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
  -- Dérogation du DG — le rôle a été vérifié à sa création, mais elle doit
  -- ENCORE être valide aujourd'hui : révoquée ou échue, elle n'autorise plus
  -- l'affectation d'un moyen non conforme.
  IF NEW.compliance_derogation_id IS NOT NULL THEN
    IF derogation_opposable(NEW.compliance_derogation_id, 'TRANSPORT_NON_COMPLIANCE', NULL) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'CONFORMITÉ — l''affectation invoque une dérogation qui ne l''autorise pas : %. Les moyens doivent être conformes.',
      derogation_motif_refus(NEW.compliance_derogation_id, 'TRANSPORT_NON_COMPLIANCE', NULL)
      USING ERRCODE = 'check_violation';
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
       -- La tolérance DÉRIVE de la devise : une demi-unité de la plus petite
       -- subdivision en circulation. Un 0,01 en dur ne tolère RIEN en XOF —
       -- qui n'a pas de centime — et tolère arbitrairement ailleurs.
       CHECK (abs(gross_amount - billed_volume * unit_price)
              <= tolerance_arrondi(currency_code)),

  -- Total = brut − réduction.
  DROP CONSTRAINT IF EXISTS chk_invoices_total_derived,
  ADD  CONSTRAINT chk_invoices_total_derived
       CHECK (abs(total_amount - (gross_amount - discount_amount))
              <= tolerance_arrondi(currency_code)),

  -- TVA EXTRAITE du total : total × taux ÷ (100 + taux).
  DROP CONSTRAINT IF EXISTS chk_invoices_vat_extracted,
  ADD  CONSTRAINT chk_invoices_vat_extracted
       CHECK (
         NOT is_vat_applicable
         OR abs(vat_amount - total_amount * vat_rate_pct / (100 + vat_rate_pct))
            <= tolerance_arrondi(currency_code)
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
       ),

  -- Une pièce référence une affaire, une demande de cotation, ou les deux
  -- (la proforma approuvée les porte l'une et l'autre après conversion) -
  -- jamais ni l'une ni l'autre (§ discussion 17/08).
  DROP CONSTRAINT IF EXISTS chk_invoices_deal_or_quotation,
  ADD  CONSTRAINT chk_invoices_deal_or_quotation
       CHECK (deal_id IS NOT NULL OR quotation_request_id IS NOT NULL),

  -- Une demande de cotation n'engage rien avant l'affaire : seule une
  -- proforma peut y répondre, jamais une pièce définitive.
  DROP CONSTRAINT IF EXISTS chk_invoices_quotation_requires_proforma,
  ADD  CONSTRAINT chk_invoices_quotation_requires_proforma
       CHECK (quotation_request_id IS NULL OR type::text = 'PROFORMA');

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


-- ---------------------------------------------------------------------------
--  I. SEUILS DE MARGE — LE VERROU QUI MANQUAIT  (§ 5.4)
--
--  Deux seuils, deux effets radicalement différents :
--
--    PLANCHER DIRECT (10 FCFA/L) — marge après charges DIRECTES et portage.
--      En dessous, l'opération ne couvre pas ses propres coûts augmentés
--      d'un coussin de risque. Deux aléas ordinaires — un ullage au seuil de
--      tolérance, une provision pour litige — effacent la marge. C'est une
--      prise de risque non rémunérée : BLOCAGE DUR, levée par le DG seul.
--
--    SEUIL MINIMUM (30 FCFA/L) — marge après absorption des INDIRECTES.
--      En dessous, l'affaire couvre ses coûts directs et contribue
--      partiellement aux frais fixes. Elle reste bonne à prendre : refuser
--      sur une clé de répartition — qui est une convention — détruirait de la
--      valeur. ACCORD DU DG, pas un refus.
--
--  Entre les deux se trouve la zone d'arbitrage : c'est là qu'une décision
--  humaine a du sens.
--
--  Le contrôle se déclenche À L'APPROBATION : c'est le moment où l'affaire
--  engage l'entreprise.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_margin_thresholds()
RETURNS TRIGGER AS $$
DECLARE
  t          RECORD;
  derog_type text;
BEGIN
  -- Tant que l'affaire n'est pas approuvée, elle se travaille librement.
  IF NEW.credit_approved_by_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- La résolution exige la devise ET l'unité du deal : on ne compare jamais
  -- deux grandeurs hétérogènes, et on ne convertit pas en silence — une
  -- conversion implicite rendrait le verrou incompréhensible quand il bloque.
  SELECT direct_floor, minimum_margin, currency_code, uom
    INTO t
    FROM resolve_margin_threshold(NEW.segment::text, NEW.product_id,
                                  NEW.currency_code, NEW.uom::text, CURRENT_DATE);

  IF t IS NULL THEN
    -- ⚠️ DEUX ABSENCES DIFFÉRENTES, DEUX RÉPONSES DIFFÉRENTES.
    --
    --    « Jamais configuré » et « coupé par paramétrage » (is_active = false,
    --    § 1.1 bis) rendaient TOUS DEUX un ensemble vide côté
    --    `resolve_margin_threshold` — le blocage de repli s'appliquait aux
    --    deux indifféremment. Constaté à l'exécution (audit, axe A, S3) :
    --    désactiver l'unique seuil d'un segment bloquait TOUTES ses
    --    approbations au lieu de couper le contrôle, à l'inverse exact de ce
    --    que l'écran de paramétrage promet (« coupe le seuil »).
    --
    --    Un seuil qui EXISTE mais qu'on a désactivé EXPRÈS est une décision ;
    --    l'absence totale de ligne est un oubli. La première ne doit rien
    --    bloquer, la seconde doit continuer à tout bloquer — c'est le
    --    fail-safe d'origine, non remis en cause.
    IF EXISTS (
      SELECT 1
        FROM margin_thresholds m
       WHERE m.segment::text = NEW.segment::text
         AND (m.product_id IS NULL OR m.product_id = NEW.product_id)
         AND m.currency_code = NEW.currency_code
         AND m.uom::text     = NEW.uom::text
         AND m.effective_from <= CURRENT_DATE
         AND (m.effective_to IS NULL OR m.effective_to >= CURRENT_DATE)
         AND NOT m.is_active
    ) THEN
      RETURN NEW; -- Contrôle coupé par paramétrage : pas un oubli, on ne bloque pas.
    END IF;

    RAISE EXCEPTION
      'Aucun seuil de marge configuré pour le segment % en %/%. Le deal % ne peut pas être approuvé tant que ce seuil n''existe pas.',
      NEW.segment, NEW.currency_code, NEW.uom, NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  -- --- Plancher direct : BLOCAGE DUR -------------------------------------
  IF t.direct_floor IS NOT NULL AND NEW.estimated_direct_margin < t.direct_floor THEN
    IF NEW.margin_derogation_id IS NULL THEN
      RAISE EXCEPTION
        'PLANCHER DIRECT — le deal % dégage % %/% après charges directes et portage, sous le plancher de %. L''opération ne couvre pas ses coûts : blocage. Une dérogation du DG est requise.',
        NEW.reference, round(NEW.estimated_direct_margin, 2), t.currency_code, t.uom,
        round(t.direct_floor, 2)
        USING ERRCODE = 'check_violation';
    END IF;

    -- Le TYPE seul était vérifié : une dérogation du bon type mais révoquée,
    -- expirée, ou accordée pour une autre affaire franchissait le plancher.
    IF NOT derogation_opposable(
             NEW.margin_derogation_id, 'MARGIN_BELOW_DIRECT_FLOOR', NEW.reference) THEN
      RAISE EXCEPTION
        'PLANCHER DIRECT — le deal % ne peut pas être approuvé sous le plancher : %.',
        NEW.reference,
        derogation_motif_refus(
          NEW.margin_derogation_id, 'MARGIN_BELOW_DIRECT_FLOOR', NEW.reference)
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- --- Seuil minimum : accord du DG, pas un refus ------------------------
  IF t.minimum_margin IS NOT NULL AND NEW.estimated_full_margin < t.minimum_margin THEN
    IF NEW.dg_approved_by_id IS NULL THEN
      RAISE EXCEPTION
        'SEUIL DE MARGE — le deal % dégage % %/% après absorption des charges indirectes, sous le seuil de %. L''accord du DG est requis.',
        NEW.reference, round(NEW.estimated_full_margin, 2), t.currency_code, t.uom,
        round(t.minimum_margin, 2)
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deal_margin_thresholds ON deals;
CREATE TRIGGER trg_deal_margin_thresholds
  BEFORE INSERT OR UPDATE OF credit_approved_by_id, estimated_direct_margin,
                             estimated_full_margin, segment, product_id,
                             margin_derogation_id, dg_approved_by_id ON deals
  FOR EACH ROW EXECUTE FUNCTION enforce_margin_thresholds();


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


-- ─── 07_apurement_avances.sql ────────────────────────────────────

-- ===========================================================================
--  APUREMENT AUTOMATIQUE DES AVANCES FOURNISSEURS
--  Réf. SPECIFICATIONS.md § 14.6
--
--  Elyon règle ses fournisseurs AVANT livraison. Le montant sorti reste une
--  IMMOBILISATION DE TRÉSORERIE tant qu'aucune contrepartie n'est constatée.
--
--  Le problème que ce fichier résout : tant que l'apurement est un acte
--  déclaratif — quelqu'un saisit une date — l'indicateur peut être remis à
--  zéro sans qu'un litre soit arrivé. Un indicateur de trésorerie qu'on
--  assainit par saisie ne mesure plus la trésorerie.
--
--  TROIS RÈGLES, arrêtées avec la direction le 3 août 2026 :
--
--    A. Avance SUR MARCHANDISE  → apurée au CHARGEMENT CONSTATÉ de
--       l'opération, AU PRORATA du volume enlevé rapporté au volume commandé.
--
--    B. Avance SANS MARCHANDISE (fret, inspection, douane) → apurée à la
--       CLÔTURE de l'opération : la prestation est alors rendue.
--
--    C. Le prorata est REVU à la baisse ou à la hausse dès qu'un relevé
--       faisant autorité donne le volume réellement chargé.
--
--  Porté par PostgreSQL et non par le service : une écriture directe, un
--  script d'administration ou une refonte de l'API ne peuvent pas l'esquiver.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Reprise des lignes antérieures.
--
--  Avant ce fichier, l'apurement se réduisait à une DATE : les avances soldées
--  portent donc `settled_at` et un montant apuré resté à zéro. La contrainte
--  ci-dessous les refuserait. On les aligne d'abord — une migration doit
--  emporter sa propre réconciliation de données, sinon elle ne passe que sur
--  une base vierge.
--
--  Idempotent : la clause WHERE ne retient que les lignes non conformes.
-- ---------------------------------------------------------------------------
UPDATE supplier_invoices
   SET settled_amount = prepaid_amount
 WHERE settled_at IS NOT NULL
   AND settled_amount < prepaid_amount;

ALTER TABLE supplier_invoices
  DROP CONSTRAINT IF EXISTS chk_supplier_invoice_settled_bounds,
  ADD  CONSTRAINT chk_supplier_invoice_settled_bounds
       CHECK (settled_amount >= 0 AND settled_amount <= prepaid_amount),

  -- Une date d'apurement intégral n'a de sens que si tout est apuré.
  DROP CONSTRAINT IF EXISTS chk_supplier_invoice_settled_complete,
  ADD  CONSTRAINT chk_supplier_invoice_settled_complete
       CHECK (settled_at IS NULL OR settled_amount >= prepaid_amount - 0.01);

COMMENT ON COLUMN supplier_invoices.settled_amount IS
  'Part de l''avance apurée par une contrepartie physiquement constatée. Dérivée par trigger — ne pas saisir à la main.';


-- ---------------------------------------------------------------------------
--  Reliquat d'avance : ce qui pèse encore au besoin en fonds de roulement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION outstanding_advance(invoice_id uuid)
RETURNS numeric AS $$
  SELECT GREATEST(0, si.prepaid_amount - si.settled_amount)
    FROM supplier_invoices si
   WHERE si.id = invoice_id;
$$ LANGUAGE sql STABLE;


-- ---------------------------------------------------------------------------
--  Apurement au prorata d'un volume constaté.
--
--  Le ratio est BORNÉ À 1 : enlever davantage que le volume commandé n'apure
--  jamais plus que ce qui a été avancé. Un volume commandé absent ou nul fait
--  retomber sur un apurement intégral — à défaut de base de calcul, on ne
--  laisse pas une avance traîner indéfiniment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_advance_settlement(
  p_invoice_id uuid,
  p_ordered_volume numeric,
  p_actual_volume numeric,
  p_settled_on date
) RETURNS void AS $$
DECLARE
  ratio numeric;
  prepaid numeric;
  target numeric;
BEGIN
  SELECT prepaid_amount INTO prepaid FROM supplier_invoices WHERE id = p_invoice_id;
  IF prepaid IS NULL OR prepaid <= 0 THEN
    RETURN; -- rien n'a été avancé : il n'y a rien à apurer
  END IF;

  IF p_ordered_volume IS NULL OR p_ordered_volume <= 0 THEN
    ratio := 1;
  ELSE
    ratio := LEAST(1, GREATEST(0, COALESCE(p_actual_volume, 0) / p_ordered_volume));
  END IF;

  target := ROUND(prepaid * ratio, 4);

  UPDATE supplier_invoices
     SET settled_amount = target,
         -- La date ne se pose qu'à l'apurement INTÉGRAL : un reliquat pèse
         -- encore, et le laisser paraître soldé fausserait le BFR.
         settled_at = CASE
                        WHEN target >= prepaid - 0.01 THEN p_settled_on
                        ELSE NULL
                      END
   WHERE id = p_invoice_id;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
--  A + B. Déclenchement sur le cycle de vie de l'opération.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION settle_advances_on_operation()
RETURNS TRIGGER AS $$
DECLARE
  r RECORD;
  loaded numeric;
BEGIN
  IF OLD.status::text = NEW.status::text THEN
    RETURN NEW;
  END IF;

  -- ----- A. Avances SUR MARCHANDISE, au chargement constaté ---------------
  IF NEW.status::text = 'LOADING' THEN
    -- Volume retenu : celui du relevé faisant autorité s'il existe déjà,
    -- sinon le volume prévu de l'opération. La règle C corrigera plus tard.
    SELECT m.loaded_volume_15 INTO loaded
      FROM measurement_records m
     WHERE m.operation_id = NEW.id AND m.is_authoritative
     LIMIT 1;
    loaded := COALESCE(loaded, NEW.planned_volume);

    FOR r IN
      SELECT si.id AS invoice_id, po.ordered_volume
        FROM supplier_invoices si
        JOIN purchase_orders po ON po.id = si.purchase_order_id
       WHERE po.operation_id = NEW.id
         AND si.prepaid_amount > 0
         AND si.settled_at IS NULL
    LOOP
      PERFORM apply_advance_settlement(
        r.invoice_id, r.ordered_volume, loaded,
        COALESCE(NEW.actual_loading_date, CURRENT_DATE)
      );
    END LOOP;
  END IF;

  -- ----- B. Avances SANS MARCHANDISE, à la clôture -------------------------
  --
  -- Fret, inspection, douane : aucune réception physique n'existe. Leur
  -- contrepartie est la prestation rendue, donc la fin de la rotation. On les
  -- reconnaît à l'absence de commande d'achat.
  IF NEW.status::text = 'CLOSED' THEN
    FOR r IN
      SELECT si.id AS invoice_id
        FROM supplier_invoices si
       WHERE si.deal_id = NEW.deal_id
         AND si.purchase_order_id IS NULL
         AND si.prepaid_amount > 0
         AND si.settled_at IS NULL
    LOOP
      PERFORM apply_advance_settlement(
        r.invoice_id, NULL, NULL, COALESCE(NEW.closed_at::date, CURRENT_DATE)
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_settle_advances_on_operation ON operations;
CREATE TRIGGER trg_settle_advances_on_operation
  AFTER UPDATE OF status ON operations
  FOR EACH ROW EXECUTE FUNCTION settle_advances_on_operation();


-- ---------------------------------------------------------------------------
--  C. Révision du prorata au relevé faisant autorité.
--
--  Le volume prévu sert d'estimation au chargement ; le volume mesuré fait
--  foi. Dès qu'il est connu, l'apurement est recalculé — à la hausse comme à
--  la baisse. Sans cela, un enlèvement inférieur au prévu laisserait croire
--  l'avance soldée alors qu'une part reste immobilisée.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION revise_advances_on_measurement()
RETURNS TRIGGER AS $$
DECLARE
  r RECORD;
  op RECORD;
BEGIN
  IF NOT NEW.is_authoritative THEN
    RETURN NEW;
  END IF;

  SELECT id, status, actual_loading_date INTO op
    FROM operations WHERE id = NEW.operation_id;

  -- Avant le chargement, il n'y a rien à réviser : rien n'a été apuré.
  IF op.status::text NOT IN ('LOADING', 'IN_TRANSIT', 'DELIVERING', 'FINAL_CHECK', 'CLOSED') THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT si.id AS invoice_id, po.ordered_volume
      FROM supplier_invoices si
      JOIN purchase_orders po ON po.id = si.purchase_order_id
     WHERE po.operation_id = NEW.operation_id
       AND si.prepaid_amount > 0
  LOOP
    PERFORM apply_advance_settlement(
      r.invoice_id, r.ordered_volume, NEW.loaded_volume_15,
      COALESCE(op.actual_loading_date, NEW.measurement_date)
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_revise_advances_on_measurement ON measurement_records;
CREATE TRIGGER trg_revise_advances_on_measurement
  AFTER INSERT OR UPDATE OF loaded_volume_15, is_authoritative ON measurement_records
  FOR EACH ROW EXECUTE FUNCTION revise_advances_on_measurement();


-- ---------------------------------------------------------------------------
--  Vue de pilotage : la trésorerie réellement immobilisée.
--
--  Elle ne montre QUE le reliquat. Une avance partiellement apurée y figure
--  pour ce qui reste, jamais pour son montant d'origine.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_outstanding_advances AS
SELECT
  si.id,
  si.reference,
  p.legal_name                                   AS supplier,
  d.reference                                    AS deal,
  si.currency_code,
  si.prepaid_amount,
  si.settled_amount,
  (si.prepaid_amount - si.settled_amount)        AS outstanding_amount,
  ROUND((si.prepaid_amount - si.settled_amount) * si.fx_rate_to_pivot, 4)
                                                 AS outstanding_pivot,
  si.prepaid_at,
  (CURRENT_DATE - si.prepaid_at)                 AS days_outstanding,
  -- Ce qui apurera cette avance, pour que l'utilisateur sache quoi attendre.
  CASE
    WHEN si.purchase_order_id IS NOT NULL THEN 'Chargement de l''opération'
    WHEN si.deal_id IS NOT NULL           THEN 'Clôture de l''opération'
    ELSE 'Apurement manuel — facture rattachée à aucun dossier'
  END                                            AS settlement_trigger,
  o.reference                                    AS operation,
  o.status::text                                 AS operation_status
FROM supplier_invoices si
JOIN partners p          ON p.id = si.supplier_id
LEFT JOIN deals d        ON d.id = si.deal_id
LEFT JOIN purchase_orders po ON po.id = si.purchase_order_id
LEFT JOIN operations o   ON o.id = po.operation_id
WHERE si.prepaid_amount > si.settled_amount + 0.01
ORDER BY si.prepaid_at;

COMMENT ON VIEW v_outstanding_advances IS
  'Trésorerie immobilisée par les prépaiements fournisseurs (§ 14.6) : reliquat seul, jamais le montant d''origine. Chez Elyon ce sont les AVANCES qui pèsent au BFR, pas les dettes.';


-- ─── 08_bareme_de_couts.sql ──────────────────────────────────────

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


-- ─── 09_reprise_invariants.sql ───────────────────────────────────

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


-- ─── 10_types_operation.sql ──────────────────────────────────────

-- ===========================================================================
--  TYPES D'OPÉRATION ET RÉSOLUTION DES CONTRÔLES HSE
--  Réf. SPECIFICATIONS.md § 7.1, § 10.4
--
--  Principe arrêté avec la direction le 5 août 2026 :
--
--    « Une opération porte sur un segment et son type est indiqué lors de sa
--      création, cela permet d'indexer la liste des contrôles HSE à lui
--      adjoindre. Une opération peut porter plusieurs types — elle peut
--      commencer par un transport routier et se terminer par un soutage à
--      quai. »
--
--  D'où l'UNION dédoublonnée : les contrôles applicables sont ceux de TOUS les
--  types portés. Un type unique aurait obligé à créer un type composite par
--  combinaison rencontrée — ingérable dès la troisième.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Cohérence des types et de leur rattachement.
-- ---------------------------------------------------------------------------
ALTER TABLE operation_type_assignments
  DROP CONSTRAINT IF EXISTS chk_operation_type_sequence,
  ADD  CONSTRAINT chk_operation_type_sequence CHECK (sequence >= 1);

COMMENT ON TABLE operation_types IS
  'Types d''opération administrables (§ 7.1). Ils indexent les contrôles HSE ; une opération en porte plusieurs.';
COMMENT ON COLUMN operation_type_assignments.sequence IS
  'Rang dans le déroulé — 1 pour le transport routier, 2 pour le soutage à quai. Détermine l''ordre de présentation des checklists à l''agent.';


-- ---------------------------------------------------------------------------
--  Contrôles HSE applicables à une opération.
--
--  UNION des checklists de tous les types portés, dédoublonnée par PHASE et
--  par POINT DE CONTRÔLE. Deux types qui exigent tous deux la vérification des
--  extincteurs ne la font pas passer deux fois — l'agent la ferait une fois et
--  la seconde resterait éternellement en attente, bloquant l'opération.
--
--  Le NIVEAU retenu en cas de doublon est le PLUS CONTRAIGNANT : si un type
--  déclare le point bloquant et l'autre simplement obligatoire, il est
--  bloquant. Retenir l'inverse reviendrait à ce qu'ajouter un type au déroulé
--  AFFAIBLISSE le contrôle — l'exact contraire de l'intention.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_hse_checklist(p_operation_id uuid)
RETURNS TABLE (
  template_id      uuid,
  template_code    text,
  template_version smallint,
  item_id          uuid,
  item_code        text,
  item_label       text,
  phase            text,
  level            text,
  requires_photo   boolean,
  requires_value   boolean,
  value_label      text,
  requires_signature boolean,
  display_order    smallint,
  from_types       text
) AS $$
  WITH contexte AS (
    SELECT o.id,
           o.hse_risk_level,
           o.transport_mode,
           d.segment
      FROM operations o
      JOIN deals d ON d.id = o.deal_id
     WHERE o.id = p_operation_id
  ),
  -- Modèles couvrant l'un des types portés, et compatibles avec le contexte.
  modeles AS (
    SELECT DISTINCT t.id, t.code, t.version, ot.code AS type_code
      FROM operation_type_assignments a
      JOIN operation_types ot ON ot.id = a.operation_type_id
      JOIN "_ChecklistOperationTypes" j ON j."B" = ot.id
      JOIN hse_checklist_templates t ON t.id = j."A"
      CROSS JOIN contexte c
     WHERE a.operation_id = p_operation_id
       AND t.is_active AND t.is_current
       -- COALESCE : `cardinality(NULL)` vaut NULL, pas zéro. Sans lui, un
       -- modèle « applicable à tout » ne s'applique à RIEN.
       AND (COALESCE(cardinality(t.applicable_segments), 0) = 0
            OR c.segment = ANY (t.applicable_segments))
       AND (COALESCE(cardinality(t.applicable_transport_modes), 0) = 0
            OR c.transport_mode = ANY (t.applicable_transport_modes))
       AND (COALESCE(cardinality(t.applicable_risk_levels), 0) = 0
            OR c.hse_risk_level = ANY (t.applicable_risk_levels))
  ),
  points AS (
    SELECT m.id AS template_id, m.code AS template_code, m.version AS template_version,
           i.id AS item_id, i.code AS item_code, i.label AS item_label,
           i.phase::text, i.level::text, i.requires_photo, i.requires_value,
           i.value_label, i.requires_signature, i.display_order,
           m.type_code
      FROM modeles m
      JOIN hse_checklist_items i ON i.template_id = m.id
     WHERE i.is_active
  )
  SELECT DISTINCT ON (phase, item_code)
         template_id, template_code, template_version,
         item_id, item_code, item_label, phase,
         -- BLOCKING l'emporte : ajouter un type ne doit jamais affaiblir.
         (CASE WHEN bool_or(level = 'BLOCKING')
                    OVER (PARTITION BY phase, item_code)
               THEN 'BLOCKING' ELSE level END) AS level,
         requires_photo, requires_value, value_label, requires_signature,
         display_order,
         string_agg(type_code, ', ') OVER (PARTITION BY phase, item_code) AS from_types
    FROM points
   ORDER BY phase, item_code, (level = 'BLOCKING') DESC, display_order;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION resolve_hse_checklist IS
  'Contrôles HSE applicables à une opération : union dédoublonnée des checklists de tous ses types, le niveau le plus contraignant l''emportant (§ 7.1).';


-- ---------------------------------------------------------------------------
--  REPRISE — sans elle, le déclencheur ci-dessous fige l'existant.
--
--  Un déclencheur ne vaut que pour les écritures POSTÉRIEURES à sa création.
--  Les opérations déjà en base ne portent, elles, aucun type : à la première
--  tentative d'avancement, elles seraient refusées — et rien dans l'écran
--  n'expliquerait pourquoi une opération qui circulait hier ne circule plus.
--
--  Trois temps :
--    1. amorcer un type par mode de transport, LU DANS L'ÉNUMÉRATION et non
--       recopié — un mode ajouté plus tard obtient son type sans intervention ;
--    2. rattacher les modèles de checklist existants aux types correspondant
--       aux modes qu'ils déclarent déjà couvrir ;
--    3. typer les opérations existantes d'après leur mode de transport.
--
--  Les libellés amorcés sont modifiables à l'écran : ce sont des valeurs de
--  départ, pas des constantes de code.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  -- Correspondance mode de transport → type d'opération amorcé. Écrite UNE
  -- fois : les trois temps ci-dessous s'en servent, et une recopie finirait
  -- par diverger d'une étape à l'autre.
  CREATE TEMP TABLE amorce_types (mode text, code text, label text, description text)
    ON COMMIT DROP;
  INSERT INTO amorce_types VALUES
    ('TRUCK',     'ROUTE',    'Transport routier',
     'Acheminement par camion-citerne, du dépôt au site du client.'),
    ('BUNKERING', 'SOUTAGE',  'Soutage à quai',
     'Avitaillement d''un navire à quai ou en rade.'),
    ('BARGE',     'BARGE',    'Transport par barge',
     'Acheminement fluvial ou lagunaire.'),
    ('PIPELINE',  'PIPELINE', 'Transfert par pipeline',
     'Mouvement de produit par canalisation entre deux points de stockage.'),
    ('RAIL',      'RAIL',     'Transport ferroviaire',
     'Acheminement par wagon-citerne.');

  -- 1. Un type par mode de transport PRÉSENT DANS L'ÉNUMÉRATION. Un mode
  --    ajouté au schéma plus tard obtient son type sans intervention : à
  --    défaut de libellé, il porte son propre code, que l'écran corrige.
  --    id et updated_at sont produits ici : @default(uuid()) et @updatedAt sont
  --    tenus par Prisma, pas par la colonne — un INSERT en SQL direct
  --    violerait la contrainte NOT NULL.
  INSERT INTO operation_types
         (id, code, label, description, segments, display_order, is_active, updated_at)
  SELECT gen_random_uuid(),
         COALESCE(a.code, e.enumlabel::text),
         COALESCE(a.label, e.enumlabel::text),
         a.description,
         '{}'::"commercial_segment"[],   -- vide = tous segments
         (e.enumsortorder * 10)::int,
         true,
         now()
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid AND t.typname = 'transport_mode'
    LEFT JOIN amorce_types a ON a.mode = e.enumlabel::text
   ON CONFLICT (code) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Amorce : % type(s) d''opération.', n; END IF;

  -- 2. Modèles de checklist rattachés à AUCUN type : on les relie aux types
  --    correspondant aux modes qu'ils déclarent déjà couvrir. Un modèle
  --    volontairement détaché par un administrateur n'est pas repris — il
  --    porte au moins un rattachement, donc la condition l'écarte.
  INSERT INTO "_ChecklistOperationTypes" ("A", "B")
  SELECT DISTINCT t.id, ot.id
    FROM hse_checklist_templates t
    CROSS JOIN LATERAL unnest(t.applicable_transport_modes) AS tm
    JOIN amorce_types a  ON a.mode = tm::text
    JOIN operation_types ot ON ot.code = a.code
   WHERE NOT EXISTS (
     SELECT 1 FROM "_ChecklistOperationTypes" j WHERE j."A" = t.id
   )
   ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Reprise : % rattachement(s) modèle → type.', n; END IF;

  -- 3. Opérations existantes : un type déduit de leur mode de transport.
  INSERT INTO operation_type_assignments (id, operation_id, operation_type_id, sequence)
  SELECT gen_random_uuid(), o.id, ot.id, 1
    FROM operations o
    JOIN amorce_types a  ON a.mode = o.transport_mode::text
    JOIN operation_types ot ON ot.code = a.code
   WHERE NOT EXISTS (
     SELECT 1 FROM operation_type_assignments a2 WHERE a2.operation_id = o.id
   )
   ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Reprise : % opération(s) typée(s) d''après leur mode.', n; END IF;

  -- 4. Provenance des points déjà contrôlés. Elle était portée par la
  --    checklist, qui n'avait alors qu'un modèle ; elle descend au point, où
  --    elle reste vraie quel que soit le nombre de types portés. Sans cette
  --    reprise, tout ce qui a été contrôlé jusqu'ici perdrait la version du
  --    modèle sous lequel il l'a été.
  UPDATE operation_hse_check_items i
     SET source_template_id      = c.template_id,
         source_template_version = c.template_version
    FROM operation_hse_checks c
   WHERE c.id = i.check_id
     AND i.source_template_id IS NULL
     AND c.template_id IS NOT NULL;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Reprise : provenance figée sur % point(s) déjà contrôlé(s).', n; END IF;

  DROP TABLE amorce_types;
END $$;


-- ---------------------------------------------------------------------------
--  Une opération doit porter au moins un type dès qu'elle quitte le brouillon.
--
--  Sans type, aucune checklist ne s'attache : l'opération traverserait tout le
--  déroulé sans qu'aucun contrôle ne lui soit jamais opposé. Le verrou HSE
--  serait vide de contenu — et il passerait, faute de point bloquant à
--  satisfaire.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_operation_has_type()
RETURNS TRIGGER AS $$
DECLARE
  nb int;
BEGIN
  IF NEW.status::text = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD.status::text = NEW.status::text THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO nb
    FROM operation_type_assignments WHERE operation_id = NEW.id;

  IF nb = 0 THEN
    RAISE EXCEPTION
      'L''opération % ne porte aucun type : aucun contrôle HSE ne peut lui être adjoint, et le verrou serait vide de contenu. Indiquer au moins un type avant de la faire avancer.',
      NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_operation_has_type ON operations;
CREATE TRIGGER trg_operation_has_type
  BEFORE UPDATE OF status ON operations
  FOR EACH ROW EXECUTE FUNCTION enforce_operation_has_type();


-- ---------------------------------------------------------------------------
--  Purge du résidu de recette.
--
--  Les campagnes de test ont laissé des grilles de seuils datées de 2039 à
--  2059. Elles ne gouvernent rien — aucune affaire ne porte ces dates — mais
--  elles rendent l'écran de paramétrage illisible, et un écran illisible finit
--  par n'être plus lu.
--
--  Idempotent : sur une base propre, ne fait rien.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  touched int;
BEGIN
  DELETE FROM margin_thresholds
   WHERE effective_from > DATE '2030-01-01'
     AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.segment = margin_thresholds.segment
                       AND d.created_at::date >= margin_thresholds.effective_from);

  GET DIAGNOSTICS touched = ROW_COUNT;
  IF touched > 0 THEN
    RAISE NOTICE 'Purge : % grille(s) de seuils issues des campagnes de recette.', touched;
  END IF;

  -- Les cours de change portent le MÊME résidu de recette, et ne sont PAS
  -- purgés : append_only_guard interdit le DELETE sur fx_rates (§ 1.4). La
  -- règle a raison contre le confort — un cours de change est la pièce qui
  -- justifie une contre-valeur déjà écrite, et rien ne doit pouvoir l'ôter.
  -- La lisibilité de l'écran ne vaut pas qu'on desserre ce verrou : c'est la
  -- campagne de recette qui a été rendue rejouable, en tirant ses dates au
  -- jour près plutôt qu'à l'année.
END $$;


-- ─── 11_journal_terrain.sql ──────────────────────────────────────

-- ===========================================================================
--  JOURNAL D'ÉVÉNEMENTS TERRAIN
--  Réf. SPECIFICATIONS.md § 10.2
--
--  « La tablette ne détient pas une copie modifiable de l'opération qu'elle
--    renverrait au serveur — cette approche fabrique des conflits insolubles.
--    Elle produit un journal d'événements EN AJOUT SEUL. »
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Ajout seul, tenu par la base.
--
--  Le service d'ingestion ne réécrit jamais une ligne — mais « ne le fait
--  pas » n'est pas « ne peut pas le faire ». Un correctif pressé, une reprise
--  de données ou un script d'exploitation suffiraient à effacer la trace qu'un
--  événement a été refusé, c'est-à-dire exactement ce que ce journal existe
--  pour conserver.
--
--  Conséquence assumée, et documentée dans le service : un refus BRÛLE
--  l'identifiant de l'événement. Résoudre un rejet consiste à lever la cause
--  puis à produire un événement NEUF, pas à repousser le même.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_field_sync_events_no_update ON field_sync_events;
CREATE TRIGGER trg_field_sync_events_no_update
  BEFORE UPDATE ON field_sync_events
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();

DROP TRIGGER IF EXISTS trg_field_sync_events_no_delete ON field_sync_events;
CREATE TRIGGER trg_field_sync_events_no_delete
  BEFORE DELETE ON field_sync_events
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();

COMMENT ON TABLE field_sync_events IS
  'Journal d''événements terrain, en AJOUT SEUL (§ 10.2). L''identifiant est celui généré sur l''appareil : c''est lui qui rend la synchronisation idempotente.';


-- ---------------------------------------------------------------------------
--  Un événement accepté porte sa date d'application ; un refus porte son motif.
--
--  Sans ces deux contraintes, une acceptation sans date et un refus sans motif
--  passeraient : le premier rendrait impossible de dater ce qui a été appliqué,
--  le second renverrait à l'agent un « refusé » sans rien lui dire à faire.
-- ---------------------------------------------------------------------------
ALTER TABLE field_sync_events
  DROP CONSTRAINT IF EXISTS chk_field_event_coherence,
  ADD  CONSTRAINT chk_field_event_coherence CHECK (
    (status = 'ACCEPTED' AND applied_at IS NOT NULL AND rejection_reason IS NULL)
    OR
    (status = 'REJECTED' AND rejection_reason IS NOT NULL AND applied_at IS NULL)
    OR
    -- DEFERRED n'est jamais écrit : il n'a pas été jugé, donc rien à journaliser.
    -- La branche existe pour que l'ajout futur d'un état ne passe pas inaperçu.
    (status NOT IN ('ACCEPTED', 'REJECTED') AND applied_at IS NULL)
  );


-- ---------------------------------------------------------------------------
--  L'écart entre l'horloge de l'appareil et celle du serveur.
--
--  « L'horloge de l'appareil n'est pas fiable. Les deux horodatages sont
--    conservés — appareil et réception serveur. Un écart important est en soi
--    un signal d'audit. »
--
--  La vue ne fixe AUCUN seuil : c'est un paramètre, pas une constante. Elle
--  rend l'écart, à qui de droit d'en juger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_field_clock_drift AS
SELECT e.id                AS event_id,
       e.device_id,
       f.full_name         AS agent,
       o.reference         AS operation,
       e.type::text        AS event_type,
       e.device_timestamp,
       e.received_at,
       EXTRACT(EPOCH FROM (e.received_at - e.device_timestamp))::bigint AS drift_seconds
  FROM field_sync_events e
  JOIN field_users f ON f.id = e.field_user_id
  JOIN operations  o ON o.id = e.operation_id;

COMMENT ON VIEW v_field_clock_drift IS
  'Écart entre l''horloge de la tablette et la réception serveur (§ 10.2). Un écart important est un signal d''audit ; le seuil relève du paramétrage, pas de cette vue.';


-- ---------------------------------------------------------------------------
--  Refus en attente de résolution, par agent.
--
--  Une opération peut rester bloquée parce qu'un événement a été refusé et que
--  personne ne l'a vu : la tablette a pu être réinitialisée, l'agent avoir
--  changé d'appareil. La file locale disparaît ; les refus, non.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_field_rejections AS
SELECT e.id           AS event_id,
       o.reference    AS operation,
       o.status::text AS operation_status,
       f.full_name    AS agent,
       f.email        AS agent_email,
       e.type::text   AS event_type,
       e.device_timestamp,
       e.received_at,
       e.rejection_reason
  FROM field_sync_events e
  JOIN field_users f ON f.id = e.field_user_id
  JOIN operations  o ON o.id = e.operation_id
 WHERE e.status = 'REJECTED'
 ORDER BY e.received_at DESC;

COMMENT ON VIEW v_field_rejections IS
  'Événements terrain refusés (§ 10.2). Le rejet redescend sur l''appareil, mais la file locale peut disparaître — cette vue est le filet.';


-- ─── 12_exigence_photo.sql ───────────────────────────────────────

-- ===========================================================================
--  RÉGIME PHOTOGRAPHIQUE DES POINTS DE CONTRÔLE
--  Réf. SPECIFICATIONS.md § 7.1 bis
--
--  Décision de la direction, 6 août 2026 :
--
--    « Le branchement d'une prise de photo à un point de contrôle doit être
--      administrable. […] L'exigence doit mordre à l'enregistrement du point. »
--
--  ⚠️ CE QUI EXISTAIT AVANT ÉTAIT DÉCORATIF.
--
--     `requires_photo` était administrable, affiché à l'écran de paramétrage,
--     transporté jusqu'à la tablette — et vérifié NULLE PART. Un point marqué
--     « photo exigée » s'enregistrait sans photo. L'exploitant croyait tenir
--     un levier qui ne commandait rien, ce qui est pire qu'une valeur en dur :
--     une valeur en dur, au moins, on sait qu'elle ne se règle pas.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  REPRISE — le régime est déduit de l'ancien booléen.
--
--  Sans elle, tous les points existants retomberaient sur le défaut OPTIONAL,
--  y compris les quatre points « avant départ » dont la photo est la seule
--  preuve opposable : permis, EPI, extincteurs, kit anti-déversement.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  UPDATE hse_checklist_items
     SET photo_policy = 'REQUIRED'
   WHERE requires_photo IS TRUE
     AND photo_policy = 'OPTIONAL';

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'Reprise : % point(s) passés en photo EXIGÉE d''après l''ancien booléen.', n;
  END IF;
END $$;


-- ---------------------------------------------------------------------------
--  Les deux colonnes ne peuvent plus diverger.
--
--  `requires_photo` est encore lu par la tablette et par resolve_hse_checklist.
--  Le laisser se désynchroniser du régime ferait afficher « photo exigée » sur
--  un point devenu facultatif, ou l'inverse — et l'agent ne saurait plus lequel
--  des deux croire.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_photo_policy()
RETURNS TRIGGER AS $$
BEGIN
  -- Le régime fait foi. Le booléen n'en est que la projection.
  NEW.requires_photo := (NEW.photo_policy = 'REQUIRED');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_photo_policy ON hse_checklist_items;
CREATE TRIGGER trg_sync_photo_policy
  BEFORE INSERT OR UPDATE OF photo_policy, requires_photo ON hse_checklist_items
  FOR EACH ROW EXECUTE FUNCTION sync_photo_policy();

UPDATE hse_checklist_items SET photo_policy = photo_policy;  -- force la projection


-- ---------------------------------------------------------------------------
--  LE VERROU : un point à photo exigée ne s'enregistre pas sans pièce.
--
--  « L'exigence doit mordre à l'enregistrement du point. »
--
--  Tenu ICI et non dans l'application, comme tous les autres verrous : aucun
--  chemin d'écriture ne peut le contourner — ni la synchronisation terrain, ni
--  un import, ni un correctif appliqué à la main un soir de production.
--
--  Le contrôle ne se déclenche QUE lorsque le point quitte l'état « en
--  attente » : ouvrir une checklist crée ses points vides, et exiger une photo
--  à ce moment-là rendrait toute checklist impossible à ouvrir.
--
--  ⚠️ La photo doit donc être déposée AVANT que le point soit renseigné. C'est
--     l'ordre naturel sur le terrain — on photographie ce qu'on constate, puis
--     on conclut — et la file des photos étant distincte de celle des
--     événements, elle part sans attendre.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_check_item_requirements()
RETURNS TRIGGER AS $$
DECLARE
  it record;
BEGIN
  IF NEW.outcome::text = 'PENDING' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.outcome::text = NEW.outcome::text THEN
    RETURN NEW;
  END IF;

  SELECT photo_policy::text AS regime, requires_value, requires_signature, label
    INTO it
    FROM hse_checklist_items WHERE id = NEW.item_id;

  -- --- Photo ---------------------------------------------------------------
  IF it.regime = 'REQUIRED'
     AND NOT EXISTS (SELECT 1 FROM operation_attachments a
                      WHERE a.check_item_id = NEW.id AND a.kind::text = 'PHOTO') THEN
    RAISE EXCEPTION
      'PHOTO EXIGÉE — le point « % » ne peut pas être enregistré sans photo. Prenez le cliché, attendez qu''il soit reçu, puis enregistrez le point. Le contrôleur HSE valide à distance, sur pièces : sans photo, il n''a rien à examiner.',
      it.label
      USING ERRCODE = 'check_violation';
  END IF;

  -- --- Valeur relevée ------------------------------------------------------
  --
  -- ⚠️ `requires_value` n'était appliqué QUE dans l'écran de la tablette. Un
  --    événement produit hors ligne, un appel direct, ou une tablette d'une
  --    autre version passaient sans valeur. Les points concernés sont le
  --    jaugeage, les numéros de scellé et le volume livré : ce sont eux qui
  --    font foi en cas de litige, et ce sont eux qui partaient vides.
  IF it.requires_value
     AND (NEW.recorded_value IS NULL OR length(trim(NEW.recorded_value)) = 0) THEN
    RAISE EXCEPTION
      'VALEUR EXIGÉE — le point « % » attend un relevé (volume, température, numéro de scellé). Il ne peut pas être enregistré sans.',
      it.label
      USING ERRCODE = 'check_violation';
  END IF;

  -- --- Signature -----------------------------------------------------------
  --
  -- ⚠️ `requires_signature` n'était lu NULLE PART — ni par l'API, ni par la
  --    base, et la tablette ne le recevait même pas. Il est porté par le point
  --    « Bon de livraison signé par le client » : après un litige de
  --    livraison, ce point « satisfait » ne prouvait rien.
  IF it.requires_signature
     AND NOT EXISTS (SELECT 1 FROM operation_attachments a
                      WHERE a.check_item_id = NEW.id AND a.kind::text = 'SIGNATURE') THEN
    RAISE EXCEPTION
      'SIGNATURE EXIGÉE — le point « % » ne peut pas être enregistré sans la signature attendue. Faites signer, attendez que la signature soit reçue, puis enregistrez le point.',
      it.label
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_photo_requirement ON operation_hse_check_items;
DROP TRIGGER IF EXISTS trg_check_item_requirements ON operation_hse_check_items;
CREATE TRIGGER trg_check_item_requirements
  BEFORE INSERT OR UPDATE OF outcome ON operation_hse_check_items
  FOR EACH ROW EXECUTE FUNCTION enforce_check_item_requirements();

-- ---------------------------------------------------------------------------
--  DATE D'INSTALLATION DU VERROU — consignée ICI, une fois pour toutes.
--
--  L'audit permanent doit distinguer ce que le verrou POUVAIT empêcher de ce
--  qui lui est antérieur. Il lui faut donc une date.
--
--  ⚠️ NE PAS LA LIRE DANS `_prisma_migrations`. Je l'ai fait, et c'était une
--     faute : cette table est interne à Prisma et N'EXISTE PAS dans la base de
--     travail que `migrate diff` utilise pour calculer l'écart de schéma.
--     Conséquence — toute migration ULTÉRIEURE échouait, sur un message sans
--     rapport avec la modification en cours. Le SQL métier ne doit jamais
--     dépendre de la mécanique de migration.
--
--  `ON CONFLICT DO NOTHING` : la date est celle de la PREMIÈRE installation.
--  Le SQL étant rejoué à chaque migration, la réécrire ferait glisser la
--  frontière et rendrait l'antérieur invisible un peu plus à chaque fois.
-- ---------------------------------------------------------------------------
INSERT INTO system_settings (key, value, value_type, description, updated_at)
VALUES ('PROOF_LOCK_INSTALLED_AT', now()::text, 'string',
        'Date d''installation du verrou de preuve des contrôles HSE — photo, valeur relevée, signature (§ 7.1 bis). Sert à l''audit permanent pour distinguer ce que le verrou pouvait empêcher de ce qui lui est antérieur. NE PAS MODIFIER : la reculer ferait disparaître des anomalies réelles, l''avancer en ferait apparaître d''imaginaires.',
        now())
ON CONFLICT (key) DO NOTHING;

COMMENT ON COLUMN hse_checklist_items.photo_policy IS
  'Régime photographique (§ 7.1 bis) : FORBIDDEN interdit la prise de vue — zone ATEX, dépôt ou client qui la proscrit ; OPTIONAL la propose ; REQUIRED empêche l''enregistrement du point sans pièce jointe.';


-- ---------------------------------------------------------------------------
--  Vue de contrôle : les points exigeant une photo et n'en portant pas.
--
--  Le déclencheur empêche que cela se produise DÉSORMAIS. Cette vue existe
--  pour l'ANTÉRIEUR — les points enregistrés avant le verrou — et pour rendre
--  visible ce que la reprise ne peut pas réparer : on ne fabrique pas après
--  coup une photo qui n'a pas été prise.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_controles_sans_preuve AS
SELECT o.reference        AS operation,
       o.status::text     AS operation_status,
       c.phase::text      AS phase,
       i.code             AS point_code,
       i.label            AS point_label,
       ci.level::text     AS niveau,
       ci.outcome::text   AS resultat,
       ci.recorded_at,
       ci.created_at        AS inscrit_le,
       f.full_name        AS renseigne_par,
       trim(BOTH ', ' FROM
         CASE WHEN i.photo_policy = 'REQUIRED'
                   AND NOT EXISTS (SELECT 1 FROM operation_attachments a
                                    WHERE a.check_item_id = ci.id AND a.kind = 'PHOTO')
              THEN 'photo, ' ELSE '' END ||
         CASE WHEN i.requires_value
                   AND (ci.recorded_value IS NULL OR length(trim(ci.recorded_value)) = 0)
              THEN 'valeur, ' ELSE '' END ||
         CASE WHEN i.requires_signature
                   AND NOT EXISTS (SELECT 1 FROM operation_attachments a
                                    WHERE a.check_item_id = ci.id AND a.kind = 'SIGNATURE')
              THEN 'signature, ' ELSE '' END
       ) AS preuves_manquantes
  FROM operation_hse_check_items ci
  JOIN hse_checklist_items i ON i.id = ci.item_id
  JOIN operation_hse_checks c ON c.id = ci.check_id
  JOIN operations o ON o.id = c.operation_id
  LEFT JOIN field_users f ON f.id = ci.recorded_by_field_user_id
 WHERE ci.outcome::text <> 'PENDING'
   AND (
     (i.photo_policy = 'REQUIRED'
      AND NOT EXISTS (SELECT 1 FROM operation_attachments a
                       WHERE a.check_item_id = ci.id AND a.kind = 'PHOTO'))
     OR (i.requires_value
         AND (ci.recorded_value IS NULL OR length(trim(ci.recorded_value)) = 0))
     OR (i.requires_signature
         AND NOT EXISTS (SELECT 1 FROM operation_attachments a
                          WHERE a.check_item_id = ci.id AND a.kind = 'SIGNATURE'))
   );

COMMENT ON VIEW v_controles_sans_preuve IS
  'Points enregistrés sans la preuve que leur paramétrage exige — photo, valeur ou signature (§ 7.1 bis). Le déclencheur l''empêche désormais ; cette vue montre l''antérieur, qu''aucune reprise ne peut réparer : on ne fabrique pas après coup une signature qui n''a pas été donnée.';

DROP VIEW IF EXISTS v_controles_sans_photo;


-- ─── 16_sites_de_livraison.sql ───────────────────────────────────

-- ===========================================================================
--  SITES — CHARGEMENT ET LIVRAISON, PARTAGÉS ENTRE CLIENTS
--  Réf. SPECIFICATIONS.md § 6.2, § 10.3
--
--  Décision de la direction, 6 août 2026 :
--
--    « Une destination doit être rattachée à un tiers (client) même si
--      plusieurs tiers peuvent avoir la même destination de livraison — et
--      c'est courant. Généralement chaque site de livraison a ses exigences à
--      connaître pour mieux préparer une opération le concernant. »
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  REPRISE — chaque site de tiers existant devient un LIEU.
--
--  Aujourd'hui la correspondance est de un pour un : personne n'a encore pu
--  partager un site, puisque le modèle ne le permettait pas. On crée donc un
--  lieu par rattachement, et l'exploitant fusionnera ceux qui n'en font qu'un
--  — c'est un travail de référentiel, pas de migration : nous n'avons aucun
--  moyen fiable de décider que deux adresses saisies séparément désignent le
--  même quai.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  INSERT INTO sites (
    id, code, name, address_line, city, country_code, latitude, longitude,
    access_instructions, opening_hours, safety_instructions,
    default_hse_risk_level, is_active, created_at, updated_at)
  SELECT gen_random_uuid(),
         -- Le code du lieu ne peut pas être celui du client : deux clients
         -- emploient le même code pour des lieux différents. On le préfixe du
         -- tiers d'origine, l'exploitant renommera.
         left(p.code || '-' || ps.code, 32),
         ps.name, ps.address_line, ps.city, ps.country_code,
         ps.latitude, ps.longitude,
         ps.access_instructions, ps.opening_hours, ps.safety_instructions,
         ps.default_hse_risk_level, ps.is_active, ps.created_at, now()
    FROM partner_sites ps
    JOIN partners p ON p.id = ps.partner_id
   WHERE ps.site_id IS NULL
   ON CONFLICT (code) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Reprise : % lieu(x) de livraison créé(s).', n; END IF;

  UPDATE partner_sites ps
     SET site_id = ds.id
    FROM sites ds
    JOIN partners p ON true
   WHERE ps.site_id IS NULL
     AND p.id = ps.partner_id
     AND ds.code = left(p.code || '-' || ps.code, 32);

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Reprise : % rattachement(s) client → lieu.', n; END IF;

  -- Usage : tout ce qui existait ne servait qu'à LIVRER — le modèle ne
  -- connaissait pas le chargement. L'exploitant ajoutera LOADING sur les
  -- dépôts qui expédient aussi, et un lieu portera alors les deux.
  UPDATE sites SET usages = ARRAY['DELIVERY']::site_usage[]
   WHERE usages IS NULL OR cardinality(usages) = 0;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Reprise : % site(s) marqué(s) « livraison ».', n; END IF;
END $$;

-- ---------------------------------------------------------------------------
--  Un site sert forcément à QUELQUE CHOSE.
--
--  Un lieu sans usage n'apparaît dans aucune liste de choix : il existe au
--  référentiel et reste introuvable à la saisie. Le refuser vaut mieux que de
--  laisser quelqu'un le créer et le chercher ensuite.
-- ---------------------------------------------------------------------------
ALTER TABLE sites
  DROP CONSTRAINT IF EXISTS chk_site_usages,
  ADD  CONSTRAINT chk_site_usages CHECK (cardinality(usages) > 0);


-- ---------------------------------------------------------------------------
--  Un même client ne se rattache qu'une fois à un même lieu.
--
--  Sans cette contrainte, deux rattachements du même client au même quai
--  produiraient deux désignations concurrentes sur les bons de livraison.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uq_partner_site_lieu;
CREATE UNIQUE INDEX uq_partner_site_lieu
  ON partner_sites (partner_id, site_id)
  WHERE site_id IS NOT NULL;


-- ---------------------------------------------------------------------------
--  NATURES D'EXIGENCE — amorce administrable.
--
--  Ce sont des valeurs de DÉPART, modifiables et extensibles depuis l'écran de
--  paramétrage. Elles couvrent ce qu'un dépôt pétrolier oppose couramment à un
--  transporteur en Côte d'Ivoire.
-- ---------------------------------------------------------------------------
INSERT INTO site_requirement_types
  (id, code, label, description, default_blocking, display_order, is_active, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'BADGE_ACCES', 'Badge d''accès nominatif',
   'Badge à retirer auprès du poste de garde, souvent la veille. Sans lui, le camion ne franchit pas la barrière.',
   true, 10, true, now(), now()),
  (gen_random_uuid(), 'CRENEAU', 'Créneau de livraison réservé',
   'Le site n''accepte que sur rendez-vous. Se présenter hors créneau, c''est repartir à vide.',
   true, 20, true, now(), now()),
  (gen_random_uuid(), 'PERMIS_TRAVAIL', 'Permis de travail',
   'Exigé pour toute intervention en zone classée. Délivré par le donneur d''ordre du site.',
   true, 30, true, now(), now()),
  (gen_random_uuid(), 'EPI_SPECIFIQUE', 'EPI spécifiques au site',
   'Équipements exigés au-delà de la dotation standard — détecteur de gaz, appareil respiratoire.',
   true, 40, true, now(), now()),
  (gen_random_uuid(), 'ATTELAGE', 'Attelage ou raccord particulier',
   'Type de raccord de dépotage imposé par les installations du site.',
   true, 50, true, now(), now()),
  (gen_random_uuid(), 'GABARIT', 'Limitation de gabarit ou de tonnage',
   'Longueur, hauteur ou charge à l''essieu maximales admises sur le site.',
   true, 60, true, now(), now()),
  (gen_random_uuid(), 'PHOTO_INTERDITE', 'Prise de vue interdite',
   'Zone classée ou clause contractuelle. À croiser avec le régime photographique des points de contrôle (§ 7.1 bis).',
   false, 70, true, now(), now()),
  (gen_random_uuid(), 'ACCUEIL_CHAUFFEUR', 'Accueil et consignes au chauffeur',
   'Séance d''accueil obligatoire à la première venue, ou périodiquement.',
   false, 80, true, now(), now()),
  (gen_random_uuid(), 'ESCORTE', 'Escorte obligatoire sur site',
   'Le véhicule ne circule pas seul dans l''enceinte.',
   false, 90, true, now(), now())
ON CONFLICT (code) DO NOTHING;


-- ---------------------------------------------------------------------------
--  Ce qu'il faut savoir avant d'envoyer quelqu'un — LA vue de préparation.
--
--  Elle sert au coordinateur qui crée l'opération ET à l'agent sur sa
--  tablette. Une seule vue pour les deux : deux listes finiraient par
--  diverger, et c'est l'agent qui en paierait le prix.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_exigences_site AS
-- ⚠️ LES DEUX BOUTS DU TRAJET.
--
--    Un badge d'accès se retire pour CHARGER comme pour livrer, et un dépôt
--    impose ses créneaux à qui vient prendre du produit. Ne regarder que la
--    destination laissait la moitié du trajet sans consignes.
WITH lieux AS (
  -- Destination : par le rattachement client, qui porte la désignation que le
  -- client reconnaît sur son bon de livraison.
  SELECT o.id AS operation_id, o.reference, 'DELIVERY'::text AS bout, ps.site_id
    FROM operations o
    JOIN partner_sites ps ON ps.id = o.destination_site_id
   WHERE ps.site_id IS NOT NULL
  UNION ALL
  -- Origine : le LIEU directement. Un dépôt de chargement n'appartient à
  -- aucune relation commerciale.
  SELECT o.id, o.reference, 'LOADING', o.origin_site_id
    FROM operations o
   WHERE o.origin_site_id IS NOT NULL
)
SELECT l.operation_id,
       l.reference         AS operation,
       l.bout,
       s.id                AS site_id,
       s.code              AS site_code,
       s.name              AS site_name,
       t.code              AS exigence_code,
       t.label             AS exigence,
       r.id                AS exigence_id,
       r.detail,
       r.is_blocking,
       t.display_order
  FROM lieux l
  JOIN sites s ON s.id = l.site_id
  JOIN site_requirements r ON r.site_id = s.id AND r.is_active
  JOIN site_requirement_types t ON t.id = r.type_id AND t.is_active;

COMMENT ON VIEW v_exigences_site IS
  'Exigences des sites d''une opération — CHARGEMENT et LIVRAISON (§ 6.2). Portées par le LIEU et non par le client : plusieurs clients exploitent le même site, et une consigne de sécurité recopiée est une consigne qui se périme d''un côté.';


-- ---------------------------------------------------------------------------
--  Les sites partagés — ce que le nouveau modèle permet enfin de voir.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_sites_partages AS
SELECT ds.code, ds.name, ds.city,
       count(DISTINCT ps.partner_id) AS nb_clients,
       string_agg(DISTINCT p.legal_name, ', ' ORDER BY p.legal_name) AS clients
  FROM sites ds
  JOIN partner_sites ps ON ps.site_id = ds.id
  JOIN partners p ON p.id = ps.partner_id
 GROUP BY ds.id, ds.code, ds.name, ds.city
HAVING count(DISTINCT ps.partner_id) > 1;

COMMENT ON VIEW v_sites_partages IS
  'Sites de livraison exploités par plusieurs clients. C''est le cas courant, et c''est précisément ce que l''ancien modèle — un site par client — obligeait à dupliquer.';


-- ---------------------------------------------------------------------------
--  UNE EXIGENCE BLOQUANTE DOIT ÊTRE LEVÉE AVANT QUE L'OPÉRATION AVANCE.
--
--  « Généralement chaque site de livraison a ses exigences à connaître pour
--    mieux préparer une opération le concernant. »
--
--  Afficher l'exigence ne suffit pas : une consigne lue n'est pas une consigne
--  suivie. Se présenter sans le badge d'accès ou hors du créneau réservé, c'est
--  un camion qui repart à vide — et le produit est déjà payé, avec son portage.
--
--  Le verrou joue AU CHARGEMENT et au-delà, pas plus tôt : une opération se
--  prépare, et exiger le badge au moment où on la crée empêcherait de la créer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_site_requirements()
RETURNS TRIGGER AS $$
DECLARE
  manquantes text;
BEGIN
  IF NEW.status::text NOT IN ('LOADING', 'IN_TRANSIT', 'DELIVERING', 'FINAL_CHECK', 'CLOSED') THEN
    RETURN NEW;
  END IF;
  IF OLD.status::text = NEW.status::text THEN
    RETURN NEW;
  END IF;

  -- Les DEUX bouts : le badge du dépôt de chargement compte autant que celui
  -- du site de livraison. La vue les réunit, le verrou n'en connaît qu'une.
  SELECT string_agg(
           CASE bout WHEN 'LOADING' THEN 'chargement' ELSE 'livraison' END
           || ' — ' || exigence || ' : ' || detail,
           ' · ' ORDER BY bout, display_order)
    INTO manquantes
    FROM v_exigences_site v
   WHERE v.operation_id = NEW.id
     AND v.is_blocking
     AND NOT EXISTS (
       SELECT 1 FROM operation_site_requirement_acks a
        WHERE a.operation_id = NEW.id AND a.requirement_id = v.exigence_id
     );

  IF manquantes IS NOT NULL AND manquantes <> '' THEN
    RAISE EXCEPTION
      'EXIGENCES DE SITE — l''opération % ne peut pas partir : %. Levez ces points et acquittez-les avant le chargement : s''y présenter sans eux, c''est repartir à vide avec un produit déjà payé.',
      NEW.reference, manquantes
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_site_requirements ON operations;
CREATE TRIGGER trg_site_requirements
  BEFORE UPDATE OF status ON operations
  FOR EACH ROW EXECUTE FUNCTION enforce_site_requirements();

COMMENT ON FUNCTION enforce_site_requirements IS
  'Refuse le départ d''une opération dont les exigences BLOQUANTES du site de livraison ne sont pas acquittées (§ 6.2).';


-- ─── 17_arrondi_devise.sql ───────────────────────────────────────

-- ===========================================================================
--  LES INVARIANTS MONÉTAIRES DOIVENT CONNAÎTRE LA PRÉCISION DE LA DEVISE
--  Réf. SPECIFICATIONS.md § 9.2
--
--  « Le franc CFA n'a pas de subdivision en circulation : tout montant imprimé
--    en FCFA est un entier. »
--
--  ⚠️ DEUX DÉFAUTS QUI SE TENAIENT L'UN L'AUTRE.
--
--     1. L'application n'arrondissait le plan TRANSACTION qu'à quatre
--        décimales, quelle que soit la devise. Un total de 9 447 530,0895 FCFA
--        cohabitait avec un imprimé de 9 447 530. Le client paie l'imprimé : il
--        restait 0,0895 FCFA, la facture n'atteignait JAMAIS « payée », et elle
--        restait indéfiniment dans l'en-cours du client. Dans l'autre sens,
--        l'encaissement du montant imprimé était REFUSÉ.
--
--     2. Les CHECK comparaient au produit EXACT, avec une tolérance de 0,01
--        écrite en dur. Corriger le point 1 les faisait donc échouer : ils
--        interdisaient l'arrondi légal. Et cette tolérance de 0,01 n'a de sens
--        dans AUCUNE des deux directions — en XOF elle ne tolère rien, le plus
--        petit écart réel valant 1 ; sur une devise à deux décimales elle
--        tolère exactement un centime, ce qui est arbitraire.
--
--  LA CORRECTION
--  -------------
--  La tolérance DÉRIVE de la devise de la pièce : une demi-unité de la plus
--  petite subdivision en circulation. En XOF : 0,5. En USD : 0,005. C'est la
--  définition même d'un arrondi correct, et elle vaut pour toute devise qu'on
--  ajoutera.
--
--  ⚠️ LA FONCTION `tolerance_arrondi` ET LA REPRISE DES MONTANTS VIVENT DANS
--     01_business_constraints.sql, qui s'exécute AVANT 05 — lequel réinstalle
--     les CHECK à chaque migration. Les poser ici, après 05, faisait échouer
--     la migration sur la version PRÉCÉDENTE de la contrainte, rejouée entre
--     temps. Ce fichier ne porte donc que ce qui n'existe nulle part ailleurs.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Une pièce assujettie ne peut pas porter un taux NUL.
--
--  `chk_invoices_vat_requires_flag` disait « pas de TVA sans la case ». Il ne
--  disait rien de l'inverse : la case cochée avec un taux à zéro passait, la
--  pièce partait à la DGI, et la TVA collectée n'était pas déclarée. Le
--  contrôle applicatif est doublé ici — aucun chemin d'écriture ne doit
--  pouvoir l'éviter, pas même une reprise de données.
-- ---------------------------------------------------------------------------
ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS chk_invoices_vat_rate_when_applicable,
  ADD  CONSTRAINT chk_invoices_vat_rate_when_applicable
       CHECK (NOT is_vat_applicable OR vat_rate_pct > 0);


-- ---------------------------------------------------------------------------
--  Un avoir ne dépasse pas la pièce qu'il corrige.
--
--  Tenu ici en plus de l'application : la vue de risque soustrait chaque avoir
--  de l'en-cours, et un avoir démesuré remet le crédit disponible d'un client
--  à zéro. C'est une écriture d'une ligne — elle ne doit passer par aucun
--  chemin.
--
--  Le cumul des avoirs déjà émis est pris en compte : sans cela, deux avoirs
--  de la moitié du montant passeraient chacun le contrôle.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_credit_note_ceiling()
RETURNS TRIGGER AS $$
DECLARE
  piece      record;
  deja       numeric;
  corrigeable numeric;
BEGIN
  IF NEW.type::text <> 'CREDIT_NOTE' OR NEW.corrected_invoice_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT number, total_amount, currency_code, type::text AS t
    INTO piece FROM invoices WHERE id = NEW.corrected_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La pièce corrigée par cet avoir est introuvable.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF piece.t = 'CREDIT_NOTE' THEN
    RAISE EXCEPTION
      'La pièce % est elle-même un avoir : un avoir ne se corrige pas par un avoir.',
      piece.number USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(sum(total_amount), 0) INTO deja
    FROM invoices
   WHERE corrected_invoice_id = NEW.corrected_invoice_id
     AND type::text = 'CREDIT_NOTE'
     AND id <> NEW.id;

  corrigeable := piece.total_amount - deja;

  IF NEW.total_amount > corrigeable + tolerance_arrondi(piece.currency_code) THEN
    RAISE EXCEPTION
      'Avoir de % sur % dont il ne reste que % à corriger. Un avoir qui dépasse la pièce qu''il corrige efface un en-cours qui existe.',
      round(NEW.total_amount, 2), piece.number, round(corrigeable, 2)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_credit_note_ceiling ON invoices;
CREATE TRIGGER trg_credit_note_ceiling
  BEFORE INSERT OR UPDATE OF total_amount, corrected_invoice_id ON invoices
  FOR EACH ROW EXECUTE FUNCTION enforce_credit_note_ceiling();


-- ---------------------------------------------------------------------------
--  REPRISE — l'en-cours au pivot n'avait jamais suivi les encaissements.
--
--  `paid_amount_pivot` restait à zéro alors que `v_partner_credit_exposure`
--  calcule `SUM(total_amount_pivot − paid_amount_pivot)` : 15 000 000 FCFA
--  encaissés laissaient 24 776 USD d'en-cours fantôme sur un seul client. La
--  donnée existait, portée par les lignes d'encaissement — elle n'était pas
--  reportée.
--
--  Le cours retenu est celui FIGÉ SUR LA PIÈCE : convertir au cours du jour
--  ferait apparaître un écart de change comme un impayé.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  UPDATE invoices i
     SET paid_amount_pivot = round(i.paid_amount * i.fx_rate_to_pivot, 4)
   WHERE i.paid_amount > 0
     AND (i.paid_amount_pivot IS NULL OR i.paid_amount_pivot = 0);

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'Reprise : en-cours au pivot rétabli sur % facture(s) encaissée(s).', n;
  END IF;
END $$;


-- ─── 18_perte_volume_statistique.sql ─────────────────────────────

-- ===========================================================================
--  LA PERTE DE VOLUME EST STATISTIQUE, ET RIEN D'AUTRE
--  Réf. SPECIFICATIONS.md § 8.3
--
--  Décision de la direction, réaffirmée le 7 août 2026 :
--
--    « Dans notre système ivoirien, je livre ce que j'ai chargé. La perte de
--      volume sert à des fins statistiques en interne et n'intervient pas dans
--      les coûts ni la facturation. »
--
--  C'EST UNE RÈGLE MÉTIER, PAS UNE OMISSION
--  ----------------------------------------
--  Un audit a signalé l'absence de ligne de coût « perte de volume » comme un
--  défaut, en s'appuyant sur une phrase de la spécification qui disait le
--  contraire. La phrase était fausse : elle décrivait un modèle où le vendeur
--  supporte l'écart, ce qui n'est pas le régime pratiqué ici. La spécification
--  a été corrigée.
--
--  Le volume facturé est celui CHARGÉ. L'écart constaté à l'arrivée est un
--  signal — de qualité de transport, de jaugeage, de sûreté — et il alimente
--  les alertes et les statistiques. Il ne se chiffre pas en devise, il ne
--  réduit aucune marge, et il ne modifie aucune facture.
--
--  ⚠️ CE FICHIER FERME LA PORTE PLUTÔT QUE DE LA LAISSER ENTROUVERTE.
--
--     Le poste `PERTE_VOLUME` existait au référentiel, actif, et n'avait
--     jamais reçu une seule ligne. Un poste de coût qui attend sans jamais
--     servir finit par être employé — par quelqu'un qui n'était pas là quand
--     la règle a été posée, et qui le trouvera parfaitement logique.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Le poste est DÉSACTIVÉ, et son libellé dit pourquoi.
--
--  Désactivé plutôt que supprimé : le supprimer effacerait la trace qu'il a
--  existé, et rien n'empêcherait de le recréer sous le même nom dans six mois.
-- ---------------------------------------------------------------------------
UPDATE cost_posts
   SET is_active = false,
       label = 'Perte de volume (ullage) — STATISTIQUE, jamais un coût'
 WHERE code = 'PERTE_VOLUME';


-- ---------------------------------------------------------------------------
--  Et aucune ligne ne peut plus y être rattachée.
--
--  La désactivation seule ne suffit pas : rien n'empêche une écriture directe,
--  un import, ou une réactivation faite de bonne foi. Le refus porte le motif
--  métier, de sorte que celui qui bute dessus comprenne la règle plutôt que de
--  chercher comment la contourner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refuse_perte_volume_en_cout()
RETURNS TRIGGER AS $$
DECLARE
  code_poste text;
BEGIN
  SELECT code INTO code_poste FROM cost_posts WHERE id = NEW.cost_post_id;

  IF code_poste = 'PERTE_VOLUME' THEN
    RAISE EXCEPTION
      'PERTE DE VOLUME — l''écart de volume ne se chiffre pas en coût. Le volume facturé est celui CHARGÉ : l''écart constaté à l''arrivée est un signal de qualité et de sûreté, suivi en statistique, et il n''entre ni dans les coûts ni dans la facturation (§ 8.3).'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_refus_perte_volume_operation ON operation_cost_lines;
CREATE TRIGGER trg_refus_perte_volume_operation
  BEFORE INSERT OR UPDATE OF cost_post_id ON operation_cost_lines
  FOR EACH ROW EXECUTE FUNCTION refuse_perte_volume_en_cout();

DROP TRIGGER IF EXISTS trg_refus_perte_volume_deal ON deal_cost_lines;
CREATE TRIGGER trg_refus_perte_volume_deal
  BEFORE INSERT OR UPDATE OF cost_post_id ON deal_cost_lines
  FOR EACH ROW EXECUTE FUNCTION refuse_perte_volume_en_cout();

COMMENT ON FUNCTION refuse_perte_volume_en_cout IS
  'Interdit de chiffrer l''écart de volume en ligne de coût (§ 8.3). « Je livre ce que j''ai chargé » : l''écart est statistique, jamais monétaire.';


-- ---------------------------------------------------------------------------
--  Ce à quoi l'écart SERT : la statistique.
--
--  La règle n'est pas « on ne regarde pas l'écart » — c'est « on ne le
--  facture pas ». Il reste un signal de premier ordre : un transporteur, un
--  itinéraire ou un dépôt qui dérive se voit ici avant de se voir ailleurs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_ullage_statistiques AS
SELECT p.legal_name                              AS transporteur,
       pr.code                                   AS produit,
       o.transport_mode::text                    AS mode,
       count(*)                                  AS nb_operations,
       round(avg(m.ullage_variance_pct), 4)      AS ecart_moyen_pct,
       round(max(m.ullage_variance_pct), 4)      AS ecart_max_pct,
       round(stddev_samp(m.ullage_variance_pct), 4) AS dispersion_pct,
       count(*) FILTER (WHERE m.ullage_alert_triggered)    AS alertes,
       count(*) FILTER (WHERE m.ullage_critical_triggered) AS critiques,
       -- Volume perdu cumulé, EN VOLUME et jamais en devise : c'est ce qui
       -- rend deux transporteurs comparables sans introduire un coût qui
       -- n'existe pas.
       round(sum(m.loaded_volume_15 - m.discharged_volume_15), 3) AS volume_perdu_cumule
  FROM measurement_records m
  JOIN operations o ON o.id = m.operation_id
  JOIN deals d ON d.id = o.deal_id
  JOIN products pr ON pr.id = d.product_id
  LEFT JOIN operation_assignments a ON a.operation_id = o.id
  LEFT JOIN partners p ON p.id = a.carrier_id
 WHERE m.is_authoritative
 GROUP BY p.legal_name, pr.code, o.transport_mode;

COMMENT ON VIEW v_ullage_statistiques IS
  'Écarts de volume agrégés par transporteur, produit et mode (§ 8.3). EN VOLUME, jamais en devise : l''écart ne se facture pas, il se surveille.';


-- ─── 19_verrou_credit.sql ────────────────────────────────────────

-- ===========================================================================
--  LE PLAFOND DE CRÉDIT DOIT ÊTRE OPPOSABLE
--  Réf. SPECIFICATIONS.md § 9.1
--
--  ⚠️ TROIS DÉFAUTS QUI SE CUMULAIENT, ET RENDAIENT LE CHIFFRE INUTILISABLE
--     AVANT MÊME QU'ON SONGE À L'OPPOSER.
--
--     1. AUCUN VERROU. `partners.credit_limit` s'affichait, se paramétrait, et
--        aucune approbation ne le consultait. `check_credit_capacity` était
--        annoncée « au lot 2 » dans 03_views_and_functions.sql ; elle n'a
--        jamais été écrite. Un client à 300 % d'utilisation recevait son
--        affaire.
--
--     2. LES ENGAGEMENTS VALAIENT TOUJOURS ZÉRO. La vue sommait
--        `deals.sale_amount_pivot`, colonne qu'AUCUN chemin applicatif
--        n'écrit — sept affaires sur huit la portaient à 0, avec un cours à
--        1,0 alors qu'elles sont en XOF et le pivot en USD.
--
--     3. LE PLAFOND N'ÉTAIT PAS CONVERTI. La vue rendait `credit_limit` tel
--        quel comme `credit_limit_pivot`, alors que `credit_limit_currency_code`
--        existe. Un plafond saisi en XOF était comparé à une exposition en USD :
--        un facteur 600.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Cours vers la devise pivot, à l'usage des vues.
--
--  Les vues ne peuvent pas appeler le service applicatif : il leur faut le
--  même arbitrage, en SQL. Il est ici, une fois — le recopier dans chaque vue
--  le ferait diverger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cours_vers_pivot(p_devise char(3))
RETURNS numeric AS $$
DECLARE
  pivot char(3);
  taux  numeric;
BEGIN
  SELECT code INTO pivot FROM currencies WHERE is_pivot LIMIT 1;
  IF pivot IS NULL OR pivot = p_devise THEN RETURN 1; END IF;

  SELECT rate INTO taux FROM fx_rates
   WHERE base_currency_code = p_devise AND quote_currency_code = pivot
     AND effective_from <= CURRENT_DATE
     AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
   ORDER BY effective_from DESC LIMIT 1;
  IF taux IS NOT NULL THEN RETURN taux; END IF;

  -- Paire absente : on inverse l'opposée. Un cours USD/XOF publié vaut aussi
  -- pour XOF/USD, et refuser la conversion reviendrait à comparer des francs
  -- à des dollars comme s'ils se valaient.
  SELECT rate INTO taux FROM fx_rates
   WHERE base_currency_code = pivot AND quote_currency_code = p_devise
     AND effective_from <= CURRENT_DATE
     AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
   ORDER BY effective_from DESC LIMIT 1;
  IF taux IS NOT NULL AND taux <> 0 THEN RETURN 1 / taux; END IF;

  -- Aucun cours : on rend NULL plutôt que 1. Un « 1 » silencieux ferait
  -- passer 5 000 000 FCFA pour 5 000 000 USD.
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;


-- ---------------------------------------------------------------------------
--  L'EN-COURS, RECALCULÉ SUR DES DONNÉES QUI EXISTENT.
-- ---------------------------------------------------------------------------
-- ⚠️ DÉPOSÉE puis recréée, et non remplacée : 06_lot2_views.sql en installe
--    une version AVANT ce fichier, et `CREATE OR REPLACE VIEW` refuse de
--    changer le type d'une colonne existante — le plafond converti n'a plus la
--    même précision que le plafond brut. La déposer est sans risque : une vue
--    ne contient aucune donnée.
DROP VIEW IF EXISTS v_credit_depasse CASCADE;
DROP VIEW IF EXISTS v_partner_credit_exposure CASCADE;

CREATE VIEW v_partner_credit_exposure AS
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
    -- ⚠️ CALCULÉ, PLUS LU DANS UNE COLONNE QUE PERSONNE N'ÉCRIT.
    --
    --    La vue sommait `sale_amount_pivot`, restée à zéro sur sept affaires
    --    sur huit. L'engagement se déduit de ce que l'affaire porte
    --    réellement : volume contracté × prix de vente, converti au pivot au
    --    cours de l'affaire — et à défaut au cours du jour, plutôt que de
    --    compter zéro.
    SELECT d.client_id AS partner_id,
           COALESCE(SUM(GREATEST(0,
             d.contracted_volume * d.unit_sale_price
               * COALESCE(NULLIF(d.fx_rate_to_pivot, 1), cours_vers_pivot(d.currency_code), 1)
             - COALESCE(f.invoiced_pivot, 0))), 0) AS amount
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
),
plafonds AS (
    -- ⚠️ LE PLAFOND EST CONVERTI. Il ne l'était pas : une limite saisie en XOF
    --    était comparée à une exposition en USD, soit un facteur 600.
    SELECT p.id,
           p.credit_limit * COALESCE(cours_vers_pivot(p.credit_limit_currency_code), 1)
             AS limite_pivot
      FROM partners p
)
SELECT
    p.id           AS partner_id,
    p.code         AS partner_code,
    p.legal_name   AS partner_name,
    p.credit_status,
    l.limite_pivot AS credit_limit_pivot,
    COALESCE(r.amount, 0) AS receivables_pivot,
    COALESCE(c.amount, 0) AS commitments_pivot,
    COALESCE(g.amount, 0) AS guarantees_pivot,
    GREATEST(0, COALESCE(r.amount, 0) + COALESCE(c.amount, 0) - COALESCE(g.amount, 0))
                          AS exposure_pivot,
    l.limite_pivot - GREATEST(0, COALESCE(r.amount, 0) + COALESCE(c.amount, 0) - COALESCE(g.amount, 0))
                          AS available_credit_pivot,
    CASE WHEN l.limite_pivot > 0
         THEN round(GREATEST(0, COALESCE(r.amount, 0) + COALESCE(c.amount, 0) - COALESCE(g.amount, 0))
                    / l.limite_pivot * 100, 2)
         ELSE NULL END    AS utilisation_pct
  FROM partners p
  JOIN plafonds l ON l.id = p.id
  LEFT JOIN receivables r ON r.partner_id = p.id
  LEFT JOIN commitments c ON c.partner_id = p.id
  LEFT JOIN covers      g ON g.partner_id = p.id
 WHERE p.type::text = 'CLIENT';

COMMENT ON VIEW v_partner_credit_exposure IS
  'En-cours crédit par client (§ 9.1). Source unique du contrôle crédit. Plafond CONVERTI au pivot, engagements CALCULÉS sur les affaires en exécution.';


-- ---------------------------------------------------------------------------
--  LE VERROU : une affaire n'est pas approuvée au-delà du plafond.
--
--  Tenu en base, comme les autres — l'approbation passe par plusieurs chemins,
--  et un contrôle applicatif seul laisserait le dernier arrivé le contourner.
--
--  Trois cas où le verrou NE joue PAS, et il faut savoir pourquoi :
--    · plafond nul ou absent — le client n'est pas encadré, ce n'est pas au
--      verrou d'en décider ;
--    · aucun cours disponible pour convertir le plafond — on ne compare pas
--      des grandeurs qu'on ne sait pas rendre comparables ;
--    · dérogation du DG opposable — c'est la soupape prévue, et elle est
--      soumise aux mêmes conditions que les autres (§ 11.2).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_credit_capacity()
RETURNS TRIGGER AS $$
DECLARE
  e record;
  engagement numeric;
BEGIN
  IF NEW.credit_approved_by_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.credit_approved_by_id IS NOT NULL THEN
    RETURN NEW;  -- déjà approuvée : on ne rejuge pas à chaque écriture
  END IF;

  SELECT * INTO e FROM v_partner_credit_exposure WHERE partner_id = NEW.client_id;
  IF NOT FOUND OR e.credit_limit_pivot IS NULL OR e.credit_limit_pivot <= 0 THEN
    RETURN NEW;
  END IF;

  -- Ce que CETTE affaire ajoute — elle n'est pas encore en exécution, donc
  -- absente de l'en-cours calculé.
  engagement := NEW.contracted_volume * NEW.unit_sale_price
                * COALESCE(NULLIF(NEW.fx_rate_to_pivot, 1),
                           cours_vers_pivot(NEW.currency_code), 1);

  IF e.exposure_pivot + engagement <= e.credit_limit_pivot THEN
    RETURN NEW;
  END IF;

  IF NEW.credit_derogation_id IS NOT NULL
     AND derogation_opposable(NEW.credit_derogation_id, 'CREDIT_LIMIT_OVERRIDE', NEW.reference) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'PLAFOND DE CRÉDIT — le client % est engagé à % et cette affaire ajoute %, pour un plafond de % (devise pivot). Dépassement de %. Une dérogation du DG est requise, ou une garantie doit être enregistrée.',
    e.partner_name,
    round(e.exposure_pivot, 2), round(engagement, 2), round(e.credit_limit_pivot, 2),
    round(e.exposure_pivot + engagement - e.credit_limit_pivot, 2)
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_credit_capacity ON deals;
CREATE TRIGGER trg_credit_capacity
  BEFORE INSERT OR UPDATE OF credit_approved_by_id, contracted_volume,
                             unit_sale_price, credit_derogation_id ON deals
  FOR EACH ROW EXECUTE FUNCTION enforce_credit_capacity();


-- ---------------------------------------------------------------------------
--  Clients au-delà de leur plafond — l'antérieur, que le verrou ne défait pas.
-- ---------------------------------------------------------------------------
CREATE VIEW v_credit_depasse AS
SELECT partner_code, partner_name, credit_status,
       round(credit_limit_pivot, 2) AS plafond,
       round(exposure_pivot, 2)     AS engage,
       round(exposure_pivot - credit_limit_pivot, 2) AS depassement,
       utilisation_pct
  FROM v_partner_credit_exposure
 WHERE credit_limit_pivot > 0
   AND exposure_pivot > credit_limit_pivot;

COMMENT ON VIEW v_credit_depasse IS
  'Clients dont l''en-cours dépasse le plafond (§ 9.1). Le verrou l''empêche désormais à l''approbation ; ceci montre ce qui est déjà passé.';


-- ─── 20_tarif_transporteur.sql ───────────────────────────────────

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


-- ─── 21_referentiels_administrables.sql ──────────────────────────

-- ===========================================================================
--  CE QUI MANQUAIT POUR QUE LES RÉFÉRENTIELS SOIENT ADMINISTRABLES
--  Réf. SPECIFICATIONS.md § 1.1 bis
--
--  Règle de la direction, posée deux fois :
--
--    « Toutes les données dont l'ERP a besoin pour fonctionner doivent être
--      paramétrables via une interface comme via un import Excel. »
--
--  Huit tables n'avaient AUCUN chemin d'écriture — ni écran, ni import, ni
--  API. On ne pouvait y saisir ni un client, ni un prix d'achat : en l'état,
--  l'application n'était pas déployable.
--
--  Les déclarer au registre suffit pour la plupart. Trois demandent d'abord
--  une correction en base, faute de quoi le paramétrage produirait des données
--  incohérentes ou introuvables.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. LE TAUX D'ABSORPTION EST CALCULÉ, PAS SAISI.
--
--  Un CHECK impose déjà `rate_per_unit = budgeted_amount / budgeted_base`. Le
--  faire saisir reviendrait donc à demander à l'exploitant de poser une
--  division à la main, puis à la lui refuser s'il se trompe d'une décimale —
--  et le message ne dirait pas laquelle des trois valeurs est fautive.
--
--  On le DÉRIVE. L'exploitant saisit le budget et l'assiette, qui sont les
--  seules données qu'il connaisse.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION derive_absorption_rate()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.budgeted_base IS NULL OR NEW.budgeted_base = 0 THEN
    RAISE EXCEPTION
      'ASSIETTE D''ABSORPTION — l''assiette budgétée ne peut pas être nulle : le taux se calcule en divisant le budget par elle. Indiquez le volume, le nombre d''opérations ou le chiffre d''affaires prévu pour l''exercice.'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.rate_per_unit := round(NEW.budgeted_amount / NEW.budgeted_base, 6);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_derive_absorption_rate ON absorption_rates;
CREATE TRIGGER trg_derive_absorption_rate
  BEFORE INSERT OR UPDATE OF budgeted_amount, budgeted_base, rate_per_unit
  ON absorption_rates
  FOR EACH ROW EXECUTE FUNCTION derive_absorption_rate();


-- ---------------------------------------------------------------------------
--  2. LE MONTANT PIVOT D'UNE GARANTIE EST CALCULÉ, PAS SAISI.
--
--  Il déduit l'exposition crédit du client. Le laisser saisir libre permettrait
--  d'ouvrir un plafond en écrivant un nombre — sans qu'aucune banque n'ait rien
--  garanti.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION derive_guarantee_pivot()
RETURNS TRIGGER AS $$
DECLARE
  taux numeric;
BEGIN
  taux := cours_vers_pivot(NEW.currency_code);
  IF taux IS NULL THEN
    RAISE EXCEPTION
      'GARANTIE — aucun cours de change entre % et la devise pivot. Saisissez-le au référentiel avant d''enregistrer la garantie : sans lui, son montant serait compté à l''unité près comme si les deux monnaies se valaient.',
      NEW.currency_code
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.fx_rate_to_pivot := taux;
  NEW.amount_pivot := round(NEW.amount * taux, 4);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_derive_guarantee_pivot ON guarantees;
CREATE TRIGGER trg_derive_guarantee_pivot
  BEFORE INSERT OR UPDATE OF amount, currency_code ON guarantees
  FOR EACH ROW EXECUTE FUNCTION derive_guarantee_pivot();


-- ---------------------------------------------------------------------------
--  3. UN CHAUFFEUR DOIT ÊTRE IDENTIFIABLE PAR AUTRE CHOSE QUE SON IDENTIFIANT.
--
--  La table n'avait aucune contrainte d'unicité en dehors de la clé primaire.
--  Un import répété aurait donc créé un chauffeur de plus à chaque passage,
--  sans que rien ne s'y oppose — et le référentiel se serait rempli
--  d'homonymes que personne n'aurait su départager.
--
--  L'unicité porte sur le couple TRANSPORTEUR + MATRICULE, et seulement quand
--  le matricule est renseigné : tous les transporteurs n'en attribuent pas.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uq_driver_matricule;
CREATE UNIQUE INDEX uq_driver_matricule
  ON drivers (carrier_id, employee_number)
  WHERE employee_number IS NOT NULL;


-- ---------------------------------------------------------------------------
--  4. LES PRODUITS AUTORISÉS D'UNE CITERNE DOIVENT ÊTRE OPPOSÉS.
--
--  `vehicles.allowed_product_ids` était administrable — et lu NULLE PART. Le
--  commentaire du schéma promettait pourtant le contraire. L'exploitant
--  restreignait une citerne au gasoil, le système l'affectait à un chargement
--  d'essence sans un mot.
--
--  Une liste VIDE vaut « tous produits » : c'est la convention retenue partout
--  ailleurs (segments, modes de transport), et l'inverse rendrait tout véhicule
--  inaffectable tant que personne n'aurait rempli la liste.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_vehicle_allowed_products()
RETURNS TRIGGER AS $$
DECLARE
  autorises uuid[];
  produit   uuid;
  nom_prod  text;
  immat     text;
BEGIN
  IF NEW.vehicle_id IS NULL THEN RETURN NEW; END IF;

  SELECT v.allowed_product_ids, v.registration INTO autorises, immat
    FROM vehicles v WHERE v.id = NEW.vehicle_id;

  IF autorises IS NULL OR cardinality(autorises) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT d.product_id INTO produit
    FROM operations o JOIN deals d ON d.id = o.deal_id
   WHERE o.id = NEW.operation_id;

  IF produit IS NULL OR produit = ANY (autorises) THEN
    RETURN NEW;
  END IF;

  SELECT name INTO nom_prod FROM products WHERE id = produit;
  RAISE EXCEPTION
    'PRODUIT NON AUTORISÉ — la citerne % n''est pas habilitée à transporter %. Modifiez la liste des produits autorisés au référentiel des véhicules, ou affectez un autre véhicule.',
    immat, COALESCE(nom_prod, 'ce produit')
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vehicle_allowed_products ON operation_assignments;
CREATE TRIGGER trg_vehicle_allowed_products
  BEFORE INSERT OR UPDATE OF vehicle_id ON operation_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_vehicle_allowed_products();


-- ---------------------------------------------------------------------------
--  5. LA CAPACITÉ D'UNE CITERNE DOIT ÊTRE OPPOSÉE AU VOLUME PLANIFIÉ.
--
--  `capacity` et `compartment_count` étaient administrables, et jamais
--  confrontés à quoi que ce soit. Une opération de 40 000 L s'affectait à une
--  citerne de 25 000 L sans avertissement — et l'écart se découvrait au dépôt.
--
--  La capacité est en UNITÉ DU VÉHICULE ; on ne compare que si l'opération est
--  dans la même unité. Comparer des litres à des tonnes serait pire que ne rien
--  comparer du tout.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_vehicle_capacity()
RETURNS TRIGGER AS $$
DECLARE
  cap    numeric;
  immat  text;
  vol    numeric;
BEGIN
  IF NEW.vehicle_id IS NULL THEN RETURN NEW; END IF;

  SELECT v.capacity, v.registration INTO cap, immat FROM vehicles v WHERE v.id = NEW.vehicle_id;
  IF cap IS NULL OR cap = 0 THEN RETURN NEW; END IF;

  SELECT o.planned_volume INTO vol FROM operations o WHERE o.id = NEW.operation_id;
  IF vol IS NULL OR vol <= cap THEN RETURN NEW; END IF;

  RAISE EXCEPTION
    'CAPACITÉ INSUFFISANTE — la citerne % contient % et l''opération en prévoit %. Affectez un véhicule adapté, ou fractionnez l''opération.',
    immat, round(cap, 0), round(vol, 0)
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vehicle_capacity ON operation_assignments;
CREATE TRIGGER trg_vehicle_capacity
  BEFORE INSERT OR UPDATE OF vehicle_id ON operation_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_vehicle_capacity();


-- ---------------------------------------------------------------------------
--  6. LE VOLUME MINIMUM D'UN PRIX FOURNISSEUR DOIT ÊTRE OPPOSÉ.
--
--  `supplier_prices.min_volume` était administrable et lu nulle part : un
--  palier négocié à partir de 20 000 L était proposé pour 500 L, retenu comme
--  prix d'achat, et toute la chaîne de marge se calculait dessus.
--
--  Le contrôle joue à l'APPROBATION, comme les autres verrous économiques :
--  c'est le moment où l'affaire engage l'entreprise.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_supplier_price_min_volume()
RETURNS TRIGGER AS $$
DECLARE
  seuil numeric;
BEGIN
  IF NEW.credit_approved_by_id IS NULL OR NEW.supplier_price_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT min_volume INTO seuil FROM supplier_prices WHERE id = NEW.supplier_price_id;
  IF seuil IS NULL OR NEW.contracted_volume >= seuil THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'PALIER DE PRIX — le prix fournisseur retenu ne s''applique qu''à partir de %, et l''affaire ne porte que sur %. Retenez le prix correspondant au volume, ou négociez le palier.',
    round(seuil, 0), round(NEW.contracted_volume, 0)
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_price_min_volume ON deals;
CREATE TRIGGER trg_supplier_price_min_volume
  BEFORE INSERT OR UPDATE OF supplier_price_id, contracted_volume, credit_approved_by_id
  ON deals
  FOR EACH ROW EXECUTE FUNCTION enforce_supplier_price_min_volume();


-- ===========================================================================
--  UNE LISTE VIDE EST UNE LISTE VIDE, PAS UN NUL
--
--  LE DÉFAUT, ET IL MORDAIT DÉJÀ
--  -----------------------------
--  Toutes les colonnes TABLEAU du modèle expriment la même convention :
--  « vide = tous ». Les vues la lisent partout de la même façon —
--  `cardinality(colonne) = 0`.
--
--  Or `cardinality(NULL)` ne vaut pas zéro : il vaut NULL. La condition entière
--  devient NULL, donc fausse, et l'objet n'est rattaché à RIEN au moment précis
--  où il devait l'être à TOUT. C'est l'inverse exact de ce que le libellé
--  « Vide = tous les segments » promet sous le champ.
--
--  L'écran de paramétrage écrivait NULL sur un champ laissé vide. Constaté sur
--  les quatre pools de charges saisis par la direction : leur assiette révisée
--  ressortait vide, sans qu'aucun message ne l'explique — le genre de silence
--  qu'on met des mois à remarquer.
--
--  La conversion côté serveur écrit désormais un tableau vide. Cette reprise
--  traite ce qui a été écrit avant, et se rejoue sans effet.
--
--  ⚠️ PAS DE `SET NOT NULL` ICI, ET C'EST DÉLIBÉRÉ.
--
--     Prisma modélise les listes comme non nulles côté client mais génère la
--     colonne sans contrainte. Poser NOT NULL creuserait un écart entre le
--     schéma déclaré et la base, que le calcul d'écart de la migration suivante
--     proposerait d'annuler — on gagnerait la contrainte pour la reperdre au
--     prochain changement de schéma, sans que personne ne le voie passer.
--     La garantie est donc tenue au point d'écriture, et les lectures sont
--     rendues insensibles au NUL.
-- ===========================================================================
UPDATE cost_pools              SET segments = '{}'                    WHERE segments IS NULL;
UPDATE operation_types         SET segments = '{}'                    WHERE segments IS NULL;
UPDATE sites                   SET usages = '{}'                      WHERE usages IS NULL;
UPDATE vehicles                SET allowed_product_ids = '{}'         WHERE allowed_product_ids IS NULL;
UPDATE hse_checklist_templates SET applicable_segments = '{}'         WHERE applicable_segments IS NULL;
UPDATE hse_checklist_templates SET applicable_transport_modes = '{}'  WHERE applicable_transport_modes IS NULL;
UPDATE hse_checklist_templates SET applicable_risk_levels = '{}'      WHERE applicable_risk_levels IS NULL;


-- ─── 24_exercice_et_budget.sql ───────────────────────────────────

-- ===========================================================================
--  EXERCICE COMPTABLE ET DONNÉES BUDGÉTAIRES
--  Réf. SPECIFICATIONS.md § 14.2, § 14.3, § 14.5, § 14.6, § 19 (points 2c/2d/2e)
--
--  Le § 19 laissait trois valeurs ouvertes — taux de financement, budget de
--  charges fixes, contenu des regroupements — en attendant le CFO. Elles sont
--  désormais des DONNÉES rattachées à un exercice, saisissables et révisables,
--  et non des constantes.
--
--  ⚠️ CE FICHIER N'INSCRIT AUCUNE VALEUR MÉTIER.
--
--     Pas de taux à 10 %, pas de budget d'illustration. Une valeur inventée ici
--     serait indiscernable d'une valeur décidée, et le CFO découvrirait au
--     premier calcul qu'il pilote sur un chiffre dont personne n'est l'auteur.
--     Le système doit dire « je ne sais pas », pas deviner.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Bornes de l'exercice cohérentes.
-- ---------------------------------------------------------------------------
ALTER TABLE fiscal_years DROP CONSTRAINT IF EXISTS chk_fiscal_year_bornes;
ALTER TABLE fiscal_years ADD CONSTRAINT chk_fiscal_year_bornes
  CHECK (ends_on > starts_on);

-- Un exercice de plus de deux ans ou de moins d'un mois est une faute de
-- saisie, pas un choix de gestion.
ALTER TABLE fiscal_years DROP CONSTRAINT IF EXISTS chk_fiscal_year_duree;
ALTER TABLE fiscal_years ADD CONSTRAINT chk_fiscal_year_duree
  CHECK (ends_on <= starts_on + interval '2 years'
     AND ends_on >= starts_on + interval '1 month');

-- ---------------------------------------------------------------------------
--  2. UN SEUL exercice courant.
--
--  Un index partiel unique plutôt qu'un déclencheur : la base refuse le second
--  au lieu de le corriger silencieusement, et l'erreur remonte à celui qui
--  l'écrit.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uniq_fiscal_year_courant;
CREATE UNIQUE INDEX uniq_fiscal_year_courant
  ON fiscal_years ((true)) WHERE is_current;

-- ---------------------------------------------------------------------------
--  3. Une seule version courante par exercice, pour chaque famille de valeurs.
--
--  Sans ceci, deux taux de financement « courants » coexistent et la fonction
--  de résolution en choisit un au hasard de l'ordre physique des lignes. Le
--  coût de portage changerait alors d'une requête à l'autre, sans que rien ne
--  bouge en base — le genre de défaut qu'on met des semaines à croire.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uniq_financing_rate_courant;
CREATE UNIQUE INDEX uniq_financing_rate_courant
  ON financing_rates (fiscal_year_id) WHERE is_current;

DROP INDEX IF EXISTS uniq_sales_forecast_courant;
CREATE UNIQUE INDEX uniq_sales_forecast_courant
  ON sales_forecasts (fiscal_year_id, segment, product_id, month_index, kind)
  WHERE is_current;

-- ⚠️ LES INDEX SUR `fixed_cost_budgets` ONT DISPARU AVEC LA TABLE.
--
--    Les charges fixes se DÉRIVENT désormais de la somme des budgets des pools
--    déclarés FIXED (fichier 34). Elles se saisissaient à part et décrivaient
--    le même argent que les pools : deux saisies parallèles que rien ne
--    rapprochait. L'unicité qu'on garantissait ici est désormais celle du taux
--    d'absorption du pool, ci-dessous.

-- Un seul taux courant par pool et par exercice. Sans lui, deux taux
-- « courants » coexistent, la somme des charges fixes double, et le point mort
-- avec elle.
DROP INDEX IF EXISTS uniq_absorption_courant;
CREATE UNIQUE INDEX uniq_absorption_courant
  ON absorption_rates (cost_pool_id, fiscal_year_id) WHERE is_current;

-- ---------------------------------------------------------------------------
--  4. Bornes de saisie.
-- ---------------------------------------------------------------------------
ALTER TABLE sales_forecasts DROP CONSTRAINT IF EXISTS chk_forecast_mois;
ALTER TABLE sales_forecasts ADD CONSTRAINT chk_forecast_mois
  CHECK (month_index BETWEEN 1 AND 12);

ALTER TABLE sales_forecasts DROP CONSTRAINT IF EXISTS chk_forecast_positif;
ALTER TABLE sales_forecasts ADD CONSTRAINT chk_forecast_positif
  CHECK (forecast_volume >= 0 AND reference_price >= 0);

-- Le budget d'un pool remplace le budget de charges fixes : c'est lui qu'on
-- borne désormais.
ALTER TABLE absorption_rates DROP CONSTRAINT IF EXISTS chk_absorption_budget_positif;
ALTER TABLE absorption_rates ADD CONSTRAINT chk_absorption_budget_positif
  CHECK (budgeted_amount >= 0);

-- Un taux négatif n'a pas de sens ; au-delà de 100 % l'an, c'est une saisie en
-- points de base prise pour un pourcentage.
ALTER TABLE financing_rates DROP CONSTRAINT IF EXISTS chk_financing_rate_plage;
ALTER TABLE financing_rates ADD CONSTRAINT chk_financing_rate_plage
  CHECK (annual_rate_pct >= 0 AND annual_rate_pct <= 100
     AND carrying_days_per_year BETWEEN 360 AND 366);

-- ---------------------------------------------------------------------------
--  5. Un exercice CLOS ne se modifie plus.
--
--  C'est tout l'intérêt de rattacher les valeurs à un exercice : l'affaire
--  close en 2026 reste évaluée aux conditions de 2026. Autoriser la retouche
--  d'un exercice clos rendrait ce rattachement décoratif.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refuse_ecriture_exercice_clos()
RETURNS TRIGGER AS $$
DECLARE
  etat text;
  millesime int;
BEGIN
  SELECT f.status::text, f.year INTO etat, millesime
    FROM fiscal_years f
   WHERE f.id = COALESCE(NEW.fiscal_year_id, OLD.fiscal_year_id);

  IF etat = 'CLOSED' THEN
    RAISE EXCEPTION
      'L''exercice % est clos : ses valeurs budgétaires ne se modifient plus. Rouvrir l''exercice est une décision explicite, pas un effet de bord d''une saisie.',
      millesime
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_financing_rate_exercice_clos ON financing_rates;
CREATE TRIGGER trg_financing_rate_exercice_clos
  BEFORE INSERT OR UPDATE ON financing_rates
  FOR EACH ROW EXECUTE FUNCTION refuse_ecriture_exercice_clos();

DROP TRIGGER IF EXISTS trg_absorption_exercice_clos ON absorption_rates;
CREATE TRIGGER trg_absorption_exercice_clos
  BEFORE INSERT OR UPDATE ON absorption_rates
  FOR EACH ROW EXECUTE FUNCTION refuse_ecriture_exercice_clos();

DROP TRIGGER IF EXISTS trg_forecast_exercice_clos ON sales_forecasts;
CREATE TRIGGER trg_forecast_exercice_clos
  BEFORE INSERT OR UPDATE ON sales_forecasts
  FOR EACH ROW EXECUTE FUNCTION refuse_ecriture_exercice_clos();

-- ---------------------------------------------------------------------------
--  6. Le budget validé ne s'écrase jamais (§ 14.3, étape 5).
--
--  Une révision trimestrielle crée une ligne de nature REVISION. Modifier une
--  ligne BUDGET déjà posée reviendrait à réécrire l'engagement pris devant le
--  DG — et à rendre l'écart budget/révision inobservable, alors que c'est
--  précisément ce qu'on veut mesurer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION protege_budget_valide()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.kind::text = 'BUDGET' AND NEW.kind::text = 'BUDGET' THEN
    -- Seule la sortie de version courante reste permise : c'est ainsi qu'une
    -- révision prend le relais sans effacer ce qu'elle remplace.
    IF NEW.forecast_volume <> OLD.forecast_volume
       OR NEW.reference_price <> OLD.reference_price
       OR NEW.segment <> OLD.segment
       OR NEW.product_id <> OLD.product_id
       OR NEW.month_index <> OLD.month_index THEN
      RAISE EXCEPTION
        'Le budget de vente validé ne se modifie pas : créer une RÉVISION. Sans cela, l''écart entre le budget et la réalité devient invisible — et c''est lui qu''on pilote.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protege_budget_valide ON sales_forecasts;
CREATE TRIGGER trg_protege_budget_valide
  BEFORE UPDATE ON sales_forecasts
  FOR EACH ROW EXECUTE FUNCTION protege_budget_valide();


-- ===========================================================================
--  RÉSOLUTION — ce que le reste du système interroge.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  L'exercice courant.
--
--  Sous-select scalaire : sans ligne, il rend NULL, et l'appelant le voit.
--  Le repli sur `CURRENT_FISCAL_YEAR` n'existe QUE pour la transition — le
--  paramètre global précédait ces tables.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION exercice_courant()
RETURNS uuid AS $$
  SELECT COALESCE(
    (SELECT id FROM fiscal_years WHERE is_current LIMIT 1),
    (SELECT f.id FROM fiscal_years f
      WHERE f.year = (SELECT NULLIF(value, '')::int
                        FROM system_settings WHERE key = 'CURRENT_FISCAL_YEAR')
      LIMIT 1)
  );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION exercice_courant() IS
  'Exercice de référence (§ 14.3). NULL si aucun n''est déclaré courant — et c''est alors à l''appelant de le dire, pas d''en inventer un.';

-- ---------------------------------------------------------------------------
--  Le taux de financement de l'exercice, et sa base de jours.
--
--  ⚠️ AUCUN REPLI SUR UNE VALEUR INVENTÉE.
--
--     `FINANCING_RATE_ANNUAL_PCT` valait 10 en paramètre global, à titre
--     d'illustration. Le § 19 le disait : « à caler sur vos conditions
--     bancaires réelles ». Tant que le CFO n'a pas saisi le taux de
--     l'exercice, cette fonction rend NULL — et le point mort dira « taux de
--     financement non renseigné » au lieu d'afficher un chiffre convaincant
--     et faux.
--
--     Le paramètre global reste lu en dernier recours pour ne pas casser le
--     calcul de marge existant pendant la transition, mais il est signalé
--     comme provisoire par la vue de couverture plus bas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION taux_financement(p_fiscal_year_id uuid DEFAULT NULL)
RETURNS numeric AS $$
  SELECT COALESCE(
    (SELECT fr.annual_rate_pct
       FROM financing_rates fr
      WHERE fr.fiscal_year_id = COALESCE(p_fiscal_year_id, exercice_courant())
        AND fr.is_current),
    (SELECT NULLIF(value, '')::numeric
       FROM system_settings WHERE key = 'FINANCING_RATE_ANNUAL_PCT')
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION jours_portage_an(p_fiscal_year_id uuid DEFAULT NULL)
RETURNS int AS $$
  SELECT COALESCE(
    (SELECT fr.carrying_days_per_year
       FROM financing_rates fr
      WHERE fr.fiscal_year_id = COALESCE(p_fiscal_year_id, exercice_courant())
        AND fr.is_current),
    (SELECT NULLIF(value, '')::int
       FROM system_settings WHERE key = 'CARRYING_DAYS_PER_YEAR'),
    360
  );
$$ LANGUAGE sql STABLE;


-- ---------------------------------------------------------------------------
--  LES CHARGES FIXES DE L'EXERCICE, DÉRIVÉES DES POOLS (§ 14.5)
--
--  Elles se saisissaient dans `fixed_cost_budgets`, table supprimée. Le budget
--  d'un pool est saisi UNE FOIS et sert DEUX FOIS :
--
--    · divisé par l'assiette → la charge au litre → le seuil de marge ;
--    · sommé sur les pools FIXES → le numérateur du point mort.
--
--  ⚠️ SEULS LES POOLS *FIXED* Y ENTRENT.
--
--     Un pool VARIABLE — des commissions bancaires proportionnelles, par
--     exemple — s'absorbe bien au litre, mais n'est pas une charge fixe : la
--     marge sur coût variable le compte déjà. L'ajouter ici le compterait deux
--     fois et gonflerait le point mort d'autant.
--
--  La doctrine complète est dans le fichier 34 ; la vue est ici parce que le
--  point mort (fichier 25) la lit, et que 25 précède 34.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_charges_fixes_exercice AS
SELECT f.id                                                        AS fiscal_year_id,
       f.year                                                      AS exercice,
       f.label,
       f.status::text                                              AS statut,
       count(*) FILTER (WHERE cp.id IS NOT NULL)                   AS pools,
       COALESCE(sum(ar.budgeted_amount)
                FILTER (WHERE cp.id IS NOT NULL), 0)               AS charges_fixes,
       -- ⚠️ ON NE SOMME PAS DES DEVISES DIFFÉRENTES SANS LE DIRE.
       --    Le total resterait un nombre, et le point mort en découlerait
       --    comme si de rien n'était. Même discipline que pour les unités.
       count(DISTINCT cp.currency_code)                            AS devises,
       min(cp.currency_code)                                       AS devise
  FROM fiscal_years f
  LEFT JOIN absorption_rates ar
    ON ar.fiscal_year_id = f.id
   AND ar.is_current
  -- La jointure PORTE le filtre de nature : un taux dont le pool est variable
  -- ou inactif donne `cp.id` nul, et les agrégats l'ignorent. Le filtrer en
  -- WHERE ferait DISPARAÎTRE l'exercice qui n'a que des pools variables — et
  -- le point mort, qui doit toujours rendre une ligne, n'aurait plus rien à
  -- lire.
  LEFT JOIN cost_pools cp
    ON cp.id = ar.cost_pool_id
   AND cp.is_active
   AND cp.variability::text = 'FIXED'
 GROUP BY f.id, f.year, f.label, f.status;

COMMENT ON VIEW v_charges_fixes_exercice IS
  'Charges fixes de l''exercice (§ 14.5), DÉRIVÉES de la somme des budgets des pools déclarés FIXED. Elles ne se saisissent plus : une seule saisie sert au seuil de marge et au point mort, ce que deux saisies parallèles ne pouvaient pas garantir. `devises` > 1 = total dénué de sens, et le point mort le dit.';


-- ===========================================================================
--  COUVERTURE — ce qui manque pour que le pilotage soit calculable.
--
--  C'est la pièce maîtresse de ce fichier : plutôt que de combler les trous
--  avec des valeurs plausibles, on les DÉSIGNE. Le CFO voit ce qu'on attend de
--  lui, et le système refuse de calculer tant qu'il ne l'a pas.
-- ===========================================================================
CREATE OR REPLACE VIEW v_couverture_budgetaire AS
WITH ex AS (
  SELECT f.id, f.year, f.label, f.status::text AS statut
    FROM fiscal_years f
   WHERE f.status::text <> 'CLOSED'
)
SELECT ex.year                                       AS exercice,
       ex.label,
       ex.statut,
       'Taux de financement'::text                   AS donnee,
       EXISTS (SELECT 1 FROM financing_rates fr
                WHERE fr.fiscal_year_id = ex.id AND fr.is_current) AS renseignee,
       'Coût de portage (§ 5.4) et BFR (§ 14.6)'::text AS sert_a
  FROM ex

-- ⚠️ L'ORDRE DE CES DEUX LIGNES EST L'ORDRE DE SAISIE, ET IL EST CONTRAINT.
--
--    La prévision d'abord : elle EST l'assiette d'absorption. Le budget d'un
--    pool ne peut plus se saisir avant elle — la base le refuse, faute de
--    dénominateur à lire. C'est voulu : l'ordre inverse produisait un taux
--    calé sur une assiette recopiée à la main, qui divergeait ensuite.
UNION ALL
SELECT ex.year, ex.label, ex.statut,
       'Prévision de volumes',
       EXISTS (SELECT 1 FROM sales_forecasts s
                WHERE s.fiscal_year_id = ex.id AND s.is_current
                  AND s.kind::text = 'BUDGET'),
       'Assiette d''absorption (§ 14.2), plan d''approvisionnement et de trésorerie (§ 14.3)'
  FROM ex

-- Une seule ligne pour les deux usages, parce qu'il n'y a plus qu'une saisie :
-- le budget d'un pool sert au seuil de marge ET, s'il est de nature fixe, au
-- point mort. C'est tout l'objet de la dérivation.
UNION ALL
SELECT ex.year, ex.label, ex.statut,
       'Budget des pools de charges',
       EXISTS (SELECT 1 FROM absorption_rates a
                WHERE a.fiscal_year_id = ex.id AND a.is_current),
       'Coût complet et seuil de marge (§ 14.2) ; les pools FIXES forment aussi les charges fixes du point mort (§ 14.5)'
  FROM ex

-- Distincte de la précédente : on peut avoir budgété des pools sans qu'aucun
-- ne soit de nature fixe. Le point mort serait alors de zéro litre, donc déjà
-- atteint — le genre de chiffre que personne ne remet en cause.
UNION ALL
SELECT ex.year, ex.label, ex.statut,
       -- Le libellé se lit dans la file de tâches suivi de « non saisi » :
       -- il doit rester un GROUPE NOMINAL, sans « au moins un ».
       'Pool de charges FIXES',
       EXISTS (SELECT 1 FROM absorption_rates a
                JOIN cost_pools cp ON cp.id = a.cost_pool_id
                WHERE a.fiscal_year_id = ex.id AND a.is_current
                  AND cp.is_active AND cp.variability::text = 'FIXED'),
       'Point mort (§ 14.5)'
  FROM ex;

COMMENT ON VIEW v_couverture_budgetaire IS
  'Ce que le CFO doit saisir pour que le pilotage soit calculable, exercice par exercice (§ 19). `renseignee` à false = la donnée manque, et le calcul qui en dépend doit se taire plutôt que deviner.';


-- ─── 25_pilotage_financier.sql ───────────────────────────────────

-- ===========================================================================
--  PILOTAGE FINANCIER — POINT MORT, BFR, ÉCART À LA PRÉVISION
--  Réf. SPECIFICATIONS.md § 14.3, § 14.5, § 14.6
--
--  ⚠️ CES VUES REFUSENT DE CALCULER PLUTÔT QUE DE DEVINER.
--
--     Un point mort affiché sans budget de charges fixes serait un nombre
--     convaincant fondé sur zéro : « point mort à 0 litre, déjà atteint ».
--     Personne ne remet en cause un chiffre qui s'affiche. Chaque vue porte
--     donc une colonne `calculable` et un `motif`, et laisse les résultats à
--     NULL tant que la donnée manque.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  MARGE SUR COÛT VARIABLE PAR SEGMENT (§ 14.5)
--
--  Sur le RÉALISÉ des affaires closes : c'est la structure de prix courante
--  qui compte, pas celle du budget. Le § 14.5 est explicite — « une marge sur
--  coût variable arrêtée une fois l'an est périmée en mars ».
--
--  On prend la marge DIRECTE, pas la marge complète : les charges indirectes
--  absorbées sont précisément les charges fixes qu'on cherche à couvrir. Les
--  compter dans le numérateur ET au dénominateur les compterait deux fois.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_marge_cout_variable AS
SELECT d.segment,
       count(*)                                        AS affaires,
       sum(d.contracted_volume)                        AS volume,
       d.uom,
       d.currency_code,
       -- Moyenne PONDÉRÉE par le volume : une petite affaire à forte marge ne
       -- doit pas peser autant qu'une grosse à marge faible.
       round(sum(d.realized_direct_margin * d.contracted_volume)
             / NULLIF(sum(d.contracted_volume), 0), 4) AS marge_variable_unitaire
  FROM deals d
 WHERE d.realized_direct_margin IS NOT NULL
   AND d.contracted_volume > 0
   AND d.status::text NOT IN ('DRAFT', 'CANCELLED', 'REJECTED_BY_CLIENT')
 GROUP BY d.segment, d.uom, d.currency_code;

COMMENT ON VIEW v_marge_cout_variable IS
  'Marge sur coût variable par segment, pondérée par le volume, sur le réalisé (§ 14.5). Marge DIRECTE : les indirectes absorbées sont les fixes qu''on cherche à couvrir, les compter ici les compterait deux fois.';


-- ---------------------------------------------------------------------------
--  POINT MORT (§ 14.5)
--
--    Seuil de rentabilité (litres) = Charges fixes ÷ Marge sur coût variable
--
--  Exprimé en VOLUME, jamais en chiffre d'affaires : le prix bouge sans que
--  l'entreprise le décide (DGH, change), et un point mort en francs serait
--  périmé à chaque publication.
-- ---------------------------------------------------------------------------
-- ⚠️ CETTE VUE REND TOUJOURS EXACTEMENT UNE LIGNE.
--
--    Écrite avec `FROM fiscal_years WHERE id = exercice_courant()`, elle rendait
--    ZÉRO ligne tant qu'aucun exercice n'était déclaré — et l'écran affichait
--    un vide indiscernable de « rien à signaler ». Un indicateur de pilotage
--    doit toujours parler, quitte à dire qu'il ne peut pas se prononcer.
--
--    Les trois CTE ci-dessous rendent chacun une ligne en toute circonstance :
--    `ex` n'a pas de FROM, les deux autres sont des agrégats sans GROUP BY.
CREATE OR REPLACE VIEW v_point_mort AS
WITH ex AS (
  SELECT exercice_courant()                                                     AS id,
         (SELECT f.year  FROM fiscal_years f WHERE f.id = exercice_courant())   AS year,
         (SELECT f.label FROM fiscal_years f WHERE f.id = exercice_courant())   AS label
),
-- ⚠️ LES CHARGES FIXES NE SE SAISISSENT PLUS : ELLES SE DÉRIVENT.
--
--    Elles venaient de `fixed_cost_budgets`, table supprimée. Elles sont
--    maintenant la somme des budgets des pools déclarés FIXES sur l'exercice
--    — la MÊME saisie que celle qui alimente le seuil de marge. Les deux
--    chiffres ne peuvent donc plus diverger, ce que deux saisies parallèles ne
--    pouvaient pas garantir.
fixes AS (
  SELECT COALESCE(c.charges_fixes, 0) AS charges_fixes,
         COALESCE(c.pools, 0)         AS pools,
         COALESCE(c.devises, 0)       AS devises,
         c.devise
    FROM (SELECT 1) unite
    LEFT JOIN v_charges_fixes_exercice c ON c.fiscal_year_id = exercice_courant()
),
-- Marge sur coût variable moyenne, tous segments confondus, pondérée par le
-- volume réalisé. Le § 14.5 retient un point mort GLOBAL : un point mort par
-- segment supposerait des charges fixes attribuables, ce qui n'est vrai que
-- pour la barge.
--
-- ⚠️ LA DEVISE ET L'UNITÉ SONT COMPTÉES, PAS SEULEMENT AGRÉGÉES.
--
--    Cette moyenne sommait des marges libellées dans des devises différentes
--    et des volumes exprimés dans des unités différentes. Le résultat restait
--    un nombre, et le point mort en découlait sans que rien ne le signale.
--    Tant qu'une seule devise et une seule unité sont en jeu — le cas normal —
--    rien ne change ; sinon la vue refuse de conclure.
mcv AS (
  SELECT round(sum(m.marge_variable_unitaire * m.volume)
               / NULLIF(sum(m.volume), 0), 4) AS marge_unitaire,
         sum(m.volume)                        AS volume_realise,
         count(DISTINCT m.currency_code)      AS devises,
         min(m.currency_code)                 AS devise,
         count(DISTINCT m.uom)                AS unites,
         min(m.uom::text)                     AS uom
    FROM v_marge_cout_variable m
)
SELECT ex.year                                          AS exercice,
       ex.label,
       f.charges_fixes,
       f.pools                                          AS pools_de_charges_fixes,
       f.devise                                         AS devise_charges,
       m.marge_unitaire,
       m.volume_realise,
       m.devise                                         AS devise_marge,
       m.uom,
       (ex.id IS NOT NULL AND f.pools > 0
        AND f.devises <= 1 AND m.devises <= 1 AND m.unites <= 1
        AND m.marge_unitaire IS NOT NULL AND m.marge_unitaire > 0
        AND (m.devise IS NULL OR f.devise IS NULL OR m.devise = f.devise))
                                                        AS calculable,
       CASE
         WHEN ex.id IS NULL
           THEN 'Aucun exercice comptable n''est déclaré courant. L''exercice se saisit — ses bornes ne sont ni l''année civile ni une constante (§ 14.3).'
         WHEN f.pools = 0
           THEN 'Aucun pool de charges FIXES n''est budgété sur cet exercice (§ 14.5) — le point mort serait de zéro litre, donc déjà atteint. Les charges fixes sont la somme des budgets des pools déclarés fixes : déclarez-en au moins un.'
         WHEN f.devises > 1
           THEN 'Les pools de charges fixes de cet exercice sont libellés dans plusieurs devises. Leur somme n''a pas de sens, et le point mort qui en découlerait non plus.'
         WHEN m.marge_unitaire IS NULL
           THEN 'Aucune affaire close avec marge directe réalisée : la marge sur coût variable ne peut pas être établie.'
         WHEN m.devises > 1
           THEN 'Les affaires closes sont libellées dans plusieurs devises : leur marge unitaire moyenne additionnerait des monnaies différentes.'
         WHEN m.unites > 1
           THEN 'Les affaires closes mêlent plusieurs unités de volume : la marge unitaire moyenne rapporterait des litres à des tonnes.'
         WHEN m.devise IS NOT NULL AND f.devise IS NOT NULL AND m.devise <> f.devise
           THEN 'Les charges fixes sont en ' || f.devise || ' et la marge sur coût variable en ' || m.devise || '. Diviser l''une par l''autre donnerait un volume faux du rapport des deux monnaies.'
         WHEN m.marge_unitaire <= 0
           THEN 'Marge sur coût variable nulle ou négative : aucun volume ne couvre les charges fixes. Ce n''est pas un point mort, c''est une alerte.'
         ELSE NULL
       END                                              AS motif,
       CASE WHEN f.pools > 0 AND f.devises <= 1 AND m.devises <= 1 AND m.unites <= 1
                 AND m.marge_unitaire > 0
                 AND (m.devise IS NULL OR f.devise IS NULL OR m.devise = f.devise)
            THEN round(f.charges_fixes / m.marge_unitaire, 0)
       END                                              AS point_mort_volume,
       CASE WHEN f.pools > 0 AND f.devises <= 1 AND m.devises <= 1 AND m.unites <= 1
                 AND m.marge_unitaire > 0
                 AND (m.devise IS NULL OR f.devise IS NULL OR m.devise = f.devise)
            THEN round(f.charges_fixes / m.marge_unitaire, 0) - COALESCE(m.volume_realise, 0)
       END                                              AS reste_a_vendre
  FROM ex
  CROSS JOIN fixes f
  CROSS JOIN mcv m;

COMMENT ON VIEW v_point_mort IS
  'Point mort en VOLUME sur l''exercice courant (§ 14.5). `calculable` à false : les colonnes de résultat restent nulles et `motif` dit ce qui manque — un point mort inventé est pire qu''absent.';


-- ---------------------------------------------------------------------------
--  BESOIN EN FONDS DE ROULEMENT D'EXPLOITATION (§ 14.6)
--
--    BFR = Avances fournisseurs + Stocks + Créances clients − Dettes fournisseurs
--
--  ⚠️ PÉRIMÈTRE ASSUMÉ ET AFFICHÉ.
--
--     Ce BFR est d'EXPLOITATION. Le BFR comptable intègre en outre la TVA à
--     récupérer et à reverser, les dettes sociales et fiscales, les acomptes.
--     Le chiffre différera de celui du comptable, et l'écran doit le dire —
--     sinon quelqu'un rapprochera les deux et conclura à une erreur.
--
--     Le poste STOCKS vaut zéro : il n'y a pas de module de stock. C'est une
--     absence, pas un zéro constaté, et la vue le distingue.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_bfr_exploitation AS
WITH avances AS (
  -- Reliquat seulement : une avance apurée aux deux tiers ne pèse que pour le
  -- tiers restant.
  SELECT COALESCE(sum(oa.outstanding_pivot), 0) AS montant
    FROM v_outstanding_advances oa
   WHERE oa.days_outstanding >= 0
),
creances AS (
  SELECT COALESCE(sum(ce.receivables_pivot), 0) AS montant
    FROM v_partner_credit_exposure ce
),
dettes AS (
  -- Proche de zéro par construction : Elyon paie AVANT livraison (§ 14.6).
  -- On le calcule quand même — c'est justement le fait qu'il soit nul qui
  -- explique la tension de trésorerie.
  SELECT COALESCE(sum(si.amount_pivot - COALESCE(si.paid_amount_pivot, 0)), 0) AS montant
    FROM supplier_invoices si
   WHERE si.status::text NOT IN ('PAID', 'CANCELLED')
)
SELECT a.montant                                     AS avances_fournisseurs,
       c.montant                                     AS creances_clients,
       d.montant                                     AS dettes_fournisseurs,
       0::numeric                                    AS stocks,
       false                                         AS stocks_suivis,
       round(a.montant + c.montant - d.montant, 2)   AS bfr_exploitation,
       'Exploitation seulement : hors TVA, dettes sociales et fiscales, acomptes. Diffère du BFR comptable, et c''est normal (§ 14.6).'::text
                                                     AS perimetre
  FROM avances a CROSS JOIN creances c CROSS JOIN dettes d;

COMMENT ON VIEW v_bfr_exploitation IS
  'BFR d''exploitation en devise pivot (§ 14.6). `stocks_suivis` à false : le zéro est une ABSENCE de module, pas un stock constaté nul.';


-- ---------------------------------------------------------------------------
--  LA PRÉVISION EN VIGUEUR, MOIS PAR MOIS (§ 14.3)
--
--  ⚠️ UNE RÉVISION REMPLACE LE BUDGET SUR SON MOIS. ELLE NE S'Y AJOUTE PAS.
--
--     Le défaut était exactement là : la vue de prévision additionnait toutes
--     les lignes courantes, budget ET révisions confondus. Un mois budgété à
--     900 000 L puis révisé à 750 000 L comptait pour 1 650 000 L — vérifié en
--     base. Et un mois révisé deux fois aurait compté trois fois.
--
--     Ce n'est pas une erreur d'affichage. Cette prévision alimente le plan
--     d'approvisionnement (§ 14.3, usage de rang 1), où l'on s'engage auprès de
--     la SIR et de GESTOCI avec des délais et des allocations. Surengager,
--     c'est de la trésorerie immobilisée sur une marge de 4 %.
--
--     Une seule ligne courante par nature et par mois est garantie par index
--     unique. La résolution est donc simple : la RÉVISION courante s'il en
--     existe une, sinon le BUDGET.
--
--  Le budget est conservé dans la même ligne — colonnes `volume_budget` et
--  `prix_budget`. C'est l'écart entre l'engagement initial et la prévision
--  courante qu'on pilote ; le perdre reviendrait à ne plus pouvoir dire de
--  combien on a revu l'ambition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_prevision_en_vigueur AS
SELECT DISTINCT ON (s.fiscal_year_id, s.segment, s.product_id, s.month_index)
       s.fiscal_year_id,
       f.year,
       s.segment,
       s.product_id,
       s.month_index,
       mois_exercice(s.fiscal_year_id, s.month_index)            AS mois_civil,
       s.forecast_volume,
       s.reference_price,
       s.currency_code,
       s.uom,
       s.kind::text                                              AS nature,
       (s.kind::text = 'REVISION')                               AS revise,
       s.version,
       -- Le budget d'origine de CETTE case, qu'une révision l'ait remplacé ou
       -- non. Nul si le mois n'a jamais été budgété — un produit apparu en
       -- cours d'exercice, cas prévu par le § 14.3.
       (SELECT b.forecast_volume FROM sales_forecasts b
         WHERE b.fiscal_year_id = s.fiscal_year_id
           AND b.segment = s.segment AND b.product_id = s.product_id
           AND b.month_index = s.month_index
           AND b.kind::text = 'BUDGET' AND b.is_current)         AS volume_budget,
       (SELECT b.reference_price FROM sales_forecasts b
         WHERE b.fiscal_year_id = s.fiscal_year_id
           AND b.segment = s.segment AND b.product_id = s.product_id
           AND b.month_index = s.month_index
           AND b.kind::text = 'BUDGET' AND b.is_current)         AS prix_budget
  FROM sales_forecasts s
  JOIN fiscal_years f ON f.id = s.fiscal_year_id
 WHERE s.is_current
 ORDER BY s.fiscal_year_id, s.segment, s.product_id, s.month_index,
          -- La révision passe devant le budget, et la version la plus haute
          -- devant les autres.
          (s.kind::text = 'REVISION') DESC, s.version DESC, s.created_at DESC;

COMMENT ON VIEW v_prevision_en_vigueur IS
  'Prévision qui FAIT FOI pour chaque mois (§ 14.3) : la révision courante si elle existe, sinon le budget. Une révision REMPLACE le budget sur son mois — les additionner gonflerait le plan d''approvisionnement de chaque révision.';


-- ---------------------------------------------------------------------------
--  PRÉVISION CONTRE RÉALISÉ (§ 14.3)
--
--  L'écart de VOLUME et l'écart de PRIX sont séparés, et c'est tout l'intérêt
--  d'avoir prévu en volume avec un prix de référence à part : un chiffre
--  d'affaires conforme au budget peut cacher 15 % de volume perdu compensé par
--  une hausse DGH que l'entreprise n'a pas décidée.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_prevision_vente AS
WITH prevu AS (
  SELECT e.fiscal_year_id,
         e.year,
         e.segment,
         e.product_id,
         sum(e.forecast_volume)                                  AS volume_prevu,
         round(sum(e.forecast_volume * e.reference_price), 2)     AS ca_prevu,
         -- Le budget reste exposé À CÔTÉ de la prévision en vigueur : c'est
         -- l'écart entre les deux qui dit de combien on a revu l'ambition, et
         -- c'est cet écart-là qu'on présente au DG.
         sum(e.volume_budget)                                    AS volume_budget,
         round(sum(e.volume_budget * e.prix_budget), 2)          AS ca_budget,
         e.currency_code,
         e.uom
    FROM v_prevision_en_vigueur e
   GROUP BY e.fiscal_year_id, e.year, e.segment, e.product_id, e.currency_code, e.uom
),
realise AS (
  SELECT f.id                                   AS fiscal_year_id,
         d.segment,
         d.product_id,
         sum(d.contracted_volume)               AS volume_realise,
         round(sum(d.contracted_volume * d.unit_sale_price), 2) AS ca_realise
    FROM deals d
    JOIN fiscal_years f
      ON d.created_at::date BETWEEN f.starts_on AND f.ends_on
   WHERE d.status::text NOT IN ('DRAFT', 'CANCELLED', 'REJECTED_BY_CLIENT')
   GROUP BY f.id, d.segment, d.product_id
)
SELECT p.year                                            AS exercice,
       p.segment,
       pr.code                                           AS produit,
       p.uom,
       p.currency_code,
       -- Prévision EN VIGUEUR : révision là où il y en a une, budget ailleurs.
       p.volume_prevu,
       COALESCE(r.volume_realise, 0)                     AS volume_realise,
       COALESCE(r.volume_realise, 0) - p.volume_prevu    AS ecart_volume,
       -- Le budget d'origine, conservé à côté. Deux écarts, deux questions
       -- distinctes : « ai-je tenu ma prévision courante ? » et « de combien
       -- ai-je revu mon engagement initial ? ». Les confondre ferait passer une
       -- ambition revue à la baisse pour un objectif atteint.
       p.volume_budget,
       p.volume_prevu - COALESCE(p.volume_budget, 0)     AS ecart_revision,
       p.ca_prevu,
       p.ca_budget,
       COALESCE(r.ca_realise, 0)                         AS ca_realise,
       -- L'écart de PRIX isolé : ce que le réalisé aurait donné AU PRIX PRÉVU,
       -- comparé à ce qu'il a donné réellement.
       round(COALESCE(r.ca_realise, 0)
             - COALESCE(r.volume_realise, 0)
               * (p.ca_prevu / NULLIF(p.volume_prevu, 0)), 2) AS ecart_prix
  FROM prevu p
  JOIN products pr ON pr.id = p.product_id
  LEFT JOIN realise r
    ON r.fiscal_year_id = p.fiscal_year_id
   AND r.segment = p.segment
   AND r.product_id = p.product_id;

COMMENT ON VIEW v_prevision_vente IS
  'Prévision contre réalisé, par segment et produit (§ 14.3). L''écart de PRIX est isolé de l''écart de VOLUME : un CA conforme peut cacher du volume perdu compensé par une hausse DGH.';


-- ─── 26_assiette_en_volume.sql ───────────────────────────────────

-- ===========================================================================
--  L'ASSIETTE D'ABSORPTION EST UN VOLUME BUDGÉTÉ, ET RIEN D'AUTRE
--  Réf. SPECIFICATIONS.md § 14.2, § 14.3
--
--  LA DÉCISION, ET POURQUOI ELLE TIENT
--  -----------------------------------
--  « Charge indirecte unitaire = Budget annuel ÷ Assiette annuelle budgétée »,
--  et le § 14.2 tranche le dénominateur : LE VOLUME BUDGÉTÉ.
--
--  Le volume est la variable que l'entreprise PILOTE. Le prix, non : il suit
--  les publications DGH et le taux de change. Une assiette en chiffre
--  d'affaires ferait donc bouger la charge fixe unitaire à chaque publication
--  de prix — sans qu'aucune charge n'ait changé, sans qu'aucune décision n'ait
--  été prise, et sans que rien ne le signale.
--
--  C'est la spirale d'absorption du § 14.2 sous une autre forme. Le
--  raisonnement y est tenu contre un dénominateur RÉALISÉ ; il vaut tout autant
--  contre un dénominateur en VALEUR : dans les deux cas le taux devient
--  mouvant, la marge calculée bouge, des affaires passent sous le seuil, et
--  personne ne sait pourquoi.
--
--  ⚠️ CE FICHIER NE LAISSE QU'UNE SEULE BASE D'IMPUTATION OUVERTE.
--
--     PER_REVENUE a été fermée en premier — l'assiette en valeur.
--     PER_OPERATION l'est à son tour, et c'est un choix du dirigeant, pas une
--     limite technique : « Pools imputés à l'opération : non ».
--
--     La raison de fond est que l'assiette se DÉRIVE désormais de la prévision
--     de vente (fichier 34), laquelle prévoit des VOLUMES. Rien n'y prévoit un
--     nombre de rotations. Un pool imputé à l'opération n'aurait donc aucun
--     dénominateur à lire, et il faudrait lui en faire saisir un à la main —
--     c'est-à-dire rouvrir la double saisie qu'on vient de supprimer.
--
--     Les deux valeurs restent dans l'énumération : des lignes historiques les
--     portent, et une énumération se réduit mal. Elles deviennent simplement
--     INUTILISABLES sur un pool actif.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

CREATE OR REPLACE FUNCTION refuse_assiette_en_valeur()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT NEW.is_active THEN
    RETURN NEW;
  END IF;

  IF NEW.allocation_basis::text = 'PER_REVENUE' THEN
    RAISE EXCEPTION
      'Le pool « % » ne peut pas s''imputer au prorata du chiffre d''affaires. L''assiette d''absorption est un VOLUME budgété (§ 14.2) : le volume est piloté, le prix ne l''est pas — il suit les publications DGH et le change. Une assiette en valeur ferait bouger la charge fixe unitaire à chaque publication, sans qu''aucune charge n''ait changé. Employer PER_VOLUME.',
      NEW.code
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.allocation_basis::text = 'PER_OPERATION' THEN
    RAISE EXCEPTION
      'Le pool « % » ne peut pas s''imputer au nombre d''opérations. L''assiette se dérive de la prévision de vente, qui prévoit des VOLUMES et non des rotations : ce pool n''aurait aucun dénominateur à lire, et lui en faire saisir un rouvrirait la double saisie qu''on a supprimée. Employer PER_VOLUME.',
      NEW.code
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assiette_en_valeur ON cost_pools;
CREATE TRIGGER trg_assiette_en_valeur
  BEFORE INSERT OR UPDATE ON cost_pools
  FOR EACH ROW EXECUTE FUNCTION refuse_assiette_en_valeur();

-- ---------------------------------------------------------------------------
--  REPRISE — un déclencheur ne juge que les écritures postérieures à sa pose.
--
--  Les pools déjà en base lui échappent. On les désactive plutôt que de les
--  supprimer : leurs taux passés restent lisibles, et un pool supprimé
--  emporterait l'explication d'un coût déjà calculé.
-- ---------------------------------------------------------------------------
UPDATE cost_pools
   SET is_active = false
 WHERE is_active
   AND allocation_basis::text IN ('PER_REVENUE', 'PER_OPERATION');

-- ---------------------------------------------------------------------------
--  ⚠️ `v_assiette_absorption` A ÉTÉ SUPPRIMÉE — ELLE N'A PLUS D'OBJET.
--
--     Elle confrontait l'assiette SAISIE à la prévision budgétée, parce que
--     les deux se saisissaient séparément et finiraient par diverger. Le
--     fichier 34 supprime la saisie : l'assiette EST la prévision, et l'écart
--     est nul par construction. Une vue qui affiche toujours zéro n'informe
--     personne — elle rassure, ce qui est pire.
--
--     Ce qu'on veut voir à la place est ailleurs : `v_absorption_reelle`
--     compare la charge au litre selon l'assiette budgétée, révisée et
--     réalisée. C'est l'écart qui reste après qu'on a supprimé celui-ci.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS v_assiette_absorption;


-- ─── 27_crm_pipeline.sql ─────────────────────────────────────────

-- ===========================================================================
--  CRM — VERROUS ET LECTURES DU PIPELINE
--  Réf. SPECIFICATIONS.md § 15, § 14.3
--
--  Le CRM alimente la prévision (§ 14.3), qui alimente l'assiette d'absorption
--  (§ 14.2), qui alimente le seuil de marge (§ 5.4). Un pipeline complaisant ne
--  reste pas un problème commercial : il devient un problème de coût de
--  revient.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Bornes de saisie.
-- ---------------------------------------------------------------------------
ALTER TABLE crm_pipeline_stages DROP CONSTRAINT IF EXISTS chk_crm_stage_probabilite;
ALTER TABLE crm_pipeline_stages ADD CONSTRAINT chk_crm_stage_probabilite
  CHECK (probability_pct IS NULL OR (probability_pct >= 0 AND probability_pct <= 100));

ALTER TABLE crm_opportunities DROP CONSTRAINT IF EXISTS chk_crm_opportunite_montants;
ALTER TABLE crm_opportunities ADD CONSTRAINT chk_crm_opportunite_montants
  CHECK (estimated_volume >= 0 AND reference_price >= 0
     AND (probability_override_pct IS NULL
          OR (probability_override_pct >= 0 AND probability_override_pct <= 100)));

-- ---------------------------------------------------------------------------
--  2. Une étape GAGNÉE est à 100 %, une étape PERDUE à 0 %.
--
--  Ce ne sont pas des estimations : ce sont des faits constatés. Laisser saisir
--  « gagnée à 80 % » ferait entrer dans la valeur pondérée un cinquième
--  d'affaire déjà signée qui n'existe pas — et manquer un cinquième de celles
--  qui existent.
-- ---------------------------------------------------------------------------
ALTER TABLE crm_pipeline_stages DROP CONSTRAINT IF EXISTS chk_crm_stage_issue_coherente;
ALTER TABLE crm_pipeline_stages ADD CONSTRAINT chk_crm_stage_issue_coherente
  CHECK (
    (outcome::text = 'WON'  AND probability_pct = 100) OR
    (outcome::text = 'LOST' AND probability_pct = 0)   OR
    (outcome::text NOT IN ('WON', 'LOST'))
  );

-- ---------------------------------------------------------------------------
--  3. Une opportunité SORTIE du pipeline porte sa date de sortie, et une
--     opportunité perdue porte son motif.
--
--  Le motif de perte est ce qu'on relit en fin de trimestre. Facultatif, il
--  n'est jamais renseigné — et l'entreprise refait les mêmes offres.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_crm_sortie_pipeline()
RETURNS TRIGGER AS $$
DECLARE
  issue text;
BEGIN
  SELECT s.outcome::text INTO issue
    FROM crm_pipeline_stages s WHERE s.id = NEW.stage_id;

  IF issue IN ('WON', 'LOST') AND NEW.closed_at IS NULL THEN
    NEW.closed_at := now();
  END IF;

  IF issue = 'LOST' AND (NEW.loss_reason IS NULL OR btrim(NEW.loss_reason) = '') THEN
    RAISE EXCEPTION
      'L''opportunité % est déclarée perdue sans motif. Le motif de perte est ce qu''on relit en fin de trimestre : sans lui, on refait les mêmes offres.',
      NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  IF issue NOT IN ('WON', 'LOST') THEN
    NEW.closed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_crm_sortie_pipeline ON crm_opportunities;
CREATE TRIGGER trg_crm_sortie_pipeline
  BEFORE INSERT OR UPDATE ON crm_opportunities
  FOR EACH ROW EXECUTE FUNCTION enforce_crm_sortie_pipeline();

-- ---------------------------------------------------------------------------
--  4. L'HISTORIQUE DES PASSAGES S'ÉCRIT SEUL.
--
--  Confié à l'application, il serait écrit par l'écran qui pense à le faire, et
--  omis par l'import, par la reprise et par le correctif d'urgence. L'analyse
--  de conversion porterait alors sur un échantillon dont personne ne connaît
--  les trous.
--
--  La probabilité EN VIGUEUR est recopiée : la relire plus tard donnerait la
--  probabilité d'aujourd'hui, jamais celle du moment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION journalise_crm_transition()
RETURNS TRIGGER AS $$
DECLARE
  proba numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.stage_id = NEW.stage_id THEN
    RETURN NEW;
  END IF;

  proba := COALESCE(
    NEW.probability_override_pct,
    (SELECT s.probability_pct FROM crm_pipeline_stages s WHERE s.id = NEW.stage_id)
  );

  -- La note du passage est posée par l'appelant dans une variable de
  -- TRANSACTION. L'historique étant en ajout seul, elle ne peut pas être
  -- ajoutée après coup : elle doit entrer avec la ligne ou pas du tout.
  -- Le troisième argument `true` évite l'erreur quand la variable est absente.
  INSERT INTO crm_stage_transitions
    (id, opportunity_id, from_stage_id, to_stage_id,
     probability_at_pct, weighted_value_at, note, occurred_at)
  VALUES
    (gen_random_uuid(), NEW.id,
     CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_id END,
     NEW.stage_id,
     proba,
     -- NULL quand la probabilité n'est pas décidée : une valeur pondérée de
     -- zéro se confondrait avec une affaire jugée sans espoir.
     CASE WHEN proba IS NOT NULL
          THEN round(NEW.estimated_volume * NEW.reference_price * proba / 100, 4) END,
     NULLIF(current_setting('erp.crm_note', true), ''),
     now());

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_crm_transition ON crm_opportunities;
CREATE TRIGGER trg_crm_transition
  AFTER INSERT OR UPDATE OF stage_id ON crm_opportunities
  FOR EACH ROW EXECUTE FUNCTION journalise_crm_transition();

-- ⚠️ L'HISTORIQUE NE SE RÉÉCRIT PAS. IL PEUT EN REVANCHE DISPARAÎTRE AVEC SON
--    SUJET, ET C'EST UNE DIFFÉRENCE DE FOND.
--
--    Le garde portait d'abord sur UPDATE ET DELETE, par symétrie avec le
--    journal terrain. C'était une erreur de raisonnement : ce journal-là
--    consigne des FAITS constatés sur le terrain, qui existent indépendamment
--    de l'enregistrement. Un historique de pipeline, lui, ne décrit que la vie
--    d'une opportunité — supprimée l'opportunité, il n'a plus de sujet.
--
--    Concrètement, l'ancien garde rendait toute opportunité créée par erreur
--    INDESTRUCTIBLE, y compris celles d'une campagne de recette — qui
--    seraient alors entrées dans la valeur pondérée, donc dans la prévision,
--    donc dans l'assiette d'absorption. Protéger l'historique au prix de
--    fausser la prévision, c'est protéger la mauvaise chose.
--
--    Ce qu'on interdit reste ce qui compte : RÉÉCRIRE un passage. La mesure de
--    conversion ne peut pas être maquillée après coup.
DROP TRIGGER IF EXISTS trg_crm_transitions_no_update ON crm_stage_transitions;
CREATE TRIGGER trg_crm_transitions_no_update
  BEFORE UPDATE ON crm_stage_transitions
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();


-- ---------------------------------------------------------------------------
--  5. AMORÇAGE DES ÉTAPES, depuis la liste du § 15.
--
--  ⚠️ LES LIBELLÉS VIENNENT DE LA SPÉCIFICATION ; LES PROBABILITÉS, NON.
--
--     Le § 15 énumère les étapes : « Nouveau → À contacter → Contact établi →
--     Besoin identifié → Qualifié → Opportunité ouverte → Offre en préparation
--     → Offre envoyée → Négociation → Décision attendue → Gagnée / Perdue /
--     Mise en veille ». Les inscrire n'invente rien.
--
--     Leurs PROBABILITÉS, en revanche, sont des valeurs d'entreprise. Écrire
--     10 %, 25 %, 50 % produirait un pipeline pondéré convaincant que personne
--     n'aurait décidé — et sur lequel on engagerait des achats SIR et GESTOCI
--     (§ 14.3, usage de rang 1). Elles restent donc NULLES, et la valeur
--     pondérée se tait jusqu'à ce que le DG les tranche.
--
--     Deux exceptions, qui ne sont pas des estimations mais des faits :
--     GAGNÉE vaut 100, PERDUE vaut 0. La contrainte plus haut l'exige.
--
--  Idempotent : les étapes déjà présentes ne sont pas retouchées, sinon chaque
--  migration écraserait les probabilités que le DG vient de saisir.
-- ---------------------------------------------------------------------------
INSERT INTO crm_pipeline_stages (id, code, label, rank, outcome, probability_pct, updated_at)
SELECT gen_random_uuid(), v.code, v.label, v.rang, v.issue::crm_stage_outcome, v.proba, now()
  FROM (VALUES
    ('NOUVEAU',              'Nouveau',              1,  'OPEN',    NULL::numeric),
    ('A_CONTACTER',          'À contacter',          2,  'OPEN',    NULL),
    ('CONTACT_ETABLI',       'Contact établi',       3,  'OPEN',    NULL),
    ('BESOIN_IDENTIFIE',     'Besoin identifié',     4,  'OPEN',    NULL),
    ('QUALIFIE',             'Qualifié',             5,  'OPEN',    NULL),
    ('OPPORTUNITE_OUVERTE',  'Opportunité ouverte',  6,  'OPEN',    NULL),
    ('OFFRE_EN_PREPARATION', 'Offre en préparation', 7,  'OPEN',    NULL),
    ('OFFRE_ENVOYEE',        'Offre envoyée',        8,  'OPEN',    NULL),
    ('NEGOCIATION',          'Négociation',          9,  'OPEN',    NULL),
    ('DECISION_ATTENDUE',    'Décision attendue',    10, 'OPEN',    NULL),
    ('GAGNEE',               'Gagnée',               11, 'WON',     100),
    ('PERDUE',               'Perdue',               12, 'LOST',    0),
    ('EN_VEILLE',            'Mise en veille',       13, 'DORMANT', NULL)
  ) AS v(code, label, rang, issue, proba)
 WHERE NOT EXISTS (SELECT 1 FROM crm_pipeline_stages s WHERE s.code = v.code);


-- ===========================================================================
--  LECTURES
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Le pipeline, opportunité par opportunité.
--
--  ⚠️ LA VALEUR PONDÉRÉE EST NULLE TANT QUE LA PROBABILITÉ N'EST PAS DÉCIDÉE.
--
--     « Valeur pondérée = CA prévisionnel × Probabilité » (§ 15). Sans
--     probabilité, le produit vaudrait zéro — indiscernable d'une affaire jugée
--     sans espoir. Or c'est sur ce chiffre qu'on engage des achats SIR et
--     GESTOCI (§ 14.3, usage de rang 1). Mieux vaut une colonne vide qu'un
--     zéro qui ment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_crm_pipeline AS
SELECT o.id,
       o.reference,
       o.title,
       p.code                                        AS client_code,
       p.legal_name                                  AS client,
       p.type::text                                  AS client_type,
       o.segment::text                               AS segment,
       pr.code                                       AS produit,
       s.code                                        AS etape_code,
       s.label                                       AS etape,
       s.rank                                        AS etape_rang,
       s.outcome::text                               AS issue,
       u.full_name                                   AS responsable,
       o.estimated_volume,
       o.uom::text                                   AS uom,
       o.reference_price,
       o.currency_code,
       round(o.estimated_volume * o.reference_price, 2) AS ca_previsionnel,
       COALESCE(o.probability_override_pct, s.probability_pct) AS probabilite,
       (o.probability_override_pct IS NOT NULL)      AS probabilite_forcee,
       CASE WHEN COALESCE(o.probability_override_pct, s.probability_pct) IS NOT NULL
            THEN round(o.estimated_volume * o.reference_price
                       * COALESCE(o.probability_override_pct, s.probability_pct) / 100, 2)
       END                                           AS valeur_ponderee,
       o.expected_close_date,
       o.next_action,
       o.next_action_due,
       (o.next_action_due < CURRENT_DATE)            AS action_en_retard,
       o.closed_at,
       o.loss_reason,
       -- Dernière interaction : c'est l'absence d'activité qui tue un pipeline,
       -- pas la mauvaise nouvelle.
       (SELECT max(i.occurred_at) FROM crm_interactions i
         WHERE i.opportunity_id = o.id)              AS derniere_interaction,
       s.stalled_after_days
  FROM crm_opportunities o
  JOIN partners p ON p.id = o.partner_id
  JOIN crm_pipeline_stages s ON s.id = o.stage_id
  JOIN users u ON u.id = o.owner_id
  LEFT JOIN products pr ON pr.id = o.product_id;

COMMENT ON VIEW v_crm_pipeline IS
  'Pipeline commercial, opportunité par opportunité (§ 15). `valeur_ponderee` nulle = probabilité non décidée pour l''étape, PAS une affaire sans espoir.';


-- ---------------------------------------------------------------------------
--  Le pipeline agrégé par étape — la forme sous laquelle on le regarde.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_crm_pipeline_par_etape AS
SELECT s.code                                        AS etape_code,
       s.label                                       AS etape,
       s.rank                                        AS rang,
       s.outcome::text                               AS issue,
       s.probability_pct                             AS probabilite,
       count(o.id)                                   AS opportunites,
       COALESCE(sum(o.estimated_volume * o.reference_price), 0) AS ca_previsionnel,
       -- Somme des seules opportunités pondérables. Le décompte à côté dit
       -- combien manquent : sans lui, un total partiel se lirait comme un total.
       sum(CASE WHEN COALESCE(o.probability_override_pct, s.probability_pct) IS NOT NULL
                THEN round(o.estimated_volume * o.reference_price
                           * COALESCE(o.probability_override_pct, s.probability_pct) / 100, 2)
           END)                                      AS valeur_ponderee,
       count(o.id) FILTER (
         WHERE COALESCE(o.probability_override_pct, s.probability_pct) IS NULL
       )                                             AS sans_probabilite,
       count(o.id) FILTER (WHERE o.next_action_due < CURRENT_DATE) AS actions_en_retard
  FROM crm_pipeline_stages s
  LEFT JOIN crm_opportunities o ON o.stage_id = s.id
 WHERE s.is_active
 GROUP BY s.code, s.label, s.rank, s.outcome, s.probability_pct;

COMMENT ON VIEW v_crm_pipeline_par_etape IS
  'Pipeline agrégé par étape (§ 15). `sans_probabilite` dit combien d''opportunités n''entrent pas dans la valeur pondérée — sans quoi un total partiel se lirait comme un total.';


-- ---------------------------------------------------------------------------
--  Les alertes du § 15 : relances du jour, actions en retard, prospects non
--  contactés, opportunités sans activité.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_crm_alertes AS

-- 1. Relance d'interaction due ou dépassée.
SELECT 'RELANCE'::text                               AS nature,
       o.id                                          AS opportunity_id,
       o.reference,
       o.title                                       AS objet,
       u.full_name                                   AS responsable,
       i.next_action                                 AS action,
       i.next_action_due                             AS echeance,
       (CURRENT_DATE - i.next_action_due)            AS retard_jours
  FROM crm_interactions i
  JOIN crm_opportunities o ON o.id = i.opportunity_id
  JOIN crm_pipeline_stages s ON s.id = o.stage_id
  JOIN users u ON u.id = o.owner_id
 WHERE NOT i.next_action_done
   AND i.next_action_due <= CURRENT_DATE
   AND s.outcome::text = 'OPEN'

UNION ALL
-- 2. Prochaine action de l'opportunité elle-même, échue.
SELECT 'ACTION_ETAPE',
       o.id, o.reference, o.title, u.full_name,
       o.next_action, o.next_action_due,
       (CURRENT_DATE - o.next_action_due)
  FROM crm_opportunities o
  JOIN crm_pipeline_stages s ON s.id = o.stage_id
  JOIN users u ON u.id = o.owner_id
 WHERE o.next_action_due <= CURRENT_DATE
   AND s.outcome::text = 'OPEN'

UNION ALL
-- 3. Opportunité JAMAIS contactée. Distincte de « sans activité récente » :
--    c'est un dossier ouvert et abandonné aussitôt, pas un dossier qui
--    s'essouffle.
SELECT 'JAMAIS_CONTACTE',
       o.id, o.reference, o.title, u.full_name,
       'Aucune interaction depuis l''ouverture', o.created_at::date,
       (CURRENT_DATE - o.created_at::date)
  FROM crm_opportunities o
  JOIN crm_pipeline_stages s ON s.id = o.stage_id
  JOIN users u ON u.id = o.owner_id
 WHERE s.outcome::text = 'OPEN'
   AND NOT EXISTS (SELECT 1 FROM crm_interactions i WHERE i.opportunity_id = o.id)

UNION ALL
-- 4. Opportunité sans activité depuis le délai PARAMÉTRÉ sur son étape.
--    Le délai vit sur l'étape : une offre envoyée s'essouffle en deux semaines,
--    une qualification peut dormir deux mois sans que ce soit un signal.
SELECT 'SANS_ACTIVITE',
       o.id, o.reference, o.title, u.full_name,
       'Sans interaction depuis ' || s.stalled_after_days || ' jours',
       (max(i.occurred_at)::date + s.stalled_after_days),
       (CURRENT_DATE - (max(i.occurred_at)::date + s.stalled_after_days))
  FROM crm_opportunities o
  JOIN crm_pipeline_stages s ON s.id = o.stage_id
  JOIN users u ON u.id = o.owner_id
  JOIN crm_interactions i ON i.opportunity_id = o.id
 WHERE s.outcome::text = 'OPEN'
   AND s.stalled_after_days IS NOT NULL
 GROUP BY o.id, o.reference, o.title, u.full_name, s.stalled_after_days
HAVING max(i.occurred_at)::date + s.stalled_after_days < CURRENT_DATE;

COMMENT ON VIEW v_crm_alertes IS
  'Alertes commerciales (§ 15) : relances dues, actions en retard, opportunités jamais contactées, opportunités sans activité au-delà du délai paramétré sur leur étape.';


-- ---------------------------------------------------------------------------
--  Conversion étape par étape — ce que le pipeline apprend vraiment.
--
--  Comparer la probabilité AFFICHÉE d'une étape à son taux de conversion
--  OBSERVÉ est le seul moyen de savoir si les probabilités sont honnêtes. Un
--  pipeline dont l'étape « Négociation » annonce 70 % et convertit à 30 % ne
--  se corrige pas tout seul.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_crm_conversion AS
WITH passages AS (
  SELECT t.opportunity_id,
         t.to_stage_id,
         min(t.occurred_at) AS premiere_fois
    FROM crm_stage_transitions t
   GROUP BY t.opportunity_id, t.to_stage_id
),
issues AS (
  SELECT o.id AS opportunity_id, s.outcome::text AS issue
    FROM crm_opportunities o
    JOIN crm_pipeline_stages s ON s.id = o.stage_id
)
SELECT s.code                                        AS etape_code,
       s.label                                       AS etape,
       s.rank                                        AS rang,
       s.probability_pct                             AS probabilite_affichee,
       count(*)                                      AS passees_par_ici,
       count(*) FILTER (WHERE i.issue = 'WON')       AS gagnees,
       count(*) FILTER (WHERE i.issue = 'LOST')      AS perdues,
       count(*) FILTER (WHERE i.issue = 'OPEN')      AS encore_ouvertes,
       -- Sur les seules affaires TRANCHÉES : inclure les ouvertes ferait
       -- baisser le taux à mesure qu'on prospecte, ce qui n'a aucun sens.
       CASE WHEN count(*) FILTER (WHERE i.issue IN ('WON', 'LOST')) > 0
            THEN round(100.0 * count(*) FILTER (WHERE i.issue = 'WON')
                       / count(*) FILTER (WHERE i.issue IN ('WON', 'LOST')), 2)
       END                                           AS conversion_observee_pct
  FROM passages pa
  JOIN crm_pipeline_stages s ON s.id = pa.to_stage_id
  JOIN issues i ON i.opportunity_id = pa.opportunity_id
 GROUP BY s.code, s.label, s.rank, s.probability_pct;

COMMENT ON VIEW v_crm_conversion IS
  'Taux de conversion OBSERVÉ par étape, face à la probabilité AFFICHÉE (§ 15). Calculé sur les seules affaires tranchées : inclure les ouvertes ferait baisser le taux à mesure qu''on prospecte.';


-- ─── 28_tableau_operationnel.sql ─────────────────────────────────

-- ===========================================================================
--  TABLEAU DE BORD OPÉRATIONNEL
--  Réf. SPECIFICATIONS.md § 16
--
--  « Le tableau de bord opérationnel affiche : opérations à venir, en cours, en
--    retard, bloquées, non conformes HSE, livrées non facturées, facturées non
--    encaissées. »
--
--  Sept états, et deux d'entre eux ne sont pas des statuts d'opération mais des
--  TROUS ENTRE DEUX MODULES — livré sans facture, facturé sans encaissement.
--  Ce sont ceux-là qui coûtent, parce qu'aucun écran ne les portait : une
--  opération close disparaît de la liste des opérations, et une facture émise
--  ne dit pas qu'elle attend.
--
--  ⚠️ CHAQUE OPÉRATION N'APPARAÎT QUE DANS UN SEUL ÉTAT.
--
--     Un tableau où les compteurs se recouvrent ne s'additionne pas, et celui
--     qui le lit finit par ne plus savoir combien d'opérations il a. L'ordre de
--     priorité est explicite ci-dessous, du plus grave au plus banal.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

CREATE OR REPLACE VIEW v_tableau_operationnel AS
WITH facture AS (
  -- Facturation réelle d'une affaire : proforma et avoir exclus. Une proforma
  -- n'est pas une facture, et compter un avoir comme facturation ferait
  -- disparaître une opération non facturée le jour où on annule autre chose.
  SELECT i.deal_id,
         sum(i.total_amount_pivot)                     AS facture_pivot,
         sum(COALESCE(i.paid_amount_pivot, 0))         AS encaisse_pivot,
         min(i.due_date) FILTER (
           WHERE i.status::text NOT IN ('PAID', 'CANCELLED')
         )                                             AS plus_proche_echeance,
         count(*) FILTER (
           WHERE i.status::text NOT IN ('PAID', 'CANCELLED')
         )                                             AS factures_ouvertes
    FROM invoices i
   WHERE i.type::text IN ('SIMPLE', 'FNE')
     AND i.status::text <> 'CANCELLED'
   GROUP BY i.deal_id
)
SELECT o.id                                            AS operation_id,
       o.reference,
       o.status::text                                  AS statut,
       d.reference                                     AS affaire,
       p.legal_name                                    AS client,
       pr.code                                         AS produit,
       o.planned_volume,
       o.uom::text                                     AS uom,
       o.planned_loading_date,
       o.actual_discharge_date,

       -- ⚠️ ORDRE DE PRIORITÉ : le premier cas vrai gagne, et un seul gagne.
       CASE
         -- 1. Incident : le plus grave, il prime sur tout le reste.
         WHEN o.status::text = 'INCIDENT'                      THEN 'INCIDENT'
         -- 2. Bloquée par le verrou HSE.
         WHEN o.status::text = 'HSE_BLOCKED'                   THEN 'BLOQUEE_HSE'
         -- 3. Engagée alors qu'un moyen affecté n'est PLUS conforme. Le verrou
         --    joue à l'affectation ; une pièce peut expirer ensuite.
         WHEN o.status::text NOT IN ('CLOSED', 'CANCELLED', 'DRAFT')
              AND EXISTS (
                SELECT 1 FROM operation_assignments a
                  JOIN v_transport_compliance c
                    ON c.subject_id IN (a.carrier_id, a.vehicle_id, a.driver_id)
                 WHERE a.operation_id = o.id
                   AND NOT c.is_compliant
                   AND a.compliance_derogation_id IS NULL
              )                                                THEN 'NON_CONFORME'
         -- 4. En retard : le chargement était prévu et n'a pas eu lieu.
         WHEN o.status::text IN ('SOURCING', 'HSE_PREPARATION', 'PLANNED')
              AND o.planned_loading_date IS NOT NULL
              AND o.planned_loading_date < CURRENT_DATE       THEN 'EN_RETARD'
         -- 5. Livrée mais pas facturée — un trou entre deux modules.
         WHEN o.status::text IN ('FINAL_CHECK', 'CLOSED')
              AND COALESCE(f.facture_pivot, 0) = 0             THEN 'LIVREE_NON_FACTUREE'
         -- 6. Facturée mais pas encaissée.
         WHEN o.status::text = 'CLOSED'
              AND COALESCE(f.facture_pivot, 0) > 0
              AND COALESCE(f.encaisse_pivot, 0) < f.facture_pivot
                                                               THEN 'FACTUREE_NON_ENCAISSEE'
         -- 7. En cours d'exécution.
         WHEN o.status::text IN ('LOADING', 'IN_TRANSIT', 'DELIVERING', 'FINAL_CHECK')
                                                               THEN 'EN_COURS'
         -- 8. À venir.
         WHEN o.status::text IN ('DRAFT', 'SOURCING', 'HSE_PREPARATION', 'PLANNED')
                                                               THEN 'A_VENIR'
         WHEN o.status::text = 'CANCELLED'                     THEN 'ANNULEE'
         ELSE 'SOLDEE'
       END                                             AS etat,

       COALESCE(f.facture_pivot, 0)                    AS facture_pivot,
       COALESCE(f.encaisse_pivot, 0)                   AS encaisse_pivot,
       COALESCE(f.facture_pivot, 0) - COALESCE(f.encaisse_pivot, 0) AS reste_a_encaisser,
       f.plus_proche_echeance,
       -- Retard d'encaissement : positif quand l'échéance est dépassée.
       CASE WHEN f.plus_proche_echeance IS NOT NULL
                 AND f.plus_proche_echeance < CURRENT_DATE
            THEN CURRENT_DATE - f.plus_proche_echeance END      AS retard_encaissement_jours,
       -- Retard de chargement, pour la même raison.
       CASE WHEN o.planned_loading_date IS NOT NULL
                 AND o.planned_loading_date < CURRENT_DATE
                 AND o.status::text IN ('SOURCING', 'HSE_PREPARATION', 'PLANNED')
            THEN CURRENT_DATE - o.planned_loading_date END      AS retard_chargement_jours
  FROM operations o
  JOIN deals d ON d.id = o.deal_id
  JOIN partners p ON p.id = d.client_id
  JOIN products pr ON pr.id = d.product_id
  LEFT JOIN facture f ON f.deal_id = o.deal_id;

COMMENT ON VIEW v_tableau_operationnel IS
  'Opérations classées en un SEUL état chacune (§ 16), du plus grave au plus banal. « Livrée non facturée » et « facturée non encaissée » sont des trous entre modules, pas des statuts d''opération.';


-- ---------------------------------------------------------------------------
--  Le décompte, pour les pavés du tableau de bord.
--
--  Une vue séparée : l'écran l'appelle à chaque ouverture, et rapatrier toutes
--  les lignes pour les compter coûterait cher pour sept chiffres.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_tableau_operationnel_compte AS
SELECT etat,
       count(*)                                        AS operations,
       sum(planned_volume)                             AS volume,
       sum(reste_a_encaisser)                          AS reste_a_encaisser,
       max(COALESCE(retard_encaissement_jours, retard_chargement_jours)) AS retard_max_jours
  FROM v_tableau_operationnel
 WHERE etat NOT IN ('ANNULEE', 'SOLDEE')
 GROUP BY etat;

COMMENT ON VIEW v_tableau_operationnel_compte IS
  'Décompte par état pour les pavés du tableau de bord (§ 16). Les états se comptent sans se recouvrir : le total est donc lisible.';


-- ─── 32_performance_commerciale.sql ──────────────────────────────

-- ===========================================================================
--  PERFORMANCE PAR COMMERCIAL
--  Réf. SPECIFICATIONS.md § 16 — « Commercial & CRM : prospects, pipeline,
--  conversion, CA prévisionnel, offres, PERFORMANCE, marges »
--
--  CE QUI MANQUAIT
--  ---------------
--  Une seule lecture par commercial existait : `v_margin_band_by_owner`, qui
--  dit combien d'affaires d'un vendeur effleurent le seuil de marge. C'est un
--  signal de dérive, pas une mesure d'activité — et le § 16 demande la
--  performance, que rien ne portait.
--
--  Le dirigeant : « le CCOO doit voir la concentration par commercial ainsi que
--  les statistiques par commercial au même titre que le DG ».
--
--  ⚠️ CETTE VUE COMPARE DES PERSONNES. ELLE N'EST PAS OUVERTE AUX COMMERCIAUX.
--
--     Un commercial ne voit que ses propres affaires (règle posée le 8 août).
--     Lui ouvrir un tableau comparatif de ses collègues contredirait cette
--     règle par la porte de derrière : le classement dit ce que le détail
--     cache. La lecture est réservée à ceux qui encadrent — DG, CCOO — et au
--     CFO, qui répond des marges.
--
--  ⚠️ TROIS FAMILLES DE CHIFFRES, ET ON NE LES MÉLANGE PAS.
--
--     · PIPELINE   ce qui est espéré. Dépend de probabilités déclarées.
--     · RÉALISÉ    ce qui est signé. Ne dépend d'aucune hypothèse.
--     · QUALITÉ    à quel prix c'est signé — marge, et proximité du seuil.
--
--     Un commercial qui remplit son pipeline sans rien signer, et un autre qui
--     signe tout au ras du seuil, ont tous deux un problème. Un chiffre unique
--     les confondrait.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

CREATE OR REPLACE VIEW v_performance_commerciale AS
WITH
-- --- Ce qui est espéré : le pipeline ouvert -------------------------------
pipeline AS (
  SELECT o.owner_id,
         count(*)                                            AS opportunites_ouvertes,
         sum(o.estimated_volume * o.reference_price)         AS ca_previsionnel,
         -- Somme des seules opportunités pondérables. Le décompte à côté dit
         -- combien manquent : sans lui, un total partiel se lirait comme un
         -- total.
         sum(CASE WHEN COALESCE(o.probability_override_pct, s.probability_pct) IS NOT NULL
                  THEN o.estimated_volume * o.reference_price
                       * COALESCE(o.probability_override_pct, s.probability_pct) / 100
             END)                                            AS valeur_ponderee,
         count(*) FILTER (
           WHERE COALESCE(o.probability_override_pct, s.probability_pct) IS NULL
         )                                                   AS sans_probabilite,
         count(*) FILTER (WHERE o.next_action_due < CURRENT_DATE) AS actions_en_retard
    FROM crm_opportunities o
    JOIN crm_pipeline_stages s ON s.id = o.stage_id
   WHERE s.outcome::text = 'OPEN'
   GROUP BY o.owner_id
),
-- --- Ce qui est tranché : gagné ou perdu ----------------------------------
issues AS (
  SELECT o.owner_id,
         count(*) FILTER (WHERE s.outcome::text = 'WON')  AS gagnees,
         count(*) FILTER (WHERE s.outcome::text = 'LOST') AS perdues,
         sum(o.estimated_volume * o.reference_price)
           FILTER (WHERE s.outcome::text = 'WON')         AS ca_gagne
    FROM crm_opportunities o
    JOIN crm_pipeline_stages s ON s.id = o.stage_id
   WHERE s.outcome::text IN ('WON', 'LOST')
   GROUP BY o.owner_id
),
-- --- Ce qui est signé : les affaires --------------------------------------
affaires AS (
  SELECT d.owner_id,
         count(*)                                            AS affaires,
         sum(d.contracted_volume)                            AS volume,
         sum(d.contracted_volume * d.unit_sale_price)        AS chiffre_affaires,
         -- Marge moyenne PONDÉRÉE par le volume : une petite affaire à forte
         -- marge ne doit pas peser autant qu'une grosse à marge faible.
         round(sum(d.estimated_full_margin * d.contracted_volume)
               / NULLIF(sum(d.contracted_volume), 0), 4)     AS marge_unitaire_moyenne,
         count(*) FILTER (WHERE d.credit_approved_by_id IS NOT NULL) AS approuvees,
         count(*) FILTER (WHERE d.margin_derogation_id IS NOT NULL)  AS sur_derogation
    FROM deals d
   WHERE d.status::text NOT IN ('DRAFT', 'CANCELLED', 'REJECTED_BY_CLIENT')
   GROUP BY d.owner_id
)
SELECT u.id                                                  AS owner_id,
       u.full_name                                           AS commercial,
       u.role::text                                          AS role,

       -- Pipeline
       COALESCE(p.opportunites_ouvertes, 0)                  AS opportunites_ouvertes,
       round(COALESCE(p.ca_previsionnel, 0), 2)              AS ca_previsionnel,
       round(p.valeur_ponderee, 2)                           AS valeur_ponderee,
       COALESCE(p.sans_probabilite, 0)                       AS sans_probabilite,
       COALESCE(p.actions_en_retard, 0)                      AS actions_en_retard,

       -- Conversion, sur les seules affaires TRANCHÉES. Inclure les ouvertes
       -- ferait baisser le taux à mesure qu'on prospecte, ce qui punirait
       -- l'activité.
       COALESCE(i.gagnees, 0)                                AS gagnees,
       COALESCE(i.perdues, 0)                                AS perdues,
       CASE WHEN COALESCE(i.gagnees, 0) + COALESCE(i.perdues, 0) > 0
            THEN round(100.0 * i.gagnees / (i.gagnees + i.perdues), 2)
       END                                                   AS conversion_pct,

       -- Réalisé
       COALESCE(a.affaires, 0)                               AS affaires,
       COALESCE(a.volume, 0)                                 AS volume,
       round(COALESCE(a.chiffre_affaires, 0), 2)             AS chiffre_affaires,
       COALESCE(a.approuvees, 0)                             AS affaires_approuvees,

       -- Qualité de ce qui est signé
       a.marge_unitaire_moyenne,
       COALESCE(a.sur_derogation, 0)                         AS affaires_sur_derogation,
       COALESCE(b.deals_in_band, 0)                          AS affaires_dans_la_bande,
       b.band_share_pct                                      AS part_dans_la_bande_pct,
       b.avg_above_threshold_pct                             AS ecart_moyen_au_seuil_pct

  FROM users u
  LEFT JOIN pipeline p ON p.owner_id = u.id
  LEFT JOIN issues   i ON i.owner_id = u.id
  LEFT JOIN affaires a ON a.owner_id = u.id
  LEFT JOIN v_margin_band_by_owner b ON b.owner_id = u.id
 -- Les rôles qui PORTENT des affaires. Un comptable n'a pas de performance
 -- commerciale, et l'afficher à zéro donnerait une ligne vide à interpréter.
 WHERE u.role::text IN ('SALES_REP', 'CCOO', 'DG')
   AND u.is_active
   AND (p.owner_id IS NOT NULL OR i.owner_id IS NOT NULL OR a.owner_id IS NOT NULL);

COMMENT ON VIEW v_performance_commerciale IS
  'Performance par commercial (§ 16) : pipeline espéré, conversion observée, réalisé signé, et qualité de ce qui est signé. Trois familles de chiffres qu''un indicateur unique confondrait. Réservée à l''encadrement — un commercial ne voit que ses propres affaires.';


-- ─── 33_performance_par_periode.sql ──────────────────────────────

-- ===========================================================================
--  LA PERFORMANCE COMMERCIALE SE LIT SUR UNE PÉRIODE
--  Réf. SPECIFICATIONS.md § 16
--
--  LE DÉFAUT CORRIGÉ
--  -----------------
--  `v_performance_commerciale` agrégeait TOUT, depuis toujours. Un commercial
--  arrivé il y a trois ans écrasait mécaniquement celui arrivé en janvier, et
--  un mauvais trimestre disparaissait dans la moyenne d'une carrière. Une
--  performance sans période ne se compare ni entre personnes, ni dans le temps
--  — c'est-à-dire qu'elle ne sert à rien.
--
--  ⚠️ CHAQUE FAMILLE DE CHIFFRES A SA PROPRE DATE, ET ON NE LES CONFOND PAS.
--
--     · Opportunités OUVERTES — datées de leur OUVERTURE. « Ce qui a été ouvert
--       pendant la période et n'est pas encore tranché. »
--     · Gagnées / perdues — datées de leur CLÔTURE. C'est le moment où le
--       résultat est acquis, pas celui où l'affaire a commencé.
--     · Affaires signées — datées de leur CRÉATION.
--
--     Prendre une seule date pour tout donnerait un tableau faux : une
--     opportunité ouverte en janvier et gagnée en juin appartient au pipeline
--     de janvier ET à la conversion de juin. Les deux sont vrais.
--
--  ⚠️ LE PIPELINE OUVERT EST UN STOCK, PAS UN FLUX.
--
--     Le lire « sur une période » a un sens précis et un seul : ce qui a été
--     OUVERT pendant cette période et reste ouvert aujourd'hui. Une opportunité
--     ouverte l'an dernier et toujours en discussion n'y figure donc pas — elle
--     est dans le pipeline courant, pas dans l'activité de la période. L'écran
--     doit le dire, sinon on cherchera longtemps pourquoi les totaux ne
--     concordent pas avec le pipeline global.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  LA PÉRIODE PAR DÉFAUT
--
--  ⚠️ ELLE SE DÉDUIT, ELLE N'EST PAS ÉCRITE EN DUR.
--
--     L'exercice comptable courant d'abord : c'est le découpage sur lequel
--     l'entreprise raisonne déjà, celui du point mort, du budget et de la
--     prévision. Aligner la performance dessus évite d'avoir à retenir deux
--     calendriers.
--
--     À défaut — tant qu'aucun exercice n'est déclaré — les douze derniers
--     mois glissants. Ce repli est un choix d'AFFICHAGE, pas une règle métier :
--     il ne décide de rien, il propose une fenêtre. Et la période retenue est
--     toujours RENDUE à l'appelant, pour que l'écran l'affiche au lieu de la
--     laisser deviner.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
--  LES CINQ DÉCOUPAGES DEMANDÉS
--
--  Mois · trimestre · semestre · année civile · exercice comptable.
--
--  ⚠️ LE TRIMESTRE ET LE SEMESTRE SONT CIVILS, PAS GLISSANTS.
--
--     « Le trimestre » désigne janvier-mars, avril-juin, et ainsi de suite —
--     pas les trois derniers mois. Un découpage glissant ne se compare pas
--     d'une lecture à l'autre : deux consultations à trois jours d'écart
--     donneraient deux périodes différentes, et l'écart entre les chiffres
--     serait indéchiffrable.
--
--     L'EXERCICE, lui, suit vos bornes déclarées — qui ne sont ni l'année
--     civile ni une constante.
--
--  `p_ancre` désigne le jour DANS la période voulue, pas ses bornes : on
--  demande « le trimestre du 15 mai », le système répond « du 1er avril au
--  30 juin ». C'est ce qui permet de reculer d'un cran sans calculer de tête.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION periode_bornes(
  p_type  text DEFAULT NULL,
  p_ancre date DEFAULT NULL
)
RETURNS TABLE (debut date, fin date, libelle text, en_cours boolean) AS $$
DECLARE
  a date := COALESCE(p_ancre, CURRENT_DATE);
  t text := upper(COALESCE(p_type, ''));
  d date; f date; l text;
BEGIN
  -- Sans type demandé : l'exercice comptable s'il existe, l'année civile sinon.
  -- L'exercice d'abord parce que c'est le découpage sur lequel l'entreprise
  -- raisonne déjà — point mort, budget, prévision. Deux calendriers
  -- concurrents obligeraient à retenir lequel s'applique où.
  IF t = '' THEN
    t := CASE WHEN EXISTS (SELECT 1 FROM fiscal_years WHERE is_current)
              THEN 'EXERCICE' ELSE 'ANNEE_CIVILE' END;
  END IF;

  CASE t
    WHEN 'MOIS' THEN
      d := date_trunc('month', a)::date;
      f := (date_trunc('month', a) + interval '1 month - 1 day')::date;
      -- ⚠️ LE NOM DU MOIS NE VIENT PAS DE LA LOCALE DU SERVEUR.
      --
      --    `to_char(a, 'TMMonth')` rendait « May 2026 » : la base tourne en
      --    en_US, et le libellé aurait changé au premier déploiement configuré
      --    autrement. Un intitulé d'écran ne doit pas dépendre de la langue
      --    d'installation de PostgreSQL.
      l := (ARRAY['janvier','février','mars','avril','mai','juin',
                  'juillet','août','septembre','octobre','novembre','décembre']
           )[extract(month FROM a)::int] || ' ' || extract(year FROM a)::int;

    WHEN 'TRIMESTRE' THEN
      d := date_trunc('quarter', a)::date;
      f := (date_trunc('quarter', a) + interval '3 months - 1 day')::date;
      l := 'T' || extract(quarter FROM a)::int || ' ' || extract(year FROM a)::int;

    WHEN 'SEMESTRE' THEN
      d := (date_trunc('year', a)
            + make_interval(months => CASE WHEN extract(month FROM a) <= 6 THEN 0 ELSE 6 END))::date;
      f := (d + interval '6 months - 1 day')::date;
      l := 'S' || CASE WHEN extract(month FROM a) <= 6 THEN 1 ELSE 2 END
                || ' ' || extract(year FROM a)::int;

    WHEN 'ANNEE_CIVILE' THEN
      d := date_trunc('year', a)::date;
      f := (date_trunc('year', a) + interval '1 year - 1 day')::date;
      l := 'Année ' || extract(year FROM a)::int;

    WHEN 'EXERCICE' THEN
      -- L'exercice qui CONTIENT la date d'ancrage ; à défaut, celui déclaré
      -- courant. Sans aucun exercice, on retombe sur l'année civile plutôt que
      -- de ne rien rendre — un tableau vide ne dirait pas pourquoi.
      SELECT fy.starts_on, fy.ends_on, 'Exercice ' || fy.year::text
        INTO d, f, l
        FROM fiscal_years fy
       WHERE a BETWEEN fy.starts_on AND fy.ends_on
       LIMIT 1;
      IF d IS NULL THEN
        SELECT fy.starts_on, fy.ends_on, 'Exercice ' || fy.year::text
          INTO d, f, l
          FROM fiscal_years fy WHERE fy.is_current LIMIT 1;
      END IF;
      IF d IS NULL THEN
        d := date_trunc('year', a)::date;
        f := (date_trunc('year', a) + interval '1 year - 1 day')::date;
        l := 'Année ' || extract(year FROM a)::int || ' (aucun exercice déclaré)';
      END IF;

    ELSE
      RAISE EXCEPTION
        'Découpage « % » inconnu. Valeurs admises : MOIS, TRIMESTRE, SEMESTRE, ANNEE_CIVILE, EXERCICE.', p_type
        USING ERRCODE = 'invalid_parameter_value';
  END CASE;

  RETURN QUERY SELECT d, f, l, (f > CURRENT_DATE);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION periode_bornes(text, date) IS
  'Bornes d''un découpage nommé — MOIS, TRIMESTRE, SEMESTRE, ANNEE_CIVILE, EXERCICE — autour d''une date d''ancrage. Trimestres et semestres CIVILS, jamais glissants : un découpage glissant ne se compare pas d''une lecture à l''autre. `en_cours` signale une période non close.';


CREATE OR REPLACE FUNCTION periode_performance_defaut()
RETURNS TABLE (debut date, fin date, origine text) AS $$
  SELECT p.debut, p.fin, p.libelle FROM periode_bornes(NULL, NULL) p;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION periode_performance_defaut() IS
  'Fenêtre de lecture par défaut : l''exercice comptable courant, ou l''année civile tant qu''aucun exercice n''est déclaré.';


-- ---------------------------------------------------------------------------
--  LA PERFORMANCE, BORNÉE.
--
--  Une FONCTION et non une vue : une vue ne prend pas d'argument, et filtrer
--  après coup une vue déjà agrégée donnerait des totaux faux — on ne découpe
--  pas une somme après l'avoir faite.
--
--  `p_debut` et `p_fin` nuls valent « période par défaut ».
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION performance_commerciale(
  p_debut  date DEFAULT NULL,
  p_fin    date DEFAULT NULL,
  p_type   text DEFAULT NULL,
  p_ancre  date DEFAULT NULL
)
RETURNS TABLE (
  owner_id                  uuid,
  commercial                varchar,
  role                      text,
  periode_debut             date,
  periode_fin               date,
  periode_origine           text,
  opportunites_ouvertes     bigint,
  ca_previsionnel           numeric,
  valeur_ponderee           numeric,
  sans_probabilite          bigint,
  actions_en_retard         bigint,
  gagnees                   bigint,
  perdues                   bigint,
  conversion_pct            numeric,
  affaires                  bigint,
  volume                    numeric,
  chiffre_affaires          numeric,
  affaires_approuvees       bigint,
  marge_unitaire_moyenne    numeric,
  affaires_sur_derogation   bigint,
  affaires_dans_la_bande    bigint,
  part_dans_la_bande_pct    numeric,
  ecart_moyen_au_seuil_pct  numeric
) AS $$
DECLARE
  d date; f date; o text;
BEGIN
  -- Trois façons de désigner la période, dans cet ordre de priorité :
  --   1. des bornes explicites — le cas particulier gagne toujours ;
  --   2. un découpage nommé autour d'une date d'ancrage ;
  --   3. rien, donc le découpage par défaut.
  SELECT b.debut, b.fin, b.libelle INTO d, f, o
    FROM periode_bornes(p_type, p_ancre) b;
  IF p_debut IS NOT NULL OR p_fin IS NOT NULL THEN
    d := COALESCE(p_debut, d);
    f := COALESCE(p_fin, f);
    o := 'du ' || to_char(d, 'DD/MM/YYYY') || ' au ' || to_char(f, 'DD/MM/YYYY');
  END IF;

  RETURN QUERY
  WITH
  -- Bande de surveillance, recalculée SUR LA PÉRIODE. On ne réutilise pas
  -- `v_margin_band_by_owner`, qui porte sur l'état courant : mélanger un
  -- indicateur daté et un indicateur instantané dans la même ligne donnerait
  -- un tableau qu'on ne peut pas lire.
  bande AS (
    SELECT dd.pct AS pct
      FROM (SELECT COALESCE(
              (SELECT NULLIF(value, '')::numeric FROM system_settings
                WHERE key = 'MARGIN_BAND_ALERT_PCT'), 15) AS pct) dd
  ),
  pipeline AS (
    SELECT op.owner_id,
           count(*)                                          AS nb,
           sum(op.estimated_volume * op.reference_price)      AS ca,
           sum(CASE WHEN COALESCE(op.probability_override_pct, s.probability_pct) IS NOT NULL
                    THEN op.estimated_volume * op.reference_price
                         * COALESCE(op.probability_override_pct, s.probability_pct) / 100
               END)                                          AS pondere,
           count(*) FILTER (
             WHERE COALESCE(op.probability_override_pct, s.probability_pct) IS NULL
           )                                                 AS sans_proba,
           count(*) FILTER (WHERE op.next_action_due < CURRENT_DATE) AS retard
      FROM crm_opportunities op
      JOIN crm_pipeline_stages s ON s.id = op.stage_id
     WHERE s.outcome::text = 'OPEN'
       AND op.created_at::date BETWEEN d AND f
     GROUP BY op.owner_id
  ),
  issues AS (
    SELECT op.owner_id,
           count(*) FILTER (WHERE s.outcome::text = 'WON')  AS gagnees,
           count(*) FILTER (WHERE s.outcome::text = 'LOST') AS perdues
      FROM crm_opportunities op
      JOIN crm_pipeline_stages s ON s.id = op.stage_id
     WHERE s.outcome::text IN ('WON', 'LOST')
       AND op.closed_at IS NOT NULL
       AND op.closed_at::date BETWEEN d AND f
     GROUP BY op.owner_id
  ),
  affaires AS (
    SELECT dl.owner_id,
           count(*)                                          AS nb,
           sum(dl.contracted_volume)                         AS volume,
           sum(dl.contracted_volume * dl.unit_sale_price)     AS ca,
           round(sum(dl.estimated_full_margin * dl.contracted_volume)
                 / NULLIF(sum(dl.contracted_volume), 0), 4)   AS marge,
           count(*) FILTER (WHERE dl.credit_approved_by_id IS NOT NULL) AS approuvees,
           count(*) FILTER (WHERE dl.margin_derogation_id IS NOT NULL)  AS derog,
           count(*) FILTER (
             WHERE t.minimum_margin IS NOT NULL
               AND dl.estimated_full_margin >= t.minimum_margin
               AND dl.estimated_full_margin <= t.minimum_margin * (1 + b.pct / 100)
           )                                                 AS dans_bande,
           avg(CASE WHEN t.minimum_margin IS NOT NULL AND t.minimum_margin > 0
                     AND dl.estimated_full_margin >= t.minimum_margin
                     AND dl.estimated_full_margin <= t.minimum_margin * (1 + b.pct / 100)
                    THEN (dl.estimated_full_margin - t.minimum_margin)
                         / t.minimum_margin * 100 END)       AS ecart_bande
      FROM deals dl
      CROSS JOIN bande b
      LEFT JOIN LATERAL resolve_margin_threshold(
        dl.segment::text, dl.product_id, dl.currency_code, dl.uom::text, CURRENT_DATE) t ON true
     WHERE dl.status::text NOT IN ('DRAFT', 'CANCELLED', 'REJECTED_BY_CLIENT')
       AND dl.created_at::date BETWEEN d AND f
     GROUP BY dl.owner_id
  )
  SELECT u.id, u.full_name, u.role::text,
         d, f, o,
         COALESCE(p.nb, 0),
         round(COALESCE(p.ca, 0), 2),
         round(p.pondere, 2),
         COALESCE(p.sans_proba, 0),
         COALESCE(p.retard, 0),
         COALESCE(i.gagnees, 0),
         COALESCE(i.perdues, 0),
         CASE WHEN COALESCE(i.gagnees, 0) + COALESCE(i.perdues, 0) > 0
              THEN round(100.0 * i.gagnees / (i.gagnees + i.perdues), 2) END,
         COALESCE(a.nb, 0),
         COALESCE(a.volume, 0),
         round(COALESCE(a.ca, 0), 2),
         COALESCE(a.approuvees, 0),
         a.marge,
         COALESCE(a.derog, 0),
         COALESCE(a.dans_bande, 0),
         CASE WHEN COALESCE(a.nb, 0) > 0
              THEN round(100.0 * a.dans_bande / a.nb, 2) END,
         round(a.ecart_bande, 2)
    FROM users u
    LEFT JOIN pipeline p ON p.owner_id = u.id
    LEFT JOIN issues   i ON i.owner_id = u.id
    LEFT JOIN affaires a ON a.owner_id = u.id
   WHERE u.role::text IN ('SALES_REP', 'CCOO', 'DG')
     AND u.is_active
     -- Une ligne entièrement vide n'apprend rien : un commercial sans activité
     -- SUR LA PÉRIODE n'a pas à figurer, sinon la moitié du tableau est du
     -- bruit à zéro.
     AND (p.owner_id IS NOT NULL OR i.owner_id IS NOT NULL OR a.owner_id IS NOT NULL);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION performance_commerciale(date, date, text, date) IS
  'Performance par commercial SUR UNE PÉRIODE (§ 16). Chaque famille de chiffres est datée de son propre fait : opportunités à l''ouverture, conversion à la clôture, affaires à la création. Bornes nulles = période par défaut, rendue dans le résultat.';


-- ---------------------------------------------------------------------------
--  La vue conserve son nom : elle appelle la fonction sans bornes, donc sur la
--  période par défaut. Ce qui existait continue de fonctionner.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS v_performance_commerciale CASCADE;
CREATE VIEW v_performance_commerciale AS
  SELECT * FROM performance_commerciale(NULL, NULL, NULL, NULL);

COMMENT ON VIEW v_performance_commerciale IS
  'Performance par commercial sur la période PAR DÉFAUT — exercice courant, ou douze derniers mois. Pour une autre période, appeler performance_commerciale(debut, fin).';


-- ─── 29_prevision_dans_les_bornes.sql ────────────────────────────

-- ===========================================================================
--  UNE PRÉVISION RESTE DANS LES BORNES DE SON EXERCICE
--  Réf. SPECIFICATIONS.md § 14.3
--
--  LE DÉFAUT
--  ---------
--  Le rattachement à un exercice était assuré — clé étrangère obligatoire, et
--  une révision porte le même rattachement qu'un budget. Mais le MOIS était
--  borné à 1–12 EN DUR, alors que la durée d'un exercice est libre entre un
--  mois et deux ans.
--
--  Deux conséquences, opposées et toutes deux fausses :
--
--    · Exercice de 6 mois → on pouvait budgéter un mois 12, c'est-à-dire six
--      mois APRÈS la clôture. Le volume entrait dans l'assiette d'absorption
--      d'un exercice qui ne le verrait jamais.
--
--    · Exercice de 18 mois → impossible de budgéter au-delà du mois 12. Six
--      mois d'activité absents de la prévision, donc une assiette
--      d'absorption trop petite, donc une charge au litre surévaluée.
--
--  Le premier gonfle l'assiette, le second la rétrécit. Dans les deux cas le
--  coût de revient est faux, et rien ne le dit.
--
--  ⚠️ LE CAS SYMÉTRIQUE EST TRAITÉ AUSSI.
--
--     Borner la saisie ne suffit pas : on peut saisir une prévision correcte,
--     puis RACCOURCIR l'exercice. Les lignes déjà posées se retrouvent alors
--     hors bornes sans qu'aucune écriture n'ait eu lieu sur elles. C'est le
--     genre de dérive qu'on ne découvre qu'à la clôture.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Combien de mois compte réellement un exercice.
--
--  On compte les MOIS CIVILS couverts, bornes incluses. Un exercice du
--  01/01/2026 au 31/12/2026 en compte douze ; du 01/07/2026 au 30/06/2027,
--  douze également.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nb_mois_exercice(p_fiscal_year_id uuid)
RETURNS int AS $$
  SELECT (extract(year FROM f.ends_on)::int * 12 + extract(month FROM f.ends_on)::int)
       - (extract(year FROM f.starts_on)::int * 12 + extract(month FROM f.starts_on)::int)
       + 1
    FROM fiscal_years f
   WHERE f.id = p_fiscal_year_id;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION nb_mois_exercice(uuid) IS
  'Nombre de mois civils couverts par l''exercice, bornes incluses (§ 14.3). NULL si l''exercice n''existe pas.';

-- ---------------------------------------------------------------------------
--  Le mois CIVIL correspondant à un rang de l'exercice.
--
--  Le rang n'est pas le mois civil : un exercice ouvert en juillet a son mois
--  1 en juillet. Cette fonction fait la traduction — indispensable au plan de
--  trésorerie (§ 14.3), où c'est le calendrier qui compte, pas seulement le
--  montant.
--
--  Rend NULL hors bornes : l'appelant voit l'absence au lieu de recevoir une
--  date plausible située hors de l'exercice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mois_exercice(p_fiscal_year_id uuid, p_rang int)
RETURNS date AS $$
  SELECT CASE
    WHEN p_rang BETWEEN 1 AND nb_mois_exercice(p_fiscal_year_id)
    THEN (date_trunc('month', f.starts_on) + make_interval(months => p_rang - 1))::date
  END
  FROM fiscal_years f
 WHERE f.id = p_fiscal_year_id;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION mois_exercice(uuid, int) IS
  'Premier jour du mois civil correspondant au rang donné dans l''exercice (§ 14.3). NULL hors bornes.';


-- ---------------------------------------------------------------------------
--  La borne physique passe de 12 à 24.
--
--  Douze était une hypothèse déguisée en contrainte. Vingt-quatre découle de
--  la durée maximale déjà posée sur l'exercice : la contrainte de table dit
--  ce qui est PHYSIQUEMENT possible, le déclencheur ci-dessous dit ce qui est
--  vrai POUR CET EXERCICE-LÀ.
-- ---------------------------------------------------------------------------
ALTER TABLE sales_forecasts DROP CONSTRAINT IF EXISTS chk_forecast_mois;
ALTER TABLE sales_forecasts ADD CONSTRAINT chk_forecast_mois
  CHECK (month_index BETWEEN 1 AND 24);


-- ---------------------------------------------------------------------------
--  Le mois doit tomber DANS l'exercice visé.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_prevision_dans_bornes()
RETURNS TRIGGER AS $$
DECLARE
  mois_max int;
  ex record;
  budget_existe boolean;
BEGIN
  SELECT f.year, f.label, f.starts_on, f.ends_on INTO ex
    FROM fiscal_years f WHERE f.id = NEW.fiscal_year_id;

  mois_max := nb_mois_exercice(NEW.fiscal_year_id);

  IF NEW.month_index > mois_max THEN
    RAISE EXCEPTION
      'Mois % hors de l''exercice % : il court du % au %, soit % mois. Le mois est un RANG dans l''exercice, pas un mois civil — un exercice ouvert en juillet a son mois 1 en juillet.',
      NEW.month_index, ex.year,
      to_char(ex.starts_on, 'DD/MM/YYYY'), to_char(ex.ends_on, 'DD/MM/YYYY'), mois_max
      USING ERRCODE = 'check_violation';
  END IF;

  -- ⚠️ ON NE RÉVISE PAS UN BUDGET QUI N'EXISTE PAS.
  --
  --    Le § 14.3 pose la révision comme l'étape 5, après la validation du
  --    budget. Une révision sans budget n'a rien à réviser — et surtout, elle
  --    rend l'écart au budget incalculable, alors que c'est LUI qu'on pilote.
  --
  --    On exige un budget sur L'EXERCICE, pas sur la case exacte : un produit
  --    qui apparaît en cours d'année est légitime, et forcer une ligne de
  --    budget fictive à zéro pour le déclarer serait pire que le mal.
  IF NEW.kind::text = 'REVISION' THEN
    SELECT EXISTS (
      SELECT 1 FROM sales_forecasts s
       WHERE s.fiscal_year_id = NEW.fiscal_year_id
         AND s.kind::text = 'BUDGET'
    ) INTO budget_existe;

    IF NOT budget_existe THEN
      RAISE EXCEPTION
        'Aucun budget de vente n''existe pour l''exercice % : il n''y a rien à réviser. Saisir d''abord le budget, puis ses révisions — sinon l''écart au budget, qui est ce qu''on pilote, devient incalculable.',
        ex.year
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevision_dans_bornes ON sales_forecasts;
CREATE TRIGGER trg_prevision_dans_bornes
  BEFORE INSERT OR UPDATE ON sales_forecasts
  FOR EACH ROW EXECUTE FUNCTION enforce_prevision_dans_bornes();


-- ---------------------------------------------------------------------------
--  On ne raccourcit pas un exercice sous ses prévisions.
--
--  Sans ceci, la garde ci-dessus se contourne sans y toucher : on saisit douze
--  mois, puis on ramène l'exercice à six. Aucune écriture n'a lieu sur les
--  prévisions, et six d'entre elles se retrouvent hors bornes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_exercice_couvre_previsions()
RETURNS TRIGGER AS $$
DECLARE
  mois_max int;
  mois_utilise int;
BEGIN
  IF NEW.starts_on = OLD.starts_on AND NEW.ends_on = OLD.ends_on THEN
    RETURN NEW;
  END IF;

  SELECT max(s.month_index) INTO mois_utilise
    FROM sales_forecasts s WHERE s.fiscal_year_id = NEW.id;

  IF mois_utilise IS NULL THEN
    RETURN NEW;
  END IF;

  mois_max := (extract(year FROM NEW.ends_on)::int * 12 + extract(month FROM NEW.ends_on)::int)
            - (extract(year FROM NEW.starts_on)::int * 12 + extract(month FROM NEW.starts_on)::int)
            + 1;

  IF mois_utilise > mois_max THEN
    RAISE EXCEPTION
      'Ces bornes ramènent l''exercice % à % mois, alors que des prévisions vont jusqu''au mois %. Retirer d''abord les prévisions concernées : les laisser hors bornes fausserait l''assiette d''absorption sans qu''aucune écriture ne le signale.',
      NEW.year, mois_max, mois_utilise
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_exercice_couvre_previsions ON fiscal_years;
CREATE TRIGGER trg_exercice_couvre_previsions
  BEFORE UPDATE ON fiscal_years
  FOR EACH ROW EXECUTE FUNCTION enforce_exercice_couvre_previsions();


-- ---------------------------------------------------------------------------
--  REPRISE — un déclencheur ne juge que ce qui vient après lui.
--
--  Vérifié vide au moment de la pose ; l'instruction reste pour les bases
--  déjà alimentées qui rejoueraient cette migration.
-- ---------------------------------------------------------------------------
DO $reprise$
DECLARE
  hors int;
BEGIN
  SELECT count(*) INTO hors
    FROM sales_forecasts s
   WHERE s.month_index > nb_mois_exercice(s.fiscal_year_id);

  IF hors > 0 THEN
    RAISE WARNING
      '% prévision(s) hors des bornes de leur exercice. Elles restent en base — les supprimer d''office effacerait un travail de budgétisation — et remontent dans v_invariant_breaches jusqu''à traitement.',
      hors;
  END IF;
END
$reprise$;


-- ─── 30_facturation_bornee.sql ───────────────────────────────────

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


-- ─── 31_encaissement_fiable.sql ──────────────────────────────────

-- ===========================================================================
--  L'ENCAISSEMENT — SOLDE DÉRIVÉ, COURSE FERMÉE, DOUBLONS REFUSÉS
--  Réf. SPECIFICATIONS.md § 9.1, § 14.6 — issu de l'audit, défauts A7 et A8
--
--  DEUX DÉFAUTS CONSTATÉS, UNE SEULE CAUSE
--  ---------------------------------------
--  `invoices.paid_amount` était une valeur STOCKÉE, tenue à jour par l'application,
--  à côté du journal `payments`. Rien ne liait les deux.
--
--  A7 — Divergence possible. Vérifié en transaction annulée : un UPDATE direct passe
--       `paid_amount` à `total_amount` et le statut à PAID SANS AUCUN encaissement
--       enregistré. Accepté par la base.
--
--  A8 — Course et non-idempotence. La lecture du solde se faisait HORS de la
--       transaction d'écriture, et le solde était écrit en VALEUR ABSOLUE :
--
--         const invoice = await findUniqueOrThrow(...)        // lecture, hors transaction
--         const paid = Number(invoice.paidAmount) + dto.amount
--         await prisma.$transaction([ create(payment), update({ paidAmount: paid }) ])
--
--       Deux règlements concurrents de 600 sur une facture de 1 000 : les deux lisent
--       0, les deux calculent 600, les deux passent le contrôle applicatif, les deux
--       s'écrivent. Résultat : 1 200 au journal, 600 au solde, facture « partiellement
--       payée ». L'en-cours crédit, qui lit `paid_amount_pivot`, est faux d'autant.
--
--  ⚠️ LA CORRECTION NE CONSISTE PAS À VERROUILLER MIEUX DANS L'APPLICATION.
--
--     Un verrou applicatif protège les chemins qui l'empruntent. Il ne protège ni
--     l'import, ni la reprise de données, ni le correctif d'urgence en SQL. Le solde
--     cesse donc d'être TENU pour devenir DÉRIVÉ : la base le recalcule depuis le
--     journal à chaque mouvement.
--
--     La course se referme d'elle-même. Deux règlements concurrents recalculent tous
--     deux la somme du journal ; le second voit 1 200, dépasse le total, et la
--     contrainte `paid_amount <= total_amount` — qui existait déjà — le refuse. Ce
--     n'est plus l'application qui arbitre, c'est le moteur.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  1. Le solde et le statut se dérivent du journal.
--
--  Le cours retenu est celui FIGÉ SUR LA PIÈCE, jamais celui du jour :
--  `total_amount_pivot` a été calculé à la date de facture, et soustraire un
--  règlement converti au cours d'aujourd'hui ferait apparaître un écart de change
--  comme un impayé.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalcule_solde_facture()
RETURNS TRIGGER AS $$
DECLARE
  cible uuid;
  encaisse numeric;
  f record;
  tol numeric;
BEGIN
  cible := COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF cible IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT i.total_amount, i.fx_rate_to_pivot, i.currency_code, i.status::text AS statut
    INTO f
    FROM invoices i WHERE i.id = cible;

  SELECT COALESCE(sum(p.amount), 0) INTO encaisse
    FROM payments p
   WHERE p.invoice_id = cible AND p.direction::text = 'INBOUND';

  -- Tolérance de restitution : en XOF, un solde de 0,0895 n'existe pas. Le client
  -- paie le montant imprimé, et refuser son règlement pour une fraction de franc
  -- bloquerait la pièce des deux côtés.
  tol := tolerance_arrondi(f.currency_code);

  UPDATE invoices i
     SET paid_amount       = encaisse,
         paid_amount_pivot = round(encaisse * i.fx_rate_to_pivot, 4),
         status = CASE
           -- Une pièce annulée ou contestée garde son statut : ce sont des
           -- décisions, pas des états dérivés du règlement.
           WHEN i.status::text IN ('CANCELLED', 'DISPUTED') THEN i.status
           WHEN encaisse + tol >= i.total_amount            THEN 'PAID'::invoice_status
           WHEN encaisse > 0                                THEN 'PARTIALLY_PAID'::invoice_status
           WHEN i.issued_at IS NOT NULL                     THEN 'ISSUED'::invoice_status
           ELSE i.status
         END
   WHERE i.id = cible;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_solde_facture ON payments;
CREATE TRIGGER trg_solde_facture
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION recalcule_solde_facture();


-- ---------------------------------------------------------------------------
--  2. Le solde ne s'écrit plus à la main.
--
--  Sans ceci, la dérivation ci-dessus serait une convention : un UPDATE direct
--  continuerait de poser n'importe quel solde, et le prochain encaissement le
--  corrigerait sans que personne ait vu passer l'écart.
--
--  L'écriture reste permise quand elle vient du déclencheur lui-même — reconnu à ce
--  que le solde proposé ÉGALE la somme du journal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refuse_solde_ecrit_a_la_main()
RETURNS TRIGGER AS $$
DECLARE
  journal numeric;
BEGIN
  IF NEW.paid_amount IS NOT DISTINCT FROM OLD.paid_amount THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(sum(p.amount), 0) INTO journal
    FROM payments p
   WHERE p.invoice_id = NEW.id AND p.direction::text = 'INBOUND';

  IF abs(NEW.paid_amount - journal) > tolerance_arrondi(NEW.currency_code) THEN
    RAISE EXCEPTION
      'Le montant encaissé de la facture % ne se saisit pas : il est DÉRIVÉ du journal des règlements, qui totalise %. Enregistrer un encaissement, ou l''annuler — un solde posé à la main ne correspondrait à aucun mouvement bancaire.',
      NEW.number, round(journal, 4)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_solde_non_saisissable ON invoices;
CREATE TRIGGER trg_solde_non_saisissable
  BEFORE UPDATE OF paid_amount ON invoices
  FOR EACH ROW EXECUTE FUNCTION refuse_solde_ecrit_a_la_main();


-- ---------------------------------------------------------------------------
--  3. Un même mouvement bancaire ne s'enregistre qu'une fois.
--
--  La référence bancaire EST la clé naturelle d'un règlement : c'est le numéro que
--  la banque attribue au virement. Deux lignes portant la même référence sur la même
--  pièce sont le même argent compté deux fois — double clic, rejeu réseau, ou reprise
--  d'un fichier déjà importé.
--
--  Index PARTIEL : la référence reste facultative, parce qu'un règlement en espèces
--  n'en a pas. Son absence n'est donc pas bloquée — elle est signalée plus bas.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uniq_paiement_reference_bancaire;
CREATE UNIQUE INDEX uniq_paiement_reference_bancaire
  ON payments (invoice_id, bank_reference)
  WHERE bank_reference IS NOT NULL AND invoice_id IS NOT NULL;

DROP INDEX IF EXISTS uniq_paiement_reference_fournisseur;
CREATE UNIQUE INDEX uniq_paiement_reference_fournisseur
  ON payments (supplier_invoice_id, bank_reference)
  WHERE bank_reference IS NOT NULL AND supplier_invoice_id IS NOT NULL;


-- ---------------------------------------------------------------------------
--  4. RAPPROCHEMENT — la vue qui manquait.
--
--  `v_cost_reconciliation` rapprochait les coûts. Rien ne rapprochait les
--  RÈGLEMENTS : le solde et son journal pouvaient diverger sans qu'aucun écran ne
--  puisse le montrer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_rapprochement_encaissements AS
SELECT i.id                                        AS invoice_id,
       i.number                                    AS piece,
       i.type::text                                AS type,
       i.status::text                              AS statut,
       p.legal_name                                AS client,
       i.total_amount,
       i.currency_code,
       i.paid_amount                               AS solde_porte,
       COALESCE(j.encaisse, 0)                     AS somme_du_journal,
       round(i.paid_amount - COALESCE(j.encaisse, 0), 4) AS ecart,
       COALESCE(j.mouvements, 0)                   AS nb_mouvements,
       COALESCE(j.sans_reference, 0)               AS mouvements_sans_reference,
       round(i.total_amount - COALESCE(j.encaisse, 0), 4) AS reste_du,
       i.due_date,
       CASE WHEN i.due_date IS NOT NULL
                 AND i.due_date < CURRENT_DATE
                 AND COALESCE(j.encaisse, 0) + tolerance_arrondi(i.currency_code) < i.total_amount
            THEN CURRENT_DATE - i.due_date END     AS retard_jours
  FROM invoices i
  JOIN partners p ON p.id = i.partner_id
  LEFT JOIN LATERAL (
    SELECT sum(pa.amount)                                        AS encaisse,
           count(*)                                              AS mouvements,
           count(*) FILTER (WHERE pa.bank_reference IS NULL)      AS sans_reference
      FROM payments pa
     WHERE pa.invoice_id = i.id AND pa.direction::text = 'INBOUND'
  ) j ON true
 WHERE i.type::text <> 'PROFORMA';

COMMENT ON VIEW v_rapprochement_encaissements IS
  'Solde porté par la pièce contre somme du journal des règlements (§ 9.1). `ecart` doit rester nul : il est désormais dérivé, et une écriture manuelle est refusée.';


-- ---------------------------------------------------------------------------
--  5. LES CRÉANCES ÉCHUES — le statut OVERDUE n'était jamais posé.
--
--  `invoice_status` porte la valeur OVERDUE depuis l'origine, et AUCUN traitement ne
--  la posait : une facture échue restait ISSUED indéfiniment. Le recouvrement se
--  faisait donc hors de l'outil, ou pas du tout.
--
--  ⚠️ ON DÉRIVE PLUTÔT QUE DE STOCKER, ET C'EST DÉLIBÉRÉ.
--
--     Stocker OVERDUE exigerait un traitement quotidien : sans lui, le statut serait
--     juste le jour de son calcul et faux le lendemain. La conformité des moyens a
--     déjà tranché la même question de la même façon (`compliance_statut_effectif`) —
--     un statut qui dépend de la DATE DU JOUR se calcule à la lecture.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION statut_creance_effectif(
  p_statut text, p_due_date date, p_reste numeric, p_tolerance numeric DEFAULT 0.005)
RETURNS text AS $$
  SELECT CASE
    WHEN p_statut IN ('CANCELLED', 'DISPUTED', 'PAID', 'DRAFT') THEN p_statut
    WHEN p_due_date IS NOT NULL
     AND p_due_date < CURRENT_DATE
     AND p_reste > p_tolerance                                  THEN 'OVERDUE'
    ELSE p_statut
  END;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE VIEW v_creances_echues AS
SELECT r.invoice_id,
       r.piece,
       r.client,
       r.total_amount,
       r.currency_code,
       r.somme_du_journal                          AS encaisse,
       r.reste_du,
       r.due_date,
       r.retard_jours,
       -- Tranches d'ancienneté : une balance âgée se lit par paliers, pas facture
       -- par facture.
       CASE
         WHEN r.retard_jours IS NULL   THEN 'à échoir'
         WHEN r.retard_jours <= 30     THEN '1 à 30 jours'
         WHEN r.retard_jours <= 60     THEN '31 à 60 jours'
         WHEN r.retard_jours <= 90     THEN '61 à 90 jours'
         ELSE 'plus de 90 jours'
       END                                         AS tranche
  FROM v_rapprochement_encaissements r
 WHERE r.statut NOT IN ('DRAFT', 'CANCELLED', 'PAID')
   AND r.reste_du > tolerance_arrondi(r.currency_code);

COMMENT ON VIEW v_creances_echues IS
  'Balance âgée des créances clients (§ 13, module 6 — recouvrement). Le retard est DÉRIVÉ de la date du jour : un statut stocké serait juste le jour de son calcul et faux le lendemain.';


-- ---------------------------------------------------------------------------
--  6. REPRISE — aligner les soldes existants sur leur journal.
--
--  La dérivation ne juge que les mouvements postérieurs à sa pose. Les pièces déjà
--  en base gardent le solde que l'application leur avait donné, et rien ne dit s'il
--  correspond au journal.
-- ---------------------------------------------------------------------------
DO $reprise$
DECLARE
  n int;
BEGIN
  WITH journal AS (
    SELECT i.id,
           COALESCE((SELECT sum(p.amount) FROM payments p
                      WHERE p.invoice_id = i.id AND p.direction::text = 'INBOUND'), 0) AS encaisse
      FROM invoices i
     WHERE i.type::text <> 'PROFORMA'
  )
  UPDATE invoices i
     SET paid_amount       = j.encaisse,
         paid_amount_pivot = round(j.encaisse * i.fx_rate_to_pivot, 4)
    FROM journal j
   WHERE j.id = i.id
     AND abs(i.paid_amount - j.encaisse) > tolerance_arrondi(i.currency_code);

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'Reprise : % solde(s) de facture réaligné(s) sur le journal des règlements.', n;
  END IF;
END
$reprise$;


-- ─── 34_budget_indirect_derive.sql ───────────────────────────────

-- ===========================================================================
--  L'ASSIETTE ET LES CHARGES FIXES SE DÉRIVENT — ELLES NE SE SAISISSENT PLUS
--  Réf. SPECIFICATIONS.md § 14.2, § 14.3, § 14.5
--
--  CE QUI N'ALLAIT PAS
--  -------------------
--  Trois chiffres décrivaient la même chose et se saisissaient séparément :
--
--    · la PRÉVISION DE VENTE, par segment × produit × mois ;
--    · l'ASSIETTE BUDGÉTÉE d'un pool, qui n'en est que la somme annuelle ;
--    · le BUDGET DE CHARGES FIXES, qui recouvrait les mêmes charges que les
--      pools de charges indirectes.
--
--  Rien ne rapprochait ces saisies. Le jour où elles divergeaient — on révise
--  la prévision, on oublie le taux ; on augmente un pool, on oublie les
--  charges fixes — le seuil de marge et le point mort racontaient deux
--  histoires différentes, et ni l'un ni l'autre ne le disait.
--
--  Le dirigeant, le 9 août : « il n'y a pas d'assiette budgétisée spécifique à
--  un pool, tous tirent leur source des prévisions », et sur la redondance des
--  charges fixes : « dériver l'un de l'autre ».
--
--  CE QUE CE FICHIER POSE
--  ----------------------
--    1. L'assiette d'un pool = somme des volumes de PRÉVISION BUDGÉTÉE de
--       l'exercice, sur les segments qu'il couvre. Calculée, jamais saisie.
--    2. Les charges fixes de l'exercice = somme des budgets des pools FIXED.
--       Calculées, jamais saisies.
--    3. Le budget de vente se BOUCLE avant l'ouverture de l'exercice, sans
--       quoi le dénominateur resterait mouvant.
--
--  ⚠️ LE DÉNOMINATEUR RESTE LE BUDGET, JAMAIS LA RÉVISION.
--
--     C'est la règle la plus importante de ce module (§ 14.2). Si le taux
--     suivait les révisions, une année sous les prévisions ferait monter la
--     charge au litre — mêmes frais fixes sur moins de litres. La marge
--     calculée baisserait, davantage d'affaires passeraient sous le seuil, on
--     vendrait moins, le volume baisserait encore. Sur une marge de l'ordre de
--     4 %, cette boucle s'emballe en un trimestre.
--
--     L'écart à la révision est une information de PILOTAGE — la vue
--     `v_absorption_reelle` plus bas —, jamais un paramètre de calcul.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  0. La nature d'un pool se déclare, elle ne se suppose pas.
--
--  Le défaut Prisma n'existe que pour la reprise : sans lui, l'ajout d'une
--  colonne NOT NULL échouerait sur les pools déjà en base. Une fois la colonne
--  posée, on le retire — sinon tout pool créé ensuite prendrait sa nature par
--  omission, et une charge variable comptée dans le point mort le fausserait
--  sans rien signaler.
-- ---------------------------------------------------------------------------
ALTER TABLE cost_pools ALTER COLUMN variability DROP DEFAULT;

-- ---------------------------------------------------------------------------
--  1. Un poste de charge ne contredit pas la nature de son pool.
--
--  La variabilité existait déjà sur les POSTES. La porter aussi sur le pool
--  ouvre la possibilité qu'elles se contredisent : un poste variable rangé
--  dans un pool fixe ferait entrer une charge proportionnelle dans le point
--  mort, où elle est déjà comptée par la marge sur coût variable. Comptée deux
--  fois, donc.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_variabilite_coherente()
RETURNS TRIGGER AS $$
DECLARE
  nature_pool text;
  code_pool   text;
BEGIN
  IF NEW.cost_pool_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT cp.variability::text, cp.code INTO nature_pool, code_pool
    FROM cost_pools cp WHERE cp.id = NEW.cost_pool_id;

  IF nature_pool IS NOT NULL AND NEW.variability::text <> nature_pool THEN
    RAISE EXCEPTION
      'Le poste « % » est % alors que le pool « % » regroupe des charges %. Un poste variable dans un pool fixe entrerait dans le point mort (§ 14.5), où la marge sur coût variable le compte DÉJÀ — il serait compté deux fois. Rangez ce poste dans un pool de même nature.',
      NEW.code, NEW.variability::text, code_pool, nature_pool
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_variabilite_coherente ON cost_posts;
CREATE TRIGGER trg_variabilite_coherente
  BEFORE INSERT OR UPDATE OF cost_pool_id, variability ON cost_posts
  FOR EACH ROW EXECUTE FUNCTION enforce_variabilite_coherente();

-- Symétrique : changer la nature du POOL ne doit pas rendre ses postes faux.
CREATE OR REPLACE FUNCTION enforce_variabilite_pool_coherente()
RETURNS TRIGGER AS $$
DECLARE
  discordants int;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.variability = OLD.variability THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO discordants
    FROM cost_posts p
   WHERE p.cost_pool_id = NEW.id
     AND p.variability::text <> NEW.variability::text;

  IF discordants > 0 THEN
    RAISE EXCEPTION
      'Le pool « % » porte % poste(s) de charge de l''autre nature. Basculer le pool les rendrait incohérents en silence : reclassez d''abord ces postes.',
      NEW.code, discordants
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_variabilite_pool_coherente ON cost_pools;
CREATE TRIGGER trg_variabilite_pool_coherente
  BEFORE UPDATE ON cost_pools
  FOR EACH ROW EXECUTE FUNCTION enforce_variabilite_pool_coherente();


-- ===========================================================================
--  2. L'ASSIETTE, CALCULÉE DEPUIS LA PRÉVISION
-- ===========================================================================
-- ⚠️ ON LIT LE BUDGET, ET SEULEMENT LE BUDGET.
--
--    `is_current AND kind = 'BUDGET'`. Pas la prévision en vigueur, qui fait
--    passer la révision devant le budget — c'est le bon comportement pour le
--    plan d'approvisionnement, et le mauvais ici. Voir l'avertissement en tête
--    de fichier : la spirale d'absorption.
--
--    La stabilité est acquise par construction : une ligne de budget validée
--    ne se modifie plus (§ 14.3), et le point 4 ci-dessous interdit d'en
--    AJOUTER une fois l'exercice ouvert. Le dénominateur est donc figé sans
--    qu'on ait à en recopier une seconde valeur quelque part.
-- ⚠️ CETTE FONCTION NE LÈVE JAMAIS — ELLE CONSTATE.
--
--    C'est le déclencheur qui refuse, plus bas. La distinction n'est pas
--    théorique : `v_invariant_breaches` appelle cette fonction pour vérifier
--    que les assiettes en base correspondent toujours à la prévision. Si elle
--    levait sur des unités mêlées, la vue d'audit TOUT ENTIÈRE tomberait en
--    erreur — et l'écran qui doit signaler les anomalies deviendrait le
--    premier à se taire, exactement quand quelque chose ne va pas.
-- Le DROP est indispensable : ajouter un paramètre OUT change le type de
-- retour, et `CREATE OR REPLACE` refuse de le faire. Sans lui, la migration
-- échoue sur « cannot change return type of existing function ».
DROP FUNCTION IF EXISTS assiette_absorption(uuid, uuid);

CREATE OR REPLACE FUNCTION assiette_absorption(
  p_cost_pool_id   uuid,
  p_fiscal_year_id uuid,
  OUT volume       numeric,
  OUT uom          text,
  OUT unites       int
) AS $$
DECLARE
  segs    commercial_segment[];
  liste   text[];
  libelle text;
BEGIN
  unites := 0;

  SELECT cp.segments, cp.code INTO segs, libelle
    FROM cost_pools cp WHERE cp.id = p_cost_pool_id;

  -- Un pool sans segment déclaré les couvre TOUS : c'est la convention du
  -- reste du système, on ne l'invente pas ici.
  SELECT array_agg(DISTINCT s.uom::text ORDER BY s.uom::text)
    INTO liste
    FROM sales_forecasts s
   WHERE s.fiscal_year_id = p_fiscal_year_id
     AND s.is_current
     AND s.kind::text = 'BUDGET'
     AND (segs IS NULL OR cardinality(segs) = 0 OR s.segment = ANY (segs));

  -- Aucune prévision couverte : volume et unité restent NULS, et l'appelant le
  -- dit. Rendre 0 ferait diviser par zéro plus loin ; rendre 1 serait pire.
  IF liste IS NULL THEN
    RETURN;
  END IF;

  unites := cardinality(liste);

  -- ⚠️ ON SOMME PAR UNITÉ, ON NE MÉLANGE PAS.
  --
  --    Additionner des litres et des tonnes donnerait un dénominateur sans
  --    signification, et donc une charge au litre fausse d'un facteur mille.
  --    Convertir supposerait la densité, qui dépend du produit et de la
  --    température — une hypothèse qu'on n'a pas à prendre ici.
  --
  --    On rend `unites` et on laisse le volume NUL : l'appelant qui écrit
  --    refuse, celui qui lit affiche l'anomalie.
  IF unites > 1 THEN
    uom := array_to_string(liste, ', ');
    RETURN;
  END IF;

  uom := liste[1];

  SELECT sum(s.forecast_volume)
    INTO volume
    FROM sales_forecasts s
   WHERE s.fiscal_year_id = p_fiscal_year_id
     AND s.is_current
     AND s.kind::text = 'BUDGET'
     AND (segs IS NULL OR cardinality(segs) = 0 OR s.segment = ANY (segs));
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION assiette_absorption(uuid, uuid) IS
  'Assiette d''absorption d''un pool : somme des volumes de prévision BUDGÉTÉE de l''exercice sur les segments qu''il couvre (§ 14.2). Volume nul = aucune prévision couverte, ou unités mêlées (`unites` > 1) — ce n''est jamais un zéro constaté. NE LÈVE PAS : la vue d''audit l''appelle, et une vue d''audit qui tombe en erreur est pire qu''absente.';


-- ---------------------------------------------------------------------------
--  3. LE TAUX ET SON DÉNOMINATEUR SONT CALCULÉS — SEUL LE BUDGET EST SAISI.
--
--  L'ancien déclencheur ne dérivait que le taux, et exigeait une assiette
--  saisie. C'est cette saisie-là qu'on supprime : elle recopiait la prévision,
--  et deux copies d'un même chiffre finissent toujours par différer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION derive_absorption_rate()
RETURNS TRIGGER AS $$
DECLARE
  a       record;
  ex      record;
  pool    record;
BEGIN
  SELECT cp.code, cp.label, cp.segments INTO pool
    FROM cost_pools cp WHERE cp.id = NEW.cost_pool_id;

  SELECT f.year, f.label, f.status::text AS statut INTO ex
    FROM fiscal_years f WHERE f.id = NEW.fiscal_year_id;

  SELECT * INTO a FROM assiette_absorption(NEW.cost_pool_id, NEW.fiscal_year_id);

  IF a.unites > 1 THEN
    RAISE EXCEPTION
      'Les prévisions couvertes par le pool « % » sur l''exercice % mêlent plusieurs unités (%). L''assiette d''absorption serait la somme de litres et de tonnes, donc fausse d''un facteur mille. Convertir supposerait la densité, qui dépend du produit et de la température — une hypothèse qui n''a pas à se prendre ici. Uniformisez l''unité des prévisions avant de fixer le budget du pool.',
      pool.code, ex.year, a.uom
      USING ERRCODE = 'check_violation';
  END IF;

  IF a.volume IS NULL OR a.volume = 0 THEN
    RAISE EXCEPTION
      'ASSIETTE D''ABSORPTION — aucune prévision de vente budgétée sur l''exercice % pour les segments du pool « % ». Le taux se calcule en divisant le budget du pool par le volume prévu : saisissez d''abord la prévision de vente, puis le budget du pool. L''ordre inverse n''est pas possible, et c''est voulu.',
      ex.year, pool.code
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.budgeted_base := a.volume;
  NEW.base_uom      := a.uom::unit_of_measure;
  NEW.rate_per_unit := round(NEW.budgeted_amount / a.volume, 6);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Sur TOUTE écriture, et plus seulement sur trois colonnes : changer le pool
-- ou l'exercice change l'assiette, donc le taux.
DROP TRIGGER IF EXISTS trg_derive_absorption_rate ON absorption_rates;
CREATE TRIGGER trg_derive_absorption_rate
  BEFORE INSERT OR UPDATE ON absorption_rates
  FOR EACH ROW EXECUTE FUNCTION derive_absorption_rate();


-- ---------------------------------------------------------------------------
--  4. LE BUDGET DE VENTE SE BOUCLE AVANT L'OUVERTURE DE L'EXERCICE.
--
--  ⚠️ SANS CECI, TOUT LE RESTE EST POREUX.
--
--     La ligne de budget validée ne se MODIFIE plus (§ 14.3) — c'était acquis.
--     Mais rien n'empêchait d'en AJOUTER une : un produit apparu en avril,
--     saisi en BUDGET, faisait grossir le dénominateur en cours d'exercice et
--     baisser la charge au litre de tous les pools. La porte de la spirale
--     restait entrouverte.
--
--     Après ouverture, toute évolution se saisit en RÉVISION — qui informe le
--     pilotage sans toucher au dénominateur.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refuse_budget_apres_ouverture()
RETURNS TRIGGER AS $$
DECLARE
  ex record;
BEGIN
  IF NEW.kind::text <> 'BUDGET' THEN
    RETURN NEW;
  END IF;

  -- Une ligne DÉJÀ budget reste modifiable dans les limites du § 14.3 : sortie
  -- de version courante, notes. Ce verrou-ci ne vise que l'APPARITION d'un
  -- budget après l'ouverture.
  IF TG_OP = 'UPDATE' AND OLD.kind::text = 'BUDGET'
     AND OLD.fiscal_year_id = NEW.fiscal_year_id THEN
    RETURN NEW;
  END IF;

  SELECT f.year, f.label, f.status::text AS statut INTO ex
    FROM fiscal_years f WHERE f.id = NEW.fiscal_year_id;

  IF ex.statut <> 'PLANNED' THEN
    RAISE EXCEPTION
      'L''exercice % est % : son budget de vente est bouclé et ne s''enrichit plus. Une prévision nouvelle se saisit en RÉVISION. Ajouter du budget en cours d''exercice ferait grossir l''assiette d''absorption et baisser la charge au litre de tous les pools, sans qu''aucune charge n''ait changé (§ 14.2).',
      ex.year,
      CASE ex.statut WHEN 'OPEN' THEN 'ouvert' WHEN 'CLOSED' THEN 'clos' ELSE ex.statut END
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_budget_apres_ouverture ON sales_forecasts;
CREATE TRIGGER trg_budget_apres_ouverture
  BEFORE INSERT OR UPDATE ON sales_forecasts
  FOR EACH ROW EXECUTE FUNCTION refuse_budget_apres_ouverture();


-- ---------------------------------------------------------------------------
--  5. TANT QUE L'EXERCICE SE PRÉPARE, LE BUDGET BOUGE — LES TAUX SUIVENT.
--
--  Sans ce recalcul, un taux fixé avant l'ajout d'un dernier mois de budget
--  resterait calé sur l'ancienne assiette. Il ne serait pas faux au moment de
--  sa saisie, ce qui est exactement le genre d'erreur qu'on ne cherche pas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalcule_taux_absorption(p_fiscal_year_id uuid)
RETURNS void AS $$
DECLARE
  t      record;
  a      record;
BEGIN
  FOR t IN
    SELECT ar.id, ar.cost_pool_id, cp.code
      FROM absorption_rates ar
      JOIN cost_pools cp ON cp.id = ar.cost_pool_id
     WHERE ar.fiscal_year_id = p_fiscal_year_id
  LOOP
    SELECT * INTO a FROM assiette_absorption(t.cost_pool_id, p_fiscal_year_id);

    -- Le message est levé ICI, et non par le déclencheur du taux : celui-là
    -- dirait « saisissez d'abord la prévision », ce qui n'aurait aucun sens
    -- face à quelqu'un qui vient d'en supprimer une.
    IF a.unites > 1 THEN
      RAISE EXCEPTION
        'Cette écriture ferait mêler plusieurs unités (%) aux prévisions couvertes par le pool « % », dont le budget est déjà fixé. L''assiette d''absorption n''aurait plus de sens. Uniformisez l''unité des prévisions de cet exercice.',
        a.uom, t.code
        USING ERRCODE = 'check_violation';
    END IF;

    IF a.volume IS NULL OR a.volume = 0 THEN
      RAISE EXCEPTION
        'Cette écriture viderait l''assiette d''absorption du pool « % », dont le budget est déjà fixé. Le coût de revient deviendrait incalculable. Retirez d''abord le budget de ce pool, ou conservez au moins une prévision sur ses segments.',
        t.code
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE absorption_rates ar
       SET budgeted_base = a.volume,
           base_uom      = a.uom::unit_of_measure,
           rate_per_unit = round(ar.budgeted_amount / a.volume, 6)
     WHERE ar.id = t.id
       -- N'écrit que si quelque chose change : évite de réveiller les
       -- déclencheurs d'audit sur une prévision qui n'a pas bougé l'assiette.
       AND (ar.budgeted_base IS DISTINCT FROM a.volume
            OR ar.base_uom::text IS DISTINCT FROM a.uom);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION propage_assiette_absorption()
RETURNS TRIGGER AS $$
DECLARE
  cible uuid;
BEGIN
  cible := COALESCE(NEW.fiscal_year_id, OLD.fiscal_year_id);

  IF COALESCE(NEW.kind::text, OLD.kind::text) = 'BUDGET' THEN
    PERFORM recalcule_taux_absorption(cible);
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_propage_assiette ON sales_forecasts;
CREATE TRIGGER trg_propage_assiette
  AFTER INSERT OR UPDATE OR DELETE ON sales_forecasts
  FOR EACH ROW EXECUTE FUNCTION propage_assiette_absorption();


-- ===========================================================================
--  6. LES CHARGES FIXES DE L'EXERCICE, DÉRIVÉES DES POOLS
--
--  Elles se saisissaient dans `fixed_cost_budgets`, table supprimée par cette
--  migration. Le budget d'un pool est saisi UNE FOIS et sert DEUX FOIS :
--
--    · divisé par l'assiette → la charge au litre → le seuil de marge ;
--    · sommé sur les pools FIXES → le numérateur du point mort.
--
--  ⚠️ SEULS LES POOLS *FIXED* Y ENTRENT.
--
--     Un pool VARIABLE — des commissions bancaires proportionnelles, par
--     exemple — s'absorbe bien au litre, mais n'est pas une charge fixe : la
--     marge sur coût variable le compte déjà. L'ajouter ici le compterait deux
--     fois et gonflerait le point mort.
-- ===========================================================================
--  La vue `v_charges_fixes_exercice` porte ce calcul. Elle est définie dans le
--  fichier 24, et non ici : le point mort la lit (fichier 25), et 25 est joué
--  AVANT 34 — il lui faut `v_prevision_en_vigueur`, que 25 crée. Placer la vue
--  au plus près des tables qu'elle lit résout l'ordre sans le contourner.


-- ===========================================================================
--  7. CE QUE LES CHARGES DEVRAIENT COÛTER AU LITRE, ET CE QU'ELLES COÛTENT
--
--  Le dirigeant, le 9 août : « je veux pouvoir avoir une idée de ce que les
--  charges devraient me coûter au litre et ce qu'elles le coûtent réellement ».
--
--  ⚠️ AUCUNE DE CES COLONNES N'ENTRE DANS UN CALCUL. C'EST UN THERMOMÈTRE.
--
--     Si `taux_si_revision` alimentait la marge, on rouvrirait exactement la
--     spirale que le point 4 vient de fermer. Seul `taux_applique` compte pour
--     le coût de revient ; les deux autres colonnes servent à décider, en fin
--     d'exercice, comment budgéter le suivant.
--
--  ⚠️ LE NUMÉRATEUR EST TOUJOURS LE BUDGET. IL N'Y A PAS DE COMPTABILITÉ DE
--     CHARGES DANS CE SYSTÈME.
--
--     Aucune table n'enregistre ce que l'administration a réellement dépensé.
--     Ce tableau ne compare donc pas « budgété contre dépensé », mais « sur
--     combien de litres j'espérais étaler » contre « sur combien je vais
--     réellement les étaler ». C'est la bonne question ici — c'est le volume
--     qui bouge, pas le loyer — mais il faut le dire plutôt que le laisser
--     croire, d'où la colonne `perimetre`.
-- ===========================================================================
CREATE OR REPLACE VIEW v_absorption_reelle AS
WITH ex AS (
  SELECT f.id, f.year, f.label, f.starts_on, f.ends_on,
         nb_mois_exercice(f.id) AS mois_total,
         -- Mois ENTAMÉS depuis l'ouverture, bornés à la durée de l'exercice.
         -- Zéro tant qu'il n'a pas commencé : un prorata négatif n'a pas de
         -- sens, et un prorata plein sur un exercice à venir non plus.
         GREATEST(0, LEAST(
           nb_mois_exercice(f.id),
           (extract(year FROM CURRENT_DATE)::int * 12 + extract(month FROM CURRENT_DATE)::int)
         - (extract(year FROM f.starts_on)::int  * 12 + extract(month FROM f.starts_on)::int) + 1
         )) AS mois_ecoules
    FROM fiscal_years f
),
-- Prévision EN VIGUEUR : la révision remplace le budget sur son mois. C'est
-- l'inverse de l'assiette, et c'est tout l'objet de la comparaison.
revise AS (
  SELECT e.fiscal_year_id, e.segment, e.uom, sum(e.forecast_volume) AS volume
    FROM v_prevision_en_vigueur e
   GROUP BY e.fiscal_year_id, e.segment, e.uom
),
realise AS (
  SELECT x.id AS fiscal_year_id, d.segment, d.uom::text AS uom,
         sum(d.contracted_volume) AS volume
    FROM deals d
    JOIN ex x ON d.created_at::date BETWEEN x.starts_on AND x.ends_on
   WHERE d.status::text NOT IN ('DRAFT', 'CANCELLED', 'REJECTED_BY_CLIENT')
   GROUP BY x.id, d.segment, d.uom
)
SELECT cp.code                                          AS pool,
       cp.label                                         AS pool_libelle,
       cp.variability::text                             AS nature,
       cp.currency_code                                 AS devise,
       ex.year                                          AS exercice,
       ex.label                                         AS exercice_libelle,
       ar.budgeted_amount                               AS budget,
       ar.base_uom::text                                AS uom,

       -- ① Ce qui fait foi. Le seul chiffre qui entre dans la marge.
       ar.budgeted_base                                 AS assiette_budget,
       ar.rate_per_unit                                 AS taux_applique,

       -- ② Ce que ça coûterait si la révision se confirme.
       r.volume                                         AS assiette_revisee,
       CASE WHEN r.volume > 0
            THEN round(ar.budgeted_amount / r.volume, 6)
       END                                              AS taux_si_revision,

       -- ③ Ce que ça coûte à date. Prorata des DEUX côtés : comparer un budget
       --    annuel à cinq mois de ventes donnerait un chiffre absurde.
       ex.mois_ecoules,
       ex.mois_total,
       v.volume                                         AS volume_realise,
       CASE WHEN v.volume > 0 AND ex.mois_ecoules > 0 AND ex.mois_total > 0
            THEN round(ar.budgeted_amount * ex.mois_ecoules / ex.mois_total / v.volume, 6)
       END                                              AS taux_a_date,

       -- Écarts, en devise par unité et en pourcentage du taux appliqué.
       CASE WHEN r.volume > 0
            THEN round(ar.budgeted_amount / r.volume - ar.rate_per_unit, 6)
       END                                              AS ecart_revision,
       CASE WHEN r.volume > 0 AND ar.rate_per_unit > 0
            THEN round((ar.budgeted_amount / r.volume - ar.rate_per_unit)
                       / ar.rate_per_unit * 100, 2)
       END                                              AS ecart_revision_pct,
       CASE WHEN v.volume > 0 AND ex.mois_ecoules > 0 AND ex.mois_total > 0
            THEN round(ar.budgeted_amount * ex.mois_ecoules / ex.mois_total / v.volume
                       - ar.rate_per_unit, 6)
       END                                              AS ecart_a_date,
       CASE WHEN v.volume > 0 AND ex.mois_ecoules > 0 AND ex.mois_total > 0
                 AND ar.rate_per_unit > 0
            THEN round((ar.budgeted_amount * ex.mois_ecoules / ex.mois_total / v.volume
                        - ar.rate_per_unit) / ar.rate_per_unit * 100, 2)
       END                                              AS ecart_a_date_pct,

       'Le numérateur est TOUJOURS le budget : aucune comptabilité de charges n''alimente ce système. Ces colonnes comparent des assiettes, pas des dépenses. Seul « taux appliqué » entre dans le calcul de marge.'::text
                                                        AS perimetre
  FROM absorption_rates ar
  JOIN cost_pools cp ON cp.id = ar.cost_pool_id
  JOIN ex            ON ex.id = ar.fiscal_year_id
  -- Somme des segments couverts, sur la même unité que l'assiette : un pool
  -- sans segment déclaré les couvre tous.
  LEFT JOIN LATERAL (
    SELECT sum(x.volume) AS volume FROM revise x
     WHERE x.fiscal_year_id = ar.fiscal_year_id
       AND x.uom::text = ar.base_uom::text
       -- COALESCE : `cardinality(NULL)` vaut NULL, pas zéro. Un pool sans
       -- segment déclaré doit les couvrir TOUS, pas aucun.
       AND (COALESCE(cardinality(cp.segments), 0) = 0 OR x.segment = ANY (cp.segments))
  ) r ON true
  LEFT JOIN LATERAL (
    SELECT sum(y.volume) AS volume FROM realise y
     WHERE y.fiscal_year_id = ar.fiscal_year_id
       AND y.uom = ar.base_uom::text
       AND (COALESCE(cardinality(cp.segments), 0) = 0 OR y.segment = ANY (cp.segments))
  ) v ON true
 WHERE ar.is_current
   AND cp.is_active;

COMMENT ON VIEW v_absorption_reelle IS
  'Charge indirecte au litre selon trois assiettes : budgétée (celle qui fait foi), révisée, et réalisée au prorata des mois écoulés (§ 14.2). INDICATEUR SEUL — seul `taux_applique` entre dans le calcul de marge ; brancher les autres rouvrirait la spirale d''absorption.';


-- ===========================================================================
--  8. REPRISE — un déclencheur ne juge que ce qui vient après lui.
-- ===========================================================================
DO $reprise$
DECLARE
  incoherents int;
  melanges    int;
BEGIN
  -- 8.1 Postes rangés dans un pool de l'autre nature.
  SELECT count(*) INTO incoherents
    FROM cost_posts p
    JOIN cost_pools cp ON cp.id = p.cost_pool_id
   WHERE p.variability::text <> cp.variability::text;

  IF incoherents > 0 THEN
    RAISE WARNING
      '% poste(s) de charge rangé(s) dans un pool de nature différente. Ils restent en base — les déplacer d''office serait une décision de gestion — et remontent dans v_invariant_breaches jusqu''à traitement.',
      incoherents;
  END IF;

  -- 8.2 Taux dont l'assiette ne correspond plus à la prévision budgétée.
  --     Recalculés, puisqu'ils sont désormais dérivés : c'est la prévision qui
  --     fait foi, et l'ancienne saisie n'était qu'une copie.
  --
  --     ⚠️ L'ÉCHEC EST RATTRAPÉ, ET C'EST DÉLIBÉRÉ.
  --        `recalcule_taux_absorption` lève quand un pool n'a plus d'assiette
  --        — le bon comportement face à une suppression, le mauvais pendant
  --        une migration : elle s'interromprait, laissant la base à mi-chemin
  --        pour une donnée de paramétrage réparable en trente secondes.
  BEGIN
    PERFORM recalcule_taux_absorption(f.id) FROM fiscal_years f;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING
      'Recalcul des assiettes d''absorption incomplet : %. Les taux concernés gardent leur assiette antérieure et remontent dans v_invariant_breaches.',
      SQLERRM;
  END;

  -- 8.3 Exercices dont les prévisions budgétées mêlent les unités : le calcul
  --     ci-dessus les aurait fait échouer. On le signale sans bloquer la
  --     migration — refuser de migrer pour une donnée de paramétrage
  --     laisserait la base dans un état pire.
  SELECT count(*) INTO melanges
    FROM (SELECT s.fiscal_year_id
            FROM sales_forecasts s
           WHERE s.is_current AND s.kind::text = 'BUDGET'
           GROUP BY s.fiscal_year_id
          HAVING count(DISTINCT s.uom) > 1) m;

  IF melanges > 0 THEN
    RAISE WARNING
      '% exercice(s) dont les prévisions budgétées mêlent plusieurs unités. Aucun taux d''absorption ne pourra y être fixé tant que l''unité n''est pas uniformisée.',
      melanges;
  END IF;
END
$reprise$;


-- ===========================================================================
--  9. LE PRIX DE RÉFÉRENCE DE LA PRÉVISION VIENT DE LA PUBLICATION
--
--  Le dirigeant, le 9 août : « le prix de référence est saisi et pourtant il
--  est paramétré déjà à titre d'indication dans Prix administrés pour un type
--  de produit, redondance, prendre le prix d'actualité dans cette liste ».
--
--  Deux copies d'un même chiffre finissent toujours par différer : la DGH
--  publie, personne ne reprend la prévision, et le chiffre d'affaires
--  prévisionnel reste calé sur un prix que plus personne ne pratique. L'écart
--  de prix que le § 14.3 veut mesurer devient alors un écart de saisie.
--
--  ⚠️ ON NE DEVINE PAS *QUELLE* PUBLICATION S'APPLIQUE.
--
--     Plusieurs coexistent pour un même produit : prix à la pompe, publication
--     SIR, prix contractuel. Retenir « la plus récente » ferait basculer la
--     base de calcul sur une autre référence au premier arrêté publié, en
--     silence. La prévision déclare donc la publication qu'elle suit, une
--     fois ; le prix, lui, en découle.
--
--  ⚠️ CETTE DÉRIVATION NE VAUT QU'À LA CRÉATION.
--
--     Le prix est figé au moment où la prévision est posée, comme l'assiette
--     d'absorption. C'est ce qui permet de comparer plus tard le réalisé à
--     l'hypothèse retenue : un prix qui suivrait les publications rendrait
--     l'écart de prix nul par construction, et il n'y aurait plus rien à
--     piloter.
-- ===========================================================================
CREATE OR REPLACE FUNCTION derive_prix_reference()
RETURNS TRIGGER AS $$
DECLARE
  pub     record;
  combien int;
  produit text;
BEGIN
  SELECT p.code INTO produit FROM products p WHERE p.id = NEW.product_id;

  IF NEW.price_reference_type IS NULL THEN
    RAISE EXCEPTION
      'Indiquez la publication de prix que suit cette prévision (prix à la pompe, publication SIR, prix contractuel). Le prix lui-même en sera tiré : il ne se saisit plus, pour qu''il ne puisse plus diverger de ce qui est publié.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Publications EN VIGUEUR aujourd'hui pour ce produit et cette référence.
  -- La zone nationale prime sur une zone particulière : c'est le cas courant,
  -- et l'inverse ferait dépendre le budget d'une péréquation régionale.
  SELECT count(*) INTO combien
    FROM administered_prices ap
   WHERE ap.product_id = NEW.product_id
     AND ap.reference_type = NEW.price_reference_type
     AND ap.effective_from <= CURRENT_DATE
     AND (ap.effective_to IS NULL OR ap.effective_to >= CURRENT_DATE);

  IF combien = 0 THEN
    RAISE EXCEPTION
      'Aucun prix % n''est publié aujourd''hui pour le produit « % ». Publiez-le au référentiel des prix administrés, puis revenez : la prévision en tire son prix, elle ne le réinvente pas.',
      NEW.price_reference_type::text, COALESCE(produit, '?')
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT ap.price, ap.currency_code, ap.uom, ap.zone INTO pub
    FROM administered_prices ap
   WHERE ap.product_id = NEW.product_id
     AND ap.reference_type = NEW.price_reference_type
     AND ap.effective_from <= CURRENT_DATE
     AND (ap.effective_to IS NULL OR ap.effective_to >= CURRENT_DATE)
   ORDER BY (ap.zone IS NULL) DESC, ap.effective_from DESC, ap.created_at DESC
   LIMIT 1;

  -- ⚠️ L'UNITÉ DOIT CONCORDER, ET ON NE CONVERTIT PAS.
  --    Un prix à la tonne multiplié par un volume en litres donne un chiffre
  --    d'affaires faux d'un facteur mille. Convertir supposerait la densité,
  --    qui dépend du produit et de la température.
  IF pub.uom::text <> NEW.uom::text THEN
    RAISE EXCEPTION
      'Le prix publié pour « % » est exprimé en %, et cette prévision est en %. Le chiffre d''affaires prévisionnel serait faux du rapport des deux unités. Alignez l''unité de la prévision sur celle de la publication, ou publiez le prix dans l''unité que vous budgétez.',
      COALESCE(produit, '?'), pub.uom::text, NEW.uom::text
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.reference_price := pub.price;
  NEW.currency_code   := pub.currency_code;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ⚠️ À LA CRÉATION SEULEMENT.
--
--    Les lignes antérieures à cette règle gardent le prix qui avait été saisi
--    et n'ont pas de publication déclarée : les soumettre au déclencheur les
--    rendrait immodifiables, y compris pour les sortir de version courante.
--    Une prévision étant historisée, toute évolution passe de toute façon par
--    une ligne NEUVE, donc par ce déclencheur.
DROP TRIGGER IF EXISTS trg_derive_prix_reference ON sales_forecasts;
CREATE TRIGGER trg_derive_prix_reference
  BEFORE INSERT ON sales_forecasts
  FOR EACH ROW EXECUTE FUNCTION derive_prix_reference();


-- ─── 35_fin_de_transition.sql ────────────────────────────────────

-- ===========================================================================
--  FIN DE LA TRANSITION : L'EXERCICE PORTE SES CONDITIONS, SEUL
--  Réf. SPECIFICATIONS.md § 5.4, § 14.2, § 14.3
--
--  CE QUI SE PASSAIT
--  -----------------
--  Trois valeurs vivaient à deux endroits : un réglage global d'illustration,
--  et la donnée réellement décidée, rattachée à l'exercice comptable.
--
--    · le taux de financement       10 % en réglage, 12 % à l'exercice
--    · la base de jours de portage  360 en réglage, 360 à l'exercice
--    · l'exercice courant           2026 en réglage, déclaré sur la table
--
--  Le repli global était explicitement posé « pour la transition », le temps
--  que l'exercice comptable existe. Il existe, il porte ses valeurs, et le
--  directeur financier a saisi 12 % au titre d'une lettre de crédit.
--
--  ⚠️ UN REPLI QUI SURVIT À SA TRANSITION DEVIENT UN PIÈGE.
--
--     Le calcul de marge lisait le réglage global et jamais l'exercice : il
--     employait 10 % là où l'entreprise paie 12 %. Le coût de portage était
--     sous-estimé d'un sixième, ce qui remonte dans la marge directe puis dans
--     le verdict du seuil — une affaire à refuser pouvait passer.
--
--     Tant que le repli existe, rien ne signale l'oubli : le calcul rend
--     toujours un nombre. C'est pour cela qu'on le RETIRE au lieu de le
--     corriger.
--
--  ⚠️ CE QUI SE PASSE MAINTENANT QUAND LA DONNÉE MANQUE.
--
--     Ces fonctions rendent NULL. Les vues de pilotage le prévoient déjà :
--     elles portent une colonne `calculable` et un `motif` qui nomme la donnée
--     absente. L'écran dit « taux de financement non renseigné » au lieu
--     d'afficher un chiffre que personne n'a décidé.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  L'exercice de référence se déclare sur la table des exercices.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION exercice_courant()
RETURNS uuid AS $$
  SELECT id FROM fiscal_years WHERE is_current LIMIT 1;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION exercice_courant() IS
  'Exercice de référence (§ 14.3). NULL si aucun n''est déclaré courant — et c''est alors à l''appelant de le dire, pas d''en inventer un. Le repli sur le réglage global CURRENT_FISCAL_YEAR a été retiré : il ne servait qu''à la transition.';

-- ---------------------------------------------------------------------------
--  Le taux de financement et la base de jours viennent de l'exercice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION taux_financement(p_fiscal_year_id uuid DEFAULT NULL)
RETURNS numeric AS $$
  SELECT fr.annual_rate_pct
    FROM financing_rates fr
   WHERE fr.fiscal_year_id = COALESCE(p_fiscal_year_id, exercice_courant())
     AND fr.is_current;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION taux_financement(uuid) IS
  'Taux de financement réel de l''exercice (§ 5.4). NULL tant qu''il n''est pas saisi : le coût de portage se tait plutôt que de tourner sur une valeur d''illustration.';

CREATE OR REPLACE FUNCTION jours_portage_an(p_fiscal_year_id uuid DEFAULT NULL)
RETURNS int AS $$
  SELECT fr.carrying_days_per_year
    FROM financing_rates fr
   WHERE fr.fiscal_year_id = COALESCE(p_fiscal_year_id, exercice_courant())
     AND fr.is_current;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION jours_portage_an(uuid) IS
  'Base annuelle du portage, telle que saisie avec le taux (§ 5.4). 360 en usage bancaire, 365 en exact/exact : les deux déplacent le coût de portage de 1,4 %, donc elle se décide et ne se devine pas.';


-- ===========================================================================
--  LE RECALCUL DES ASSIETTES SE FAIT UNE FOIS PAR TRANSACTION
--
--  CE QUI SE PASSAIT
--  -----------------
--  Le déclencheur de propagation était POUR CHAQUE LIGNE : insérer deux cents
--  prévisions relançait deux cents fois le parcours de tous les budgets de
--  pool de l'exercice, dont deux requêtes par pool à chaque tour.
--
--  Mesuré sur deux cents lignes et UN seul pool budgété :
--
--      avec recalcul par ligne   101,8 ms
--      sans recalcul              50,7 ms
--
--  Le coût est linéaire en lignes × pools. Avec quatre pools et un budget de
--  cent quatre-vingts lignes, on approche la seconde ; un import de deux mille
--  lignes avec dix pools se compte en minutes, et l'écran reste figé sans rien
--  dire. Or le résultat est le même : seule la DERNIÈRE passe compte.
--
--  ⚠️ POURQUOI UN DÉCLENCHEUR DE CONTRAINTE DIFFÉRÉ.
--
--     Un déclencheur d'instruction ne suffirait pas : l'import écrit ligne à
--     ligne, chaque ligne étant sa propre instruction. Il faut donc reporter
--     le recalcul à la FIN DE LA TRANSACTION, et n'en faire qu'un.
--
--     Le dédoublonnage passe par un réglage local à la transaction. Il
--     s'efface au COMMIT comme au ROLLBACK, donc rien ne fuit d'une
--     transaction à l'autre — y compris entre deux requêtes servies par la
--     même connexion du pool.
--
--  ⚠️ CE QUE CELA CHANGE POUR L'EXPLOITANT.
--
--     Un refus d'assiette — prévisions aux unités mêlées, assiette vidée —
--     remonte désormais à la VALIDATION et non à la ligne fautive. Le message
--     nomme le pool concerné ; il ne peut plus nommer la ligne. C'est le prix
--     du report, et il est modeste au regard d'un import qui se fige.
-- ===========================================================================
CREATE OR REPLACE FUNCTION propage_assiette_absorption()
RETURNS TRIGGER AS $$
DECLARE
  cible uuid;
BEGIN
  IF COALESCE(NEW.kind::text, OLD.kind::text) <> 'BUDGET' THEN
    RETURN NULL;
  END IF;

  cible := COALESCE(NEW.fiscal_year_id, OLD.fiscal_year_id);

  -- Déjà demandé dans cette transaction : le recalcul aura lieu une fois, à la
  -- fin. Le refaire ici donnerait exactement le même résultat.
  IF current_setting('erp.assiette_a_recalculer', true) IS NOT DISTINCT FROM cible::text THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('erp.assiette_a_recalculer', cible::text, true);
  PERFORM recalcule_taux_absorption(cible);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_propage_assiette ON sales_forecasts;

-- ⚠️ `DEFERRABLE INITIALLY DEFERRED` : le corps s'exécute au COMMIT.
--
--    Toutes les lignes de la transaction sont alors posées, et le premier
--    passage recalcule sur l'état FINAL. Les suivants sont écartés par le
--    réglage local ci-dessus.
CREATE CONSTRAINT TRIGGER trg_propage_assiette
  AFTER INSERT OR UPDATE OR DELETE ON sales_forecasts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION propage_assiette_absorption();


-- ─── 36_cloture_operation.sql ────────────────────────────────────

-- ===========================================================================
--  VERROU DE CLÔTURE : LE RAPPORT ET LE BON DE LIVRAISON AVANT LE STATUT
--  Réf. SPECIFICATIONS.md § 10, § 12.2 — discussion du 17/08
--
--  CE QUI SE PASSAIT
--  ------------------
--  `GeneratedDocumentKind.OPERATION_REPORT` et `DELIVERY_NOTE` existaient
--  dans le schéma, dans la liste blanche de lecture du terrain
--  (`NATURES_VISIBLES_DU_TERRAIN`) et dans les règles de scellement — mais
--  aucun code ne les produisait jamais, et rien n'empêchait une opération de
--  passer CLOSED sans qu'elles existent. Une opération pouvait donc se
--  clôturer sans qu'aucune trace signée de son exécution ni de sa livraison
--  ne soit jamais produite.
--
--  ⚠️ POURQUOI UN TRIGGER, ET NON UNE VÉRIFICATION APPLICATIVE SEULE.
--
--     Le même raisonnement que `enforce_hse_gate_before_loading` (§ 05) :
--     une vérification seulement côté API se contourne par n'importe quel
--     autre appelant (script de reprise, correction manuelle en base). Le
--     verrou de clôture protège une pièce OPPOSABLE — le client tient un
--     bon de livraison qui n'a de valeur que si l'opération qu'il documente
--     est réellement celle qui s'est terminée. Il doit tenir même contre le
--     code applicatif, pas seulement contre l'oubli.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

CREATE OR REPLACE FUNCTION enforce_closure_documents_sealed()
RETURNS TRIGGER AS $$
DECLARE
  rapport_scelle boolean;
  bon_livraison_scelle boolean;
BEGIN
  IF NEW.status::text <> 'CLOSED' THEN
    RETURN NEW;
  END IF;
  IF OLD.status::text = NEW.status::text THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM generated_documents
     WHERE operation_id = NEW.id
       AND kind::text = 'OPERATION_REPORT'
       AND is_sealed
  ) INTO rapport_scelle;

  IF NOT rapport_scelle THEN
    RAISE EXCEPTION
      'CLÔTURE REFUSÉE — l''opération % ne porte aucun rapport d''exécution scellé (signature de l''agent terrain manquante).',
      NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM generated_documents
     WHERE operation_id = NEW.id
       AND kind::text = 'DELIVERY_NOTE'
       AND is_sealed
  ) INTO bon_livraison_scelle;

  IF NOT bon_livraison_scelle THEN
    RAISE EXCEPTION
      'CLÔTURE REFUSÉE — l''opération % ne porte aucun bon de livraison scellé (signature de l''agent terrain et du représentant du client requises toutes les deux).',
      NEW.reference
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_closure_documents_sealed ON operations;
CREATE TRIGGER trg_closure_documents_sealed
  BEFORE UPDATE OF status ON operations
  FOR EACH ROW EXECUTE FUNCTION enforce_closure_documents_sealed();


-- ─── 22_file_de_taches.sql ───────────────────────────────────────

-- ===========================================================================
--  FILE DE TÂCHES — QUI ATTEND QUOI, ET DEPUIS QUAND
--  Réf. SPECIFICATIONS.md § 3, § 11
--
--  Le dirigeant l'avait reportée : « pas de file de tâches, on va gérer ça à
--  la fin ». C'est la fin.
--
--  LE PROBLÈME QU'ELLE RÈGLE
--  -------------------------
--  L'application est pleine de verrous et d'arbitrages : une affaire attend le
--  CFO, une checklist attend le contrôleur HSE, un prix fournisseur attend le
--  DG, une pièce de conformité expire dans trois semaines. Rien ne le DISAIT.
--  Chacun devait ouvrir son écran et chercher — et ce qu'on ne cherche pas, on
--  ne le trouve pas.
--
--  ⚠️ LES TÂCHES SONT DÉRIVÉES DE L'ÉTAT, JAMAIS STOCKÉES.
--
--     Une table de tâches avec son propre cycle de vie dérive : elle continue
--     d'annoncer « approuver DEAL-x » longtemps après que DEAL-x a été
--     approuvé, parce qu'un chemin d'écriture a oublié de la fermer. On finit
--     par ne plus la croire — et une file qu'on ne croit plus est pire que
--     pas de file du tout.
--
--     Ici, une tâche existe TANT QUE la condition qui la crée est vraie, et
--     disparaît d'elle-même dès qu'elle cesse de l'être. Il n'y a rien à
--     fermer, donc rien à oublier de fermer.
--
--     La contrepartie est assumée : on ne peut pas marquer une tâche « lue »,
--     ni la déléguer. Ces deux besoins, s'ils apparaissent, demanderont une
--     table — mais adossée à celle-ci, jamais à sa place.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

CREATE OR REPLACE VIEW v_taches AS

-- =========================================================================
--  ARBITRAGES ATTENDUS — quelqu'un est bloqué tant que personne ne tranche.
-- =========================================================================

-- 1. Affaire soumise, en attente du risque (CFO).
SELECT 'APPROBATION_CREDIT'::text                 AS categorie,
       'FINANCE_CFO'::text                        AS role_attendu,
       'BLOQUANT'::text                           AS urgence,
       d.reference                                AS objet,
       'Affaire en attente d''approbation — ' ||
         round(d.contracted_volume, 0) || ' ' || d.uom || ' à ' ||
         round(d.unit_sale_price, 2) || ' ' || d.currency_code AS libelle,
       'affaires/' || d.id::text                  AS lien,
       d.updated_at                               AS depuis
  FROM deals d
 WHERE d.status::text = 'PENDING_RISK'

UNION ALL
-- 2. Affaire sous le seuil de marge, en attente de l'accord du DG.
SELECT 'ACCORD_DG', 'DG', 'BLOQUANT',
       d.reference,
       'Marge sous le seuil — accord du DG requis',
       'affaires/' || d.id::text,
       d.updated_at
  FROM deals d
 WHERE d.status::text = 'PENDING_DG_APPROVAL'

UNION ALL
-- 3. Prix fournisseur saisi, non validé. Il n'est PAS opposable tant que le
--    DG ne l'a pas validé : toute affaire qui s'en sert est en suspens.
SELECT 'VALIDATION_PRIX', 'DG', 'BLOQUANT',
       p.legal_name || ' · ' || pr.code,
       'Prix fournisseur à valider — ' || round(sp.unit_price, 2) || ' ' ||
         sp.currency_code || '/' || sp.uom,
       'referentiels',
       sp.created_at
  FROM supplier_prices sp
  JOIN partners p ON p.id = sp.supplier_id
  JOIN products pr ON pr.id = sp.product_id
 WHERE sp.validated_by_id IS NULL
   AND (sp.effective_to IS NULL OR sp.effective_to >= CURRENT_DATE)

UNION ALL
-- 4. Checklist HSE entièrement renseignée, en attente de validation.
--    La définition est celle du périmètre terrain : un point encore en attente
--    signifie que la checklist attend l'AGENT, pas le contrôleur.
SELECT 'VALIDATION_HSE', 'HSE_CONTROLLER', 'BLOQUANT',
       o.reference || ' · ' || c.phase::text,
       'Checklist à valider — l''opération ne peut pas partir sans',
       'operations/' || o.id::text,
       c.created_at
  FROM operation_hse_checks c
  JOIN operations o ON o.id = c.operation_id
 WHERE c.validated_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM operation_hse_check_items i
      WHERE i.check_id = c.id AND i.outcome::text = 'PENDING'
   )

UNION ALL
-- 5. Exigences de site non levées sur une opération pas encore partie.
SELECT 'EXIGENCE_SITE', 'LOGISTICS_COORD', 'BLOQUANT',
       v.operation,
       'À lever avant le départ — ' || v.exigence ||
         ' (' || CASE v.bout WHEN 'LOADING' THEN 'chargement' ELSE 'livraison' END || ')',
       'operations/' || v.operation_id::text,
       o.updated_at
  FROM v_exigences_site v
  JOIN operations o ON o.id = v.operation_id
 WHERE v.is_blocking
   AND o.status::text IN ('DRAFT', 'SOURCING', 'HSE_PREPARATION', 'HSE_BLOCKED', 'PLANNED')
   AND NOT EXISTS (
     SELECT 1 FROM operation_site_requirement_acks a
      WHERE a.operation_id = v.operation_id AND a.requirement_id = v.exigence_id
   )

-- =========================================================================
--  ÉCHÉANCES — rien n'est bloqué aujourd'hui, tout le sera bientôt.
-- =========================================================================

UNION ALL
-- 6. Pièce de conformité qui expire. Le préavis est PARAMÉTRÉ : le raccourcir
--    ou l'allonger change ce que cette file annonce.
SELECT 'CONFORMITE_ECHEANCE', 'LOGISTICS_COORD',
       CASE WHEN cr.expiry_date < CURRENT_DATE THEN 'BLOQUANT' ELSE 'A_VENIR' END,
       COALESCE(p.legal_name, v.registration, dr.full_name) || ' · ' || cr.type::text,
       CASE WHEN cr.expiry_date < CURRENT_DATE
            THEN 'PÉRIMÉE le ' || to_char(cr.expiry_date, 'DD/MM/YYYY') ||
                 ' — le moyen n''est plus affectable'
            ELSE 'Expire le ' || to_char(cr.expiry_date, 'DD/MM/YYYY') ||
                 ' (' || (cr.expiry_date - CURRENT_DATE) || ' jours)' END,
       'conformite',
       cr.updated_at
  FROM compliance_records cr
  LEFT JOIN partners p  ON p.id = cr.partner_id
  LEFT JOIN vehicles v  ON v.id = cr.vehicle_id
  LEFT JOIN drivers  dr ON dr.id = cr.driver_id
 WHERE cr.is_blocking
   AND cr.expiry_date IS NOT NULL
   AND cr.expiry_date <= CURRENT_DATE + compliance_preavis_jours()
   AND compliance_statut_effectif(cr.status::text, cr.expiry_date) <> 'SUSPENDED'

UNION ALL
-- 7. Avance fournisseur non apurée — de la trésorerie immobilisée.
--
--    ⚠️ UNE AVANCE DATÉE DANS LE FUTUR N'IMMOBILISE RIEN ENCORE.
--
--       `days_outstanding` devient NÉGATIF quand la date de versement n'est pas
--       encore passée, et la file annonçait « immobilisés depuis -2 jours ».
--       Absurde à lire, et faux sur le fond : l'argent n'est pas sorti.
--
--       On ne corrige pas l'affichage en forçant le compte à zéro — ce serait
--       maquiller une avance à venir en avance dormante. On attend simplement
--       que le versement ait eu lieu.
SELECT 'AVANCE_NON_APUREE', 'FINANCE_CFO', 'A_VENIR',
       oa.reference,
       'Avance non apurée — ' || round(oa.outstanding_amount, 0) || ' ' || oa.currency_code ||
         ' immobilisés depuis ' || oa.days_outstanding || ' jours',
       'achats',
       oa.prepaid_at
  FROM v_outstanding_advances oa
 WHERE oa.days_outstanding >= 0

-- =========================================================================
--  ANOMALIES — ce qui est déjà passé et qu'il faut regarder.
-- =========================================================================

UNION ALL
-- 8. Violation d'invariant. Cette file DOIT rester vide.
SELECT 'INVARIANT', 'DG', 'ANOMALIE',
       b.enregistrement,
       b.regle || ' — ' || b.detail,
       'supervision',
       now()
  FROM v_invariant_breaches b

UNION ALL
-- 9. Saisies terrain refusées et JAMAIS REPRISES. L'agent l'a vu sur sa
--    tablette, mais sa file locale peut avoir disparu — et l'opération reste
--    en suspens.
--
--    ⚠️ DEUX PIÈGES, ET LE JOURNAL EST APPEND-ONLY : ON NE PEUT RIEN CORRIGER
--       APRÈS COUP, DONC LA VUE DOIT ÊTRE JUSTE DU PREMIER COUP.
--
--    a) L'EXTINCTION. « Un événement a été refusé » reste vrai POUR TOUJOURS :
--       le refus est gravé, rien ne l'efface. Sans condition de sortie, chaque
--       refus devenait une tâche perpétuelle et la file finissait par annoncer
--       des choses réglées depuis des semaines — précisément la dérive que
--       l'en-tête de ce fichier prétend éviter.
--
--       La sortie réelle n'est pas « quelqu'un a lu », c'est « l'agent a
--       renvoyé et ça a pris » : un événement ACCEPTÉ postérieur, même
--       opération, même agent, même type, et surtout MÊME SUJET. Sans le
--       sujet, un point de checklist accepté éteindrait le refus d'un AUTRE
--       point — on perdrait un signal réel, ce qui est pire que d'en garder un
--       mort.
--
--    b) LE REGROUPEMENT. Une ligne par événement noyait les blocages réels :
--       une tablette qui perd la main produit dix refus d'affilée, tous sur la
--       même opération, tous à traiter d'un seul geste. La tâche porte sur
--       L'OPÉRATION, pas sur l'événement.
SELECT 'REFUS_TERRAIN', 'LOGISTICS_COORD', 'ANOMALIE',
       o.reference,
       CASE WHEN count(*) = 1 THEN 'Saisie terrain refusée, non reprise — '
            ELSE count(*) || ' saisies terrain refusées, non reprises — ' END ||
         left((array_agg(e.rejection_reason ORDER BY e.received_at DESC))[1], 110),
       'operations/' || o.id::text,
       min(e.received_at)
  FROM field_sync_events e
  JOIN operations o ON o.id = e.operation_id
 WHERE e.status::text = 'REJECTED'
   AND o.status::text NOT IN ('CLOSED', 'CANCELLED')
   AND NOT EXISTS (
     SELECT 1
       FROM field_sync_events r
      WHERE r.operation_id  = e.operation_id
        AND r.field_user_id = e.field_user_id
        AND r.type          = e.type
        AND r.status::text  = 'ACCEPTED'
        AND r.received_at   > e.received_at
        -- Le sujet visé, dans l'ordre où les types l'adressent. Un type sans
        -- clé d'adressage (relevé, avancement) n'en vise qu'un par opération :
        -- la chaîne vide les fait correspondre entre eux, et à eux seuls.
        AND COALESCE(r.payload->>'checkItemId', r.payload->>'checkId',
                     r.payload->>'phase', '')
          = COALESCE(e.payload->>'checkItemId', e.payload->>'checkId',
                     e.payload->>'phase', '')
   )
 GROUP BY o.id, o.reference

UNION ALL
-- 10. Fret engagé hors tarif, sans transporteur ou sans motif.
SELECT 'FRET_HORS_TARIF', 'FINANCE_CFO', 'ANOMALIE',
       ft.operation,
       'Fret hors tarif — ' || round(ft.freight_cost, 0) || ' ' || ft.currency_code ||
         COALESCE(' contre ' || round(ft.tarif_attendu, 0) || ' négocié', ', sans tarif négocié'),
       'operations',
       now()
  FROM v_fret_hors_tarif ft

UNION ALL
-- 11. Client au-delà de son plafond de crédit.
SELECT 'CREDIT_DEPASSE', 'FINANCE_CFO', 'ANOMALIE',
       cd.partner_code,
       cd.partner_name || ' — engagé à ' || round(cd.engage, 0) ||
         ' pour un plafond de ' || round(cd.plafond, 0) || ' (' || cd.utilisation_pct || ' %)',
       'tiers',
       now()
  FROM v_credit_depasse cd

UNION ALL
-- 12. Dérogation exceptionnelle en attente de revue mensuelle.
SELECT 'REVUE_DEROGATION', 'DG', 'A_VENIR',
       COALESCE(d.subject_label, d.subject_id, left(d.id::text, 8)),
       'Dérogation à revoir — ' || d.type::text || ', accordée le ' ||
         to_char(d.granted_at, 'DD/MM/YYYY'),
       'derogations',
       d.granted_at
  FROM derogations d
 WHERE d.requires_monthly_review
   AND d.status::text = 'ACTIVE'
   AND (d.revoked_at IS NULL)
   AND (d.expires_at IS NULL OR d.expires_at > now())
   AND (d.reviewed_at IS NULL OR d.reviewed_at < now() - interval '1 month')

UNION ALL
-- 13. Opération en préparation qu'AUCUN modèle de checklist ne couvre.
--
--     Depuis que le verrou HSE refuse une validation sans point de contrôle,
--     une telle opération sera arrêtée au chargement. Autant le dire pendant
--     qu'on la prépare : découvrir au moment du départ qu'il manque un modèle,
--     c'est découvrir trop tard.
--
--     Un modèle ne s'applique qu'aux segments et modes de transport qu'il
--     déclare. Aujourd'hui un seul existe — B2B et RETAIL, par camion : toute
--     opération MARITIME tombe dans ce trou.
--
--     La tâche ne se déclenche QUE sur une opération réelle. Énumérer à
--     l'avance toutes les combinaisons segment × mode produirait une liste de
--     manques théoriques que personne n'a demandés.
SELECT 'MODELE_HSE_MANQUANT', 'HSE_CONTROLLER', 'BLOQUANT',
       o.reference,
       'Aucun modèle de checklist ne couvre ' || d.segment::text ||
         ' en ' || o.transport_mode::text || ' — l''opération sera bloquée au chargement',
       'referentiels',
       o.updated_at
  FROM operations o
  JOIN deals d ON d.id = o.deal_id
 WHERE o.status::text IN ('DRAFT', 'SOURCING', 'HSE_PREPARATION', 'HSE_BLOCKED', 'PLANNED')
   AND NOT EXISTS (
     SELECT 1
       FROM operation_hse_check_items i
       JOIN operation_hse_checks c ON c.id = i.check_id
      WHERE c.operation_id = o.id
   )
   AND NOT EXISTS (
     SELECT 1
       FROM hse_checklist_templates t
      WHERE t.is_active AND t.is_current
        AND (COALESCE(cardinality(t.applicable_segments), 0) = 0
             OR d.segment = ANY (t.applicable_segments))
        AND (COALESCE(cardinality(t.applicable_transport_modes), 0) = 0
             OR o.transport_mode = ANY (t.applicable_transport_modes))
   )

UNION ALL
-- 14. Aucun exercice comptable déclaré courant.
--
--     Tout le pilotage financier s'y rattache : taux de financement, budget de
--     charges fixes, prévision de volumes. Sans exercice, aucune de ces valeurs
--     n'a d'ancrage, et le point mort ne peut rien dire.
SELECT 'EXERCICE_MANQUANT', 'FINANCE_CFO', 'BLOQUANT',
       'Exercice comptable',
       'Aucun exercice n''est déclaré courant — le pilotage financier ne peut se rattacher à rien',
       'parametrage',
       now()
 WHERE exercice_courant() IS NULL

UNION ALL
-- 15. Exercice ouvert dont une donnée budgétaire manque.
--
--     Une par ligne manquante, pas une tâche fourre-tout : le CFO doit voir
--     LAQUELLE manque et à quoi elle sert, sinon il rouvre l'écran pour
--     chercher.
SELECT 'DONNEE_BUDGETAIRE', 'FINANCE_CFO', 'A_VENIR',
       'Exercice ' || c.exercice::text,
       c.donnee || ' non saisi — sert à : ' || c.sert_a,
       'parametrage',
       now()
  FROM v_couverture_budgetaire c
 WHERE NOT c.renseignee

UNION ALL
-- 16. Relances et actions commerciales échues (§ 15).
--
--     Adressées au CCOO plutôt qu'au commercial nommé : la file est filtrée par
--     RÔLE, pas par personne. Le responsable figure dans le libellé, ce qui
--     suffit à savoir qui relancer — et permet au CCOO de voir ce qui traîne
--     chez les siens, ce qui est précisément sa fonction.
SELECT 'RELANCE_CRM', 'CCOO',
       CASE WHEN a.retard_jours > 0 THEN 'BLOQUANT' ELSE 'A_VENIR' END,
       a.reference,
       a.objet || ' (' || a.responsable || ') — ' || a.action ||
         CASE WHEN a.retard_jours > 0
              THEN ', en retard de ' || a.retard_jours || ' jours'
              ELSE ', pour aujourd''hui' END,
       'crm',
       a.echeance::timestamptz
  FROM v_crm_alertes a
 WHERE a.nature IN ('RELANCE', 'ACTION_ETAPE')

UNION ALL
-- 17. Opportunité ouverte et jamais travaillée.
--
--     Distincte d'une relance en retard : c'est un dossier ouvert puis
--     abandonné, ou qui s'est essoufflé au-delà du délai paramétré sur son
--     étape. Personne ne l'a refusé — on l'a simplement oublié.
SELECT 'OPPORTUNITE_DORMANTE', 'CCOO', 'ANOMALIE',
       a.reference,
       a.objet || ' (' || a.responsable || ') — ' || a.action,
       'crm',
       a.echeance::timestamptz
  FROM v_crm_alertes a
 WHERE a.nature IN ('JAMAIS_CONTACTE', 'SANS_ACTIVITE')

UNION ALL
-- 18. Facture normalisée émise et jamais transmise à la DGI (§ 9.5).
--
--     ⚠️ LE DÉFAUT N'EST PAS L'ABSENCE DE TRANSMISSION, C'EST SON SILENCE.
--
--        L'accès à l'API DGI est une dépendance externe assumée par le § 9.5 —
--        elle doit être communiquée. En attendant, une FNE émise ouvre une
--        créance, porte un numéro de séquence fiscale, et reste indéfiniment en
--        attente SANS que rien ne le dise. L'audit en a trouvé quatre, dont une
--        déjà encaissée, invisibles de tout écran.
--
--        L'exposition grandit à chaque facture. Elle doit se voir.
SELECT 'FNE_NON_TRANSMISE', 'ACCOUNTANT',
       CASE WHEN now() - i.issued_at > interval '30 days' THEN 'BLOQUANT' ELSE 'A_VENIR' END,
       i.number,
       'Facture normalisée émise le ' || to_char(i.issued_at, 'DD/MM/YYYY') ||
         ' et non transmise à la DGI depuis ' ||
         extract(day FROM now() - i.issued_at)::int || ' jours',
       'facturation',
       i.issued_at
  FROM invoices i
  JOIN fne_transmissions t ON t.invoice_id = i.id
 WHERE i.type::text = 'FNE'
   AND i.issued_at IS NOT NULL
   AND t.status::text IN ('DRAFT', 'TO_VALIDATE', 'PENDING_TRANSMISSION', 'TO_CORRECT', 'REJECTED')

UNION ALL
-- 19. Affaire engagée dont tout n'a pas été facturé.
--
--     Dans le modèle d'Elyon, le volume commandé EST le volume livré et la facture
--     n'attend pas l'exécution. Une affaire en exécution ou close dont le cumul
--     facturé reste sous le contrat, c'est de la marchandise partie et non réclamée.
SELECT 'RESTE_A_FACTURER', 'ACCOUNTANT', 'A_VENIR',
       r.affaire,
       'Reste à facturer : ' || round(r.reste, 0) || ' ' || r.uom ||
         ' sur ' || round(r.contracte, 0) || ' contractés (' || r.client || ')',
       'facturation',
       now()
  FROM v_reste_a_facturer r
 WHERE r.a_facturer

UNION ALL
-- 20. Affaire facturée au-delà de son contrat.
--     Le verrou refuse désormais ce cas ; cette source couvre l'antérieur, qui ne
--     peut se régulariser que par un avoir ou une annulation explicite.
SELECT 'SUR_FACTURATION', 'FINANCE_CFO', 'ANOMALIE',
       r.affaire,
       'Facturé ' || round(r.deja_facture, 0) || ' ' || r.uom ||
         ' pour ' || round(r.contracte, 0) || ' contractés — à régulariser par avoir',
       'facturation',
       now()
  FROM v_reste_a_facturer r
 WHERE r.sur_facturee

UNION ALL
-- 21. Créance échue non encaissée (§ 13, module 6 — recouvrement).
--     Le statut OVERDUE existait dans l'énumération et n'était JAMAIS posé : une
--     facture échue restait ISSUED indéfiniment, et le recouvrement se faisait hors
--     de l'outil, ou pas du tout.
SELECT 'CREANCE_ECHUE', 'ACCOUNTANT',
       CASE WHEN c.retard_jours > 60 THEN 'BLOQUANT' ELSE 'ANOMALIE' END,
       c.piece,
       c.client || ' — ' || round(c.reste_du, 0) || ' ' || c.currency_code ||
         ' dus depuis ' || c.retard_jours || ' jours (' || c.tranche || ')',
       'facturation',
       (CURRENT_DATE - c.retard_jours)::timestamptz
  FROM v_creances_echues c
 WHERE c.retard_jours IS NOT NULL;

COMMENT ON VIEW v_taches IS
  'Ce que chacun doit traiter, DÉRIVÉ de l''état courant (§ 3). Une tâche existe tant que sa cause existe et disparaît d''elle-même : rien à fermer, donc rien à oublier de fermer.';


-- ---------------------------------------------------------------------------
--  Le décompte, pour la pastille du bandeau.
--
--  Une requête séparée et légère : l'écran l'appelle à chaque navigation, et
--  faire remonter la liste entière pour en compter les lignes coûterait cher
--  pour un chiffre.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_taches_par_role AS
SELECT role_attendu,
       count(*)                                        AS total,
       count(*) FILTER (WHERE urgence = 'BLOQUANT')    AS bloquantes,
       count(*) FILTER (WHERE urgence = 'ANOMALIE')    AS anomalies,
       count(*) FILTER (WHERE urgence = 'A_VENIR')     AS a_venir,
       min(depuis)                                     AS plus_ancienne
  FROM v_taches
 GROUP BY role_attendu;

COMMENT ON VIEW v_taches_par_role IS
  'Décompte des tâches par rôle attendu (§ 3). `plus_ancienne` dit depuis quand quelqu''un attend — c''est le chiffre qui compte, pas le total.';


-- ─── 23_parametres_obligatoires.sql ──────────────────────────────

-- ===========================================================================
--  PARAMÈTRES DONT LE CODE SQL DÉPEND
--  Réf. SPECIFICATIONS.md § 1.1 bis, § 11
--
--  LE PROBLÈME
--  -----------
--  « Aucune variable ou paramètre ne doit être codé en dur » a une conséquence
--  qu'on n'avait pas tirée : ce qui est paramétrable est SUPPRIMABLE. Les
--  seuils, préavis et bandes vivent dans `system_settings`, et l'écran
--  d'administration peut en retirer une ligne.
--
--  Or les verrous en base les lisent. Un paramètre absent ne fait pas échouer
--  le contrôle : il l'ÉTEINT. Vérifié en base, en transaction annulée :
--
--    DELETE de DOC_EXPIRY_ALERT_DAYS  → les 3 échéances de conformité
--                                       disparaissent de la file, dont un
--                                       contrôle technique PÉRIMÉ, bloquant.
--    DELETE de MARGIN_BAND_ALERT_PCT  → v_margin_band_watch passe de 2 lignes
--                                       à 0 : la surveillance des marges dit
--                                       « rien à signaler ».
--
--  Les deux fonctions fautives sont corrigées à la source (14 et 06) : le repli
--  est désormais hors du FROM, donc il s'applique vraiment. Mais un repli qui
--  fonctionne reste un pis-aller — il fait tourner le système sur une valeur
--  que PERSONNE n'a choisie, et rien ne le dit.
--
--  D'où cette vue : un paramètre requis mais absent devient une ANOMALIE
--  VISIBLE, pas un silence.
--
--  ⚠️ LA LISTE DES PARAMÈTRES REQUIS EST DÉRIVÉE DU CATALOGUE, PAS TENUE À LA
--     MAIN.
--
--     Une liste écrite ici aurait vieilli au premier paramètre ajouté : on
--     n'oublie pas d'ajouter la lecture, on oublie d'ajouter la déclaration.
--     On lit donc le corps réel des fonctions et des vues, et on en extrait les
--     clés qu'ils interrogent. Ajouter une lecture de `system_settings`
--     quelque part suffit à faire apparaître son paramètre ici — sans rien
--     déclarer.
--
--     Portée : le SQL seulement. Ce que l'API lit côté TypeScript n'est pas
--     visible du catalogue et relève de ses propres tests.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

CREATE OR REPLACE VIEW v_parametres_requis AS
WITH sources AS (
  -- Corps des fonctions métier.
  SELECT p.proname::text AS objet, 'fonction'::text AS nature, p.prosrc AS corps
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
  UNION ALL
  -- Définition des vues. `pg_class` plutôt que `pg_views` : sur cette dernière,
  -- le cast en regclass s'évalue avant le filtre de schéma et le catalogue
  -- système fait échouer la requête.
  SELECT c.relname::text, 'vue'::text, pg_get_viewdef(c.oid, true)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
),
refs AS (
  -- PostgreSQL réécrit les définitions de vues (`key::text = 'X'::text`) ;
  -- le motif accepte les deux formes.
  SELECT objet, nature,
         (regexp_matches(corps, 'key(?:::text)?\s*=\s*''([A-Z0-9_]+)''', 'g'))[1] AS cle
    FROM sources
   WHERE corps LIKE '%system_settings%'
)
-- ⚠️ `COLLATE "default"` N'EST PAS DÉCORATIF.
--
--    Toutes les colonnes texte du CATALOGUE système de PostgreSQL portent la
--    collation « C ». Elle se propage silencieusement à travers le regexp et
--    l'agrégat jusqu'ici — et la vue d'audit qui consomme ces colonnes hérite
--    alors d'une collation différente de ses autres branches. PostgreSQL
--    refuse le remplacement : « cannot change collation of view column ».
--
--    L'erreur ne se voit pas à l'écriture, seulement à la migration, et elle
--    porte sur une vue qu'on n'a pas touchée.
SELECT r.cle COLLATE "default"                      AS parametre,
       (s.key IS NOT NULL)                          AS present,
       s.value                                      AS valeur,
       count(DISTINCT r.objet)                      AS lu_par,
       (string_agg(DISTINCT r.nature || ' ' || r.objet, ', ' ORDER BY r.nature || ' ' || r.objet))
         COLLATE "default"                          AS objets
  FROM refs r
  LEFT JOIN system_settings s ON s.key = r.cle
 GROUP BY r.cle, s.key, s.value;

COMMENT ON VIEW v_parametres_requis IS
  'Paramètres que le SQL métier interroge, DÉRIVÉS du catalogue (§ 1.1 bis). `present` à false = un verrou tourne sur son repli, sans que personne l''ait décidé.';


-- ---------------------------------------------------------------------------
--  Vérification que le mécanisme voit encore quelque chose.
--
--  Si un jour cette vue ne rend AUCUNE ligne, ce n'est pas que plus rien ne
--  dépend d'un paramètre : c'est que le motif d'extraction ne reconnaît plus
--  l'écriture employée. Une garde qui ne garde plus rien doit se signaler.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_parametres_requis_sonde AS
SELECT count(*) AS parametres_detectes,
       count(*) FILTER (WHERE NOT present) AS absents
  FROM v_parametres_requis;

COMMENT ON VIEW v_parametres_requis_sonde IS
  'Sonde du mécanisme de dérivation : `parametres_detectes` à 0 signale un motif d''extraction devenu aveugle, pas une absence de dépendance.';


-- ─── 15_audit_complet.sql ────────────────────────────────────────

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

  -- Journal terrain (§ 10.2). Il conserve qu'un événement a été REFUSÉ : le
  -- droit de le réécrire suffirait à faire disparaître la trace d'une tentative
  -- hors des règles, et l'identifiant redeviendrait libre pour un renvoi.
  EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON field_sync_events FROM erp_app';
  EXECUTE 'GRANT SELECT, INSERT ON field_sync_events TO erp_app';

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
  EXECUTE 'GRANT SELECT ON v_performance_commerciale TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION performance_commerciale(date, date, text, date) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION periode_performance_defaut() TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION periode_bornes(text, date) TO erp_app';
  EXECUTE 'GRANT SELECT ON v_margin_variance TO erp_app';
  EXECUTE 'GRANT SELECT ON v_cost_reconciliation TO erp_app';
  EXECUTE 'GRANT SELECT ON v_compliance_expiry_watch TO erp_app';
  EXECUTE 'GRANT SELECT ON v_outstanding_advances TO erp_app';
  EXECUTE 'GRANT SELECT ON v_quotation_variance TO erp_app';
  EXECUTE 'GRANT SELECT ON v_invariant_breaches TO erp_app';
  EXECUTE 'GRANT SELECT ON v_parametres_requis TO erp_app';
  EXECUTE 'GRANT SELECT ON v_parametres_requis_sonde TO erp_app';
  EXECUTE 'GRANT SELECT ON v_couverture_budgetaire TO erp_app';
  EXECUTE 'GRANT SELECT ON v_marge_cout_variable TO erp_app';
  EXECUTE 'GRANT SELECT ON v_point_mort TO erp_app';
  EXECUTE 'GRANT SELECT ON v_bfr_exploitation TO erp_app';
  EXECUTE 'GRANT SELECT ON v_prevision_vente TO erp_app';
  EXECUTE 'GRANT SELECT ON v_prevision_en_vigueur TO erp_app';
  EXECUTE 'GRANT SELECT ON v_reste_a_facturer TO erp_app';
  EXECUTE 'GRANT SELECT ON v_rapprochement_encaissements TO erp_app';
  EXECUTE 'GRANT SELECT ON v_creances_echues TO erp_app';
  EXECUTE 'GRANT SELECT ON v_charges_fixes_exercice TO erp_app';
  EXECUTE 'GRANT SELECT ON v_absorption_reelle TO erp_app';
  EXECUTE 'GRANT SELECT ON v_crm_pipeline TO erp_app';
  EXECUTE 'GRANT SELECT ON v_crm_pipeline_par_etape TO erp_app';
  EXECUTE 'GRANT SELECT ON v_crm_alertes TO erp_app';
  EXECUTE 'GRANT SELECT ON v_crm_conversion TO erp_app';
  EXECUTE 'GRANT SELECT ON v_tableau_operationnel TO erp_app';
  EXECUTE 'GRANT SELECT ON v_tableau_operationnel_compte TO erp_app';
  -- L'historique des passages d'étape ne se RÉÉCRIT pas : c'est lui qui mesure
  -- la conversion. Il disparaît en revanche avec l'opportunité qu'il décrit —
  -- sans quoi une opportunité créée par erreur serait indestructible, et
  -- entrerait à jamais dans la valeur pondérée puis dans la prévision.
  EXECUTE 'REVOKE UPDATE, TRUNCATE ON crm_stage_transitions FROM erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION exercice_courant() TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION taux_financement(uuid) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION jours_portage_an(uuid) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION resolve_hse_checklist(uuid) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION resolve_fx_rate(char, char, date, text) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION resolve_administered_price(text, uuid, text, date) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION resolve_margin_threshold(text, uuid, char, text, date) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION resolve_ullage_tolerance(text, text, uuid, date) TO erp_app';

  -- --- Aucun DDL -----------------------------------------------------------
  EXECUTE 'REVOKE CREATE ON SCHEMA public FROM erp_app';

  -- --- Héritage pour les migrations futures --------------------------------
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO erp_app';

  RAISE NOTICE 'Privilèges erp_app appliqués.';
END
$grants$;
