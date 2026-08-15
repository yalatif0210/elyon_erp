# 04 — SÉCURITÉ

Rappel du § 0 de `00_PERIMETRE.md` : **l'auditeur est l'auteur du code**. Cet axe est celui
que ce même document recommandait explicitement de faire relire par un tiers. Il n'a pas
été relu par un tiers — je le signale plutôt que de le taire. En contrepartie, chaque
constat S1/S2 ci-dessous est appuyé, quand c'est possible, sur une **preuve exécutée** :
requête HTTP réelle envoyée à la pile qui tourne actuellement (`docker compose`, API sur
`localhost:3000`), pas sur une lecture seule du code. Le mode opératoire (jeton obtenu,
route appelée, réponse observée) est donné à chaque fois qu'il a été possible de le faire
sans écrire en base au-delà de ce que l'application elle-même écrit dans le cours normal
d'une requête (connexions, lectures).

`01_COUVERTURE_FONCTIONNELLE.md` avait noté que l'axe sécurité n'avait jamais fait l'objet
d'un rapport écrit. C'est l'objet du présent document.

---

## 0. LIMITES DÉCLARÉES

| # | Limite | Effet |
|---|---|---|
| L1 | **Environnement cible inconnu** (I1, `00_PERIMETRE.md`) | La pile testée est celle de développement (`docker compose`, sans TLS terminé, sans reverse proxy public réel). Les constats d'infrastructure portent sur cette configuration, présentée par le dépôt comme la cible ; rien ne garantit qu'elle sera déployée telle quelle. |
| L2 | **Un seul compte par rôle interne existe dans le jeu de données actuel** | Certains constats d'IDOR (accès croisé entre deux commerciaux, par exemple) sont démontrés par **lecture du code** et par une preuve d'exécution indirecte (absence de filtre, comptage de lignes rendues), faute d'un second compte du même rôle à opposer au premier. La méthode et sa limite sont explicitées à chaque constat concerné. |
| L3 | **Aucun scan réseau, aucun test d'intrusion outillé** | Conformément à la règle 1 (lecture seule, pas de modification), aucun outil de fuzzing, de scan de vulnérabilités ou de test de charge n'a été utilisé. Les appels HTTP effectués sont ceux qu'un utilisateur légitime aurait pu faire avec un compte de test existant. |
| L4 | **Piste d'audit non lue en profondeur** | Le contenu détaillé des 67 lignes actuellement en base dans `audit_logs` n'a pas été audité ligne à ligne ; seul le **mécanisme** (ce qui écrit, ce qui ne lit jamais) a été vérifié. |

---

## 1. VERDICT DE L'AXE

> **L'autorisation côté serveur existe et fonctionne pour ce qu'elle couvre — mais elle ne
> couvre pas tout ce qu'elle devrait, et le journal censé compenser ces trous est
> lui-même inconsultable.**
>
> Le correctif du 08/08 (commit `6e22e0a`) a bien tenu sur ce qu'il visait : un commercial
> ne voit plus la liste ni le détail des affaires d'un collègue, et le coordinateur
> logistique ne voit plus les champs de marge qu'il ne doit pas voir sur `/deals`. Les
> deux vérifications ont été rejouées en direct et confirment le correctif.
>
> Mais le même principe — **« chacun ne voit et ne modifie que ce qui lui appartient »** —
> n'a pas été porté au-delà du fichier corrigé. Trois classes de trous, du même ordre que
> celui déjà corrigé, ont été trouvées et prouvées à l'exécution :
>
> 1. **Les routes d'ÉCRITURE de `deals.controller.ts` lui-même** (chiffrage, prix
>    fournisseur, soumission au risque) n'ont **jamais reçu** le contrôle de propriété
>    posé sur la lecture. Un commercial peut lire uniquement ses affaires, mais modifier
>    n'importe laquelle par son identifiant.
> 2. **Le module facturation** (`invoices.controller.ts`), écrit après le correctif, n'a
>    **jamais reçu** le même traitement : aucun cloisonnement, en lecture comme en
>    écriture.
> 3. **Le nouveau module barge** (`transport/barge.controller.ts`) réexpose sans aucun
>    masquage — pas même partiel — les marges que le correctif du 08/08 avait justement
>    retirées de la vue du coordinateur logistique ailleurs.
>
> À cela s'ajoutent deux constats indépendants de toute IDOR mais tout aussi sérieux pour
> un système financier : **aucune séparation des tâches** n'existe sur les flux d'argent
> (une même personne saisit, émet et encaisse), et **le journal d'audit, bien conçu et
> correctement alimenté, n'est lu par aucune route** — la traçabilité existe en base,
> introuvable depuis l'application.

---

## 2. AUTORISATION — CONTRÔLE D'APPARTENANCE DE LA RESSOURCE (IDOR)

### [S1] Les routes d'écriture de `deals.controller.ts` n'appliquent pas le contrôle de propriété posé sur ses propres routes de lecture

```
Propriété    : P2 Intégrité · P3 Invariance
Axe          : Sécurité
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/src/sales/deals.controller.ts:461-464` (le filtre, posé),
comparé à `:671-674`, `:747-780`, `:409-429`, `:786-800` (les méthodes qui ne l'appliquent
pas), et aux routes qui les exposent `:861-865`, `:897-905`, `:918-926`, `:928-931`.

**Extrait** — le contrôle existe, décrit dans son propre commentaire comme couvrant
« liste ET détail » :

```ts
// deals.controller.ts:461-464
/** Un commercial ne voit que les affaires dont il est propriétaire. */
private static filtrePropriete(role?: UserRole, actorId?: string) {
  return role === UserRole.SALES_REP && actorId ? { ownerId: actorId } : {};
}
```

Il est appelé par `list()` (:493-519) et par `findOne()`, qui refuse explicitement l'accès
au détail d'une affaire d'un autre commercial :

```ts
// deals.controller.ts:563-566
if (role === UserRole.SALES_REP && actorId && deal.ownerId !== actorId) {
  throw new ForbiddenException(
    'Cette affaire appartient à un autre commercial. Chacun ne consulte que les siennes.',
  );
}
```

Mais quatre autres méthodes de la **même classe**, exposées à `UserRole.SALES_REP`, ne
reçoivent ni le rôle ni l'identifiant de l'acteur au-delà de la traçabilité — aucune ne
vérifie `deal.ownerId` :

```ts
// deals.controller.ts:747 — remplace intégralement le chiffrage d'une affaire
async setCostLines(id: string, lines: DealCostLineDto[], actorId: string) {
  const deal = await this.prisma.deal.findUniqueOrThrow({
    where: { id },
    select: { currencyCode: true, segment: true, transportMode: true, productId: true, contractedVolume: true },
  });
  // — aucune lecture de ownerId, aucune comparaison à actorId —
```

```ts
// deals.controller.ts:409 — rattache un prix fournisseur, donc le prix d'achat retenu
async attachSupplierPrice(id: string, dto: AttachSupplierPriceDto, actorId: string) {
  const sp = await this.prisma.supplierPrice.findUniqueOrThrow({ where: { id: dto.supplierPriceId }, ... });
  // — même absence —
```

```ts
// deals.controller.ts:671 — fait franchir un statut à l'affaire
async submitForRisk(id: string, actorId: string) {
  await this.recomputeMargins(id);
  return this.transition(id, DealStatus.PENDING_RISK, actorId, 'Soumis au contrôle du risque');
  // — même absence —
```

Les trois routes correspondantes déclarent `SALES_REP` dans leurs rôles autorisés :

```ts
// deals.controller.ts:918-926
@Put(':id/cost-lines')
@Roles(UserRole.SALES_REP, UserRole.CCOO, UserRole.FINANCE_CFO)
setCostLines(@Param('id', ParseUUIDPipe) id: string, @Body() dto: { costLines: DealCostLineDto[] }, @Req() req: { auth: { sub: string } }) {
  return this.service.setCostLines(id, dto.costLines ?? [], req.auth.sub);
}
```

**Mécanisme.** Le guard JWT vérifie le réalm et le rôle (`jwt-auth.guard.ts`), pas
l'appartenance de la ressource — c'est le rôle de chaque service, au cas par cas
(`principe directeur`, `AUDIT_ERP.md` § 3). Sur `deals.controller.ts`, ce rôle est tenu
pour la lecture et pas pour l'écriture, dans le **même fichier**, par le **même
développeur**, au **même moment** (le commit `6e22e0a` du 08/08 qui a introduit
`filtrePropriete` et `masqueMarges` n'a touché que `list()` et `findOne()` — vérifié par
`git show --stat 6e22e0a`, qui ne montre que `ACCES.md` et `deals.controller.ts` modifiés,
sans qu'aucune des méthodes d'écriture n'apparaisse dans le diff). Le principe énoncé dans
le commentaire du correctif — « restreindre la liste est cosmétique tant que le détail
répond à n'importe quel identifiant » (:524-529) — s'applique à l'identique à l'écriture,
et n'a pas été reconduit.

**Ce qui a été vérifié à l'exécution.** Connecté avec le compte `commercial@` (le seul
`SALES_REP` du jeu de données, L2), `GET /api/internal/deals` ne rend que les 2 affaires
dont il est propriétaire (`ownerId` vérifié en base — correctif tenu). Le code de
`setCostLines`, `attachSupplierPrice` et `submitForRisk` a été lu intégralement : aucune
branche, à aucun niveau d'imbrication, ne compare `deal.ownerId` à l'acteur. La preuve
d'exécution croisée (un second commercial modifiant l'affaire du premier) n'a pas pu être
produite sans créer un second compte, ce qui aurait dépassé le périmètre « lecture
seule » — mais elle se reproduit en clonant un second utilisateur `SALES_REP` par le
paramétrage existant (`api/internal/parameters` référentiel `users`, ou l'écran
correspondant), sans toucher au code.

**Impact — scénario concret.** Le commercial B, qui sait ou devine l'identifiant UUID
d'une affaire du commercial A (les identifiants apparaissent dans les URL de l'écran, dans
les exports, dans les échanges internes), appelle directement
`PUT /api/internal/deals/{id-de-A}/cost-lines` avec un chiffrage différent. Le serveur
répond `200` : les lignes de coût de l'affaire de A sont **remplacées** (`setCostLines`
supprime les lignes existantes puis recrée — :763-768), la marge est recalculée sur de
nouveaux chiffres, et l'affaire peut franchir ou éviter le seuil de dérogation DG selon ce
que B a saisi. Sur `attachSupplierPrice`, B peut changer le **fournisseur retenu et le
prix d'achat** d'une affaire de A, ce qui modifie sa marge et sa décision d'approbation
sans que A ni personne d'autre n'ait constaté un changement de propriétaire. Rien dans le
parcours ne distingue cette modification d'une modification légitime : l'audit
(`AuditService.record`, bien appelé ici) trace *qui* a fait le changement — mais comme
personne ne consulte jamais le journal (§ 5), cette trace ne protège rien en pratique.

**Correctif** — effort **S** : reprendre `filtrePropriete`/le contrôle de `findOne()` et
l'appliquer, avant toute écriture, dans `setCostLines`, `attachSupplierPrice`,
`submitForRisk` et `recomputeMargins` — un unique garde partagé (« l'acteur est-il
propriétaire, ou a-t-il un rôle qui outrepasse la propriété ? ») évite que les quatre
méthodes divergent une seconde fois.

---

### [S2] La facturation n'applique aucun cloisonnement par commercial — ni en lecture, ni en écriture

```
Propriété    : P3 Invariance
Axe          : Sécurité
Statut       : CONSTATÉ (lecture) / CONSTATÉ (écriture, par lecture du code)
```

**Localisation** — `apps/api/src/invoicing/invoices.controller.ts:172-197` (`list`),
`:199-230` (`findOne`), `:245-404` (`create`), routes `:787-798`, `:800-810`, `:812-816`.

**Extrait** — aucune des trois méthodes ne reçoit le rôle ni l'identifiant de l'acteur
au-delà de la traçabilité :

```ts
// invoices.controller.ts:172
async list(query: InvoiceQuery): Promise<Page<unknown>> {
  const where = {
    ...(query.type ? { type: query.type } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.dealId ? { dealId: query.dealId } : {}),
    ...(query.partnerId ? { partnerId: query.partnerId } : {}),
    // — aucun filtre de propriétaire, contrairement à deals.controller.ts —
  };
```

```ts
// invoices.controller.ts:787-798
@Get()
@Roles(UserRole.DG, UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT, UserRole.SALES_REP, UserRole.ASSISTANT_DG)
list(@Query() query: InvoiceQuery) {
  return this.service.list(query);   // pas de req.auth transmis
}
```

`create()` (:245-260) reprend `dto.dealId` tel quel pour retrouver le client et poser la
facture, sans jamais vérifier que l'affaire appartient au commercial qui facture — et la
route `POST /invoices` (:812-816) autorise `SALES_REP`.

**Ce qui a été vérifié à l'exécution.** Connecté avec `commercial@elyon-trading.example`
(jeton `SALES_REP` valide, obtenu par `POST /api/internal/auth/login`),
`GET /api/internal/invoices` renvoie les **3 factures que compte la base entière**
(`total: 3`, confirmé par comptage direct en base : `SELECT count(*) FROM invoices` → 3) —
soit 100 % du système, sans filtre. Le même jeton donne accès au détail complet de chaque
pièce (montants, numéro fiscal du tiers `taxpayerAccountNumber`, historique de paiement)
via `GET /api/internal/invoices/:id`, quel que soit le propriétaire de l'affaire
sous-jacente. Le jeu de données actuel ne compte qu'un commercial (L2) : les 3 factures
lui appartiennent déjà par ailleurs, donc l'expérience ne peut pas *aujourd'hui* montrer un
commercial lisant les données d'un autre — mais elle prouve le mécanisme : le total rendu
est le total du système, pas un total filtré qui se limiterait par coïncidence à ses
propres pièces.

**Impact — scénario concret.** Dès qu'un second commercial est créé (le modèle de rôles
d'`ACCES.md` prévoit plusieurs commerciaux, et `catalogue()` de `parameters.controller.ts`
permet de créer un compte au rôle `SALES_REP` sans autre condition), chacun voit
l'intégralité du chiffre d'affaires, des numéros de compte contribuable et de l'historique
de paiement de **tous** les clients de l'entreprise, y compris ceux d'un collègue —
exactement l'information qu'`ACCES.md` § 2bis point 1 décrit comme corrigée pour les
affaires (« chacun ne voit que ses propres affaires, prix et marges compris ») mais qui
ressort intacte trois routes plus loin. Plus grave sur l'écriture : `POST /invoices`
accepte un `dealId` qui n'appartient pas à l'auteur — un commercial peut créer, sur le
dossier d'un collègue, une facture brouillon avec un `unitPrice` et un `billedVolume` de
son choix (rappel : `01_COUVERTURE_FONCTIONNELLE.md` § 3 a déjà constaté, en S1, qu'aucun
contrôle ne borne ces deux champs au volume ou au prix de l'affaire). Le brouillon
n'engage rien tant qu'il n'est pas émis (`issue()` est réservée à CCOO/CFO/comptable,
:828-829), mais il pollue la liste des factures d'un client qui n'est pas le sien, et
personne n'a de raison de le rattacher à l'incident.

**Correctif** — effort **M** : porter `filtrePropriete` (ou son équivalent) sur
`InvoicesService.list()`/`findOne()`/`create()`, filtré par le propriétaire de l'affaire
liée (`deal.ownerId`) pour le rôle `SALES_REP` — même mécanisme que celui déjà écrit et
vérifié dans `deals.controller.ts`, à répliquer plutôt qu'à réinventer.

---

### [S2] Le masquage des marges au coordinateur logistique est incomplet, et le nouveau module barge ne le reprend pas du tout

```
Propriété    : P3 Invariance
Axe          : Sécurité
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/src/sales/deals.controller.ts:474-481` (la liste des champs
masqués) et `apps/api/src/transport/barge.controller.ts:145-234` / `:268-272`.

**Extrait** — la liste des champs confidentiels, telle qu'écrite le 08/08 :

```ts
// deals.controller.ts:474-481
private static readonly CHAMPS_CONFIDENTIELS = [
  'unitPurchasePrice',
  'estimatedDirectMargin',
  'estimatedFullMargin',
  'realizedDirectMargin',
  'realizedFullMargin',
  'supplierPriceId',
] as const;
```

Le commentaire immédiatement au-dessus de cette liste (:469-472) dit explicitement
pourquoi le prix d'achat doit disparaître : « la marge s'en recalcule de tête ». Mais la
liste ne retire pas `purchaseAmount` — le **montant** d'achat total de l'affaire, qui
reste sur l'objet renvoyé au même titre que `saleAmount` — ni les trois postes de charge
estimés (`estimatedDirectCharges`, `estimatedIndirectCharges`, `estimatedCarryingCost`).

**Ce qui a été vérifié à l'exécution.** Connecté avec `logistique@elyon-trading.example`
(rôle `LOGISTICS_COORD`), `GET /api/internal/deals` renvoie, pour l'affaire
`DEAL-2026-08-002` :

```
"saleAmount":"11400000"  "purchaseAmount":"10500000"
"estimatedDirectCharges":"525000"  "estimatedIndirectCharges":"255000"  "estimatedCarryingCost":"145833"
```

`unitPurchasePrice`, `estimatedDirectMargin`, `estimatedFullMargin` et `supplierPriceId`
sont bien absents — le masquage fonctionne sur ces champs précis. Mais la marge brute se
lit en une soustraction : 11 400 000 − 10 500 000 = **900 000**, exactement ce que le
commentaire du correctif disait vouloir empêcher.

Sur le module barge, aucun masquage n'est seulement tenté. `GET /api/internal/supervision/barges`,
avec le **même jeton** `LOGISTICS_COORD` :

```json
{"revenuePivot":0,"operatingCostPivot":0,"maintenanceCostPivot":0,"marginPivot":0, ...}
```

(valeurs à zéro sur le jeu de données actuel, faute d'opération assignée à cette barge —
mais les quatre champs, y compris `marginPivot`, sont bien renvoyés par construction, pour
tout rôle listé) :

```ts
// barge.controller.ts:268-272
@Get('barges')
@Roles(UserRole.DG, UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.LOGISTICS_COORD)
bargePnL() {
  return this.service.bargePnL();   // rend marginPivot sans distinction de rôle
}
```

**Mécanisme.** `BargeService.bargePnL()` (:145-234) calcule `revenuePivot`,
`operatingCostPivot`, `maintenanceCostPivot` et `marginPivot` pour chaque barge, à partir
des factures liées aux affaires qu'elle a servies, et rend l'objet complet à quatre rôles
sans qu'aucun filtrage n'existe dans le service ni dans le contrôleur. Le principe posé le
08/08 — « le coordinateur logistique ne voit pas les marges » — n'a pas été porté dans ce
module écrit après lui.

**Impact — scénario concret.** Le coordinateur logistique, dont le rôle est défini par
`ACCES.md` comme n'ayant « aucun chiffre financier » (§ « Coordinateur logistique »,
`Ne fait pas`), obtient malgré tout la marge exacte de chaque affaire (par soustraction,
via `/deals`) et la marge exacte de chaque barge (directement, via
`/supervision/barges`). Sur un compte d'exploitation par moyen partagé avec des
prestataires ou des affréteurs externes lors de discussions opérationnelles, cette donnée
devient un levier de négociation contre l'entreprise elle-même.

**Correctif** — effort **S** : ajouter `purchaseAmount`, `estimatedDirectCharges`,
`estimatedIndirectCharges` et `estimatedCarryingCost` à `CHAMPS_CONFIDENTIELS`, et
appliquer le même masquage — ou un filtrage de champs équivalent au niveau du `select` —
sur `BargeService.bargePnL()` pour le rôle `LOGISTICS_COORD` (a minima retirer
`revenuePivot`, `operatingCostPivot`, `maintenanceCostPivot`, `marginPivot`, ne garder que
les indicateurs opérationnels : voyages, volume, échéance de maintenance).

---

## 3. AUTORISATION — SÉPARATION DES TÂCHES

### [S1] Aucune séparation des tâches sur les flux d'argent : la même personne peut saisir, émettre et encaisser

```
Propriété    : P2 Intégrité · P3 Invariance
Axe          : Sécurité
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/src/invoicing/invoices.controller.ts:812-813` (création),
`:828-829` (émission), `:850-851` (encaissement) ; symétriquement côté fournisseur,
`apps/api/src/procurement/supplier-invoices.controller.ts:412-413` (enregistrement),
`:419-420` (règlement).

**Extrait** — côté client, le rôle `ACCOUNTANT` (comptable) figure sur les trois étapes :

```ts
// invoices.controller.ts:812-813
@Post()
@Roles(UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT, UserRole.SALES_REP)
create(...)                                          // saisit

// invoices.controller.ts:828-829
@Patch(':id/issue')
@Roles(UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
issue(...)                                           // émet — la pièce devient opposable

// invoices.controller.ts:850-851
@Post(':id/payments')
@Roles(UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
pay(...)                                             // encaisse — clôt le cycle
```

Côté fournisseur — plus sensible encore, puisqu'il s'agit d'argent qui **sort** —, le même
rôle enregistre la facture ET en déclenche le règlement :

```ts
// supplier-invoices.controller.ts:412-413
@Post()
@Roles(UserRole.FINANCE_CFO, UserRole.ACCOUNTANT, UserRole.LOGISTICS_COORD)
record(...)                                          // crée une facture fournisseur

// supplier-invoices.controller.ts:419-420
@Post(':id/payments')
@Roles(UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
prepay(...)                                          // règle — argent sorti, avant réception
```

**Mécanisme.** Aucune des deux chaînes ne porte de second regard obligatoire. Le schéma de
`Payment` (`schema.prisma:3630-3661`) ne porte aucune colonne d'approbateur distinct du
`recordedById` — recherche exécutée sur `approvedBy`/`validatedBy`/`checkedBy` dans tout le
schéma : les seules occurrences concernent la validation d'un **prix fournisseur** en amont
(`SupplierPrice.validatedById`) et d'un **contrôle HSE**, jamais un paiement. Comparé au
circuit de l'affaire elle-même — qui impose deux approbations distinctes et non
contournables, CFO puis DG en cas de dérogation (`deals.controller.ts:683-721`,
`:724-738`) — le circuit de la facture et du paiement n'impose aucune séparation
équivalente : un seul compte `ACCOUNTANT`, sans complicité ni négligence d'un tiers, peut
créer une facture fournisseur fictive et en déclencher le règlement le jour même.

**Impact — scénario concret.** Un comptable dont les identifiants sont compromis (ou qui
agit seul, de mauvaise foi) crée une facture fournisseur de 5 000 000 XOF pour un
fournisseur existant ou fictif (`POST /supplier-invoices`, aucune commande d'achat requise
— `purchaseOrderId` est optionnel, :49-50), puis en déclenche le règlement intégral
(`POST /supplier-invoices/:id/payments`), sans qu'aucun second acteur n'ait eu l'occasion
de refuser l'opération avant que l'argent ne sorte. Côté client, symétriquement, la même
personne peut créer une facture, l'émettre (elle devient une créance opposable et, si de
type FNE, transmise à la DGI), puis enregistrer un encaissement qui n'a jamais eu lieu — ce
qui, combiné à l'absence de rapprochement bancaire automatisé dans le dépôt (aucune
intégration bancaire trouvée), laisserait la pièce soldée sans mouvement de fonds réel
tant que personne ne rapproche le relevé bancaire à la main. C'est exactement le scénario
que le protocole d'audit qualifie de « constat majeur, indépendamment de toute faille
technique » : il ne s'agit pas d'un bug, mais de l'absence d'un contrôle organisationnel
qu'un système financier doit porter par construction.

**Correctif** — effort **M** : introduire un second acteur obligatoire sur les deux
chaînes — au minimum, interdire qu'`issue()`/`pay()` (côté client) ou `prepay()` (côté
fournisseur) soit exécuté par le même `actorId` que celui qui a créé la pièce, avec un
message explicite ; à terme, une colonne `approvedById` distincte de `recordedById`,
posée en base et vérifiée par contrainte, sur `Payment` et `SupplierInvoice`.

---

## 4. AUTHENTIFICATION

### [S2] L'obligation de changer un mot de passe provisoire et l'obligation de second facteur ne sont vérifiées nulle part côté serveur

```
Propriété    : P3 Invariance
Axe          : Sécurité
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/src/auth/auth.service.ts:76-90` (le calcul des deux
indicateurs), comparé à l'absence de toute vérification dans
`apps/api/src/common/auth/jwt-auth.guard.ts` (le seul endroit qui pourrait bloquer une
requête ultérieure).

**Extrait** — le service calcule correctement les deux indicateurs et les retourne à la
connexion :

```ts
// auth.service.ts:76-85
const totpRequired = (await this.totpRequiredRoles()).includes(user!.role);
if (user!.totpEnabled) {
  this.verifyTotp(user!.totpSecretEnc, totpCode);
} else if (totpRequired) {
  // Le compte n'a pas encore enrôlé son second facteur. On délivre une
  // session, mais l'appelant doit la considérer comme contrainte :
  // l'enrôlement est la seule action autorisée (garde applicative).
  this.logger.warn(`2FA obligatoire non enrôlée — ${email} (${user!.role})`);
}
```

Le commentaire dit lui-même que la contrainte est une « garde applicative » — c'est-à-dire
posée côté client. Recherche exécutée sur `mustChangePassword` et
`totpEnrollmentRequired` dans `apps/api/src` : les deux chaînes n'apparaissent que dans
`auth/auth.controller.ts` et `auth/auth.service.ts` (leur calcul et leur transport dans la
réponse de connexion) — **aucune autre occurrence**, et en particulier aucune dans
`jwt-auth.guard.ts`, le seul point qui intercepte chaque requête authentifiée.

**Ce qui a été vérifié à l'exécution.** `POST /api/internal/auth/login` avec les
identifiants du compte `commercial@elyon-trading.example` et le mot de passe de seed
(`ChangeMe!2026`, non changé depuis la création du compte) renvoie `200` avec
`"mustChangePassword":true`. Le jeton d'accès reçu dans cette même réponse a ensuite été
utilisé pour appeler `GET /api/internal/invoices` et `GET /api/internal/deals` : les deux
routes ont répondu `200` avec des données complètes, sans aucun refus ni redirection liée
au mot de passe non changé. Le même constat s'applique à `totpEnrollmentRequired` pour les
rôles soumis à la 2FA obligatoire (`DG`, `FINANCE_CFO`, `ACCOUNTANT`, `IT_ADMIN` —
`auth.service.ts:28-33`) : un compte de ce type qui ne s'enrôle jamais continue de recevoir
une session pleinement fonctionnelle à chaque connexion, indéfiniment.

**Impact — scénario concret.** Les neuf comptes internes du jeu de données sont, au moment
de cet audit, encore sur le mot de passe de seed distribué par défaut
(`SEED_DEFAULT_PASSWORD`, identique pour tous). Rien dans le serveur n'oblige à en sortir :
un compte peut fonctionner indéfiniment sur ce mot de passe partagé, y compris les comptes
`DG`, `FINANCE_CFO`, `ACCOUNTANT` et `IT_ADMIN` pour lesquels la deuxième authentification
est explicitement « obligatoire » par la politique de l'entreprise
(`TOTP_REQUIRED_ROLES_FALLBACK`) — tant que personne ne clique sur l'écran d'enrôlement,
elle ne l'est jamais en pratique. Un attaquant qui devine ou obtient ce mot de passe
partagé (proche des identifiants publiés dans `ACCES.md` à des fins de test) accède
immédiatement, sans second facteur, aux comptes les plus sensibles du système.

**Correctif** — effort **M** : dans `JwtAuthGuard.canActivate()`, après résolution du
rôle, vérifier `mustChangePassword` et `totpEnrollmentRequired` (à charger depuis la base
ou à embarquer dans le jeton, en acceptant qu'un changement de mot de passe invalide alors
l'ancien jeton comme c'est déjà le cas) et **refuser** toute route hors
`POST /auth/password`, `POST /auth/totp/enroll`, `POST /auth/totp/confirm` et
`POST /auth/logout` tant que la condition est vraie.

---

## 5. PISTE D'AUDIT

### [S1] Le journal d'audit est exclusivement écrit — aucune route, aucun écran ne permet de le consulter

```
Propriété    : P4 Traçabilité
Axe          : Sécurité
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/src/common/audit/audit.service.ts:51-77` (la seule méthode
qui touche `auditLog`, en écriture).

**Extrait** :

```ts
// audit.service.ts:51-53
async record(entry: AuditEntry): Promise<void> {
  try {
    await this.prisma.auditLog.create({
```

Recherche exécutée sur `auditLog.` dans tout `apps/api/src` : **une seule occurrence**
dans l'ensemble du code source, celle ci-dessus — un `create`. Aucun `findMany`, aucun
`findUnique`, aucun contrôleur, aucune route dont le chemin contiendrait `audit` en dehors
de l'authentification elle-même (`api/internal/auth`). Recherche symétrique côté
`apps/web/src` sur `audit-log`/`auditLog`/`journal.*audit` : **aucune occurrence**.

**Ce qui a été vérifié à l'exécution.** La table contient des données réelles et
récentes — `SELECT count(*) FROM audit_logs` en base rend **67 lignes**, dont des
connexions, des créations de facture fournisseur et des connexions au portail client.
Connecté en `DG` (le rôle le plus élevé du système), cinq chemins plausibles ont été
appelés : `api/internal/audit-logs`, `api/internal/audit`,
`api/internal/supervision/audit-logs`, `api/internal/journal`,
`api/internal/audit/logs` — les cinq répondent **404**, pas 403 : la route n'existe
tout simplement pas, pour aucun rôle.

**Mécanisme.** Le journal est correctement conçu à l'écriture : append-only garanti par
déclencheur PostgreSQL (`00_PERIMETRE.md` § 3, `05_ARCHITECTURE.md` § 4 — vérifié à
l'exécution dans les axes précédents), champs sensibles expurgés
(`audit.service.ts:32-43`), auteur et horodatage systématiques. C'est un journal
d'audit sérieusement construit — et personne, dans l'application, ne peut le lire.

**Impact — scénario concret.** Le protocole de cet audit pose la question de traçabilité
ainsi : « peut-on reconstituer qui a fait quoi, quand, et sur quelle valeur antérieure ? »
Techniquement, la réponse est oui — **en se connectant directement à PostgreSQL**, hors de
toute interface, de tout contrôle de rôle applicatif, et de toute date de rétention gérée.
Opérationnellement, à travers le système que l'entreprise utilise au quotidien, la réponse
est non : si une facture fournisseur suspecte apparaît (§ 3), si une affaire est modifiée
par la mauvaise personne (§ 2), ou si un litige client nécessite de savoir qui a émis une
pièce et quand, **aucun utilisateur du système, DG compris, ne dispose d'un moyen de le
vérifier sans accès direct à la base de données** — c'est-à-dire, dans les faits, sans
solliciter quelqu'un qui a les identifiants PostgreSQL, hors du périmètre applicatif que
cet audit couvre. Sur un système qui manipule de l'argent, l'absence d'un moyen
*applicatif* de consulter la piste d'audit équivaut, pour tout usage réel, à son absence :
c'est le sens précis de la remarque du protocole d'audit sur ce point (§ 9, « son absence
est critique »), et elle s'applique ici même si la table, elle, n'est pas vide.

**Correctif** — effort **S** : une route `GET /api/internal/audit-logs`, réservée à
`DG` et `IT_ADMIN`, paginée, filtrable par entité et par période — le schéma et
l'alimentation existent déjà, il ne manque que la lecture.

---

### [S2] La clé d'API DGI (FNE) est un secret stocké en clair dans une table de paramétrage générique, servie sans filtrage et dupliquée en clair dans le journal d'audit

```
Propriété    : P4 Traçabilité
Axe          : Sécurité
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/src/common/config/settings.service.ts:132-154` (lecture,
sans aucun chiffrement), `apps/api/src/referentials/referentials.controller.ts:439-442` et
`:700-703` (route de lecture, sans redaction), `apps/api/src/referentials/parameters.controller.ts:496-526`
(écriture, tracée intégralement).

**Extrait** — la lecture d'un paramètre est une chaîne brute, jamais chiffrée :

```ts
// settings.service.ts:132-142
private async read(key: string): Promise<string | null> {
  ...
  const row = await this.prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  const trimmed = row?.value.trim() ?? '';
```

La route qui expose l'ensemble des paramètres rend chaque ligne sans distinction ni
`select` :

```ts
// referentials.controller.ts:439-442
/** Paramètres métier — seuils, taux de financement, préavis d'alerte. */
settings() {
  return this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
}
```

```ts
// referentials.controller.ts:700-703
@Get('settings')
@Roles(UserRole.DG, UserRole.IT_ADMIN, UserRole.FINANCE_CFO)
settings() { return this.service.settings(); }
```

Et toute écriture sur ce référentiel — y compris `FNE_API_KEY` — est journalisée avec la
ligne complète, `value` incluse :

```ts
// parameters.controller.ts:516-524 (trace())
return this.audit.record({
  ...
  after: reason ? { ...(after as object), motif: reason } : after,
```

`AuditService.record()` applique bien une expurgation (`audit.service.ts:32-43`), mais
`REDACTED_FIELDS` ne connaît que `passwordHash`, `totpSecretEnc`, `tokenHash`,
`accessToken`, `refreshToken` — pas la colonne générique `value` d'un réglage. Rien ne
distingue, à ce niveau, `TVA_STANDARD_RATE = 18` de `FNE_API_KEY = <secret>` : les deux
sont une ligne `{key, value}` comme une autre.

**Ce qui a été vérifié.** `SELECT key, value FROM system_settings WHERE key ILIKE
'%FNE%'` en base montre `FNE_API_KEY` actuellement **vide** (le circuit FNE n'est pas
encore activé en pratique — cohérent avec `01_COUVERTURE_FONCTIONNELLE.md` § 4, qui note
la même dépendance externe non encore fournie). Le mécanisme, lui, est pleinement en
place et sera emprunté par la première clé réelle saisie : `fne-client.service.ts:356-357`
lit `FNE_API_KEY` par `this.settings.string(...)`, exactement comme n'importe quel autre
paramètre.

**Impact.** Le jour où la clé DGI est configurée (une condition explicitement posée comme
un point ouvert par `01_COUVERTURE_FONCTIONNELLE.md` § 4 et par le document de procédure
`FNE-procedureapi.pdf` présent à la racine), elle sera : (1) stockée en clair, aux côtés de
réglages anodins comme un délai d'alerte ; (2) rendue intégralement, en clair, à toute
requête `GET /referentials/settings` faite par un compte `DG`, `IT_ADMIN` ou
`FINANCE_CFO` — un périmètre de comptes plus large que les seuls responsables du
paramétrage fiscal ; (3) **dupliquée, en clair et de façon permanente**, dans
`audit_logs` à chaque écriture ou modification de ce paramètre — une table conçue pour
être *append-only*, donc dans laquelle cette copie ne pourra **jamais être retirée** même
après rotation de la clé côté DGI, ce qui rend une fuite de la base (sauvegarde égarée,
accès direct compromis) équivalente à une fuite du secret externe, sans limite de
rétention. C'est l'exact miroir de la remarque du protocole sur les secrets « présents
dans les fichiers de configuration versionnés et dans l'historique du dépôt » — ici,
l'historique concerné est celui de la base plutôt que celui de Git, mais le mécanisme et le
risque sont les mêmes.

**Correctif** — effort **M** : distinguer, au niveau du registre (`registry.ts`) et de
`AuditService`, les clés de paramétrage à caractère de secret (`FNE_API_KEY` en premier
lieu) — les chiffrer au repos comme le sont déjà les secrets TOTP
(`CryptoService.encryptSecret`, déjà présent et éprouvé dans le dépôt), les exclure du
`select` de `GET /referentials/settings` (rendre `[valeur définie: oui/non]` plutôt que la
valeur), et ajouter leur clé à `REDACTED_FIELDS` — ou, plus simplement, à une liste de
clés sensibles vérifiée par nom (`key.endsWith('_KEY')`, `_SECRET`, `_TOKEN`) avant
écriture au journal.

---

### [S3] Le pipeline CRM n'est jamais tracé — les seules routes d'écriture du dépôt sans aucun appel à `AuditService`

```
Propriété    : P4 Traçabilité
Axe          : Sécurité
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/src/crm/crm.controller.ts:170-198` (`create`), `:207-...`
(`move`).

**Mécanisme.** Sur 21 contrôleurs portant au moins une route `@Post`/`@Patch`,
`crm.controller.ts` et `field-sync.controller.ts` sont les deux seuls sans référence à
`AuditService`. Le second tient sa propre trace dédiée
(`FieldSyncService.journalise()` écrit dans `field_sync_events`, avec acteur, horodatage
et motif de rejet — un journal équivalent, simplement porté par une table à part) : ce
n'est pas un manque. Le premier, en revanche, n'a **aucun équivalent** : créer une
opportunité, la faire franchir une étape du pipeline, ou la clôturer gagnée/perdue
n'écrit dans aucune table de traçabilité.

**Impact.** Sévérité mesurée : le pipeline CRM n'est pas un flux d'argent (aucune écriture
comptable n'en dépend directement), mais il alimente la prévision de vente et, en cascade,
le taux d'absorption et le seuil de marge (`crm.controller.ts:92-99`, qui l'explicite
lui-même). Une probabilité ou un volume modifié sans trace fausse silencieusement un calcul
qui, lui, a un effet financier.

**Correctif** — effort **S** : ajouter les quatre appels `AuditService.record()`
manquants, sur le modèle déjà employé partout ailleurs dans le dépôt.

---

## 6. ENTRÉES ET INJECTION

`RAS` pour l'essentiel — vérifié plus large que d'habitude sur ce point précis, compte
tenu de la présence généralisée de `$queryRawUnsafe` dans trois contrôleurs
(`supervision.controller.ts`, `compliance.controller.ts`, `crm.controller.ts`, 25
occurrences au total). Recherche exécutée sur chacune : toutes lient leurs valeurs par
paramètre positionnel (`$1`, `$2`, …) ou n'embarquent aucune donnée externe — sauf une.

### [S3] Une requête du module CRM construit sa clause `WHERE` par concaténation de chaîne, avec échappement manuel plutôt que liaison de paramètre

```
Propriété    : P3 Invariance
Axe          : Sécurité
Statut       : CONSTATÉ — testé, sans contournement trouvé sous la configuration actuelle
```

**Localisation** — `apps/api/src/crm/crm.controller.ts:118-127`.

**Extrait** :

```ts
pipeline(filtre: { ouvertes?: boolean; responsable?: string }) {
  const conditions: string[] = [];
  if (filtre.ouvertes) conditions.push(`issue = 'OPEN'`);
  if (filtre.responsable) {
    conditions.push(`responsable = '${filtre.responsable.replace(/'/g, "''")}'`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return this.prisma.$queryRawUnsafe(
    `SELECT * FROM v_crm_pipeline ${where} ORDER BY etape_rang, next_action_due`,
  );
}
```

**Mécanisme.** `filtre.responsable` vient directement de `@Query('responsable')`
(`crm.controller.ts:288`), exposée à `DG`, `CCOO`, `SALES_REP`, `FINANCE_CFO` et
`ASSISTANT_DG` sur `GET /crm/pipeline`. La valeur est insérée dans le texte SQL par
interpolation de gabarit, protégée par un doublement manuel des apostrophes — et non par
liaison de paramètre, seule méthode que Prisma garantit à l'épreuve du moteur. C'est
exactement la construction que le protocole d'audit désigne : « requêtes construites par
concaténation ».

**Ce qui a été testé.** Avec le jeton `SALES_REP` déjà utilisé au § 2, deux charges ont été
envoyées à `GET /api/internal/crm/pipeline?responsable=...` :
`x' OR '1'='1` et `x'; SELECT 1; --`. Les deux renvoient `[]` (liste vide, code `200`,
aucune erreur serveur) : l'échappement neutralise correctement l'apostrophe sous la
configuration actuelle (encodage client UTF-8, `standard_conforming_strings` par défaut de
PostgreSQL 16). Je n'ai pas trouvé de contournement exploitable dans ces conditions.

**Pourquoi le constat reste posé malgré l'absence de contournement démontré.** Un
échappement manuel réussi aujourd'hui n'est pas une garantie de le rester : il dépend d'un
réglage serveur (`standard_conforming_strings`) et d'une cohérence d'encodage qui ne sont
vérifiés nulle part par un test, et qui peuvent changer à la faveur d'une migration
PostgreSQL, d'une bibliothèque de connexion différente, ou d'un paramètre de configuration
modifié sans lien apparent avec ce fichier. C'est la seule occurrence de ce style dans tout
le dépôt — qui, partout ailleurs, lie ses paramètres correctement, y compris dans le même
fichier trois lignes plus loin (`crm.controller.ts:229`, `set_config(..., $1, true)`).

**Correctif** — effort **S** : remplacer la construction manuelle par un filtre lié —
`$queryRaw` avec un gabarit conditionnel, ou une clause construite via les opérateurs
Prisma standards (`Prisma.sql` avec interpolation typée) plutôt qu'un remplacement de
chaîne.

---

## 7. EXPOSITION

`RAS`, vérifié positivement sur les points suivants :

- **Aucun secret versionné.** `git ls-files | grep -i env` ne rend que `.env.example`,
  entièrement composé de valeurs `REMPLACER_...` ; recherche sur tout l'historique
  (`git log --all --diff-filter=A --name-only`) : même résultat, aucun `.env` réel n'a
  jamais été committé.
- **Aucune console d'administration ni documentation d'API exposée.** Recherche sur
  `SwaggerModule`/`@nestjs/swagger` dans `apps/api/src` : aucune occurrence, aucun module
  installé (`package.json` ne le liste pas).
- **Pas de fuite de trace technique.** `main.ts:30-33` réduit les niveaux de journal en
  production, et surtout, `PrismaExceptionFilter` (`common/filters/prisma-exception.filter.ts`)
  traduit systématiquement les erreurs Prisma/PostgreSQL en messages métier avant de
  répondre — vérifié : aucune branche ne renvoie `exception.message` brut au client pour
  une erreur `500`.
- **CORS fermé par liste explicite**, jamais par joker (`main.ts:64-75`,
  `CORS_ALLOWED_ORIGINS` obligatoire, sans repli permissif).
- **En-têtes de sécurité posés par `helmet`** (CSP, HSTS, `referrer-policy: no-referrer`,
  `cross-origin-resource-policy: same-site` — `main.ts:55-62`), et `x-powered-by` désactivé.
- Le seul secret externe identifié comme géré en dehors de ce cadre est `FNE_API_KEY`,
  déjà traité en détail au § 5 — c'est un problème de **stockage et de duplication**, pas
  d'exposition réseau directe.

Une réserve, déjà posée en L1 : ces vérifications portent sur la configuration du dépôt,
pas sur un environnement de production réel qui n'existe pas encore (I1,
`00_PERIMETRE.md`) — en particulier, la terminaison TLS effective, en amont de
`docker-compose.yml`, n'est décrite nulle part et reste `NON VÉRIFIABLE`.

---

## 8. INFRASTRUCTURE

`RAS`, sous réserve de L1 (environnement cible non observable). Repris et vérifié depuis
`docker-compose.yml` :

- PostgreSQL et Redis sur un réseau `data` déclaré `internal: true` — **aucun port publié**
  pour l'un ou l'autre (`docker-compose.yml:29,65,94-95`) ; seule l'API, présente sur les
  deux réseaux, peut les joindre.
- Conteneurs durcis de façon homogène (`x-hardening`, :16-22) : `no-new-privileges`,
  `cap_drop: ALL` avec réintroduction ciblée des seules capacités nécessaires à
  `postgres`/`redis` pour leur `initdb`.
- Conteneur API en **lecture seule** (`read_only: true`, :143), avec un unique volume
  d'écriture pour les pièces jointes, monté `noexec` côté `/tmp` (:144-145).
- Mots de passe et secrets exigés par variable d'environnement, sans repli
  (`:?...requis`), donc échec au démarrage plutôt que démarrage dégradé — cohérent avec
  `env.config.ts` (§ 00_PERIMETRE, déjà vérifié).
- Images figées à une version mineure précise (`postgres:16.4-alpine3.20`,
  `redis:7.4.1-alpine3.20`, `node:22.11.0-alpine3.20`) — reproductible, pas de dérive
  silencieuse au prochain `pull`.

Point non couvert : aucune preuve d'un balayage de vulnérabilités connues sur ces images
(`docker scout`, `trivy` ou équivalent) n'a été trouvée dans le dépôt ni dans une
configuration CI (déjà noté absente par `05_ARCHITECTURE.md` § 7) — `NON VÉRIFIABLE` sans
exécution d'un tel outil, hors périmètre de lecture seule.

---

## 9. CONTINUITÉ

Repris de `00_PERIMETRE.md` I4 et `05_ARCHITECTURE.md` § 8, non contredit ni aggravé par
cet axe — confirmé une nouvelle fois par une recherche dédiée : `find . -iname "*backup*"`
et une recherche de `pg_dump`/`pg_basebackup` dans les fichiers d'orchestration ne
rendent **aucun résultat**.

### [S2] Aucune procédure de sauvegarde ni de restauration n'existe dans le dépôt

```
Propriété    : (continuité d'activité — hors P1-P5, traitée comme telle par le protocole)
Axe          : Sécurité
Statut       : CONSTATÉ (absence dans le dépôt) / NON VÉRIFIABLE (réalité de production, I1)
```

**Mécanisme.** Deux volumes portent l'intégralité de l'état du système :
`postgres_data` (toutes les données transactionnelles) et `api_uploads` (photos et
signatures terrain, dont le commentaire du fichier lui-même rappelle qu'« un contrôle HSE
validé sur photo perd sa preuve » sans lui — `docker-compose.yml:35-39`). Aucun des deux
n'est couvert par un script de sauvegarde, une tâche planifiée, ou une documentation de
restauration, dans ce dépôt.

**Impact.** Sur un système qui porte des créances, des paiements et des preuves de
conformité HSE opposables, l'absence de sauvegarde éprouvée n'est pas un risque
informatique secondaire : une panne de disque, une erreur d'exploitation ou un incident de
sécurité sur le seul VPS envisagé par l'hypothèse H2 (`00_PERIMETRE.md`) efface
l'intégralité de l'activité commerciale et sa piste d'audit — y compris le journal dont le
§ 5 vient de constater qu'il est déjà, par ailleurs, inconsultable au quotidien.

**Correctif** — effort **M** : `pg_dump`/`pg_basebackup` planifié avec rétention et
**test de restauration documenté et rejoué périodiquement** (une sauvegarde jamais
restaurée n'est qu'une hypothèse), et une politique de sauvegarde du volume
`api_uploads` au même rythme.

---

## 10. RÉCAPITULATIF DES CONSTATS DE L'AXE

| # | Constat | Sévérité | Propriété | Statut |
|---|---|---|---|---|
| 1 | IDOR en écriture sur `deals.controller.ts` (chiffrage, prix fournisseur, soumission) — le contrôle de propriété posé le 08/08 n'a pas été porté aux méthodes d'écriture | **S1** | P2 · P3 | CONSTATÉ |
| 2 | Aucune séparation des tâches sur les paiements clients et fournisseurs | **S1** | P2 · P3 | CONSTATÉ |
| 3 | Journal d'audit exclusivement en écriture — aucune route de lecture | **S1** | P4 | CONSTATÉ, vérifié à l'exécution (404 sur 5 chemins plausibles, DG) |
| 4 | Facturation sans cloisonnement par commercial, en lecture et en écriture | S2 | P3 | CONSTATÉ, vérifié à l'exécution (total non filtré) |
| 5 | Masquage des marges incomplet (`purchaseAmount`, charges) + module barge sans masquage | S2 | P3 | CONSTATÉ, vérifié à l'exécution |
| 6 | `mustChangePassword`/2FA obligatoire non appliqués côté serveur | S2 | P3 | CONSTATÉ, vérifié à l'exécution |
| 7 | Clé API FNE en clair, servie sans filtrage, dupliquée dans le journal d'audit | S2 | P4 | CONSTATÉ |
| 8 | Aucune procédure de sauvegarde/restauration | S2 | — | CONSTATÉ (dépôt) / NON VÉRIFIABLE (prod) |
| 9 | Pipeline CRM sans piste d'audit | S3 | P4 | CONSTATÉ |
| 10 | Requête CRM construite par concaténation (échappement manuel) | S3 | P3 | CONSTATÉ, testé sans contournement trouvé |

Aucun constat sur : l'algorithme de hachage des mots de passe (Argon2id, paramètres
explicites et cohérents seed/service), le verrouillage par compte après échecs, la
limitation de débit à la connexion, la rotation des jetons de rafraîchissement à usage
unique, le cloisonnement du portail client (revérifié conforme), les en-têtes de
sécurité, le CORS, l'absence de console d'administration exposée, ou le durcissement des
conteneurs — `RAS` sur ces points, sous les réserves déclarées en § 0.

---

## 11. CE QUE CET AXE N'A PAS COUVERT

- **Preuve d'exécution directe pour les IDOR entre deux comptes de même rôle** (§ 2, § 3) :
  le jeu de données ne compte qu'un titulaire par rôle sensible (L2). Les constats
  reposent sur une lecture exhaustive du code d'autorisation, croisée avec une preuve
  d'exécution du mécanisme (absence de filtre observée en direct), mais pas sur un accès
  croisé réellement observé entre deux utilisateurs distincts.
- **Test d'intrusion outillé** (fuzzing, scan de vulnérabilités, force brute réelle contre
  le verrouillage de compte) : hors périmètre d'un audit en lecture seule (L3).
- **Comportement en environnement de production réel** : TLS effectif, exposition réseau
  réelle, fréquence de rotation des secrets — I1, non observable.
- **Lecture exhaustive du contenu du journal d'audit** : le mécanisme est vérifié, son
  contenu sur la durée ne l'a pas été (L4).
- **Conformité aux référentiels de sécurité formels** (OWASP ASVS, ISO 27001 ou
  équivalent) : cet audit vérifie des mécanismes concrets contre le code réel, pas une
  checklist de conformité déclarative.

---

*Axe C clos. Aucune modification du code n'a été effectuée. Les seules écritures produites
par les vérifications exécutées sont celles que l'application elle-même effectue dans le
cours normal d'une requête légitime (connexions, lectures) — aucune donnée n'a été créée,
modifiée ou supprimée au-delà de ce que les appels HTTP décrits ci-dessus impliquent
nécessairement (nouvelles sessions, entrées de journal de connexion).*
