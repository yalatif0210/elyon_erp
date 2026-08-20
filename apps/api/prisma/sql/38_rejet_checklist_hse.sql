-- ===========================================================================
--  REJET D'UNE CHECKLIST HSE PAR LE CONTRÔLEUR, OU SON SUPPLÉANT
--
--  CE QUI MANQUAIT
--  ----------------
--  Le contrôleur HSE (ou le DG en suppléance) ne pouvait que VALIDER une
--  checklist entièrement renseignée — y compris quand un point bloquant
--  interdit en réalité de poursuivre l'opération en l'état. Renseigner un
--  point « Non conforme » ne le rejetait pas : la checklist restait en
--  attente, sans qu'aucun geste ne dise explicitement au demandeur ce qui ne
--  va pas et qu'il faut reprendre.
--
--  LA RÈGLE
--  --------
--  Le rejet est un geste DISTINCT de la validation, jamais son antichambre :
--  `rejected_at` se pose SANS jamais poser `validated_at`. Les points restent
--  modifiables par l'agent exactement comme avant toute validation — c'est
--  `validated_at`, pas `rejected_at`, qui ferme `recordItem()` côté service.
--  Un motif est exigé : un rejet sans raison renvoie l'agent chercher ce qui
--  ne va pas au lieu de le lui dire.
--
--  MÊME AUTORITÉ QUE LA VALIDATION, LES DEUX SENS DE LA SÉPARATION DES
--  TÂCHES COMPRIS : contrôleur HSE de plein droit ou suppléant en délégation
--  active pour `rejected_by_field_user_id`, DG seul pour `rejected_by_user_id`.
--  Refaire cette vérification ici plutôt que de la déléguer à l'existant :
--  c'est la même colonne de rôle, mais une AUTRE colonne d'écriture — le
--  trigger de validation (§ 37) ne se déclenche que sur `validated_by_*`.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

CREATE OR REPLACE FUNCTION enforce_hse_check_rejection()
RETURNS TRIGGER AS $$
DECLARE
  rejector_role text;
  supplee boolean;
BEGIN
  IF NEW.rejected_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.validated_at IS NOT NULL THEN
    RAISE EXCEPTION
      'Checklist déjà validée : elle ne se rejette plus. Ouvrir un événement HSE si un écart apparaît après validation.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.rejection_reason IS NULL OR length(trim(NEW.rejection_reason)) < 10 THEN
    RAISE EXCEPTION
      'Un rejet exige un motif circonstancié (dix caractères au moins) : ce que l''agent doit reprendre.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.rejected_by_field_user_id IS NOT NULL THEN
    SELECT role::text INTO rejector_role
      FROM field_users WHERE id = NEW.rejected_by_field_user_id;

    IF rejector_role IS DISTINCT FROM 'HSE_CONTROLLER' THEN
      SELECT EXISTS (
        SELECT 1 FROM delegations d
         WHERE d.delegate_field_user_id = NEW.rejected_by_field_user_id
           AND d.delegated_role::text = 'HSE_CONTROLLER'
           AND d.revoked_at IS NULL
           AND d.starts_at <= now()
           AND d.ends_at >= now()
      ) INTO supplee;

      IF NOT supplee THEN
        RAISE EXCEPTION
          'VERROU HSE : le rejet est réservé au contrôleur HSE, ou à son suppléant en cours de délégation. Rôle fourni : %.',
          COALESCE(rejector_role, 'inconnu')
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF NEW.rejected_by_user_id IS NOT NULL THEN
    SELECT role::text INTO rejector_role FROM users WHERE id = NEW.rejected_by_user_id;
    IF rejector_role IS DISTINCT FROM 'DG' THEN
      RAISE EXCEPTION
        'VERROU HSE : la suppléance du contrôleur HSE est réservée au DG. Rôle fourni : %.',
        COALESCE(rejector_role, 'inconnu')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hse_check_rejection ON operation_hse_checks;
CREATE TRIGGER trg_hse_check_rejection
  BEFORE UPDATE OF rejected_by_field_user_id, rejected_by_user_id, rejected_at, rejection_reason
  ON operation_hse_checks
  FOR EACH ROW EXECUTE FUNCTION enforce_hse_check_rejection();
