-- ===========================================================================
--  RECETTE — TYPES D'OPÉRATION ET RÉSOLUTION DES CONTRÔLES HSE
--
--  Exécution : psql -f test_types_operation.sql
--  Tout se déroule dans une transaction ANNULÉE en fin de fichier : la base
--  ressort inchangée.
-- ===========================================================================
BEGIN;

\set ON_ERROR_STOP on

DO $$
DECLARE
  op_id     uuid;
  op_ref    text;
  t_soutage uuid;
  ot_soutage uuid;
  nb_total  int;
  nb_avant  int;
  niveau    text;
  origines  text;
  refuse    boolean := false;
BEGIN
  SELECT o.id, o.reference INTO op_id, op_ref
    FROM operations o
    JOIN operation_type_assignments a ON a.operation_id = o.id
    JOIN operation_types ot ON ot.id = a.operation_type_id AND ot.code = 'ROUTE'
   LIMIT 1;
  IF op_id IS NULL THEN
    RAISE EXCEPTION 'Aucune opération routière : recette impossible.';
  END IF;

  SELECT count(*) INTO nb_avant FROM resolve_hse_checklist(op_id);

  -- =======================================================================
  --  1. Un second type ADDITIONNE ses contrôles.
  -- =======================================================================
  SELECT id INTO ot_soutage FROM operation_types WHERE code = 'SOUTAGE';

  INSERT INTO hse_checklist_templates
         (id, code, label, applicable_segments, applicable_transport_modes,
          applicable_risk_levels, version, is_current, is_active, updated_at)
  VALUES (gen_random_uuid(), 'RECETTE_SOUTAGE', 'Recette — soutage',
          '{}', '{}', '{}', 1, true, true, now())
  RETURNING id INTO t_soutage;

  INSERT INTO "_ChecklistOperationTypes" ("A", "B") VALUES (t_soutage, ot_soutage);

  INSERT INTO hse_checklist_items
         (id, template_id, code, label, phase, level, display_order, is_active, updated_at)
  VALUES
    -- Point PROPRE au soutage : il doit s'ajouter.
    (gen_random_uuid(), t_soutage, 'SOUT_PASSERELLE', 'Passerelle d''accès sécurisée',
     'PRE_CHARGEMENT', 'BLOCKING', 5, true, now()),
    -- Point COMMUN avec la checklist routière, en niveau MOINS contraignant :
    -- il ne doit ni doubler, ni affaiblir le niveau retenu.
    (gen_random_uuid(), t_soutage, 'HSE_EPI', 'EPI complets portés par l''équipe',
     'PRE_CHARGEMENT', 'MANDATORY', 11, true, now());

  INSERT INTO operation_type_assignments (id, operation_id, operation_type_id, sequence)
  VALUES (gen_random_uuid(), op_id, ot_soutage, 2);

  SELECT count(*) INTO nb_total FROM resolve_hse_checklist(op_id);

  IF nb_total <> nb_avant + 1 THEN
    RAISE EXCEPTION
      'ÉCHEC 1 — un second type devait ajouter 1 contrôle (% attendu), % obtenu.',
      nb_avant + 1, nb_total;
  END IF;
  RAISE NOTICE 'OK 1 — second type : % contrôles, soit +1 point propre.', nb_total;

  -- =======================================================================
  --  2. Le point COMMUN n'apparaît qu'UNE fois.
  -- =======================================================================
  SELECT count(*) INTO nb_total
    FROM resolve_hse_checklist(op_id) WHERE item_code = 'HSE_EPI';
  IF nb_total <> 1 THEN
    RAISE EXCEPTION
      'ÉCHEC 2 — le point commun apparaît % fois. L''agent le ferait une fois et le doublon resterait en attente, bloquant l''opération.',
      nb_total;
  END IF;
  RAISE NOTICE 'OK 2 — point commun dédoublonné.';

  -- =======================================================================
  --  3. Le niveau LE PLUS CONTRAIGNANT l'emporte.
  --     Ajouter un type ne doit jamais AFFAIBLIR un contrôle.
  -- =======================================================================
  SELECT level, from_types INTO niveau, origines
    FROM resolve_hse_checklist(op_id) WHERE item_code = 'HSE_EPI';
  IF niveau <> 'BLOCKING' THEN
    RAISE EXCEPTION
      'ÉCHEC 3 — niveau retenu « % » : ajouter un type a AFFAIBLI le contrôle.',
      niveau;
  END IF;
  RAISE NOTICE 'OK 3 — niveau le plus contraignant retenu (BLOCKING), origines : %.', origines;

  -- =======================================================================
  --  4. Une opération sans type ne peut pas avancer.
  -- =======================================================================
  DELETE FROM operation_type_assignments WHERE operation_id = op_id;
  BEGIN
    -- L'étape suivante IMMÉDIATE — pas n'importe laquelle : l'ordre strict
    -- (§ 22/08/2026) refuserait aussi un saut, ce qui ne testerait plus le
    -- verrou de type mais un tout autre verrou.
    UPDATE operations o SET phase = (enum_range(NULL::operation_phase))[
      array_position(enum_range(NULL::operation_phase), o.phase) + 1
    ] WHERE o.id = op_id;
  EXCEPTION WHEN check_violation THEN
    refuse := true;
  END;
  IF NOT refuse THEN
    RAISE EXCEPTION
      'ÉCHEC 4 — une opération sans type a pu avancer : le verrou HSE serait vide de contenu et laisserait tout passer.';
  END IF;
  RAISE NOTICE 'OK 4 — avancement refusé sans type.';

  RAISE NOTICE '--- 4/4 sur % ---', op_ref;
END $$;

ROLLBACK;
