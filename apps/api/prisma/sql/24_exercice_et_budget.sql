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
