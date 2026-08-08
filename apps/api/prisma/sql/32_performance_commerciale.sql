-- ===========================================================================
--  PERFORMANCE PAR COMMERCIAL
--  Réf. SPECIFICATIONS.md § 16 — « Commercial & CRM : prospects, pipeline,
--  conversion, CA prévisionnel, offres, PERFORMANCE, marges »
--
--  CE QUI MANQUAIT
--  ---------------
--  Une seule lecture par commercial existait : `v_margin_band_by_owner`, qui
--  dit combien d'affaires d'un vendeur effleurent le seuil de marge. C'est un
--  signal de dérive, pas une mesure d'activité — et le § 16 demande la
--  performance, que rien ne portait.
--
--  Le dirigeant : « le CCOO doit voir la concentration par commercial ainsi que
--  les statistiques par commercial au même titre que le DG ».
--
--  ⚠️ CETTE VUE COMPARE DES PERSONNES. ELLE N'EST PAS OUVERTE AUX COMMERCIAUX.
--
--     Un commercial ne voit que ses propres affaires (règle posée le 8 août).
--     Lui ouvrir un tableau comparatif de ses collègues contredirait cette
--     règle par la porte de derrière : le classement dit ce que le détail
--     cache. La lecture est réservée à ceux qui encadrent — DG, CCOO — et au
--     CFO, qui répond des marges.
--
--  ⚠️ TROIS FAMILLES DE CHIFFRES, ET ON NE LES MÉLANGE PAS.
--
--     · PIPELINE   ce qui est espéré. Dépend de probabilités déclarées.
--     · RÉALISÉ    ce qui est signé. Ne dépend d'aucune hypothèse.
--     · QUALITÉ    à quel prix c'est signé — marge, et proximité du seuil.
--
--     Un commercial qui remplit son pipeline sans rien signer, et un autre qui
--     signe tout au ras du seuil, ont tous deux un problème. Un chiffre unique
--     les confondrait.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

CREATE OR REPLACE VIEW v_performance_commerciale AS
WITH
-- --- Ce qui est espéré : le pipeline ouvert -------------------------------
pipeline AS (
  SELECT o.owner_id,
         count(*)                                            AS opportunites_ouvertes,
         sum(o.estimated_volume * o.reference_price)         AS ca_previsionnel,
         -- Somme des seules opportunités pondérables. Le décompte à côté dit
         -- combien manquent : sans lui, un total partiel se lirait comme un
         -- total.
         sum(CASE WHEN COALESCE(o.probability_override_pct, s.probability_pct) IS NOT NULL
                  THEN o.estimated_volume * o.reference_price
                       * COALESCE(o.probability_override_pct, s.probability_pct) / 100
             END)                                            AS valeur_ponderee,
         count(*) FILTER (
           WHERE COALESCE(o.probability_override_pct, s.probability_pct) IS NULL
         )                                                   AS sans_probabilite,
         count(*) FILTER (WHERE o.next_action_due < CURRENT_DATE) AS actions_en_retard
    FROM crm_opportunities o
    JOIN crm_pipeline_stages s ON s.id = o.stage_id
   WHERE s.outcome::text = 'OPEN'
   GROUP BY o.owner_id
),
-- --- Ce qui est tranché : gagné ou perdu ----------------------------------
issues AS (
  SELECT o.owner_id,
         count(*) FILTER (WHERE s.outcome::text = 'WON')  AS gagnees,
         count(*) FILTER (WHERE s.outcome::text = 'LOST') AS perdues,
         sum(o.estimated_volume * o.reference_price)
           FILTER (WHERE s.outcome::text = 'WON')         AS ca_gagne
    FROM crm_opportunities o
    JOIN crm_pipeline_stages s ON s.id = o.stage_id
   WHERE s.outcome::text IN ('WON', 'LOST')
   GROUP BY o.owner_id
),
-- --- Ce qui est signé : les affaires --------------------------------------
affaires AS (
  SELECT d.owner_id,
         count(*)                                            AS affaires,
         sum(d.contracted_volume)                            AS volume,
         sum(d.contracted_volume * d.unit_sale_price)        AS chiffre_affaires,
         -- Marge moyenne PONDÉRÉE par le volume : une petite affaire à forte
         -- marge ne doit pas peser autant qu'une grosse à marge faible.
         round(sum(d.estimated_full_margin * d.contracted_volume)
               / NULLIF(sum(d.contracted_volume), 0), 4)     AS marge_unitaire_moyenne,
         count(*) FILTER (WHERE d.credit_approved_by_id IS NOT NULL) AS approuvees,
         count(*) FILTER (WHERE d.margin_derogation_id IS NOT NULL)  AS sur_derogation
    FROM deals d
   WHERE d.status::text NOT IN ('DRAFT', 'CANCELLED', 'REJECTED_BY_CLIENT')
   GROUP BY d.owner_id
)
SELECT u.id                                                  AS owner_id,
       u.full_name                                           AS commercial,
       u.role::text                                          AS role,

       -- Pipeline
       COALESCE(p.opportunites_ouvertes, 0)                  AS opportunites_ouvertes,
       round(COALESCE(p.ca_previsionnel, 0), 2)              AS ca_previsionnel,
       round(p.valeur_ponderee, 2)                           AS valeur_ponderee,
       COALESCE(p.sans_probabilite, 0)                       AS sans_probabilite,
       COALESCE(p.actions_en_retard, 0)                      AS actions_en_retard,

       -- Conversion, sur les seules affaires TRANCHÉES. Inclure les ouvertes
       -- ferait baisser le taux à mesure qu'on prospecte, ce qui punirait
       -- l'activité.
       COALESCE(i.gagnees, 0)                                AS gagnees,
       COALESCE(i.perdues, 0)                                AS perdues,
       CASE WHEN COALESCE(i.gagnees, 0) + COALESCE(i.perdues, 0) > 0
            THEN round(100.0 * i.gagnees / (i.gagnees + i.perdues), 2)
       END                                                   AS conversion_pct,

       -- Réalisé
       COALESCE(a.affaires, 0)                               AS affaires,
       COALESCE(a.volume, 0)                                 AS volume,
       round(COALESCE(a.chiffre_affaires, 0), 2)             AS chiffre_affaires,
       COALESCE(a.approuvees, 0)                             AS affaires_approuvees,

       -- Qualité de ce qui est signé
       a.marge_unitaire_moyenne,
       COALESCE(a.sur_derogation, 0)                         AS affaires_sur_derogation,
       COALESCE(b.deals_in_band, 0)                          AS affaires_dans_la_bande,
       b.band_share_pct                                      AS part_dans_la_bande_pct,
       b.avg_above_threshold_pct                             AS ecart_moyen_au_seuil_pct

  FROM users u
  LEFT JOIN pipeline p ON p.owner_id = u.id
  LEFT JOIN issues   i ON i.owner_id = u.id
  LEFT JOIN affaires a ON a.owner_id = u.id
  LEFT JOIN v_margin_band_by_owner b ON b.owner_id = u.id
 -- Les rôles qui PORTENT des affaires. Un comptable n'a pas de performance
 -- commerciale, et l'afficher à zéro donnerait une ligne vide à interpréter.
 WHERE u.role::text IN ('SALES_REP', 'CCOO', 'DG')
   AND u.is_active
   AND (p.owner_id IS NOT NULL OR i.owner_id IS NOT NULL OR a.owner_id IS NOT NULL);

COMMENT ON VIEW v_performance_commerciale IS
  'Performance par commercial (§ 16) : pipeline espéré, conversion observée, réalisé signé, et qualité de ce qui est signé. Trois familles de chiffres qu''un indicateur unique confondrait. Réservée à l''encadrement — un commercial ne voit que ses propres affaires.';
