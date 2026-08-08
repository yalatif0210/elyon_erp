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

-- Les charges fixes sont un ENSEMBLE de postes : plusieurs lignes courantes
-- coexistent légitimement. On garantit seulement l'unicité du libellé, pour
-- qu'un même poste ne soit pas budgété deux fois.
--
-- ⚠️ DEUX INDEX PARTIELS, ET NON UN SEUL SUR `COALESCE(segment::text, '')`.
--
--    La conversion d'un type énuméré en texte est STABLE, pas IMMUTABLE :
--    l'ordre des valeurs peut changer si l'énumération évolue. PostgreSQL
--    refuse donc de l'employer dans une expression d'index. Les deux index
--    séparés disent la même chose et sont immuables — le NULL de `segment`
--    signifiant « entreprise entière », il forme sa propre classe d'unicité.
DROP INDEX IF EXISTS uniq_fixed_cost_courant;
DROP INDEX IF EXISTS uniq_fixed_cost_courant_segment;
DROP INDEX IF EXISTS uniq_fixed_cost_courant_entreprise;

CREATE UNIQUE INDEX uniq_fixed_cost_courant_segment
  ON fixed_cost_budgets (fiscal_year_id, label, segment)
  WHERE is_current AND segment IS NOT NULL;

CREATE UNIQUE INDEX uniq_fixed_cost_courant_entreprise
  ON fixed_cost_budgets (fiscal_year_id, label)
  WHERE is_current AND segment IS NULL;

-- ---------------------------------------------------------------------------
--  4. Bornes de saisie.
-- ---------------------------------------------------------------------------
ALTER TABLE sales_forecasts DROP CONSTRAINT IF EXISTS chk_forecast_mois;
ALTER TABLE sales_forecasts ADD CONSTRAINT chk_forecast_mois
  CHECK (month_index BETWEEN 1 AND 12);

ALTER TABLE sales_forecasts DROP CONSTRAINT IF EXISTS chk_forecast_positif;
ALTER TABLE sales_forecasts ADD CONSTRAINT chk_forecast_positif
  CHECK (forecast_volume >= 0 AND reference_price >= 0);

ALTER TABLE fixed_cost_budgets DROP CONSTRAINT IF EXISTS chk_fixed_cost_positif;
ALTER TABLE fixed_cost_budgets ADD CONSTRAINT chk_fixed_cost_positif
  CHECK (annual_amount >= 0);

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

DROP TRIGGER IF EXISTS trg_fixed_cost_exercice_clos ON fixed_cost_budgets;
CREATE TRIGGER trg_fixed_cost_exercice_clos
  BEFORE INSERT OR UPDATE ON fixed_cost_budgets
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

UNION ALL
SELECT ex.year, ex.label, ex.statut,
       'Budget de charges fixes',
       EXISTS (SELECT 1 FROM fixed_cost_budgets b
                WHERE b.fiscal_year_id = ex.id AND b.is_current),
       'Point mort (§ 14.5)'
  FROM ex

UNION ALL
SELECT ex.year, ex.label, ex.statut,
       'Prévision de volumes',
       EXISTS (SELECT 1 FROM sales_forecasts s
                WHERE s.fiscal_year_id = ex.id AND s.is_current),
       'Assiette d''absorption (§ 14.2), plan d''approvisionnement et de trésorerie (§ 14.3)'
  FROM ex

UNION ALL
SELECT ex.year, ex.label, ex.statut,
       'Taux d''absorption',
       EXISTS (SELECT 1 FROM absorption_rates a
                WHERE a.fiscal_year = ex.year AND a.is_current),
       'Coût complet et seuil de marge (§ 14.2)'
  FROM ex;

COMMENT ON VIEW v_couverture_budgetaire IS
  'Ce que le CFO doit saisir pour que le pilotage soit calculable, exercice par exercice (§ 19). `renseignee` à false = la donnée manque, et le calcul qui en dépend doit se taire plutôt que deviner.';
