-- ===========================================================================
--  MOINDRE PRIVILÈGE EN BASE
--  Réf. SPECIFICATIONS.md § 1.4
--
--  Deux rôles PostgreSQL, jamais confondus :
--    · erp_migrator — propriétaire du schéma, DDL. Utilisé UNIQUEMENT par
--                     les migrations, jamais par l'application.
--    · erp_app      — DML seul. Aucun DDL. Aucun effacement de journal.
--
--  Conséquence : une injection SQL réussie contre l'application ne permet
--  ni de supprimer une table, ni d'effacer une trace d'audit ou une dérogation.
--
--  Le bloc teste l'existence du rôle : la migration doit pouvoir se rejouer
--  sur la base de travail de Prisma ou sur un poste de développement où
--  erp_app n'existe pas.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

DO $grants$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    RAISE NOTICE 'Rôle erp_app absent : attribution des privilèges ignorée (base de travail ou poste de développement).';
    RETURN;
  END IF;

  EXECUTE 'GRANT USAGE ON SCHEMA public TO erp_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app';

  -- --- Journaux : insertion seule -----------------------------------------
  EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM erp_app';
  EXECUTE 'GRANT SELECT, INSERT ON audit_logs TO erp_app';

  -- Journal terrain (§ 10.2). Il conserve qu'un événement a été REFUSÉ : le
  -- droit de le réécrire suffirait à faire disparaître la trace d'une tentative
  -- hors des règles, et l'identifiant redeviendrait libre pour un renvoi.
  EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON field_sync_events FROM erp_app';
  EXECUTE 'GRANT SELECT, INSERT ON field_sync_events TO erp_app';

  -- --- Registre des dérogations : pas d'effacement -------------------------
  -- Une dérogation se révoque ou se clôture ; elle ne disparaît jamais.
  EXECUTE 'REVOKE DELETE, TRUNCATE ON derogations FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON delegations FROM erp_app';

  -- --- Historiques opposables : pas d'effacement ---------------------------
  -- Taux de change, prix administrés et taux d'absorption rendent reproductibles
  -- des pièces déjà émises. On clôt une période, on n'efface pas.
  EXECUTE 'REVOKE DELETE, TRUNCATE ON fx_rates FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON supplier_prices FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON deal_status_transitions FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON operation_phase_transitions FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON generated_documents FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON signatures FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON administered_prices FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON absorption_rates FROM erp_app';

  -- --- Référentiels administrés : pas de suppression -----------------------
  -- Devises, postes de coûts et grilles de seuils se désactivent (is_active),
  -- ils ne se suppriment pas : l'historique doit rester lisible.
  EXECUTE 'REVOKE DELETE, TRUNCATE ON currencies FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON cost_posts FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON margin_thresholds FROM erp_app';
  EXECUTE 'REVOKE DELETE, TRUNCATE ON ullage_tolerances FROM erp_app';

  -- --- Vues et fonctions de service ---------------------------------------
  EXECUTE 'GRANT SELECT ON v_transport_compliance TO erp_app';
  EXECUTE 'GRANT SELECT ON v_partner_credit_exposure TO erp_app';
  EXECUTE 'GRANT SELECT ON v_margin_band_watch TO erp_app';
  EXECUTE 'GRANT SELECT ON v_margin_band_by_owner TO erp_app';
  EXECUTE 'GRANT SELECT ON v_performance_commerciale TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION performance_commerciale(date, date, text, date) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION periode_performance_defaut() TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION periode_bornes(text, date) TO erp_app';
  EXECUTE 'GRANT SELECT ON v_margin_variance TO erp_app';
  EXECUTE 'GRANT SELECT ON v_cost_reconciliation TO erp_app';
  EXECUTE 'GRANT SELECT ON v_compliance_expiry_watch TO erp_app';
  EXECUTE 'GRANT SELECT ON v_outstanding_advances TO erp_app';
  EXECUTE 'GRANT SELECT ON v_quotation_variance TO erp_app';
  EXECUTE 'GRANT SELECT ON v_invariant_breaches TO erp_app';
  EXECUTE 'GRANT SELECT ON v_parametres_requis TO erp_app';
  EXECUTE 'GRANT SELECT ON v_parametres_requis_sonde TO erp_app';
  EXECUTE 'GRANT SELECT ON v_couverture_budgetaire TO erp_app';
  EXECUTE 'GRANT SELECT ON v_marge_cout_variable TO erp_app';
  EXECUTE 'GRANT SELECT ON v_point_mort TO erp_app';
  EXECUTE 'GRANT SELECT ON v_bfr_exploitation TO erp_app';
  EXECUTE 'GRANT SELECT ON v_prevision_vente TO erp_app';
  EXECUTE 'GRANT SELECT ON v_prevision_en_vigueur TO erp_app';
  EXECUTE 'GRANT SELECT ON v_reste_a_facturer TO erp_app';
  EXECUTE 'GRANT SELECT ON v_rapprochement_encaissements TO erp_app';
  EXECUTE 'GRANT SELECT ON v_creances_echues TO erp_app';
  EXECUTE 'GRANT SELECT ON v_charges_fixes_exercice TO erp_app';
  EXECUTE 'GRANT SELECT ON v_absorption_reelle TO erp_app';
  EXECUTE 'GRANT SELECT ON v_crm_pipeline TO erp_app';
  EXECUTE 'GRANT SELECT ON v_crm_pipeline_par_etape TO erp_app';
  EXECUTE 'GRANT SELECT ON v_crm_alertes TO erp_app';
  EXECUTE 'GRANT SELECT ON v_crm_conversion TO erp_app';
  EXECUTE 'GRANT SELECT ON v_tableau_operationnel TO erp_app';
  EXECUTE 'GRANT SELECT ON v_tableau_operationnel_compte TO erp_app';
  -- L'historique des passages d'étape ne se RÉÉCRIT pas : c'est lui qui mesure
  -- la conversion. Il disparaît en revanche avec l'opportunité qu'il décrit —
  -- sans quoi une opportunité créée par erreur serait indestructible, et
  -- entrerait à jamais dans la valeur pondérée puis dans la prévision.
  EXECUTE 'REVOKE UPDATE, TRUNCATE ON crm_stage_transitions FROM erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION exercice_courant() TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION taux_financement(uuid) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION jours_portage_an(uuid) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION resolve_hse_checklist(uuid) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION resolve_fx_rate(char, char, date, text) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION resolve_administered_price(text, uuid, text, date) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION resolve_margin_threshold(text, uuid, char, text, date) TO erp_app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION resolve_ullage_tolerance(text, text, uuid, date) TO erp_app';

  -- --- Aucun DDL -----------------------------------------------------------
  EXECUTE 'REVOKE CREATE ON SCHEMA public FROM erp_app';

  -- --- Héritage pour les migrations futures --------------------------------
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO erp_app';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO erp_app';

  RAISE NOTICE 'Privilèges erp_app appliqués.';
END
$grants$;
