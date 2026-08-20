-- ===========================================================================
--  SUPPLÉANCE DU CONTRÔLEUR HSE PAR DÉLÉGATION — § 3.4
--  Réf. SPECIFICATIONS.md § 3.4, § 11.4
--
--  CE QUI SE PASSAIT
--  ------------------
--  `DerogationType.HSE_DELEGATION` et le modèle `Delegation` existaient dans
--  le schéma, réservés au DG, avec leur propre registre — mais rien ne les
--  produisait, et le verrou de séparation des tâches
--  (`enforce_hse_separation_of_duties`, § 05) n'acceptait comme validateur
--  qu'un agent dont la colonne `field_users.role` valait littéralement
--  'HSE_CONTROLLER'. Une suppléance accordée au DG n'aurait donc jamais pu
--  produire d'effet : le suppléant reste, et doit rester, un agent terrain
--  dans sa fiche — seule la FENÊTRE de sa suppléance change.
--
--  LA RÈGLE
--  --------
--  Un validateur qui n'est pas contrôleur HSE de plein droit reste accepté
--  s'il détient une délégation ACTIVE de ce rôle au moment de l'écriture :
--  non révoquée, et dans sa fenêtre `starts_at`/`ends_at`. Même principe que
--  `derogation_opposable()` pour les trois autres verrous (§ 13) — la
--  vérification se fait EN BASE, au moment de l'écriture, jamais sur une
--  autorisation supposée à l'avance.
--
--  ⚠️ LE RÔLE DÉCLARÉ DE L'AGENT N'EST JAMAIS RÉÉCRIT.
--
--     La suppléance ne change ni la fiche de l'agent, ni son jeton de
--     session : un jeton qui baignerait dans un rôle élevé survivrait à la
--     révocation de la délégation jusqu'à sa propre expiration, ce qui est
--     exactement ce que `TokenService` interdit ailleurs (« un changement de
--     rôle passe par une révocation explicite, jamais par une élévation
--     silencieuse »). La fenêtre est donc revérifiée à CHAQUE écriture.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

CREATE OR REPLACE FUNCTION enforce_hse_separation_of_duties()
RETURNS TRIGGER AS $$
DECLARE
  recorder uuid;
  validator_role text;
  supplee boolean;
BEGIN
  IF NEW.validated_by_field_user_id IS NOT NULL THEN
    SELECT role::text INTO validator_role
      FROM field_users WHERE id = NEW.validated_by_field_user_id;

    IF validator_role IS DISTINCT FROM 'HSE_CONTROLLER' THEN
      SELECT EXISTS (
        SELECT 1 FROM delegations d
         WHERE d.delegate_field_user_id = NEW.validated_by_field_user_id
           AND d.delegated_role::text = 'HSE_CONTROLLER'
           AND d.revoked_at IS NULL
           AND d.starts_at <= now()
           AND d.ends_at >= now()
      ) INTO supplee;

      IF NOT supplee THEN
        RAISE EXCEPTION
          'VERROU HSE : la validation est réservée au contrôleur HSE, ou à son suppléant en cours de délégation. Rôle fourni : %.',
          COALESCE(validator_role, 'inconnu')
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- Séparation des tâches : celui qui a renseigné un point BLOQUANT ne peut
    -- pas être celui qui valide la checklist — suppléant ou non.
    SELECT i.recorded_by_field_user_id INTO recorder
      FROM operation_hse_check_items i
     WHERE i.check_id = NEW.id
       AND i.level::text = 'BLOCKING'
       AND i.recorded_by_field_user_id = NEW.validated_by_field_user_id
     LIMIT 1;

    IF recorder IS NOT NULL THEN
      RAISE EXCEPTION
        'VERROU HSE : l''agent qui a renseigné un contrôle bloquant ne peut pas valider la checklist.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Suppléance du bureau : seul le DG peut valider en l'absence du
  -- contrôleur (§ 3.4) — inchangé, ce verrou-ci ne passe pas par délégation.
  IF NEW.validated_by_user_id IS NOT NULL THEN
    SELECT role::text INTO validator_role FROM users WHERE id = NEW.validated_by_user_id;
    IF validator_role IS DISTINCT FROM 'DG' THEN
      RAISE EXCEPTION
        'VERROU HSE : la suppléance du contrôleur HSE est réservée au DG. Rôle fourni : %.',
        COALESCE(validator_role, 'inconnu')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Le trigger lui-même ne change pas : seule la fonction qu'il exécute est
-- remplacée. Pas de DROP/CREATE TRIGGER ici, il existe déjà (§ 05).
