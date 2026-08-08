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
