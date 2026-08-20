-- ===========================================================================
--  RÉGIME PHOTOGRAPHIQUE DES POINTS DE CONTRÔLE
--  Réf. SPECIFICATIONS.md § 7.1 bis
--
--  Décision de la direction, 6 août 2026 :
--
--    « Le branchement d'une prise de photo à un point de contrôle doit être
--      administrable. […] L'exigence doit mordre à l'enregistrement du point. »
--
--  ⚠️ CE QUI EXISTAIT AVANT ÉTAIT DÉCORATIF.
--
--     `requires_photo` était administrable, affiché à l'écran de paramétrage,
--     transporté jusqu'à la tablette — et vérifié NULLE PART. Un point marqué
--     « photo exigée » s'enregistrait sans photo. L'exploitant croyait tenir
--     un levier qui ne commandait rien, ce qui est pire qu'une valeur en dur :
--     une valeur en dur, au moins, on sait qu'elle ne se règle pas.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  REPRISE — le régime est déduit de l'ancien booléen.
--
--  Sans elle, tous les points existants retomberaient sur le défaut OPTIONAL,
--  y compris les quatre points « avant départ » dont la photo est la seule
--  preuve opposable : permis, EPI, extincteurs, kit anti-déversement.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  UPDATE hse_checklist_items
     SET photo_policy = 'REQUIRED'
   WHERE requires_photo IS TRUE
     AND photo_policy = 'OPTIONAL';

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'Reprise : % point(s) passés en photo EXIGÉE d''après l''ancien booléen.', n;
  END IF;
END $$;


-- ---------------------------------------------------------------------------
--  Les deux colonnes ne peuvent plus diverger.
--
--  `requires_photo` est encore lu par la tablette et par resolve_hse_checklist.
--  Le laisser se désynchroniser du régime ferait afficher « photo exigée » sur
--  un point devenu facultatif, ou l'inverse — et l'agent ne saurait plus lequel
--  des deux croire.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_photo_policy()
RETURNS TRIGGER AS $$
BEGIN
  -- Le régime fait foi. Le booléen n'en est que la projection.
  NEW.requires_photo := (NEW.photo_policy = 'REQUIRED');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_photo_policy ON hse_checklist_items;
CREATE TRIGGER trg_sync_photo_policy
  BEFORE INSERT OR UPDATE OF photo_policy, requires_photo ON hse_checklist_items
  FOR EACH ROW EXECUTE FUNCTION sync_photo_policy();

UPDATE hse_checklist_items SET photo_policy = photo_policy;  -- force la projection


-- ---------------------------------------------------------------------------
--  LE VERROU : un point à photo exigée ne s'enregistre pas sans pièce.
--
--  « L'exigence doit mordre à l'enregistrement du point. »
--
--  Tenu ICI et non dans l'application, comme tous les autres verrous : aucun
--  chemin d'écriture ne peut le contourner — ni la synchronisation terrain, ni
--  un import, ni un correctif appliqué à la main un soir de production.
--
--  Le contrôle ne se déclenche QUE lorsque le point quitte l'état « en
--  attente » : ouvrir une checklist crée ses points vides, et exiger une photo
--  à ce moment-là rendrait toute checklist impossible à ouvrir.
--
--  ⚠️ La photo doit donc être déposée AVANT que le point soit renseigné. C'est
--     l'ordre naturel sur le terrain — on photographie ce qu'on constate, puis
--     on conclut — et la file des photos étant distincte de celle des
--     événements, elle part sans attendre.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_check_item_requirements()
RETURNS TRIGGER AS $$
DECLARE
  it record;
BEGIN
  IF NEW.outcome::text = 'PENDING' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.outcome::text = NEW.outcome::text THEN
    RETURN NEW;
  END IF;

  SELECT photo_policy::text AS regime, requires_value, requires_signature, label
    INTO it
    FROM hse_checklist_items WHERE id = NEW.item_id;

  -- --- Photo ---------------------------------------------------------------
  IF it.regime = 'REQUIRED'
     AND NOT EXISTS (SELECT 1 FROM operation_attachments a
                      WHERE a.check_item_id = NEW.id AND a.kind::text = 'PHOTO') THEN
    RAISE EXCEPTION
      'PHOTO EXIGÉE : le point « % » ne peut pas être enregistré sans photo. Prenez le cliché, attendez qu''il soit reçu, puis enregistrez le point. Le contrôleur HSE valide à distance, sur pièces : sans photo, il n''a rien à examiner.',
      it.label
      USING ERRCODE = 'check_violation';
  END IF;

  -- --- Valeur relevée ------------------------------------------------------
  --
  -- ⚠️ `requires_value` n'était appliqué QUE dans l'écran de la tablette. Un
  --    événement produit hors ligne, un appel direct, ou une tablette d'une
  --    autre version passaient sans valeur. Les points concernés sont le
  --    jaugeage, les numéros de scellé et le volume livré : ce sont eux qui
  --    font foi en cas de litige, et ce sont eux qui partaient vides.
  IF it.requires_value
     AND (NEW.recorded_value IS NULL OR length(trim(NEW.recorded_value)) = 0) THEN
    RAISE EXCEPTION
      'VALEUR EXIGÉE : le point « % » attend un relevé (volume, température, numéro de scellé). Il ne peut pas être enregistré sans.',
      it.label
      USING ERRCODE = 'check_violation';
  END IF;

  -- --- Signature -----------------------------------------------------------
  --
  -- ⚠️ `requires_signature` n'était lu NULLE PART — ni par l'API, ni par la
  --    base, et la tablette ne le recevait même pas. Il est porté par le point
  --    « Bon de livraison signé par le client » : après un litige de
  --    livraison, ce point « satisfait » ne prouvait rien.
  IF it.requires_signature
     AND NOT EXISTS (SELECT 1 FROM operation_attachments a
                      WHERE a.check_item_id = NEW.id AND a.kind::text = 'SIGNATURE') THEN
    RAISE EXCEPTION
      'SIGNATURE EXIGÉE : le point « % » ne peut pas être enregistré sans la signature attendue. Faites signer, attendez que la signature soit reçue, puis enregistrez le point.',
      it.label
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_photo_requirement ON operation_hse_check_items;
DROP TRIGGER IF EXISTS trg_check_item_requirements ON operation_hse_check_items;
CREATE TRIGGER trg_check_item_requirements
  BEFORE INSERT OR UPDATE OF outcome ON operation_hse_check_items
  FOR EACH ROW EXECUTE FUNCTION enforce_check_item_requirements();

-- ---------------------------------------------------------------------------
--  DATE D'INSTALLATION DU VERROU — consignée ICI, une fois pour toutes.
--
--  L'audit permanent doit distinguer ce que le verrou POUVAIT empêcher de ce
--  qui lui est antérieur. Il lui faut donc une date.
--
--  ⚠️ NE PAS LA LIRE DANS `_prisma_migrations`. Je l'ai fait, et c'était une
--     faute : cette table est interne à Prisma et N'EXISTE PAS dans la base de
--     travail que `migrate diff` utilise pour calculer l'écart de schéma.
--     Conséquence — toute migration ULTÉRIEURE échouait, sur un message sans
--     rapport avec la modification en cours. Le SQL métier ne doit jamais
--     dépendre de la mécanique de migration.
--
--  `ON CONFLICT DO NOTHING` : la date est celle de la PREMIÈRE installation.
--  Le SQL étant rejoué à chaque migration, la réécrire ferait glisser la
--  frontière et rendrait l'antérieur invisible un peu plus à chaque fois.
-- ---------------------------------------------------------------------------
INSERT INTO system_settings (key, value, value_type, description, updated_at)
VALUES ('PROOF_LOCK_INSTALLED_AT', now()::text, 'string',
        'Date d''installation du verrou de preuve des contrôles HSE — photo, valeur relevée, signature (§ 7.1 bis). Sert à l''audit permanent pour distinguer ce que le verrou pouvait empêcher de ce qui lui est antérieur. NE PAS MODIFIER : la reculer ferait disparaître des anomalies réelles, l''avancer en ferait apparaître d''imaginaires.',
        now())
ON CONFLICT (key) DO NOTHING;

COMMENT ON COLUMN hse_checklist_items.photo_policy IS
  'Régime photographique (§ 7.1 bis) : FORBIDDEN interdit la prise de vue — zone ATEX, dépôt ou client qui la proscrit ; OPTIONAL la propose ; REQUIRED empêche l''enregistrement du point sans pièce jointe.';


-- ---------------------------------------------------------------------------
--  Vue de contrôle : les points exigeant une photo et n'en portant pas.
--
--  Le déclencheur empêche que cela se produise DÉSORMAIS. Cette vue existe
--  pour l'ANTÉRIEUR — les points enregistrés avant le verrou — et pour rendre
--  visible ce que la reprise ne peut pas réparer : on ne fabrique pas après
--  coup une photo qui n'a pas été prise.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_controles_sans_preuve AS
SELECT o.reference        AS operation,
       o.status::text     AS operation_status,
       c.phase::text      AS phase,
       i.code             AS point_code,
       i.label            AS point_label,
       ci.level::text     AS niveau,
       ci.outcome::text   AS resultat,
       ci.recorded_at,
       ci.created_at        AS inscrit_le,
       f.full_name        AS renseigne_par,
       trim(BOTH ', ' FROM
         CASE WHEN i.photo_policy = 'REQUIRED'
                   AND NOT EXISTS (SELECT 1 FROM operation_attachments a
                                    WHERE a.check_item_id = ci.id AND a.kind = 'PHOTO')
              THEN 'photo, ' ELSE '' END ||
         CASE WHEN i.requires_value
                   AND (ci.recorded_value IS NULL OR length(trim(ci.recorded_value)) = 0)
              THEN 'valeur, ' ELSE '' END ||
         CASE WHEN i.requires_signature
                   AND NOT EXISTS (SELECT 1 FROM operation_attachments a
                                    WHERE a.check_item_id = ci.id AND a.kind = 'SIGNATURE')
              THEN 'signature, ' ELSE '' END
       ) AS preuves_manquantes
  FROM operation_hse_check_items ci
  JOIN hse_checklist_items i ON i.id = ci.item_id
  JOIN operation_hse_checks c ON c.id = ci.check_id
  JOIN operations o ON o.id = c.operation_id
  LEFT JOIN field_users f ON f.id = ci.recorded_by_field_user_id
 WHERE ci.outcome::text <> 'PENDING'
   AND (
     (i.photo_policy = 'REQUIRED'
      AND NOT EXISTS (SELECT 1 FROM operation_attachments a
                       WHERE a.check_item_id = ci.id AND a.kind = 'PHOTO'))
     OR (i.requires_value
         AND (ci.recorded_value IS NULL OR length(trim(ci.recorded_value)) = 0))
     OR (i.requires_signature
         AND NOT EXISTS (SELECT 1 FROM operation_attachments a
                          WHERE a.check_item_id = ci.id AND a.kind = 'SIGNATURE'))
   );

COMMENT ON VIEW v_controles_sans_preuve IS
  'Points enregistrés sans la preuve que leur paramétrage exige — photo, valeur ou signature (§ 7.1 bis). Le déclencheur l''empêche désormais ; cette vue montre l''antérieur, qu''aucune reprise ne peut réparer : on ne fabrique pas après coup une signature qui n''a pas été donnée.';

DROP VIEW IF EXISTS v_controles_sans_photo;
