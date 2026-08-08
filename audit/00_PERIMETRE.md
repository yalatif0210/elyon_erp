# 00 — PÉRIMÈTRE, INCONNUES ET HYPOTHÈSES

Audit conduit selon `AUDIT_ERP.md`. Phase 0 close ; les phases suivantes attendent votre accord.

---

## 0. AVERTISSEMENT PRÉALABLE — CONFLIT D'INTÉRÊT

> **L'auditeur est l'auteur du système audité.**
>
> La quasi-totalité du code examiné a été écrite par moi, au cours des sessions de
> développement qui ont précédé cet audit. Le prompt demande un « auditeur technique
> indépendant » : cette indépendance n'est pas réunie.
>
> Conséquences pratiques, à garder à l'esprit à la lecture de tout ce qui suit :
>
> - **Angle mort de conception.** Un défaut qui découle d'une hypothèse que j'ai prise
>   sans la voir a de fortes chances de me rester invisible : je relis ma propre
>   compréhension du métier, pas une compréhension extérieure.
> - **Biais de justification.** Chaque choix discutable est accompagné, dans le code,
>   d'un commentaire qui l'explique. Un auditeur tiers jugerait le choix ; je risque de
>   juger l'explication.
> - **Ce qui reste valide malgré tout.** Les constats appuyés sur une preuve exécutée —
>   requête lancée, transaction annulée, appel d'API observé — ne dépendent pas de mon
>   jugement. Je privilégierai donc systématiquement la preuve exécutable sur la lecture.
>
> **Recommandation :** faire relire au minimum l'axe C (sécurité) et l'axe A (logique
> métier) par un tiers n'ayant pas participé à l'écriture. Le présent rapport doit être
> lu comme une **auto-évaluation documentée**, pas comme un audit indépendant.

---

## 1. PARAMÈTRES — RENSEIGNÉS, DÉDUITS, INCONNUS

Le bloc §1 du prompt a été laissé vide. Conformément à la consigne (« si un champ reste
vide, ne l'invente pas »), je distingue trois cas : ce qui est **établi** par le dépôt,
ce qui est **inféré**, et ce qui reste **inconnu**.

| Champ | Valeur | Statut |
|---|---|---|
| **Domaine métier** | Négoce, distribution et transport d'hydrocarbures (Fuel 180, MGO, Diesel, Essence), exploitation de barge, opérations terrain. Côte d'Ivoire. | `CONSTATÉ` — `README.md:3-4` |
| **Objet de l'ERP** | Piloter la chaîne Contrat → Affaire → Opération → Facture → Encaissement, sous contrainte de marge, de crédit et de conformité HSE. | `CONSTATÉ` — `SPECIFICATIONS.md` § 4, § 5, § 11 |
| **Référentiel** | `SPECIFICATIONS.md` (1 342 lignes, v3.0), `addedum_cahier_de_charge.md` (452 l.), `instructions.md` (69 l.), `README.md` (207 l.) | `CONSTATÉ` |
| **Stack** | Angular 18.2 + Tailwind 3.4 · NestJS 10.4 + Prisma 5.22 · PostgreSQL 16.4 · Redis 7.4 · Docker Compose · nginx | `CONSTATÉ` — `package.json`, `docker-compose.yml` |
| **Environnement cible** | **INCONNU** | Le dépôt ne contient aucune configuration de production : pas de fichier d'environnement de prod, pas de cible de déploiement, pas de nom de domaine, pas de terminaison TLS. L'orchestration décrit un poste de développement. |
| **Utilisateurs** | **PARTIELLEMENT INCONNU** — 9 rôles internes modélisés, 2 réalms externes (terrain, portail client). Le **nombre réel** d'utilisateurs et leur niveau d'aisance informatique ne sont pas déductibles du code. | `INFÉRÉ` pour les rôles, `INCONNU` pour le volume |
| **Enjeu financier** | **INCONNU** | Aucun chiffre d'affaires, volume annuel ou encours cible n'apparaît dans le référentiel. Les seuls ordres de grandeur présents sont des **valeurs d'illustration** explicitement signalées comme telles (§ 19). Toute évaluation d'impact chiffrée dans cet audit sera donc exprimée en **mécanisme** et non en francs, sauf mention contraire. |

> ⚠️ **L'enjeu financier inconnu limite le barème de sévérité.** Le prompt demande, pour
> chaque S1 et S2, « un chiffrage quand il est possible ». Sans volume d'affaires ni
> encours cible, il ne l'est pas. Je décrirai donc des scénarios d'exploitation concrets
> mais sans montant — et je signalerai ceux dont la gravité dépend précisément du volume.
> **Fournir ces deux chiffres améliorerait matériellement la priorisation.**

---

## 2. CARTE DU DÉPÔT

### 2.1 Arborescence

```
erp/
├── apps/
│   ├── api/                    NestJS — 16 modules
│   │   ├── src/                42 fichiers TS · 13 734 lignes
│   │   ├── prisma/
│   │   │   ├── schema.prisma   4 056 lignes · 68 modèles · 55 énumérations
│   │   │   ├── sql/            32 fichiers · 7 661 lignes de SQL métier
│   │   │   └── migrations/     57 migrations · 233 310 lignes
│   │   └── scripts/            prepare-migrations.mjs (injection du SQL métier)
│   └── web/                    Angular 18 — 57 fichiers · 15 307 lignes
├── docker/
│   ├── nginx/                  web.conf, security-headers.conf
│   └── postgres/initdb/        amorçage des rôles
├── docker-compose.yml          5 services (postgres, redis, api, web, migrator)
├── docker-compose.dev.yml
├── SPECIFICATIONS.md           référentiel — source de vérité déclarée
├── addedum_cahier_de_charge.md
├── instructions.md
└── README.md
```

### 2.2 Couches et responsabilités apparentes

| Couche | Emplacement | Volume | Rôle apparent |
|---|---|---|---|
| Interface | `apps/web/src/app/features/` | 24 écrans console + 13 écrans terrain | Saisie et restitution |
| Client d'API | `apps/web/src/app/core/api.service.ts` | ~1 900 lignes | Contrat d'échange typé |
| Points d'entrée | `apps/api/src/*/` | **22 contrôleurs, 135 routes** | Validation, autorisation |
| Règles métier | `apps/api/prisma/sql/` | 32 fichiers, 7 661 lignes | **Invariants tenus par la base** |
| Persistance | PostgreSQL 16 | 70 tables, 38 vues | Stockage et contraintes |

**Répartition des routes** : 74 `GET`, 38 `POST`, 22 `PATCH`, 1 `PUT`, **0 `DELETE`**.

> `INFÉRÉ` — L'absence totale de route de suppression suggère une politique
> d'irréversibilité (désactivation plutôt qu'effacement). À vérifier en axe A3.

### 2.3 Trois réalms d'authentification

| Réalm | Préfixe | Contrôleurs | Population |
|---|---|---|---|
| Interne | `api/internal/*` | 14 | 9 rôles (DG, CFO, CCOO, commercial, logistique, comptable, IT, assistant DG, HSE) |
| Terrain | `api/field/*` | 6 | agents et contrôleurs HSE |
| Portail client | `api/portal/*` | **1 — authentification seule** | 2 comptes actifs |

> `CONSTATÉ` — Le réalm portail expose la connexion, le rafraîchissement et la
> déconnexion, et **aucune route de données**. Vérifié par appel : jeton émis en 200,
> toutes les routes `api/portal/*` de données en 404, routes internes en 403.
> À traiter en phase 1 (couverture) comme fonction déclarée non couverte.

### 2.4 Gestion du schéma

`CONSTATÉ` — **Migrations versionnées**, pas de génération automatique. Mécanisme
particulier à noter : le SQL métier de `prisma/sql/` est **injecté** dans chaque
migration par `apps/api/scripts/prepare-migrations.mjs`, dans un ordre déclaré
explicitement. Conséquence : les contraintes et déclencheurs font partie de l'historique
de migration et sont rejoués à l'identique sur toute base neuve.

`prisma migrate status` → *« Database schema is up to date »*, 57 migrations.

---

## 3. SURFACE D'INTÉGRITÉ EN BASE

Relevé direct sur la base en fonctionnement :

| Élément | Nombre |
|---|---|
| Tables | 70 |
| Vues | 38 |
| Contraintes `CHECK` | 79 |
| Clés étrangères | 192 |
| Index uniques | 142 |
| Déclencheurs métier | 54 |
| Fonctions | 65 |

> `INFÉRÉ` — Ces volumes indiquent une intention de tenir les invariants **au niveau du
> moteur** plutôt que dans le code applicatif. C'est l'hypothèse centrale de
> l'architecture, et l'axe A devra la **tester** plutôt que la constater : un déclencheur
> présent n'est pas un déclencheur efficace.

---

## 4. HISTORIQUE ET GOUVERNANCE DU CODE

| Indicateur | Valeur | Statut |
|---|---|---|
| Commits | **2** | `CONSTATÉ` |
| Dernier commit | **2026-08-02**, auteur `unknown` | `CONSTATÉ` |
| Branches | `main`, `origin/main` | `CONSTATÉ` |
| Fichiers versionnés | **76** | `CONSTATÉ` |
| Fichiers non versionnés | **130** | `CONSTATÉ` |
| Fichiers suivis modifiés non validés | **45** | `CONSTATÉ` |

### ⚠️ CONSTAT MAJEUR DE PHASE 0 — LE DÉPÔT NE CONTIENT PAS LE SYSTÈME

`CONSTATÉ`. Le dernier commit date du 2 août. Depuis, cinq jours de travail sont **hors
de tout contrôle de version** : 130 fichiers jamais ajoutés, 45 fichiers suivis modifiés
sans validation. Parmi les non versionnés :

| Répertoire | Fichiers non versionnés |
|---|---|
| `apps/api/prisma/sql/` | 26 — **l'essentiel des invariants métier** |
| `apps/web/src/app/features/` | 17 écrans |
| `apps/web/src/app/core/` | 8 |
| divers `apps/api/src/` | ~6 modules |

**Mécanisme** : une perte du poste de travail, une erreur de manipulation ou un
`git clean` détruisent irrémédiablement l'intégralité des lots 3, 4 et des correctifs
d'audit. Le dépôt distant (`origin/main`) est figé au 2 août.

**Ce point sera formalisé en axe D (Reprenabilité / Continuité) au niveau S1.** Il est
signalé dès la phase 0 parce qu'il conditionne tout le reste : auditer un système dont
la seule copie vit sur un poste non sauvegardé change l'ordre des priorités.

---

## 5. TESTS — ÉTAT RÉEL

| Indicateur | Valeur |
|---|---|
| Fichiers `*.spec.ts` / `*.test.ts` dans le dépôt | **0** |
| Suites de recette existantes | 8 |
| Emplacement de ces suites | **hors du dépôt**, dans un répertoire temporaire de session |
| Cas couverts | 181, tous au vert au moment de l'audit |

`CONSTATÉ`. Les 181 cas existent, s'exécutent et passent — mais :

1. ils ne sont **pas versionnés** ;
2. ils vivent dans `AppData/Local/Temp/`, répertoire **conçu pour être effacé** ;
3. aucun mécanisme du dépôt ne permet de les rejouer (`npm test` n'est pas câblé) ;
4. un développeur tiers clonant le dépôt n'a **aucun moyen de savoir qu'ils existent**.

> ⚠️ **Le ratio code/tests demandé par le prompt vaut donc 0 pour le dépôt**, et non
> 181/181. La distinction est essentielle : une recette qui n'est ni versionnée ni
> rejouable ne protège pas les évolutions futures, elle documente un instant.

---

## 6. RÉFÉRENTIEL FONCTIONNEL — DISPONIBLE

`CONSTATÉ`. Le référentiel existe et est substantiel (2 070 lignes au total). La règle 5
du prompt (« si le référentiel est absent, dis-le et demande-le ») **ne s'applique pas** :
la phase 1 pourra s'appuyer sur `SPECIFICATIONS.md` comme source externe au code.

Deux réserves à porter en phase 1 :

- **Le référentiel a été co-écrit pendant le développement.** Il ne s'agit pas d'un
  cahier des charges figé en amont : certaines sections ont été précisées après coup.
  Le risque de raisonnement circulaire dénoncé par la règle 5 n'est donc pas nul — il est
  simplement déplacé du code vers la spécification. Là où une exigence semble décrire
  exactement l'implémentation, je le signalerai.
- **Le § 19 « Points ouverts » recense 6 décisions non tranchées**, dont trois valeurs
  financières (taux de financement, budget de charges fixes, contenu des regroupements de
  charges). Elles seront traitées en couverture comme **exigences en attente d'arbitrage**,
  et non comme des manques d'implémentation.

---

## 7. INCONNUES DÉCLARÉES

Conformément à la règle 4 (« les manques sont déclarés en tête de rapport ») :

| # | Inconnue | Effet sur l'audit |
|---|---|---|
| I1 | **Environnement cible** — aucun élément de production dans le dépôt | L'axe C ne pourra rien conclure sur le TLS, les origines croisées réelles, l'exposition des ports ni les sauvegardes. Tout sera `NON VÉRIFIABLE`. |
| I2 | **Volume d'affaires et encours cible** | Impossible de chiffrer les impacts. L'axe D (performance structurelle) évaluera « à la volumétrie cible » sans connaître cette cible — les conclusions seront exprimées en seuils de bascule. |
| I3 | **Nombre et profil réels des utilisateurs** | La séparation des tâches (axe C) sera jugée sur le **modèle de rôles**, pas sur son application réelle : neuf rôles distincts n'ont de sens que s'ils correspondent à neuf personnes. |
| I4 | **Procédure de sauvegarde et de restauration** | Aucune trace dans le dépôt. `NON VÉRIFIABLE`, et signalé comme tel. |
| I5 | **Conformité fiscale ivoirienne** | Le § 19 renvoie explicitement la validation au conseil fiscal du client. Hors périmètre de cet audit ; je vérifierai la **mécanique** (paramétrable, historisée), pas la **justesse fiscale**. |
| I6 | **API DGI / FNE** | Spécification non communiquée (§ 19, point 5). Le module de facturation normalisée sera audité sur sa préparation, pas sur son fonctionnement. |

---

## 8. HYPOTHÈSES DE TRAVAIL POUR LA SUITE

Je poursuivrai sur ces hypothèses. **Toute correction de votre part modifie les
conclusions** — c'est le moment de les contester.

| # | Hypothèse | Base |
|---|---|---|
| H1 | Le système **n'est pas en production**. Aucun utilisateur réel ne dépend de lui aujourd'hui. | Absence de configuration de production ; données en base de nature manifestement démonstrative (4 clients, références `CLI-00x`). |
| H2 | La cible est un **déploiement VPS unique**, mono-société, quelques dizaines d'utilisateurs. | Orchestration Docker Compose mono-hôte, pas de multi-société dans le modèle. |
| H3 | `SPECIFICATIONS.md` fait autorité en cas de divergence avec le code. | Déclaré comme « source de vérité unique » en `README.md:6`. |
| H4 | Les données actuellement en base sont un **jeu de démonstration**, non des données d'exploitation. | 4 clients, 227 opérations générées, adresses en `.example`. |
| H5 | L'axe « conformité comptable » (A13) se limite à la **mécanique OHADA/DGI préparée**, la validation métier relevant du conseil fiscal. | § 19, point 6. |

---

## 9. PLAN D'EXÉCUTION PROPOSÉ

| Phase | Livrable | Méthode dominante |
|---|---|---|
| 1 | `01_COUVERTURE_FONCTIONNELLE.md` | Matrice exigence ↔ code, puis **déroulé du cycle Contrat → Encaissement** jusqu'au premier point de rupture |
| A | `02_LOGIQUE_METIER.md` | Invariants A1→A13, chacun **testé par contournement** : requête directe au serveur, écriture directe en base |
| B | `03_COHERENCE.md` | Comparaison contrat client/serveur, cartographie des divergences |
| C | `04_SECURITE.md` | Autorisation d'abord (priorité du prompt), par appels réels avec jetons de rôles distincts |
| D | `05_ARCHITECTURE.md` | Frontières transactionnelles, intégrité base, reprenabilité |
| — | `99_SYNTHESE.md` | En dernier |

**Méthode privilégiée** : pour chaque invariant, je ne me contenterai pas de lire le
déclencheur — j'enverrai la requête interdite et j'observerai le refus. Compte tenu du
conflit d'intérêt déclaré au § 0, c'est la seule forme de preuve qui ne dépende pas de
mon jugement.

---

## 10. CE QUI EST DEMANDÉ AVANT DE POURSUIVRE

Le prompt impose un arrêt ici (§ 14.1). Trois questions dont les réponses changent la
suite :

1. **Confirmez-vous H1** — le système n'est pas en production, aucun utilisateur réel n'en
   dépend ? Si le système **est** exploité, l'ordre des priorités change entièrement.
2. **Pouvez-vous fournir I2** — un ordre de grandeur du volume annuel et de l'encours
   clients ? Sans lui, aucun impact ne sera chiffré.
3. **Le portail client est-il dans le périmètre** de la couverture fonctionnelle, ou
   explicitement reporté ? Il est déclaré au référentiel mais réduit à sa porte d'entrée.

---

*Phase 0 close. Aucune modification du code n'a été effectuée. Ce fichier est la seule
écriture réalisée.*
