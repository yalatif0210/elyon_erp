-- ===========================================================================
--  TABLEAU DE BORD OPÉRATIONNEL
--  Réf. SPECIFICATIONS.md § 16
--
--  « Le tableau de bord opérationnel affiche : opérations à venir, en cours, en
--    retard, bloquées, non conformes HSE, livrées non facturées, facturées non
--    encaissées. »
--
--  Sept états, et deux d'entre eux ne sont pas des statuts d'opération mais des
--  TROUS ENTRE DEUX MODULES — livré sans facture, facturé sans encaissement.
--  Ce sont ceux-là qui coûtent, parce qu'aucun écran ne les portait : une
--  opération close disparaît de la liste des opérations, et une facture émise
--  ne dit pas qu'elle attend.
--
--  ⚠️ CHAQUE OPÉRATION N'APPARAÎT QUE DANS UN SEUL ÉTAT.
--
--     Un tableau où les compteurs se recouvrent ne s'additionne pas, et celui
--     qui le lit finit par ne plus savoir combien d'opérations il a. L'ordre de
--     priorité est explicite ci-dessous, du plus grave au plus banal.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

CREATE OR REPLACE VIEW v_tableau_operationnel AS
WITH facture AS (
  -- Facturation réelle d'une affaire : proforma et avoir exclus. Une proforma
  -- n'est pas une facture, et compter un avoir comme facturation ferait
  -- disparaître une opération non facturée le jour où on annule autre chose.
  SELECT i.deal_id,
         sum(i.total_amount_pivot)                     AS facture_pivot,
         sum(COALESCE(i.paid_amount_pivot, 0))         AS encaisse_pivot,
         min(i.due_date) FILTER (
           WHERE i.status::text NOT IN ('PAID', 'CANCELLED')
         )                                             AS plus_proche_echeance,
         count(*) FILTER (
           WHERE i.status::text NOT IN ('PAID', 'CANCELLED')
         )                                             AS factures_ouvertes
    FROM invoices i
   WHERE i.type::text IN ('SIMPLE', 'FNE')
     AND i.status::text <> 'CANCELLED'
   GROUP BY i.deal_id
)
SELECT o.id                                            AS operation_id,
       o.reference,
       o.phase::text                                   AS etape,
       d.reference                                     AS affaire,
       p.legal_name                                    AS client,
       pr.code                                         AS produit,
       o.planned_volume,
       o.uom::text                                     AS uom,
       o.planned_loading_date,
       o.actual_discharge_date,

       -- ⚠️ ORDRE DE PRIORITÉ : le premier cas vrai gagne, et un seul gagne.
       -- REVU LE 22/08/2026 : plus de statut à part — INCIDENT/CANCELLED sont
       -- des arrêts parallèles (`halt_type`) et le blocage HSE se calcule
       -- (`operation_hse_bloquee`) au lieu de se lire (HSE_BLOCKED disparaît).
       CASE
         -- 1. Incident : le plus grave, il prime sur tout le reste.
         WHEN o.halt_type::text = 'INCIDENT'                   THEN 'INCIDENT'
         -- 2. Bloquée par le verrou HSE à son étape courante.
         WHEN o.halted_at IS NULL
              AND operation_hse_bloquee(o.id)                  THEN 'BLOQUEE_HSE'
         -- 3. Engagée alors qu'un moyen affecté n'est PLUS conforme. Le verrou
         --    joue à l'affectation ; une pièce peut expirer ensuite.
         WHEN o.halted_at IS NULL
              AND o.phase::text NOT IN ('PREPARATION', 'CLOTURE')
              AND EXISTS (
                SELECT 1 FROM operation_assignments a
                  JOIN v_transport_compliance c
                    ON c.subject_id IN (a.carrier_id, a.vehicle_id, a.driver_id)
                 WHERE a.operation_id = o.id
                   AND NOT c.is_compliant
                   AND a.compliance_derogation_id IS NULL
              )                                                THEN 'NON_CONFORME'
         -- 4. En retard : le chargement était prévu et n'a pas eu lieu.
         WHEN o.halted_at IS NULL
              AND o.phase::text IN ('PREPARATION', 'PRE_CHARGEMENT')
              AND o.planned_loading_date IS NOT NULL
              AND o.planned_loading_date < CURRENT_DATE       THEN 'EN_RETARD'
         -- 5. Livrée mais pas facturée — un trou entre deux modules.
         WHEN o.phase::text IN ('POST_DECHARGEMENT', 'CLOTURE')
              AND COALESCE(f.facture_pivot, 0) = 0             THEN 'LIVREE_NON_FACTUREE'
         -- 6. Facturée mais pas encaissée.
         WHEN o.phase::text = 'CLOTURE'
              AND COALESCE(f.facture_pivot, 0) > 0
              AND COALESCE(f.encaisse_pivot, 0) < f.facture_pivot
                                                               THEN 'FACTUREE_NON_ENCAISSEE'
         -- 7. En cours d'exécution.
         WHEN o.halted_at IS NULL
              AND o.phase::text IN ('CHARGEMENT', 'POST_CHARGEMENT', 'TRANSPORT',
                                     'PRE_DECHARGEMENT', 'DECHARGEMENT', 'POST_DECHARGEMENT')
                                                               THEN 'EN_COURS'
         -- 8. À venir.
         WHEN o.halted_at IS NULL
              AND o.phase::text IN ('PREPARATION', 'PRE_CHARGEMENT')
                                                               THEN 'A_VENIR'
         WHEN o.halt_type::text = 'CANCELLED'                  THEN 'ANNULEE'
         ELSE 'SOLDEE'
       END                                             AS etat,

       COALESCE(f.facture_pivot, 0)                    AS facture_pivot,
       COALESCE(f.encaisse_pivot, 0)                   AS encaisse_pivot,
       COALESCE(f.facture_pivot, 0) - COALESCE(f.encaisse_pivot, 0) AS reste_a_encaisser,
       f.plus_proche_echeance,
       -- Retard d'encaissement : positif quand l'échéance est dépassée.
       CASE WHEN f.plus_proche_echeance IS NOT NULL
                 AND f.plus_proche_echeance < CURRENT_DATE
            THEN CURRENT_DATE - f.plus_proche_echeance END      AS retard_encaissement_jours,
       -- Retard de chargement, pour la même raison.
       CASE WHEN o.planned_loading_date IS NOT NULL
                 AND o.planned_loading_date < CURRENT_DATE
                 AND o.phase::text IN ('PREPARATION', 'PRE_CHARGEMENT')
            THEN CURRENT_DATE - o.planned_loading_date END      AS retard_chargement_jours
  FROM operations o
  JOIN deals d ON d.id = o.deal_id
  JOIN partners p ON p.id = d.client_id
  JOIN products pr ON pr.id = d.product_id
  LEFT JOIN facture f ON f.deal_id = o.deal_id;

COMMENT ON VIEW v_tableau_operationnel IS
  'Opérations classées en un SEUL état chacune (§ 16), du plus grave au plus banal. « Livrée non facturée » et « facturée non encaissée » sont des trous entre modules, pas des statuts d''opération.';


-- ---------------------------------------------------------------------------
--  Le décompte, pour les pavés du tableau de bord.
--
--  Une vue séparée : l'écran l'appelle à chaque ouverture, et rapatrier toutes
--  les lignes pour les compter coûterait cher pour sept chiffres.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_tableau_operationnel_compte AS
SELECT etat,
       count(*)                                        AS operations,
       sum(planned_volume)                             AS volume,
       sum(reste_a_encaisser)                          AS reste_a_encaisser,
       max(COALESCE(retard_encaissement_jours, retard_chargement_jours)) AS retard_max_jours
  FROM v_tableau_operationnel
 WHERE etat NOT IN ('ANNULEE', 'SOLDEE')
 GROUP BY etat;

COMMENT ON VIEW v_tableau_operationnel_compte IS
  'Décompte par état pour les pavés du tableau de bord (§ 16). Les états se comptent sans se recouvrir : le total est donc lisible.';
