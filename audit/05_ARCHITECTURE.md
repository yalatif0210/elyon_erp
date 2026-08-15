# 05 — ARCHITECTURE

Rappel du § 0 de `00_PERIMETRE.md` : **l'auditeur est l'auteur du code**. Cet axe est
particulièrement exposé au biais de justification qui y est décrit — chaque choix
architectural discutable est accompagné, dans le code, d'un commentaire qui l'explique.
Je m'en tiens autant que possible à ce qui est **exécutable et vérifié**, ou à défaut
à des chaînes de preuve croisées (schéma ↔ code ↔ vue SQL ↔ écran).

État du dépôt au moment de cet axe : **la comparaison avec les phases 0/1 n'est plus à
l'identique**. `git status` montre 18 fichiers modifiés et 12 non versionnés depuis le
dernier commit (`1ff842d`), dont l'intégralité des fichiers examinés dans cet axe —
`fne-client.service.ts`, `pdf.processor.ts`, `pdf-renderer.service.ts`,
`invoice-pdf.template.ts`, `collections.controller.ts`, `portal/`, `transport/`, et
cinq migrations Prisma. **Ce sont des développements postérieurs à `01_COUVERTURE_FONCTIONNELLE.md`**,
non encore audités. C'est précisément le périmètre que le dirigeant a signalé comme
prioritaire pour cet axe (facturation + FNE, génération PDF + scellement, file BullMQ
intra-processus).

---

## 0. LIMITES DÉCLARÉES

| # | Limite | Effet |
|---|---|---|
| L1 | **Volumétrie cible inconnue** (I2, `00_PERIMETRE.md`) | Le barème « performance à la volumétrie cible » est appliqué en **seuils de bascule**, pas en verdict définitif : je décris à partir de quel ordre de grandeur un mécanisme cesse d'être neutre. |
| L2 | **Couverture d'index non exhaustive** | Le schéma compte 70 tables et 92 relations. J'ai vérifié la couverture d'index sur les tables au cœur des flux examinés (`invoices`, `generated_documents`, `fne_transmissions`) et sur un échantillon des listes paginées ; je ne prétends pas avoir vérifié les 70 tables une à une. |
| L3 | **Comportement en production non observable** (I1) | Aucune configuration de production dans le dépôt. Les constats sur l'exploitabilité (journaux, mémoire, redémarrage) sont fondés sur la configuration Docker Compose fournie, faute de mieux — elle est présentée comme la cible par le README, mais rien ne garantit qu'elle sera déployée telle quelle. |
| L4 | **Pas d'exécution de charge** | Les constats de performance structurelle sont des lectures de requêtes et d'index, pas des mesures. Aucun profilage, aucun `EXPLAIN ANALYZE` sous charge. |

---

## 1. VERDICT DE L'AXE

> **La base de données tient ce que le code applicatif ne tient pas toujours.**
>
> Le parti pris architectural — invariants portés par PostgreSQL plutôt que par le
> code (79 `CHECK`, 192 clés étrangères, 54 déclencheurs, cf. `00_PERIMETRE.md` § 3) —
> est réel et démontré à l'exécution en phases 0 et 1. Mais il a une limite structurelle
> que le dépôt illustre deux fois dans son périmètre le plus récent : **une contrainte
> de base peut interdire une valeur invalide ; elle ne peut pas, par construction,
> imposer qu'une ligne existe dans une autre table si le processus applicatif s'arrête
> avant de l'écrire.** Les deux flux ajoutés depuis `01_COUVERTURE_FONCTIONNELLE.md` —
> facturation FNE et génération de PDF scellé — écrivent en plusieurs temps, hors
> transaction, sans ce filet. L'un des deux défauts rend même **aveugle le filet de
> rattrapage que l'audit précédent avait fait ajouter** pour l'autre problème qu'il
> corrigeait (§ 2, constat 1).
>
> Le reste de l'axe est plus favorable : schéma versionné et rejouable par un
> mécanisme compris et documenté, recette fonctionnelle versionnée et rejouable,
> conteneurs durcis, configuration invalide bloquée au démarrage. Les points faibles
> sont concentrés sur l'exploitabilité (journalisation de production réduite à
> `warn`/`error`, aucune CI) et sur la reprenabilité (carte du dépôt obsolète, script
> de migration à la correction fragile).

---

## 2. FRONTIÈRES TRANSACTIONNELLES

### [S2] L'émission d'une facture FNE écrit en trois temps non transactionnels, et le dernier peut manquer sans que rien ne le voie

```
Propriété    : P2 Intégrité · P4 Traçabilité
Axe          : Architecture
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/src/invoicing/invoices.controller.ts:414-479`

**Extrait** — trois appels Prisma successifs, non enveloppés dans `$transaction` :

```ts
const updated = await this.prisma.invoice.update({          // 435 — statut ISSUED
  where: { id },
  data: { status: InvoiceStatus.ISSUED, issueDate, ... },
});
...
if (invoice.type === InvoiceType.FNE || correctsFne) {
  await this.prisma.fneTransmission.upsert({ ... });          // 462 — trace du cycle fiscal
  try { await this.fneClient.certifySale(id, actorId); }       // 471 — transmission
  catch (e) { this.logger.warn(...); }
}
```

**Mécanisme.** L'émission d'une pièce FNE engage trois écritures séquentielles :
1. `invoice.status` passe à `ISSUED` (ligne 435) ;
2. une ligne `fne_transmissions` est créée ou mise à jour (ligne 462) ;
3. la certification est tentée (ligne 471), en `try/catch` — un échec ici est
   **prévu et couvert** : la pièce reste `PENDING_TRANSMISSION`, reprise plus tard
   par `retryFne()`.

Ce troisième cas est explicitement traité (`fne-client.service.ts:41-46` : « NE
BLOQUE JAMAIS L'ÉMISSION »). Le trou est **entre les deux premières écritures**. Si le
processus API s'arrête entre la ligne 435 et la ligne 462 — redéploiement, purge de
mémoire, panne — la facture reste `ISSUED`, de type `FNE`, **sans aucune ligne
`fne_transmissions`**. Ce n'est pas une hypothèse d'école : `PrismaService` ne pose
aucune transaction ambiante (`common/prisma/prisma.service.ts:12-27`, client Prisma nu),
et un redéploiement — habituel en petite équipe, sans fenêtre de maintenance dédiée —
interrompt par construction des requêtes en cours.

**Ce qui rend le défaut sévère : le filet de rattrapage ne peut pas le voir.**
`01_COUVERTURE_FONCTIONNELLE.md` § 4 avait fait ajouter une tâche `FNE_NON_TRANSMISE`
précisément pour qu'une FNE bloquée ne reste plus invisible. Sa requête :

```sql
-- apps/api/prisma/sql/22_file_de_taches.sql:382-386
FROM invoices i
JOIN fne_transmissions t ON t.invoice_id = i.id
WHERE i.type::text = 'FNE' AND i.issued_at IS NOT NULL
  AND t.status::text IN ('DRAFT','TO_VALIDATE','PENDING_TRANSMISSION','TO_CORRECT','REJECTED')
```

C'est une **jointure interne**. Une facture `ISSUED` sans ligne `fne_transmissions`
n'entre dans aucun des deux membres du JOIN — elle **n'apparaît dans aucune tâche**,
alors même que c'est exactement le cas que la tâche a été créée pour signaler. Une
contrainte de base (`CHECK`, `NOT NULL`, trigger) peut interdire une **valeur**
invalide ; elle ne peut pas, par construction, imposer qu'une **ligne existe** dans
une autre table si l'application ne l'a jamais écrite. C'est la limite structurelle du
modèle « invariants tenus par le moteur » que documente `00_PERIMETRE.md` § 3 —
invisible tant qu'on ne cherche pas spécifiquement une absence.

**Impact — scénario concret.** Une facture FNE de 15 000 000 XOF est émise juste avant
un redéploiement de l'API (mise à jour, correctif, changement de configuration). La
créance existe, opposable, numérotée. Le processus redémarre avant d'avoir écrit la
ligne `fne_transmissions`. La pièce reste indéfiniment `ISSUED`, invisible à la tâche
`FNE_NON_TRANSMISE`, invisible à `retryFne()` (qui exige une ligne `fneTransmission`
existante — `invoices.controller.ts:636-637`). Le seul moyen de la détecter est une
requête directe comparant `invoices` et `fne_transmissions` par anti-jointure — que
personne n'a de raison d'exécuter puisque la tâche est censée déjà le faire.
L'exposition fiscale est la même que celle décrite en `01_COUVERTURE_FONCTIONNELLE.md`
§ 4 (S1), mais **sans le filet que ce même rapport a fait ajouter**.

**Réserve d'honnêteté.** La fenêtre de risque est courte (quelques dizaines à
quelques centaines de millisecondes entre deux appels Prisma) et ne se déclenche que
sur une interruption de processus précisément à ce moment — pas sur un aléa de tous
les jours. C'est pour cela que je retiens **S2** et non **S1** : l'invariant est
contournable, mais par un mode de défaillance opérationnel improbable à chaque
occurrence, non par un utilisateur. La sévérité réelle dépend de la fréquence des
redéploiements en production — **inconnue (I1)**.

**Correctif** — effort **S** :
1. Enrober les deux premières écritures dans `this.prisma.$transaction([...])` : soit
   les deux existent, soit aucune.
2. Filet de sécurité indépendant de la présence de la ligne : une tâche
   `FNE_ORPHELINE` en anti-jointure (`invoices i LEFT JOIN fne_transmissions t ON
   t.invoice_id = i.id WHERE i.type = 'FNE' AND i.status != 'DRAFT' AND t.id IS NULL`),
   qui couvre par construction le cas qu'une jointure interne ne peut pas voir.

---

### [S2] La génération de PDF échoue en silence après épuisement des tentatives — aucune trace durable, aucune tâche, aucun signal

```
Propriété    : P2 Intégrité · P4 Traçabilité
Axe          : Architecture
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/src/documents/pdf.processor.ts:49-127`,
`apps/api/src/invoicing/invoices.controller.ts:153-170`,
`apps/api/src/documents/documents.controller.ts:192-225`

**Extrait** — l'enqueue, sans persistance du job :

```ts
// invoices.controller.ts:164-169
const job = await this.documentsQueue.add(
  'invoice',
  { type: 'invoice', invoiceId: id, actorId },
  { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
);
return { jobId: job.id! };   // ← jamais écrit nulle part ailleurs qu'ici
```

**Mécanisme.** La chaîne `render → storage.put → documents.register → documents.seal`
(`pdf.processor.ts:109-127`) tourne dans un worker BullMQ hébergé dans le même
processus API (`common/common.module.ts:29-31`, commentaire explicite : « le worker
tourne DANS ce même processus API »). Trois tentatives, backoff exponentiel. Au-delà,
BullMQ marque le job `failed` et s'arrête — **c'est un choix assumé et documenté**
(commentaire `pdf.processor.ts:27-33` : « une panne Chromium ne doit rien casser côté
facturation »), cohérent avec le traitement déjà fait pour la FNE.

Le problème n'est pas l'échec — il est prévu. C'est **l'absence de tout ce qui
permettrait de le découvrir après coup** :

1. Le schéma ne porte **aucune colonne** reliant une facture à son dernier job PDF
   (recherche exécutée sur `schema.prisma` : `jobId`, `pdfJobId` — 0 résultat). Le seul
   identifiant du job existe le temps de la réponse HTTP à l'enqueue.
2. Côté web, `invoice-actions.component.ts:422-459` interroge
   `GET /documents/jobs/:jobId` **en mémoire de composant**, avec un `setTimeout` de
   1,5 s tant que le job n'est pas terminé. Si l'utilisateur change d'écran, ferme
   l'onglet, ou revient le lendemain, ce suivi est perdu — rien ne le reprend.
3. `22_file_de_taches.sql` recherché pour tout terme lié au document ou au PDF :
   **aucune occurrence**. Contrairement à la FNE, la génération de document n'a **aucune
   tâche de secours**, même imparfaite.
4. `documents.register()` (`documents.controller.ts:192-225`) ne vérifie à aucun moment
   qu'un document du même genre existe déjà pour la facture avant d'en créer un
   nouveau — voir le constat suivant.

**Impact — scénario concret.** Un comptable émet une facture, clique « Générer le
PDF », voit « Génération… », puis passe à la facture suivante sans attendre la fin
(pratique courante avec plusieurs dizaines de pièces par jour). Le rendu Chromium
échoue trois fois de suite — navigateur qui redémarre pendant les essais, disque
temporaire saturé, page qui dépasse le délai `networkidle0`. La facture reste
`ISSUED`, engageante, sans document généré. **Rien ne le signale ni ce jour-là, ni
jamais** : ni écran, ni tâche, ni alerte — contrairement à la FNE, qui au moins expose
un statut persistant et une tâche (elle-même trouée par le constat précédent, mais
existante). Le seul moyen de s'en rendre compte est un client qui réclame sa facture
papier, ou un audit qui compare `invoices.status = 'ISSUED'` à l'absence de
`generated_documents.invoice_id` correspondant — comparaison qu'aucun écran ne fait
aujourd'hui.

**Correctif** — effort **S** :
1. Colonne `Invoice.lastPdfJobStatus` (ou table de suivi dédiée) mise à jour par le
   processeur lui-même à l'échec définitif (`job.attemptsMade >= job.opts.attempts`) —
   BullMQ expose un événement `failed` exploitable côté `QueueEvents`.
2. Tâche `PDF_NON_GENERE` sur le même modèle que `FNE_NON_TRANSMISE` : facture émise
   depuis plus de N heures sans document scellé correspondant.

---

### [S3] `GeneratedDocument` ne porte aucune contrainte d'unicité par facture — un job PDF rejoué après échec partiel crée un doublon, jamais un remplacement

```
Propriété    : P2 Intégrité
Axe          : Architecture
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/prisma/schema.prisma:3749-3796`

**Extrait** :

```prisma
invoiceId   String?    @map("invoice_id") @db.Uuid
invoice     Invoice?   @relation(fields: [invoiceId], references: [id], onDelete: SetNull)
...
@@index([kind, generatedAt])
@@index([dealId])
@@index([operationId])
```

**Mécanisme.** `invoiceId` ne porte ni `@unique`, ni `@@unique([invoiceId, kind])` — rien
n'empêche deux `GeneratedDocument` de type `INVOICE` de référencer la même facture.
`DocumentsService.register()` (`documents.controller.ts:192-225`) ne recherche pas
d'existant avant de créer : chaque appel produit une nouvelle référence
(`this.reference.annual(...)`), une nouvelle clé de stockage et un nouveau jeton
d'authenticité.

Rapproché du constat précédent : si `register()` réussit mais que `seal()` échoue
juste après (ligne 123, ex. perte de connexion base au mauvais moment), le job échoue
et BullMQ le retente. Le nouvel essai **régénère le PDF depuis zéro** — nouveau jeton
QR (`randomBytes(24)` régénéré à chaque passage, `pdf.processor.ts:75`), donc nouveau
contenu, donc nouvelle clé de stockage adressée par contenu (`storage.service.ts:71-96`,
qui déduplique par SHA-256 mais ne peut rien dédupliquer entre deux contenus
distincts) — et un **second appel à `register()`**, créant un second
`GeneratedDocument` non scellé pour la même facture. Le premier reste orphelin,
non scellé, jamais nettoyé.

**Ce que la base montre.** Aucune preuve d'occurrence réelle — le mécanisme est trop
récent (non versionné) pour avoir été observé en usage. Le constat porte sur
l'**absence de protection**, pas sur un doublon déjà produit.

**Impact.** À la marge, tant que le volume de génération PDF reste faible : un
document orphelin de plus dans la liste, sans conséquence financière directe. Le
risque grandit avec le volume de pièces émises et la fréquence des pannes Chromium
(§ 8) : chaque échec partiel laisse une trace morte, et une facture peut in fine
porter plusieurs « originaux » non scellés sans qu'aucun signal ne le distingue d'un
usage normal (une facture peut légitimement avoir plusieurs documents — proforma,
facture, avoir).

**Correctif** — effort **S** : `@@unique([invoiceId, kind])` filtré sur les documents
non remplacés (`supersedesId IS NULL` — un index partiel, la contrainte pleine
casserait la mécanique « annule et remplace »), ou plus simplement faire de
`documents.register()` un upsert conditionné à l'absence de document non scellé
existant pour la paire (facture, genre).

---

### Ce qui, à l'inverse, est protégé correctement — et pourquoi le contraste compte

`RAS` sur ce point précis, à titre de contrôle : le dépôt sait faire des frontières
transactionnelles tenues quand l'invariant est une **valeur**, pas une **existence**.
`01_COUVERTURE_FONCTIONNELLE.md` § 7 documente et a fait corriger l'encaissement
concurrent par un déclencheur qui dérive le solde du journal — la course se referme au
moteur, pas en application. `supplier-invoices.controller.ts:229` enveloppe
paiement et mise à jour de solde dans `$transaction`. Le volume facturé est borné par
un déclencheur qui recalcule la somme à chaque écriture
(`30_facturation_bornee.sql`, déjà cité en 01). Ces trois cas ont un point commun :
la base peut **relire et recalculer** une somme à chaque écriture et refuser si elle
dépasse un seuil. Elle ne peut pas, en revanche, **constater qu'une écriture attendue
n'a pas eu lieu** — c'est la nature du défaut des deux constats ci-dessus, et la
raison pour laquelle il a survécu à une remédiation par ailleurs soignée.

---

## 3. SCHÉMA ET MIGRATIONS

`RAS`, sous les réserves suivantes.

**Mécanisme constaté.** Le schéma est versionné et rejouable, jamais généré
automatiquement (`00_PERIMETRE.md` § 2.4, confirmé). Le SQL métier
(`prisma/sql/*.sql` — 79 `CHECK`, 54 déclencheurs, 38 vues) est injecté dans chaque
migration par `apps/api/scripts/prepare-migrations.mjs`, dont l'en-tête
(`prepare-migrations.mjs:1-30`) explique correctement le problème qu'il résout : sans
injection, `prisma migrate dev` compare la base réelle à l'historique rejouable, ne
trouve pas les objets non-Prisma, et propose une réinitialisation destructrice. La
mécanique est comprise, documentée dans le script lui-même **et** dans `README.md`
§ « Faire évoluer le schéma » — rare doublon utile.

**Point d'attention non couvert par un constat formel.** La justesse du mécanisme
dépend d'une **liste ordonnée à la main** de 32 fichiers SQL
(`prepare-migrations.mjs:43-103`), avec des dépendances d'ordre explicitées en
commentaire ligne à ligne (« AVANT 25, qui les lit » — ligne 70 — etc.). C'est
fonctionnel et actuellement cohérent, mais c'est aussi le point unique de défaillance
de toute évolution future du schéma : un nouveau fichier SQL métier mal positionné
dans `SQL_FILES` échoue silencieusement au niveau applicatif (une vue ou une fonction
manquante ne casse pas la migration elle-même si l'ordre SQL reste syntaxiquement
valide) et ne se découvre qu'à l'usage. Aucun test n'exerce l'ordre de `SQL_FILES`
lui-même. Rattaché à la reprenabilité, § 9.

---

## 4. INTÉGRITÉ AU NIVEAU DE LA BASE

`RAS` pour l'essentiel — repris et non redémontré ici : `00_PERIMETRE.md` § 3 et
`01_COUVERTURE_FONCTIONNELLE.md` établissent déjà, par exécution, que les invariants
critiques (facturation bornée, encaissement dérivé, audit append-only, séparation de
rôles PostgreSQL `erp_migrator`/`erp_app`) sont tenus par le moteur et testés par
tentative de contournement — pas seulement lus.

**Un ajout net à ce constat, propre à cet axe** : la lacune d'unicité sur
`GeneratedDocument.invoiceId` (§ 2, troisième constat) est la seule brèche identifiée
dans ce périmètre. Elle confirme la règle plutôt qu'elle ne la contredit : partout où
un constat de `01` a exigé une contrainte, elle a été posée et vérifiée à l'exécution ;
le module documentaire, plus récent et non encore soumis au même traitement, ne l'a
pas encore reçue.

---

## 5. PERFORMANCE STRUCTURELLE

Évaluée, comme demandé, à la volumétrie **cible** — non observable (L1) — donc en
seuils de bascule plutôt qu'en verdict.

### [S3] La file de tâches recalcule une vue à vingt branches à chaque navigation, pour chaque utilisateur, sans mise en cache

```
Propriété    : P5 Restitution
Axe          : Architecture
Statut       : CONSTATÉ, sévérité dépendante de l'inconnue I2
```

**Localisation** — `apps/api/prisma/sql/22_file_de_taches.sql:35` (`CREATE OR REPLACE
VIEW v_taches`), `apps/api/src/supervision/supervision.controller.ts:27-32`,
`apps/web/src/app/features/shell.component.ts:266-278`

**Extrait** — la vue est un `UNION ALL` d'une vingtaine de requêtes, chacune sur une
table métier différente (affaires en attente, checklists HSE, prix fournisseurs,
conformité, créances échues, FNE non transmises, etc.) ; elle est relue à chaque
navigation applicative :

```ts
// shell.component.ts:268-278
// On relit donc à chaque navigation ACHEVÉE. Ce n'est pas un rafraîchissement
// périodique...
this.router.events.pipe(filter(...)).subscribe(() => this.relireCompteur());
```

**Mécanisme.** Chaque `GET /supervision/taches` ou `/taches/compteur` exécute
l'intégralité des ~20 branches de `v_taches` (`supervision.controller.ts:29,58` —
`$queryRaw` direct sur la vue, sans filtre de date ni de volume en amont d'un grand
nombre de branches). Le déclenchement n'est **pas un scrutateur périodique** — c'est un
choix explicite et documenté (« une pastille qui bouge toute seule attire l'œil sans
rien apprendre », `shell.component.ts:270-271`) — mais reste lié à chaque changement
d'écran, ce qui, dans un usage normal d'ERP (un utilisateur qui navigue en continu),
reste fréquent. Aucune des deux routes n'est mise en cache, ni bornée par une limite
de résultats sur la liste complète (`taches()`, ligne 27, retourne toutes les lignes
correspondant au rôle, sans pagination).

**Seuil de bascule.** Chaque branche individuelle s'appuie en général sur une colonne
de statut indexée (`status`, `type` — cf. § 4), donc rapide isolément à faible volume.
Le risque n'est pas une branche lente, c'est leur **multiplication** : vingt requêtes
séquentielles dans une même vue, exécutées à chaque navigation, par chaque utilisateur
connecté. À quelques dizaines d'utilisateurs actifs et un catalogue de références en
milliers de lignes (hypothèse H2, non confirmée), le coût cumulé sur le pool de
connexions (10 connexions, § 5 ci-dessous) devient mesurable ; à la centaine
d'utilisateurs ou au million de lignes historiques, il ne l'est plus seulement, il
devient visible pour l'utilisateur.

**Impact.** Non chiffrable sans I2. Le signal d'alerte concret : si le temps de
réponse de `/taches/compteur` — appelé à **chaque** clic de menu — dépasse
quelques centaines de millisecondes, l'ERP entier semble lent, pas seulement l'écran
des tâches.

**Correctif** — effort **M** : matérialiser `v_taches` (vue matérialisée rafraîchie
par déclencheur ou tâche planifiée) ou plafonner `/taches/compteur` par un cache court
(quelques secondes) côté service — le compteur n'a pas besoin d'exactitude à la
seconde près pour rester utile.

### [S4] Résolution de barème coût par coût, en parallèle plutôt qu'en un aller-retour

**Localisation** — `apps/api/src/sales/deals.controller.ts:759-768`

```ts
const materialised = await Promise.all(
  lines.map((l) => this.materialise(l, deal, Number(deal.contractedVolume))),
);
```

`materialise()` interroge `resolveStandard()` (un `findFirst` sur le barème) une fois
par ligne de coût, en parallèle. Pour une affaire à N lignes, ce sont N requêtes
concurrentes sur un pool limité à 10 connexions
(`docker-compose.yml:128` — `connection_limit=10`). Sans conséquence aux volumes de
lignes observés (quelques unités à quelques dizaines par affaire) ; à surveiller si le
nombre de postes de coût standard augmente sensiblement, ou si plusieurs affaires sont
sauvegardées simultanément par des commerciaux différents. `INFÉRÉ` — non mesuré.
Correctif (effort **S**, non urgent) : une requête `findMany` unique par lot de lignes,
résolue en mémoire.

### Le reste : `RAS`

Les listes paginées examinées (`invoices`, `deals`, `documents`, `supplier-invoices`,
`operations`, `partners`, `portal/*`) utilisent systématiquement `skip`/`take` avec un
`count` séparé (ex. `invoices.controller.ts:182-195`), et les tables les plus
consultées (`Invoice`, `Deal`) portent des index composites alignés sur les filtres de
liste réellement utilisés (`@@index([dealId, type])`, `@@index([partnerId, status])`,
`@@index([dueDate, status])` — `schema.prisma:3523-3526`). Les listes de référentiels
non paginées (devises, produits, sites, gabarits HSE, barèmes de marge) portent sur des
tables à cardinalité bornée par nature (dizaines de lignes), à l'exception des tables à
effet temporel (`FxRate`, `AbsorptionRate`, `AdministeredPrice`) qui filtrent
explicitement sur la période en vigueur — croissance contenue par construction, pas
par un plafond arbitraire.

---

## 6. INTERFACES ET INTÉGRATIONS

### [S4] Aucun versionnement d'API — trois réalms, zéro préfixe de version

**Localisation** — préfixes observés dans tous les contrôleurs : `api/internal/*`,
`api/field/*`, `api/portal/*` (ex. `invoices.controller.ts:782`,
`documents.controller.ts:632`). Aucun `v1`/`v2`.

**Mécanisme.** Le réalm sert de segmentation, pas la version. Sans conséquence tant
que le seul consommateur du réalm `portal` est le front Angular du même dépôt
(`H1` — pas de client externe réel aujourd'hui). Devient pertinent le jour où
`api/portal/*` sert un vrai client B2B externe (objectif déclaré du § 13 module 0,
`01_COUVERTURE_FONCTIONNELLE.md`) : un changement de contrat cassant sur cette
surface, sans version, casse un intégrateur tiers sans préavis possible. `INFÉRÉ` du
modèle de routage — pas un défaut aujourd'hui, une dette à anticiper avant l'ouverture
du portail à un vrai client.

**Correctif** — effort **S**, à faire **avant** l'ouverture externe du portail : préfixer
`api/portal/*` par une version explicite.

### La FNE, un contre-exemple positif à signaler

Le client `FneClientService` mérite d'être cité en axe D pour la qualité de son
schéma de reprise, indépendamment du défaut transactionnel du § 2 : distinction
explicite entre échec « à corriger » (HTTP 400 → `TO_CORRECT`, ne se rejoue pas tel
quel) et échec transitoire (réseau, 401, 5xx → reste `PENDING_TRANSMISSION`, rejouable
sans changement — `fne-client.service.ts:397-416`) ; archivage complet des échanges
(`requestPayload`/`responsePayload`) ; point d'entrée de reprise manuelle exposé et
protégé par rôle (`retryFne`). C'est le comportement qu'on attend d'une intégration
vers un tiers dont on ne contrôle ni la disponibilité ni le contrat — la lacune n'est
pas dans cette logique, elle est dans l'écriture qui la précède (§ 2).

### Idempotence des opérations sensibles — état hétérogène

`RAS` pour l'encaissement client et fournisseur (dérivés par déclencheur, § 2 in fine).
**Non couvert** pour la création de facture (`POST /invoices`) : un rejeu réseau d'une
requête de création (double clic, retry client sur timeout) crée deux brouillons
distincts — sans impact financier direct puisqu'un brouillon n'engage rien et
qu'aucune des deux pièces n'est FNE ou opposable tant qu'elle n'est pas émise, mais la
liste des factures affiche deux lignes identiques que quelqu'un doit repérer et
purger. `CONSTATÉ` par lecture — aucune clé d'idempotence sur la route
(`invoices.controller.ts:812-816`). Sévérité **S4** : gênant, pas dangereux, la pièce
reste au brouillon jusqu'à action humaine explicite.

---

## 7. TESTS

### [S3] La recette est versionnée et rejouable — mais hors CI, et le point d'entrée conventionnel du dépôt (`npm test`) ne l'exécute pas

```
Propriété    : (transverse — condition de non-régression pour P1 à P5)
Axe          : Architecture
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/package.json:21-22`, `tests/recette/executer.py:1-52`

**Extrait** :

```json
"test": "jest",
"test:invariants": "jest --testPathPattern=invariants"
```

**Mécanisme.** Progrès net depuis `00_PERIMETRE.md` § 5 : la recette (9 suites, 194
cas au dernier relevé de `01_COUVERTURE_FONCTIONNELLE.md` § 9.4) est désormais
**versionnée** (`git ls-files tests/` la confirme trackée) et **rejouable** sans
intervention manuelle (`nettoyage.sql` réinitialise l'état avant chaque campagne,
documenté et vérifié en `01` § 9.2c). Elle appelle l'API par HTTP réel, avec des
comptes de rôle réels — pas par accès direct à la base — ce qui la fait porter sur les
invariants **tels qu'un utilisateur les rencontre**, pas tels qu'ils sont écrits.
C'est la bonne méthode.

Deux réserves subsistent :

1. **Aucune intégration continue.** Recherche de `.github/workflows/`, de toute autre
   configuration CI au dépôt : aucun résultat. Rien n'empêche une régression d'un
   invariant testé par la recette d'être commise sans que quiconque relance
   `python tests/recette/executer.py` — un geste manuel, qui suppose de savoir qu'il
   existe et que la pile tourne en local sur `localhost:4200`.
2. **`npm test` ne fait pas ce qu'il annonce.** Le point d'entrée standard d'un projet
   Node — celui qu'un développeur tiers essaiera en premier par réflexe — lance Jest.
   Aucun fichier `*.spec.ts` n'existe dans le dépôt (`00_PERIMETRE.md` § 5, confirmé
   inchangé : recherche répétée à zéro résultat). `npm test` échoue donc
   systématiquement (« no tests found »), sur un projet où les tests réels existent et
   passent, mais ailleurs et autrement. Ce n'est pas anodin : c'est le signal exact
   inverse de celui voulu — un développeur qui fait confiance à la convention conclut
   que le projet n'a pas de tests fonctionnels, alors qu'il en a 194.

**Impact.** Aucune barrière automatique n'empêche une régression de fusionner. Le
filet existe, il est même de bonne facture, mais il dépend d'un geste humain
discipliné et d'une pile locale démarrée — pas d'un pipeline.

**Correctif** — effort **S** pour la partie visible, **M** pour la CI complète :
1. Remplacer ou compléter le script `test` de `package.json` par un appel qui reflète
   la réalité (au minimum, un message clair renvoyant vers `tests/recette/`, sinon un
   script npm qui invoque `python tests/recette/executer.py`).
2. Un pipeline CI minimal : `docker compose up`, migration, recette, sortie non-nulle
   bloquante — la recette est déjà conçue pour ça (« exploitable en intégration
   continue sans adaptation », `executer.py:20-21`), il ne manque que le déclencheur.

---

## 8. EXPLOITABILITÉ

### [S3] La journalisation applicative de production est réduite à `warn`/`error` — les événements métier significatifs n'atteignent jamais les journaux

```
Propriété    : P4 Traçabilité (opérationnelle, distincte du journal d'audit métier)
Axe          : Architecture
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/src/main.ts:29-33`

**Extrait** :

```ts
const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  // Les traces d'erreur ne fuitent jamais côté client en production.
  logger: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : undefined,
});
```

**Mécanisme.** En production, seuls les niveaux `warn` et `error` sont activés sur le
logger Nest — les appels `this.logger.log(...)`, dispersés dans le code pour tracer
les événements métier normaux (ex. `pdf.processor.ts:125` : « PDF généré et scellé »),
ne sont **pas différés ni filtrés a posteriori, ils ne s'exécutent tout simplement
pas** — c'est le comportement standard du logger Nest configuré par niveaux. Aucune
bibliothèque de journalisation structurée (Pino, Winston) n'est en dépendance
(`package.json` : aucune des deux). Pas de format JSON, pas d'identifiant de
corrélation de requête, pas de configuration d'expédition vers un collecteur externe
dans le dépôt.

**Ce qui reste tracé malgré tout** : le journal d'audit métier (`audit_logs`, table en
base, append-only — `README.md` § « Ce qui est garanti par la base ») capture les
écritures engageantes avec avant/après. Il ne capture pas les événements
d'infrastructure (génération PDF réussie, tentative FNE, job BullMQ démarré) qui ne
correspondent à aucune écriture d'entité auditée.

**Impact.** En exploitation réelle, un opérateur qui cherche à comprendre *pourquoi*
une facture n'a pas de PDF (§ 2) n'a accès, dans les journaux de production, à
**aucune trace de la tentative** — ni son déclenchement, ni son déroulement, seulement
un éventuel `warn`/`error` si le code a jugé bon d'en émettre un à cet endroit précis
(ce qui n'est pas le cas du succès, par construction). Le diagnostic retombe sur des
requêtes SQL manuelles.

**Correctif** — effort **S** : relever le niveau à `['log', 'warn', 'error']` en
production a minima, ou introduire un logger structuré avec identifiant de corrélation
par requête si l'exploitation doit un jour s'appuyer sur un collecteur centralisé.

### Sonde de vivacité : `RAS`

`health.controller.ts:20-29` vérifie base et Redis avant de répondre `200`, sans
détail technique exposé côté client — conforme à la bonne pratique, et déjà exploité
par le `HEALTHCHECK` Docker (`api.Dockerfile:82-83`) et par `depends_on: condition:
service_healthy` en cascade (`docker-compose.yml:152-156, 179-181`).

### Configuration : fail-fast au démarrage, `RAS`

`env.config.ts:58-72` : toute variable d'environnement absente ou hors gabarit fait
échouer le démarrage avec un message explicite, plutôt que de dégrader silencieusement
(ex. un secret JWT vide accepterait toutes les signatures — commentaire du fichier
lui-même, ligne 9-10). C'est le comportement recherché.

### [S3] Le worker de génération PDF partage le budget mémoire fixe du conteneur API — une panne Chromium peut interrompre tout le trafic, pas seulement la génération de documents

```
Propriété    : (disponibilité — non rattachée à P1-P5, mais à l'objet même du système)
Axe          : Architecture
Statut       : CONSTATÉ, choix explicitement assumé dans le code
```

**Localisation** — `apps/api/src/common/common.module.ts:29-31`,
`docker-compose.yml:157-161`, `apps/api/src/documents/pdf-renderer.service.ts:1-94`

**Extrait** :

```ts
// common.module.ts:29-31
// File de jobs asynchrones (§ 1.1) — le worker tourne DANS ce même processus
// API : le monolithe modulaire (§ 1.2) n'a pas de second déployable à faire
// vivre pour autant.
```

```yaml
# docker-compose.yml:157-161 (service api)
deploy:
  resources:
    limits:
      cpus: "2.0"
      memory: 768M
```

**Mécanisme.** Le worker BullMQ qui consomme la file `documents` vit dans le même
processus Node, donc le même conteneur, donc le même plafond mémoire que le serveur
HTTP qui traite l'authentification, la facturation et toutes les autres routes. Ce
conteneur héberge en plus un navigateur Chromium persistant
(`pdf-renderer.service.ts:16-36` — « un seul navigateur partagé »), lancé une fois et
gardé en vie entre les jobs. Le choix est **explicitement assumé** : un seul
déployable, cohérent avec le monolithe modulaire revendiqué. La concurrence du worker
n'est pas configurée (`@Processor('documents')` sans option — un seul job traité à la
fois, ce qui limite le risque de pic simultané), ce qui atténue partiellement le
risque.

Il reste que Chromium est un processus notoirement gourmand et sujet aux fuites sur
des rendus répétés, et que le code lui-même prévoit son crash (« Le navigateur a
crashé ou s'est déconnecté entre deux jobs », `pdf-renderer.service.ts:30-33`) sans
prévoir de plafond mémoire qui lui soit propre. Si le processus Node entier est tué
par le limiteur mémoire du conteneur (`memory: 768M`, imposé par `cgroup`, pas
seulement recommandé) pendant un rendu PDF trop lourd, **tout le conteneur redémarre**
(`restart: unless-stopped`) — pas seulement le job en cause. Toute requête HTTP en
cours au même instant — connexion, création de facture, saisie terrain — est
interrompue.

**Impact — scénario concret.** Une facture inhabituellement chargée (texte long dans
un champ, image de signature volumineuse via le QR) fait grimper la mémoire de
Chromium au moment où plusieurs utilisateurs travaillent en simultané sur la console.
Le conteneur atteint son plafond, l'OOM killer du noyau (ou Docker) arrête le
processus, `restart: unless-stopped` relance le conteneur en quelques secondes — during
lesquelles toute la console est indisponible, pas seulement l'export PDF.

**Évaluation de la sévérité.** Je retiens **S3**, pas plus, pour trois raisons : le
choix est documenté et volontaire, pas un oubli ; la concurrence du worker est limitée
à un job à la fois ; et à l'échelle déclarée (H2 — VPS unique, quelques dizaines
d'utilisateurs), la probabilité d'un pic mémoire fatal reste modérée. Le point mérite
néanmoins d'être tranché avant une croissance de volume : c'est le genre de couplage
qui reste invisible jusqu'au jour où il ne l'est plus.

**Correctif** — effort **M** : soit un plafond mémoire dédié au processus Chromium
(`--max-old-space-size` ne s'applique pas à Chromium lui-même, mais un
`ulimit`/cgroup enfant ou un redémarrage préventif du navigateur toutes les N pages
limiterait la dérive), soit — si le volume de PDF croît — sortir le worker dans un
service séparé, ce qui redevient cohérent avec l'esprit « pas de second déployable »
seulement tant que le premier reste petit.

### Reprise de service et sauvegarde : `NON VÉRIFIABLE`, déjà signalé

Repris de `00_PERIMETRE.md` I4, non contredit ni confirmé par cet axe : aucune
procédure de sauvegarde, de restauration testée, ni de reprise de service documentée
dans le dépôt. Le volume `postgres_data` et `api_uploads` (photos, signatures — le
commentaire `docker-compose.yml:35-39` le rappelle lui-même) ne sont couverts par
aucun plan visible.

---

## 9. REPRENABILITÉ

### [S3] La carte du dépôt publiée dans `README.md` décrit une fraction du système réel

```
Propriété    : (risque d'entreprise — hors P1-P5, traité comme tel par consigne du prompt § 10)
Axe          : Architecture
Statut       : CONSTATÉ
```

**Localisation** — `README.md:62-95` (section « Arborescence ») comparée à
`apps/api/src/app.module.ts:103-127` (liste réelle des contrôleurs).

**Extrait** — ce que `README.md` décrit sous `apps/api/src/` :

```
└── src/
    ├── common/            Config, Prisma, Redis, crypto, audit, guards, filtres
    ├── auth/              Trois réalms : interne, portail, terrain
    ├── referentials/      Référentiels et conformité
    └── admin/             Registre des dérogations
```

**Mécanisme.** `AppModule` déclare 22 contrôleurs répartis sur 16 modules
(`app.module.ts:103-127`) : `invoicing`, `sales`, `operations`, `hse`, `field`,
`documents`, `crm`, `supervision`, `portal`, `transport` en plus des quatre listés par
le README. Le fichier lui-même annonce « 32 modèles (lot 1) » (`README.md:77`) quand
le schéma en compte 68 (`00_PERIMETRE.md` § 2.1). Ce n'est pas une erreur — c'est un
document écrit à un instant du projet (le lot 1) et jamais mis à jour au fil des lots
suivants. Le tableau « État d'avancement » en tête de fichier (`README.md:10-18`), lui,
est à jour.

**Impact.** Un développeur tiers qui suit la section « Arborescence » comme guide
d'orientation — c'est sa fonction déclarée — se forme une carte couvrant environ un
quart du système réel. Le risque n'est pas l'absence d'information : c'est une
information **incomplète présentée comme complète**, qui coûte plus cher à corriger en
confiance qu'une absence déclarée.

**Correctif** — effort **S** : régénérer la section à partir de la liste réelle des
modules (`app.module.ts` en fait foi), ou la remplacer par un renvoi vers ce fichier
plutôt que de dupliquer une liste qui se périme.

### Dépendance à une personne unique — confirmé, non aggravé

`00_PERIMETRE.md` § 0 et § 4 avaient déjà établi le conflit d'intérêt (auditeur =
auteur) et le fait que l'historique Git ne portait, à l'époque, que deux commits.
L'état courant : **16 commits**, deux identités d'auteur distinctes dans
`git log` (`Maintenance ADMINISTRATEUR <ma.admin@npsp.ci>` et
`unknown <raisdeb07@gmail.com>`) dont le style d'écriture des messages (première
personne, ton continu d'une session à l'autre) ne permet pas d'exclure qu'il s'agisse
de la même personne sous deux configurations Git. `INFÉRÉ` — je ne peux pas trancher
au-delà de cette observation sans information externe au dépôt.

**Ce qui atténue, sans compenser entièrement** : la densité inhabituelle de
commentaires explicatifs dans le code source lui-même — chaque choix non trivial
rencontré durant cet axe (mécanisme d'injection SQL, partage de processus du worker
PDF, dérivation du solde encaissé, choix du navigateur Alpine plutôt que celui de
Puppeteer) est accompagné d'un paragraphe expliquant le **pourquoi**, pas seulement le
quoi. S'y ajoutent trois documents d'audit antérieurs à la racine du dépôt
(`AUTO_AUDIT_ADVERSARIAL.md`, `CONTRE_AUDIT_OBLIGATOIRE.md`,
`CORRECTION_APRES_AUDIT_ADVERSARIAL.md` — 1 673 lignes cumulées), qui constituent une
trace écrite de décisions et de corrections antérieures. Un successeur dispose donc
d'une matière de reprise supérieure à la moyenne pour un dépôt à auteur unique — ce
qui réduit le risque sans l'annuler : la matière existe, mais rien ne garantit qu'un
successeur la lise avant de modifier le système, et elle reste dispersée en cinq
fichiers racine plus les commentaires de code, sans point d'entrée unique.

### Fragilité du script de migration — reprise en § 3

Le bus-factor le plus concret de cet axe est celui déjà signalé § 3 : la correction du
schéma dépend d'un ordre manuel de 32 fichiers SQL dans
`prepare-migrations.mjs:43-103`, dont la logique n'est vérifiée par aucun test
automatisé. Un successeur qui ajoute un fichier SQL métier sans lire l'en-tête du
script (qui, à sa décharge, est explicite) peut casser une migration future de façon
non immédiatement visible.

---

## 10. RÉCAPITULATIF DES CONSTATS DE L'AXE

| # | Constat | Sévérité | Propriété | Statut |
|---|---|---|---|---|
| 1 | Émission FNE en trois écritures non transactionnelles, invisible au filet de rattrapage | S2 | P2 · P4 | CONSTATÉ |
| 2 | Échec définitif de génération PDF sans trace durable ni tâche | S2 | P2 · P4 | CONSTATÉ |
| 3 | `GeneratedDocument` sans unicité par facture — doublons possibles au rejeu | S3 | P2 | CONSTATÉ |
| 4 | `v_taches` recalculée intégralement à chaque navigation, sans cache | S3 | P5 | CONSTATÉ (sévérité liée à I2) |
| 5 | Résolution de barème en N requêtes parallèles par affaire | S4 | — | INFÉRÉ |
| 6 | Aucun versionnement d'API sur le réalm portail | S4 | — | INFÉRÉ |
| 7 | Pas d'idempotence sur la création de facture (brouillon) | S4 | — | CONSTATÉ |
| 8 | Recette hors CI ; `npm test` ne reflète pas les tests réels | S3 | — | CONSTATÉ |
| 9 | Journalisation de production réduite à `warn`/`error` | S3 | P4 | CONSTATÉ |
| 10 | Worker PDF/Chromium partage le budget mémoire du conteneur API | S3 | — | CONSTATÉ |
| 11 | Carte du dépôt (`README.md`) obsolète face au code réel | S3 | — | CONSTATÉ |

Aucun **S1** dans cet axe pris isolément — nuance importante : les constats 1 et 2
touchent à des flux (FNE, facturation) où `01_COUVERTURE_FONCTIONNELLE.md` a déjà posé
des S1 sur d'autres facettes du même périmètre. Le lecteur de `99_SYNTHESE.md` devra
lire les deux rapports ensemble pour juger l'exposition cumulée de la chaîne
facturation → FNE → document.

---

## 11. CE QUE CET AXE N'A PAS COUVERT

- **Mesure de charge réelle.** Tous les constats de performance sont des lectures de
  requêtes et d'index, pas des `EXPLAIN ANALYZE` sous volume, faute d'un jeu de
  données à la volumétrie cible (I2).
- **Couverture d'index exhaustive.** Vérifiée sur les tables au centre de cet axe, pas
  sur les 70 tables du schéma une à une (L2).
- **Comportement en production réelle** — журналы, mémoire sous charge réelle,
  fréquence effective des redéploiements qui conditionne la sévérité réelle du
  constat 1 (I1, tranché plus haut).
- **Le contenu des trois documents d'audit antérieurs** (`AUTO_AUDIT_ADVERSARIAL.md`,
  `CONTRE_AUDIT_OBLIGATOIRE.md`, `CORRECTION_APRES_AUDIT_ADVERSARIAL.md`) n'a pas été
  relu en détail : ils sont cités comme preuve de traçabilité documentaire (§ 9), pas
  comme source de constats supplémentaires — un examen dédié pourrait révéler des
  redites ou des contradictions avec le présent rapport.

---

*Axe D clos. Aucune modification du code n'a été effectuée ; seule l'écriture de ce
fichier a eu lieu. Les recherches exécutées (`grep`, lecture de schéma, `git log`)
n'ont modifié aucun état.*
