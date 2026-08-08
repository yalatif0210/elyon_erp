-- ===========================================================================
--  REMISE À ZÉRO DES ARTEFACTS DE RECETTE
--
--  ⚠️ POURQUOI CE FICHIER EXISTE.
--
--     Les suites de recette CRÉENT des données : exercices d'essai, prévisions,
--     opportunités, pièces de facturation, règlements. Sans remise à zéro, elles
--     passaient une fois et échouaient au second passage — « une ligne existe
--     déjà », « il ne reste que 25 L à facturer ».
--
--     Une recette qui ne passe qu'une fois documente un instant. Elle ne protège
--     rien, et elle finit par être désactivée parce qu'« elle échoue toujours ».
--     C'est précisément le reproche que l'audit du 8 août adressait à la recette
--     d'alors ; le corriger à moitié n'aurait rien corrigé.
--
--  ⚠️ ON ANNULE, ON NE SUPPRIME PAS — SAUF CE QUI N'ENGAGE RIEN.
--
--     Une pièce de facturation porte un numéro de séquence fiscale : l'effacer
--     ouvrirait un trou dans une numérotation que la loi veut continue. Les
--     pièces d'essai sont donc passées en ANNULÉ, statut que le système prévoit
--     et que ses verrous acceptent.
--
--     Les exercices, prévisions et opportunités d'essai n'engagent rien vis-à-vis
--     d'un tiers : ils se suppriment.
--
--  Exécuté par tests/recette/executer.py AVANT les suites.
-- ===========================================================================

-- --- Compteurs d'échecs de connexion ----------------------------------------
--
-- ⚠️ LA RECETTE ÉPROUVE LA PROTECTION CONTRE LE BRUTE FORCE, DONC ELLE LA
--    DÉCLENCHE.
--
--    `recette_dettes` tente délibérément de mauvais mots de passe pour vérifier
--    que le compte se verrouille. Le compteur survit à la campagne : au passage
--    suivant, un compte partiellement « brûlé » finit verrouillé pour de bon, et
--    la suite échoue sur un 401 qui n'a rien à voir avec ce qu'elle teste.
--
--    On remet donc les compteurs à zéro AVANT chaque campagne. On ne touche à
--    aucun mot de passe, et on ne désactive aucune protection : on efface une
--    trace de test, ce qui est exactement ce qu'on ferait à la main.
UPDATE users
   SET failed_login_attempts = 0, locked_until = NULL
 WHERE failed_login_attempts > 0 OR locked_until IS NOT NULL;

-- `field_users` ne porte pas de compteur d'échecs : seul `locked_until` existe.
UPDATE field_users
   SET locked_until = NULL
 WHERE locked_until IS NOT NULL;

-- --- Mot de passe du compte servant au test de changement -------------------
--
-- ⚠️ UNE SUITE QUI S'INTERROMPT NE FAIT PAS SON MÉNAGE.
--
--    `recette_dettes` change le mot de passe de l'assistante pour vérifier que
--    la route fonctionne, puis le remet à sa valeur d'origine — EN DERNIÈRE
--    LIGNE. Interrompue avant (limite de débit, réseau, Ctrl-C), elle laisse le
--    compte avec un mot de passe que plus aucune campagne ne connaît. Toutes
--    les suivantes échouent alors sur un 401 qui n'a rien à voir avec ce
--    qu'elles testent — c'est exactement ce qui est arrivé.
--
--    On recopie donc l'empreinte d'un compte de référence resté au mot de passe
--    d'amorçage. Aucun mot de passe n'est écrit ici, et rien n'est affaibli :
--    on rétablit un état connu du jeu de démonstration.
--
--    ⚠️ Ce fichier ne doit JAMAIS être joué sur une base d'exploitation. Il
--       appartient au harnais de recette.
UPDATE users a
   SET password_hash        = r.password_hash,
       must_change_password = true,
       failed_login_attempts = 0,
       locked_until          = NULL
  FROM users r
 WHERE a.email = 'assistante@elyon-trading.example'
   AND r.email = 'dg@elyon-trading.example'
   AND a.password_hash <> r.password_hash;

-- --- Règlements d'essai, reconnaissables à leur référence bancaire ----------
-- La suppression déclenche le recalcul du solde de la pièce : c'est voulu.
DELETE FROM payments WHERE bank_reference LIKE 'VIR-RECETTE-%';

-- --- Pièces de facturation d'essai sur l'affaire témoin ---------------------
-- On ne garde active QUE la pièce du jeu de démonstration. Tout le reste est
-- issu d'une campagne de recette et repasse en annulé, ce qui rétablit un
-- cumul facturé déterministe : 29 925 L sur 30 000 contractés.
UPDATE invoices i
   SET status = 'CANCELLED'
  FROM deals d
 WHERE d.id = i.deal_id
   AND d.reference = 'DEAL-2026-08-001'
   AND i.type::text IN ('SIMPLE', 'FNE')
   AND i.number <> 'FNE-2026-08-0001'
   AND i.status::text <> 'CANCELLED';

-- Les proformas d'essai n'engagent aucun volume (§ 9.3) : elles ne faussent
-- aucun cumul et restent en place, comme toute proforma abandonnée.

-- --- Opportunités commerciales d'essai --------------------------------------
DELETE FROM crm_opportunities WHERE title LIKE 'Recette CRM%';

-- --- Exercices comptables d'essai et tout ce qui s'y rattache ---------------
-- Les millésimes 2093 et au-delà sont réservés à la recette : aucun exercice
-- réel ne les atteindra.
DELETE FROM sales_forecasts
 WHERE fiscal_year_id IN (SELECT id FROM fiscal_years WHERE year >= 2093);
DELETE FROM fixed_cost_budgets
 WHERE fiscal_year_id IN (SELECT id FROM fiscal_years WHERE year >= 2093);
DELETE FROM financing_rates
 WHERE fiscal_year_id IN (SELECT id FROM fiscal_years WHERE year >= 2093);
DELETE FROM fiscal_years WHERE year >= 2093;
