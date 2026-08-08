-- ===========================================================================
--  PURGE DES DONNÉES DE DÉMONSTRATION
--
--  Remet la base dans l'état d'une entreprise qui commence : le PARAMÉTRAGE et
--  les COMPTES restent, l'ACTIVITÉ disparaît.
--
--  ⚠️ IRRÉVERSIBLE. Une sauvegarde complète est prise dans sauvegardes/ avant
--     toute exécution. Restauration :
--        docker compose exec -T postgres psql -U erp_migrator -d erp \
--          < sauvegardes/avant-purge-AAAAMMJJ-HHMM.sql
--
--  ⚠️ NE JAMAIS EXÉCUTER SUR UNE BASE D'EXPLOITATION.
--
--  ---------------------------------------------------------------------------
--  CE QUI RESTE, ET POURQUOI
--  ---------------------------------------------------------------------------
--
--  · Comptes et sessions        — vous devez pouvoir vous connecter.
--  · Devises, produits          — le catalogue du métier.
--  · Cours de change            — sans eux, aucune pièce en devise ≠ pivot ne
--                                 peut se calculer. Ce sont des données de
--                                 marché, pas des données de test.
--  · Seuils de marge, tolérances d'ullage, postes et barèmes de coûts,
--    regroupements de charges, taux d'absorption
--                               — c'est CE QUI FAIT MORDRE LES VERROUS. Les
--                                 effacer donnerait une application permissive
--                                 qui ne montrerait rien de ce qu'elle sait
--                                 refuser.
--  · Types d'opération, modèles de checklist HSE, types d'exigence de site
--                               — le déroulé métier.
--  · Étapes du pipeline commercial — les treize étapes du § 15.
--  · Paramètres système         — délais d'alerte, seuils, TVA, exercice.
--
--  ---------------------------------------------------------------------------
--  CE QUI PART
--  ---------------------------------------------------------------------------
--
--  Toute l'activité : tiers, affaires, opérations, pièces, encaissements,
--  relevés, événements terrain, documents, dérogations, conformité, CRM,
--  exercices comptables et données budgétaires, journal d'audit, compteurs de
--  numérotation.
--
--  ⚠️ LES GARDES « AJOUT SEUL » SONT SUSPENDUS LE TEMPS DE LA PURGE.
--
--     `audit_logs`, `field_sync_events`, `derogations` et quelques autres
--     refusent le DELETE — c'est leur raison d'être. Les contourner
--     ponctuellement est un geste d'administration assumé, sur une base de
--     démonstration, avec sauvegarde. Il n'a rien à faire dans un chemin
--     applicatif.
-- ===========================================================================

BEGIN;

SET session_replication_role = replica;

-- --- Activité commerciale et exécution --------------------------------------
TRUNCATE TABLE
  operation_attachments,
  operation_hse_check_items,
  operation_hse_checks,
  operation_site_requirement_acks,
  operation_status_transitions,
  operation_type_assignments,
  operation_assignments,
  operation_cost_lines,
  measurement_records,
  field_sync_events,
  hse_corrective_actions,
  hse_events,
  signatures,
  generated_documents,
  documents,
  fne_transmissions,
  payments,
  invoices,
  supplier_invoices,
  purchase_orders,
  deal_cost_lines,
  deal_status_transitions,
  operations,
  deals,
  contracts
  CASCADE;

-- --- CRM --------------------------------------------------------------------
TRUNCATE TABLE
  crm_interactions,
  crm_stage_transitions,
  crm_opportunities
  CASCADE;

-- --- Exercices comptables et données budgétaires ----------------------------
-- Le dirigeant les saisira pour son exercice réel : les millésimes de
-- démonstration n'ont aucune valeur.
TRUNCATE TABLE
  sales_forecasts,
  fixed_cost_budgets,
  financing_rates,
  fiscal_years
  CASCADE;

-- --- Tiers et moyens ---------------------------------------------------------
TRUNCATE TABLE
  compliance_records,
  guarantees,
  carrier_tariffs,
  supplier_prices,
  administered_prices,
  site_requirements,
  sites,
  partner_sites,
  partner_contacts,
  partner_bank_accounts,
  vehicles,
  drivers,
  portal_users,
  partners
  CASCADE;

-- --- Dérogations et délégations ---------------------------------------------
TRUNCATE TABLE derogations, delegations CASCADE;

-- --- Journal d'audit et sessions --------------------------------------------
-- Le journal ne consigne que des gestes de démonstration ; le conserver
-- mêlerait des traces d'essai aux premières traces réelles, et rendrait la
-- piste d'audit illisible au moment précis où elle commence à compter.
TRUNCATE TABLE audit_logs CASCADE;
TRUNCATE TABLE user_sessions CASCADE;

-- --- Compteurs de numérotation -----------------------------------------------
-- Les séquences repartent à 1 : la première affaire réelle portera le numéro 1.
-- La sonde de ReferenceService protège de toute collision résiduelle.
TRUNCATE TABLE number_sequences CASCADE;

SET session_replication_role = DEFAULT;

-- --- Remise en état des comptes ----------------------------------------------
-- Compteurs d'échec remis à zéro, sessions closes : chacun se reconnecte.
UPDATE users SET failed_login_attempts = 0, locked_until = NULL;
-- `field_users` ne porte PAS de compteur d'échecs : le verrouillage terrain
-- repose sur `locked_until` seul. Le supposer symétrique faisait échouer toute
-- la transaction — heureusement, puisqu'elle était transactionnelle.
UPDATE field_users SET locked_until = NULL;

COMMIT;
