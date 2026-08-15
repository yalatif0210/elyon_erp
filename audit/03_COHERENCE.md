# 03 — COHÉRENCE

Rappel du § 0 de `00_PERIMETRE.md` : **l'auditeur est l'auteur du code**. Cet axe est
moins exposé que les axes A et C au biais de justification — la plupart des constats
ci-dessous se vérifient par une simple confrontation de deux fichiers, sans jugement
de valeur possible sur « pourquoi c'est comme ça ». Je m'y tiens : chaque constat
rapproche deux emplacements précis du dépôt, et laisse le lecteur juger.

État du dépôt au moment de cet axe : identique à celui de `05_ARCHITECTURE.md`
(18 fichiers modifiés, 12 non versionnés depuis `1ff842d`). Le périmètre récent
(facturation FNE, PDF, portail, barge, recouvrement) est examiné en priorité, comme
demandé, sans négliger le socle plus ancien pour les vérifications transversales
(énumérations, formats).

---

## 0. LIMITES DÉCLARÉES

| # | Limite | Effet |
|---|---|---|
| L1 | **Pas de vérification exhaustive des 55 énumérations ni des 59 interfaces client.** Le prompt demande explicitement de « cartographier l'hétérogénéité plutôt que d'en dresser la liste exhaustive » (§ 8) : j'ai vérifié en profondeur les énumérations qui pilotent des machines à états métier consultées en liste (`DealStatus`, `OperationStatus`, `InvoiceStatus`, `FneStatus`), pas les 51 autres. | Une désynchronisation sur une énumération de référentiel secondaire (ex. un type d'incident HSE peu fréquent) resterait non détectée par cet audit. |
| L2 | **Pas d'exécution du frontend.** Les constats sur le rendu (colonnes vides, plantage de composant) sont établis par lecture croisée serveur/client, pas par capture d'écran. Je les qualifie `CONSTATÉ` quand la chaîne de preuve est directe (le champ n'existe nulle part dans le type, le gabarit ne le lit jamais), `INFÉRÉ` quand un maillon reste déduit. |
| L3 | **Le référentiel fonctionnel ne prescrit pas de convention de nommage.** `SPECIFICATIONS.md` ne fixe ni glossaire ni règle de nomenclature. Les constats de cette section jugent donc la cohérence **interne** du dépôt, pas sa conformité à une norme externe qui n'existe pas. |

---

## 1. VERDICT DE L'AXE

> **Le socle applicatif tient ses contrats ; les modules greffés récemment n'ont pas
> encore reçu la même discipline.**
>
> Sur le périmètre ancien (affaires, opérations, facturation simple, HSE), le contrat
> client/serveur est explicite : 59 interfaces TypeScript exportées côté web, alignées
> champ à champ avec ce que les contrôleurs renvoient, une gestion d'erreur centralisée
> (`ActionState`/`HttpFailure`) reprise par huit écrans. Deux défauts significatifs
> existent malgré tout dans ce socle — une énumération de statut à moitié câblée côté
> écran (§ 2.1), une divergence de comportement en cas d'échec de validation qui touche
> justement l'écran le plus exposé, la connexion (§ 3.1).
>
> Le module documentaire — `documents`, `pdf.processor`, signatures, scellement,
> ajouté après `01_COUVERTURE_FONCTIONNELLE.md` — n'a **aucun** contrat de type, ni côté
> serveur (`Promise<Page<unknown>>`) ni côté client (`Observable<Page<unknown>>`), seul
> module dans ce cas sur les seize que compte l'API. Un champ que le serveur envoie
> bel et bien (`invoice`) n'existe dans aucun type client, et sa conséquence est
> vérifiable dans le gabarit : la colonne « rattachée à » du registre documentaire
> reste vide pour toute pièce de facturation — proforma, facture simple, FNE, avoir —
> soit la quasi-totalité des documents produits en usage réel.

---

## 2. CONTRAT CLIENT/SERVEUR

### 2.1 [S2] `DealStatus` compte 18 valeurs ; l'écran des affaires n'en connaît que 9, et en affiche une dixième qui n'existe pas

```
Propriété    : P5 Restitution
Axe          : Cohérence
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/prisma/schema.prisma:2108-2129` (énumération) et
`apps/web/src/app/features/deals.component.ts:13-24` (table de rendu).

**Extrait — l'énumération complète (18 valeurs) :**

```prisma
enum DealStatus {
  DRAFT
  FEASIBILITY_STUDY
  QUOTED
  PENDING_RISK
  CREDIT_BLOCKED
  PENDING_DG_APPROVAL
  APPROVED
  PROFORMA_SENT
  CUSTOMER_ACCEPTED
  REJECTED_BY_CLIENT
  IN_EXECUTION
  DELIVERED
  PARTIALLY_DELIVERED
  QUALITY_CLAIM
  INVOICED
  DISPUTED
  CLOSED
  CANCELLED
}
```

**Extrait — la table de correspondance, écran « Affaires » :**

```ts
const DEAL_STATUS: Record<string, { label: string; kind: StatusKind }> = {
  DRAFT: { label: 'Brouillon', kind: 'neutral' },
  PENDING_RISK: { label: 'Contrôle du risque', kind: 'wait' },
  PENDING_DG_APPROVAL: { label: 'Accord DG attendu', kind: 'blocked' },
  APPROVED: { label: 'Approuvée', kind: 'ok' },
  IN_EXECUTION: { label: 'En exécution', kind: 'transit' },
  DELIVERED: { label: 'Livrée', kind: 'ok' },
  INVOICED: { label: 'Facturée', kind: 'ok' },
  CLOSED: { label: 'Clôturée', kind: 'neutral' },
  CANCELLED: { label: 'Annulée', kind: 'neutral' },
  LOST: { label: 'Perdue', kind: 'neutral' },   // ← n'existe pas dans DealStatus
};

export function dealStatus(code: string): { label: string; kind: StatusKind } {
  return DEAL_STATUS[code] ?? { label: code, kind: 'neutral' };
}
```

**Mécanisme.** Neuf valeurs de l'énumération n'ont **aucune entrée** dans la table :
`FEASIBILITY_STUDY`, `QUOTED`, `CREDIT_BLOCKED`, `PROFORMA_SENT`, `CUSTOMER_ACCEPTED`,
`REJECTED_BY_CLIENT`, `PARTIALLY_DELIVERED`, `QUALITY_CLAIM`, `DISPUTED`. La fonction
`dealStatus()` a un filet — le code technique brut sert de libellé et la teinte
retombe sur `neutral` — mais ce filet est précisément celui que le composant
`StatusBadgeComponent` interdit par ailleurs :

> `status-badge.component.ts:22-27` — « RÈGLE STRICTE : couleur + icône + libellé,
> toujours les trois. Le composant rend impossible d'afficher un statut par la seule
> teinte, ce qui serait **un risque opérationnel sur un verrou de sécurité**. »

`CREDIT_BLOCKED` — un verrou de crédit posé par le CFO — retombe justement sur ce
filet : badge gris neutre, libellé `CREDIT_BLOCKED` en toutes lettres au lieu d'un
texte métier, alors que `PENDING_DG_APPROVAL` (une étape moins bloquante) est câblée
et rendue en badge rouge « bloqué ». `QUALITY_CLAIM` (réclamation qualité) et
`DISPUTED` (litige) partagent le même sort.

Une dixième entrée, `LOST`, ne correspond à **aucune** valeur de `DealStatus` — recherche
confirmée dans le schéma et dans `apps/api/src/sales/deals.controller.ts` : aucune
occurrence. `LOST` est un statut réel, mais d'un autre objet : `apps/web/src/app/features/crm.component.ts:470`
l'utilise pour l'issue d'une **opportunité CRM** (`Opportunity.issue`). L'entrée est un
résidu — soit une confusion entre les deux objets au moment de l'écrire, soit une trace
d'un modèle antérieur où les deux étaient confondus.

**Ce que la preuve établit sur la portée réelle.** Les neuf valeurs non câblées ne sont
pas mortes :
- `PROFORMA_SENT` → `CUSTOMER_ACCEPTED` est posé activement par le portail client
  (`apps/api/src/portal/portal.controller.ts:164,173,182-183,196`, transition
  d'acceptation de proforma) ;
- `CREDIT_BLOCKED`, `REJECTED_BY_CLIENT`, `PARTIALLY_DELIVERED`, `QUALITY_CLAIM` sont
  filtrées explicitement dans des vues métier de pilotage
  (`apps/api/prisma/sql/06_lot2_views.sql:79,98,102,230`,
  `apps/api/prisma/sql/19_verrou_credit.sql:113`,
  `apps/api/prisma/sql/25_pilotage_financier.sql:40,307`) — ce sont des états que le
  système lui-même distingue pour ses propres calculs d'encours et de performance ;
- `QUOTED` figure dans le jeu de test des invariants
  (`apps/api/prisma/sql/tests/lot2_negative.sql:54`).

Ce ne sont donc pas des valeurs théoriques jamais atteintes : ce sont des états
réellement empruntés par le cycle de vie de l'affaire, invisibles à l'écran qui existe
pour les montrer.

**Impact — scénario concret.** Un client accepte une proforma depuis le portail :
l'affaire passe en `CUSTOMER_ACCEPTED`. Un commercial ouvre la liste des affaires pour
vérifier où en est le dossier : il lit `CUSTOMER_ACCEPTED` en toutes lettres sur fond
gris — le même gris qu'une affaire `DRAFT` jamais travaillée. Sur une affaire bloquée
en crédit (`CREDIT_BLOCKED`), le même gris neutre remplace le rouge que porte, à
l'écran, un blocage moins grave (`PENDING_DG_APPROVAL`) : un utilisateur qui balaie
la liste visuellement — l'usage normal d'un tableau de statuts — a une chance réelle de
ne pas remarquer le blocage.

**Correctif** — effort **S** : compléter `DEAL_STATUS` avec les neuf entrées manquantes
et retirer `LOST` ; un test de non-régression trivial (vérifier que `Object.keys` de
la table couvre l'énumération Prisma) empêcherait la récidive au prochain ajout de
statut.

---

### 2.2 [S3] Le module documentaire n'a de contrat de type ni côté serveur ni côté client — un champ envoyé par l'un est absent de l'autre, et la colonne qui doit l'afficher reste vide

```
Propriété    : P5 Restitution
Axe          : Cohérence
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/src/documents/documents.controller.ts:133,148-154` (service
serveur), `apps/web/src/app/core/api.service.ts:1348-1367` (client),
`apps/web/src/app/features/documents.component.ts:13-27,124` (écran).

**Extrait — le service serveur ne type pas sa propre réponse :**

```ts
// documents.controller.ts:133
async list(query: DocumentQuery): Promise<Page<unknown>> {
  ...
  include: {
    deal: { select: { reference: true } },
    operation: { select: { reference: true } },
    invoice: { select: { number: true } },        // ← ligne 151
    generatedBy: { select: { fullName: true } },
    supersedes: { select: { reference: true } },
    _count: { select: { signatures: true } },
  },
```

**Extrait — le client, symétriquement non typé :**

```ts
// api.service.ts:1348-1352
documents(page = 1): Observable<Page<unknown>> {
  return this.http.get<Page<unknown>>(`${this.base}/documents`, {
    params: new HttpParams().set('page', page).set('pageSize', 50),
  });
}
```

**Extrait — l'écran redéclare son propre type local, sans le champ `invoice` :**

```ts
// documents.component.ts:13-27
interface DocumentRow {
  id: string;
  kind: string;
  reference: string;
  isSealed: boolean;
  sealedAt: string | null;
  sha256: string;
  authenticityToken: string;
  generatedAt: string;
  deal: { reference: string } | null;
  operation: { reference: string } | null;
  supersedes: { reference: string } | null;
  generatedBy: { fullName: string } | null;
  _count: { signatures: number };
}
```

```ts
// documents.component.ts:124 — la colonne « rattachée à »
{{ d.operation?.reference ?? d.deal?.reference ?? '-' }}
```

**Mécanisme.** `apps/web/src/app/core/api.service.ts` déclare **59 interfaces**
exportées (`DealRow`, `InvoiceRow`, `OperationRow`, `SupplierInvoiceRow`, etc.) qui
alignent explicitement chaque module au contrat que son contrôleur renvoie. Le module
`documents` est le seul des seize modules de l'API à échapper à cette discipline : sa
méthode `documents()` rend `Observable<Page<unknown>>`, et l'écran compense en
redéclarant **son propre type local**, non partagé, non vérifié à la compilation contre
ce que le serveur envoie réellement.

Cette redéclaration a divergé du serveur sur un point précis. `GeneratedDocument`
porte trois relations d'attache possibles — `deal`, `operation`, `invoice`
(`schema.prisma`, cf. `05_ARCHITECTURE.md` § 2, constat 3) — et le service serveur les
inclut toutes les trois dans sa réponse (ligne 151 ci-dessus). Le type local de
l'écran n'en déclare que deux. La conséquence n'est pas seulement typographique :
`documents.component.ts:124` lit `d.operation?.reference ?? d.deal?.reference ?? '-'`
— jamais `d.invoice`.

Or les pièces émises par le flux de facturation (`pdf.processor.ts:114-115`) sont
enregistrées avec **uniquement** `invoiceId`, ni `dealId` ni `operationId` :

```ts
// pdf.processor.ts:114-115
const registered = await this.documents.register(
  { kind, invoiceId, storageKey: stored.storageKey, ... },
```

**Ce que la base montre.** Les genres de pièces produits par ce chemin — `PROFORMA`,
`INVOICE`, `CREDIT_NOTE` d'après la table `KINDS` de l'écran lui-même
(`documents.component.ts:29-37`) — sont exactement ceux qui n'ont ni `deal` ni
`operation`. Pour chacun d'eux, la colonne « rattachée à » du registre documentaire
affiche **`-`**, quelle que soit la facture réellement liée : c'est le résultat
mécanique de la chaîne ci-dessus, pas une hypothèse.

**Impact — scénario concret.** Un comptable ouvre le registre documentaire (§ 12 du
référentiel — c'est l'écran conçu pour retrouver une pièce scellée) pour vérifier
qu'une FNE donnée a bien été générée. La liste affiche la référence du document et
son genre (« Facture normalisée »), mais la colonne censée dire *à quoi* la pièce se
rattache est vide pour toutes les factures, avoirs et proformas — précisément le
sous-ensemble de pièces le plus consulté sur cet écran, puisque les bons de livraison
et rapports d'exécution (rattachés à une opération) restent, eux, correctement
affichés. Le comptable doit ouvrir chaque pièce individuellement ou déjà connaître le
numéro de facture pour la retrouver — l'écran ne remplit plus sa fonction de registre
consultable.

**Correctif** — effort **S** :
1. Ajouter `invoice: { number: string } | null` à l'interface `DocumentRow`, et
   `d.invoice?.number` en dernier recours de la colonne (`d.operation?.reference ??
   d.deal?.reference ?? d.invoice?.number ?? '-'`).
2. Effort **M**, non urgent : typer `documents()` et `DocumentsService.list()`/
   `findOne()` avec des interfaces partagées comme les 59 autres méthodes du fichier —
   la redéclaration locale qui a permis la divergence disparaît d'elle-même si le type
   vient du serveur.

---

### Le reste du contrat : `RAS`, avec une réserve de méthode

`OperationStatus` (12 valeurs), `InvoiceStatus` (7 valeurs) et `FneStatus`
(9 valeurs) sont intégralement câblés côté écran — vérifié valeur par valeur
(`apps/web/src/app/features/operations.component.ts:13-24`,
`apps/web/src/app/features/invoices.component.ts:20-40`). Ce contraste confirme que le
défaut du § 2.1 est ponctuel, pas un défaut de méthode généralisé : le même type
d'écran, sur le même patron de code, tient le contrat ailleurs. Aucun champ orphelin
ni type divergent trouvé sur `DealRow`, `OperationRow`, `InvoiceRow`,
`SupplierInvoiceRow`, comparés à leurs contrôleurs respectifs.

---

## 3. GESTION DES ERREURS

### 3.1 [S3] Un mécanisme unique existe et couvre huit écrans — quatre autres le réinventent chacun à leur façon, et l'écran de connexion s'expose à un plantage silencieux

```
Propriété    : P5 Restitution
Axe          : Cohérence
Statut       : CONSTATÉ
```

**Localisation** — `apps/web/src/app/shared/action-panel.component.ts:5-14`
(mécanisme central) et `apps/web/src/app/features/login.component.ts:135-143`
(écran qui s'en écarte).

**Extrait — le mécanisme central, avec son commentaire d'intention :**

```ts
// action-panel.component.ts:4-14
/** Refus renvoyé par l'API — la validation rend un tableau, le métier une chaîne. */
export interface HttpFailure {
  error?: { message?: string | string[] };
}

export function failureMessage(e: HttpFailure, fallback = 'Opération refusée.'): string {
  const m = e.error?.message;
  if (Array.isArray(m)) return m[0] ?? fallback;
  return m ?? fallback;
}
```

**Mécanisme.** Le commentaire nomme exactement la source de l'hétérogénéité : NestJS
rend `message` en **tableau** de chaînes quand le refus vient de la validation
automatique de `class-validator` (`ValidationPipe` global,
`apps/api/src/main.ts:77-84`, sans `exceptionFactory` personnalisé — comportement par
défaut de Nest), et en **chaîne unique** quand il vient d'un `throw new
BadRequestException('texte')` écrit à la main dans un contrôleur ou un service. Les
deux formes sont légitimes et coexistent par construction ; `failureMessage()` les
unifie en un point.

Huit écrans utilisent ce point unique via `ActionState.fail()`
(`action-panel.component.ts:74-77`) : `barge.component.ts:249`,
`compliance.component.ts:246`, `deal-actions.component.ts:312,341`,
`collections.component.ts:219`, `documents.component.ts:325,362,374,395`,
`invoice-actions.component.ts:257,489,514,538,559,579`, `hse.component.ts:229,252`,
`operation-create.component.ts:578`.

Quatre autres écrans **réimplémentent la même logique indépendamment**, avec des
résultats inégaux :

| Écran | Traitement du cas tableau | Preuve |
|---|---|---|
| `parameters.component.ts` | Géré — fonction locale `extractErrors()`, qui gère même un troisième cas (`errors: [...]`, propre à l'import de paramétrage) | `parameters.component.ts:1097-1100` |
| `deal-costing.component.ts` | Géré en ligne — `Array.isArray(m) ? m[0] : ...` | `deal-costing.component.ts:417-420` |
| `account.component.ts` | Géré — fonction locale `firstMessage()`, quasi identique à `failureMessage()` mais réécrite sous un autre nom | `account.component.ts:333-337` |
| `login.component.ts` | **Non géré** — le type déclaré est `string`, pas `string \| string[]` | `login.component.ts:135` |

**Extrait — l'écran de connexion, seul des quatre à ne pas se protéger :**

```ts
// login.component.ts:135-143
error: (err: { error?: { message?: string } }) => {
  this.busy.set(false);
  const message = err.error?.message ?? 'Connexion impossible';
  if (message.toLowerCase().includes('second facteur')) {
    this.totpRequired.set(true);
  }
  this.error.set(message);
},
```

`LoginDto` porte des contraintes de validation actives et atteignables par un
utilisateur sans compte ni intention malveillante :

```ts
// auth.dto.ts:4-10
@IsEmail({}, { message: 'Adresse électronique invalide' })
@MaxLength(255)
email!: string;

@IsString()
@Length(8, 200, { message: 'Mot de passe de 8 caractères minimum' })
password!: string;
```

**Ce que la chaîne de preuve établit.** Un mot de passe de moins de 8 caractères, ou
une adresse mal formée, sont rejetés **avant** que `AuthService.loginInternal()` ne
s'exécute — par le `ValidationPipe` global, qui rend `{ message: ['Mot de passe de 8
caractères minimum'], statusCode: 400 }`. `err.error?.message` vaut alors un
**tableau**. Le code déclare le type `string`, ce qui ne change rien à
l'exécution : `message` est truthy, donc le repli `?? 'Connexion impossible'` ne
s'active pas, et `message.toLowerCase()` — un tableau n'a pas cette méthode — lève une
exception. Elle survient **après** `this.busy.set(false)` (ligne 136) mais **avant**
`this.error.set(message)` (ligne 143), qui ne s'exécute donc jamais.

**Impact — scénario concret.** Un utilisateur retape son mot de passe après un copier-
coller partiel, ou une extension de gestionnaire de mots de passe soumet un champ
tronqué à 6 caractères. Le formulaire se débloque (le bouton redevient actif), mais
**aucun message d'erreur n'apparaît** — ni le message de validation rédigé par le
serveur (« Mot de passe de 8 caractères minimum »), ni le repli générique. L'écran
reste silencieusement dans un état incohérent : prêt à ressaisir, sans avoir dit
pourquoi la première tentative a échoué. Sur l'écran par lequel **tout** utilisateur
de la console commence sa session, c'est le point de contact avec la plus forte
probabilité d'occurrence de toute cette table.

**Correctif** — effort **S** : remplacer le type inline de `login.component.ts:135`
par `HttpFailure` et l'appel par `failureMessage(err)`, comme les huit écrans qui
utilisent déjà `ActionState`. Effort **S** additionnel, pour la dette plus large :
faire converger `firstMessage()` (`account.component.ts`) et la logique en ligne de
`deal-costing.component.ts` vers `failureMessage()` exporté — elles font la même
chose sous un nom différent, ce qui a permis à `login.component.ts` de rester
l'exception sans que rien ne le signale.

---

## 4. FORMATS

### [S4] Une fonction de mise en forme de date, écrite deux fois à l'identique — le socle console et le module terrain ne partagent pas leurs utilitaires

```
Propriété    : —
Axe          : Cohérence
Statut       : CONSTATÉ
```

**Localisation** — `apps/web/src/app/shared/format.ts:20-23` et
`apps/web/src/app/features/terrain/terrain-libelles.ts:68-71`.

**Extrait — les deux fonctions, côte à côte :**

```ts
// shared/format.ts:20-23
/** Rend la partie date d'un horodatage ISO, sans dépendre d'un pipe. */
export function dateOnly(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '-';
}
```

```ts
// terrain/terrain-libelles.ts:68-71
/** Partie date d'un horodatage ISO, sans dépendre d'un pipe. */
export function jour(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '-';
}
```

**Mécanisme.** Corps identique, signature identique, quasiment le même commentaire —
deux fonctions indépendantes pour le même besoin, l'une nommée en anglais dans le
tronc commun (`shared/`), l'autre en français dans le module terrain. Le fichier
`shared/format.ts` documente pourtant, pour son homologue `grouper()` (séparateur de
milliers), la leçon inverse : « Un écran l'avait déjà corrigé dans son coin. Le
corriger ici le corrige partout, et empêche les [...] mises en forme de rediverger
chacune de leur côté » (`format.ts:12-14`). La leçon retenue pour les montants ne
l'a pas été pour les dates : au moment d'écrire le module terrain, `jour()` a été
réécrite plutôt qu'importée depuis `shared/format.ts`.

Le même repli se retrouve sur la gestion d'erreurs (§ 3.1 : `failureMessage()`
réécrite en `firstMessage()`) — ce n'est pas un incident isolé, c'est une habitude du
dépôt : écrire un utilitaire partagé n'empêche pas d'en écrire un second équivalent
quand le contexte (ici, le module terrain, à l'arborescence et au vocabulaire
délibérément séparés — cf. `app.routes.ts:18-29`) donne une bonne raison de ne pas
importer depuis « l'autre arbre ».

**Nomenclature, plus largement.** Le clivage anglais/français suit la même ligne :
`DEAL_STATUS`, `INVOICE_STATUS`, `dateOnly`, `grouper` (console et socle partagé) contre
`MOTIF_PRESENCE`, `jour`, `jourHeure`, `formaterMontant`, `montantBrut`,
`decomposer` (terrain et directive de saisie). Les deux conventions sont chacune
internement cohérentes ; c'est leur coexistence, sans règle déclarée nulle part, qui
constitue l'hétérogénéité à cartographier ici plutôt qu'un défaut en soi.

**Impact.** Aucune divergence de comportement aujourd'hui — les deux fonctions
produisent le même résultat. Le risque est de maintenance pure : une correction
future du format d'affichage des dates (ex. gérer un horodatage non-ISO, ou une
préférence de fuseau) appliquée à `dateOnly()` ne se propagera pas à `jour()`, et
inversement, sans qu'aucun signal ne le révèle avant un écart visible à l'écran.

**Correctif** — effort **S** : faire de `terrain-libelles.ts` un ré-export de
`shared/format.ts` sous les noms français attendus par le module terrain
(`export { dateOnly as jour } from '../../shared/format'`), ce qui conserve le
vocabulaire du module sans dupliquer l'implémentation. Même traitement pour
`firstMessage()`.

---

### Le reste des formats : `RAS`, avec une trace de correction déjà faite

Les montants suivent une chaîne cohérente stockage → service → affichage :
`numeric(18,4)` en base, une seule fonction de regroupement par milliers
(`format.ts:16-18`, espace insécable documentée), une seule directive de saisie
(`montant.directive.ts`) qui documente elle-même une régression déjà corrigée (devise
codée en dur dans un écran — commentaires convergents à
`operation-actions.component.ts:594`, `supplier-invoices.component.ts:386` et
`invoice-actions.component.ts:186`, chacun désignant le même correctif passé). Aucune
occurrence de `FCFA` affichée à l'utilisateur — le code CIV `XOF` est utilisé de façon
homogène. La question de l'arithmétique flottante sous-jacente à ces montants relève
de l'axe A (A5) et a déjà été traitée dans `01_COUVERTURE_FONCTIONNELLE.md` § 7 — je ne
la rouvre pas ici, la question de **cohérence des formats d'affichage** entre couches
étant distincte de celle de **l'exactitude arithmétique**, et déjà favorable sur le
premier point.

---

## 5. MODÈLE DE DONNÉES

`RAS`, sous une réserve mineure. Le schéma compte trois modèles porteurs de pièces
jointes — `Document` (coffre GED, ligne 1924), `GeneratedDocument` (pièces scellées,
ligne 3759) et `OperationAttachment` (photos et pièces terrain, ligne 2986) — qui
redéclarent chacun indépendamment le même quadruplet `storageKey`/`mimeType`/
`sizeBytes`/`sha256`. Vérification faite : cette répétition ne produit **pas** de
divergence de comportement, parce qu'un service unique (`common/storage/storage.service.ts`,
cité en `05_ARCHITECTURE.md` § 5) porte effectivement l'écriture pour au moins deux des
trois modules — c'est une redondance de **déclaration de schéma**, pas une source de
vérité multiple au sens où l'entend le prompt. Je ne l'élève pas en constat noté :
Prisma ne propose pas de type embarqué réutilisable sur un fournisseur relationnel, et
la règle 6 du prompt (« pas de remplissage ») s'applique ici — la répétition est
contrainte par l'outil, pas un choix qui aurait pu être évité.

Aucune autre entité doublon ni source de vérité multiple identifiée sur le périmètre
examiné (`Deal`/`Contract` sont deux concepts distincts du référentiel, pas un
doublon ; `Invoice.number` face à `reference` sur les autres pièces porte un
commentaire de justification explicite — `schema.prisma:3409` : « Numérotation
légale : séquentielle, sans trou, chronologique » — distinction assumée entre une
numérotation fiscale contrainte et une référence interne, pas une incohérence).

---

## 6. SÉMANTIQUE

`RAS`, sous les réserves déjà posées ailleurs dans ce rapport. Le vocabulaire métier
recensé au fil des sections précédentes ne révèle qu'un seul chevauchement de terme :
`LOST` (§ 2.1), qui désigne une **opportunité CRM perdue** dans `crm.component.ts` et
apparaît à tort dans la table de statuts d'**affaire**. C'est le seul cas où un même
jeton porte potentiellement deux sens dans deux modules ; il est déjà traité comme
partie du constat § 2.1 plutôt que dupliqué ici.

---

## 7. CODE MORT ET TRAVAUX INACHEVÉS

### [S4] Le réalm portail expose désormais huit routes de données, sans qu'aucun client ne les appelle

```
Propriété    : —
Axe          : Cohérence
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/src/portal/portal.controller.ts:271,276,281,286,291,296,301,306`.

**Extrait — les routes déclarées :**

```ts
@Controller('api/portal')                    // 271
...
@Post('quotations')                          // 276
@Get('quotations')                           // 281
@Get('deals')                                // 286
@Get('deals/:id')                            // 291
@Patch('deals/:id/accept')                   // 296
@Get('operations')                           // 301
@Get('invoices')                             // 306
```

**Mécanisme.** `01_COUVERTURE_FONCTIONNELLE.md` § 5 constatait, à la date de sa
rédaction, que le réalm `api/portal/*` exposait l'authentification seule. Ce n'est
plus le cas : les huit routes ci-dessus portent une logique métier réelle (acceptation
de proforma, cf. § 2.1) et sont protégées par le garde de réalm portail. Recherche
exhaustive du terme `portal` dans `apps/web/src` (composants, services, routes) :
**aucune occurrence**. Aucun écran, aucun appel HTTP côté web ne consomme ces routes.

**Nuance.** Ce n'est pas nécessairement un défaut : le réalm portail est
vraisemblablement destiné à un client externe (site public, application tierce) plutôt
qu'à la console interne du dépôt, ce qui expliquerait l'absence de consommateur
**dans ce dépôt**. Le constat porte uniquement sur l'état du dépôt tel qu'il est : huit
points d'entrée non exercés par le code qui l'accompagne, donc non protégés par la
recette existante (`tests/recette/` — les suites appellent les réalms interne et
terrain, pas `api/portal/*`, d'après `01_COUVERTURE_FONCTIONNELLE.md` § 5) et non
vérifiables par la même discipline que le reste de l'API.

**Impact.** Maintenance : ces routes évolueront sans filet de recette avant qu'un
client réel ne les exerce. Aucun risque financier direct — elles ne sont, à ce jour,
atteignables que par appel HTTP direct.

**Correctif** — effort **M**, non urgent : soit rattacher ces routes à une recette
minimale (appels HTTP simulant un compte portail, sur le modèle des suites internes),
soit documenter explicitement dans `README.md` qu'elles attendent un client externe
non encore développé — la carte du dépôt (`05_ARCHITECTURE.md` § 9) a déjà signalé que
`README.md` retarde sur l'état réel du code, et cette absence de mention en est un
exemple de plus.

### Le reste : `RAS`

- **Aucun marqueur `TODO`/`FIXME`/`HACK`/`XXX`** trouvé dans `apps/api/src` ni
  `apps/web/src` (recherche exhaustive). Absence notable sur un dépôt de cette taille —
  soit la discipline d'écriture évite ce marquage, soit les points en suspens sont
  déclarés autrement (le § 9.3 de `01_COUVERTURE_FONCTIONNELLE.md` en dresse la liste
  sous une autre forme). Je le note sans trancher entre les deux explications.
- **Aucun écran non routé.** Les 33 composants de `apps/web/src/app/features/` sont
  tous atteints depuis `app.routes.ts`, directement ou par un composant qui l'est —
  vérifié par recherche croisée composant par composant.
- **Aucune divergence de code de retour HTTP** trouvée sur l'échantillon examiné : les
  106 occurrences relevées par recherche des exceptions NestJS les plus courantes
  (`BadRequestException`, `NotFoundException`, `ForbiddenException`,
  `UnauthorizedException`, plus une occurrence isolée de `ConflictException`) suivent
  un usage cohérent — `NotFoundException` pour une ressource absente,
  `BadRequestException` pour un refus métier ou de validation,
  `ForbiddenException`/`UnauthorizedException` réservées à l'authentification et
  l'autorisation. Le filtre `PrismaExceptionFilter`
  (`apps/api/src/common/filters/prisma-exception.filter.ts`) traduit systématiquement
  les refus portés par la base (`CHECK`, trigger, contrainte d'unicité) en réponses
  HTTP structurées (`statusCode`, `error`, `code`, `message`, `timestamp`), avec un code
  métier stable (`INVARIANT_VIOLATION`, `DUPLICATE`, `FOREIGN_KEY`, `APPEND_ONLY`,
  `NOT_FOUND`) que le client pourrait exploiter au-delà du seul message — mécanisme
  unique, pas d'improvisation par module sur ce point précis (à l'exception de § 3.1,
  qui porte sur la **consommation** côté client, non sur l'émission côté serveur).

---

## 8. RÉCAPITULATIF DES CONSTATS DE L'AXE

| # | Constat | Sévérité | Propriété | Statut |
|---|---|---|---|---|
| 1 | `DealStatus` : 9 valeurs sur 18 non câblées à l'écran, 1 entrée orpheline (`LOST`) | S2 | P5 | CONSTATÉ |
| 2 | Module documentaire sans contrat de type ; champ `invoice` orphelin ; colonne « rattachée à » vide pour proforma/facture/avoir | S3 | P5 | CONSTATÉ |
| 3 | Gestion d'erreur : mécanisme unique existant, réinventé 4 fois, dont une fois sans protection — plantage silencieux possible sur l'écran de connexion | S3 | P5 | CONSTATÉ |
| 4 | `dateOnly()`/`jour()` : même fonction écrite deux fois, symptomatique d'un clivage de nomenclature FR/EN non déclaré | S4 | — | CONSTATÉ |
| 5 | Réalm portail : 8 routes de données sans consommateur dans le dépôt, hors recette | S4 | — | CONSTATÉ |

Aucun **S1** sur cet axe. Le constat le plus élevé (§ 2.1, S2) touche la restitution de
l'état d'une affaire — propriété P5 — sur des statuts effectivement empruntés par le
cycle de vie réel, pas sur des valeurs théoriques.

---

## 9. CE QUE CET AXE N'A PAS COUVERT

- **Les 51 énumérations non examinées en détail** (L1) — le tri a porté sur celles qui
  pilotent des écrans de liste consultés en usage courant.
- **Le rendu réel dans un navigateur.** Le constat § 3.1 (plantage du composant de
  connexion) est établi par lecture de la chaîne de types et du comportement documenté
  de NestJS, pas par observation d'une exception effectivement levée dans une console
  navigateur — `INFÉRÉ` au sens strict pour la manifestation finale, `CONSTATÉ` pour
  chacun des maillons qui y mènent (absence de garde de type, comportement par défaut
  de `ValidationPipe`, contraintes actives de `LoginDto`).
- **La cohérence des 32 fichiers SQL de `prisma/sql/` entre eux** — déjà traitée sous
  l'angle transactionnel et de l'ordre d'injection en `05_ARCHITECTURE.md` § 3 ; je ne
  la rouvre pas sous l'angle de la cohérence de vocabulaire SQL (noms de vues, de
  fonctions) faute de temps disponible pour un examen à la même profondeur que le
  reste de cet axe.
- **Le contrat entre l'application terrain et son serveur** (`field-api.service.ts`,
  `field/*.controller.ts`) — effleuré au § 4 pour la nomenclature, non vérifié champ à
  champ comme § 2 l'a fait pour la console interne.

---

*Axe B clos. Aucune modification du code n'a été effectuée ; seule l'écriture de ce
fichier a eu lieu. Toutes les recherches ont été des lectures (`grep`, lecture de
fichier) ou des rapprochements schéma ↔ code ↔ écran ; aucune n'a modifié un état.*
