-- ===========================================================================
--  FIN DE LA TRANSITION : L'EXERCICE PORTE SES CONDITIONS, SEUL
--  Réf. SPECIFICATIONS.md § 5.4, § 14.2, § 14.3
--
--  CE QUI SE PASSAIT
--  -----------------
--  Trois valeurs vivaient à deux endroits : un réglage global d'illustration,
--  et la donnée réellement décidée, rattachée à l'exercice comptable.
--
--    · le taux de financement       10 % en réglage, 12 % à l'exercice
--    · la base de jours de portage  360 en réglage, 360 à l'exercice
--    · l'exercice courant           2026 en réglage, déclaré sur la table
--
--  Le repli global était explicitement posé « pour la transition », le temps
--  que l'exercice comptable existe. Il existe, il porte ses valeurs, et le
--  directeur financier a saisi 12 % au titre d'une lettre de crédit.
--
--  ⚠️ UN REPLI QUI SURVIT À SA TRANSITION DEVIENT UN PIÈGE.
--
--     Le calcul de marge lisait le réglage global et jamais l'exercice : il
--     employait 10 % là où l'entreprise paie 12 %. Le coût de portage était
--     sous-estimé d'un sixième, ce qui remonte dans la marge directe puis dans
--     le verdict du seuil — une affaire à refuser pouvait passer.
--
--     Tant que le repli existe, rien ne signale l'oubli : le calcul rend
--     toujours un nombre. C'est pour cela qu'on le RETIRE au lieu de le
--     corriger.
--
--  ⚠️ CE QUI SE PASSE MAINTENANT QUAND LA DONNÉE MANQUE.
--
--     Ces fonctions rendent NULL. Les vues de pilotage le prévoient déjà :
--     elles portent une colonne `calculable` et un `motif` qui nomme la donnée
--     absente. L'écran dit « taux de financement non renseigné » au lieu
--     d'afficher un chiffre que personne n'a décidé.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
--  L'exercice de référence se déclare sur la table des exercices.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION exercice_courant()
RETURNS uuid AS $$
  SELECT id FROM fiscal_years WHERE is_current LIMIT 1;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION exercice_courant() IS
  'Exercice de référence (§ 14.3). NULL si aucun n''est déclaré courant — et c''est alors à l''appelant de le dire, pas d''en inventer un. Le repli sur le réglage global CURRENT_FISCAL_YEAR a été retiré : il ne servait qu''à la transition.';

-- ---------------------------------------------------------------------------
--  Le taux de financement et la base de jours viennent de l'exercice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION taux_financement(p_fiscal_year_id uuid DEFAULT NULL)
RETURNS numeric AS $$
  SELECT fr.annual_rate_pct
    FROM financing_rates fr
   WHERE fr.fiscal_year_id = COALESCE(p_fiscal_year_id, exercice_courant())
     AND fr.is_current;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION taux_financement(uuid) IS
  'Taux de financement réel de l''exercice (§ 5.4). NULL tant qu''il n''est pas saisi : le coût de portage se tait plutôt que de tourner sur une valeur d''illustration.';

CREATE OR REPLACE FUNCTION jours_portage_an(p_fiscal_year_id uuid DEFAULT NULL)
RETURNS int AS $$
  SELECT fr.carrying_days_per_year
    FROM financing_rates fr
   WHERE fr.fiscal_year_id = COALESCE(p_fiscal_year_id, exercice_courant())
     AND fr.is_current;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION jours_portage_an(uuid) IS
  'Base annuelle du portage, telle que saisie avec le taux (§ 5.4). 360 en usage bancaire, 365 en exact/exact : les deux déplacent le coût de portage de 1,4 %, donc elle se décide et ne se devine pas.';


-- ===========================================================================
--  LE RECALCUL DES ASSIETTES SE FAIT UNE FOIS PAR TRANSACTION
--
--  CE QUI SE PASSAIT
--  -----------------
--  Le déclencheur de propagation était POUR CHAQUE LIGNE : insérer deux cents
--  prévisions relançait deux cents fois le parcours de tous les budgets de
--  pool de l'exercice, dont deux requêtes par pool à chaque tour.
--
--  Mesuré sur deux cents lignes et UN seul pool budgété :
--
--      avec recalcul par ligne   101,8 ms
--      sans recalcul              50,7 ms
--
--  Le coût est linéaire en lignes × pools. Avec quatre pools et un budget de
--  cent quatre-vingts lignes, on approche la seconde ; un import de deux mille
--  lignes avec dix pools se compte en minutes, et l'écran reste figé sans rien
--  dire. Or le résultat est le même : seule la DERNIÈRE passe compte.
--
--  ⚠️ POURQUOI UN DÉCLENCHEUR DE CONTRAINTE DIFFÉRÉ.
--
--     Un déclencheur d'instruction ne suffirait pas : l'import écrit ligne à
--     ligne, chaque ligne étant sa propre instruction. Il faut donc reporter
--     le recalcul à la FIN DE LA TRANSACTION, et n'en faire qu'un.
--
--     Le dédoublonnage passe par un réglage local à la transaction. Il
--     s'efface au COMMIT comme au ROLLBACK, donc rien ne fuit d'une
--     transaction à l'autre — y compris entre deux requêtes servies par la
--     même connexion du pool.
--
--  ⚠️ CE QUE CELA CHANGE POUR L'EXPLOITANT.
--
--     Un refus d'assiette — prévisions aux unités mêlées, assiette vidée —
--     remonte désormais à la VALIDATION et non à la ligne fautive. Le message
--     nomme le pool concerné ; il ne peut plus nommer la ligne. C'est le prix
--     du report, et il est modeste au regard d'un import qui se fige.
-- ===========================================================================
CREATE OR REPLACE FUNCTION propage_assiette_absorption()
RETURNS TRIGGER AS $$
DECLARE
  cible uuid;
BEGIN
  IF COALESCE(NEW.kind::text, OLD.kind::text) <> 'BUDGET' THEN
    RETURN NULL;
  END IF;

  cible := COALESCE(NEW.fiscal_year_id, OLD.fiscal_year_id);

  -- Déjà demandé dans cette transaction : le recalcul aura lieu une fois, à la
  -- fin. Le refaire ici donnerait exactement le même résultat.
  IF current_setting('erp.assiette_a_recalculer', true) IS NOT DISTINCT FROM cible::text THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('erp.assiette_a_recalculer', cible::text, true);
  PERFORM recalcule_taux_absorption(cible);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_propage_assiette ON sales_forecasts;

-- ⚠️ `DEFERRABLE INITIALLY DEFERRED` : le corps s'exécute au COMMIT.
--
--    Toutes les lignes de la transaction sont alors posées, et le premier
--    passage recalcule sur l'état FINAL. Les suivants sont écartés par le
--    réglage local ci-dessus.
CREATE CONSTRAINT TRIGGER trg_propage_assiette
  AFTER INSERT OR UPDATE OR DELETE ON sales_forecasts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION propage_assiette_absorption();
