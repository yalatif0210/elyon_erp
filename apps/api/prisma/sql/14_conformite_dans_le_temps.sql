-- ===========================================================================
--  LA CONFORMITÉ DOIT SUIVRE LE TEMPS
--  Réf. SPECIFICATIONS.md § 6.4, § 6.6
--
--  ⚠️ LE VERROU DE CONFORMITÉ ÉTAIT AVEUGLE AU TEMPS.
--
--     `derive_compliance_status()` est un déclencheur BEFORE INSERT/UPDATE :
--     le statut est figé À L'ÉCRITURE. `v_transport_compliance` — que le
--     verrou d'affectation interroge — lit le statut STOCKÉ. Et il n'existe
--     aucun ordonnanceur dans cette pile.
--
--     Conséquence démontrée : un permis de conduire expirant le 3 septembre
--     porte le statut EXPIRING. Le 4 septembre, il porte TOUJOURS EXPIRING,
--     `is_compliant` reste vrai, et le chauffeur reste affectable. Il faudrait
--     que quelqu'un réécrive la ligne pour que la base s'aperçoive de la date.
--
--     Autrement dit : le verrou du § 6.4 ne se refermait jamais tout seul.
--
--  LA CORRECTION
--  -------------
--  Le statut est CALCULÉ À LA LECTURE. Pas d'ordonnanceur — il n'y en a pas
--  ici, et en introduire un pour cela seul serait disproportionné et
--  fragile : une tâche qui ne tourne pas laisse le verrou ouvert sans que
--  personne ne le sache. Une vue, elle, est juste à chaque interrogation.
--
--  La colonne `status` est CONSERVÉE : elle sert d'index et d'affichage. Elle
--  reste une projection du dernier calcul ; c'est la vue qui fait foi.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  Le statut réel d'une pièce, à l'instant où on le demande.
--
--  Une SUSPENSION est une décision administrative explicite : elle survit au
--  calcul. Le reste se déduit de la date.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compliance_statut_effectif(
  p_status      text,
  p_expiry_date date
)
RETURNS text AS $$
DECLARE
  preavis int;
BEGIN
  IF p_status = 'SUSPENDED' THEN
    RETURN 'SUSPENDED';
  END IF;
  IF p_expiry_date IS NULL THEN
    RETURN 'VALID';
  END IF;
  IF p_expiry_date < CURRENT_DATE THEN
    RETURN 'EXPIRED';
  END IF;

  -- Le préavis est PARAMÉTRÉ (DOC_EXPIRY_ALERT_DAYS). Un agrément douanier et
  -- un permis de conduire ne se renouvellent pas dans les mêmes délais.
  SELECT COALESCE(NULLIF(value, '')::int, 60) INTO preavis
    FROM system_settings WHERE key = 'DOC_EXPIRY_ALERT_DAYS';
  preavis := COALESCE(preavis, 60);

  IF p_expiry_date <= CURRENT_DATE + preavis THEN
    RETURN 'EXPIRING';
  END IF;
  RETURN 'VALID';
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION compliance_statut_effectif IS
  'Statut RÉEL d''une pièce de conformité à l''instant de la lecture (§ 6.4). La colonne `status` n''est qu''une projection du dernier calcul : elle ne se met pas à jour toute seule quand la date passe.';


-- ---------------------------------------------------------------------------
--  LA VUE DU VERROU EST CORRIGÉE À LA SOURCE, dans 03_views_and_functions.sql.
--
--  Elle n'est PAS recopiée ici : recopier une vue de cinquante lignes pour en
--  changer trois, c'est en garantir la divergence — et on s'y est déjà repris
--  à deux fois sur les colonnes exactes. Ce fichier ne porte que ce qui est
--  NEUF ; le correctif vit là où vit la vue.
--
--  ⚠️ CE FICHIER EST DONC INJECTÉ AVANT 03 : la fonction ci-dessus doit
--     exister quand la vue l'invoque.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
--  Pièces dont le statut STOCKÉ ment sur la réalité.
--
--  Aucune tâche ne les rafraîchit — et c'est un choix. Cette vue rend l'écart
--  visible : elle doit rester à zéro sur un système qui écrit régulièrement,
--  et une ligne qui s'y installe signale une pièce que plus personne ne touche.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_conformite_statut_perime AS
SELECT r.id,
       r.reference,
       r.type::text                                          AS nature,
       r.expiry_date,
       r.status::text                                        AS statut_stocke,
       compliance_statut_effectif(r.status::text, r.expiry_date) AS statut_reel,
       r.is_blocking,
       COALESCE(p.legal_name, v.registration, d.full_name)    AS porteur
  FROM compliance_records r
  LEFT JOIN partners p ON p.id = r.partner_id
  LEFT JOIN vehicles v ON v.id = r.vehicle_id
  LEFT JOIN drivers  d ON d.id = r.driver_id
 WHERE r.status::text IS DISTINCT FROM compliance_statut_effectif(r.status::text, r.expiry_date);

COMMENT ON VIEW v_conformite_statut_perime IS
  'Pièces dont la colonne `status` ne dit plus la vérité (§ 6.6). Sans conséquence sur le verrou — il lit le statut effectif — mais un écran qui affiche la colonne induit en erreur.';


-- ---------------------------------------------------------------------------
--  Le préavis d'alerte : une seule valeur, celle qui est paramétrée.
--
--  Trois seuils indépendants coexistaient pour un même paramètre : 60 jours en
--  base, 90 jours codés en dur dans deux écrans, et un troisième à 30 jours
--  pour la teinte d'affichage. Le coordinateur qui ramène le préavis à 30
--  jours ne voyait rien bouger.
--
--  La fonction ci-dessous rend LA valeur ; les écrans doivent la lire au lieu
--  d'en porter une.
-- ---------------------------------------------------------------------------
--  ⚠️ LE REPLI DOIT ÊTRE HORS DU `FROM`, PAS DEDANS.
--
--     `SELECT COALESCE(…, 60) FROM system_settings WHERE key = '…'` ne protège
--     que d'une valeur VIDE. Si la LIGNE est absente, la requête ne rend aucune
--     ligne, la fonction rend NULL, et le repli de 60 jours ne s'applique
--     jamais. Or ce paramètre est administrable : il est supprimable depuis
--     l'écran.
--
--     Constaté en base : paramètre supprimé → `compliance_preavis_jours()` rend
--     NULL → `expiry_date <= CURRENT_DATE + NULL` est NULL → les trois échéances
--     de conformité disparaissent de la file de tâches, dont un contrôle
--     technique PÉRIMÉ qui est bloquant. Le contrôle s'éteint en silence, et
--     c'est la pire façon de s'éteindre.
--
--     Un sous-select scalaire rend NULL quand la ligne manque — et là, le
--     COALESCE fait son travail.
CREATE OR REPLACE FUNCTION compliance_preavis_jours()
RETURNS int AS $$
  SELECT COALESCE(
    (SELECT NULLIF(value, '')::int FROM system_settings WHERE key = 'DOC_EXPIRY_ALERT_DAYS'),
    60
  );
$$ LANGUAGE sql STABLE;
