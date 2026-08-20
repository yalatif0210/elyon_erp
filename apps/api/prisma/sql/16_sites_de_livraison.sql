-- ===========================================================================
--  SITES — CHARGEMENT ET LIVRAISON, PARTAGÉS ENTRE CLIENTS
--  Réf. SPECIFICATIONS.md § 6.2, § 10.3
--
--  Décision de la direction, 6 août 2026 :
--
--    « Une destination doit être rattachée à un tiers (client) même si
--      plusieurs tiers peuvent avoir la même destination de livraison — et
--      c'est courant. Généralement chaque site de livraison a ses exigences à
--      connaître pour mieux préparer une opération le concernant. »
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  REPRISE — chaque site de tiers existant devient un LIEU.
--
--  Aujourd'hui la correspondance est de un pour un : personne n'a encore pu
--  partager un site, puisque le modèle ne le permettait pas. On crée donc un
--  lieu par rattachement, et l'exploitant fusionnera ceux qui n'en font qu'un
--  — c'est un travail de référentiel, pas de migration : nous n'avons aucun
--  moyen fiable de décider que deux adresses saisies séparément désignent le
--  même quai.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  INSERT INTO sites (
    id, code, name, address_line, city, country_code, latitude, longitude,
    access_instructions, opening_hours, safety_instructions,
    default_hse_risk_level, is_active, created_at, updated_at)
  SELECT gen_random_uuid(),
         -- Le code du lieu ne peut pas être celui du client : deux clients
         -- emploient le même code pour des lieux différents. On le préfixe du
         -- tiers d'origine, l'exploitant renommera.
         left(p.code || '-' || ps.code, 32),
         ps.name, ps.address_line, ps.city, ps.country_code,
         ps.latitude, ps.longitude,
         ps.access_instructions, ps.opening_hours, ps.safety_instructions,
         ps.default_hse_risk_level, ps.is_active, ps.created_at, now()
    FROM partner_sites ps
    JOIN partners p ON p.id = ps.partner_id
   WHERE ps.site_id IS NULL
   ON CONFLICT (code) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Reprise : % lieu(x) de livraison créé(s).', n; END IF;

  UPDATE partner_sites ps
     SET site_id = ds.id
    FROM sites ds
    JOIN partners p ON true
   WHERE ps.site_id IS NULL
     AND p.id = ps.partner_id
     AND ds.code = left(p.code || '-' || ps.code, 32);

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Reprise : % rattachement(s) client → lieu.', n; END IF;

  -- Usage : tout ce qui existait ne servait qu'à LIVRER — le modèle ne
  -- connaissait pas le chargement. L'exploitant ajoutera LOADING sur les
  -- dépôts qui expédient aussi, et un lieu portera alors les deux.
  UPDATE sites SET usages = ARRAY['DELIVERY']::site_usage[]
   WHERE usages IS NULL OR cardinality(usages) = 0;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'Reprise : % site(s) marqué(s) « livraison ».', n; END IF;
END $$;

-- ---------------------------------------------------------------------------
--  Un site sert forcément à QUELQUE CHOSE.
--
--  Un lieu sans usage n'apparaît dans aucune liste de choix : il existe au
--  référentiel et reste introuvable à la saisie. Le refuser vaut mieux que de
--  laisser quelqu'un le créer et le chercher ensuite.
-- ---------------------------------------------------------------------------
ALTER TABLE sites
  DROP CONSTRAINT IF EXISTS chk_site_usages,
  ADD  CONSTRAINT chk_site_usages CHECK (cardinality(usages) > 0);


-- ---------------------------------------------------------------------------
--  Un même client ne se rattache qu'une fois à un même lieu.
--
--  Sans cette contrainte, deux rattachements du même client au même quai
--  produiraient deux désignations concurrentes sur les bons de livraison.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uq_partner_site_lieu;
CREATE UNIQUE INDEX uq_partner_site_lieu
  ON partner_sites (partner_id, site_id)
  WHERE site_id IS NOT NULL;


-- ---------------------------------------------------------------------------
--  NATURES D'EXIGENCE — amorce administrable.
--
--  Ce sont des valeurs de DÉPART, modifiables et extensibles depuis l'écran de
--  paramétrage. Elles couvrent ce qu'un dépôt pétrolier oppose couramment à un
--  transporteur en Côte d'Ivoire.
-- ---------------------------------------------------------------------------
INSERT INTO site_requirement_types
  (id, code, label, description, default_blocking, display_order, is_active, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'BADGE_ACCES', 'Badge d''accès nominatif',
   'Badge à retirer auprès du poste de garde, souvent la veille. Sans lui, le camion ne franchit pas la barrière.',
   true, 10, true, now(), now()),
  (gen_random_uuid(), 'CRENEAU', 'Créneau de livraison réservé',
   'Le site n''accepte que sur rendez-vous. Se présenter hors créneau, c''est repartir à vide.',
   true, 20, true, now(), now()),
  (gen_random_uuid(), 'PERMIS_TRAVAIL', 'Permis de travail',
   'Exigé pour toute intervention en zone classée. Délivré par le donneur d''ordre du site.',
   true, 30, true, now(), now()),
  (gen_random_uuid(), 'EPI_SPECIFIQUE', 'EPI spécifiques au site',
   'Équipements exigés au-delà de la dotation standard — détecteur de gaz, appareil respiratoire.',
   true, 40, true, now(), now()),
  (gen_random_uuid(), 'ATTELAGE', 'Attelage ou raccord particulier',
   'Type de raccord de dépotage imposé par les installations du site.',
   true, 50, true, now(), now()),
  (gen_random_uuid(), 'GABARIT', 'Limitation de gabarit ou de tonnage',
   'Longueur, hauteur ou charge à l''essieu maximales admises sur le site.',
   true, 60, true, now(), now()),
  (gen_random_uuid(), 'PHOTO_INTERDITE', 'Prise de vue interdite',
   'Zone classée ou clause contractuelle. À croiser avec le régime photographique des points de contrôle (§ 7.1 bis).',
   false, 70, true, now(), now()),
  (gen_random_uuid(), 'ACCUEIL_CHAUFFEUR', 'Accueil et consignes au chauffeur',
   'Séance d''accueil obligatoire à la première venue, ou périodiquement.',
   false, 80, true, now(), now()),
  (gen_random_uuid(), 'ESCORTE', 'Escorte obligatoire sur site',
   'Le véhicule ne circule pas seul dans l''enceinte.',
   false, 90, true, now(), now())
ON CONFLICT (code) DO NOTHING;


-- ---------------------------------------------------------------------------
--  Ce qu'il faut savoir avant d'envoyer quelqu'un — LA vue de préparation.
--
--  Elle sert au coordinateur qui crée l'opération ET à l'agent sur sa
--  tablette. Une seule vue pour les deux : deux listes finiraient par
--  diverger, et c'est l'agent qui en paierait le prix.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_exigences_site AS
-- ⚠️ LES DEUX BOUTS DU TRAJET.
--
--    Un badge d'accès se retire pour CHARGER comme pour livrer, et un dépôt
--    impose ses créneaux à qui vient prendre du produit. Ne regarder que la
--    destination laissait la moitié du trajet sans consignes.
WITH lieux AS (
  -- Destination : par le rattachement client, qui porte la désignation que le
  -- client reconnaît sur son bon de livraison.
  SELECT o.id AS operation_id, o.reference, 'DELIVERY'::text AS bout, ps.site_id
    FROM operations o
    JOIN partner_sites ps ON ps.id = o.destination_site_id
   WHERE ps.site_id IS NOT NULL
  UNION ALL
  -- Origine : le LIEU directement. Un dépôt de chargement n'appartient à
  -- aucune relation commerciale.
  SELECT o.id, o.reference, 'LOADING', o.origin_site_id
    FROM operations o
   WHERE o.origin_site_id IS NOT NULL
)
SELECT l.operation_id,
       l.reference         AS operation,
       l.bout,
       s.id                AS site_id,
       s.code              AS site_code,
       s.name              AS site_name,
       t.code              AS exigence_code,
       t.label             AS exigence,
       r.id                AS exigence_id,
       r.detail,
       r.is_blocking,
       t.display_order
  FROM lieux l
  JOIN sites s ON s.id = l.site_id
  JOIN site_requirements r ON r.site_id = s.id AND r.is_active
  JOIN site_requirement_types t ON t.id = r.type_id AND t.is_active;

COMMENT ON VIEW v_exigences_site IS
  'Exigences des sites d''une opération — CHARGEMENT et LIVRAISON (§ 6.2). Portées par le LIEU et non par le client : plusieurs clients exploitent le même site, et une consigne de sécurité recopiée est une consigne qui se périme d''un côté.';


-- ---------------------------------------------------------------------------
--  Les sites partagés — ce que le nouveau modèle permet enfin de voir.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_sites_partages AS
SELECT ds.code, ds.name, ds.city,
       count(DISTINCT ps.partner_id) AS nb_clients,
       string_agg(DISTINCT p.legal_name, ', ' ORDER BY p.legal_name) AS clients
  FROM sites ds
  JOIN partner_sites ps ON ps.site_id = ds.id
  JOIN partners p ON p.id = ps.partner_id
 GROUP BY ds.id, ds.code, ds.name, ds.city
HAVING count(DISTINCT ps.partner_id) > 1;

COMMENT ON VIEW v_sites_partages IS
  'Sites de livraison exploités par plusieurs clients. C''est le cas courant, et c''est précisément ce que l''ancien modèle — un site par client — obligeait à dupliquer.';


-- ---------------------------------------------------------------------------
--  UNE EXIGENCE BLOQUANTE DOIT ÊTRE LEVÉE AVANT QUE L'OPÉRATION AVANCE.
--
--  « Généralement chaque site de livraison a ses exigences à connaître pour
--    mieux préparer une opération le concernant. »
--
--  Afficher l'exigence ne suffit pas : une consigne lue n'est pas une consigne
--  suivie. Se présenter sans le badge d'accès ou hors du créneau réservé, c'est
--  un camion qui repart à vide — et le produit est déjà payé, avec son portage.
--
--  Le verrou joue AU CHARGEMENT et au-delà, pas plus tôt : une opération se
--  prépare, et exiger le badge au moment où on la crée empêcherait de la créer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_site_requirements()
RETURNS TRIGGER AS $$
DECLARE
  manquantes text;
BEGIN
  IF NEW.status::text NOT IN ('LOADING', 'IN_TRANSIT', 'DELIVERING', 'FINAL_CHECK', 'CLOSED') THEN
    RETURN NEW;
  END IF;
  IF OLD.status::text = NEW.status::text THEN
    RETURN NEW;
  END IF;

  -- Les DEUX bouts : le badge du dépôt de chargement compte autant que celui
  -- du site de livraison. La vue les réunit, le verrou n'en connaît qu'une.
  SELECT string_agg(
           CASE bout WHEN 'LOADING' THEN 'chargement' ELSE 'livraison' END
           || ' · ' || exigence || ' : ' || detail,
           ' · ' ORDER BY bout, display_order)
    INTO manquantes
    FROM v_exigences_site v
   WHERE v.operation_id = NEW.id
     AND v.is_blocking
     AND NOT EXISTS (
       SELECT 1 FROM operation_site_requirement_acks a
        WHERE a.operation_id = NEW.id AND a.requirement_id = v.exigence_id
     );

  IF manquantes IS NOT NULL AND manquantes <> '' THEN
    RAISE EXCEPTION
      'EXIGENCES DE SITE : l''opération % ne peut pas partir : %. Levez ces points et acquittez-les avant le chargement : s''y présenter sans eux, c''est repartir à vide avec un produit déjà payé.',
      NEW.reference, manquantes
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_site_requirements ON operations;
CREATE TRIGGER trg_site_requirements
  BEFORE UPDATE OF status ON operations
  FOR EACH ROW EXECUTE FUNCTION enforce_site_requirements();

COMMENT ON FUNCTION enforce_site_requirements IS
  'Refuse le départ d''une opération dont les exigences BLOQUANTES du site de livraison ne sont pas acquittées (§ 6.2).';
