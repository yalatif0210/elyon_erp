# 01 — COUVERTURE FONCTIONNELLE

Rappel du § 0 de `00_PERIMETRE.md` : **l'auditeur est l'auteur du code**. Les constats de ce
rapport sont, autant que possible, appuyés sur une **preuve exécutée** — requête lancée,
transaction annulée, appel observé — et non sur une lecture.

---

## 1. VERDICT DE PHASE 1

> **Le cycle métier principal se déroule de bout en bout, mais son dernier maillon
> n'est borné par rien.**
>
> La chaîne Contrat → Affaire → Opération → Facture → Encaissement s'enchaîne sans
> ressaisie et sans sortie de l'outil. Elle ne casse pas. **Ce qui manque, ce n'est pas la
> continuité — c'est le contrôle à l'endroit où l'engagement devient une créance.**
>
> Un second point, la transmission fiscale, est arrêté par une dépendance externe assumée
> — l'API DGI, que le dirigeant doit communiquer. Le défaut n'y est pas l'absence de
> transmission : c'est que **rien ne signale l'attente**.

> ⚠️ **Cette formulation corrige la première version de ce rapport.** J'y concluais que la
> chaîne cassait à la facturation, parce que je cherchais un rattachement au volume
> **livré**. Le modèle d'Elyon ne fonctionne pas ainsi — le volume commandé est le volume
> livré, et la facture n'attend pas l'exécution. Le détail de cette correction est au § 3.

---

## 2. LE CYCLE PRINCIPAL, DÉROULÉ DANS LE CODE

Cycle du domaine : **Contrat → Affaire → Opération → Exécution terrain → Facturation →
Encaissement**.

| # | Étape | État | Preuve |
|---|---|---|---|
| 1 | Contrat-cadre | ✅ | `registry.ts` réf. `contracts` |
| 2 | Affaire chiffrée, marge calculée | ✅ | `sales/margin.service.ts` |
| 3 | Verrou de marge (plancher direct + seuil) | ✅ | `05_lot2_invariants.sql` |
| 4 | Verrou de crédit | ✅ | `19_verrou_credit.sql` |
| 5 | Approbation CFO puis DG | ✅ | `deals.controller.ts` |
| 6 | Opération créée, types affectés | ✅ | `10_types_operation.sql` |
| 7 | Conformité des moyens à l'affectation | ✅ | `03_views_and_functions.sql` |
| 8 | Verrou HSE avant chargement | ✅ | `05_lot2_invariants.sql:399-434` |
| 9 | Relevés terrain, correction ASTM 54B | ✅ | `common/volumes/astm.service.ts` |
| 10 | Écart d'ullage contrôlé | ✅ | `ullage_tolerances` |
| 11 | Facture émise sans attendre l'exécution *(modèle Elyon)* | ✅ | `invoices.controller.ts` |
| **11 bis** | **Cumul facturé borné au volume contracté** | ❌ **DÉFAUT 1** | *voir § 3* |
| 12 | Cohérence interne de la pièce | ✅ | `chk_invoices_gross_derived` |
| 13 | TVA au taux paramétré | ✅ | `invoices.controller.ts:266-277` |
| **14** | **Transmission à la DGI — et surtout, son silence** | ⏸ **DÉFAUT 2** | *voir § 4* |
| 15 | Encaissement journalisé | ✅ | `payments`, `invoices.controller.ts:471` |
| 16 | En-cours crédit mis à jour | ✅ | `paid_amount_pivot` |

---

## 3. DÉFAUT 1 — LE VOLUME FACTURÉ N'EST BORNÉ PAR RIEN

### ⚠️ CORRECTION D'UNE ERREUR D'AUDIT

> **La première version de ce constat était mal fondée, et je la corrige ici plutôt que
> de la réécrire en silence.**
>
> J'avais écrit que la facture devait être rattachée au **volume livré mesuré sur le
> terrain**, et j'en concluais que la chaîne cassait à la facturation. C'était appliquer
> un modèle générique d'ERP à une entreprise qui ne fonctionne pas ainsi.
>
> Le modèle réel d'Elyon, rappelé par le dirigeant :
>
> - **le volume commandé à la création de l'affaire EST le volume livré** — « je livre ce
>   que j'ai chargé » ;
> - les relevés terrain, la correction ASTM et l'écart d'ullage servent à **améliorer les
>   pratiques opérationnelles**, pas à facturer. C'est cohérent avec la règle déjà posée
>   au § 18 du référentiel : la perte de volume est statistique et **n'intervient ni dans
>   les coûts ni dans la facturation** ;
> - **la facture n'attend pas l'exécution.** Une proforma est émise ou non, puis une
>   facture simple ou une FNE. Le rattachement facture ↔ opération que je réclamais
>   n'aurait pas seulement été inutile : il aurait **bloqué le cycle commercial** en
>   subordonnant l'émission à une livraison qui n'a pas encore eu lieu.
>
> C'est exactement l'angle mort annoncé au § 0 de `00_PERIMETRE.md` — auditer sa propre
> compréhension du métier plutôt que le métier. Le mécanisme que je décrivais était réel ;
> **la référence était fausse.**

### [S1] Rien ne borne le volume facturé au volume contracté de l'affaire

```
Propriété    : P1 Fidélité · P5 Restitution
Axe          : Couverture / Métier (A1)
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/src/invoicing/invoices.controller.ts:54-64`

**Extrait** — le corps de création d'une facture :

```ts
@IsUUID() dealId!: string;
@Type(() => Number) @IsNumber() @Min(0.000001) billedVolume!: number;
@Type(() => Number) @IsNumber() @Min(0) unitPrice!: number;
```

**Mécanisme.** Le volume à facturer est **connu dès la création de l'affaire** :
`deals.contracted_volume`. Il n'est pourtant ni repris, ni comparé :

1. `billedVolume` vient de la requête, librement.
2. Les **9 contraintes** de la table `invoices` vérifient toutes la cohérence *interne* de
   la pièce — montant dérivé du volume et du prix, TVA extraite du total, plafond d'avoir.
   **Aucune ne regarde l'affaire.**
3. Les **2 déclencheurs** (`trg_proforma_no_fiscal_effect`, `trg_credit_note_ceiling`) ne
   la regardent pas davantage.
4. **Aucune vue** ne rapproche le cumul facturé du volume contracté (recherche exécutée
   sur les définitions des 38 vues : 0 résultat mentionnant `billed_volume`).

**Ce que la base montre** — cumul facturé par affaire, contre volume contracté :

| Affaire | Contracté | Factures | Total facturé | Écart |
|---|---|---|---|---|
| DEAL-2026-08-001 | **30 000 L** | 6 | **144 166,36 L** | **+114 166,36 L** |

Soit **4,8 fois le volume vendu**, sans qu'aucun contrôle ne se déclenche.

> **Réserve d'interprétation.** Ces six pièces viennent de campagnes de recette — l'une
> porte 12 345,678 L, valeur manifestement d'essai. **Je n'affirme pas qu'une
> sur-facturation a eu lieu.** J'affirme que le système ne dispose d'aucun moyen de la
> détecter, et que la démonstration est faite sur ses propres données.

**Impact — scénario concret.** Une affaire de 30 000 L est facturée. Le mois suivant, la
même affaire est facturée de nouveau — erreur de manipulation, ou reprise après un
brouillon abandonné. Le système accepte : la seconde pièce est cohérente avec elle-même,
sa TVA est juste, et le verrou de crédit ne se déclenche que si le plafond du client est
atteint. **Le client reçoit deux factures pour une vente**, et l'ERP annonce un chiffre
d'affaires qui n'existe pas.

Le sens inverse est tout aussi ouvert : facturer 28 000 L pour 30 000 L vendus. Sur une
marge de l'ordre de 4 %, **une sous-facturation de 6 % efface une année et demie de marge
sur l'affaire** — et ne laisse aucune trace, puisqu'aucun écran ne rapproche les deux
chiffres.

**Pourquoi c'est sévère malgré la correction de référence.** Le verrou de marge, le verrou
de crédit et le verrou HSE protègent tous l'amont : ce qu'on s'engage à vendre, à qui, et
dans quelles conditions. **Rien ne protège l'aval** — le moment où cet engagement devient
une créance. C'est le seul maillon de la chaîne commerciale où un nombre entre sans être
confronté à quoi que ce soit.

**Correctif** — effort **S**, corrigé en § 9 :
1. Déclencheur : `Σ(volumes facturés SIMPLE + FNE − avoirs) ≤ contracted_volume`, avec
   tolérance d'arrondi paramétrée.
2. Reprise et règle d'invariant pour l'existant.
3. Source de tâche : affaire exécutée et non facturée, affaire sur-facturée.
4. L'écran de facturation propose par défaut le **reliquat à facturer**, calculé.

## 4. DÉFAUT 2 — LA FACTURE NORMALISÉE N'EST JAMAIS TRANSMISE

### [S1] Quatre FNE émises sont bloquées en attente de transmission, sans que rien ne le signale

```
Propriété    : P1 Fidélité · P4 Traçabilité
Axe          : Couverture
Statut       : CONSTATÉ
```

**Localisation** — `apps/api/src/invoicing/invoices.controller.ts:405-411`

**Extrait :**

```ts
// La FNE entre dans le cycle fiscal dès son émission (§ 9.5).
if (invoice.type === InvoiceType.FNE) {
  await this.prisma.fneTransmission.upsert({
    where: { invoiceId: id },
    update: { status: FneStatus.PENDING_TRANSMISSION },
    create: { invoiceId: id, status: FneStatus.PENDING_TRANSMISSION },
  });
}
```

**Mécanisme.** Le cycle fiscal du § 9.5 est **modélisé complètement** — table
`fne_transmissions` avec statut, référence fiscale, charge utile de requête et de
réponse, compteur de tentatives, motif de rejet. L'**entrée** dans le cycle fonctionne.

La **sortie** n'existe pas :

- recherche d'un client HTTP sortant dans toute l'API (`HttpService`, `axios`, `fetch`) :
  **aucun résultat**. Le système ne peut appeler aucun service externe.
- état réel des quatre transmissions : `PENDING_TRANSMISSION`, `attempt_count = 0`,
  `transmitted_at` nul, `fiscal_reference` nulle — **pour les quatre**.
- aucune route ne fait avancer le statut au-delà de `PENDING_TRANSMISSION`.
- la file de tâches compte 17 sources ; **aucune ne concerne le cycle fiscal**.

**Impact.** Quatre factures normalisées ont été **émises** — numérotées, datées, jeton
d'authenticité généré, créance ouverte, une déjà encaissée — et n'ont **jamais été
transmises à l'administration fiscale**. Le système ne le dit à personne : ni écran, ni
alerte, ni tâche. Le seul moyen de s'en apercevoir est d'interroger la base directement.

En exploitation réelle, c'est une exposition fiscale qui grandit silencieusement à chaque
facture émise.

**Nuance honnête.** L'absence du client DGI est **assumée par le référentiel** : le § 9.5
indique que l'API « sera communiquée » et que son obtention est un chantier parallèle, et
le § 19 (point 5) classe ses modalités en point ouvert. L'implémentation manquante n'est
donc pas une faute de couverture.

**Ce qui reste une faute, c'est le silence.** Un blocage attendu doit être visible :
une pièce en attente depuis quarante jours devrait remonter dans la file de tâches du
comptable. Le système sait signaler un contrôle technique périmé et une avance non
apurée ; il ne sait pas signaler une facture fiscale non transmise.

**Correctif** — effort **S** pour la visibilité, **M** pour la transmission :
1. **Immédiat** : source de tâches `FNE_NON_TRANSMISE` sur `fne_transmissions`, urgence
   croissant avec l'ancienneté. Coût : une vingtaine de lignes de SQL.
2. **À réception de l'API DGI** : client sortant, file de reprise sur erreur,
   archivage des échanges (déjà prévu par les colonnes `request_payload` /
   `response_payload`).

---

## 5. MATRICE DE COUVERTURE — MODULES DU § 13

| Module | Statut | Preuve | Écart |
|---|---|---|---|
| **0 — Portail client** | `ABSENT` | `auth.controller.ts:126` — seul contrôleur `api/portal/*` | Authentification seule. Vérifié par appel : jeton émis **200**, `/api/portal/operations`, `/invoices`, `/deals`, `/me` → **404**. Aucun écran web. Le § 13 attend demande de quotation, tableau de bord des offres, acceptation de proforma, suivi de livraison, relevés. **Rien n'est couvert.** |
| **1 — CRM & Front Office** | `IMPLÉMENTÉ` | `crm/crm.controller.ts`, `27_crm_pipeline.sql` | Pipeline, opportunités, interactions, alertes, conversion observée. **Réserve** : « inbox des demandes » absente — elle suppose le portail. |
| **2 — Finance & Risk** | `IMPLÉMENTÉ` | `19_verrou_credit.sql`, `05_lot2_invariants.sql` | Crédit, garanties, verrou de marge, approbations. Verrous tenus **en base**. |
| **3 — Opérations & Logistique** | `IMPLÉMENTÉ` | `operations/`, `20_tarif_transporteur.sql` | Approvisionnement, affectation, suivi, tarifs transporteurs. |
| **4 — HSE** | `IMPLÉMENTÉ` | `hse/`, `10_types_operation.sql`, `12_exigence_photo.sql` | Modèles, checklists, incidents, preuves. **Réserve** : un seul modèle de checklist existe (B2B/RETAIL, camion) — le maritime n'est pas couvert. |
| **5 — Terrain** | `IMPLÉMENTÉ` | `field/`, 13 écrans, `11_journal_terrain.sql` | Journal événementiel idempotent, file persistante hors connexion. |
| **6 — Facturation & Fiscalité** | `PARTIEL` | *voir § 3 et § 4* | Proforma, facture simple, FNE, avoirs : présents. **Maillons manquants : rattachement à la livraison, transmission DGI, recouvrement.** |
| **7 — Transport & Barge** | `PARTIEL` | `vehicles`, `drivers`, `carrier_tariffs` | Sous-traitants, véhicules, chauffeurs, conformité : présents. **Barge : 0 table. Maintenance : 0 table.** Le § 13 attend la barge comme actif, centre de coût, centre de profit et périmètre HSE. |
| **8 — Administration & GED** | `IMPLÉMENTÉ` | `admin/`, `documents/`, `derogations` | Utilisateurs, coffre documentaire, alertes d'expiration, dérogations. |

### Fonctions attendues au référentiel et non couvertes

| Fonction | Réf. | Statut | Remarque |
|---|---|---|---|
| Recouvrement | § 13 mod. 6 | `ABSENT` | Aucune relance client, aucune balance âgée. Un statut `OVERDUE` existe dans l'énumération ; **rien ne le pose** — aucun traitement ne compare `due_date` à la date du jour. |
| Exploitation barge | § 13 mod. 7, § 16 | `ABSENT` | 0 table. |
| Maintenance | § 13 mod. 7 | `ABSENT` | 0 table. |
| Stock et valorisation | § 18 | `ABSENT` | **Reporté explicitement** au lot « Ultérieur ». Conforme. |
| Comptabilité, trésorerie, paie | § 18 | `ABSENT` | **Reportés explicitement.** Conforme. |
| Tableaux de bord Achats / Transport / HSE | § 16 | `PARTIEL` | Le tableau **opérationnel** et le tableau **financier** existent. Les quatre autres domaines du § 16 n'ont pas d'écran dédié. |

### Hors référentiel — dette non pilotée

| Élément | Coût |
|---|---|
| Enum `AllocationBasis.PER_REVENUE` conservée mais rendue inutilisable | Faible. Justifiée : des lignes historiques la portent. |
| 38 vues d'analyse dont plusieurs ne sont consommées par aucun écran | À quantifier en axe B. |

---

## 6. LES TROIS RÉPONSES EXPLICITES (§ 6.3)

### 6.3.1 — Exigences critiques non couvertes, par impact décroissant

| # | Exigence | Impact |
|---|---|---|
| 1 | **Cumul facturé non borné au volume contracté** | Perte financière directe, dans les deux sens, indétectable. |
| 2 | **Transmission fiscale** | Exposition réglementaire croissante, silencieuse. |
| 3 | **Recouvrement** | Aucun suivi des impayés. Le statut `OVERDUE` n'est jamais posé : une facture échue reste `ISSUED` indéfiniment. |
| 4 | **Portail client** | Charge de travail interne maintenue (le client appelle au lieu de consulter). Pas de perte directe. |
| 5 | **Barge** | Un métier entier du § 13 hors outil. Impact fonction de la part de la barge dans l'activité — **inconnue I2**. |

### 6.3.2 — Ressaisies et travaux hors outil imposés

| Ressaisie | Où | Conséquence |
|---|---|---|
| **Volume facturé** | Saisi à la main alors que `contracted_volume` le porte déjà | Défaut 1 |
| **Assiette d'absorption** | Le volume prévisionnel est saisi une fois dans la prévision, une seconde fois dans le taux d'absorption | Divergence possible ; **atténué** par un écart affiché, non par un contrôle |
| **Suivi des impayés** | Hors outil intégralement | Tableur ou mémoire |
| **Relance client** | Hors outil | idem |
| **Exploitation barge** | Hors outil | idem |
| **Pays d'un tiers ou d'un site** | Saisi en texte libre, aucun référentiel pays | Fautes de frappe silencieuses |

### 6.3.3 — Ce que le code fait sans que ce soit demandé

Peu de choses, et rien de coûteux. Trois éléments dépassent la demande sans la contredire :

- **La file de tâches** (17 sources dérivées) — le § 3 la mentionne, mais le dirigeant
  l'avait explicitement reportée. Développée en fin de parcours ; coût de maintenance
  faible car entièrement dérivée, sans état propre.
- **La détection automatique des paramètres requis** — mécanisme non demandé, né d'un
  défaut constaté. Coût faible, valeur préventive.
- **`v_assiette_absorption`** — comparaison non demandée par le référentiel, ajoutée à la
  suite d'une remarque du dirigeant.

**Aucun module entier n'a été construit hors demande.** La dette non pilotée est marginale.

---

## 7. TROIS CONSTATS SUPPLÉMENTAIRES RELEVÉS EN PHASE 1

Ils relèvent des axes A et D mais sont établis, donc consignés ici pour ne pas être perdus.

### [S2] Le solde encaissé est stocké sans lien contraint avec le journal des encaissements

```
Propriété : P5 Restitution · Axe : Métier (A7) · Statut : CONSTATÉ
```
`invoices.paid_amount` est une valeur stockée ; `payments` est le journal. Aucune
contrainte ne les lie. **Test exécuté** (transaction annulée) : un `UPDATE` direct passe
`paid_amount` à `total_amount` et le statut à `PAID` **sans aucun encaissement
enregistré** — accepté. Il n'existe **aucune vue de rapprochement** des encaissements
(`v_cost_reconciliation` couvre les coûts, pas les règlements).

*État actuel : 0 divergence constatée.* Rien ne garantit que cela dure.

### [S1] L'enregistrement d'un encaissement n'est pas idempotent et souffre d'une course

```
Propriété : P2 Intégrité · Axe : Métier (A8) · Statut : CONSTATÉ
```
`invoices.controller.ts:471-548`. La lecture du solde est **hors** de la transaction
d'écriture :

```ts
const invoice = await this.prisma.invoice.findUniqueOrThrow({ ... });   // hors transaction
const paid = roundTo(Number(invoice.paidAmount) + dto.amount, decimals);
const [payment] = await this.prisma.$transaction([ ... ]);              // écriture
```

`paidAmount` est ensuite écrit en **valeur absolue**, pas en incrément. Deux règlements
concurrents de 600 sur une facture de 1 000 : les deux lisent 0, les deux calculent 600,
les deux passent le contrôle, les deux s'écrivent. Résultat : **1 200 encaissés au
journal, 600 au solde**, facture marquée partiellement payée. L'en-cours crédit — qui lit
`paid_amount_pivot` — est faux d'autant.

**Test exécuté** : deux encaissements identiques insérés successivement, **acceptés tous
les deux**. Aucune clé d'idempotence sur la route.

### [S3] L'arithmétique monétaire est en virgule flottante, avec cinq règles d'arrondi concurrentes

```
Propriété : P1 Fidélité · Axe : Métier (A5) · Statut : CONSTATÉ
```
Les montants sont stockés en `numeric(18,4)` — exact. Mais **tous les calculs passent par
`Number`**, donc par des flottants IEEE 754 : 57 conversions `Number(...)` sur des
montants, 5 usages seulement de décimal exact.

```ts
function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
```

**Démonstration exécutée** : `roundTo(1.005, 2)` rend **1**, et non 1,01.

Cinq définitions d'arrondi coexistent dans quatre fichiers (`invoices`,
`supplier-invoices`, `deals`, `margin.service`), plus une tolérance d'arrondi côté SQL.

**Évaluation honnête de la gravité.** Le prompt classe tout montant en flottant comme
critique. Je le classe **S3**, et j'explique pourquoi plutôt que de m'aligner : en XOF
(zéro décimale) aux ordres de grandeur d'Elyon, les doubles sont exacts. Le risque réel
se situe sur les devises à deux décimales du plan document, et sur les marges unitaires à
quatre décimales comparées à un seuil — un cas limite peut faire basculer un verrou du
mauvais côté. **Cette évaluation dépend de l'inconnue I2** ; si le plan document en USD
porte des volumes importants, la sévérité monte à S2.

---

## 8. CE QUE LA PHASE 1 N'A PAS COUVERT

- **La justesse fiscale** des règles (quel document, quel taux) — renvoyée au conseil
  fiscal par le § 19, hors périmètre déclaré.
- **La couverture ligne à ligne** des 1 342 lignes du référentiel : la matrice porte sur
  les modules du § 13 et les sections structurantes. Une matrice exigence par exigence
  demanderait un temps disproportionné pour un gain marginal — les ruptures sont
  identifiées.
- **Le comportement sous charge** — inconnue I2.

---

---

## 9. REMÉDIATION — CE QUI A ÉTÉ CORRIGÉ

> ⚠️ **Changement de posture, déclaré.** La règle 1 du prompt impose la lecture seule.
> Le dirigeant a explicitement demandé la correction des défauts avant la phase suivante :
> à partir d'ici, l'auditeur devient réparateur. Tout ce qui suit est **postérieur** aux
> constats, et chaque correctif est éprouvé par la recette, pas par relecture.

### 9.1 Les défauts constatés, et leur traitement

| # | Défaut | Traitement | Preuve |
|---|---|---|---|
| 1 | Cumul facturé non borné | Déclencheur `enforce_facturation_bornee` : Σ(SIMPLE + FNE − avoirs) ≤ `contracted_volume`, tolérance relative d'un dix-millième. Vue `v_reste_a_facturer`. Règle d'invariant. Deux sources de tâches. | `recette_audit` : *facturer 5 000 L au-delà du reliquat : refusé* · *50 L dans le reliquat : accepté* · *proforma hors contrat : libre* |
| 2 | FNE non transmises, silencieuses | Source de tâche `FNE_NON_TRANSMISE`, bloquante au-delà de 30 jours. La transmission elle-même attend l'API DGI, dépendance externe assumée. | *les FNE non transmises remontent* |
| 3 | Solde encaissé divergeable | Le solde est **dérivé** du journal par déclencheur ; sa saisie manuelle est refusée. Vue `v_rapprochement_encaissements`. Règle d'invariant. | *le solde suit le journal* · *le solde cumule les deux* |
| 4 | Encaissement non idempotent, course | Le solde n'est plus écrit par l'application. La course se referme au moteur : le second règlement recalcule, dépasse, et `paid_amount <= total_amount` le refuse. Index unique sur la référence bancaire. | *même référence bancaire : refusée* · *encaisser plus que le total : refusé* |
| 5 | `OVERDUE` jamais posé | Statut **dérivé** — `statut_creance_effectif`, `v_creances_echues` avec balance âgée par tranches. Source de tâche `CREANCE_ECHUE`. | vue lisible, tâche présente |
| 6 | Cinq arrondis concurrents, erreur sur les cas limites | Une seule autorité : `common/money/money.ts`. L'arrondi passe par la notation exponentielle — `roundTo(1.005, 2)` rend désormais 1,01 et non 1. | vérifié sur 1,005 · 8,615 · 2,675 · −1,005 |
| 7 | 130 fichiers hors contrôle de version | Branche `sauvegarde/lots-3-4-et-audit` : 169 fichiers ajoutés, 44 modifiés. Aucun secret dans l'index. | `git log` |
| 8 | Recette hors dépôt, non rejouable | Rapatriée dans `tests/recette/`, lancée par `npm test`. | 194/194 sur 9 suites |

### 9.2 Trois défauts découverts **dans les correctifs eux-mêmes**

Ils méritent d'être consignés : ils n'auraient pas été trouvés par relecture, seulement en
se servant de ce qu'on venait d'écrire.

**a) Un verrou qui empêchait de réparer ce qu'il dénonçait.** La première version du
contrôle de facturation se déclenchait sur toute écriture. Annuler une pièce en double —
le geste que son propre message recommandait — modifie le statut, ce qui rejouait le
contrôle, qui constatait le dépassement préexistant, et refusait. La règle correcte n'est
pas « le cumul doit être conforme » mais « cette écriture ne doit pas **aggraver** le
cumul ». Une annulation, une réduction, un avoir passent toujours.

**b) Une tolérance monétaire appliquée à un volume.** Réflexe de réutilisation :
`tolerance_arrondi(devise)` était déjà paramétrée. Elle vaut une demi-unité de la plus
petite subdivision — 0,5 en XOF. Appliquée à un volume, elle n'a aucun sens : arbitraire
sur 30 000 L, absurde sur 12 000 000. Remplacée par un écart relatif au contrat.

**c) Une recette qui ne passait qu'une fois.** Les suites créaient des exercices, des
opportunités et des pièces, et échouaient au second passage sur leurs propres traces.
Pire : `recette_dettes` change un mot de passe et ne le restaure qu'à sa dernière ligne —
interrompue avant, elle laissait le compte inaccessible à **toutes** les campagnes
suivantes. C'est précisément le reproche que cet audit adressait à la recette d'alors ;
le corriger à moitié n'aurait rien corrigé. `tests/recette/nettoyage.sql` rétablit
désormais un état déterministe avant chaque campagne, et le lanceur rejoue une suite
interrompue après la fenêtre du limiteur de débit.

**Vérification de la rejouabilité** : deux campagnes complètes enchaînées sans
intervention → **194/194 et 194/194**.

### 9.3 Ce qui reste ouvert

| Point | État |
|---|---|
| Transmission DGI | Attend l'API que le dirigeant doit communiquer. L'attente est désormais **visible**. |
| Aucune voie d'annulation de pièce | L'API n'expose ni annulation ni suppression : une pièce émise par erreur ne se corrige que par avoir. Défendable fiscalement, mais à trancher explicitement. |
| Référentiel pays | `countryCode` reste en saisie libre sur les tiers et les sites. Trois options ont été soumises au dirigeant (liste ISO complète, pays d'activité seulement, statu quo) — **sans réponse à ce jour**. Je ne choisis pas à sa place. |
| Barge, maintenance, recouvrement actif, portail client | Absents. Voir § 5. |
| Arithmétique décimale exacte | Les calculs restent en flottant. Centralisés, donc migrables d'un seul geste. À engager si le volume en devise à deux décimales devient significatif. |

### 9.4 État après remédiation

```
194/194 cas conformes sur 9 suites, rejouables
v_invariant_breaches = 0
8 écrans en 200
```

---

*Phase 1 close. Aucune modification du code. Deux transactions de test ouvertes en base,
toutes deux annulées (`ROLLBACK`) ; aucune donnée n'a été écrite.*
