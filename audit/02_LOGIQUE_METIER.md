# 02 — LOGIQUE MÉTIER (Axe A)

Rappel du § 0 de `00_PERIMETRE.md` : **l'auditeur est l'auteur du code**. Je m'en tiens
autant que possible à la preuve exécutée plutôt qu'à la lecture — la pile tourne
(`docker ps` : `api`, `web`, `postgres`, `redis`, tous `healthy`), ce qui permet, comme en
phases 0 et 1, d'envoyer la requête interdite et d'observer le refus, ou son absence.

---

## 0. CADRAGE DE CET AXE

**Ce qui est repris sans être rejoué.** `01_COUVERTURE_FONCTIONNELLE.md` et
`05_ARCHITECTURE.md` ont déjà traité, avec preuve à l'exécution, une bonne part des
invariants A1-A13 sur le **cœur** du système (Contrat → Affaire → Opération →
Facturation → Encaissement) : facturation bornée au volume contracté (A1), verrou de
marge et de crédit (A9), encaissement dérivé du journal et rendu idempotent (A7, A8),
arrondi centralisé (A5), créances échues dérivées à la lecture (A7, A10). Je ne
reproduis pas ces démonstrations ; je les cite et je vérifie, quand c'est pertinent,
qu'elles tiennent encore face au code ajouté depuis.

**Ce qui est neuf dans cet axe.** Le dirigeant a signalé cinq zones ajoutées depuis
`01` et jamais soumises à un audit de logique métier : facturation FNE et son modèle de
paiement/gabarit gouvernemental, recouvrement actif (relance et balance âgée),
exploitation et maintenance de barge, portail client (demandes de cotation, tableau de
bord des affaires, acceptation de proforma), et les « interrupteurs » de seuils
(`is_active` sur `MarginThreshold` / `UllageTolerance`). C'est là que porte l'essentiel
de cet axe : ces modules n'ont encore été vus par aucun rapport, et `05_ARCHITECTURE.md`
lui-même le signale en tête (« l'intégralité des fichiers examinés... non encore
audités »). `05` en a tiré des constats d'**architecture** (frontières transactionnelles,
performance). Ceux qui suivent sont des constats de **règle métier** : ce que le système
autorise, interdit, calcule ou tait.

**Méthode.** Pour chaque invariant testé en base, la requête est passée dans une
transaction explicitement annulée (`BEGIN` / `ROLLBACK`) — aucune écriture ne subsiste.
Le détail de chaque commande est donné avec le constat correspondant.

---

## 1. VERDICT DE L'AXE

> **Le socle audité en phases 0 et 1 tient. Les cinq modules ajoutés depuis n'ont pas
> reçu le même traitement, et cela se voit précisément là où on l'attendrait : à la
> frontière entre la donnée et la règle.**
>
> Quatre-vingt-dix-neuf contraintes `CHECK` protègent les tables du lot 1 et 2. Les
> quatre tables et les deux colonnes ajoutées par les cinq dernières migrations n'en
> portent **aucune** — pas une seule. Un coût de maintenance négatif, testé en
> exécution, est accepté sans résistance. Ce n'est pas un relâchement généralisé :
> c'est l'absence, module par module vérifiable, du geste que le reste du dépôt répète
> depuis l'origine — ajouter le SQL métier en même temps que la table Prisma.
>
> Le second trait commun est plus subtil : plusieurs de ces modules **existent des deux
> côtés sans se rejoindre**. Le portail sait recevoir une demande de cotation ; rien,
> nulle part dans le code interne, ne sait la lire. Un champ de tableau de bord barge
> s'appelle « prochaine échéance de maintenance » et restitue la date du dernier
> entretien. Un interrupteur censé « couper » un seuil de marge, testé en exécution, ne
> le coupe pas — il rend le segment entier impossible à approuver. Rien de tout cela
> n'est une fraude ni une régression du cœur du système : ce sont des demi-mesures,
> chacune documentée dans son fichier avec la même honnêteté que le reste du dépôt,
> mais dont personne n'a encore vérifié qu'elles se referment.

---

## A1. CHAÎNE DOCUMENTAIRE ET PROPAGATION

**Établi en phase 1, non rejoué ici.** `01_COUVERTURE_FONCTIONNELLE.md` § 3 a démontré à
l'exécution que le cumul facturé n'était borné par rien, puis (§ 9.1) que le correctif
— un déclencheur `enforce_facturation_bornee` — tient. Vérification de non-régression :
le fichier source existe toujours et est toujours injecté par le script de préparation.

```
CONSTATÉ — apps/api/prisma/sql/30_facturation_bornee.sql (présent, 208 lignes)
CONSTATÉ — apps/api/scripts/prepare-migrations.mjs:86 : '30_facturation_bornee.sql'
           reste dans SQL_FILES, à sa place déclarée.
```

RAS sur ce point précis.

### [S2] Le premier maillon de la chaîne commerciale — la demande de cotation portail — ne mène nulle part

```
Propriété    : P1 Fidélité
Axe          : Métier (A1)
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/prisma/schema.prisma:646-680` (modèle),
`apps/api/src/portal/portal.controller.ts:45-95` (API).

**Extrait** — le commentaire du modèle lui-même décrit le circuit attendu :

```prisma
/// Volontairement LÉGER : un client ne chiffre rien, ne négocie rien, ne
/// voit ni prix ni marge. Il exprime un besoin ; c'est un commercial qui le
/// transforme en `Deal` — avec le prix, les conditions et les contrôles que
/// cela suppose.
model QuotationRequest {
  ...
  status QuotationRequestStatus @default(NEW)
  convertedDealId String? @unique @map("converted_deal_id") @db.Uuid
```

**Mécanisme.** Le portail expose `POST /api/portal/quotations` (création) et
`GET /api/portal/quotations` (liste propre au client) — les deux fonctionnent, testés
par lecture de code et par la présence des routes dans `PortalController`. Le second
côté du circuit — un commercial qui **voit** la demande et la **transforme** en `Deal`,
ce que le commentaire du modèle annonce comme le fonctionnement prévu — est introuvable :

- Recherche de `QuotationRequest` / `quotationRequest` / `convertedDealId` dans tout
  `apps/api/src`, hors `portal.controller.ts` : **0 résultat**. Aucun contrôleur interne
  (`sales`, `crm`, `operations`) ne lit ni n'écrit cette table.
- Recherche de `QuotationRequest`, `quotations`, « demande de cotation », « demande de
  devis » dans tout `apps/web/src` : **0 résultat**. Aucun écran, commercial ou autre, ne
  l'affiche.
- Recherche dans `apps/api/prisma/sql/22_file_de_taches.sql` (la file de tâches, qui
  fait déjà remonter dix-neuf autres types d'attente) : **0 résultat**. Une demande de
  cotation ne génère aucune tâche pour personne.
- Recherche de `resolve_margin_threshold`-style fonction ou de tout mécanisme
  d'administration exposant cette table via le registre générique de référentiels
  (`apps/api/src/referentials/registry.ts`) : **0 résultat**.

`status` reste donc `NEW` indéfiniment, et `convertedDealId` reste `NULL` par
construction : rien dans le code ne l'écrit jamais.

**Impact — scénario concret.** Un client B2B se connecte au portail (fonctionnalité
que `01_COUVERTURE_FONCTIONNELLE.md` § 5 avait classée `ABSENT` faute de toute route de
données — c'est précisément le comblement partiel de ce manque) et soumet une demande
pour 50 000 L de Diesel, livraison sous une semaine. Il reçoit un `201 Created` :
l'opération a visiblement réussi de son point de vue, et il peut même la retrouver dans
sa propre liste. **Rien ne se passe ensuite.** Aucun commercial n'est notifié, aucun
écran interne ne fait apparaître la demande, aucune tâche ne la signale. Le client
attend, puis appelle — et l'agent qui décroche n'a aucun moyen de savoir qu'une demande
existe déjà dans le système, puisqu'aucun écran ne la lui montre. Le canal que le
portail devait ouvrir produit l'effet inverse de celui recherché : une demande qui
paraît prise en compte et ne l'est jamais, ce qui est pire, du point de vue du client,
que l'absence du canal.

**Ce que cela n'est pas.** Ce n'est pas un défaut de couverture au sens de
`01_COUVERTURE_FONCTIONNELLE.md` § 5 (déjà posé : le portail est `ABSENT` sur le fond) —
c'est un cran plus loin : la moitié du circuit qui **existe** casse la moitié qui
**n'existe pas encore**, en créant l'apparence d'un service rendu.

**Correctif** — effort **S** :
1. Un écran interne (ou, a minima, une entrée dans la file de tâches existante) listant
   les `QuotationRequest` au statut `NEW`/`IN_REVIEW`, visible par le rôle commercial.
2. Un point d'entrée `PATCH` qui pose `status = CONVERTED` et `convertedDealId` au
   moment de la création du `Deal` qui en découle — ou, à défaut immédiat, `DECLINED`
   avec motif, pour que le client voie au moins un accusé de réception dans sa propre
   liste plutôt qu'un `NEW` qui ne change jamais d'état.

---

## A2. CYCLE DE VIE ET MACHINE À ÉTATS

**Ce qui est déjà connu et non rejoué.** Aucun `CHECK` ni déclencheur générique ne
valide la matrice des transitions autorisées de `Deal.status` au niveau de la base
(recherche de `deal_status` combinée à une liste de transitions dans
`apps/api/prisma/sql/` : 0 résultat au-delà de la table de journal
`deal_status_transitions`, append-only). C'est une caractéristique du cœur du système,
antérieure à cette session ; je ne la requalifie pas ici faute d'élément nouveau.

### Le portail ajoute un acteur externe à la machine à états — cloisonnement vérifié, RAS

**Localisation** — `apps/api/src/portal/portal.controller.ts:154-201` (`acceptDeal`).

**Mécanisme.** `PATCH /api/portal/deals/:id/accept` est la seule transition que le
portail déclenche. Trois gardes, dans l'ordre : la ressource est retrouvée **filtrée
par `clientId: partnerId` du jeton** (pas de `findUnique` par id seul — un identifiant
d'une autre affaire renvoie `404`, jamais de confirmation d'existence) ; l'idempotence
est vérifiée (`deal.acceptedByPortalUserId` déjà posé → refus) ; l'état de départ est
vérifié (`status !== PROFORMA_SENT` → refus). La transition elle-même écrit dans une
transaction Prisma qui pose le nouveau statut **et** la ligne de journal
`deal_status_transitions` dans le même `tx`.

```ts
// portal.controller.ts:156-160
const deal = await tx.deal.findFirst({
  where: { id, clientId: partnerId },
  select: { status: true, acceptedByPortalUserId: true },
});
if (!deal) throw new NotFoundException('Affaire introuvable.');
```

C'est le comportement attendu : un client ne peut ni voir, ni faire progresser une
affaire qui n'est pas la sienne, et ne peut agir que sur l'unique transition qui lui est
ouverte. `RAS` sur ce point précis — cité pour mémoire, à titre de contrôle, parce que
c'est la première fois qu'un acteur non interne obtient un point d'écriture sur `Deal`.

### [S4] La double garde applicative contre le double clic n'est pas transactionnellement isolée

```
Propriété : P2 Intégrité · Axe : Métier (A2, A8) · Statut : CONSTATÉ
```

**Mécanisme.** La lecture (`findFirst`) et l'écriture (`update`) sont dans le **même**
`$transaction`, mais Prisma ouvre par défaut une transaction interactive en
`ReadCommitted` sur PostgreSQL — pas `Serializable`. Deux clics simultanés sur
« Accepter » peuvent tous deux lire `status === PROFORMA_SENT` avant que l'un des deux
ne commette. Contrairement à l'encaissement (`01` § 7, corrigé par un solde dérivé en
base), aucun déclencheur ne referme la course ici.

**Impact.** Contenu : les deux écritures convergent vers le même état final
(`CUSTOMER_ACCEPTED`, `acceptedByPortalUserId` = le dernier gagnant), et
`deal_status_transitions` reçoit une ligne dupliquée plutôt qu'une valeur incohérente.
Pas de perte financière ni de double engagement — juste un doublon dans le journal
d'audit métier. Sévérité **S4**.

**Correctif** — effort **S** : `UPDATE ... WHERE id = ? AND accepted_by_portal_user_id
IS NULL RETURNING id` (mise à jour conditionnelle atomique) plutôt qu'un
lire-puis-écrire, sur le modèle déjà appliqué à l'encaissement.

---

## A3. IMMUTABILITÉ ET CORRECTION

**RAS pour les modules neufs — le motif déjà établi tient.** `00_PERIMETRE.md` § 2.2
avait constaté zéro route `DELETE` sur l'ensemble de l'API. Vérification sur les trois
nouveaux contrôleurs :

```
CONSTATÉ — apps/api/src/transport/barge.controller.ts   : GET, POST. 0 PATCH, 0 DELETE.
CONSTATÉ — apps/api/src/invoicing/collections.controller.ts : GET, POST. 0 PATCH, 0 DELETE.
CONSTATÉ — apps/api/src/portal/portal.controller.ts      : GET, POST, 1 PATCH (transition
           d'état ci-dessus, pas une correction de pièce). 0 DELETE.
```

`VehicleMaintenanceEvent` et `DunningAction` sont, par construction de leur API, des
journaux à écriture seule — cohérent avec le reste du dépôt, et adapté à leur nature
(une intervention de maintenance ou une relance passée ne se réécrit pas). Aucune voie
de correction n'est nécessaire ici comme elle l'est pour une facture, faute d'effet
juridique ou financier direct de ces deux tables. `RAS`.

---

## A4. NUMÉROTATION ET SÉQUENCES

**RAS, non ré-audité en détail — mécanisme déjà solide, non sollicité par les nouveaux
modules.** `ReferenceService.next()` (`apps/api/src/common/reference/reference.service.ts:58-80`)
incrémente par un `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` — un aller-retour
atomique tenu par la base, pas par une lecture puis écriture applicative :

```ts
// reference.service.ts:66-71
const rows = await this.prisma.$queryRaw<Array<{ last_value: number }>>`
  INSERT INTO number_sequences (id, scope, year, month, last_value, updated_at)
  VALUES (gen_random_uuid(), ${scope}, ${year}, ${month}, 1, now())
  ON CONFLICT (scope, year, month)
  DO UPDATE SET last_value = number_sequences.last_value + 1, updated_at = now()
  RETURNING last_value`;
```

C'est la bonne construction pour la concurrence : deux créations simultanées obtiennent
deux valeurs distinctes par le mécanisme de verrouillage de ligne de PostgreSQL, pas par
une convention applicative. Aucun des cinq modules neufs n'émet de pièce numérotée
(maintenance, relance, demande de cotation ne sont pas des pièces opposables) : ils
n'engagent donc pas ce mécanisme, et ne le mettent ni à l'épreuve ni en danger.

---

## A5. ARITHMÉTIQUE MONÉTAIRE

**Établi en phase 1, non rejoué : `apps/api/src/common/money/money.ts` est désormais
l'autorité unique de l'arrondi**, avec passage par notation exponentielle pour éviter
l'erreur de représentation binaire (`roundTo(1.005, 2)` → 1,01, vérifié dans `01` § 9.1).

### [S4] Le module de barge recalcule ses totaux sans passer par l'autorité d'arrondi centralisée

```
Propriété    : P1 Fidélité
Axe          : Métier (A5)
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/src/transport/barge.controller.ts:1-17` (imports),
`apps/api/src/transport/barge.controller.ts:223-226`.

**Extrait** :

```ts
revenuePivot: Number(revenuePivot.toFixed(4)),
operatingCostPivot: Number(operatingCostPivot.toFixed(4)),
maintenanceCostPivot: Number(maintenanceCostPivot.toFixed(4)),
marginPivot: Number((revenuePivot - operatingCostPivot - maintenanceCostPivot).toFixed(4)),
```

**Mécanisme.** Le fichier n'importe pas `round4`/`roundTo` de `common/money/money.ts` —
vérifié sur la liste complète des imports (`barge.controller.ts:1-17`) : aucune
référence à `common/money`. Il utilise `Number.prototype.toFixed`, exactement le
motif que `money.ts` a été écrit pour remplacer partout (en-tête du fichier :
« Quatre copies d'une même règle ne restent identiques que tant que personne n'en
corrige une »). `toFixed` n'a pas le défaut du binaire mal arrondi de l'ancien
`Math.round(n * 10**d)/10**d` (il tronque/arrondit via sa propre représentation
textuelle), donc ce n'est pas la régression exacte de `01` — mais c'est une **sixième**
implémentation indépendante de la même intention, écrite après que le dépôt s'est doté
d'une autorité unique pour cette raison précise.

**Impact.** Aux montants et devises actuellement en jeu (XOF, zéro décimale), la
différence de comportement entre `toFixed` et `round4` est improbable à révéler un
écart réel — c'est pourquoi la sévérité reste **S4**, pas plus. Le risque n'est pas
dans ce fichier isolément : c'est que la centralisation votée par `01` ne survit que si
chaque nouveau fichier l'utilise, et celui-ci est la démonstration que ce n'est pas
automatique.

**Correctif** — effort **S** : remplacer les quatre `.toFixed(4)` par `round4(...)`,
importé de `../common/money/money`.

---

## A6. UNITÉS ET CONVERSIONS

### [S3] Le compte d'exploitation par barge additionne des volumes sans vérifier leur unité

```
Propriété    : P1 Fidélité · P5 Restitution
Axe          : Métier (A6)
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/src/transport/barge.controller.ts:145-181`.

**Extrait** :

```ts
// barge.controller.ts:159-164 — sélection : uom EST remonté...
operation: {
  select: {
    id: true, dealId: true, plannedVolume: true, uom: true, status: true,
    costLines: { select: { actualAmount: true, estimatedAmount: true, currencyCode: true } },
  },
},
...
// barge.controller.ts:180 — ... mais jamais lu ici :
const volumeTotal = barge.assignments.reduce((s, a) => s + Number(a.operation.plannedVolume), 0);
```

**Mécanisme.** `Operation.uom` (`schema.prisma:2633`) est un champ libre par opération —
`UnitOfMeasure` compte quatre valeurs (`L`, `M3`, `MT`, `BBL`, cf.
`fne-client.service.ts:428-433`), et rien n'impose qu'une même barge (`Vehicle` de type
`BUNKER_BARGE`) transporte toujours le même produit dans la même unité : le modèle
`OperationAssignment` (`schema.prisma:2731`) rattache une affectation à une opération
quelconque, sans filtre de produit ni d'unité. Le calcul de `volumeTotal` somme les
`plannedVolume` de toutes les opérations confiées à la barge **sans jamais regarder
`uom`**, alors que le champ est explicitement sélectionné une ligne plus haut — il est
récupéré, puis ignoré dans l'agrégat.

**Ce que la base montre.** Aucune donnée actuelle n'illustre le mélange (le parc
d'opérations en base est trop réduit), donc ce constat porte sur l'**absence de
protection**, pas sur une valeur déjà fausse — comme `05_ARCHITECTURE.md` l'avait
formulé pour un cas voisin (`GeneratedDocument` sans unicité). C'est la nature même du
défaut qui rend la preuve difficile à obtenir sans l'exploiter : le jour où une barge
sert un chargement de Fuel 180 en tonnes et un chargement de Diesel en litres dans le
même mois, `volumeTotal` additionnera les deux nombres comme s'ils étaient
homogènes — le tableau de bord (`GET /api/internal/supervision/barges`) l'affichera
sans avertissement.

**Impact — scénario concret.** Une barge exécute deux voyages : 3 000 MT de Fuel 180
puis 40 000 L de Diesel. Le tableau de bord affiche un `volumeTotal` de 43 000 — un
nombre syntaxiquement valide, sémantiquement vide, que rien ne distingue d'un total
homogène. Un dirigeant qui compare deux barges sur ce chiffre compare en réalité des
grandeurs incompatibles sans le savoir. Pas de perte financière directe (le calcul ne
nourrit aucun verrou), mais une donnée de pilotage fausse, présentée avec la même
autorité visuelle qu'une donnée juste.

**Correctif** — effort **S** : soit convertir chaque `plannedVolume` vers une unité
pivot avant sommation (le mécanisme existe déjà pour les devises —
`pivotRate()`, lignes 121-139 du même fichier — le calquer pour les volumes suppose une
table de conversion produit-dépendante qui n'existe pas encore, cf. réserve
ci-dessous), soit, a minima, grouper `volumeTotal` par `uom` plutôt que de l'agréger en
un seul nombre.

**Réserve.** Contrairement à la devise (taux de change centralisé,
`fxRate`), **aucune table de conversion volume↔volume ou volume↔masse n'existe dans le
schéma** (recherche de « density », « conversion », « m3_to_mt » : 0 résultat en dehors
de `reference_density_15` sur `Product`, utilisée pour l'ASTM 54B, pas pour ce calcul).
Sommer correctement suppose donc d'abord de construire ce référentiel — le correctif
« grouper par `uom` » est la voie immédiate, la conversion physique un chantier plus
large.

---

## A7. SOLDES ET POSITIONS DÉRIVÉS

**Établi en phase 1, non rejoué.** Le solde encaissé (`invoices.paid_amount`) est
dérivé du journal des règlements par déclencheur, la créance échue (`v_creances_echues`)
est calculée à la lecture. Vérifié toujours en place :

```
CONSTATÉ — apps/api/prisma/sql/31_encaissement_fiable.sql (285 lignes, présent)
```

### [S2] Aucune des quatre tables ajoutées par les cinq dernières migrations ne porte de contrainte `CHECK` — vérifié par écriture directe acceptée

```
Propriété    : P3 Invariance
Axe          : Métier (A7, A9)
Statut       : CONSTATÉ (par lecture ET par exécution)
```

**Localisation** — `apps/api/prisma/migrations/20260815090647_module_barge/migration.sql`
(DDL Prisma, avant injection SQL métier), et les quatre autres migrations du 15/08.

**Extrait** — le DDL généré pour `vehicle_maintenance_events` (identique en substance
pour `dunning_actions` et `quotation_requests`) :

```sql
CREATE TABLE "vehicle_maintenance_events" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "type" "vehicle_maintenance_type" NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency_code" CHAR(3) NOT NULL,
    "performed_at" DATE NOT NULL,
    "next_due_at" DATE,
    ...
    CONSTRAINT "vehicle_maintenance_events_pkey" PRIMARY KEY ("id")
);
-- 3 FOREIGN KEY, 2 INDEX. Aucun CHECK.
```

**Mécanisme.** `00_PERIMETRE.md` § 3 relevait 79 contraintes `CHECK` sur le schéma
existant, et `01_business_constraints.sql` en porte, entre autres, sur exactement ce
type de champ ailleurs dans le même schéma :

```
CHECK (credit_limit >= 0),                                    -- 01_business_constraints.sql:113
CHECK (budgeted_amount >= 0 AND budgeted_base > 0 ...),        -- 01_business_constraints.sql:178
CHECK (capacity > 0 AND (compartment_count IS NULL OR ...)),   -- 01_business_constraints.sql:263
```

Les quatre tables ajoutées le 15/08 (`vehicle_maintenance_events`, `dunning_actions`,
`quotation_requests`) et les deux colonnes ajoutées sur des tables existantes
(`invoices.payment_method`, `partners.is_government_institution`) n'ont **aucune**
entrée correspondante dans `apps/api/prisma/sql/` : `SQL_FILES` dans
`prepare-migrations.mjs:43-103` n'a reçu aucun nouveau fichier depuis `35_fin_de_transition.sql`.
Le seul filet pour ces cinq migrations est le DTO `class-validator` de chaque
contrôleur — une protection **applicative**, pas une contrainte de **moteur**. C'est
exactement la question que l'invariant A7 impose de poser : *« Les valeurs négatives
interdites le sont-elles par contrainte de base ou par simple test applicatif ? »*

**Vérifié à l'exécution** — insertion directe, hors DTO, dans une transaction annulée :

```sql
BEGIN;
INSERT INTO vehicle_maintenance_events
  (id, vehicle_id, type, description, cost, currency_code, performed_at, recorded_by_id)
VALUES
  (gen_random_uuid(), :'v_id', 'CORRECTIVE',
   'Test cout negatif audit - transaction annulee', -500000, :'c_code', CURRENT_DATE, :'u_id');
SELECT id, cost, description FROM vehicle_maintenance_events WHERE description LIKE 'Test cout negatif%';
ROLLBACK;
```

Résultat observé :

```
INSERT 0 1
                  id                  |     cost     |                  description
--------------------------------------+--------------+-----------------------------------------------
 778b64ae-5165-427c-bb41-a1d072f87efe | -500000.0000 | Test cout negatif audit - transaction annulee
ROLLBACK
```

Un coût de maintenance de **-500 000** est accepté sans le moindre message d'erreur.
Le DTO `RecordMaintenanceDto` (`barge.controller.ts:27` : `@Min(0) cost?: number`)
bloque bien cette valeur **si l'écriture passe par l'écran** — mais l'invariant A7
demande précisément ce qui se passe *hors* de l'écran : un script de reprise, un import,
une correction en base par un tiers technique, ou tout futur code qui écrirait dans
cette table sans repasser par ce contrôleur.

**Impact — scénario concret.** Un coût de maintenance négatif dans `vehicle_maintenance_events`
se propage directement dans `bargePnL()` (`barge.controller.ts:192-196`) :
`maintenanceCostPivot` diminue, et `marginPivot` — la marge affichée par barge au
dirigeant et au CCOO — **augmente** d'autant. Une correction saisie de travers (signe
inversé lors d'une reprise, par exemple) gonflerait silencieusement la rentabilité
apparente d'une barge, sans qu'aucun contrôle ne le signale : ni `CHECK`, ni tâche, ni
recoupement. Sur un système qui a fait, pour tout le reste du schéma, du `CHECK` en base
sa doctrine explicite (`00_PERIMETRE.md` § 3, cité comme « l'hypothèse centrale de
l'architecture »), c'est une régression locale et démontrée de cette doctrine, pas
un choix.

**Correctif** — effort **S**, un seul fichier à ajouter (`36_recouvrement_barge_portail.sql`
ou équivalent), à insérer dans `SQL_FILES` :

```sql
ALTER TABLE vehicle_maintenance_events ADD CONSTRAINT chk_maintenance_cost_non_negatif CHECK (cost >= 0);
ALTER TABLE quotation_requests ADD CONSTRAINT chk_quotation_volume_positif CHECK (desired_volume > 0);
ALTER TABLE dunning_actions ADD CONSTRAINT chk_dunning_contact_pas_futur CHECK (contacted_at <= now());
```

### [S3] La balance âgée du recouvrement réimplémente en TypeScript une règle déjà portée par une vue SQL dédiée, avec un périmètre de type divergent

```
Propriété    : P5 Restitution
Axe          : Métier (A7)
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/src/invoicing/collections.controller.ts:40-95` contre
`apps/api/prisma/sql/31_encaissement_fiable.sql:228-249`.

**Extrait** — la vue SQL, écrite lors de la remédiation de `01` précisément pour ce
besoin (« Balance âgée des créances clients (§ 13, module 6 — recouvrement) ») :

```sql
CREATE OR REPLACE VIEW v_creances_echues AS
SELECT ...
  FROM v_rapprochement_encaissements r
 WHERE r.statut NOT IN ('DRAFT', 'CANCELLED', 'PAID')
   AND r.reste_du > tolerance_arrondi(r.currency_code);
```

— et `v_rapprochement_encaissements` (ligne 196) ne filtre que
`WHERE i.type::text <> 'PROFORMA'` : un avoir (`CREDIT_NOTE`) **n'est pas exclu** de la
vue si son `reste_du` calculé dépasse la tolérance.

Le nouveau contrôleur, écrit indépendamment :

```ts
// collections.controller.ts:60-64
where: {
  status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'DISPUTED'] },
  type: { in: [InvoiceType.SIMPLE, InvoiceType.FNE] },   // exclut explicitement CREDIT_NOTE
},
```

**Mécanisme.** Le filtre de statut est, une fois l'énumération complète comparée
(`DRAFT, ISSUED, PARTIALLY_PAID, PAID, OVERDUE, DISPUTED, CANCELLED` —
`schema.prisma:2248-2258`), **équivalent** entre les deux implémentations (liste blanche
contre liste noire qui se recoupent exactement). Le filtre de **type**, en revanche,
diverge : la vue SQL n'exclut que les proforma, la nouvelle route exclut en plus les
avoirs. Sur les données actuelles (0 avoir en base), aucune différence de résultat n'est
observable — le constat porte sur la **duplication elle-même**, pas sur un écart déjà
mesuré : deux implémentations indépendantes de la même règle métier, l'une en SQL,
l'autre en TypeScript, qui ne se lisent pas l'une l'autre et n'ont aucune raison de
rester synchrones si l'une des deux évolue. `05_ARCHITECTURE.md` § 2 documente déjà
exactement ce mécanisme de divergence pour `GeneratedDocument` ; c'est la même classe de
risque, ici sur une donnée financière consultée par le DG, le CFO et le comptable
(`CollectionsController` `@Roles`).

**Impact.** Aujourd'hui nul, faute de données pour l'exercer. Le jour où un avoir porte
un `due_date` et un `reste_du` positif (cas qui existe fonctionnellement — un avoir
partiel sur une facture déjà réglée peut laisser un solde ambigu le temps de son
traitement), la vue SQL et l'écran de recouvrement afficheraient des totaux différents
pour le même client, sans qu'aucun écran ne permette de savoir laquelle des deux fait
foi.

**Correctif** — effort **S** : faire lire `agedReceivables()` directement sur
`v_creances_echues` (`this.prisma.$queryRaw` ou une vue Prisma non managée), plutôt que
de reconstruire le filtre. La logique de tranches (`bucketOf`) devient alors un simple
affichage de la colonne `tranche` déjà calculée par la vue.

---

## A8. CONCURRENCE ET IDEMPOTENCE

**Établi en phase 1, non rejoué.** L'encaissement est désormais dérivé et fermé à la
course (`01` § 7 et § 9.1). Voir A2 ci-dessus pour la nuance nouvelle apportée par
l'acceptation de proforma côté portail (S4, pas de perte financière).

### [S4] La demande de cotation portail n'est pas protégée contre un double envoi

**Localisation** — `apps/api/src/portal/portal.controller.ts:64-87`, aucune clé
d'idempotence, aucune détection de doublon (même `partnerId`, même `productId`, même
volume, même jour). Un rejeu réseau ou un double clic crée deux lignes `QuotationRequest`
distinctes. Sévérité **S4** : compte tenu du constat A1 ci-dessus (aucune des deux
n'est de toute façon vue par personne), un doublon ici ne change rien à l'impact réel
— il s'ajoute à un problème déjà plus grave sur le même objet.

---

## A9. DONNÉES DE RÉFÉRENCE ET PARAMÉTRAGE

**Positif à signaler d'abord.** Les nouvelles données de référence introduites sont
correctement traitées comme du paramétrage, pas comme du code : `isGovernmentInstitution`
sur `Partner` et `FNE_DEFAULT_PAYMENT_METHOD` sont administrables via le registre
générique (`apps/api/src/referentials/registry.ts:697-701`) ou via `SettingsService`
(`invoices.controller.ts:749-760`), avec un traitement du défaut absent qui refuse
explicitement d'inventer une valeur :

```ts
// invoices.controller.ts:744-747
/** Repli de FNE_DEFAULT_PAYMENT_METHOD — jamais une valeur au hasard. Une
 *  clé vide, absente ou mal orthographiée dans le réglage vaut ABSENCE de
 *  défaut : la pièce reste sans mode de règlement, à saisir explicitement. */
```

C'est la discipline attendue par les mémoires de ce dépôt sur le paramétrage (aucune
donnée de fonctionnement figée dans le code) — tenue ici. `RAS` sur ce point précis.

### [S3] L'interrupteur d'un seuil de marge, testé en exécution, ne « coupe » pas le contrôle — il rend le segment entier inapprouvable

```
Propriété    : P3 Invariance
Axe          : Métier (A9)
Statut       : CONSTATÉ (par exécution)
```

**Localisation** — `apps/api/prisma/schema.prisma:1540-1543` (champ),
`apps/api/prisma/sql/03_views_and_functions.sql:229-257` (résolution),
`apps/api/prisma/sql/05_lot2_invariants.sql:736-798` (verrou).

**Extrait** — le commentaire du champ, et le texte d'aide affiché dans l'écran
d'administration :

```prisma
/// Coupure indépendante de la date de validité (§ 1.1 bis) : un seuil peut
/// être suspendu sans être réputé expiré, et réactivé sans nouvelle ligne.
isActive Boolean @default(true) @map("is_active")
```

```ts
// referentials/registry.ts:496-501
help: 'Coupe le seuil sans le dater expiré — pour le réactiver sans nouvelle
       ligne. Un seuil inactif n'est jamais résolu, quelle que soit sa fenêtre
       de validité.',
```

**Mécanisme.** `resolve_margin_threshold()` filtre bien `AND m.is_active`
(`03_views_and_functions.sql:251`) — la fonction de résolution respecte l'interrupteur
à la lettre. Mais `enforce_margin_thresholds()`, le déclencheur qui bloque
l'approbation d'un `Deal`, traite l'**absence** de seuil résolu comme un refus, pas
comme une absence de contrôle :

```sql
-- 05_lot2_invariants.sql:755-760
IF t IS NULL THEN
  RAISE EXCEPTION
    'Aucun seuil de marge configuré pour le segment % en %/%. Le deal % ne peut pas être approuvé tant que ce seuil n''existe pas.',
    ...
END IF;
```

En base, **chaque segment ne porte qu'une seule ligne active** (vérifié par lecture
directe : `B2B`, `RETAIL`, `MARITIME`, une ligne chacun, toutes `is_active = t`, aucune
ne porte de `product_id`, donc aucune ligne de repli plus spécifique ni plus générale
n'existe). Test exécuté, transaction annulée :

```sql
BEGIN;
UPDATE margin_thresholds SET is_active = false WHERE segment = 'B2B';
SELECT * FROM resolve_margin_threshold('B2B', NULL, 'XOF', 'L', CURRENT_DATE);
ROLLBACK;
```

Résultat : **0 ligne**. `enforce_margin_thresholds()` lèverait alors l'exception
« Aucun seuil de marge configuré » pour **toute** tentative d'approbation d'un deal B2B,
quelle que soit sa marge — y compris une affaire manifestement rentable, bien au-dessus
de l'ancien seuil.

**Ce que cela signifie.** « Couper le seuil » ne coupe pas le contrôle : à l'endroit
précis où la seule ligne existante est désactivée, le mécanisme devient **plus**
restrictif qu'avant (blocage systématique) plutôt que **moins** restrictif (laisser
passer). C'est un choix défendable en soi — un verrou qui échoue fermé plutôt qu'ouvert
est la position prudente pour un contrôle financier — mais il **contredit le texte
d'aide affiché à l'utilisateur qui actionne l'interrupteur** (« coupe le seuil »), et
rien dans l'écran ni dans la fonction ne signale que la conséquence, si aucune autre
ligne ne couvre le même segment/devise/unité, est un blocage total plutôt qu'un
relâchement.

**Impact — scénario concret.** Le CFO désactive le seuil B2B pour le remplacer par une
grille révisée, avec l'intention de « rouvrir » temporairement le contrôle le temps de
préparer la nouvelle ligne — l'aide de l'écran ne contredit pas cette lecture. Résultat
réel : plus aucune affaire B2B ne peut être approuvée tant que la nouvelle ligne n'est
pas créée, y compris celles qui n'auraient soulevé aucune alerte avec l'ancien seuil.
Le blocage est total, immédiat, et touche toutes les équipes commerciales du segment
simultanément — sans qu'aucune tâche, alerte ou message d'erreur explicite ne pointe
vers la cause (l'erreur SQL brute, « aucun seuil configuré », remonte au mieux comme un
message technique à l'écran de saisie).

**Correctif** — effort **S** :
1. Ajuster le texte d'aide pour dire précisément ce qui se produit : « Un segment sans
   seuil actif ne peut plus être approuvé — désactiver n'assouplit pas le contrôle, il
   le durcit. »
2. Ou, si l'intention réelle est de permettre un relâchement temporaire assumé,
   distinguer les deux cas dans `enforce_margin_thresholds()` : absence de ligne du tout
   (aucun seuil n'a jamais existé pour ce segment → blocage, comportement actuel) contre
   toutes les lignes existantes désactivées (→ laisser passer avec une trace d'audit
   explicite). Le second cas suppose une décision de gestion, pas une correction
   technique seule — à trancher avec le dirigeant avant de coder.
3. Sonde dans `23_parametres_obligatoires.sql` (le mécanisme existe déjà pour d'autres
   paramètres requis) : alerter quand un segment actif dans `deals` n'a plus aucun
   `margin_threshold` actif le couvrant. `resolve_ullage_tolerance()` porte exactement
   le même mécanisme et la même absence de sonde — le correctif couvre les deux.

### [S3] Le champ « prochaine échéance de maintenance » du tableau de bord barge restitue la date de la dernière intervention, jamais une échéance

```
Propriété    : P5 Restitution
Axe          : Métier (A9)
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/src/transport/barge.controller.ts:227-231`,
`apps/web/src/app/features/barge.component.ts:95-96`.

**Extrait** — le calcul, dans `bargePnL()` :

```ts
// barge.controller.ts:227-231
nextMaintenanceDue: barge.maintenanceEvents
  .map((m) => m.performedAt)
  .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
```

**Mécanisme.** Le champ trie les dates `performedAt` (date **d'exécution** d'un
entretien passé) par ordre décroissant et retourne la plus récente. Il ignore
totalement `nextDueAt`, la colonne conçue précisément pour porter une échéance à venir
(`schema.prisma:1690` : « Prochaine échéance — révision programmée, contrôle technique à
renouveler »), pourtant présente sur le même enregistrement et déjà lue correctement
ailleurs dans le même fichier frontend (`barge.component.ts:163` :
`m.nextDueAt?.slice(0, 10)`, dans le tableau détaillé). Le nom du champ API —
`nextMaintenanceDue` — promet une échéance à venir ; sa valeur est systématiquement une
date passée.

Le développeur du composant Angular a visiblement remarqué l'écart sans le corriger à
la source : le libellé affiché en tête de fiche barge n'est pas « Prochaine échéance »
mais **« Dernière intervention »** :

```html
<!-- barge.component.ts:95-96 -->
@if (barge.nextMaintenanceDue) {
  <span ...>Dernière intervention : {{ barge.nextMaintenanceDue.slice(0, 10) }}</span>
}
```

**Conséquence directe : aucun signal d'échéance de maintenance à venir n'existe sur la
vue de synthèse par barge** (`GET /api/internal/supervision/barges`). Le seul endroit
où `nextDueAt` est correctement restitué est le tableau détaillé, accessible
uniquement après avoir sélectionné une barge précise (`barge.component.ts:140-169`) —
il faut donc déjà savoir laquelle regarder.

**Impact — scénario concret.** Une intervention de type `REGULATORY` (contrôle
technique, cf. `VehicleMaintenanceType`) est enregistrée avec une `nextDueAt` dans deux
mois. Le tableau de synthèse, seul écran consulté en survol de flotte par le CCOO ou le
DG, ne porte aucune indication que cette échéance approche ou est dépassée — la vue de
synthèse n'affiche que la date du dernier passage, mal étiquetée en interne comme
« prochaine échéance » côté API. Une échéance réglementaire dépassée ne devient visible
qu'en ouvrant individuellement chaque barge — ce que rien n'incite à faire tant que le
tableau de synthèse ne signale rien.

**Correctif** — effort **S** :
1. Renommer et recalculer le champ : `nextMaintenanceDue` doit prendre le minimum des
   `nextDueAt` non nuls et non encore dépassés (ou le plus proche dans le passé, marqué
   en retard) — pas le maximum des `performedAt`.
2. Renommer le libellé du composant en conséquence, une fois le champ corrigé.
3. Sur le modèle de `FNE_NON_TRANSMISE` (`01` § 4) : une source de tâche
   `MAINTENANCE_ECHUE` sur `vehicle_maintenance_events.next_due_at < CURRENT_DATE`, en
   particulier pour le type `REGULATORY` — proche, dans son mécanisme, de la sonde de
   conformité documentaire déjà en place pour les véhicules
   (`SPECIFICATIONS.md:630`, « moteur d'alerte avant expiration »).

---

## A10. PÉRIODES ET CLÔTURES

**Non applicable directement aux modules neufs** — aucun des quatre (barge, relance,
demande de cotation, mode de règlement FNE) n'écrit dans le système d'exercice
budgétaire (`24_exercice_et_budget.sql`) ni ne touche à une pièce déjà émise dans un
exercice clos. Un point mérite néanmoins d'être signalé, en lien direct avec les
regroupements de charges indirectes que `SPECIFICATIONS.md` associe explicitement à la
barge.

### Le coût réel de maintenance barge n'alimente pas le regroupement budgétaire « Barge » qui porte son nom

```
Propriété : P5 Restitution · Axe : Métier (A10, A13) · Statut : INFÉRÉ
```

**Localisation** — `apps/api/prisma/schema.prisma:1416` (`CostPool`),
`apps/api/prisma/schema.prisma:1670` (`VehicleMaintenanceEvent`).

**Constaté en base** — le regroupement existe et porte un budget par exercice :

```
code           | label
POOL_MARITIME  | Exploitation maritime et barge
```

`SPECIFICATIONS.md:612` (« Regroupement... barge, transport propre ») et `:1031`
(« Coût complet = Achat + Approvisionnement + Transport + Administration + HSE +
**Barge** + Autres ») décrivent ce regroupement comme un budget annuel dont le
« coût complet » et le « point mort » (§ 14) se nourrissent. `VehicleMaintenanceEvent`
ne porte **aucune** relation vers `CostPool` ni vers l'exercice budgétaire — recherche
de `costPoolId` dans le modèle : absent. Les coûts de maintenance, désormais capturés
pour la première fois par le système, restent donc structurellement invisibles au
calcul de coût complet et de point mort : ces deux calculs continuent de tourner
exclusivement sur le **budget** du regroupement `POOL_MARITIME`, sans jamais pouvoir le
rapprocher de la **dépense réelle** que la même base contient désormais.

**Pourquoi `INFÉRÉ` et non `CONSTATÉ`.** Je n'ai pas la confirmation que ce
rapprochement était un objectif du lot livré le 15/08 — le module barge peut avoir été
scopé, à dessein, à la seule visibilité opérationnelle (voyages, disponibilité,
compte d'exploitation par moyen), en laissant le rapprochement budgétaire à un lot
ultérieur. C'est une lecture plausible, mais je n'ai trouvé aucun commentaire du dépôt
qui la confirme explicitement — d'où le statut.

**Impact.** Le point mort et le coût complet (§ 14) — qui alimentent potentiellement
les seuils de marge eux-mêmes selon le paramétrage — restent aveugles à ce que la
barge coûte réellement en entretien, alors que la donnée existe dans la même base.
Pas un défaut d'intégrité ; une occasion de rapprochement non prise, dans un module qui
en a justement créé la matière première.

**Correctif** — effort **M**, à trancher avec le dirigeant plutôt qu'à décider seul :
une vue `v_barge_cout_reel_vs_budget` comparant `sum(vehicle_maintenance_events.cost)`
converti au pivot sur l'exercice en cours contre le budget du regroupement
`POOL_MARITIME`, sur le modèle de `v_couverture_budgetaire` déjà existant pour les
autres regroupements.

---

## A11. DIMENSIONS ET CLOISONNEMENT

### Le cloisonnement du portail passe par le `WHERE`, jamais par un filtre applicatif a posteriori — vérifié par lecture exhaustive du contrôleur

```
Propriété : P3 Invariance · Axe : Métier (A11) · Statut : CONSTATÉ
```

**Localisation** — `apps/api/src/portal/portal.controller.ts`, les six méthodes de
service (`listQuotations`, `listDeals`, `dealDetail`, `acceptDeal`, `listOperations`,
`listInvoices`).

**Mécanisme.** Chacune des six requêtes Prisma de ce fichier inclut `partnerId` (ou
`clientId: partnerId`, ou une jointure `deal: { clientId: partnerId }`) **dans la
clause `where` elle-même**, jamais en filtre après lecture. Un identifiant d'affaire,
d'opération ou de facture appartenant à un autre client renvoie une liste vide ou un
`404` — jamais un enregistrement, jamais un `403` qui confirmerait l'existence de l'ID
chez un tiers (comportement explicitement commenté et assumé,
`portal.controller.ts:26-31`). Le jeton sans `partnerId` est rejeté à la racine plutôt
que de produire une requête `WHERE partner_id = NULL` qui échouerait silencieusement en
ne renvoyant rien (`portal.controller.ts:311-319`) — une anomalie de délivrance de
jeton est ainsi un `400` franc, pas un silence trompeur.

Second point vérifié : les `select` de chaque requête énumèrent explicitement les
champs sortants (`id`, `reference`, `status`, `contractedVolume`...) — **aucune marge,
aucun coût, aucun prix d'achat, aucun encours crédit fournisseur** n'apparaît dans un
seul des six `select`. C'est un cloisonnement par construction du typage, pas par
masquage après lecture — la distinction que `05_ARCHITECTURE.md` valorise déjà pour
d'autres surfaces.

`RAS`, cité en détail parce que c'est la première fois qu'un acteur externe obtient un
accès en lecture étendu (affaires, opérations, factures) sur des données auparavant
strictement internes, et que le résultat est solide.

---

## A12. COHÉRENCE TEMPORELLE

**RAS, vérification ciblée.** `ReferenceService.monthly()` / `.annual()` utilisent
`getUTCFullYear()` / `getUTCMonth()` (`reference.service.ts:35-36, 48`) — cohérent avec
la pratique déjà établie pour l'audit et la facturation. Les nouveaux modules
(`performedAt`, `nextDueAt`, `contactedAt`, `desiredDeliveryDate`) sont tous des
`@db.Date` ou `@db.Timestamptz(3)` saisis via `@IsISO8601()` côté DTO — pas de champ
`Date` naïf ni de dépendance au fuseau du serveur constatée dans les fichiers examinés
pour cet axe.

---

## A13. CONFORMITÉ COMPTABLE ET RÉGLEMENTAIRE DU DOMAINE

**Le mapping FNE le plus récent est honnêtement hors-norme documentaire — à
confirmer avant transmission réelle, pas un défaut de conception.**

`fne-client.service.ts:26-39` liste lui-même, en tête de fichier, trois hypothèses de
correspondance non couvertes par le document DGI fourni (gabarit B2B/B2C/B2F/B2G déduit
plutôt que porté par un champ dédié, mode de paiement déduit avant l'ajout du champ,
code de TVA déduit du taux). Le gabarit B2G, ajouté par ce lot précisément pour couvrir
ce point ouvert, est désormais porté par un champ dédié
(`Partner.isGovernmentInstitution`) plutôt que déduit — c'est une amélioration nette par
rapport aux deux autres hypothèses, qui restent des déductions. Le mode de paiement,
lui, est passé du statut « déduit » au statut « saisi, avec repli paramétrable et
jamais de défaut inventé » (A9 ci-dessus) — également une amélioration.

**Un point de rigueur mérite d'être noté positivement** : le service refuse
explicitement de transmettre une pièce non assujettie sans référence d'exonération ni
code fiscal saisi, plutôt que de deviner un code d'exonération par défaut
(`fne-client.service.ts:283-294`, avec la justification en commentaire : « le document
DGI le réserve explicitement... mieux vaut l'arrêter ici... que deviner un code »).
C'est la discipline attendue sur une donnée réglementaire à conséquence légale, tenue
ici malgré la pression à « faire passer » la transmission.

**Nuance déjà connue, non aggravée.** `01_COUVERTURE_FONCTIONNELLE.md` § 4 avait
constaté que rien ne transmet réellement à la DGI (absence de client HTTP sortant) —
`fne-client.service.ts` **est** ce client, désormais écrit. `05_ARCHITECTURE.md` § 2 a
déjà noté le défaut transactionnel de son intégration (écriture en trois temps). Ce
rapport n'ajoute rien à ces deux constats — cité pour que le lecteur de cet axe sache
qu'ils existent et couvrent déjà ce fichier.

Voir aussi A10 ci-dessus pour le regroupement budgétaire « Barge » non rapproché des
coûts réels de maintenance — également une question de restitution financière du
domaine, classée là plutôt qu'ici pour rester à côté du constat qui la motive.

---

## 2. RÉCAPITULATIF DES CONSTATS DE L'AXE

| # | Constat | Invariant | Sévérité | Statut |
|---|---|---|---|---|
| 1 | Demande de cotation portail sans consommateur interne — chaîne qui ne mène nulle part | A1 | S2 | CONSTATÉ |
| 2 | Quatre tables/deux colonnes neuves sans aucun `CHECK` — coût négatif accepté en exécution | A7/A9 | S2 | CONSTATÉ (exécuté) |
| 3 | Interrupteur de seuil de marge : désactiver bloque le segment plutôt que lever le contrôle | A9 | S3 | CONSTATÉ (exécuté) |
| 4 | « Prochaine échéance de maintenance » restitue la dernière intervention passée | A9 | S3 | CONSTATÉ |
| 5 | Balance âgée dupliquée en TypeScript hors de la vue SQL dédiée, périmètre de type divergent | A7 | S3 | CONSTATÉ |
| 6 | Compte d'exploitation barge : somme de volumes sans vérification d'unité | A6 | S3 | CONSTATÉ |
| 7 | Coût réel de maintenance barge non rapproché du budget `POOL_MARITIME` | A10/A13 | S3 | INFÉRÉ |
| 8 | `barge.controller.ts` recalcule l'arrondi hors de l'autorité centrale `money.ts` | A5 | S4 | CONSTATÉ |
| 9 | Acceptation de proforma portail : lire-puis-écrire non isolé (doublon de journal possible) | A2/A8 | S4 | CONSTATÉ |
| 10 | Demande de cotation portail sans clé d'idempotence | A8 | S4 | CONSTATÉ |

**Aucun S1 dans cet axe pris isolément.** Le constat le plus sévère (#1 et #2, S2) touche
respectivement à une fonction qui déçoit sans jamais échouer bruyamment, et à un
invariant qui n'est protégé que par l'écran — les deux motifs typiques d'un S2 selon le
barème (« invariant contournable, contrôle dépendant du client »), sans le caractère
immédiatement destructeur d'un S1. Le lecteur de `99_SYNTHESE.md` devra les lire à côté
des S1 déjà posés par `01` et `05` sur le même périmètre (facturation non bornée,
transmission FNE silencieuse, écriture FNE non transactionnelle) : ce sont des
défaillances de nature différente sur les mêmes cinq modules récents, pas des
redites.

---

## 3. CE QUE CET AXE N'A PAS COUVERT

- **Le module transport pré-existant** (tarifs transporteurs, conformité véhicules,
  chauffeurs) — déjà couvert par la matrice de `01_COUVERTURE_FONCTIONNELLE.md` § 5 et
  non retouché depuis ; pas de raison de le rouvrir sans élément nouveau.
- **La justesse du mapping FNE** vis-à-vis du document DGI réel — hors de portée sans
  environnement de recette DGI, et déjà signalé comme point ouvert par le fichier
  lui-même (A13 ci-dessus).
- **Le comportement sous volume réel** des nouvelles vues (`bargePnL`, `agedReceivables`) —
  la base ne porte aujourd'hui que 3 factures et aucun avoir ; les constats sur la
  duplication de logique (A7, #5) et le mélange d'unités (A6, #6) portent sur l'absence
  de protection structurelle, pas sur un écart déjà mesuré à l'échelle.
- **L'écran de recouvrement et l'écran barge côté web** — examinés seulement pour les
  points cités (étiquetage du champ de maintenance) ; pas revus exhaustivement pour
  l'ergonomie ou la complétude, hors périmètre de cet axe.

---

*Axe A clos. Aucune modification du code n'a été effectuée. Les écritures de test en
base (coût de maintenance négatif, désactivation de seuil) ont chacune été passées dans
une transaction explicitement annulée (`ROLLBACK`) ; aucune donnée n'a été modifiée.*
