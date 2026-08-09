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
