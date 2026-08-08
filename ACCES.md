# ACCÈS — ERP ELYON TRADING

État au 8 août 2026, après purge des données de démonstration.

---

## 1. OÙ

| | |
|---|---|
| **Application** | http://localhost:4200 |
| **Terrain (tablette)** | http://localhost:4200/terrain |
| **Mot de passe de tous les comptes** | `ChangeMe!2026` |

La tablette utilise **le même navigateur, la même adresse** — il n'y a pas d'application à
installer. Ouvrez `/terrain` sur la tablette, le cadre s'adapte.

Démarrage de la pile si elle est arrêtée :

```
docker compose up -d
```

---

## 2. CE QUE CHAQUE ACCÈS FAIT — ET NE FAIT PAS

Établi en **sondant réellement l'API** rôle par rôle : 43 routes de lecture appelées avec
chacun des 8 comptes, plus les droits d'écriture extraits du registre. Ce qui suit est ce
que le **serveur** autorise, pas ce que l'écran affiche.

> ⚠️ **L'écran et le serveur ne disent pas la même chose, et c'est voulu.** La navigation
> masque des entrées par confort ; le serveur, lui, refuse. Si un écran s'ouvre mais reste
> vide, c'est le serveur qui a dit non — c'est lui qui fait autorité.

> ⚠️ **Sept comptes sur huit exigent un changement de mot de passe à la première
> connexion.** Ce n'est pas un défaut : c'est le comportement prévu pour un compte créé
> avec un mot de passe provisoire. Un bandeau vous y conduit, l'écran est `/mon-compte`.

---

### Directeur Général · `dg@elyon-trading.example`

**Fait tout.** Seul rôle sans aucun refus : les 43 lectures lui sont ouvertes, et il écrit
les **29 référentiels**.

Ce qu'il est le **seul** à pouvoir faire :

- **valider un prix fournisseur** — tant qu'il ne l'a pas fait, aucune affaire ne peut s'en
  servir ;
- **accorder une dérogation** — marge sous le plancher, moyen non conforme, verrou HSE ;
- **approuver une affaire sous le seuil de marge** ;
- voir **toutes les files de tâches**, pas seulement la sienne.

*À tester :* créez une affaire volontairement sous le seuil, et regardez où elle s'arrête.

---

### Directeur Financier · `cfo@elyon-trading.example`

**Fait** — 38 lectures, 19 référentiels en écriture.

- Approbation crédit des affaires, plafonds, garanties, statut de crédit des clients.
- **Exercice comptable et données budgétaires** : taux de financement, budget de charges
  fixes, prévision de vente, taux d'absorption. C'est lui qui débloque tout le pilotage.
- Seuils de marge, barèmes de coûts, tolérances d'ullage, prix administrés et fournisseurs.
- Tout le pilotage financier : point mort, BFR, écart à la prévision, rapprochement des
  coûts, en-cours crédit, avances non apurées.
- Paramètres système.

**Ne fait pas**

- **Valider un prix fournisseur** — réservé au DG. Il peut le saisir, pas le rendre
  opposable.
- Lire les **modèles de checklist HSE**, les **types d'opération**, les **sites**.
- Lire les **alertes du CRM** — il voit le pipeline et la conversion, pas les relances.

*À tester :* c'est par lui que tout commence. Exercice comptable → taux de financement →
budget de charges fixes. La file de tâches vous guide.

---

### CCOO · `ccoo@elyon-trading.example`

**Fait** — 33 lectures, 17 référentiels en écriture. Le rôle le plus large après le DG.

- Affaires et opérations de bout en bout, y compris la **création d'opération**.
- Pipeline commercial complet, **y compris la conversion observée par étape**.
- Produits, sites, exigences de site, véhicules, chauffeurs, types d'opération, modèles de
  checklist HSE, points de contrôle.
- Surveillance : bande de marge, écart de marge, en-cours crédit, point mort.

**Ne fait pas**

- Approuver le crédit, ni valider un prix fournisseur.
- Lire les **paramètres système** ni les **taux d'absorption**.
- Lire le **BFR**, le **rapprochement des coûts**, les **avances non apurées**, les
  **invariants**.
- ⚠️ Lire la **concentration par commercial**. Voir § 2 bis.

---

### Commercial · `commercial@elyon-trading.example`

**Fait** — 16 lectures seulement, **un seul référentiel** en écriture (prix administrés).

- Pipeline commercial : opportunités, interactions, relances, franchissement d'étapes.
- Affaires : consultation et création.
- Produits, sites, cours de change, prix administrés.

**Ne fait pas** — c'est le rôle le plus fermé, délibérément.

- **Aucune approbation**, ni crédit ni marge.
- **Aucun accès à la conformité** des moyens.
- **Aucun accès aux dérogations.**
- **Aucun chiffre de pilotage** : ni point mort, ni BFR, ni en-cours crédit, ni bande de
  marge, ni prévision.
- Ne touche ni aux seuils, ni aux barèmes, ni aux tolérances, ni aux paramètres.

*À tester :* connectez-vous avec ce compte et tentez `/pilotage` ou `/supervision`. Vous
devez être refusé.

---

### Coordinateur logistique · `logistique@elyon-trading.example`

**Fait** — 21 lectures, 10 référentiels en écriture.

- **Création d'opération** — avec le CCOO, les deux seuls.
- Conformité des moyens : vue d'ensemble, non-conformes, échéancier.
- Véhicules, chauffeurs, sites, exigences de site, tarifs de transport, types d'opération,
  modèles de checklist HSE.
- Prévision de vente et couverture budgétaire, pour préparer l'approvisionnement.

**Ne fait pas**

- **Rien du CRM** : ni pipeline, ni alertes, ni conversion.
- **Aucun chiffre financier** : ni en-cours crédit, ni BFR, ni point mort, ni bande de
  marge, ni rapprochement des coûts.
- Ni dérogations, ni seuils de marge, ni paramètres.

---

### Comptable · `comptable@elyon-trading.example`

**Fait** — 25 lectures, 2 référentiels en écriture (postes de coûts, cours de change).

- **Facturation** : proforma, facture simple, FNE, avoirs, émission.
- **Encaissements** — seul avec le CFO à pouvoir enregistrer un règlement.
- Achats et prépaiements fournisseurs, apurement manuel.
- Créances échues, rapprochement des coûts, BFR, avances non apurées, point mort.

**Ne fait pas**

- **Rien du CRM.**
- **Aucun accès à la conformité** des moyens.
- Ne voit ni la **bande de marge**, ni la concentration par commercial.
- Ne lit ni les **paramètres système**, ni les **sites**, ni les **types d'opération**.

*À tester :* c'est le rôle qui butera le plus vite sur l'absence de cours de change.

---

### Assistante de direction · `assistante@elyon-trading.example`

**Fait** — 17 lectures, un seul référentiel en écriture (tiers).

- **Dérogations** : consultation du registre.
- Documents et coffre documentaire.
- Pipeline commercial et ses alertes.
- Conformité : vue d'ensemble et échéancier.
- Affaires, en consultation.

**Ne fait pas**

- **Aucune approbation, aucune validation.**
- **Aucun chiffre de pilotage** — ni marge, ni crédit, ni BFR, ni point mort.
- Ne lit ni les paramètres, ni les seuils, ni les barèmes, ni les sites, ni les types
  d'opération.

---

### Administrateur · `it@elyon-trading.example`

**Fait** — 13 lectures, **un seul référentiel** en écriture (paramètres système).

- **Paramètres système** : délais d'alerte, TVA, verrouillage de connexion, plafonds de
  débit.
- **Invariants** et **paramètres requis** — la santé technique du système.
- Comptes utilisateurs.

**Ne fait pas** — et c'est le point important.

- **Ne voit aucune affaire** — refusé sur `/deals` —, aucune opération commerciale, aucune
  facture.
- **Aucun chiffre financier** : ni marge, ni crédit, ni BFR, ni point mort, ni prévision.
- **Rien du CRM**, rien de la conformité, aucune dérogation.

> L'administrateur tient l'outil, pas l'entreprise. Il règle un délai d'alerte ; il ne peut
> pas savoir combien vous vendez.

---

## 2 bis. TROIS POINTS À TRANCHER PENDANT VOS TESTS

Ce sont des **décisions d'entreprise**, pas des défauts techniques. Le système fait ce
qu'on lui a dit ; reste à savoir si c'est ce que vous voulez.

**1. Un commercial voit les affaires de ses collègues, prix et marges compris.**
La liste des affaires n'applique **aucun filtre de propriétaire** — vérifié dans le code,
pas supposé. Chaque commercial voit donc le prix de vente et la marge de tous les autres.
Dans beaucoup de maisons de négoce, c'est exclu. Dites-moi si chacun ne doit voir que les
siennes.

**2. Le coordinateur logistique et l'assistante lisent les affaires**, donc les prix de
vente et les marges estimées. Défendable — le logisticien doit savoir ce qu'il transporte —
mais c'est de l'information commerciale.

**3. Le CCOO ne voit pas la concentration par commercial.** C'est pourtant la lecture qui
révèle un vendeur dont toutes les affaires effleurent le seuil, et le CCOO en est le
supérieur. Cela ressemble à un oubli de ma part plutôt qu'à un choix. Je peux l'ouvrir.

---

## 3. COMPTES TERRAIN — 2

Réalm **séparé**, cloisonné au serveur : un jeton terrain est refusé sur toute la console
interne, et l'inverse est vrai. Vérifié par appel, pas supposé.

### Agent de terrain · `agent.terrain@elyon-trading.example`

**Fait** — ses opérations du jour, les checklists HSE, les relevés de volume, les photos,
la fiche du site et ses exigences, la file hors connexion.

**Ne fait pas** — ne voit **ni prix, ni marge, ni encours**. Ne voit que **les opérations
qui lui sont assignées**, jamais celles d'un collègue.

### Contrôleur HSE · `hse@elyon-trading.example`

**Fait** — valide les checklists, ouvre les incidents et les non-conformités, consulte les
opérations sous contrôle.

**Ne fait pas** — aucune donnée commerciale ni financière. Ne crée pas d'opération et ne
saisit pas de relevé de volume.

---

## 4. PORTAIL CLIENT — inexistant

Les deux comptes de démonstration ont été supprimés avec les tiers auxquels ils étaient
rattachés. **Le portail n'a de toute façon aucune fonction** : l'authentification répond,
et aucune route ne sert de données. À construire.

---

## 5. CE QUI RESTE EN BASE

Deux purges successives : l'activité d'abord, puis les référentiels métier que vous avez
désignés — **73 produits, 55 cours de change, 18 seuils de marge**.

### Vidé, et administrable

| Référentiel | Où le saisir | Import fichier |
|---|---|---|
| **Produits** | `/parametrage` → Produits | oui |
| **Cours de change** | `/parametrage` → Taux de change | oui |
| **Seuils de marge** | `/parametrage` → Seuils de marge | oui |
| Tiers, sites, véhicules, chauffeurs | idem | oui |
| Affaires, opérations, factures, encaissements | écrans métier | — |

Écriture vérifiée sur les trois : produit **201**, cours de change **201**, seuil de marge
**201**. Les lignes d'essai ont été retirées — la base est vierge.

> ⚠️ **Conséquence immédiate, à connaître avant de vous étonner.**
>
> Sans cours de change, **aucune conversion n'est possible** : le plan pivot ne se calcule
> pas et toute pièce monétaire sera refusée. Sans produit, aucune affaire ne se crée. Sans
> seuil de marge, le verrou de marge n'a rien à faire respecter et tout passe.
>
> C'est le comportement correct — on ne convertit pas sans taux, on ne vend pas un produit
> qui n'existe pas — mais l'application paraîtra bloquée tant que le premier cours et le
> premier produit ne sont pas saisis. Un système qui inventerait un taux de change mentirait
> sur tout ce qu'il calcule ensuite.

### Conservé, et pourquoi

| Référentiel | Lignes | Nature |
|---|---|---|
| Comptes internes / terrain | 8 / 2 | Vos accès |
| **Devises** | 3 — XOF, USD, EUR | Cadre monétaire. Les vider empêcherait toute saisie, y compris celle des cours. |
| Postes de coût | 24 | Nomenclature de coûts |
| Types d'opération | 5 — ROUTE, SOUTAGE, BARGE, PIPELINE, RAIL | Vos modes d'exécution |
| Types d'exigence de site | 9 | Nomenclature |
| Étapes du pipeline commercial | 13 | **Nommées par votre § 15.** Probabilités laissées vides. |
| Modèle de checklist HSE + points | 1 + 20 | Livraison routière |
| Paramètres système | 21 | Délais d'alerte, TVA, verrouillage de connexion |

### ⚠️ Ce qui reste préchargé et relève du même principe que vous venez de poser

Vous avez désigné trois référentiels. **Quatre autres portent des valeurs d'entreprise que
personne chez vous n'a décidées** — je ne les ai pas touchés parce que vous ne les avez pas
nommés, et je ne décide pas à votre place :

| Référentiel | Lignes | Ce que ça vaut |
|---|---|---|
| **Barèmes de coût** | 2 | Montants de référence par poste — ce sont vos coûts standards |
| **Tolérances d'ullage** | 1 | Seuil de perte admissible, illustré à 0,2 % par le § 19 |
| **Regroupements de charges** | 5 | Dont **2 sont des essais de recette** (`BANQUE-900`, `TEST-CA`), désactivés et renommés |
| **Taux d'absorption** | 5 | Budget ÷ assiette — ce sont vos charges de structure |

Dites-moi si je les vide aussi. Mon avis : oui pour les quatre, et il faudra en profiter
pour supprimer les deux regroupements d'essai plutôt que de les laisser désactivés.

---

## 5 bis. LA RECETTE NE PASSE PLUS — ET C'EST NORMAL

> ⚠️ **Les 194 cas de recette s'appuient sur le jeu de démonstration.** Vous venez de me
> le faire effacer : ils ne peuvent plus tourner. Ce n'est pas une régression, c'est la
> conséquence directe de la purge — mais vous devez le savoir avant de lancer `npm test`
> et de croire à une casse.

Deux façons de revenir à un état vérifiable, selon ce que vous voulez :

**Régénérer le jeu de démonstration** — la base repart avec ses clients, affaires et
opérations fictives :

```
docker compose --profile tools run --rm migrator npm run db:seed
```

**Restaurer exactement l'état d'avant la purge** — y compris les traces d'audit :

```
docker compose exec -T postgres psql -U erp_migrator -d erp < sauvegardes/avant-purge-20260808-1159.sql
```

**Pour vos essais réels, ne faites ni l'un ni l'autre.** La base vide est ce que vous
avez demandé, et c'est le bon terrain pour découvrir ce qui rame : une application qui
ne connaît rien de vous vous obligera à tout saisir, et c'est précisément là que les
frottements se voient.

Quand vous voudrez que je vérifie une correction, je régénérerai le jeu, je jouerai la
recette, puis je repurgerai.

---

## 6. LA DEVISE — CE QUI A CHANGÉ

Vous aviez raison : **le dollar s'imposait sans qu'on l'ait choisi.** Trois endroits,
tous corrigés.

**Le plafond de crédit d'un client était en dollars par défaut.** Le schéma portait
`@default("USD")` : vos quatre clients de démonstration avaient un plafond libellé en
dollars que personne n'avait décidé. Le défaut est retiré — **la devise du plafond se
saisit désormais obligatoirement**.

**Les devises se tapaient à la main sur l'écran de facturation**, en trois caractères
libres. Ce sont maintenant des listes déroulantes alimentées par le référentiel, et la
valeur de départ est la devise déclarée **locale** — pas le pivot.

**Cinq codes devise étaient écrits en dur** dans les écrans (opérations, achats). Une
devise codée dans un écran survit à tout changement de paramétrage : le jour où vous
facturez en euros, il faut retrouver l'écran. Ils sont remplacés par une lecture du
référentiel.

> **Le principe posé, et tenu partout :** le pivot sert à **comparer** des engagements
> pris dans des monnaies différentes. Il n'est la monnaie de personne, et aucune saisie ne
> le propose d'office. Une proforma, une facture simple ou une FNE choisissent leur devise
> d'émission — et, séparément, leur devise d'impression.

---

## 7. PREMIERS PAS SUGGÉRÉS

L'application est vide : elle vous dira ce qui lui manque au fur et à mesure. L'écran
**« Ce que j'ai à traiter »** est le fil à suivre.

1. **Exercice comptable** — `/parametrage` → Exercices comptables. Rien ne se calcule
   sans lui : le point mort le dit déjà.
2. **Taux de financement, budget de charges fixes** — les valeurs que j'ai refusé
   d'inventer.
3. **Probabilités du pipeline** — `/parametrage` → Étapes du pipeline. Les treize étapes
   existent, leurs probabilités sont vides.
4. **Un client**, avec son plafond de crédit **et sa devise**.
5. **Une affaire**, puis une opération, puis une facture — et regardez ce qui se bloque.

C'est en butant que vous verrez ce qui rame. Notez, et on reprend point par point.

---

## 8. CE QUE JE SAIS DÉJÀ IMPARFAIT

Autant que vous ne le découvriez pas comme une surprise :

| Point | État |
|---|---|
| **Transmission DGI** | Aucune : j'attends l'API. Les FNE émises remontent dans la file du comptable au lieu d'attendre en silence. |
| **Aucune annulation de pièce** | Une facture émise par erreur ne se corrige que par avoir. À trancher. |
| **Pays en saisie libre** | Sur les tiers et les sites. Trois options vous ont été soumises, sans réponse — je n'ai pas choisi à votre place. |
| **Barge, maintenance** | Absentes. |
| **Portail client** | La porte, pas les pièces. |
| **Recouvrement** | Les créances échues sont visibles ; il n'y a pas de relance automatique. |
