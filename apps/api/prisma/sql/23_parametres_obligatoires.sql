-- ===========================================================================
--  PARAMÈTRES DONT LE CODE SQL DÉPEND
--  Réf. SPECIFICATIONS.md § 1.1 bis, § 11
--
--  LE PROBLÈME
--  -----------
--  « Aucune variable ou paramètre ne doit être codé en dur » a une conséquence
--  qu'on n'avait pas tirée : ce qui est paramétrable est SUPPRIMABLE. Les
--  seuils, préavis et bandes vivent dans `system_settings`, et l'écran
--  d'administration peut en retirer une ligne.
--
--  Or les verrous en base les lisent. Un paramètre absent ne fait pas échouer
--  le contrôle : il l'ÉTEINT. Vérifié en base, en transaction annulée :
--
--    DELETE de DOC_EXPIRY_ALERT_DAYS  → les 3 échéances de conformité
--                                       disparaissent de la file, dont un
--                                       contrôle technique PÉRIMÉ, bloquant.
--    DELETE de MARGIN_BAND_ALERT_PCT  → v_margin_band_watch passe de 2 lignes
--                                       à 0 : la surveillance des marges dit
--                                       « rien à signaler ».
--
--  Les deux fonctions fautives sont corrigées à la source (14 et 06) : le repli
--  est désormais hors du FROM, donc il s'applique vraiment. Mais un repli qui
--  fonctionne reste un pis-aller — il fait tourner le système sur une valeur
--  que PERSONNE n'a choisie, et rien ne le dit.
--
--  D'où cette vue : un paramètre requis mais absent devient une ANOMALIE
--  VISIBLE, pas un silence.
--
--  ⚠️ LA LISTE DES PARAMÈTRES REQUIS EST DÉRIVÉE DU CATALOGUE, PAS TENUE À LA
--     MAIN.
--
--     Une liste écrite ici aurait vieilli au premier paramètre ajouté : on
--     n'oublie pas d'ajouter la lecture, on oublie d'ajouter la déclaration.
--     On lit donc le corps réel des fonctions et des vues, et on en extrait les
--     clés qu'ils interrogent. Ajouter une lecture de `system_settings`
--     quelque part suffit à faire apparaître son paramètre ici — sans rien
--     déclarer.
--
--     Portée : le SQL seulement. Ce que l'API lit côté TypeScript n'est pas
--     visible du catalogue et relève de ses propres tests.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

CREATE OR REPLACE VIEW v_parametres_requis AS
WITH sources AS (
  -- Corps des fonctions métier.
  SELECT p.proname::text AS objet, 'fonction'::text AS nature, p.prosrc AS corps
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
  UNION ALL
  -- Définition des vues. `pg_class` plutôt que `pg_views` : sur cette dernière,
  -- le cast en regclass s'évalue avant le filtre de schéma et le catalogue
  -- système fait échouer la requête.
  SELECT c.relname::text, 'vue'::text, pg_get_viewdef(c.oid, true)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
),
refs AS (
  -- PostgreSQL réécrit les définitions de vues (`key::text = 'X'::text`) ;
  -- le motif accepte les deux formes.
  SELECT objet, nature,
         (regexp_matches(corps, 'key(?:::text)?\s*=\s*''([A-Z0-9_]+)''', 'g'))[1] AS cle
    FROM sources
   WHERE corps LIKE '%system_settings%'
)
-- ⚠️ `COLLATE "default"` N'EST PAS DÉCORATIF.
--
--    Toutes les colonnes texte du CATALOGUE système de PostgreSQL portent la
--    collation « C ». Elle se propage silencieusement à travers le regexp et
--    l'agrégat jusqu'ici — et la vue d'audit qui consomme ces colonnes hérite
--    alors d'une collation différente de ses autres branches. PostgreSQL
--    refuse le remplacement : « cannot change collation of view column ».
--
--    L'erreur ne se voit pas à l'écriture, seulement à la migration, et elle
--    porte sur une vue qu'on n'a pas touchée.
SELECT r.cle COLLATE "default"                      AS parametre,
       (s.key IS NOT NULL)                          AS present,
       s.value                                      AS valeur,
       count(DISTINCT r.objet)                      AS lu_par,
       (string_agg(DISTINCT r.nature || ' ' || r.objet, ', ' ORDER BY r.nature || ' ' || r.objet))
         COLLATE "default"                          AS objets
  FROM refs r
  LEFT JOIN system_settings s ON s.key = r.cle
 GROUP BY r.cle, s.key, s.value;

COMMENT ON VIEW v_parametres_requis IS
  'Paramètres que le SQL métier interroge, DÉRIVÉS du catalogue (§ 1.1 bis). `present` à false = un verrou tourne sur son repli, sans que personne l''ait décidé.';


-- ---------------------------------------------------------------------------
--  Vérification que le mécanisme voit encore quelque chose.
--
--  Si un jour cette vue ne rend AUCUNE ligne, ce n'est pas que plus rien ne
--  dépend d'un paramètre : c'est que le motif d'extraction ne reconnaît plus
--  l'écriture employée. Une garde qui ne garde plus rien doit se signaler.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_parametres_requis_sonde AS
SELECT count(*) AS parametres_detectes,
       count(*) FILTER (WHERE NOT present) AS absents
  FROM v_parametres_requis;

COMMENT ON VIEW v_parametres_requis_sonde IS
  'Sonde du mécanisme de dérivation : `parametres_detectes` à 0 signale un motif d''extraction devenu aveugle, pas une absence de dépendance.';
