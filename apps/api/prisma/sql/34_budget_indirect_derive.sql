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
