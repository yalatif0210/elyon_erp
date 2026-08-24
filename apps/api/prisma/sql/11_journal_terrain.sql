-- ===========================================================================
--  JOURNAL D'ÉVÉNEMENTS TERRAIN
--  Réf. SPECIFICATIONS.md § 10.2
--
--  « La tablette ne détient pas une copie modifiable de l'opération qu'elle
--    renverrait au serveur — cette approche fabrique des conflits insolubles.
--    Elle produit un journal d'événements EN AJOUT SEUL. »
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Ajout seul, tenu par la base.
--
--  Le service d'ingestion ne réécrit jamais une ligne — mais « ne le fait
--  pas » n'est pas « ne peut pas le faire ». Un correctif pressé, une reprise
--  de données ou un script d'exploitation suffiraient à effacer la trace qu'un
--  événement a été refusé, c'est-à-dire exactement ce que ce journal existe
--  pour conserver.
--
--  Conséquence assumée, et documentée dans le service : un refus BRÛLE
--  l'identifiant de l'événement. Résoudre un rejet consiste à lever la cause
--  puis à produire un événement NEUF, pas à repousser le même.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_field_sync_events_no_update ON field_sync_events;
CREATE TRIGGER trg_field_sync_events_no_update
  BEFORE UPDATE ON field_sync_events
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();

DROP TRIGGER IF EXISTS trg_field_sync_events_no_delete ON field_sync_events;
CREATE TRIGGER trg_field_sync_events_no_delete
  BEFORE DELETE ON field_sync_events
  FOR EACH STATEMENT EXECUTE FUNCTION append_only_guard();

COMMENT ON TABLE field_sync_events IS
  'Journal d''événements terrain, en AJOUT SEUL (§ 10.2). L''identifiant est celui généré sur l''appareil : c''est lui qui rend la synchronisation idempotente.';


-- ---------------------------------------------------------------------------
--  Un événement accepté porte sa date d'application ; un refus porte son motif.
--
--  Sans ces deux contraintes, une acceptation sans date et un refus sans motif
--  passeraient : le premier rendrait impossible de dater ce qui a été appliqué,
--  le second renverrait à l'agent un « refusé » sans rien lui dire à faire.
-- ---------------------------------------------------------------------------
ALTER TABLE field_sync_events
  DROP CONSTRAINT IF EXISTS chk_field_event_coherence,
  ADD  CONSTRAINT chk_field_event_coherence CHECK (
    (status = 'ACCEPTED' AND applied_at IS NOT NULL AND rejection_reason IS NULL)
    OR
    (status = 'REJECTED' AND rejection_reason IS NOT NULL AND applied_at IS NULL)
    OR
    -- DEFERRED n'est jamais écrit : il n'a pas été jugé, donc rien à journaliser.
    -- La branche existe pour que l'ajout futur d'un état ne passe pas inaperçu.
    (status NOT IN ('ACCEPTED', 'REJECTED') AND applied_at IS NULL)
  );


-- ---------------------------------------------------------------------------
--  L'écart entre l'horloge de l'appareil et celle du serveur.
--
--  « L'horloge de l'appareil n'est pas fiable. Les deux horodatages sont
--    conservés — appareil et réception serveur. Un écart important est en soi
--    un signal d'audit. »
--
--  La vue ne fixe AUCUN seuil : c'est un paramètre, pas une constante. Elle
--  rend l'écart, à qui de droit d'en juger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_field_clock_drift AS
SELECT e.id                AS event_id,
       e.device_id,
       f.full_name         AS agent,
       o.reference         AS operation,
       e.type::text        AS event_type,
       e.device_timestamp,
       e.received_at,
       EXTRACT(EPOCH FROM (e.received_at - e.device_timestamp))::bigint AS drift_seconds
  FROM field_sync_events e
  JOIN field_users f ON f.id = e.field_user_id
  JOIN operations  o ON o.id = e.operation_id;

COMMENT ON VIEW v_field_clock_drift IS
  'Écart entre l''horloge de la tablette et la réception serveur (§ 10.2). Un écart important est un signal d''audit ; le seuil relève du paramétrage, pas de cette vue.';


-- ---------------------------------------------------------------------------
--  Refus en attente de résolution, par agent.
--
--  Une opération peut rester bloquée parce qu'un événement a été refusé et que
--  personne ne l'a vu : la tablette a pu être réinitialisée, l'agent avoir
--  changé d'appareil. La file locale disparaît ; les refus, non.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_field_rejections AS
SELECT e.id           AS event_id,
       o.reference    AS operation,
       o.phase::text  AS operation_phase,
       f.full_name    AS agent,
       f.email        AS agent_email,
       e.type::text   AS event_type,
       e.device_timestamp,
       e.received_at,
       e.rejection_reason
  FROM field_sync_events e
  JOIN field_users f ON f.id = e.field_user_id
  JOIN operations  o ON o.id = e.operation_id
 WHERE e.status = 'REJECTED'
 ORDER BY e.received_at DESC;

COMMENT ON VIEW v_field_rejections IS
  'Événements terrain refusés (§ 10.2). Le rejet redescend sur l''appareil, mais la file locale peut disparaître — cette vue est le filet.';
