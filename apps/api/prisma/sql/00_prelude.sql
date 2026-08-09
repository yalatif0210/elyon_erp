-- ===========================================================================
--  PRÉAMBULE — DÉPOSE DES VUES QUI DÉPENDENT DE FONCTIONS RECRÉÉES ENSUITE
--
--  LE PROBLÈME
--  -----------
--  Tout le SQL métier est REJOUÉ à chaque migration : c'est ce qui garantit
--  que les invariants survivent aux évolutions de schéma. Or plusieurs
--  fichiers redéfinissent des fonctions (`resolve_margin_threshold`,
--  `resolve_cost_standard`, `compliance_statut_effectif`…), et PostgreSQL
--  refuse de remplacer une fonction dont une VUE dépend :
--
--    ERROR: cannot drop function resolve_margin_threshold(...) because other
--           objects depend on it
--           DETAIL: view v_invariant_breaches depends on function ...
--
--  La migration échouait donc dès qu'une vue d'audit avait été créée par la
--  migration PRÉCÉDENTE. Le symptôme est trompeur : il apparaît une migration
--  APRÈS celle qui l'a causé.
--
--  LA SOLUTION
--  -----------
--  Les vues d'analyse sont déposées ICI, en tête de séquence, et recréées plus
--  bas par les fichiers qui les portent. Elles ne contiennent aucune donnée :
--  les déposer ne coûte rien et ne perd rien.
--
--  ⚠️ TOUTE NOUVELLE VUE QUI APPELLE UNE FONCTION MÉTIER DOIT ÊTRE AJOUTÉE
--     ICI. L'oubli ne se voit pas tout de suite — il se voit à la migration
--     suivante, sur une modification sans rapport.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

DROP VIEW IF EXISTS v_taches_par_role CASCADE;
DROP VIEW IF EXISTS v_taches CASCADE;
DROP VIEW IF EXISTS v_invariant_breaches CASCADE;
DROP VIEW IF EXISTS v_tableau_operationnel_compte CASCADE;
DROP VIEW IF EXISTS v_tableau_operationnel CASCADE;
DROP VIEW IF EXISTS v_performance_commerciale CASCADE;
DROP VIEW IF EXISTS v_crm_conversion CASCADE;
DROP VIEW IF EXISTS v_crm_alertes CASCADE;
DROP VIEW IF EXISTS v_crm_pipeline_par_etape CASCADE;
DROP VIEW IF EXISTS v_crm_pipeline CASCADE;
DROP VIEW IF EXISTS v_absorption_reelle CASCADE;
-- Remplacée par `v_absorption_reelle` : l'assiette étant dérivée, l'écart
-- qu'elle mesurait est nul par construction. Le DROP reste pour les bases qui
-- la portent encore.
DROP VIEW IF EXISTS v_assiette_absorption CASCADE;
DROP VIEW IF EXISTS v_creances_echues CASCADE;
DROP VIEW IF EXISTS v_rapprochement_encaissements CASCADE;
DROP VIEW IF EXISTS v_reste_a_facturer CASCADE;
DROP VIEW IF EXISTS v_prevision_vente CASCADE;
DROP VIEW IF EXISTS v_prevision_en_vigueur CASCADE;
DROP VIEW IF EXISTS v_bfr_exploitation CASCADE;
DROP VIEW IF EXISTS v_point_mort CASCADE;
DROP VIEW IF EXISTS v_marge_cout_variable CASCADE;
-- APRÈS v_point_mort, qui la lit — même si le CASCADE suffirait, l'ordre dit
-- la dépendance à qui relit ce fichier.
DROP VIEW IF EXISTS v_charges_fixes_exercice CASCADE;
DROP VIEW IF EXISTS v_couverture_budgetaire CASCADE;
DROP VIEW IF EXISTS v_parametres_requis_sonde CASCADE;
DROP VIEW IF EXISTS v_parametres_requis CASCADE;
DROP VIEW IF EXISTS v_derogations_abusives CASCADE;
DROP VIEW IF EXISTS v_derogations_effectives CASCADE;
DROP VIEW IF EXISTS v_controles_sans_preuve CASCADE;
DROP VIEW IF EXISTS v_controles_sans_photo CASCADE;
DROP VIEW IF EXISTS v_conformite_statut_perime CASCADE;
DROP VIEW IF EXISTS v_transport_compliance CASCADE;
DROP VIEW IF EXISTS v_compliance_expiry_watch CASCADE;
DROP VIEW IF EXISTS v_exigences_site CASCADE;
DROP VIEW IF EXISTS v_fret_hors_tarif CASCADE;
DROP VIEW IF EXISTS v_sites_partages CASCADE;
DROP VIEW IF EXISTS v_field_clock_drift CASCADE;
DROP VIEW IF EXISTS v_field_rejections CASCADE;
DROP VIEW IF EXISTS v_ullage_statistiques CASCADE;
DROP VIEW IF EXISTS v_credit_depasse CASCADE;
DROP VIEW IF EXISTS v_partner_credit_exposure CASCADE;
DROP VIEW IF EXISTS v_fret_hors_tarif CASCADE;
