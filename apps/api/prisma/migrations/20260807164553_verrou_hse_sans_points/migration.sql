-- Migration sans changement de schéma Prisma : correctif SQL seul.
-- Le contenu utile est injecté ci-dessous depuis prisma/sql/.


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
       AND (cardinality(t.applicable_segments) = 0 OR c.segment = ANY (t.applicable_segments))
       AND (cardinality(t.applicable_transport_modes) = 0
            OR c.transport_mode = ANY (t.applicable_transport_modes))
       AND (cardinality(t.applicable_risk_levels) = 0
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
   AND (d.reviewed_at IS NULL OR d.reviewed_at < now() - interval '1 month');

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
  );

COMMENT ON VIEW v_invariant_breaches IS
  'Enregistrements passés au travers d''un invariant, ou antérieurs à lui (§ 11). Doit rester vide — toute ligne est une anomalie à traiter. COUVRE DIX RÈGLES : tout verrou ajouté sans clause ici ne protège que l''avenir.';


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
  EXECUTE 'GRANT SELECT ON v_margin_variance TO erp_app';
  EXECUTE 'GRANT SELECT ON v_cost_reconciliation TO erp_app';
  EXECUTE 'GRANT SELECT ON v_compliance_expiry_watch TO erp_app';
  EXECUTE 'GRANT SELECT ON v_outstanding_advances TO erp_app';
  EXECUTE 'GRANT SELECT ON v_quotation_variance TO erp_app';
  EXECUTE 'GRANT SELECT ON v_invariant_breaches TO erp_app';
  EXECUTE 'GRANT SELECT ON v_parametres_requis TO erp_app';
  EXECUTE 'GRANT SELECT ON v_parametres_requis_sonde TO erp_app';
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
