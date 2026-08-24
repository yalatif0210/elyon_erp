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
  IF NEW.phase::text = 'PREPARATION' THEN
    RETURN NEW;
  END IF;
  IF OLD.phase = NEW.phase THEN
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
  BEFORE UPDATE OF phase ON operations
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
