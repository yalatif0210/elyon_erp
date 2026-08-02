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
| Référence de prix | Platts | **Platts · SIR · prix à la pompe DGH · contractuel**, résolus par contexte |

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

| Conséquence | Portée |
| :--- | :--- |
| Aucune constante métier dans le code — seuils, taux, tolérances, règles fiscales, checklists, formules | Déjà appliqué (§ 2 du cadrage client) |
| Chaque table administrable expose une **interface de saisie unitaire** | Écrans à produire au fil des lots |
| Chaque table administrable accepte un **import de fichier** avec rapport de rejet ligne à ligne | Mécanisme générique à construire |

Les trois modes d'alimentation se distinguent et ne réclament pas le même soin :

- **Reprise** (tiers, sites, véhicules, chauffeurs, pièces de conformité) — volume élevé, une seule fois. L'import prime ; la saisie unitaire ne sert qu'aux corrections.
- **Données vivantes** (taux de change, prix administrés, prix fournisseurs, renouvellements) — la friction de saisie se paie en justesse des chiffres. Un taux difficile à mettre à jour ne sera pas mis à jour, et toute la facturation dérive.
- **Paramètres de gouvernance** (devises, seuils, tolérances, postes de coûts, taux d'absorption) — rares mais lourds de conséquence. Ce qui compte n'est pas la facilité de saisie mais la **traçabilité** : motif obligatoire, versionnement, ancienne valeur conservée.

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

### 5.2. Les quatre formules

| Segment | Cas | Formule |
| :--- | :--- | :--- |
| **Maritime** | Navire exonéré (pêche) → **HT** | `Prix HT = Prix de base/CIF HT + Prime ou marge + Transport + Frais administratifs + Autres coûts` |
| **Maritime** | Navire non exonéré → **TTC** | `Prix TTC = Prix à la pompe − Réduction` |
| **B2B** | — | `Prix de vente = Coût complet + Marge + Taxes applicables` |
| **Retail** | — | `Prix de cession = Prix à la pompe − Marge attribuée à la station` |

- La **réduction** maritime s'exprime au choix en **montant par litre** ou en **pourcentage**.
- Le **coût complet** B2B intègre achat, transport, administration, coûts opérationnels **et HSE**, remises et taxes.
- **Le prix de vente reste distinct du prix réel d'achat.** Le système ne dérive jamais l'un de l'autre automatiquement.

### 5.3. Prix administrés — une référence, pas un moteur

**Décision du 2026-08-02 : le système ne dérive aucun prix.** Deux valeurs seulement gouvernent la marge — **le prix de vente que le commercial fixe** et **le prix d'achat réellement payé**. Que le prix de vente soit égal au prix à la pompe, à la pompe moins une réduction, ou à tout autre montant négocié, ne regarde pas le système : il enregistre la valeur fixée.

Le prix à la pompe est **publié par la DGH**, à **périodicité variable** ; le prix SIR est fixé par la SIR. Ils sont **paramétrables et horodatés**, jamais codés en dur, jamais écrasés : chaque publication est une nouvelle ligne datée.

Leur **rôle unique** : une référence que le commercial consulte au moment de fixer son prix. Un champ de commentaire libre permet d'y noter une décomposition indicative — prix d'achat marketeur, marge marketeur, marge station — sans qu'aucune contrainte ne la vérifie ni ne s'en serve.

> ⚠️ **Un prix administré n'alimente jamais un coût.** Le coût d'achat provient exclusivement d'un **prix fournisseur validé** (§ 6.3). C'est le seul invariant qui compte ici, et il porte sur le coût, pas sur la structure du prix public.

*Historique : une décomposition en composantes avec dérivation automatique de deux niveaux d'achat avait été modélisée, puis retirée. Elle protégeait rigidement une donnée publiée par un tiers, pour n'alimenter qu'un seul calcul — au prix d'un refus d'enregistrer toute publication dont les composantes ne sommeraient pas exactement.*

### 5.4. Marge et seuil minimum

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

Le volume **acheté** est le volume chargé ; le volume **vendu** est le volume livré. L'écart est du produit payé et non vendu : il gonfle mécaniquement le coût d'achat unitaire.

```
Sur 3 000 L livrés, écart de 0,35 %, achat à 700 FCFA/L :
   volume chargé            3 010,5 L
   coût d'achat total       2 107 350 FCFA
   coût par litre livré        702,45 FCFA     (au lieu de 700)
   → l'ullage consomme        2,45 FCFA/L
```

Soit plus de **8 % d'un plancher de 30 FCFA**. La perte de volume est donc **chiffrée en devise et affichée comme une ligne de coût** dans le calcul de rentabilité, à côté des autres charges.

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
| Retail | **10** FCFA | **30** FCFA | par litre |
| B2B | **10** FCFA | **30** FCFA | par litre |
| Maritime | *à définir* | *à définir* | — |

> Les seuils maritimes sont laissés vides plutôt qu'inventés.

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
| **Platts** (indexé) | Fenêtre de cotation + prime. Voir § 5.6. |
| **Prix SIR** | Approvisionnement domestique |
| **Prix à la pompe DGH** | Maritime TTC, Retail |
| **Prix contractuel** | Négocié au contrat-cadre ou au Deal |

Même mécanique que le moteur documentaire du § 9.4 — **un seul moteur de résolution, deux usages**.

### 5.6. Prix indexé Platts

Dans le négoce international, le prix est indexé sur une cotation publiée. Platts publie chaque jour une **fourchette** (*low* / *high*) dont la moyenne — le *mean of Platts* — est la valeur contractualisée.

> *Prix = moyenne du Platts FOB Rotterdam Gasoil 10 ppm sur les 5 cotations du 20 au 24 juillet, + prime de 28,50 $/MT.*

| Élément | Rôle |
| :--- | :--- |
| **L'indice** | Produit, place et qualité cotée. Deux indices sur un même produit peuvent différer de plusieurs dollars la tonne. |
| **La fenêtre de cotation** | Période dont on prend la moyenne, souvent calée sur la date de connaissement. |
| **La prime** | Écart contractuel appliqué à la moyenne. Peut être négative. |

**Conséquence structurante : à la signature, le prix n'existe pas.** Deux prix successifs coexistent — un **provisoire** qui chiffre la Proforma et pèse sur l'encours crédit, un **définitif** arrêté à la clôture de la fenêtre, seul admissible en facturation définitive (§ 11.3).

---

## 6. RÉFÉRENTIELS

### 6.1. Clients et prospects

Identité, contacts, informations fiscales (Numéro de Compte Contribuable, RCCM, régime, exonérations avec référence opposable), **segment**, conditions commerciales, devise, **plafond de crédit**, conditions de paiement, **régime documentaire et fiscal** (§ 9.4), contrats, historique des opérations, factures et encaissements.

Un prospect gagné est **converti en client sans duplication**, historique conservé.

### 6.2. Produits

Type, qualité, spécifications, unités (**litre, m³, tonne**), densité de référence à 15 °C, viscosité, point d'éclair, teneur en soufre, paramètres techniques, **régime fiscal**, indice de cotation par défaut.

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

**Postes livrés à l'initialisation :** achat · chargement · déchargement · manutention · transit · frais portuaires · stockage · throughput · transport · péages · attente · frais de route · administration · banque · commissions · HSE · assurances · pénalités · coûts exceptionnels · perte de change · **perte de volume (ullage)** · **portage financier** (§ 5.4).

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

Chaque contrôle est **obligatoire, recommandé, conditionnel ou bloquant**.

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
| `seuil_alerte` | Alerte + **blocage de la facturation** jusqu'à acquittement motivé |
| `seuil_critique` | Blocage + **non-conformité HSE ouverte d'office**, avec enquête |
| `franchise_absolue` | Volume plancher sous lequel aucun seuil ne se déclenche |

**Initialisation à 0,2 % sur toutes les lignes** — valeur actuelle. À calibrer contrat par contrat.

**Le lien avec le HSE.** Un écart de volume important n'est pas seulement un problème commercial : **le produit est allé quelque part**. Fuite, déversement ou détournement. Les trois relèvent du HSE ou de la sûreté. Le franchissement du seuil critique ouvre donc automatiquement une non-conformité HSE — l'écart d'ullage devient un **capteur**, pas seulement un contrôle de facturation.

**L'acquittement** est réservé au `HSE_CONTROLLER`, au `CCOO`, au `FINANCE_CFO` et au `DG`. Motif obligatoire, tracé.

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

**Pourquoi USD comme pivot.** Sourcing, fret et cotations Platts sont libellés en dollars : c'est là que la marge se forme. Un pivot XOF ferait apparaître un résultat de change sur chaque opération alors que l'exposition économique est dollar.

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

**Angular + Capacitor** — réutilise l'investissement Angular, un seul code applicatif, et donne accès aux API natives réellement nécessaires : appareil photo, GPS, stockage sécurisé, notifications. Une PWA pure bute sur les restrictions iOS d'éviction du stockage et de synchronisation en arrière-plan.

**Principe : synchroniser des événements, pas des états.**

La tablette ne détient pas une copie modifiable de l'opération qu'elle renverrait au serveur — cette approche fabrique des conflits insolubles. Elle produit un **journal d'événements en ajout seul** : *« étape chargement validée à 14h32 »*, *« volume relevé : 28 450 L à 31,2 °C »*, *« incident déclaré »*. Chaque événement porte un **UUID généré sur l'appareil**, ce qui rend la synchronisation **idempotente** : un renvoi après coupure ne duplique rien.

Le serveur reste seul juge de l'état résultant et **rejette les événements violant un invariant** — un chargement déclaré avant validation HSE, par exemple. Le rejet redescend sur l'appareil pour résolution. Les conflits sont rares par construction : une opération est affectée à un agent.

**Hors connexion : aucune limite fonctionnelle de durée.** Purge automatique des opérations clôturées et synchronisées au-delà d'un délai paramétrable. Le facteur limitant est le volume des photos, non les données métier.

**Les photos ne transitent pas dans le flux d'événements** — compression sur l'appareil, file d'envoi séparée avec reprise. Sinon une opération à vingt photos bloque toute la synchronisation.

**L'horloge de l'appareil n'est pas fiable.** Les deux horodatages sont conservés — appareil et réception serveur. Un écart important est en soi un signal d'audit.

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
| Prix indexé : facture impossible tant que le prix n'est pas arrêté ; prix facturé = prix arrêté | § 5.6 |
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

**Prévoir en volume, dériver le chiffre d'affaires.** Le prix bouge sans que l'entreprise le décide — publications DGH, cotations Platts, taux de change. Une prévision en CA laisse une hausse de prix masquer une perte de volume. Le volume est la variable réellement pilotée ; le CA s'en déduit par un prix de référence, et **l'écart de prix s'analyse séparément de l'écart de volume**.

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

**Forme opérationnelle, glissante.** Les prix de vente bougent sans que l'entreprise les décide (DGH, Platts, change) : une marge sur coût variable arrêtée une fois l'an est périmée en mars. Le point mort est donc recalculé sur la structure de prix courante et présenté sous forme de trajectoire :

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

### 17.1. Direction artistique

Look **« Fintech / Dashboard de trading professionnel »**, inspiré d'un Bloomberg Terminal moderne, de Linear.app et de Vercel. Priorité au mode sombre, densité d'information élevée, lisibilité sur longues sessions.

**Interdiction :** ne pas utiliser la palette par défaut de Claude / Anthropic — aucun ton orange, sable, beige ou brun neutre générique.

### 17.2. Palette

| Usage | Valeur |
| :--- | :--- |
| Fond principal | `bg-slate-950` |
| Cartes & conteneurs | `bg-slate-900` + `border-slate-800` |
| Accent primaire | `sky-500` |

**Statuts métier** — couleurs vives, réservées **exclusivement** au statut :

| État | Couleur | Icône obligatoire |
| :--- | :--- | :--- |
| Validé / Conforme | `emerald-500` | `check-circle` |
| En attente | `amber-500` | `clock` |
| En transit | `blue-500` | `truck` |
| Bloqué (crédit, HSE, conformité) | `rose-500` | `lock` |

> **Accessibilité — règle stricte.** Le statut ne repose **jamais** sur la seule teinte : toujours **couleur + icône + libellé**. Environ 8 % des hommes présentent une déficience de vision des couleurs ; sur un verrou de sécurité, un rouge indistinct d'un vert est un risque opérationnel.

**Produits** — canal visuel distinct, en teintes désaturées, pour éviter toute collision dans les tables denses : Fuel 180 `violet-400/70` · MGO `cyan-400/70` · Diesel `amber-400/70` · Essence `emerald-400/70`, chacun accompagné du code en `font-mono`.

### 17.3. Composants

**TailwindCSS + Angular CDK**, avec un jeu de primitives internes (carte, badge, table dense, champ, bouton) écrites dans l'idiome Shadcn/Spartan, et les tracés d'icônes Lucide intégrés au composant `erp-icon`.

Typographie `Inter` ou `Plus Jakarta Sans`, `font-mono` pour les identifiants et montants. **`tabular-nums` obligatoire** sur tous les montants, volumes et pourcentages. Boutons bloqués **grisés avec tooltip explicatif** indiquant la raison précise du blocage. Data-tables haute densité, triables, paginées.

> **Écart assumé par rapport au cadrage initial.** Spartan UI avait été retenu comme port Angular de Shadcn. À la construction, il est apparu qu'il ajoute une dépendance en préversion et un générateur de code pour une poignée de primitives que le projet écrit en quelques dizaines de lignes. Le rendu visuel est identique — mêmes classes Tailwind, même grammaire. Adopter Spartan plus tard ne changerait pas une ligne de style.

### 17.4. Terrain et thème clair

L'application terrain déroge au mode sombre : **lisibilité en plein soleil**, contrastes renforcés, **cibles tactiles surdimensionnées** (usage avec gants).

Les documents PDF utilisent des gabarits dédiés sur fond clair, avec leur propre charte d'impression.

---

## 18. LOTS DE LIVRAISON

**Principe : tranches verticales, pas couches horizontales.** Faire fonctionner une chaîne complète sur un segment, la mettre en service, puis élargir. Le maritime en premier — le plus proche de l'existant, Deal et Opération en 1-to-1, ni stock ni marge station, valeur unitaire la plus élevée.

| Lot | Contenu | Utilisable dès la fin du lot |
| :--- | :--- | :--- |
| **1 — Fondations** ✅ | Socle technique, référentiels complets : clients, produits, **fournisseurs § 6.3**, **sous-traitants § 6.4**, prix administrés, devises et FX. Authentification à trois réalms, RBAC, audit, registre des dérogations, console d'administration Angular. | **Livré et recetté.** Suivi de conformité opérationnel : alertes d'expiration sur assurances, contrôles techniques, agréments, habilitations. |
| **2 — Cœur commercial & exécution** | Contrat/Deal/Opération. **Les 4 formules de prix.** Les 3 verrous. HSE et checklists. Relevés et ullage. Documents et signatures. Proforma, facture simple, FNE. **Registre des factures et prépaiements fournisseurs** (§ 14.6). **Maritime activé.** Web uniquement. | Première mise en service. Une opération de soutage se pilote intégralement. |
| **3a — Terrain mobile** | Application tablette hors connexion, profils agent et contrôleur HSE. | Les équipes quittent le papier. |
| **3b — B2B & Retail** *(parallèle de 3a)* | Activation des deux segments : livraisons multiples sous contrat, transport routier sous-traité, marge station. | Couverture des trois segments. |
| **4 — Barge, CRM, pilotage** | Exploitation barge, maintenance, pipeline prospect, tableaux de bord, coût complet et rentabilité par axe, **prévision annuelle** (§ 14.3), **point mort glissant** (§ 14.5), **BFR** (§ 14.6). | Pilotage complet. |
| **Ultérieur** | Stock et valorisation · comptabilité · trésorerie · RH et paie. | — |

**Le lot 2 construit le moteur pour les quatre formules**, il n'active que le maritime pour valider la chaîne en production. Le lot 3b est une activation, non un développement lourd — d'où sa parallélisation.

Les quatre phases techniques — modèle de données, API/RBAC, moteur de workflow, interface — **restent valables à l'intérieur de chaque lot**. C'est un axe orthogonal.

**Chantier parallèle, à engager immédiatement :** obtention de l'accès à l'API DGI pour la FNE (§ 9.5).

---

## 19. POINTS OUVERTS

| # | Point | Impact | Hypothèse retenue |
| :-- | :--- | :--- | :--- |
| 1 | Unité du seuil de marge de 30 FCFA | Verrou de marge | **Par litre**, sur marge **après charges complètes** (§ 5.4) |
| 2 | Seuil de marge du segment maritime | Verrou de marge | Non renseigné — à définir plutôt qu'inventer |
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
