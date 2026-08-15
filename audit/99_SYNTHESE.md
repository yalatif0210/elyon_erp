# 99 — SYNTHÈSE DE L'AUDIT

*Document de synthèse, rédigé après clôture des quatre axes (`02` à `05`). Chaque
affirmation renvoie à un constat détaillé et sourcé dans l'un de ces rapports ; ce
document ne réintroduit aucun fait nouveau non déjà établi ailleurs, à l'exception des
vérifications ponctuelles signalées explicitement ci-dessous, effectuées sur le code
actuel pour confirmer ou corriger des constats devenus périmés entre-temps.*

---

## 1. Verdict en une phrase

**L'ERP fait le job.** Les trois failles S1 qui l'en empêchaient — modification d'une
affaire d'autrui, absence de séparation des tâches sur les paiements, journal d'audit
illisible — et l'absence d'écran de création d'affaire ont toutes les quatre été fermées
et vérifiées en conditions réelles (appels HTTP directs, comptes de test distincts) après
la rédaction initiale de cette synthèse. Il reste un point S2 — le cloisonnement de la
facturation par commercial — et les points S2/S3 du plan de remédiation, aucun ne relevant
d'une faille de nature comparable.

---

## 2. État des cinq propriétés

| Propriété | État | Justification |
|---|---|---|
| **P1 Fidélité** | Partielle | Le cœur (volume facturé borné, arrondi centralisé) tient et est vérifié à l'exécution ; mais les quatre tables ajoutées le 15/08 acceptent un coût de maintenance négatif sans la moindre résistance (`vehicle_maintenance_events`, testé par écriture directe). |
| **P2 Intégrité** | Partielle | Encaissement et facturation bornée sont transactionnellement sûrs ; l'émission d'une facture normalisée (FNE) écrit en trois temps non protégés, et un échec de génération de PDF peut se solder sans trace ni tâche de rattrapage. |
| **P3 Invariance** | **Fermée le 15/08** | Le contrôle de propriété manquait sur les routes d'écriture des affaires et aucune séparation des tâches n'existait sur les paiements — les deux corrigés et vérifiés par appel HTTP réel entre comptes de test distincts (`verifierPropriete` sur `deals.controller.ts` ; `createdById`/`recordedById` sur factures client et fournisseur). |
| **P4 Traçabilité** | **Fermée le 15/08** | Le journal d'audit était correctement alimenté (67 lignes réelles, append-only) mais illisible depuis l'application. `GET /api/internal/audit-log`, réservé DG/IT_ADMIN, ouvert et vérifié (138 lignes retournées, 403 confirmé pour un autre rôle). |
| **P5 Restitution** | Partielle | Soldes et créances dérivés du journal sont fiables ; mais l'écran des affaires n'affiche pas 9 statuts sur 18 (dont un blocage crédit rendu invisible), et le registre documentaire perd le lien vers la pièce pour toutes les factures et avoirs. |

---

## 3. Les cinq problèmes qui comptent

1. ~~**[S1] Un commercial peut modifier n'importe quelle affaire, pas seulement les siennes.**~~ **Fermé le 15/08.** `setCostLines`, `attachSupplierPrice` et `submitForRisk` n'appliquaient pas le contrôle de propriété posé sur la lecture le 08/08. Un contrôle partagé (`verifierPropriete`) a été posé aux trois routes et à `findOne`, à qui il a été fusionné. Vérifié par appel HTTP réel entre deux comptes SALES_REP distincts créés pour l'occasion : les trois routes rendent désormais 403 sur l'affaire d'autrui, 200 sur la sienne.
2. ~~**[S1] Aucune séparation des tâches sur l'argent.**~~ **Fermé le 15/08.** Un même compte comptable pouvait créer une facture, l'émettre et encaisser le règlement — et, côté fournisseur, créer une facture ET déclencher son paiement. Un champ `createdById` (migration `20260815212434`) trace désormais qui a créé chaque facture client ; `recordedById` existait déjà côté fournisseur. Les deux routes d'encaissement/paiement refusent l'auteur de la pièce. Vérifié par appel réel entre deux comptes ACCOUNTANT distincts, des deux côtés (client et fournisseur) : 403 pour le créateur, 201 pour un second compte.
3. ~~**[S1] Le journal d'audit ne se lit nulle part.**~~ **Fermé le 15/08.** La traçabilité existait en base mais était inaccessible à l'application, y compris pour le rôle le plus élevé. `GET /api/internal/audit-log` (DG/IT_ADMIN) ouvert, paginé, filtrable. Vérifié : 138 lignes retournées pour le DG, 403 pour un compte ACCOUNTANT.
4. **[S2] Le cloisonnement financier s'arrête au module des affaires.** Un commercial voit 100 % des factures de l'entreprise (vérifié : `total: 3` sur 3 en base, aucun filtre appliqué) ; le coordinateur logistique retrouve la marge exacte de chaque affaire par simple soustraction, et celle de chaque barge sans même ce détour. Encore ouvert.
5. ~~**[S1] Aucune affaire ne peut être créée depuis la console interne.**~~ **Fermé le 15/08.** L'écran (`deal-create.component.ts`, route `/affaires/nouvelle`) et sa route serveur associée (`GET /api/internal/deals/lookups/contracts`) ont été construits et testés en direct — un compte SALES_REP a créé `DEAL-2026-08-006`, référence auto-générée. La construction a mis au jour deux dépendances jamais déclarées et bloquantes pour QUICONQUE aurait tenté cette action avant aujourd'hui : `fiscal_years` était une table vide (aucun exercice comptable n'a jamais existé) et `financing_rates` de même — sans les deux, tout calcul de marge échoue avec un 400. Corrigées via l'écran de paramétrage lui-même (exercice 2026, taux 10 %/an conforme à la valeur déjà confirmée avec le dirigeant), pas par écriture directe en base.

*Point corrigé en cours de clôture, après rédaction initiale de cette synthèse* : le
constat « le portail envoie des demandes qui n'arrivent jamais à un commercial » a été
refermé — `GET/PATCH /api/internal/quotations` et un écran dédié (`quotations.component.ts`,
onglet « Demandes de cotation ») donnent maintenant à voir et à trier les demandes
déposées depuis le portail, vérifié par appel direct (liste, passage « en étude »). Ce
correctif expose justement le point 5 ci-dessus par contraste : une demande se lit
désormais, mais rien ne permettait encore de la transformer en affaire, faute d'écran de
création — ce second maillon est fermé depuis (point 5 ci-dessus).

*Point vérifié et corrigé par rapport à `02_LOGIQUE_METIER.md`* : le bug qui faisait
qu'un seuil de marge « coupé » bloquait au lieu de relâcher le contrôle a été trouvé
corrigé **dans le fichier source** (`apps/api/prisma/sql/05_lot2_invariants.sql`) mais
**pas encore injecté dans une migration** au moment de la rédaction initiale de cette
synthèse. **Fermé dans la foulée** : migration `20260815132258_correction_trigger_seuil_marge`
générée et appliquée, fonction en base vérifiée porteuse du correctif
(`grep NOT m.is_active` sur `pg_proc` positif). Deux bugs distincts signalés par le même
rapport sur le module barge (unité de volume
mélangée, « prochaine échéance » qui affichait la dernière intervention passée) sont, eux,
bien corrigés — vérifié dans `apps/api/src/transport/barge.controller.ts:180-243` et
`apps/web/src/app/features/barge.component.ts:99-100`, code et libellé alignés.

---

## 4. Exploitable en production en l'état ?

**Oui, sous condition.** Les trois failles S1 de sécurité (section 3, points 1 à 3) et le
blocage fonctionnel qui s'y ajoutait (point 5, absence d'écran de création d'affaire) sont
tous fermés et vérifiés en conditions réelles depuis la rédaction initiale de cette
synthèse. Il reste le cloisonnement de la facturation (point 4, S2) à régler avant un
déploiement pleinement défendable, et le reste du plan de remédiation (section 5) à
dérouler dans les 30 jours puis le trimestre. Aucun de ces points restants ne relève de la
même gravité que les trois failles S1 refermées.

---

## 5. Plan de remédiation

| Action | Axe | Sévérité | Effort | Prérequis |
|---|---|---|---|---|
| **Avant mise en production** | | | | |
| ~~Porter le contrôle de propriété aux routes d'écriture de `deals.controller.ts`~~ | Sécurité | S1 | S | **Fait** — `verifierPropriete`, vérifié entre 2 comptes |
| ~~Interdire qu'un même acteur crée et émette/encaisse une pièce (client + fournisseur)~~ | Sécurité | S1 | M | **Fait** — maker-checker par personne, migration `20260815212434` |
| ~~Route de lecture du journal d'audit, réservée DG/IT_ADMIN, paginée~~ | Sécurité | S1 | S | **Fait** — `GET /api/internal/audit-log`, vérifié |
| Cloisonner la facturation par commercial + compléter le masquage de marge (deals + barge) | Sécurité | S2 | S/M | Aucun |
| ~~Injecter le correctif du seuil de marge déjà écrit dans une migration Prisma~~ | Métier | S3 | S | **Fait** — migration `20260815132258` appliquée |
| ~~Construire l'écran de création d'affaire~~ | Métier | S1 | M | **Fait** — `deal-create.component.ts`, testé (`DEAL-2026-08-006`) |
| **30 jours** | | | | |
| Ajouter les `CHECK` manquants sur les 4 tables / 2 colonnes du 15/08 | Métier | S2 | S | Aucun |
| Transactionner l'émission FNE (statut + `fne_transmissions`) + tâche en anti-jointure | Architecture | S2 | S | Aucun |
| Tracer l'échec définitif de génération PDF (statut + tâche de secours) | Architecture | S2 | S | Aucun |
| Faire respecter `mustChangePassword`/2FA obligatoire côté serveur (`JwtAuthGuard`) | Sécurité | S2 | M | Aucun |
| Chiffrer `FNE_API_KEY` au repos, l'exclure de la lecture en clair et du journal | Sécurité | S2 | M | Aucun |
| ~~Relier la demande de cotation portail à un écran/tâche commercial~~ | Métier | S2 | S | **Fait** — `GET/PATCH /api/internal/quotations` + écran |
| Sauvegarde planifiée + restauration testée et documentée | Sécurité | S2 | M | Choix d'infrastructure cible |
| **Trimestre** | | | | |
| Typer le module documents ; compléter l'affichage des 9 statuts d'affaire manquants | Cohérence | S2/S3 | S | Aucun |
| CI minimale rejouant `tests/recette/` ; réaligner `npm test` | Architecture | S3 | S/M | Aucun |
| Unifier la balance âgée sur `v_creances_echues` ; table de conversion volumes barge | Métier | S3 | S/M | Référentiel densité produit |
| Piste d'audit sur le pipeline CRM ; paramétrer la requête CRM concaténée | Sécurité | S3 | S | Aucun |
| Régénérer la carte du dépôt (`README.md`) | Architecture | S4 | S | Aucun |

---

## 6. Ce que l'audit n'a pas pu couvrir

- **Pas de relecture indépendante de l'axe sécurité** — l'auditeur est l'auteur du code
  audité sur cet axe, signalé par le rapport lui-même. Il faudrait une revue par un tiers
  sans lien avec le développement avant toute mise en production.
- **Aucun test d'intrusion outillé** (fuzzing, scan de vulnérabilités, brute force réel) —
  hors périmètre d'un audit en lecture seule. À faire une fois les correctifs S1 posés.
- ~~Les IDOR n'ont pas pu être démontrés par un accès croisé entre deux comptes réels~~
  **Fait, en refermant le correctif** : un second compte SALES_REP et un second compte
  ACCOUNTANT ont été créés pour l'occasion, et les trois scénarios d'accès croisé rejoués
  en conditions réelles (403 confirmé côté attaquant, 200/201 confirmé côté légitime).
  Les deux comptes de test (`commercial2@…`, `comptable2@…`) restent en base, à retirer
  ou requalifier avant la clôture définitive.
- **Comportement en production réelle** (TLS effectif, fréquence de redéploiement,
  rotation des secrets, volumétrie cible) : aucun environnement de production n'existe
  encore. Il faudrait une préproduction représentative, chargée à la volumétrie cible.
- **Le contenu du journal d'audit** n'a pas été relu ligne à ligne (mécanisme vérifié
  seulement). Une fois une route de lecture ouverte (§ 5), un contrôle d'échantillon
  serait à faire.
- **La justesse du mapping fiscal FNE** face au document DGI réel — aucun environnement
  de recette DGI disponible pour la vérifier.
