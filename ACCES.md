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

## 2. COMPTES INTERNES — 8 rôles

Tous vérifiés le 8 août : les 8 se connectent.

| Rôle | Identifiant | Ce qu'il voit et fait |
|---|---|---|
| **Directeur Général** | `dg@elyon-trading.example` | Tout. Valide les prix fournisseurs, accorde les dérogations, approuve les affaires sous le seuil de marge. Voit **toutes** les files de tâches. |
| **Directeur Financier** | `cfo@elyon-trading.example` | Approbation crédit, seuils, garanties, exercice comptable et données budgétaires, pilotage financier. |
| **CCOO** | `ccoo@elyon-trading.example` | Affaires, opérations, pipeline commercial, types d'opération. |
| **Commercial** | `commercial@elyon-trading.example` | Affaires et pipeline. **Ne peut ni approuver, ni toucher au paramétrage.** |
| **Coordinateur logistique** | `logistique@elyon-trading.example` | Opérations, affectation des moyens, conformité, exigences de site. |
| **Comptable** | `comptable@elyon-trading.example` | Facturation, encaissements, achats, créances échues. |
| **Assistante de direction** | `assistante@elyon-trading.example` | Documents, dérogations, coffre documentaire. |
| **Administrateur** | `it@elyon-trading.example` | Comptes, paramètres système, invariants. |

> ⚠️ **Sept comptes sur huit exigent un changement de mot de passe à la première
> connexion.** Ce n'est pas un défaut : c'est le comportement prévu pour un compte créé
> avec un mot de passe provisoire. Un bandeau vous y conduit ; l'écran est
> `/mon-compte`.

---

## 3. COMPTES TERRAIN — 2

Réalm **séparé** : ces comptes ne peuvent pas ouvrir la console interne, et l'inverse est
vrai. Ce n'est pas un filtrage d'affichage, c'est un cloisonnement au serveur.

| Rôle | Identifiant | Ce qu'il voit |
|---|---|---|
| **Agent de terrain** | `agent.terrain@elyon-trading.example` | Ses opérations du jour, checklists, relevés, photos. **Ni prix, ni marge, ni encours.** |
| **Contrôleur HSE** | `hse@elyon-trading.example` | Checklists à valider, incidents, non-conformités. |

---

## 4. PORTAIL CLIENT — inexistant

Les deux comptes de démonstration ont été supprimés avec les tiers auxquels ils étaient
rattachés. **Le portail n'a de toute façon aucune fonction** : l'authentification répond,
et aucune route ne sert de données. À construire.

---

## 5. CE QUI RESTE EN BASE

La purge a effacé **toute l'activité** et conservé **tout le paramétrage** — sans quoi
l'application vous laisserait tout passer et ne montrerait rien de ce qu'elle sait
refuser.

| Conservé | Nombre |
|---|---|
| Comptes internes / terrain | 8 / 2 |
| Devises | 3 — XOF (locale), USD (pivot), EUR |
| Produits | 73 |
| Cours de change | 55 |
| Seuils de marge | 18 |
| Postes de coût | 24 |
| Barèmes de coût | 2 |
| Types d'opération | 5 |
| Modèles de checklist HSE | 1 |
| Étapes du pipeline commercial | 13 |
| Paramètres système | 21 |

| Effacé | |
|---|---|
| Tiers, sites, véhicules, chauffeurs | 0 |
| Affaires, opérations, factures, encaissements | 0 |
| Journal terrain, journal d'audit | 0 |
| Exercices comptables et données budgétaires | 0 |
| Compteurs de numérotation | remis à 1 |

**Sauvegarde avant purge** : `sauvegardes/avant-purge-20260808-1159.sql` (3,6 Mo).
Restauration :

```
docker compose exec -T postgres psql -U erp_migrator -d erp < sauvegardes/avant-purge-20260808-1159.sql
```

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
