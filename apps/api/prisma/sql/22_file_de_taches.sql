-- ===========================================================================
--  FILE DE TÂCHES — QUI ATTEND QUOI, ET DEPUIS QUAND
--  Réf. SPECIFICATIONS.md § 3, § 11
--
--  Le dirigeant l'avait reportée : « pas de file de tâches, on va gérer ça à
--  la fin ». C'est la fin.
--
--  LE PROBLÈME QU'ELLE RÈGLE
--  -------------------------
--  L'application est pleine de verrous et d'arbitrages : une affaire attend le
--  CFO, une checklist attend le contrôleur HSE, un prix fournisseur attend le
--  DG, une pièce de conformité expire dans trois semaines. Rien ne le DISAIT.
--  Chacun devait ouvrir son écran et chercher — et ce qu'on ne cherche pas, on
--  ne le trouve pas.
--
--  ⚠️ LES TÂCHES SONT DÉRIVÉES DE L'ÉTAT, JAMAIS STOCKÉES.
--
--     Une table de tâches avec son propre cycle de vie dérive : elle continue
--     d'annoncer « approuver DEAL-x » longtemps après que DEAL-x a été
--     approuvé, parce qu'un chemin d'écriture a oublié de la fermer. On finit
--     par ne plus la croire — et une file qu'on ne croit plus est pire que
--     pas de file du tout.
--
--     Ici, une tâche existe TANT QUE la condition qui la crée est vraie, et
--     disparaît d'elle-même dès qu'elle cesse de l'être. Il n'y a rien à
--     fermer, donc rien à oublier de fermer.
--
--     La contrepartie est assumée : on ne peut pas marquer une tâche « lue »,
--     ni la déléguer. Ces deux besoins, s'ils apparaissent, demanderont une
--     table — mais adossée à celle-ci, jamais à sa place.
--
--  Injecté dans la migration Prisma — pas de BEGIN/COMMIT.
-- ===========================================================================

CREATE OR REPLACE VIEW v_taches AS

-- =========================================================================
--  ARBITRAGES ATTENDUS — quelqu'un est bloqué tant que personne ne tranche.
-- =========================================================================

-- 1. Affaire soumise, en attente du risque (CFO).
SELECT 'APPROBATION_CREDIT'::text                 AS categorie,
       'FINANCE_CFO'::text                        AS role_attendu,
       'BLOQUANT'::text                           AS urgence,
       d.reference                                AS objet,
       'Affaire en attente d''approbation : ' ||
         round(d.contracted_volume, 0) || ' ' || d.uom || ' à ' ||
         round(d.unit_sale_price, 2) || ' ' || d.currency_code AS libelle,
       'affaires/' || d.id::text                  AS lien,
       d.updated_at                               AS depuis
  FROM deals d
 WHERE d.status::text = 'PENDING_RISK'

UNION ALL
-- 2. Affaire sous le seuil de marge, en attente de l'accord du DG.
SELECT 'ACCORD_DG', 'DG', 'BLOQUANT',
       d.reference,
       'Marge sous le seuil : accord du DG requis',
       'affaires/' || d.id::text,
       d.updated_at
  FROM deals d
 WHERE d.status::text = 'PENDING_DG_APPROVAL'

UNION ALL
-- 3. Prix fournisseur saisi, non validé. Il n'est PAS opposable tant que le
--    DG ne l'a pas validé : toute affaire qui s'en sert est en suspens.
SELECT 'VALIDATION_PRIX', 'DG', 'BLOQUANT',
       p.legal_name || ' · ' || pr.code,
       'Prix fournisseur à valider : ' || round(sp.unit_price, 2) || ' ' ||
         sp.currency_code || '/' || sp.uom,
       'referentiels',
       sp.created_at
  FROM supplier_prices sp
  JOIN partners p ON p.id = sp.supplier_id
  JOIN products pr ON pr.id = sp.product_id
 WHERE sp.validated_by_id IS NULL
   AND (sp.effective_to IS NULL OR sp.effective_to >= CURRENT_DATE)

UNION ALL
-- 4. Checklist HSE entièrement renseignée, en attente de validation.
--    La définition est celle du périmètre terrain : un point encore en attente
--    signifie que la checklist attend l'AGENT, pas le contrôleur.
SELECT 'VALIDATION_HSE', 'HSE_CONTROLLER', 'BLOQUANT',
       o.reference || ' · ' || c.phase::text,
       'Checklist à valider : l''opération ne peut pas partir sans',
       'operations/' || o.id::text,
       c.created_at
  FROM operation_hse_checks c
  JOIN operations o ON o.id = c.operation_id
 WHERE c.validated_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM operation_hse_check_items i
      WHERE i.check_id = c.id AND i.outcome::text = 'PENDING'
   )

UNION ALL
-- 5. Exigences de site non levées sur une opération pas encore partie.
SELECT 'EXIGENCE_SITE', 'LOGISTICS_COORD', 'BLOQUANT',
       v.operation,
       'À lever avant le départ : ' || v.exigence ||
         ' (' || CASE v.bout WHEN 'LOADING' THEN 'chargement' ELSE 'livraison' END || ')',
       'operations/' || v.operation_id::text,
       o.updated_at
  FROM v_exigences_site v
  JOIN operations o ON o.id = v.operation_id
 WHERE v.is_blocking
   AND o.status::text IN ('DRAFT', 'SOURCING', 'HSE_PREPARATION', 'HSE_BLOCKED', 'PLANNED')
   AND NOT EXISTS (
     SELECT 1 FROM operation_site_requirement_acks a
      WHERE a.operation_id = v.operation_id AND a.requirement_id = v.exigence_id
   )

-- =========================================================================
--  ÉCHÉANCES — rien n'est bloqué aujourd'hui, tout le sera bientôt.
-- =========================================================================

UNION ALL
-- 6. Pièce de conformité qui expire. Le préavis est PARAMÉTRÉ : le raccourcir
--    ou l'allonger change ce que cette file annonce.
SELECT 'CONFORMITE_ECHEANCE', 'LOGISTICS_COORD',
       CASE WHEN cr.expiry_date < CURRENT_DATE THEN 'BLOQUANT' ELSE 'A_VENIR' END,
       COALESCE(p.legal_name, v.registration, dr.full_name) || ' · ' || cr.type::text,
       CASE WHEN cr.expiry_date < CURRENT_DATE
            THEN 'PÉRIMÉE le ' || to_char(cr.expiry_date, 'DD/MM/YYYY') ||
                 ' : le moyen n''est plus affectable'
            ELSE 'Expire le ' || to_char(cr.expiry_date, 'DD/MM/YYYY') ||
                 ' (' || (cr.expiry_date - CURRENT_DATE) || ' jours)' END,
       'conformite',
       cr.updated_at
  FROM compliance_records cr
  LEFT JOIN partners p  ON p.id = cr.partner_id
  LEFT JOIN vehicles v  ON v.id = cr.vehicle_id
  LEFT JOIN drivers  dr ON dr.id = cr.driver_id
 WHERE cr.is_blocking
   AND cr.expiry_date IS NOT NULL
   AND cr.expiry_date <= CURRENT_DATE + compliance_preavis_jours()
   AND compliance_statut_effectif(cr.status::text, cr.expiry_date) <> 'SUSPENDED'

UNION ALL
-- 7. Avance fournisseur non apurée — de la trésorerie immobilisée.
--
--    ⚠️ UNE AVANCE DATÉE DANS LE FUTUR N'IMMOBILISE RIEN ENCORE.
--
--       `days_outstanding` devient NÉGATIF quand la date de versement n'est pas
--       encore passée, et la file annonçait « immobilisés depuis -2 jours ».
--       Absurde à lire, et faux sur le fond : l'argent n'est pas sorti.
--
--       On ne corrige pas l'affichage en forçant le compte à zéro — ce serait
--       maquiller une avance à venir en avance dormante. On attend simplement
--       que le versement ait eu lieu.
SELECT 'AVANCE_NON_APUREE', 'FINANCE_CFO', 'A_VENIR',
       oa.reference,
       'Avance non apurée : ' || round(oa.outstanding_amount, 0) || ' ' || oa.currency_code ||
         ' immobilisés depuis ' || oa.days_outstanding || ' jours',
       'achats',
       oa.prepaid_at
  FROM v_outstanding_advances oa
 WHERE oa.days_outstanding >= 0

-- =========================================================================
--  ANOMALIES — ce qui est déjà passé et qu'il faut regarder.
-- =========================================================================

UNION ALL
-- 8. Violation d'invariant. Cette file DOIT rester vide.
SELECT 'INVARIANT', 'DG', 'ANOMALIE',
       b.enregistrement,
       b.regle || ' : ' || b.detail,
       'supervision',
       now()
  FROM v_invariant_breaches b

UNION ALL
-- 9. Saisies terrain refusées et JAMAIS REPRISES. L'agent l'a vu sur sa
--    tablette, mais sa file locale peut avoir disparu — et l'opération reste
--    en suspens.
--
--    ⚠️ DEUX PIÈGES, ET LE JOURNAL EST APPEND-ONLY : ON NE PEUT RIEN CORRIGER
--       APRÈS COUP, DONC LA VUE DOIT ÊTRE JUSTE DU PREMIER COUP.
--
--    a) L'EXTINCTION. « Un événement a été refusé » reste vrai POUR TOUJOURS :
--       le refus est gravé, rien ne l'efface. Sans condition de sortie, chaque
--       refus devenait une tâche perpétuelle et la file finissait par annoncer
--       des choses réglées depuis des semaines — précisément la dérive que
--       l'en-tête de ce fichier prétend éviter.
--
--       La sortie réelle n'est pas « quelqu'un a lu », c'est « l'agent a
--       renvoyé et ça a pris » : un événement ACCEPTÉ postérieur, même
--       opération, même agent, même type, et surtout MÊME SUJET. Sans le
--       sujet, un point de checklist accepté éteindrait le refus d'un AUTRE
--       point — on perdrait un signal réel, ce qui est pire que d'en garder un
--       mort.
--
--    b) LE REGROUPEMENT. Une ligne par événement noyait les blocages réels :
--       une tablette qui perd la main produit dix refus d'affilée, tous sur la
--       même opération, tous à traiter d'un seul geste. La tâche porte sur
--       L'OPÉRATION, pas sur l'événement.
SELECT 'REFUS_TERRAIN', 'LOGISTICS_COORD', 'ANOMALIE',
       o.reference,
       CASE WHEN count(*) = 1 THEN 'Saisie terrain refusée, non reprise : '
            ELSE count(*) || ' saisies terrain refusées, non reprises : ' END ||
         left((array_agg(e.rejection_reason ORDER BY e.received_at DESC))[1], 110),
       'operations/' || o.id::text,
       min(e.received_at)
  FROM field_sync_events e
  JOIN operations o ON o.id = e.operation_id
 WHERE e.status::text = 'REJECTED'
   AND o.status::text NOT IN ('CLOSED', 'CANCELLED')
   AND NOT EXISTS (
     SELECT 1
       FROM field_sync_events r
      WHERE r.operation_id  = e.operation_id
        AND r.field_user_id = e.field_user_id
        AND r.type          = e.type
        AND r.status::text  = 'ACCEPTED'
        AND r.received_at   > e.received_at
        -- Le sujet visé, dans l'ordre où les types l'adressent. Un type sans
        -- clé d'adressage (relevé, avancement) n'en vise qu'un par opération :
        -- la chaîne vide les fait correspondre entre eux, et à eux seuls.
        AND COALESCE(r.payload->>'checkItemId', r.payload->>'checkId',
                     r.payload->>'phase', '')
          = COALESCE(e.payload->>'checkItemId', e.payload->>'checkId',
                     e.payload->>'phase', '')
   )
 GROUP BY o.id, o.reference

UNION ALL
-- 10. Fret engagé hors tarif, sans transporteur ou sans motif.
SELECT 'FRET_HORS_TARIF', 'FINANCE_CFO', 'ANOMALIE',
       ft.operation,
       'Fret hors tarif : ' || round(ft.freight_cost, 0) || ' ' || ft.currency_code ||
         COALESCE(' contre ' || round(ft.tarif_attendu, 0) || ' négocié', ', sans tarif négocié'),
       'operations',
       now()
  FROM v_fret_hors_tarif ft

UNION ALL
-- 11. Client au-delà de son plafond de crédit.
SELECT 'CREDIT_DEPASSE', 'FINANCE_CFO', 'ANOMALIE',
       cd.partner_code,
       cd.partner_name || ' : engagé à ' || round(cd.engage, 0) ||
         ' pour un plafond de ' || round(cd.plafond, 0) || ' (' || cd.utilisation_pct || ' %)',
       'tiers',
       now()
  FROM v_credit_depasse cd

UNION ALL
-- 12. Dérogation exceptionnelle en attente de revue mensuelle.
SELECT 'REVUE_DEROGATION', 'DG', 'A_VENIR',
       COALESCE(d.subject_label, d.subject_id, left(d.id::text, 8)),
       'Dérogation à revoir : ' || d.type::text || ', accordée le ' ||
         to_char(d.granted_at, 'DD/MM/YYYY'),
       'derogations',
       d.granted_at
  FROM derogations d
 WHERE d.requires_monthly_review
   AND d.status::text = 'ACTIVE'
   AND (d.revoked_at IS NULL)
   AND (d.expires_at IS NULL OR d.expires_at > now())
   AND (d.reviewed_at IS NULL OR d.reviewed_at < now() - interval '1 month')

UNION ALL
-- 13. Opération en préparation qu'AUCUN modèle de checklist ne couvre.
--
--     Depuis que le verrou HSE refuse une validation sans point de contrôle,
--     une telle opération sera arrêtée au chargement. Autant le dire pendant
--     qu'on la prépare : découvrir au moment du départ qu'il manque un modèle,
--     c'est découvrir trop tard.
--
--     Un modèle ne s'applique qu'aux segments et modes de transport qu'il
--     déclare. Aujourd'hui un seul existe — B2B et RETAIL, par camion : toute
--     opération MARITIME tombe dans ce trou.
--
--     La tâche ne se déclenche QUE sur une opération réelle. Énumérer à
--     l'avance toutes les combinaisons segment × mode produirait une liste de
--     manques théoriques que personne n'a demandés.
SELECT 'MODELE_HSE_MANQUANT', 'HSE_CONTROLLER', 'BLOQUANT',
       o.reference,
       'Aucun modèle de checklist ne couvre ' || d.segment::text ||
         ' en ' || o.transport_mode::text || ' : l''opération sera bloquée au chargement',
       'referentiels',
       o.updated_at
  FROM operations o
  JOIN deals d ON d.id = o.deal_id
 WHERE o.status::text IN ('DRAFT', 'SOURCING', 'HSE_PREPARATION', 'HSE_BLOCKED', 'PLANNED')
   AND NOT EXISTS (
     SELECT 1
       FROM operation_hse_check_items i
       JOIN operation_hse_checks c ON c.id = i.check_id
      WHERE c.operation_id = o.id
   )
   AND NOT EXISTS (
     SELECT 1
       FROM hse_checklist_templates t
      WHERE t.is_active AND t.is_current
        AND (COALESCE(cardinality(t.applicable_segments), 0) = 0
             OR d.segment = ANY (t.applicable_segments))
        AND (COALESCE(cardinality(t.applicable_transport_modes), 0) = 0
             OR o.transport_mode = ANY (t.applicable_transport_modes))
   )

UNION ALL
-- 14. Aucun exercice comptable déclaré courant.
--
--     Tout le pilotage financier s'y rattache : taux de financement, budget de
--     charges fixes, prévision de volumes. Sans exercice, aucune de ces valeurs
--     n'a d'ancrage, et le point mort ne peut rien dire.
SELECT 'EXERCICE_MANQUANT', 'FINANCE_CFO', 'BLOQUANT',
       'Exercice comptable',
       'Aucun exercice n''est déclaré courant : le pilotage financier ne peut se rattacher à rien',
       'parametrage',
       now()
 WHERE exercice_courant() IS NULL

UNION ALL
-- 15. Exercice ouvert dont une donnée budgétaire manque.
--
--     Une par ligne manquante, pas une tâche fourre-tout : le CFO doit voir
--     LAQUELLE manque et à quoi elle sert, sinon il rouvre l'écran pour
--     chercher.
SELECT 'DONNEE_BUDGETAIRE', 'FINANCE_CFO', 'A_VENIR',
       'Exercice ' || c.exercice::text,
       c.donnee || ' non saisi, sert à : ' || c.sert_a,
       'parametrage',
       now()
  FROM v_couverture_budgetaire c
 WHERE NOT c.renseignee

UNION ALL
-- 16. Relances et actions commerciales échues (§ 15).
--
--     Adressées au CCOO plutôt qu'au commercial nommé : la file est filtrée par
--     RÔLE, pas par personne. Le responsable figure dans le libellé, ce qui
--     suffit à savoir qui relancer — et permet au CCOO de voir ce qui traîne
--     chez les siens, ce qui est précisément sa fonction.
SELECT 'RELANCE_CRM', 'CCOO',
       CASE WHEN a.retard_jours > 0 THEN 'BLOQUANT' ELSE 'A_VENIR' END,
       a.reference,
       a.objet || ' (' || a.responsable || ') : ' || a.action ||
         CASE WHEN a.retard_jours > 0
              THEN ', en retard de ' || a.retard_jours || ' jours'
              ELSE ', pour aujourd''hui' END,
       'crm',
       a.echeance::timestamptz
  FROM v_crm_alertes a
 WHERE a.nature IN ('RELANCE', 'ACTION_ETAPE')

UNION ALL
-- 17. Opportunité ouverte et jamais travaillée.
--
--     Distincte d'une relance en retard : c'est un dossier ouvert puis
--     abandonné, ou qui s'est essoufflé au-delà du délai paramétré sur son
--     étape. Personne ne l'a refusé — on l'a simplement oublié.
SELECT 'OPPORTUNITE_DORMANTE', 'CCOO', 'ANOMALIE',
       a.reference,
       a.objet || ' (' || a.responsable || ') : ' || a.action,
       'crm',
       a.echeance::timestamptz
  FROM v_crm_alertes a
 WHERE a.nature IN ('JAMAIS_CONTACTE', 'SANS_ACTIVITE')

UNION ALL
-- 18. Facture normalisée émise et jamais transmise à la DGI (§ 9.5).
--
--     ⚠️ LE DÉFAUT N'EST PAS L'ABSENCE DE TRANSMISSION, C'EST SON SILENCE.
--
--        L'accès à l'API DGI est une dépendance externe assumée par le § 9.5 —
--        elle doit être communiquée. En attendant, une FNE émise ouvre une
--        créance, porte un numéro de séquence fiscale, et reste indéfiniment en
--        attente SANS que rien ne le dise. L'audit en a trouvé quatre, dont une
--        déjà encaissée, invisibles de tout écran.
--
--        L'exposition grandit à chaque facture. Elle doit se voir.
SELECT 'FNE_NON_TRANSMISE', 'ACCOUNTANT',
       CASE WHEN now() - i.issued_at > interval '30 days' THEN 'BLOQUANT' ELSE 'A_VENIR' END,
       i.number,
       'Facture normalisée émise le ' || to_char(i.issued_at, 'DD/MM/YYYY') ||
         ' et non transmise à la DGI depuis ' ||
         extract(day FROM now() - i.issued_at)::int || ' jours',
       'facturation',
       i.issued_at
  FROM invoices i
  JOIN fne_transmissions t ON t.invoice_id = i.id
 WHERE i.type::text = 'FNE'
   AND i.issued_at IS NOT NULL
   AND t.status::text IN ('DRAFT', 'TO_VALIDATE', 'PENDING_TRANSMISSION', 'TO_CORRECT', 'REJECTED')

UNION ALL
-- 19. Affaire engagée dont tout n'a pas été facturé.
--
--     Dans le modèle d'Elyon, le volume commandé EST le volume livré et la facture
--     n'attend pas l'exécution. Une affaire en exécution ou close dont le cumul
--     facturé reste sous le contrat, c'est de la marchandise partie et non réclamée.
SELECT 'RESTE_A_FACTURER', 'ACCOUNTANT', 'A_VENIR',
       r.affaire,
       'Reste à facturer : ' || round(r.reste, 0) || ' ' || r.uom ||
         ' sur ' || round(r.contracte, 0) || ' contractés (' || r.client || ')',
       'facturation',
       now()
  FROM v_reste_a_facturer r
 WHERE r.a_facturer

UNION ALL
-- 20. Affaire facturée au-delà de son contrat.
--     Le verrou refuse désormais ce cas ; cette source couvre l'antérieur, qui ne
--     peut se régulariser que par un avoir ou une annulation explicite.
SELECT 'SUR_FACTURATION', 'FINANCE_CFO', 'ANOMALIE',
       r.affaire,
       'Facturé ' || round(r.deja_facture, 0) || ' ' || r.uom ||
         ' pour ' || round(r.contracte, 0) || ' contractés : à régulariser par avoir',
       'facturation',
       now()
  FROM v_reste_a_facturer r
 WHERE r.sur_facturee

UNION ALL
-- 21. Créance échue non encaissée (§ 13, module 6 — recouvrement).
--     Le statut OVERDUE existait dans l'énumération et n'était JAMAIS posé : une
--     facture échue restait ISSUED indéfiniment, et le recouvrement se faisait hors
--     de l'outil, ou pas du tout.
SELECT 'CREANCE_ECHUE', 'ACCOUNTANT',
       CASE WHEN c.retard_jours > 60 THEN 'BLOQUANT' ELSE 'ANOMALIE' END,
       c.piece,
       c.client || ' : ' || round(c.reste_du, 0) || ' ' || c.currency_code ||
         ' dus depuis ' || c.retard_jours || ' jours (' || c.tranche || ')',
       'facturation',
       (CURRENT_DATE - c.retard_jours)::timestamptz
  FROM v_creances_echues c
 WHERE c.retard_jours IS NOT NULL;

COMMENT ON VIEW v_taches IS
  'Ce que chacun doit traiter, DÉRIVÉ de l''état courant (§ 3). Une tâche existe tant que sa cause existe et disparaît d''elle-même : rien à fermer, donc rien à oublier de fermer.';


-- ---------------------------------------------------------------------------
--  Le décompte, pour la pastille du bandeau.
--
--  Une requête séparée et légère : l'écran l'appelle à chaque navigation, et
--  faire remonter la liste entière pour en compter les lignes coûterait cher
--  pour un chiffre.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_taches_par_role AS
SELECT role_attendu,
       count(*)                                        AS total,
       count(*) FILTER (WHERE urgence = 'BLOQUANT')    AS bloquantes,
       count(*) FILTER (WHERE urgence = 'ANOMALIE')    AS anomalies,
       count(*) FILTER (WHERE urgence = 'A_VENIR')     AS a_venir,
       min(depuis)                                     AS plus_ancienne
  FROM v_taches
 GROUP BY role_attendu;

COMMENT ON VIEW v_taches_par_role IS
  'Décompte des tâches par rôle attendu (§ 3). `plus_ancienne` dit depuis quand quelqu''un attend — c''est le chiffre qui compte, pas le total.';
