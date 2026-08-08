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
