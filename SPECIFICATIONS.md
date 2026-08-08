# SPÉCIFICATIONS ERP — ELYON TRADING

**Société :** Elyon Trading (désignée « Petro Distribution » dans le cahier de cadrage du 1ᵉʳ août 2026 — **même entité**, la dénomination Elyon Trading est retenue).
**Activité :** négoce, distribution et transport d'hydrocarbures (Fuel 180, MGO, Diesel, Essence), exploitation de barge, opérations terrain.
**Pays d'exploitation :** Côte d'Ivoire · **Devise pivot :** USD · **Devise locale :** XOF
**Statut :** Source de vérité unique. Absorbe `architecture.md` et `addedum_cahier_de_charge.md`.
**Version :** 3.0 — 2026-08-02

> Ce document est la **seule** référence fonctionnelle et technique. `instructions.md` définit le rôle et le processus de l'agent de développement et pointe vers ce document — il ne duplique aucune spécification.

---

## 0. CE QUI A CHANGÉ EN VERSION 3.0

La version 2 décrivait un négoce **back-to-back sans stock**, à six modules. Le cahier de cadrage du 1ᵉʳ août élargit le périmètre à un ERP de distribution intégré. Les évolutions structurantes :

| Sujet | v2 | v3 |
| :--- | :--- | :--- |
| Modèle d'affaires | Back-to-back exclusif, jamais de stock | Back-to-back **et** sur stock — le mode d'approvisionnement devient un attribut de l'opération |
| Entité pivot | `Deal` unique | Hiérarchie **Contrat → Deal → Opération** |
| Segments | Un seul | **Maritime · B2B · Retail**, avec formules de prix distinctes |
| Verrous | Finance seul | **Finance · HSE · Conformité transport** |
| Facturation | Proforma / Facture définitive | **Proforma · Facture simple · FNE**, pilotées par moteur de règles |
| Terrain | — | **Application tablette hors connexion** |
| HSE | — | Intégré au workflow, bloquant, avec rapport d'exécution |
| Référence de prix | Platts | **SIR · prix à la pompe DGH · fournisseur · contractuel** — références consultables, prix toujours ferme |

**Différé, à traiter ultérieurement :** comptabilité générale et analytique, trésorerie et rapprochements bancaires, RH et paie. Les axes analytiques sont néanmoins posés dès maintenant (§ 14) pour éviter une reprise douloureuse.

---

## 1. DÉCISIONS D'ARCHITECTURE

### 1.1. Stack retenue

| Couche | Technologie |
| :--- | :--- |
| **Frontend interne** | **Angular 18+** (standalone components, signals) |
| **Frontend extranet** | **Angular + SSR** (`@angular/ssr`), application **séparée** |
| **Application terrain** | **Angular + Capacitor**, hors connexion (§ 10) |
| **UI Kit** | **TailwindCSS** + **Angular CDK**, primitives internes dans l'idiome Shadcn/Spartan · icônes Lucide intégrées (§ 17.3) |
| **Backend** | **NestJS** (TypeScript) |
| **ORM** | **Prisma** |
| **Base de données** | **PostgreSQL 16** |
| **Cache / Sessions** | **Redis** |
| **Jobs asynchrones** | **BullMQ** |
| **Génération PDF** | Templating serveur + moteur headless |

**Écartés explicitement :** React/Next.js, Vue.js, Django, FastAPI, Celery, Shadcn/UI React, Lucide React, PWA pure pour le terrain.

### 1.1 bis. Exigence transverse — tout est paramétrable

> **Toute donnée dont l'ERP a besoin pour fonctionner doit être administrable de deux façons : par une interface de saisie, et par import de fichier.**

Cette exigence vaut pour **tous les lots**, pas seulement les référentiels du lot 1. Elle a trois conséquences de conception :

| Conséquence | État |
| :--- | :--- |
| Aucune constante métier dans le code — seuils, taux, tolérances, règles fiscales, checklists, formules | Appliqué |
| Chaque table administrable expose une **interface de saisie unitaire** | **Livré** — écran *Paramétrage* |
| Chaque table administrable accepte un **import de fichier** avec rapport de rejet ligne à ligne | **Livré** |

**Mise en œuvre : un REGISTRE, pas dix contrôleurs.** Chaque référentiel se déclare dans `apps/api/src/referentials/registry.ts` — colonnes, types, valeurs admises, obligations, rôles habilités, mise en garde. L'API d'écriture, l'import, le rapport de rejet et l'écran en découlent tous. **Ajouter un référentiel est une déclaration, pas un développement** — seule façon de tenir l'exigence au-delà des premières tables.

> ⚠️ **Les valeurs admises sont DÉRIVÉES des énumérations Prisma**, jamais recopiées. Une liste tenue à la main diverge du schéma sans prévenir : la saisie accepte une valeur que la base refuse, et le défaut ne se découvre que sur la ligne d'un utilisateur.

**Deux natures d'écriture, à ne pas confondre :**

| Nature | Comportement | Exemples |
| :--- | :--- | :--- |
| `mutable` | Correction sur place. Une faute de frappe n'est pas un fait historique. | Devises, produits, postes de coûts, paramètres système |
| `historised` | **Rien n'est jamais réécrit.** L'écriture clôt la ligne en vigueur à la veille et en crée une nouvelle. Motif obligatoire. | Taux de change, seuils de marge, tolérances d'ullage, prix administrés |

L'historisation n'est pas une précaution d'archiviste : un taux, un prix ou un seuil **gouvernent des calculs déjà produits**. Les réécrire falsifierait rétroactivement des factures émises et des approbations données.

**L'import ne s'arrête pas à la première faute.** Les lignes valides passent ; les autres sont rendues avec leur **numéro tel qu'il apparaît dans le tableur** — l'entête occupant la ligne 1 — et la raison exacte. Un import tout ou rien sur trois cents lignes se solde par un abandon. Un mode **simulation** rend le rapport sans rien écrire.

Les nombres acceptent la **virgule décimale** et l'espace comme séparateur de milliers, les dates le format **jour/mois/année** : c'est ce qu'un tableur francophone produit, et refuser « 1 234,56 » ferait rejeter un fichier légitime.

Les trois modes d'alimentation se distinguent et ne réclament pas le même soin :

- **Reprise** (tiers, sites, véhicules, chauffeurs, pièces de conformité) — volume élevé, une seule fois. L'import prime ; la saisie unitaire ne sert qu'aux corrections.
- **Données vivantes** (taux de change, prix administrés, prix fournisseurs, renouvellements) — la friction de saisie se paie en justesse des chiffres. Un taux difficile à mettre à jour ne sera pas mis à jour, et toute la facturation dérive.
- **Paramètres de gouvernance** (devises, seuils, tolérances, postes de coûts, taux d'absorption) — rares mais lourds de conséquence. Ce qui compte n'est pas la facilité de saisie mais la **traçabilité** : motif obligatoire, versionnement, ancienne valeur conservée.

**Le paramétrage porte aussi sur l'ACTIVATION, pas seulement sur la valeur.** Chaque contrôle — seuils de marge, seuils d'ullage, verrous, règles de blocage — doit à terme pouvoir être **activé ou désactivé** sans redéploiement. Un contrôle dont on ne peut que régler la valeur reste un contrôle subi.

> ⚠️ **Conséquence de conception, à anticiper dès maintenant.** Les invariants portés par PostgreSQL — `CHECK`, triggers — ne se coupent pas depuis l'application. Un contrôle prévu comme débrayable doit **lire son interrupteur en base** au moment où il s'applique ; sinon le désactiver exigera une migration, et l'exigence sera trahie sans qu'on s'en aperçoive. Le tri entre « invariant dur, jamais débrayable » et « règle de gestion débrayable » est donc une décision à prendre **par contrôle**, en fin de construction de chaque lot.

### 1.2. Style d'architecture

**Monolithe modulaire** — un backend NestJS unique, découpé en modules métier isolés, communiquant par services applicatifs et non par HTTP. Les microservices sont écartés : la volumétrie ne justifie pas le coût opérationnel d'un système distribué.

Modules : `referentials` · `crm` · `sales` · `procurement` · `operations` · `hse` · `transport` · `barge` · `invoicing` · `fiscal` · `field` · `admin` · `portal`.

### 1.3. Trois périmètres d'exposition cloisonnés

L'entreprise est un **tenant unique**. Le cloisonnement est un filtrage par ligne doublé d'un typage strict :

| Périmètre | Préfixe | Voit |
| :--- | :--- | :--- |
| **Interne** | `/api/internal` | Selon la matrice RBAC § 3 |
| **Portail client** | `/api/portal` | Ses propres données, filtrées par `partner_id` du JWT |
| **Terrain** | `/api/field` | Ses opérations affectées + **vue terrain** du client (§ 10.3) |

Chaque périmètre expose des **DTO dédiés** qui ne *contiennent* structurellement pas les champs interdits — marge, prix d'achat, encours, fournisseur. L'isolation est garantie par le typage, jamais par un masquage a posteriori.

### 1.4. Sécurité

- **Authentification :** JWT (access court + refresh rotatif), révocation via Redis.
- **2FA (TOTP) obligatoire** pour `DG`, `FINANCE_CFO`, `ACCOUNTANT`, `IT_ADMIN`, `HSE_CONTROLLER`.
- **RBAC** selon § 3.3, appliqué par guards NestJS **et** vérification d'état en base (§ 11).
- **Trois réalms d'authentification distincts** : `User` (interne), `PortalUser` (client), `FieldUser` (terrain). Trois tables séparées — aucune élévation de privilège par confusion de rôle n'est structurellement possible.
- **Secrets** hors du code. Mots de passe en Argon2id (paramètres OWASP).
- **Audit trail immuable** : toute action sur prix, marge, limite de crédit, approbation, facture, dérogation est journalisée en append-only. Garanti par trigger PostgreSQL, pas par convention applicative.
- **Moindre privilège en base** : `erp_migrator` (DDL, migrations uniquement) et `erp_app` (DML seul, aucun DDL, aucun `DELETE`/`UPDATE` sur l'audit).
- **Terrain :** stockage local chiffré, verrouillage par code ou biométrie, effacement à distance (§ 10.5).

**Compte de l'utilisateur — écran *Mon compte*.**

Tous les comptes naissent avec un mot de passe provisoire et l'obligation de le changer. Trois exigences au changement, chacune pour une raison précise :

| Exigence | Pourquoi |
| :--- | :--- |
| L'**ancien mot de passe est redemandé**, malgré la session authentifiée | Un poste laissé ouvert ne doit pas suffire à s'approprier un compte |
| Le nouveau doit **différer** de l'ancien | Sans ce contrôle, l'obligation se satisfait en resaisissant le même, et le mot de passe distribué à tous survit |
| **Toutes les autres sessions sont révoquées**, la courante épargnée | Un mot de passe changé après compromission ne vaut rien si le jeton déjà volé fonctionne jusqu'à son expiration |

**Politique : 12 caractères, aucune règle de composition.** Choix délibéré — les exigences de familles de caractères produisent des variantes prévisibles du même mot (« Elyon2026! », puis « Elyon2027! »). La longueur résiste mieux, conformément aux recommandations actuelles du NIST.

> ⚠️ **L'écran ne doit jamais être plus sévère que le serveur.** Une règle affichée mais non appliquée trompe ; une règle appliquée mais non affichée se découvre par un refus. Les deux doivent énoncer la même chose.

**Enrôlement du second facteur** sur le même écran : le secret n'est affiché qu'**une fois**, `totpEnabled` ne passe à vrai qu'après vérification d'un code — activer avant preuve enfermerait l'utilisateur dehors.

### 1.5. Conteneurisation & déploiement

Docker Compose. Services : `postgres` · `redis` · `api` · `web` · `portal`.

| Norme | Mise en œuvre |
| :--- | :--- |
| Segmentation réseau | Réseaux `edge` et `data` (`internal: true`). PostgreSQL et Redis injoignables de l'extérieur. |
| Utilisateur non privilégié | Aucun conteneur applicatif en `root`. |
| Escalade | `no-new-privileges:true` partout. |
| Capabilities | `cap_drop: ALL`. |
| Système de fichiers | `read_only: true` sur l'API, `tmpfs` pour `/tmp`. |
| Images | Alpine, versions **épinglées**. Build multi-stage. |
| Secrets | Jamais dans l'image ni dans le compose. |
| Supervision | `healthcheck` + `depends_on: service_healthy`. |
| Ressources | Limites CPU et mémoire déclarées. |
| PID 1 | `init: true`. |

---

## 2. ORGANISATION

```
                          ┌─────────────────────────────┐
                          │      DIRECTION GÉNÉRALE     │
                          │   Directeur Général (DG)    │
                          └──────────────┬──────────────┘
                                         │
          ┌──────────────────────────────┼──────────────────────────────┐
          │                              │                              │
┌─────────┴──────────┐                   │                  ┌───────────┴───────────┐
│ Assistante de      │                   │                  │ Ingénieur Informatique│
│ Direction          │                   │                  │ (SI & IT)             │
└────────────────────┘                   │                  └───────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
   ┌─────────────┴──────────────┐                  ┌─────────────┴──────────────┐
   │ DIRECTION COMMERCIALE      │                  │ DIRECTION FINANCIÈRE       │
   │ & OPÉRATIONS (CCOO)        │                  │ & ADMINISTRATIVE (CFO)     │
   └─────────────┬──────────────┘                  └─────────────┬──────────────┘
                 │                                               │
     ┌───────────┼───────────┬──────────────┐          ┌─────────┴──────────┐
     │           │           │              │          │ Comptable /        │
┌────┴─────┐ ┌───┴──────┐ ┌──┴─────────┐ ┌──┴───────┐  │ Chargé Recouvrement│
│ Chargé   │ │ Coord.   │ │ Agent      │ │Contrôleur│  └────────────────────┘
│ Clientèle│ │ Logist.  │ │ d'opération│ │   HSE    │
│ & Devis  │ │& Sourcing│ │ (terrain)  │ │(terrain) │
└──────────┘ └──────────┘ └────────────┘ └──────────┘
```

**Lecture pour le système :** le CCOO est le supérieur hiérarchique du Chargé de Clientèle, du Coordinateur Logistique et des équipes terrain. Le CFO est le supérieur du Comptable. Cette hiérarchie est la clé de lecture de la matrice § 3.3.

**Le chauffeur n'est pas utilisateur du système.** Il relève de la responsabilité de l'agent d'opération. Il est une **donnée de conformité** (§ 6.4) et un **signataire** (§ 12.3), jamais un compte.

---

## 3. RÔLES & DROITS

### 3.1. Les principaux

| Code | Fonction | Rattachement | Réalm | 2FA |
| :--- | :--- | :--- | :--- | :---: |
| `DG` | Directeur Général | — | Interne | ✅ |
| `ASSISTANT_DG` | Assistante de Direction | DG | Interne | — |
| `IT_ADMIN` | Ingénieur Informatique | DG | Interne | ✅ |
| `CCOO` | Directeur Commercial & Opérations | DG | Interne | — |
| `SALES_REP` | Chargé de Clientèle & Devis | CCOO | Interne | — |
| `LOGISTICS_COORD` | Coordinateur Logistique & Sourcing | CCOO | Interne | — |
| `FINANCE_CFO` | Directeur Financier | DG | Interne | ✅ |
| `ACCOUNTANT` | Comptable / Chargé Recouvrement | CFO | Interne | ✅ |
| `FIELD_AGENT` | Agent d'opération terrain | CCOO | **Terrain** | — |
| `HSE_CONTROLLER` | Contrôleur HSE | CCOO | **Terrain** | ✅ |
| `CLIENT_PORTAL` | Client externe | — | **Portail** | option |

### 3.2. Séparation des tâches — invariants non négociables

1. **L'agent d'opération ne peut jamais valider un contrôle HSE bloquant.** Celui qui exécute ne valide pas sa propre conformité — c'est le fondement même du verrou HSE.
2. Aucun rôle ne cumule *validation crédit* et *facturation finale* en écriture, à l'exception du CFO. Ses actions dans les deux domaines sur un même Deal sont signalées pour revue du DG.
3. `SALES_REP` n'a **aucun** accès en écriture à la logistique ni aux opérations.
4. `IT_ADMIN` n'a **aucun** accès aux données métier. Ses actions sont intégralement auditées.
5. Aucun rôle ne peut modifier ni supprimer une entrée d'audit trail.
6. `FIELD_AGENT` et `HSE_CONTROLLER` n'accèdent à **aucune** donnée commerciale (prix, marge, encours, facture).

### 3.3. Matrice RBAC

**RW** = lecture + écriture · **R** = lecture seule · **—** = aucun accès · *(P)* = périmètre propre

| Rôle | Portail | CRM | Devis / Proforma | Validation crédit | Opérations | HSE | Terrain | Facturation | Recouvrement | Admin / GED |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `CLIENT_PORTAL` | RW *(P)* | — | R *(P)* | — | R *(P)* | — | — | R *(P)* | — | — |
| `DG` | R | R | R | Exception | R | R | R | R | R | R |
| `ASSISTANT_DG` | — | R | R | — | R | R | — | R | — | RW *(GED)* |
| `CCOO` | R | **RW** | **RW** | — | **RW** | R | R | — | — | — |
| `SALES_REP` | R | **RW** | **RW** | — | R | — | — | — | — | — |
| `LOGISTICS_COORD` | R | R | R | — | **RW** | R | R | — | — | — |
| `FINANCE_CFO` | R | R | R | **RW** | R | R | — | **RW** | **RW** | — |
| `ACCOUNTANT` | — | R | R | — | R | R | — | **RW** | **RW** | — |
| `FIELD_AGENT` | — | — | — | — | RW *(P)* | R *(P)* | **RW** *(P)* | — | — | — |
| `HSE_CONTROLLER` | — | — | — | — | R | **RW** | **RW** | — | — | — |
| `IT_ADMIN` | — | — | — | — | — | — | — | — | — | **RW** |

### 3.4. Suppléance du contrôleur HSE

L'entreprise ne compte **qu'un seul contrôleur HSE**. Le verrou HSE bloque le chargement : son indisponibilité arrêterait toute exécution, et l'agent ne peut pas se substituer à lui sans vider le verrou de son sens.

**Mécanisme retenu — suppléance explicite et temporaire :**

- Le **DG est suppléant de droit**, cohérent avec son rôle d'arbitre (§ 11.2).
- La suppléance est un **acte tracé** : date de début, date de fin, motif. Jamais un droit permanent attaché au rôle.
- Elle apparaît au **registre des dérogations** (§ 11.4).
- Toute validation effectuée en suppléance porte la mention du titre auquel elle a été rendue.

---

## 4. STRUCTURE MÉTIER : CONTRAT → DEAL → OPÉRATION

### 4.1. Trois niveaux, deux machines à états

Le cahier de cadrage décrit quatorze étapes qui, à la lecture, mêlent **deux niveaux d'abstraction** : le flux part du commercial, descend dans l'exécution physique, puis remonte au commercial. Une machine à états linéaire ne peut pas le représenter — et c'est précisément là que le verrou financier se perdait.

```
┌────────────────────────────────────────────────────────────────────┐
│  CONTRAT (facultatif)  —  accord-cadre                             │
│  CTR-2026-014 · client, produits, conditions de prix, validité     │
└──────────────────────────────┬─────────────────────────────────────┘
                               │  1 → N   (un Deal peut exister sans contrat)
┌──────────────────────────────┴─────────────────────────────────────┐
│  DEAL — Dossier d'Affaire          (commercial & financier)         │
│  DEAL-2026-08-001                                                   │
│                                                                     │
│  Brouillon → Étude faisabilité → Chiffrage → Proforma               │
│      → ══════ VERROU FINANCE (CFO) ══════ → Accord client           │
│      → [exécution] → Facturation → Clôture                          │
└──────────────────────────────┬─────────────────────────────────────┘
                               │  1 → N
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│ OP-2026-000154│     │ OP-2026-000155│     │ OP-2026-000156│
│                OPÉRATION — exécution physique              │
│  Appro → ═════ VERROU HSE ═════ → Planification            │
│       → Chargement → Transport → Livraison → Contrôle final│
│       → Rapport d'exécution signé                          │
└───────────────┘     └───────────────┘     └───────────────┘
```

**Ce que ce découpage résout :**

- **Le verrou financier retrouve un point unique.** La règle n'est plus « pas d'ordre d'achat sans feu vert CFO » mais **« aucune Opération ne peut exister sur un Deal non approuvé »** — un seul contrôle verrouille toute l'exécution en amont.
- **Les livraisons multiples deviennent naturelles.** Un contrat minier livré en douze rotations : 1 Deal, 12 Opérations. Une station approvisionnée chaque semaine : 1 Deal annuel, N Opérations.
- **Le terrain est cloisonné par construction.** L'opérateur ne voit que des Opérations. Le Deal — prix, marge, encours — n'existe pas dans son périmètre.
- **La rentabilité par opération** du § 14 devient calculable : chaque Opération porte ses coûts réels, le Deal agrège.

**Ergonomie.** Quand Deal et Opération sont en 1-to-1 (soutage maritime typique), l'utilisateur voit **un seul écran** : l'Opération est créée automatiquement et reste transparente. Le double objet n'apparaît qu'à partir de la deuxième opération.

**Le contrat est facultatif.** Un Deal peut exister sans accord-cadre.

### 4.2. Machine à états du Deal

| État | Acteur autorisé | Garde |
| :--- | :--- | :--- |
| `DRAFT` | `SALES_REP`, `CCOO`, `CLIENT_PORTAL` | — |
| `FEASIBILITY_STUDY` | `SALES_REP`, `CCOO` | — |
| `QUOTED` | `SALES_REP`, `CCOO` | Structure de prix complète, marge prévisionnelle calculée |
| `PENDING_RISK` | `SALES_REP`, `CCOO` | Proforma soumise |
| `CREDIT_BLOCKED` | Système | Dépassement de limite de crédit |
| `PENDING_DG_APPROVAL` | Système | **Marge prévisionnelle sous le seuil** (§ 5.4) |
| `APPROVED` | **`FINANCE_CFO` seul** | Contrôle crédit OK **et** marge ≥ seuil |
| `APPROVED` *(dérogation)* | **`DG` seul** | Depuis `PENDING_DG_APPROVAL`, motif obligatoire, audité |
| `PROFORMA_SENT` | `SALES_REP`, `CCOO` | PDF généré |
| `CUSTOMER_ACCEPTED` | `CLIENT_PORTAL`, `SALES_REP` | Bon pour accord horodaté |
| `IN_EXECUTION` | Système | ≥ 1 Opération créée |
| `DELIVERED` | Système | Toutes les Opérations en `CLOSED` |
| `INVOICED` | `FINANCE_CFO`, `ACCOUNTANT` | Facturation émise (§ 9) |
| `CLOSED` | `FINANCE_CFO` | Encaissement intégral rapproché |

**Chemins non nominaux :** `REJECTED_BY_CLIENT` · `PARTIALLY_DELIVERED` · `QUALITY_CLAIM` · `DISPUTED` · `CANCELLED` (motif obligatoire, impossible dès qu'une Opération est engagée auprès d'un fournisseur — dénouement par avoir).

### 4.3. Machine à états de l'Opération

| État | Acteur | Garde |
| :--- | :--- | :--- |
| `DRAFT` | `LOGISTICS_COORD`, `CCOO` | **Deal en `APPROVED` ou au-delà** — verrou finance |
| `SOURCING` | `LOGISTICS_COORD` | Mode d'approvisionnement défini (§ 4.4) |
| `HSE_PREPARATION` | `FIELD_AGENT`, `HSE_CONTROLLER` | Checklist applicable déterminée par le niveau de risque |
| `HSE_BLOCKED` | `HSE_CONTROLLER` | Contrôle bloquant non satisfait |
| `PLANNED` | `LOGISTICS_COORD` | **Contrôles HSE validés** + moyens conformes (§ 6.4) |
| `LOADING` | `FIELD_AGENT` | Autorisation de chargement, jaugeage initial |
| `IN_TRANSIT` | `FIELD_AGENT` | Volume chargé relevé et signé |
| `DELIVERING` | `FIELD_AGENT` | Site sécurisé |
| `FINAL_CHECK` | `FIELD_AGENT`, `HSE_CONTROLLER` | Volume livré relevé, écart calculé (§ 8) |
| `CLOSED` | `HSE_CONTROLLER` | Rapport d'exécution généré et signé (§ 12) |

**Non nominaux :** `INCIDENT` · `NON_CONFORMITY` · `CANCELLED`.

### 4.4. Mode d'approvisionnement

Le back-to-back n'est plus une propriété du système mais un **attribut de l'Opération** :

| Mode | Description | Statut |
| :--- | :--- | :--- |
| `BACK_TO_BACK` | Achat fournisseur dédié, sans stock. Relation 1-to-1 avec la commande d'achat. | Actif |
| `FROM_STOCK` | Prélèvement sur stock détenu (dépôt, barge). | **Modélisé, activé ultérieurement** |
| `THIRD_PARTY_PRODUCT` | Produit appartenant au client ou à un tiers. **Jamais valorisé au stock Elyon.** Seule la prestation est facturée. | Modélisé |

La contrainte d'unicité 1-to-1 entre Opération et commande d'achat ne s'applique **que** au mode `BACK_TO_BACK`. Le schéma n'interdit plus les autres modes : l'évolution vers le stock ne demandera pas de migration destructive.

---

## 5. SEGMENTS, PRIX ET MARGE

### 5.1. Le segment donne un défaut, jamais une règle

Trois segments commerciaux — **Maritime**, **B2B** (minier, BTP, industriel, public), **Retail** (stations-service). Chacun porte une **formule de facturation par défaut**.

> **Un segment peut être facturé différemment au besoin.** La formule appliquée est un attribut du **Deal**, initialisé depuis le segment du client et **surchargeable**, avec traçabilité du choix et de son auteur.

### 5.2. Un seul modèle, trois segments

**Décision du 5 août 2026 — le prix à la pompe est abandonné comme base de formation du prix.** Les trois segments suivent désormais le MÊME modèle, celui de la facturation :

| Ce que le commercial fixe | Ce que le système reprend | Ce qu'il calcule |
| :--- | :--- | :--- |
| Le **prix de vente**, librement | Le **prix d'achat**, d'un prix fournisseur validé par le DG (§ 6.3) | Les **marges**, directe et complète |
| Les **coûts afférents**, postes sélectionnés au barème (§ 5.4) | Le **portage financier**, du cycle de trésorerie | L'**absorption** des charges indirectes (§ 14.2) |

Il n'y a plus de formule par segment. Ce qui varie d'un segment à l'autre, ce sont les **paramètres** — grille de seuils, barème de coûts, taux d'absorption, tolérances d'ullage — tous administrables (§ 1.1 bis), jamais le mode de calcul.

> **Pourquoi ce retrait.** Une formule qui dérive le prix de vente d'un prix publié par un tiers fait dépendre la marge d'Elyon d'une décision qui lui échappe, et impose au système de rester synchrone d'une publication dont il ne maîtrise ni la périodicité ni la structure. Le § 5.3 l'avait déjà écarté du calcul du coût ; il est maintenant écarté de la formation du prix. **Deux valeurs seulement gouvernent la marge : le prix de vente fixé et le prix d'achat sourcé.**

- La **réduction commerciale** s'exprime au choix en montant par unité, en pourcentage ou en montant fixe — dans les trois segments (§ 9).
- Le **coût complet** intègre achat, transport, administration, coûts opérationnels **et HSE**, remises et taxes.
- **Le prix de vente reste distinct du prix réel d'achat.** Le système ne dérive jamais l'un de l'autre.

*Historique : quatre formules par segment avaient été décrites, dont deux adossées au prix à la pompe — maritime non exonéré et cession retail. Aucune n'a jamais été implémentée : le code ne dérivait déjà aucun prix. Le retrait aligne le document sur le système, et le système sur une règle unique.*

### 5.3. Prix administrés — une référence, pas un moteur

**Décision du 2026-08-02 : le système ne dérive aucun prix.** Deux valeurs seulement gouvernent la marge — **le prix de vente que le commercial fixe** et **le prix d'achat réellement payé**. Que le prix de vente soit égal au prix à la pompe, à la pompe moins une réduction, ou à tout autre montant négocié, ne regarde pas le système : il enregistre la valeur fixée.

Le prix à la pompe est **publié par la DGH**, à **périodicité variable** ; le prix SIR est fixé par la SIR. Ils sont **paramétrables et horodatés**, jamais codés en dur, jamais écrasés : chaque publication est une nouvelle ligne datée.

Leur **rôle unique** : une référence que le commercial consulte au moment de fixer son prix. Un champ de commentaire libre permet d'y noter une décomposition indicative — prix d'achat marketeur, marge marketeur, marge station — sans qu'aucune contrainte ne la vérifie ni ne s'en serve.

> Depuis le 5 août 2026, ce rôle de simple référence est le **seul** que ces prix conservent : aucune formule ne s'y adosse plus, dans aucun segment (§ 5.2).

> ⚠️ **Un prix administré n'alimente jamais un coût.** Le coût d'achat provient exclusivement d'un **prix fournisseur validé** (§ 6.3). C'est le seul invariant qui compte ici, et il porte sur le coût, pas sur la structure du prix public.

*Historique : une décomposition en composantes avec dérivation automatique de deux niveaux d'achat avait été modélisée, puis retirée. Elle protégeait rigidement une donnée publiée par un tiers, pour n'alimenter qu'un seul calcul — au prix d'un refus d'enregistrer toute publication dont les composantes ne sommeraient pas exactement.*

### 5.4. Marge et seuil minimum

**Les coûts d'une affaire sont CHIFFRÉS par le commercial, à la construction du devis.** Il sélectionne les postes dans le référentiel — jamais un intitulé libre, sans quoi le rapprochement avec les factures fournisseurs et l'analyse par nature deviennent impossibles.

Trois sources de charges, par ordre de force probante décroissante :

| Source | Quand | Ce qu'elle vaut |
| :--- | :--- | :--- |
| **Constaté des opérations** | À l'exécution | Ce qui a réellement été engagé |
| **Chiffré de l'affaire** | Au devis | Ce que le commercial a prévu |
| Montant agrégé du deal | Reprise ancienne | Filet de compatibilité |

L'écart entre le chiffré et le constaté est le contrôle de fiabilité du chiffrage (§ 14.6). La source retenue est **affichée**, jamais devinée.

**Chaque poste porte une valeur pré-paramétrée — le BARÈME.** Sans référence, il n'y a rien dont s'écarter : un transport chiffré à 45 FCFA/L au lieu de 30 ne se voit pas. C'est l'écart au barème qui porte le signal, jamais le montant seul.

Le barème se résout du plus spécifique au plus général — produit, puis mode de transport, puis segment — et sa valeur est **figée au moment du chiffrage** : une grille révisée ensuite ne requalifie jamais un écart déjà justifié.

**La saisie se fait AU LITRE ou EN FORFAIT, au choix.** Les deux se rencontrent : un transport se négocie au litre, une manutention se facture à la rotation. Imposer une seule base forcerait une conversion mentale — donc une erreur, et une erreur invisible. Le système ramène l'ensemble au litre.

| Base | Saisie | Total pour l'affaire |
| :--- | :--- | :--- |
| `PER_UNIT` | 30 FCFA/L | 30 × volume contracté |
| `FIXED` | 150 000 FCFA | 150 000, quel que soit le volume |

Le **diviseur est le volume contracté**, au devis comme à l'exécution. Choix assumé : il rend les affaires comparables au chiffrage. Contrepartie à connaître — livrer moins que prévu surestime la marge unitaire, les coûts fixes se répartissant sur un volume qui n'a pas été vendu.

**Tout écart au barème au-delà de la tolérance exige un motif**, vérifié en base. Un écart silencieux est indistinguable d'une faute de frappe.

**Le prix d'achat suit la même logique**, avec un arbitrage en plus. Il reste adossé à une ligne fournisseur validée par le DG, mais peut s'en écarter dans une **bande paramétrable** (`PURCHASE_PRICE_BAND_PCT`, 3 % par défaut) — les conditions du jour ne sont pas celles du barème. Au-delà : motif obligatoire, et **dérogation du DG pour approuver**.

> ⚠️ **Les deux sens de l'écart sont dangereux, pour des raisons opposées.** Un prix d'achat **gonflé** fait baisser la marge affichée, mais si elle reste au-dessus du seuil personne ne bronche : le surcoût part chez un fournisseur complaisant et revient — c'est le vecteur classique. Un prix **minoré** flatte la marge et obtient une approbation indue ; la réalité rattrape à l'exécution, quand la facture arrive. D'où une bande **symétrique**, et la vue `v_quotation_variance` qui remonte les écarts par commercial : c'est le motif qui alerte, jamais le cas isolé.

> ⚠️ **Défaut corrigé le 3 août 2026 — la marge du devis était surévaluée.** Le commercial ne pouvait saisir aucun coût : la marge annoncée à l'approbation ignorait transport, manutention et inspection, et le CFO approuvait sur un chiffre qui n'avait jamais existé. Sur une affaire type : **90 FCFA/L affichés au lieu de 55**.

> ⚠️ **Faille refermée le même jour — approbation sans prix d'achat.** Le contrôle de prix sourcé exemptait le brouillon, à juste titre : le commercial construit son devis avant de savoir à qui il achètera. Mais cette tolérance ne se refermait jamais. Une affaire sans prix d'achat affichait **une marge égale au prix de vente entier — 765 FCFA/L** — et franchissait tous les seuils. Le déclencheur surveille désormais les colonnes d'approbation : la tolérance cesse à l'instant précis où quelqu'un engage l'entreprise.


#### Ramener les charges à l'unité

Les charges d'une opération sont saisies **par poste de coût** (§ 6.5), puis rapportées au volume livré :

```
Charge unitaire = Total des charges de l'opération ÷ Volume livré

   Exemple : 50 000 FCFA de charges sur 3 000 litres livrés → 16,67 FCFA/L
```

```
Marge unitaire = Prix de vente unitaire − Coût d'achat unitaire − Charge unitaire
```

**Une opération desservant plusieurs clients répartit ses charges au prorata des volumes livrés.**

#### L'ullage est un poste de marge, pas seulement de conformité

#### ⚠️ L'écart de volume ne se chiffre PAS en coût

> *« Dans notre système ivoirien, je livre ce que j'ai chargé. La perte de volume sert à des fins statistiques en interne et n'intervient pas dans les coûts ni la facturation. »* — direction, réaffirmé le 7 août 2026.

**Le volume vendu est le volume CHARGÉ.** Le régime pratiqué en Côte d'Ivoire fait porter l'écart de route au client, pas au vendeur : la facture s'établit sur le chargement, et l'écart constaté à l'arrivée ne la modifie pas.

Une version antérieure de ce document affirmait le contraire — que la perte devait être « chiffrée en devise et affichée comme une ligne de coût ». **C'était faux**, et cette phrase a induit en erreur un audit ultérieur, qui a signalé comme un défaut l'absence d'une ligne de coût qui ne doit pas exister. La règle est consignée ici pour que cela ne se reproduise pas.

**Conséquences tenues en base**, et non par convention :

- le poste de coût `PERTE_VOLUME` est **désactivé**, et un déclencheur refuse toute ligne qui s'y rattacherait — sur une affaire comme sur une opération ;
- l'écart n'entre dans **aucun** calcul de marge ;
- l'écart n'a **aucun** effet sur la facturation.

**Ce à quoi l'écart sert, en revanche :** c'est un signal de premier ordre, et il est conservé comme tel. Alertes et seuils critiques restent en place (§ 8.3), et `v_ullage_statistiques` agrège les écarts **en volume** par transporteur, produit et mode. Un transporteur, un itinéraire ou un dépôt qui dérive se voit là avant de se voir ailleurs. Ce qui est proscrit, c'est de le convertir en francs.

#### Un site est un LIEU, et son usage se déclare

> *« Nous avons les sites de déchargement (livraison), pas encore ceux de chargement (approvisionnement). Cela implique la possibilité qu'un site de chargement soit également un site de déchargement. »*
> *« Dans mon système une station-service peut être un lieu de chargement. »* — direction, 7 août 2026.

Un site est un **lieu physique**, indépendant de qui s'y fait livrer ou charger. Il porte un ou plusieurs **usages** — chargement, livraison — et **c'est l'exploitant qui les déclare**.

> ⚠️ **Rien n'est déduit de la nature du lieu.** Une station-service est un lieu de chargement dès lors qu'on y prend du produit ; un terminal reçoit par navire et charge des camions le même jour. Le système ne décide pas à la place de qui le sait : il n'expose que ce qui a été déclaré, site par site.

Modéliser l'usage par un champ unique obligerait à créer deux fois un lieu qui fait les deux — et avec lui ses consignes d'accès, ses horaires, son badge. L'une des copies se périmerait, et c'est l'agent devant la barrière qui le découvrirait.

**Les exigences appartiennent au lieu**, et s'opposent **aux deux bouts du trajet** : un badge d'accès se retire pour charger comme pour livrer, et un dépôt impose ses créneaux à qui vient prendre du produit. Le verrou de départ les vérifie ensemble.

**Une asymétrie, volontaire.** L'origine d'une opération pointe le lieu **directement** ; la destination passe par le rattachement client (`PartnerSite`). Le bon de livraison doit porter la désignation que **le client** reconnaît pour sa destination — alors qu'un lieu de chargement n'appartient à aucune relation commerciale.

#### Le fret est administrable, et rattaché à un transporteur enregistré

> *« Assure-toi que le coût du transport est administrable et lié à un transporteur enregistré. »* — direction, 7 août 2026.

Le fret est le poste de charge le plus lourd d'une opération de distribution. Il se saisissait pourtant **librement**, sans grille de référence, et le transporteur était **facultatif** : on engageait un coût sans pouvoir dire avec qui il avait été négocié.

**Un tarif de transport se paramètre** (`carrier-tariffs`), par transporteur, et se résout du plus spécifique au plus général — site de livraison, puis mode de transport, puis produit. Un tarif négocié pour un trajet précis l'emporte sur le tarif général du transporteur. À spécificité égale, le plus récemment entré en vigueur.

> Le tarif porte sur le **lieu de livraison**, pas sur le client : un trajet se négocie pour une destination, et plusieurs clients se font livrer au même endroit (§ 6.2).

**Trois verrous, tenus en base :**

| Règle | Ce qu'elle empêche |
| :--- | :--- |
| Un fret non nul exige un **transporteur** | Un coût sans contrepartie ne se rapproche d'aucune facture et ne se conteste devant personne |
| Le tiers doit être **de type transporteur** | Désigner un client par erreur — la clé étrangère seule ne le voyait pas |
| L'écart au tarif exige un **motif écrit** | L'écart silencieux, que personne ne saura expliquer six mois plus tard |

Le montant reste **saisissable** : une attente facturée, un déroutement, une négociation ponctuelle existent. Ce qui est proscrit, c'est l'écart que rien n'explique. **La tolérance par défaut est 0** — règle stricte, la même que pour le barème de coûts.

Le tarif attendu et sa tolérance sont **figés sur l'affectation** : un tarif révisé ensuite ne requalifie jamais un écart déjà motivé. Un fret nul reste admis sans transporteur — transport pour compte propre, enlèvement par le client.

**Un transporteur sans grille ne bloque pas.** Exiger un tarif avant toute affectation empêcherait de travailler avec un transporteur d'appoint un jour de rupture — et c'est ce jour-là qu'il faut pouvoir rouler. Ces cas remontent dans `v_fret_hors_tarif`.

**Le fret entre désormais dans la marge.** Il était stocké et lu nulle part : `directChargesForDeal` ne lit que les lignes de coût. Une ligne de coût **système** le porte, unique et mise à jour avec l'affectation.

#### Le portage financier est un coût, pas un détail

**Elyon paie ses fournisseurs AVANT livraison et encaisse ses clients à 0 ou 45 jours.** Il n'existe aucun crédit fournisseur pour amortir : chaque franc de produit sort de la trésorerie avant d'y revenir.

```
Cycle de trésorerie = (paiement fournisseur → livraison) + (livraison → encaissement)

Coût de portage = Coût d'achat unitaire × Taux de financement annuel × Cycle ÷ 360
```

Ordre de grandeur, sur un achat à 700 FCFA/L, financement à 10 % l'an :

| Conditions client | Cycle | Coût de portage |
| :--- | :---: | ---: |
| Paiement à livraison | ~5 j | ~1,0 FCFA/L |
| Paiement à 45 jours | ~50 j | **~9,7 FCFA/L** |

**Le délai de 45 jours consomme près d'un tiers du plancher de 30 FCFA.** Vendre à 30 FCFA comptant et vendre à 30 FCFA à 45 jours ne sont pas la même affaire : la seconde vaut réellement 21 FCFA.

Le **portage financier est donc un poste de coût direct et variable** (§ 6.5), calculé automatiquement depuis les conditions de paiement du client et le taux de financement paramétré. Un seul plancher suffit alors : le système exige mécaniquement un prix plus élevé pour un paiement différé, et le commercial voit à l'écran ce que coûte le délai qu'il accorde.

> Cela donne son sens plein au verrou de crédit : **le plafond client n'est pas seulement un paramètre de risque, c'est une consommation de trésorerie** (§ 14.5).

#### Deux seuils, deux effets

| Seuil | Assiette | Effet |
| :--- | :--- | :--- |
| **Plancher direct** | Marge après charges **directes** seules, portage inclus | **Blocage dur.** Levée par le **DG seul**, justification écrite obligatoire, catégorie distincte au registre des dérogations, revue mensuelle. |
| **Seuil minimum** | Marge après charges **complètes**, indirectes absorbées incluses (§ 14.2) | `PENDING_DG_APPROVAL` — accord DG avec motif, **pas un refus** |

**Pourquoi le seuil complet n'est pas bloquant.** Une affaire qui couvre ses coûts directs et contribue partiellement aux frais fixes reste bonne à prendre. Refuser sèchement sur une **clé de répartition — qui reste une convention** — détruirait de la valeur. Le DG arbitre, en le sachant et en le traçant.

**Pourquoi le plancher direct vaut 10 FCFA/L.** Il doit couvrir le **risque opérationnel de l'opération elle-même** :

| Aléa | Coût estimé |
| :--- | ---: |
| Ullage au seuil de tolérance | ~2,5 FCFA/L |
| Provision litige, qualité, immobilisation | ~2 à 3 FCFA/L |

En dessous de 10 FCFA/L, **deux aléas ordinaires effacent la marge** : l'opération devient une prise de risque non rémunérée. À 10 FCFA, la couverture de l'ullage seul est d'environ quatre fois. Et la zone 10–30 FCFA laisse au DG un domaine d'arbitrage réel, où une décision humaine a du sens.

**Grille des seuils** — segment et produit déterminent le montant, la devise **et l'unité** (le soutage se traite en tonnes, le retail en litres) :

| Segment | Plancher direct | Seuil minimum | Unité |
| :--- | :---: | :---: | :--- |
| Maritime | **10** FCFA | **30** FCFA | par litre |
| B2B | **10** FCFA | **30** FCFA | par litre |
| Retail | **10** FCFA | **30** FCFA | par litre |

> **Les seuils valent pour tous les segments**, soutage maritime compris (décision du 2026-08-02). La grille reste par segment et par produit : elle permet de différencier plus tard sans changer le modèle.

#### Le seuil se contrôle deux fois

| Moment | Sur quoi | Effet |
| :--- | :--- | :--- |
| **Ex ante** — approbation de la Proforma | Marge **prévisionnelle** | Sous le seuil → `PENDING_DG_APPROVAL` avec motif obligatoire |
| **Ex post** — clôture du Deal | Marge **réelle** | Sous le seuil → alerte CCOO, CFO et DG. Répond au point « opérations déficitaires » du § 17 du cadrage |

Une opération approuvée qui dérape doit remonter. L'approbation initiale ne vaut pas quitus.

### 5.5. Résolution de la référence de prix

Quatre références coexistent. **Le choix dépend du client et du contexte de facturation**, résolu par un moteur de règles :

| Référence | Usage |
| :--- | :--- |
| **Prix SIR** | Approvisionnement domestique |
| **Prix à la pompe DGH** | Maritime TTC, Retail |
| **Prix contractuel** | Négocié au contrat-cadre ou au Deal |

Même mécanique que le moteur documentaire du § 9.4 — **un seul moteur de résolution, deux usages**.

## 6. RÉFÉRENTIELS

### 6.1. Clients et prospects

Identité, contacts, informations fiscales (Numéro de Compte Contribuable, RCCM, régime, exonérations avec référence opposable), **segment**, conditions commerciales, devise, **plafond de crédit**, conditions de paiement, **régime documentaire et fiscal** (§ 9.4), contrats, historique des opérations, factures et encaissements.

Un prospect gagné est **converti en client sans duplication**, historique conservé.

### 6.2. Produits

Type, qualité, spécifications, unités (**litre, m³, tonne**), densité de référence à 15 °C, viscosité, point d'éclair, teneur en soufre, paramètres techniques, **régime fiscal**.

> **Conversions volumétriques.** Toute conversion litre ↔ m³ ↔ tonne s'appuie sur la densité à 15 °C et les tables **ASTM D1250 (VCF)**, centralisées dans un service unique et testé. Aucune conversion improvisée dans le code applicatif. Tous les volumes sont stockés **corrigés à 15 °C**, avec conservation du volume observé et de la température.

### 6.3. Fournisseurs

Identité, documents, **coordonnées bancaires**, produits, prix, devises, **modalités de fixation des prix**, conditions de livraison et de paiement, volumes, remises, taxes, contrats, **statut de conformité**.

> Les prix fournisseurs sont **historisés** avec dates de validité, source, contrat et validation. Ils alimentent directement la résolution de référence de prix (§ 5.5).

Sources d'approvisionnement : **SIR**, mécanismes applicables avec **GESTOCI**, **marketeurs**, autres fournisseurs autorisés.

> Les mécanismes précis d'enlèvement et de throughput avec la SIR et GESTOCI restent à documenter avec vos équipes — le modèle les accueille comme des modalités d'approvisionnement paramétrables.

### 6.4. Sous-traitants de transport

Données administratives, contrats, **tarifs**, agréments, **véhicules** (capacités, compartiments), **chauffeurs**, assurances, contrôles techniques, formations, conformité HSE, incidents et non-conformités.

**Chaque élément de conformité porte une date d'expiration** et alimente le moteur d'alerte (§ 6.6).

> **Invariant § 11.4 :** un sous-traitant, véhicule ou chauffeur non conforme **ne peut pas être affecté** à une opération sans dérogation formalisée. **La dérogation relève du DG.**

### 6.5. Répertoire des postes de coûts

> **Table de référence administrable, jamais une énumération figée.** Ajouter un poste de coût est une opération de paramétrage, pas une migration de schéma.

| Champ | Rôle |
| :--- | :--- |
| Code, libellé | Identification |
| Catégorie | Regroupement pour les rapports |
| **Nature** | `DIRECT` (imputable à une opération) ou `INDIRECT` (absorbé, § 14.2) |
| **Variabilité** | `VARIABLE` · `FIXE` — **axe distinct de la nature**, indispensable au point mort (§ 14.5) |
| **Regroupement** | Pour les indirects : administration, HSE, structure commerciale, barge, transport propre… |
| **Clé de répartition** | Pour les indirects : au litre, à l'opération, au prorata du CA |
| Actif | Désactivation sans suppression — l'historique reste lisible |

> ⚠️ **Nature et variabilité sont deux axes différents, constamment confondus.** La plupart des coûts directs sont variables et la plupart des indirects sont fixes — mais pas tous : une location de dépôt dédiée à un client est directe et fixe ; une commission bancaire proportionnelle est indirecte et variable. Sans le second attribut, le point mort n'est pas calculable — et le rajouter après coup obligerait à requalifier tout l'historique.
>
> **Coûts semi-variables** (salaire à fixe + prime au voyage) : les **scinder en deux postes** plutôt que modéliser une formule mixte. Plus simple et plus honnête à l'analyse.

**Postes livrés à l'initialisation :** achat · chargement · déchargement · manutention · transit · frais portuaires · stockage · throughput · transport · péages · attente · frais de route · administration · banque · commissions · HSE · assurances · pénalités · coûts exceptionnels · perte de change · ~~perte de volume (ullage)~~ *(désactivé — l'écart est statistique, jamais un coût : voir § 5.4)* · **portage financier** (§ 5.4).

Chaque ligne de charge porte un **montant prévisionnel** et un **montant réel** : le prévisionnel alimente le contrôle de marge à l'approbation, le réel celui de la clôture (§ 5.4).

Chaque poste direct est imputable à une **Opération** et remonte au Deal par agrégation.

### 6.6. Prix administrés et documents à échéance

**Prix administrés** : structure décomposée (§ 5.3), publiée par la DGH ou la SIR, avec date d'effet, référence de publication et périodicité libre. Historisée, jamais écrasée.

**Documents à échéance** : agréments ministériels, licences d'import/export, FDS, assurances, contrôles techniques, habilitations chauffeurs, certificats de barge. **Moteur d'alerte avant expiration**, préavis paramétrable.

---

## 7. HSE

### 7.1. Principe

Le HSE est **intégré au workflow de chaque opération**, pas un module annexe. Contrôles **avant, pendant et après** l'opération.

Modèles de contrôle disponibles pour : livraisons terrestres, chargements, déchargements, opérations maritimes, opérations de barge, transferts, transports pour compte de client, maintenances, opérations exceptionnelles.

Chaque contrôle est **obligatoire, recommandé, conditionnel ou bloquant**. **Un contrôle est bloquant quand le paramétrage l'établit comme tel** — jamais parce que le code l'aurait décidé.

### 7.1 bis. Types d'opération — l'axe d'indexation des contrôles

> *« Une opération porte sur un segment et son type est indiqué lors de sa création, cela permet d'indexer la liste des contrôles HSE à lui adjoindre. Une opération peut porter plusieurs types (elle peut commencer par un transport routier et se terminer par un soutage à quai). »* — décision du 5 août 2026.

**Le type d'opération est administrable** : il se crée, se renomme et se désactive depuis l'écran de paramétrage ou par import de fichier, comme tout référentiel. Cinq types sont amorcés à l'installation, dérivés des modes de transport (route, soutage, barge, pipeline, rail) ; rien n'interdit d'en ajouter.

**Une opération porte plusieurs types, dans l'ordre du déroulé.** Le rang 1 est la première étape. Cet ordre est celui saisi à la création : il détermine la présentation des checklists à l'agent, et un ordre recalculé par ordre alphabétique présenterait le soutage avant le transport qui l'amène.

**La checklist d'une opération est l'union des checklists de ses types**, avec deux règles :

| Règle | Raison |
| :--- | :--- |
| Un point présent dans deux types n'apparaît **qu'une fois** | L'agent le ferait une fois ; le doublon resterait éternellement en attente et bloquerait l'opération |
| En cas de doublon, le **niveau le plus contraignant** l'emporte | Ajouter un type au déroulé ne doit jamais **affaiblir** un contrôle |

L'union est calculée **en base** (`resolve_hse_checklist`), pas dans l'application : c'est la base qui oppose le verrou HSE, et une seconde résolution en TypeScript finirait par en diverger — deux vérités pour un même contrôle.

**Une opération sans type ne peut pas avancer.** Un déclencheur PostgreSQL refuse tout changement de statut hors brouillon. Sans type, aucune checklist ne s'attache : l'opération traverserait tout le déroulé sans qu'aucun contrôle ne lui soit jamais opposé, et le verrou HSE passerait faute de point bloquant à satisfaire.

**La provenance est figée au point, non à la checklist.** Chaque point contrôlé conserve le modèle dont il vient **et sa version**. Une checklist assemblée à partir de plusieurs types n'a pas de modèle unique dont on pourrait invoquer la version ; réviser un modèle plus tard ne réécrit jamais ce qui a été effectivement vérifié sur le terrain.

> ⚠️ Un type qui ne porte aucune checklist n'apporte **aucun contrôle**. L'écran de sélection affiche le nombre de checklists rattachées à chaque type, pour que celui qui compose le déroulé s'en aperçoive au moment de choisir — et non quand la checklist s'ouvre vide.

### 7.2. Niveau de risque et présence du contrôleur

L'entreprise ne compte qu'un contrôleur HSE. Le dispositif est donc calibré pour que sa présence physique reste l'exception.

| Niveau | Contrôleur HSE | Checklist |
| :--- | :--- | :--- |
| **Standard** | Non requis | Auto-contrôle par l'agent, contrôles recommandés |
| **Renforcé** | Requis — **validation à distance** sur photos, relevés horodatés et géolocalisés | Contrôles obligatoires |
| **Critique** | **Présence physique obligatoire** | Contrôles bloquants, permis de travail |

Le niveau se déduit du **segment, du produit, du mode de transport et du site**. Entièrement paramétrable, jamais codé en dur.

La validation à distance étant le mode normal, l'application doit la rendre rapide : notification, dossier complet à l'écran, validation ou blocage en quelques gestes.

### 7.3. Contenu du dispositif

Inspections · incidents · accidents · déversements · quasi-accidents · observations dangereuses · non-conformités · actions correctives et préventives, avec responsable, échéance et **preuve de clôture**.

### 7.4. Checklist type

| Phase | Contrôles |
| :--- | :--- |
| **Préparation** | Ordre de mission, client, produit, volume, site, transporteur, véhicule et chauffeur confirmés |
| **HSE avant départ** | Permis, assurance, contrôle technique, extincteurs, EPI, kit anti-déversement, signalisation, absence de fuite, briefing sécurité |
| **Chargement** | Autorisation, contrôle du produit et des compartiments, **jaugeage initial**, **scellés posés**, volume enregistré, bon joint, contrôle HSE validé |
| **Transport** | Départ, avancement, incidents, arrivée |
| **Livraison** | Sécurisation du site, **contrôle des scellés**, volume livré, écarts, bon signé, signature électronique, photos |
| **Clôture** | Contrôle HSE final, incident ou quasi-accident, rapport, validation finale |

Les modèles de checklist sont **extensibles sans développement** — de nouveaux points de contrôle s'ajoutent par paramétrage.

---

## 8. MESURE DES VOLUMES ET ÉCART D'ULLAGE

### 8.1. Deux natures de relevé, deux valeurs probantes

Distinction essentielle, sans laquelle le dispositif ne fonctionne que sur le maritime :

| | Inspection indépendante | Relevé contradictoire |
| :--- | :--- | :--- |
| **Qui** | Inspecteur tiers assermenté (SGS…) | Contrôleur HSE Elyon + représentant client |
| **Support** | Rapport CQ&Q officiel | **Bon de livraison signé** |
| **Typique de** | Maritime, soutage, gros volumes | Livraison routière, retail |
| **Valeur** | Forte — tiers indépendant | Contradictoire entre les parties |

**Un objet unique `Relevé de mesure`** porte une **source** — `INSPECTION_INDEPENDANTE` / `RELEVE_CONTRADICTOIRE` / `AUTO_MESURE` — et un niveau de valeur probante.

> **La facture définitive s'appuie sur le relevé faisant autorité pour le segment** : l'inspection indépendante quand elle existe, le relevé contradictoire à défaut. Le calcul d'écart et les seuils fonctionnent identiquement sur les deux.

### 8.2. Calcul

```
Écart (%) = (Volume chargé − Volume livré) / Volume chargé × 100
            — volumes corrigés à 15 °C —
```

> ⚠️ **Piège technique.** L'écart se calcule sur des volumes corrigés à 15 °C. Une correction de température mal appliquée fabrique un **ullage fantôme** : charger à 32 °C et livrer à 26 °C produit mécaniquement un écart en volume brut alors que la masse est intacte. Le service ASTM D1250 doit être la **seule** voie de calcul, et l'application terrain doit **obliger** à saisir la température à chaque relevé. Sans cela, les alertes deviennent permanentes et l'équipe apprend à les ignorer — ce qui tue le dispositif.

### 8.3. Grille de tolérance

Les tolérances ne sont **pas des valeurs physiques universelles**. Elles sont **contractuelles** : vos contrats de transport en stipulent la franchise et qui la supporte, vos polices d'assurance définissent le seuil indemnisable, vos contrats d'approvisionnement fixent le reste. Les normes ASTM et API définissent *comment mesurer*, pas *combien de perte est acceptable*.

**Grille paramétrable, indexée sur (segment × mode de transport × produit) :**

| Seuil | Effet |
| :--- | :--- |
| `seuil_normal` | En deçà : rien. Perte technique attendue. |
| `seuil_alerte` | Alerte + acquittement motivé attendu. **Aucun effet sur la facturation.** |
| `seuil_critique` | **Non-conformité HSE ouverte d'office**, avec enquête. Clôture de l'opération suspendue. |
| `franchise_absolue` | Volume plancher sous lequel aucun seuil ne se déclenche |

**Initialisation à 0,2 % sur toutes les lignes** — valeur actuelle. À calibrer contrat par contrat.

**Le lien avec le HSE.** Un écart de volume important n'est pas seulement un problème commercial : **le produit est allé quelque part**. Fuite, déversement ou détournement. Les trois relèvent du HSE ou de la sûreté. Le franchissement du seuil critique ouvre donc automatiquement une non-conformité HSE. L'écart d'ullage est un **capteur** : il déclenche une enquête, jamais une retenue de facture.

**L'acquittement** est réservé au `HSE_CONTROLLER`, au `CCOO`, au `FINANCE_CFO` et au `DG`. Motif obligatoire, tracé.

> **L'écart de volume ne retient jamais une facture.** C'est un capteur opérationnel et HSE, pas un verrou commercial. Le volume facturé est **saisi à l'édition** de la proforma ou de la facture (§ 9) et ne se déduit pas du relevé : lier les deux ferait dépendre l'encaissement d'un contrôle qui poursuit un autre but.

---

## 9. FACTURATION

Quatre couches successives. Chacune répond à une question distincte.

### 9.1. Couche 1 — Formation du prix

Voir § 5. Segment → formule (surchargeable) → référence de prix résolue par contexte.

### 9.2. Couche 2 — Devises

**Cinq plans distincts :**

| Plan | Rôle |
| :--- | :--- |
| **Fonctionnelle** | Devise de tenue de comptes |
| **Transaction** | Devise de l'opération réelle |
| **Contractuelle** | Devise stipulée au contrat |
| **Règlement** | Devise d'encaissement effectif |
| **Reporting** | Devise de consolidation — le **pivot USD** |

Devises gérées au minimum : **XOF, EUR, USD**, plus toute devise activée. **Aucune devise codée en dur.**

**Le franc CFA est arrimé à l'euro** à la parité fixe et réglementaire de **1 EUR = 655,957 XOF**, et n'a **pas de subdivision en circulation** — tout montant imprimé en FCFA est un entier.

**Pourquoi USD comme pivot.** Sourcing et fret international sont libellés en dollars : c'est là que la marge se forme. Un pivot XOF ferait apparaître un résultat de change sur chaque opération alors que l'exposition économique est dollar.

**Types de taux** : officiel, bancaire, contractuel, interne, budgétaire. **Un taux n'est jamais écrasé** — on insère une nouvelle ligne avec sa date d'effet, sa source et son auteur. Toute pièce émise conserve le lien vers le taux exact qui l'a chiffrée : une facture reste reproductible à l'identique dix ans plus tard.

**Bascule monétaire** (§ 13 du cadrage) : ajout d'une devise, **date de bascule**, coexistence temporaire, conversion des soldes, conservation des historiques, mise à jour des prix et rapports, piste d'audit.

### 9.3. Couche 3 — Choix du document

**Proforma** — présente l'offre, confirme prix et quantités, obtient l'accord ou sollicite un paiement anticipé. Porte obligatoirement la mention :

> `DOCUMENT PROFORMA – NON VALABLE COMME FACTURE DÉFINITIVE`

Elle ne génère **jamais** — invariant en base, pas convention applicative :
- aucune créance définitive
- aucun chiffre d'affaires
- aucune écriture fiscale
- aucune transmission FNE

Convertible en **commande, contrat, opération, facture simple ou FNE**.

**Facture simple** — après présentation d'une proforma, **sans génération de FNE**. Rattachée à la proforma, au contrat, à la commande ou à l'opération. Contient numéro, date, client, produits ou services, quantités, prix, remises, HT, taxes, TTC, devise, conditions de paiement et **références opérationnelles**.

> **Le recours à la facture simple est une décision interne** — un acte humain qualifié, non une règle automatique. Le moteur propose et contraint ; un rôle habilité décide ; la décision porte décideur, motif et horodatage, et reste opposable.

**FNE** — régime normalisé, transmis par l'API de la DGI.

**Avoirs et régularisations** — traités par le même circuit.

### 9.4. Le moteur de règles documentaire

Il décide **facture par facture** selon : client, pays, statut fiscal, produit ou prestation, segment, régime fiscal, devise, contrat, lieu de livraison, caractère local ou international, exonération, règles internes.

**Champ obligatoire**, porté par le client et surchargeable au niveau du Deal :

> **Régime documentaire et fiscal** : Proforma uniquement · Proforma puis facture simple · Proforma puis FNE · Facture simple directe · FNE directe · Autre régime

Le **motif de non-recours à la FNE** est obligatoire dès que le moteur l'écarte, avec **traçabilité de la règle qui a décidé**. En cas de contrôle, il faut pouvoir expliquer pourquoi telle facture n'est pas passée en FNE, deux ans après.

### 9.5. Couche 4 — Cycle de vie fiscal (FNE)

```
Brouillon → À valider → En attente de transmission → Transmise
   → Acceptée/Certifiée
   → Rejetée → À corriger → (retour transmission)
   → Annulée/Régularisée
```

Préparation et contrôle des données avant envoi, transmission via l'API DGI, réception des statuts, intégration des références retournées, gestion des erreurs et renvois, **archivage des échanges**, avoirs et régularisations.

> **Chantier parallèle.** L'accès à l'API DGI est la seule dépendance externe du projet. L'API existe et sera communiquée ; l'obtention des identifiants et d'un environnement de test doit être engagée en parallèle du lot 1, sans attendre le lot de facturation.

> **Réserve.** Les règles fiscales elles-mêmes — quel document pour quelle opération, quel taux pour quel produit — relèvent de **votre conseil fiscal**, pas de ce document. Le système les accueille comme paramètres ; il ne les valide pas.

---

## 10. APPLICATION TERRAIN

### 10.1. Utilisateurs

Deux profils, une seule application. **Le chauffeur n'est pas utilisateur.**

| | `FIELD_AGENT` | `HSE_CONTROLLER` |
| :--- | :--- | :--- |
| **Fait** | Déroulé de l'opération, volumes, chargement, transport, livraison | Contrôles HSE avant/pendant/après, non-conformités, incidents |
| **Peut** | Renseigner, avancer les étapes | **Valider ou bloquer** l'opération |
| **Ne peut pas** | Valider ses propres contrôles bloquants | Modifier les données d'exécution |

### 10.2. Architecture de synchronisation

**L'application web, dans le navigateur de la tablette** — décision du 5 août 2026. Pas d'application native, pas de Capacitor : un seul déploiement, une seule chaîne de compilation, aucun magasin d'applications à alimenter. Les écrans terrain sont des écrans de l'application web, dessinés pour le tactile.

> Ce que ce choix coûte, et qu'il faut savoir avant d'en avoir besoin : le navigateur n'ouvre pas l'appareil photo en arrière-plan, ne synchronise pas quand l'onglet est fermé, et son stockage local peut être évincé par le système — notablement sur iOS. Le **hors-ligne durable** n'est donc pas acquis par ce choix ; il reste ajoutable (file locale dans le navigateur), avec ces limites.
>
> **C'est pourquoi les écritures terrain passent par le journal d'événements** décrit ci-dessous, et non par des appels directs. Chaque action porte déjà son identifiant d'appareil et son idempotence : ajouter une file locale plus tard ne demandera aucune reprise de l'existant. Écrire en direct « pour aller plus vite » aurait fermé cette porte.

**Principe : synchroniser des événements, pas des états.**

La tablette ne détient pas une copie modifiable de l'opération qu'elle renverrait au serveur — cette approche fabrique des conflits insolubles. Elle produit un **journal d'événements en ajout seul** : *« étape chargement validée à 14h32 »*, *« volume relevé : 28 450 L à 31,2 °C »*, *« incident déclaré »*. Chaque événement porte un **UUID généré sur l'appareil**, ce qui rend la synchronisation **idempotente** : un renvoi après coupure ne duplique rien.

Le serveur reste seul juge de l'état résultant et **rejette les événements violant un invariant** — un chargement déclaré avant validation HSE, par exemple. Le rejet redescend sur l'appareil pour résolution. Les conflits sont rares par construction : une opération est affectée à un agent.

**Hors connexion : aucune limite fonctionnelle de durée.** Purge automatique des opérations clôturées et synchronisées au-delà d'un délai paramétrable. Le facteur limitant est le volume des photos, non les données métier.

**Les photos ne transitent pas dans le flux d'événements** — compression sur l'appareil, file d'envoi séparée avec reprise. Sinon une opération à vingt photos bloque toute la synchronisation. Un point de contrôle renseigné pèse quelques centaines d'octets et débloque l'opération ; une photo pèse deux mégaoctets et peut attendre le réseau. Les mêler ferait dépendre le premier de la seconde.

#### Stockage des pièces jointes

**Le binaire n'est jamais en base.** Elle porte une **clé** et une **empreinte** ; le fichier vit sur un volume disque. Le mettre en colonne gonflerait chaque sauvegarde, chaque réplication et chaque restauration d'un volume qui n'a rien de transactionnel.

**Adressage par le contenu** — la clé dérive de l'empreinte SHA-256, pas d'un compteur ni d'un horodatage. Trois conséquences, toutes voulues :

- la même photo envoyée deux fois n'occupe la place qu'**une** fois — et une tablette qui reprend un envoi interrompu renvoie exactement le même contenu ;
- l'écriture est idempotente : une reprise n'a rien à défaire ;
- l'intégrité se vérifie sans registre annexe — le nom **est** la preuve.

> ⚠️ La clé de stockage n'est donc **pas unique** en base, et ne doit jamais le devenir. Le même cliché versé à deux points de contrôle est un cas normal : un extincteur photographié une fois vaut pour le point « extincteurs » et pour le point « conformité du véhicule ». L'unicité qui compte est celle de `clientUuid`, l'identifiant produit par l'appareil — c'est lui qui empêche qu'une reprise après coupure dépose deux fois la même pièce.

**Une seule implémentation, derrière une façade.** Le disque suffit et ne coûte rien : aucun conteneur supplémentaire, aucune mémoire réservée, aucune surface d'exploitation en plus. Les appelants ne connaissent que `put`, `read` et `exists` — passer un jour à un stockage objet ne rouvrira aucun d'eux.

**Le volume est le seul chemin d'écriture** d'un conteneur par ailleurs en lecture seule, et il est à **inclure dans le plan de sauvegarde au même titre que la base** : sans lui, un contrôle HSE validé sur photo perd sa preuve.

**Plafond et types admis sont paramétrés** (`FIELD_ATTACHMENT_MAX_MB`, `FIELD_ATTACHMENT_MIME_TYPES`). Le plafond du relais nginx est délibérément **au-dessus** de celui de l'application : réglé en dessous, c'est nginx qui refuse — par une page HTML en anglais qui n'apprend à l'agent ni le plafond, ni qu'il faut compresser. Le refus doit venir de l'application, qui sait quoi dire.

**L'horloge de l'appareil n'est pas fiable.** Les deux horodatages sont conservés — appareil et réception serveur. Un écart important est en soi un signal d'audit. La vue `v_field_clock_drift` le rend ; elle ne fixe aucun seuil, qui relève du paramétrage.

#### Le sort d'un événement à l'arrivée

| Sort | Ce que cela signifie | Ce que la tablette doit en faire |
| :--- | :--- | :--- |
| **Accepté** | Appliqué. L'état du serveur en tient compte. | Le retirer de la file. |
| **Refusé** | Un invariant s'y est opposé. Le motif est rédigé pour l'agent. | Le retirer de la file, montrer le motif, **produire un événement NEUF** une fois la cause levée. |
| **Suspendu** | Jamais jugé : un événement **antérieur de la même opération** a été refusé. | Le **garder** en file. Il repartira inchangé. |

> ⚠️ **Un refus est définitif et brûle l'identifiant de l'événement.** Le journal est en ajout seul : il conserve que cet événement-là a été refusé, et quand. Le renvoyer tel quel retombe sur la même ligne et rend le même refus, indéfiniment. Réévaluer un refus au renvoi supposerait de réécrire une ligne de journal — c'est-à-dire d'effacer la trace qu'une opération a été tentée hors des règles, précisément ce que le journal existe pour empêcher.
>
> Un événement **suspendu**, lui, n'est **pas** journalisé : rien ne l'a jugé, donc rien n'est à conserver, et son identifiant reste libre. L'inscrire le ferait passer pour un doublon au renvoi suivant — il serait perdu pour de bon.

**Un refus suspend la suite de SON opération, et d'elle seule.** Les événements suivants de la même opération décrivent la suite d'un déroulé dont une étape vient d'être refusée : les appliquer quand même enregistrerait une livraison sous un chargement qui n'a pas eu lieu. Une autre opération, sans rapport, poursuit.

**La charge utile d'un événement est validée contre le contrat de sa nature**, avec les DTO du domaine eux-mêmes — jamais des copies, qui divergeraient au premier champ ajouté. Sans cette étape, une valeur fautive traverserait jusqu'à la base et l'agent recevrait sur sa tablette une trace d'appel interne au lieu d'une consigne.

**Le cloisonnement porte sur l'opération ET sur l'objet désigné.** Vérifier que l'opération est bien affectée à l'agent ne suffit pas : un identifiant de point de contrôle ou de checklist pris ailleurs permettrait d'écrire dans le dossier d'un autre client par la porte de derrière. Le rattachement est vérifié à chaque écriture.

### 10.3. Vue terrain du client

Objet de transport **dédié**, qui ne contient pas les champs sensibles — et non un masquage a posteriori.

| L'opérateur voit | L'opérateur ne voit jamais |
| :--- | :--- |
| Raison sociale, site, adresse, contacts sur place | Prix, marges, coûts d'achat |
| Contraintes d'accès, horaires, consignes de sécurité du site | Plafond de crédit, encours, impayés |
| Produit, volumes, spécifications | Factures, statut d'encaissement |
| Historique des opérations **sur ce site** : dates, volumes, incidents | Fournisseurs et conditions d'achat |
| Documents de l'opération : ordre de mission, FDS, autorisations | Toute donnée d'un autre client |

### 10.4. Fonctions

Opérations affectées · checklists dynamiques · validation étape par étape · saisie des volumes **avec température obligatoire** · photos et pièces jointes · signatures électroniques · déclaration d'incidents · horodatage · géolocalisation · **mode hors connexion** · synchronisation automatique.

### 10.5. Sécurité du parc

Les tablettes sont **durcies et fournies par l'entreprise**, ce qui autorise un dispositif que des appareils personnels n'auraient pas permis :

- **Stockage local chiffré**
- **Verrouillage par code ou biométrie**
- **Effacement à distance** en cas de perte
- Aucune donnée commerciale sur l'appareil, par construction (§ 10.3)

---

## 11. LES TROIS VERROUS ET LES INVARIANTS

### 11.1. Principe

Les règles critiques sont portées par **PostgreSQL**, pas seulement par l'application. Un bug applicatif, un script d'administration ou une refonte future de l'API ne peuvent pas les contourner. Chaque verrou suit le même mécanisme : **garde sur l'état · acteur qualifié · dérogation motivée · trace d'audit**.

### 11.2. Les trois verrous

| Verrou | Bloque | Levée |
| :--- | :--- | :--- |
| **Finance** | Création de toute **Opération** sur un Deal non approuvé | `FINANCE_CFO`, ou `DG` en dérogation sur marge |
| **HSE** | Passage au **chargement** sans contrôles bloquants validés | `HSE_CONTROLLER`, ou `DG` en suppléance (§ 3.4) et en arbitrage |
| **Conformité** | **Affectation** d'un transporteur, véhicule ou chauffeur non conforme | **`DG` exclusivement**, motif et échéance obligatoires |

**Arbitrage.** En cas de blocage HSE contesté par l'exploitation, **le DG arbitre**.

### 11.3. Invariants vérifiés en base

| Invariant | Portée |
| :--- | :--- |
| Aucune Opération sur un Deal non approuvé par la Finance | Verrou finance |
| L'approbation crédit est réservée à `FINANCE_CFO` ou `DG` | Vérification du rôle en base |
| Aucun chargement sans contrôles HSE bloquants validés | Verrou HSE |
| **L'agent d'opération ne peut valider aucun contrôle bloquant** | Séparation des tâches |
| Aucune affectation de moyen non conforme sans dérogation DG | Verrou conformité |
| Facture définitive assise sur le **relevé faisant autorité** | § 8.1 |
| Écart d'ullage non acquitté → **facturation bloquée** | § 8.3 |
| Écart au-delà du seuil critique → **non-conformité HSE ouverte** | § 8.3 |
| **Marge directe négative ou sous le plancher → blocage dur** | § 5.4 |
| Marge complète prévisionnelle sous le seuil → approbation DG obligatoire | § 5.4 |
| Marge complète réelle sous le seuil à la clôture → alerte | § 5.4 |
| Le taux d'absorption se calcule sur un volume **budgété**, jamais réalisé | § 14.2 |
| Un budget de prévision validé n'est jamais écrasé — révisions versionnées | § 14.3 |
| Une proforma ne génère ni créance, ni CA, ni écriture fiscale, ni FNE | § 9.3 |
| **Pas de double facturation** d'une même opération | Cadrage § 17 |
| **Aucune modification d'un document validé** — correction par « annule et remplace » | Cadrage § 17 · § 12.2 |
| Le **prix à la pompe** ne peut alimenter aucune ligne de coût | § 5.3 |
| Montants arrondis aux décimales de leur devise d'édition (XOF : 0) | § 9.2 |
| Une seule devise pivot dans le système | § 9.2 |
| Parité fixe XOF/EUR non saisissable manuellement | § 9.2 |
| Audit trail et transitions d'état : **append-only** | § 1.4 |

### 11.4. Registre des dérogations

Toute dérogation — finance, HSE, conformité, suppléance — est inscrite à un **registre unique** portant : nature, objet, demandeur, autorité, motif, date, échéance, et le cas échéant la levée.

C'est exactement ce qu'un auditeur ou un assureur demandera à consulter après un incident.

---

## 12. DOCUMENTS ET SIGNATURES

### 12.1. Rapport d'exécution

Généré **à la clôture de chaque opération**, au format PDF, incluant :

numéro et nature · client et produit · **volumes prévus, chargés et livrés** · écarts · dates et heures · intervenants · transporteur ou barge · **checklist opérationnelle** · **contrôles HSE** · incidents · photos · signatures · pièces jointes · **coûts prévisionnels et réels** · chiffre d'affaires · marges · statut final.

Le **bon de livraison** est un document distinct : il porte le volume livré et fait foi contradictoirement (§ 8.1).

### 12.2. Immuabilité

Les copies physiques du rapport d'exécution et du bon de livraison sont **transmises au client**. L'exemplaire électronique doit donc correspondre exactement à ce qui a été signé.

- À la signature, le PDF est **généré, empreinté (SHA-256) et rendu immuable**.
- Toute correction ultérieure produit un **nouveau document portant « annule et remplace »** — jamais une modification silencieuse.
- Chaque exemplaire porte un **QR code d'authenticité** : un client, un assureur ou un auditeur peut vérifier qu'un papier qu'on lui présente correspond au système.

### 12.3. Signatures

**Les signataires ne sont pas tous des utilisateurs.** Le chauffeur et le représentant du client signent sans avoir de compte.

Objet `Signature` autonome portant : nom, **qualité du signataire**, référence de pièce d'identité si nécessaire, **horodatage appareil et serveur**, géolocalisation, image de la signature. Rattaché soit à un utilisateur interne, soit à un **signataire externe identifié à la volée**.

**Séquencement retenu :**

| Document | Moment | Signataires |
| :--- | :--- | :--- |
| **Bon de livraison** | Sur site, à la livraison | Agent d'opération · représentant du client · chauffeur |
| **Rapport d'exécution** | À la clôture | Agent d'opération · contrôleur HSE — puis transmis au client |

> La **valeur juridique** de la signature électronique dépend du dispositif retenu. À valider si vous comptez l'opposer à un client en cas de litige sur un volume livré.

---

## 13. MODULES FONCTIONNELS

| Module | Contenu | Utilisateurs |
| :--- | :--- | :--- |
| **0 — Portail client** | Demande de quotation, tableau de bord des offres, téléchargement et acceptation de proforma, suivi des livraisons, relevés et factures | `CLIENT_PORTAL` |
| **1 — CRM & Front Office** | Pipeline prospect (§ 15), inbox des demandes, moteur de prix, proforma, gestion des statuts | `SALES_REP`, `CCOO` |
| **2 — Finance & Risk** | Contrôle crédit, garanties (LC, acomptes), verrou de marge, approbation | `FINANCE_CFO`, `DG` |
| **3 — Opérations & Logistique** | Approvisionnement, nomination transport, affectation des moyens, suivi d'exécution | `LOGISTICS_COORD`, `CCOO` |
| **4 — HSE** | Modèles de contrôle, checklists, inspections, incidents, non-conformités, actions | `HSE_CONTROLLER` |
| **5 — Terrain** | Application tablette hors connexion | `FIELD_AGENT`, `HSE_CONTROLLER` |
| **6 — Facturation & Fiscalité** | Proforma, facture simple, FNE, avoirs, moteur de règles, API DGI, recouvrement | `FINANCE_CFO`, `ACCOUNTANT` |
| **7 — Transport & Barge** | Sous-traitants, véhicules, chauffeurs, conformité, exploitation de barge, maintenance | `LOGISTICS_COORD` |
| **8 — Administration & GED** | Utilisateurs, coffre-fort documentaire, alertes d'expiration, modèles PDF, registre des dérogations | `IT_ADMIN`, `ASSISTANT_DG` |

**Barge** (§ 10 du cadrage) : gérée comme **actif immobilisé, moyen opérationnel, centre de coût, centre de profit** lorsqu'elle génère des revenus, objet de maintenance, périmètre HSE et **emplacement de stock mobile** lorsque le produit appartient à Elyon. Produit de tiers : suivi comme marchandise de tiers, **jamais valorisé au stock Elyon**, seule la prestation est facturée — au voyage, au litre, au m³, à la tonne, à la distance, à la durée, au forfait ou par combinaison.

---

## 14. COÛT COMPLET, ABSORPTION ET PRÉVISION

### 14.1. Formules

```
Coût complet         = Achat + Approvisionnement + Transport + Administration + HSE + Barge + Autres
Marge brute          = CA − Coût d'achat
Marge directe        = CA − Coût d'achat − Charges directes        ← plancher de blocage dur (§ 5.4)
Marge opérationnelle = CA − Coût complet                           ← seuil minimum, accord DG (§ 5.4)
```

### 14.2. Charges indirectes et taux d'absorption

Les charges indirectes — administration, banque, assurances, structure commerciale, HSE — entrent dans le coût complet par un **taux d'absorption** :

```
Charge indirecte unitaire = Budget annuel du regroupement ÷ Assiette annuelle budgétée
```

**Le dénominateur est le volume BUDGÉTÉ, jamais le réalisé glissant.**

> ⚠️ **La spirale d'absorption.** Avec un dénominateur réalisé, une année sous les prévisions ferait mécaniquement monter la charge unitaire — mêmes frais fixes sur moins de litres. La marge calculée baisserait, davantage d'affaires passeraient sous le seuil, le volume baisserait encore. Sur une marge de l'ordre de 4 %, l'effet est violent. Le budget figé neutralise cette boucle : l'écart entre absorption prévue et charges réelles devient une **variance analysée en fin d'exercice**, information de pilotage et non paramètre mouvant qui bloque des affaires en cours d'année.

**Regroupements distincts, pas un taux unique.** Un taux global ferait subventionner un segment par un autre — le maritime mobilise la barge, le retail les camions. Chaque regroupement porte son budget annuel, son assiette de répartition et son périmètre de segments.

**Alimentation du taux :**

| Horizon | Source du budget de charges |
| :--- | :--- |
| **Maintenant** | Paramètre **versionné saisi par le CFO**, révisable, daté |
| **Après le module comptable** | Alimentation automatique depuis la comptabilité et la paie |

Le verrou de marge ne dépend donc pas des modules différés.

### 14.3. Prévision annuelle de vente

**Maille : segment × produit × mois.** Le détail client est volontairement écarté — trop lourd à maintenir pour ce qu'il apporte. Le détail **produit** est en revanche indispensable : l'approvisionnement s'engage par produit.

**Prévoir en volume, dériver le chiffre d'affaires.** Le prix bouge sans que l'entreprise le décide — publications DGH, taux de change. Une prévision en CA laisse une hausse de prix masquer une perte de volume. Le volume est la variable réellement pilotée ; le CA s'en déduit par un prix de référence, et **l'écart de prix s'analyse séparément de l'écart de volume**.

**Processus — cadrage descendant, construction remontante, réconciliation arbitrée :**

| Étape | Acteur | Contenu |
| :--- | :--- | :--- |
| 1. Cadrage | `DG` | Ambition de croissance, objectif de marge, contraintes |
| 2. Construction | `CCOO`, `SALES_REP` | Remontée par segment, sur historique + pipeline pondéré + contrats connus |
| 3. **Réconciliation** | `DG`, `CCOO`, `FINANCE_CFO` | L'écart entre cadre et remontée est discuté et **arbitré** |
| 4. Validation | `DG` | Le budget devient la référence, versionnée et figée |
| 5. Révisions | `CCOO` | Trimestrielles, datées, **sans jamais écraser le budget initial** |

> Le purement descendant produit des chiffres que personne ne s'approprie. Le purement remontant est systématiquement sous-évalué et déconnecté des objectifs. **L'étape 3 est celle qu'on saute d'ordinaire, et c'est celle qui fait la différence.**

**Trois usages, par ordre de criticité :**

| Rang | Usage | Pourquoi |
| :--: | :--- | :--- |
| **1** | **Plan d'approvisionnement** | Les engagements SIR, GESTOCI et marketeurs se prennent à l'avance, avec délais et allocations. Se tromper coûte des deux côtés : rupture — ventes perdues, stations mécontentes — ou surengagement — trésorerie immobilisée, frais de stockage. Criticité accrue dès qu'il y aura du stock. |
| **2** | **Plan de trésorerie** | La distribution de carburants dévore du besoin en fonds de roulement : le fournisseur est payé avant que le client ne paie, sur des montants considérables au regard d'une marge de l'ordre de 4 %. Un client B2G à 60 jours sur gros volumes représente un besoin de financement majeur. |
| **3** | Objectif commercial | Utile pour animer l'équipe, mais ne contraint pas l'entreprise comme les deux premiers. |

**Conséquence directe du rang 2 :** le module dérive les **encaissements prévisionnels** en décalant le CA des conditions de paiement de chaque segment. Pour la trésorerie, c'est le calendrier qui compte, pas seulement le montant.

**Quatrième usage, structurel :** la prévision de volume fournit le **dénominateur du taux d'absorption** (§ 14.2).

**Sources d'alimentation :** historique des ventes pour le récurrent, pipeline pondéré du CRM (`CA prévisionnel × probabilité`, § 15) pour le nouveau.

### 14.4. Axes d'analyse

Opération · client · produit · segment · fournisseur · transporteur · barge · site · contrat · **mois** · devise.

> Ces axes conditionnent à la fois la prévision (§ 14.3) et la reprise comptable ultérieure. Les définir tard coûte une migration de données. **Ils doivent être captés dès les lots 2 et 3**, même si les modules qui les exploitent viennent plus tard.

### 14.5. Point mort

```
Seuil de rentabilité (litres) = Charges fixes annuelles ÷ Marge sur coût variable unitaire
```

**Exprimé en volume**, jamais en chiffre d'affaires seul — cohérent avec la prévision (§ 14.3) et insensible aux mouvements de prix que l'entreprise ne décide pas. Le CA reste disponible en lecture secondaire.

**Méthode retenue — coût variable, sans répartition arbitraire des fixes :**

- marge sur coût variable **par segment** — indiscutable, chaque segment porte ses coûts variables ;
- **un seul bloc de charges fixes** au niveau entreprise ;
- point mort global = charges fixes ÷ marge sur coût variable moyenne pondérée ;
- point mort **par segment** uniquement lorsque des charges fixes lui sont réellement attribuables — la barge au maritime, typiquement.

**Forme opérationnelle, glissante.** Les prix de vente bougent sans que l'entreprise les décide (DGH, change) : une marge sur coût variable arrêtée une fois l'an est périmée en mars. Le point mort est donc recalculé sur la structure de prix courante et présenté sous forme de trajectoire :

> *« À date : 4,1 M litres vendus · point mort à 6,3 M litres · reste 2,2 M litres · atteint le 12 septembre au rythme actuel. »*

**Bouclage avec le taux d'absorption.** Si le volume réalisé passe durablement sous le volume du point mort, c'est que le taux d'absorption du § 14.2 était trop optimiste. **Le point mort est le contrôle de cohérence du coût complet.**

### 14.6. Besoin en fonds de roulement

```
BFR d'exploitation = Avances fournisseurs + Stocks + Créances clients − Dettes fournisseurs
```

**Structure de trésorerie d'Elyon : adverse par construction.** Les fournisseurs sont payés **avant livraison**, les clients encaissés à **0 ou 45 jours**. Le terme « dettes fournisseurs » est donc proche de zéro : aucun flottant fournisseur n'amortit le cycle. Ce sont au contraire les **avances fournisseurs** — argent sorti, marchandise non encore reçue — qui pèsent à l'actif.

Le registre des factures fournisseurs (lot 2) doit en conséquence suivre en priorité les **prépaiements et leur apurement à la livraison**.

**Trois restitutions :**

| Forme | Intérêt |
| :--- | :--- |
| **En jours** — cycle de conversion de trésorerie | Comparable dans le temps, contrairement à un montant qui suit le prix des produits. Désigne le levier qui se dégrade. |
| **Par client** | *« Ce client immobilise X FCFA en permanence. »* Transforme le plafond de crédit en **coût de financement** et non plus seulement en paramètre de risque. La vue d'encours crédit fournit l'essentiel du calcul. |
| **Prévisionnel** | Le module de prévision dérive déjà les encaissements des conditions client ; la symétrie sur les décaissements fournisseurs produit un BFR prospectif et un plan de trésorerie **sans module supplémentaire**. |

> ⚠️ **Périmètre.** L'ERP produit un **BFR d'exploitation** — avances, stocks, créances. Le BFR comptable complet intègre en outre TVA à récupérer et à reverser, dettes sociales et fiscales, acomptes. **Le chiffre de l'ERP différera de celui du comptable**, et l'écran l'indique explicitement. Le BFR comptable relève du module comptabilité, différé.

**Alimentation des charges fixes** (point mort) et du budget de charges indirectes (§ 14.2) : paramètre versionné saisi par le `FINANCE_CFO` aujourd'hui, alimentation automatique depuis la comptabilité et la paie ensuite. **Aucun de ces indicateurs n'attend les modules différés.**

---

## 15. CRM

```
Prospect → Qualification → Opportunité → Offre/Devis → Négociation
   → Contrat/Commande → Client → Opération → Facture → Encaissement → Fidélisation
```

**Pipeline :** Nouveau → À contacter → Contact établi → Besoin identifié → Qualifié → Opportunité ouverte → Offre en préparation → Offre envoyée → Négociation → Décision attendue → Gagnée / Perdue / Mise en veille.

Chaque étape porte une date, un responsable, une probabilité, une valeur et une **prochaine action**.

Enregistrement des appels, courriels, réunions, visites, messages, offres, comptes rendus, documents et réclamations. **Chaque interaction comporte une action suivante et une date de relance.**

Alertes : relances du jour, actions en retard, prospects non contactés, opportunités sans activité.

```
Valeur pondérée = CA prévisionnel × Probabilité
```

---

## 16. TABLEAUX DE BORD

| Domaine | Indicateurs |
| :--- | :--- |
| **Commercial & CRM** | Prospects, pipeline, conversion, CA prévisionnel, offres, performance, marges |
| **Opérations** | Statuts, retards, blocages, volumes, livraisons, **opérations non facturées** |
| **HSE** | Taux de conformité, contrôles, incidents, non-conformités, actions en retard, performance par équipe / transporteur / barge |
| **Achats** | Volumes, prix fournisseurs, évolution, contrats, dettes |
| **Transport & barge** | Voyages, volumes, coûts, performance, conformité, utilisation, disponibilité, revenus, marge, maintenance, incidents |
| **Finance** | CA, coûts, marges, créances, impayés, écarts de change |

Le tableau de bord opérationnel affiche : opérations **à venir, en cours, en retard, bloquées, non conformes HSE, livrées non facturées, facturées non encaissées**.

---

## 17. DESIGN SYSTEM


**L'apurement d'une avance est DÉRIVÉ, jamais déclaré.** Tant qu'il se réduit à une date saisie, l'indicateur de trésorerie immobilisée peut être ramené à zéro sans qu'un litre soit arrivé — et il ne mesure alors plus la trésorerie, mais la diligence de celui qui saisit.

Trois règles, portées par PostgreSQL (`07_apurement_avances.sql`) :

| Nature de l'avance | Apurée par | Mode |
| :--- | :--- | :--- |
| **Sur marchandise** — reconnue à sa commande d'achat | Le **chargement constaté** de l'opération | **Au prorata** du volume enlevé sur le volume commandé |
| **Sans marchandise** — fret, inspection, douane | La **clôture** de l'opération : la prestation est rendue | Intégral |
| **Révision** | Le **relevé faisant autorité** | Le prorata est recalculé sur le volume réellement chargé, à la hausse comme à la baisse |

Le volume prévu ne sert que d'estimation au chargement. La révision par le relevé est ce qui empêche qu'un enlèvement inférieur au prévu fasse disparaître du besoin en fonds de roulement une somme que rien ne justifie.

> **La date d'apurement ne se pose qu'à l'apurement INTÉGRAL.** Une avance soldée aux deux tiers n'en porte pas : la laisser paraître soldée fausserait l'indicateur. Une contrainte en base refuse une date sans montant correspondant.

**L'apurement manuel reste possible, en exception motivée** — facture rattachée à aucun dossier, opération annulée, régularisation comptable. Motif obligatoire, tracé au journal en `OVERRIDE`.

### 17.1. Direction artistique

**« De l'encre sur du papier. »** Console claire, dense, sobre — un registre bien composé plutôt qu'un terminal de trading.

Le principe tient en une phrase : **la seule couleur présente est celle qui signifie quelque chose.** La structure — barre latérale, cartes, tables, boutons — est rendue en encre et en filets. Les teintes vives restent donc intégralement disponibles pour le statut métier, au lieu de lutter contre un accent décoratif répandu sur tout l'écran.

C'est ce qui rend la règle d'accessibilité du § 17.2 tenable en pratique plutôt que déclarative.

> **Révision de la direction initiale.** Le cadrage retenait un look « Bloomberg / Linear / Vercel » : fond `slate-950`, accent `sky-500`. Construit et mis à l'épreuve, ce parti s'est révélé à la fois banal et peu lisible sur des tables denses en bureau éclairé. La console interne se réoriente en thème clair. L'exigence de densité et de lisibilité sur longues sessions, elle, est conservée.

**Interdiction maintenue :** aucun ton orange, sable, beige ou brun neutre générique.

### 17.2. Palette

Jetons CSS déclarés sur `:root` dans `apps/web/src/styles.css`, exposés à Tailwind par `tailwind.config.js`. Aucun composant ne code une valeur en dur.

| Rôle | Jeton | Valeur |
| :--- | :--- | :--- |
| Papier — fond | `--paper` | `#F6F7F5` (blanc cassé à bias vert-gris) |
| Creux — entêtes de table | `--paper-sunk` | `#EEF0ED` |
| Surface — cartes et tables | `--surface` | `#FFFFFF` |
| Encre — texte, boutons primaires | `--ink` | `#14201D` |
| Filets | `--rule` / `--rule-strong` | `#DCE1DD` / `#C3CBC6` |
| Interactif — liens, focus, onglet actif | `--link` | `#0B5D63` (pétrole profond) |

**Statuts métier** — teintes réservées **exclusivement** au statut :

| État | Jeton | Valeur | Icône obligatoire |
| :--- | :--- | :--- | :--- |
| Validé / Conforme | `--ok` | `#136F3F` | `check-circle` |
| En attente | `--warn` | `#8A5A00` | `clock` |
| En transit | `--info` | `#1A5490` | `truck` |
| Bloqué (crédit, HSE, conformité) | `--crit` | `#A81E12` | `lock` |

> **Accessibilité — règle stricte.** Le statut ne repose **jamais** sur la seule teinte : toujours **couleur + icône + libellé**. Environ 8 % des hommes présentent une déficience de vision des couleurs ; sur un verrou de sécurité, un rouge indistinct d'un vert est un risque opérationnel.

**Doublement par la forme.** Les lignes de table qui appellent une décision portent en outre un **liseré de sévérité** en bord gauche (`.row-crit`, `.row-warn`). Une échéance échue, une marge négative ou une pièce rejetée se repèrent sans lire, et restent identifiables en niveaux de gris.

**Produits** — canal visuel distinct des statuts, en teintes désaturées, chacun accompagné du code en `font-mono`.

### 17.3. Typographie et composants

**IBM Plex Sans** et **IBM Plex Mono**, **auto-hébergées** dans `apps/web/src/assets/fonts` — famille industrielle, dessinée pour un contexte technique.

> ⚠️ **Piège vérifié en production.** Une fonte déclarée mais non servie retombe **silencieusement** sur celle du système, et les réglages `font-feature-settings` qui lui sont propres deviennent inertes. C'est ce qui s'était produit avec `Inter`. Deuxième piège : Google sert désormais IBM Plex Sans en fonte **variable** — un seul fichier pour tout l'axe de graisse. Le déclarer en quatre `@font-face` de graisse fixe fait rendre chaque titre au poids par défaut, et le demi-gras n'apparaît jamais. La déclaration doit porter une **plage** (`font-weight: 400 700`). Toute reprise du script de récupération doit vérifier ces deux points.

`font-mono` pour les identifiants, références et montants. **`tabular-nums` obligatoire** sur tout montant, volume et pourcentage. Boutons bloqués **grisés avec explication** indiquant la raison précise du blocage. Data-tables haute densité, triables, paginées. Focus clavier visible partout — il ne se supprime jamais.

**TailwindCSS + Angular CDK**, avec un jeu de primitives internes (carte, badge, table dense, champ, bouton) et les tracés d'icônes Lucide intégrés au composant `erp-icon`.

**Navigation groupée par intention** — *piloter*, *vendre et livrer*, *administrer* — et non par module technique. Une liste plate de dix entrées oblige à relire les libellés à chaque fois.

> **Écart assumé par rapport au cadrage initial.** Spartan UI avait été retenu comme port Angular de Shadcn. À la construction, il est apparu qu'il ajoute une dépendance en préversion et un générateur de code pour une poignée de primitives que le projet écrit en quelques dizaines de lignes. Adopter Spartan plus tard ne changerait pas une ligne de style.

### 17.4. Terrain

L'application terrain partage le fond clair mais **renforce les contrastes** pour la lisibilité en plein soleil, et **surdimensionne les cibles tactiles** (usage avec gants).

Les documents PDF utilisent des gabarits dédiés sur fond clair, avec leur propre charte d'impression.

---
### 1.6. Pièges de sérialisation vérifiés en production

Deux défauts silencieux rencontrés à la construction, tous deux invisibles côté serveur :

> ⚠️ **`BigInt` casse `JSON.stringify`.** Le schéma en porte quatre — taille des fichiers, identifiant du journal d'audit. Toute route renvoyant un document répondait 500. Un `toJSON` est posé sur `BigInt.prototype` dans `main.ts`, rendant la valeur en **chaîne** : au-delà de 2⁵³ un `number` JavaScript perd des unités, et une taille de fichier fausse vaut moins que pas de taille du tout.

> ⚠️ **Le journal d'audit descendait dans les objets Prisma.** Les instances de `decimal.js` portent une propriété **propre et énumérable** `constructor` pointant sur une fonction. La descente récursive la recopiait, et Prisma refusait d'écrire une fonction dans une colonne JSON. **Le journal échouait alors silencieusement sur toute entité portant un montant — c'est-à-dire presque toutes.** La règle est désormais : ne descendre QUE dans les objets littéraux et les tableaux ; tout le reste est réduit à sa forme textuelle.
>
> Le service journalise l'échec sans annuler l'action métier — c'est le bon choix, mais il rend le défaut muet pour l'utilisateur. **Surveiller le compteur d'échecs d'audit en exploitation** : c'est le seul signal.

---

### 17.5. Contraintes de livraison du style

> ⚠️ **`inlineCritical` doit rester désactivé** dans `apps/web/angular.json`.
>
> Cette optimisation d'Angular injecte le CSS critique dans un `<style>` et diffère la feuille complète en `media="print" onload="this.media='all'"`. Le `onload` est un **gestionnaire d'événement en ligne**, que notre CSP refuse (`script-src 'self'`, § 1.4). La feuille reste alors destinée à l'impression et n'est **jamais appliquée à l'écran** — sans aucune erreur côté serveur.
>
> **Symptôme à reconnaître :** typographie et couleurs justes, mise en page totalement absente. C'est la signature du CSS critique seul.
>
> Ne **pas** ajouter `'unsafe-inline'` au `script-src` pour contourner : affaiblir la politique de sécurité pour compenser un défaut de build est un mauvais échange.

Corollaire : **vérifier le style appliqué, pas seulement le style servi.** Un bundle correctement téléchargé peut être intégralement ignoré. Le contrôle utile porte sur le `index.html` livré et les attributs de la balise `<link>`.

---


## 18. LOTS DE LIVRAISON

**Principe : tranches verticales, pas couches horizontales.** Faire fonctionner une chaîne complète sur un segment, la mettre en service, puis élargir. Le maritime en premier — le plus proche de l'existant, Deal et Opération en 1-to-1, sans stock, valeur unitaire la plus élevée.

| Lot | Contenu | Utilisable dès la fin du lot |
| :--- | :--- | :--- |
| **1 — Fondations** ✅ | Socle technique, référentiels complets : clients, produits, **fournisseurs § 6.3**, **sous-traitants § 6.4**, prix administrés, devises et FX. Authentification à trois réalms, RBAC, audit, registre des dérogations, console d'administration Angular. | **Livré et recetté.** Suivi de conformité opérationnel : alertes d'expiration sur assurances, contrôles techniques, agréments, habilitations. |
| **2 — Cœur commercial & exécution** ✅ | Contrat/Deal/Opération. **Le modèle de prix unique** (§ 5.2). Les 3 verrous. HSE et checklists. Relevés et ullage. Documents et signatures. Proforma, facture simple, FNE. **Registre des factures et prépaiements fournisseurs** (§ 14.6). **Maritime activé.** Web uniquement. | **Livré et recetté** — 36/36 en clôture, 32 tests négatifs en base. Une opération se pilote intégralement, du chiffrage à l'encaissement. |
| **3a — Terrain mobile** | Application tablette hors connexion, profils agent et contrôleur HSE. | Les équipes quittent le papier. |
| **3b — B2B & Retail** *(parallèle de 3a)* | Activation des deux segments : livraisons multiples sous contrat, transport routier sous-traité, **paramétrage des seuils, barèmes et taux d'absorption propres à chaque segment**. | Couverture des trois segments. |
| **4 — Barge, CRM, pilotage** | Exploitation barge, maintenance, pipeline prospect, tableaux de bord, coût complet et rentabilité par axe, **prévision annuelle** (§ 14.3), **point mort glissant** (§ 14.5), **BFR** (§ 14.6). | Pilotage complet. |
| **Ultérieur** | Stock et valorisation · comptabilité · trésorerie · RH et paie. | — |

**Le lot 2 a construit le moteur, unique pour les trois segments** ; il n'a activé que le maritime pour valider la chaîne en production. Le lot 3b est un **paramétrage**, non un développement — ce qui est la conséquence directe du retrait des formules par segment (§ 5.2), et ce qui justifie sa parallélisation.

Les quatre phases techniques — modèle de données, API/RBAC, moteur de workflow, interface — **restent valables à l'intérieur de chaque lot**. C'est un axe orthogonal.

**Dettes d'implémentation — soldées le 3 août 2026.** Avant d'ouvrir le lot 3 :

| Dette | Gravité | État |
| :--- | :--- | :--- |
| Aucune route de changement de mot de passe — le bandeau exigeait une action **inexistante** | Bloquante | Réglée |
| Enrôlement du second facteur sans écran : la sécurité exigée pour le DG et le CFO n'était qu'un bandeau | Sécurité | Réglée |
| Référentiels en lecture seule — 10 lectures, 0 écriture, contraire au § 1.1 bis | Fonctionnelle | Réglée |
| Numérotation des séquences dupliquée entre deux modules | Maintenance | Réglée |
| **Console en lecture seule** — 16 étapes d'écriture sur 39 seulement étaient déclenchables. Le moteur était complet, l'interface d'exploitation au tiers | Bloquante | Réglée — **31/31 actions branchées** |
| Prix d'achat non sélectionnable : aucune route ne listait les prix fournisseurs validés | Fonctionnelle | Réglée |
| Numérotation heurtant les références posées hors séquence | Exploitation | Réglée — sonde au compteur |
| **Invariants ajoutés après les données** : trois prix validés par un rôle non habilité, deux affaires approuvées sans prix d'achat | Sécurité | Réglée — reprise + vue `v_invariant_breaches` |

Recette : 37/37 · 36/36 · 31/31 actions · 0 écart d'invariant.

> ⚠️ **Un trigger ne s'applique qu'aux écritures POSTÉRIEURES à sa création.** Les lignes déjà en base ne sont jamais confrontées à la règle qu'on vient d'écrire : le système se croit protégé, et il l'est — pour tout ce qui arrivera. Ce qui est déjà là échappe au contrôle en silence.
>
> Tout nouvel invariant doit donc s'accompagner d'une **reprise de données** dans `09_reprise_invariants.sql`, et d'une ligne dans la vue `v_invariant_breaches`. **Cette vue doit rester vide** ; toute ligne est une anomalie à traiter.

> ⚠️ **La numérotation n'est pas seule au monde.** Une reprise de données, un jeu de démonstration ou une migration peuvent poser des références sans passer par le compteur : celui-ci repart de 1 et heurte l'existant. Le défaut ne se voit qu'à la **première création réelle, en production**. `ReferenceService` accepte donc une sonde qui avance jusqu'à trouver un numéro libre — les numéros sautés le sont une fois pour toutes, le compteur restant monotone comme la loi l'exige.

**Chantier parallèle, à engager immédiatement :** obtention de l'accès à l'API DGI pour la FNE (§ 9.5).

---

## 19. POINTS OUVERTS

| # | Point | Impact | Hypothèse retenue |
| :-- | :--- | :--- | :--- |
| 1 | Unité du seuil de marge de 30 FCFA | Verrou de marge | **Par litre**, sur marge **après charges complètes** (§ 5.4) |
| 2b | Valeur du plancher direct | Verrou de marge | **10 FCFA/L** — couvre environ 4× l'ullage au seuil (§ 5.4) |
| 2c | **Regroupements de charges indirectes** et leurs assiettes | Taux d'absorption | Structure posée (§ 14.2), contenu à définir avec le CFO |
| 2d | **Taux de financement** du portage | Coût de portage, § 5.4 | Illustré à 10 % l'an — **à caler sur vos conditions bancaires réelles** |
| 2e | **Budget annuel des charges fixes** | Point mort, § 14.5 | Saisi et versionné par le CFO en attendant le module comptable |
| 3 | Valeurs des seuils d'ullage par mode | Alertes et blocages | Toutes initialisées à 0,2 %, à calibrer sur vos contrats de transport et polices d'assurance |
| 4 | Mécanismes d'enlèvement SIR / GESTOCI | Approvisionnement | Modélisés comme modalités paramétrables, à documenter |
| 5 | Modalités techniques de l'API FNE | Module fiscal | API existante, spécification à communiquer |
| 6 | Règles fiscales (document par opération, taux par produit) | Moteur documentaire | Paramétrables. **Validation par votre conseil fiscal — hors périmètre de ce document.** |
| 7 | Valeur juridique de la signature électronique | Opposabilité des relevés | À valider si opposition en litige envisagée |
| 8 | Plan de comptes et schémas comptables cibles | Reprise comptable future | Axes analytiques posés (§ 14), module différé |
