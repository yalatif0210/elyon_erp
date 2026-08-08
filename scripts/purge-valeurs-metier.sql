-- ===========================================================================
--  PURGE DES VALEURS MÉTIER PRÉCHARGÉES — SECONDE VAGUE
--
--  Le dirigeant, après avoir fait vider produits, cours de change et seuils de
--  marge : « les quatre autres référentiels portent exactement le même
--  problème, videz les quatre ».
--
--  ⚠️ CE SONT DES DÉCISIONS D'ENTREPRISE, PAS DE LA CONFIGURATION.
--
--     · Un barème de coût est ce que l'entreprise considère comme normal de
--       payer pour un chargement ou un transit. Personne d'autre ne peut le
--       fixer à sa place.
--     · Une tolérance d'ullage est le pourcentage de perte qu'elle accepte
--       avant de s'alarmer. Le § 19 l'illustrait à 0,2 % « à calibrer sur vos
--       contrats de transport et polices d'assurance ».
--     · Un regroupement de charges et son taux d'absorption sont la structure
--       de coûts de l'entreprise, et le budget qu'elle y consacre.
--
--     Les livrer préremplis revenait à répondre à sa place, puis à laisser
--     croire que c'était paramétré.
--
--  ⚠️ CE QUE LA PURGE ÉTEINT, ET IL FAUT LE SAVOIR.
--
--     · Sans barème, l'écart au barème ne se calcule plus : une ligne de coût
--       aberrante ne remonte nulle part, et la règle d'invariant qui la
--       surveille n'a plus rien à comparer.
--     · Sans tolérance d'ullage, aucun écart de volume n'est signalé.
--     · Sans taux d'absorption, les charges indirectes valent zéro dans le coût
--       complet : la marge affichée est donc SURESTIMÉE de toutes les charges
--       de structure.
--
--     Ce dernier point est le plus coûteux. Tant qu'aucun taux n'est saisi, le
--     seuil de marge se compare à une marge qui n'a rien absorbé.
--
--  ⚠️ IRRÉVERSIBLE. Sauvegarde dans sauvegardes/ avant exécution.
-- ===========================================================================

BEGIN;

-- Les gardes « ajout seul » d'`absorption_rates` protègent des coûts déjà
-- calculés. Il n'y a plus ni affaire ni opération : rien ne s'y appuie.
SET session_replication_role = replica;

-- --- Taux d'absorption ------------------------------------------------------
-- D'abord : ils pointent vers les regroupements.
DELETE FROM absorption_rates;

-- --- Regroupements de charges indirectes ------------------------------------
-- Y compris `BANQUE-900` et `TEST-CA`, deux essais de campagne de recette que
-- j'avais désactivés et renommés faute de pouvoir les supprimer. Ils partent
-- pour de bon.
--
-- ⚠️ LE DÉNOUAGE DOIT ÊTRE EXPLICITE, PAS DÉLÉGUÉ À LA CLÉ ÉTRANGÈRE.
--
--    `cost_posts.cost_pool_id` est déclaré ON DELETE SET NULL : le lien devrait
--    se dénouer tout seul. Il ne le fait PAS ici, et c'est le piège de la
--    méthode employée — `session_replication_role = replica` suspend les
--    déclencheurs, or PostgreSQL implémente les actions de clé étrangère PAR
--    des déclencheurs système. Suspendre les gardes suspend donc aussi
--    l'intégrité référentielle.
--
--    Constaté : cinq postes de coût pointaient vers des regroupements
--    supprimés. Aucune erreur, aucun signal — des références orphelines que la
--    base aurait acceptées indéfiniment.
--
--    On dénoue donc à la main, AVANT de supprimer.
--
-- ⚠️ ET LE DÉNOUAGE SEUL NE SUFFIT PAS : UN POSTE INDIRECT EXIGE UN
--    REGROUPEMENT.
--
--    `chk_cost_posts_allocation_coherence` impose qu'un poste soit SOIT direct
--    sans regroupement ni assiette, SOIT indirect AVEC les deux. Passer le
--    regroupement à NULL sur un poste indirect est donc refusé — à juste titre :
--    une charge indirecte sans regroupement n'entre nulle part dans le coût
--    complet, elle disparaît du calcul sans que rien ne le dise.
--
--    Les postes INDIRECTS partent donc avec les regroupements : ce sont les
--    deux faces d'une même décision de structure de coûts. Les 19 postes
--    DIRECTS — chargement, transit, manutention, fret — survivent : ce sont des
--    natures de dépense, pas des choix d'imputation.
DELETE FROM cost_posts WHERE nature::text = 'INDIRECT';

DELETE FROM cost_pools;

-- --- Barèmes de coût --------------------------------------------------------
DELETE FROM cost_standards;

-- --- Tolérances d'ullage ----------------------------------------------------
DELETE FROM ullage_tolerances;

SET session_replication_role = DEFAULT;

COMMIT;
