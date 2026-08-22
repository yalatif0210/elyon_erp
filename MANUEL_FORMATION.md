# Manuel de formation - ERP Elyon Trading

> Document vivant, rédigé partie par partie. Chaque section est ancrée dans l'interface réelle de l'application au moment de la rédaction : libellés, boutons et messages sont ceux que vous verrez à l'écran, pas une paraphrase.

## Sommaire

- Partie 0 - Avant de commencer
- Partie 1 - Les fondations du paramétrage
- Partie 2 - Le cycle complet d'une affaire
- Partie 3 - Le portail client
- Partie 4 - Fiches par rôle
- Partie 5 - Lexique et formules

---

# Partie 0 - Avant de commencer

## 0.1 Trois espaces, pas un seul

Cet ERP n'est pas une seule application avec des menus qui changent selon qui se connecte. Ce sont **trois applications distinctes**, sur trois adresses différentes, chacune construite pour un usage précis. Se tromper d'adresse ne fait pas planter l'outil : il vous montre simplement l'écran de connexion qui ne connaît pas votre compte, avec un message qui ne dit pas pourquoi.

| Espace | Adresse (production) | Pour qui | Ce qu'on y fait |
|---|---|---|---|
| **Console interne** | `erp.elyon-trading.com` | Direction, commerciaux, logistique, finance, comptabilité, HSE, informatique | Tout le pilotage : affaires, opérations, paramétrage, facturation, reporting |
| **Terrain** | `terrain.elyon-trading.com` | Agents d'opération, contrôleurs HSE sur site | Ce qui se passe pendant le chargement et la livraison, depuis une tablette |
| **Portail client** | `portail.elyon-trading.com` | Vos clients | Consultation de leurs propres devis, factures et affaires - rien d'autre |

Un agent terrain n'a pas de compte sur la console interne, et un commercial n'a pas de compte sur le portail client : ce sont trois annuaires de comptes séparés (`User`, `FieldUser`, `PortalUser`), même si une même personne physique peut, en théorie, apparaître dans plusieurs.

**Piège fréquent** : taper `erp.elyon-trading.com/connexion` avec un compte terrain renvoie « Identifiants invalides », alors que le compte existe bel et bien - simplement pas sur cet espace-là. Si vous êtes agent terrain ou contrôleur HSE, votre adresse est toujours celle de l'espace Terrain.

## 0.2 Se connecter

### Console interne et Terrain

Les deux écrans de connexion se ressemblent (même fond de marque, même carte blanche) mais restent deux pages séparées, chacune sur son espace. Vous y saisissez :

- **Email**
- **Mot de passe**

et vous validez avec **Se connecter**.

Deux situations particulières, qui ne sont pas des anomalies :

- **Mot de passe provisoire.** Un compte tout juste créé (par un administrateur) porte toujours un mot de passe provisoire. Après la première connexion, un bandeau reste affiché en haut de l'écran : *« Mot de passe provisoire, un changement est requis »*, avec un lien **Le changer**. Ce n'est pas bloquant : vous pouvez travailler normalement, mais le bandeau reste tant que le changement n'est pas fait. Il se règle depuis **Mon compte**.
- **Second facteur (code de vérification).** Certains rôles doivent saisir, en plus du mot de passe, un code à 6 chiffres produit par une application d'authentification sur leur téléphone. Tant que ce second facteur n'est pas configuré, un bandeau *« Second facteur obligatoire pour votre rôle, et non encore configuré »* s'affiche, avec un lien **Le configurer** vers **Mon compte**. Une fois configuré, le champ **Code de vérification** apparaît automatiquement à chaque connexion suivante - il n'est jamais demandé avant que vous ne l'ayez vous-même activé.

**Compte verrouillé.** Après plusieurs mots de passe erronés de suite, le compte se verrouille temporairement et l'écran l'annonce explicitement, avec l'heure à laquelle il se déverrouille tout seul. Ce n'est pas la peine de réessayer avant cette heure : chaque nouvel essai pendant le verrouillage ne fait que confirmer que le compte est verrouillé, il ne le prolonge pas.

### Portail client

Le portail suit le même principe (email, mot de passe, changement de mot de passe provisoire à la première connexion) sur sa propre adresse. Un client n'a jamais de second facteur à configurer : cette exigence ne concerne que les rôles internes les plus sensibles.

## 0.3 Configurer le second facteur (« Mon compte »)

Si votre rôle l'exige, voici comment procéder, une seule fois :

1. Ouvrez **Mon compte** (lien du bandeau, ou menu utilisateur).
2. Dans la section **Second facteur**, cliquez sur **Configurer le second facteur**.
3. Un code QR apparaît. Scannez-le avec une application d'authentification (Google Authenticator, Microsoft Authenticator, ou équivalent) installée sur votre téléphone - jamais depuis un ordinateur qui affiche déjà l'écran : le code QR est produit pour être lu ailleurs que là où il s'affiche.
4. L'application vous donne un code à 6 chiffres qui change toutes les 30 secondes. Saisissez le code affiché à l'instant et cliquez sur **Activer**.
5. Le message *« Second facteur actif. Il vous sera demandé à chaque connexion, en plus du mot de passe »* confirme l'activation.

À partir de là, chaque connexion demande ce code, en plus de l'email et du mot de passe habituels.

## 0.4 Les rôles : qui voit quoi

Chaque compte porte un rôle unique, qui détermine les écrans visibles, les actions permises, et parfois même les montants affichés (la marge d'une affaire, par exemple, est masquée à un rôle qui n'a pas à l'arbitrer). Ce n'est jamais à vous de deviner ce que vous pouvez faire : un bouton ou un écran absent signifie que votre rôle ne l'a pas.

**Console interne :**

| Rôle | Ce qu'il pilote en propre |
|---|---|
| **DG** (Direction Générale) | Approbation finale des affaires, dérogations, tout ce qui engage l'entreprise. Voit tout. |
| **Assistant DG** | Support de direction, accès étendu en lecture. |
| **CCOO** (Directeur Commercial & Opérations) | Affaires, opérations, coordination commerciale et logistique au niveau direction. |
| **Chargé de Clientèle & Devis** (`SALES_REP`) | Création et chiffrage des affaires, suivi du pipeline commercial. |
| **Coordinateur Logistique & Sourcing** (`LOGISTICS_COORD`) | Création des opérations, affectation des moyens (véhicules, chauffeurs, transporteurs), tarifs de fret. Ne voit jamais la marge. |
| **Directeur Financier** (`FINANCE_CFO`) | Seuils de marge, taux de financement, validation des prix fournisseurs, approbation crédit. |
| **Comptable / Chargé Recouvrement** (`ACCOUNTANT`) | Facturation, encaissements, relances. |
| **IT Admin** | Paramètres système, gestion des comptes, accès aux écrans. |

**Terrain :**

| Rôle | Ce qu'il fait |
|---|---|
| **Agent d'opération** (`FIELD_AGENT`) | Exécute l'opération sur le terrain : rapport, signatures, pièces jointes. |
| **Contrôleur HSE** (`HSE_CONTROLLER`) | Valide à distance les checklists HSE bloquantes. |

**Portail :** un seul type de compte, rattaché à un tiers (client) précis - pas de distinction de rôle au-delà de ça.

## 0.5 Comment un compte est créé

Personne ne s'inscrit soi-même sur cet ERP : tout compte est créé par quelqu'un d'autre, jamais par la personne qui l'utilisera.

- **Le tout premier compte** (le DG, à l'installation) est créé par un script technique réservé à l'informatique - vous n'aurez jamais à le refaire une fois l'outil en service.
- **Les comptes internes et terrain suivants** se créent depuis **Gérer les utilisateurs** (réservé au DG et à l'IT Admin), avec deux onglets, **Internes** et **Terrain**. On y saisit l'email, le nom et un mot de passe provisoire ; le nouveau titulaire le change dès sa première connexion. Depuis ce même écran, un compte peut être désactivé (jamais supprimé - l'historique qu'il a produit reste rattaché à un auteur identifiable) ou voir son mot de passe réinitialisé.
- **Un compte portail** ne se crée pas depuis cet écran : il naît de la fiche d'un tiers (client), sous l'action **Accès portail**, à l'initiative d'un commercial - jamais par le client lui-même.

Si vous découvrez un jour que vous n'avez pas accès à un écran dont vous auriez besoin, la démarche n'est pas de contourner l'obstacle : c'est de le signaler au DG ou à l'IT Admin, qui jugent si votre rôle doit l'obtenir.

---

# Partie 1 - Les fondations du paramétrage

Avant qu'une affaire ne puisse se créer, l'outil doit connaître un minimum de choses : dans quelle devise on travaille, quels sont vos produits, quels tiers existent, quels sites de livraison existent. C'est l'objet de l'écran **Paramétrage**. Cette partie explique comment cet écran fonctionne, puis dans quel ordre le renseigner - un ordre qui n'est pas arbitraire : chaque réglage n'en vise jamais un autre qui n'aurait pas déjà été posé plus haut.

## 1.1 L'écran Paramétrage, en bref

L'écran se présente en deux colonnes. À gauche, la liste de tous les réglages administrables, groupés sous des sous-titres en couleur (Fondations transverses, Tiers et engagements commerciaux, etc.) - voir § 1.2. À droite, trois onglets pour le réglage sélectionné :

- **Saisie unitaire** - un formulaire pour créer ou corriger une ligne à la main.
- **Import de fichier** - pour charger plusieurs lignes d'un coup depuis un fichier CSV. Le bouton **Télécharger le gabarit** donne un fichier vierge avec les bonnes colonnes. Avant d'importer pour de vrai, le bouton **Simuler** rend un rapport ligne par ligne (créées, modifiées, rejetées et pourquoi) sans rien écrire en base - toujours simuler avant d'importer.
- **Ce qui est enregistré** - la liste de ce qui existe déjà, avec recherche et pagination. Chaque ligne porte un bouton pour la reprendre.

**Deux natures de réglage, à ne jamais confondre :**

- **Modifiable** (la plupart des réglages) - une ligne se corrige sur place. Une faute de frappe dans un code produit se corrige, elle ne laisse pas de trace historique.
- **Historisé** (les prix, les taux, les seuils...) - une ligne ne se réécrit **jamais**. La corriger publie une **nouvelle ligne datée** ; l'ancienne reste en place, close à cette date. C'est pourquoi le bouton, sur ces réglages, s'appelle **Repartir de là** et non « Modifier » : il reprend les valeurs existantes dans le formulaire, mais propose la date du jour, jamais l'ancienne. Cette contrainte protège vos calculs déjà produits : une facture émise reste reconstituable au prix qui l'a réellement produite, même si ce prix a changé depuis.

**Ce que vous voyez dépend de votre rôle.** La liste de gauche ne montre que les réglages que votre rôle peut écrire. Si un réglage attendu n'apparaît pas, ce n'est pas une panne : votre rôle n'y a pas accès - voir les fiches par rôle, Partie 4.

**Les champs se répondent entre eux.** Certains champs se vident automatiquement quand un autre change : sur un poste de coût par exemple, repasser la **Nature** à *Directe* vide aussitôt le **Pool de charges indirectes** et l'**Assiette d'absorption**, deux champs qui n'ont plus de sens pour un poste direct. Et les listes déroulantes qui pointent vers un tiers ne proposent jamais que le bon type - un champ *Fournisseur* ne vous montrera jamais un client ni un transporteur.

## 1.2 L'ordre logique : six groupes, un seul sens de lecture

La liste de gauche suit un ordre voulu, pas alphabétique. La règle est simple : **un groupe ne vise jamais qu'un groupe déjà posé au-dessus**, et c'est vrai aussi à l'intérieur d'un groupe. Deux exemples concrets, déjà rencontrés en exploitation :

- Un **poste de coût indirect** doit désigner un **pool de charges indirectes** - impossible de le faire si aucun pool n'existe encore. D'où l'ordre : *Pools de charges indirectes* avant *Postes de coûts*.
- Le **budget d'un pool** se divise par la **prévision de vente** de l'exercice pour calculer son taux d'absorption - et l'outil refuse ce budget tant qu'aucune prévision n'existe pour les segments concernés. D'où l'ordre : *Prévision de vente* (groupe Marché et pilotage) avant *Budget des pools de charges* (groupe Coûts et absorption).

Suivre l'ordre de la liste, de haut en bas, à la première mise en route, évite ce genre de blocage.

### Groupe 1 - Fondations transverses

Ce que tout le reste vise, sans jamais rien viser en retour :

- **Paramètres système** - une trentaine de réglages techniques (seuils de sécurité, délais d'alerte, identifiants FNE...), déjà posés à des valeurs sûres dès l'installation. Vous n'avez à y toucher que pour les adapter à votre exploitation réelle - voir chaque description dans l'onglet **Ce qui est enregistré**.
- **Devises** - dont la devise pivot (celle qui sert de référence pour comparer un risque ou une marge) et la devise locale.
- **Pays** - liste fermée aux pays où vous avez réellement une activité.
- **Exercices comptables** - un seul exercice **courant** à la fois ; le clore fige ses valeurs budgétaires.
- **Produits** - vos produits pétroliers, avec leur densité de référence et leur unité par défaut.

### Groupe 2 - Tiers et engagements commerciaux

- **Tiers** - clients, fournisseurs, transporteurs, prospects et inspecteurs, tous dans une seule liste distinguée par leur **Nature**. Le plafond de crédit et les délais de paiement s'y règlent aussi.
- **Contrats-cadres** - les conditions par défaut héritées par les affaires d'un client.
- **Prix fournisseurs** - historisé, et soumis à une règle propre : un prix saisi n'est **pas opposable** tant que le DG ne l'a pas validé (bouton **Valider**, visible du DG seul, dans l'onglet Ce qui est enregistré). Une fois validé, il est immuable.
- **Garanties** - lettres de crédit, acomptes, garanties bancaires qui réduisent l'exposition crédit d'un client.
- **Étapes du pipeline** - le déroulé commercial (nouveau, offre envoyée, négociation...) utilisé par le suivi des opportunités.

### Groupe 3 - Référentiel logistique

- **Sites** - un lieu (dépôt, station, quai), indépendant de qui s'y approvisionne ou s'y fait livrer. Plusieurs clients peuvent partager le même site.
- **Natures d'exigence de site** puis **Exigences des sites** - dans cet ordre : on définit d'abord les types d'exigence possibles (badge d'accès, créneau réservé...), puis on les rattache à un site précis.
- **Véhicules** et **Chauffeurs** - rattachés à un transporteur.
- **Tarifs de transport** - négociés par transporteur, mode, produit et trajet.
- **Types d'opération** - chargement, transport routier, soutage... Ce sont eux qui indexent les contrôles HSE : une opération sans type ne reçoit aucun contrôle.

### Groupe 4 - HSE

- **Modèles de checklist HSE** - rattachés à un ou plusieurs types d'opération : une opération reçoit l'union des checklists de tous ses types.
- **Points de contrôle HSE** - le détail de chaque modèle, avec leur niveau (bloquant ou non).

### Groupe 5 - Marché et pilotage

Ce qu'on révise en cours d'exercice, pas ce qu'on pose une fois à la mise en route :

- **Taux de change**, **Seuils de marge**, **Tolérances d'écart de volume**, **Prix administrés** (une référence consultée, jamais un moteur de calcul), **Taux de financement**.
- **Prévision de vente** - un volume par segment, produit et mois de l'exercice. C'est elle qui nourrit le calcul du taux d'absorption du groupe suivant - d'où sa place ici, avant lui.

### Groupe 6 - Coûts et absorption

- **Pools de charges indirectes** - un regroupement de charges (Administration, HSE, Informatique...) qui s'absorbe au volume.
- **Postes de coûts** - directs (imputés à une opération) ou indirects (rattachés à un pool).
- **Barème de coûts** - la valeur pré-paramétrée d'un poste, celle qui donne un sens à un écart constaté.
- **Budget des pools de charges** - une seule valeur à saisir, le budget annuel du pool ; le taux d'absorption s'en déduit automatiquement. Le détail de ce calcul, et son rôle dans la marge d'une affaire, sont expliqués en Partie 2 - c'est là qu'ils prennent tout leur sens.

---

# Partie 2 - Le cycle complet d'une affaire

Cette partie suit une affaire réelle du premier au dernier jour : le chiffrage, l'approbation, la création d'une opération, son exécution sur le terrain jusqu'à sa clôture, la facturation, l'encaissement. Chaque formule est expliquée au moment précis où elle intervient, avec un exemple chiffré réel. Rien n'est arbitré à la main dans ce cycle : ce que la base refuse, elle le refuse avec un motif écrit ; ce qu'elle calcule, elle le calcule toujours de la même façon, jamais au jugé.

## 2.0 Vue d'ensemble : qui fait quoi, dans quel ordre

Avant le détail, la carte du terrain. Une affaire traverse ces étapes dans cet ordre - certaines peuvent se répéter (une affaire donne souvent lieu à plusieurs opérations). Une exception à cet ordre, expliquée en détail au § 2.10 : **facturer ne dépend que de l'affaire approuvée, jamais d'une opération** - la facturation peut donc démarrer avant, pendant ou après l'exécution des opérations, sans attendre leur clôture.

| Étape | § | Qui agit |
|---|---|---|
| Chiffrer l'affaire | 2.1 | **Commercial** |
| La marge se calcule (jamais saisie) | 2.2 | Consultée par DG, Directeur Financier, CCOO, Commercial - jamais par le Coordinateur Logistique |
| Seuils et dérogations | 2.3 | Réglés par le Directeur Financier ; la dérogation reste au DG |
| Approbation crédit puis marge | 2.4 | **Directeur Financier** (crédit), puis **DG** si la marge l'exige |
| Créer l'opération | 2.5 | **Coordinateur Logistique** |
| Affecter les moyens et le fret | 2.6 | **Coordinateur Logistique** |
| Lever les exigences du site de livraison | 2.6 | **Coordinateur Logistique** |
| Contrôle HSE : renseigner | 2.7 | **Agent terrain** |
| Contrôle HSE : valider ou rejeter | 2.7 | **Contrôleur HSE** (à distance, depuis sa propre tablette) |
| Relever les volumes (chargement, livraison) | 2.8 | **Agent terrain** |
| Déclarer un incident (si besoin) | 2.8 | **Agent terrain** |
| Suivre la progression, clôturer, signer | 2.8 | **Agent terrain**, avec le représentant du client pour le bon de livraison |
| Scellement des documents | 2.9 | Automatique dès les signatures réunies ; manuel possible pour DG, CCOO, Directeur Financier, Comptable |
| Facturer | 2.10 | **CCOO, Directeur Financier ou Comptable** (création) ; **Comptable/Directeur Financier** (encaissement) |
| Point mort et pilotage | 2.12 | **DG, Directeur Financier** |

## 2.1 Chiffrer une affaire (Commercial)

Une affaire naît d'un écran de création qui rassemble tout ce qu'un devis doit fixer :

- **Client** et **Produit** - obligatoires.
- **Segment commercial** (Maritime, Entreprises, Stations-service) - il détermine la grille de seuils de marge applicable (§ 2.3) et les pools de charges indirectes qui s'appliqueront (§ 2.2).
- **Site de livraison connu** (facultatif) - choisi dans la liste des sites déjà référencés (Partie 1, groupe Référentiel logistique), **jamais** propre à ce client : le même site peut servir plusieurs clients. À côté, un champ **Lieu de livraison** en texte libre reste obligatoire dans tous les cas - une adresse de circonstance qui n'a pas encore de fiche site n'empêche pas de chiffrer.
- **Volume contracté**, son **unité**, et le **mode de transport** - absents pour un produit *service* (une prestation de barge, par exemple), qui n'a ni volume ni transport à proprement parler.
- **Devise** et **Prix de vente unitaire** - saisi, et modifiable jusqu'à la facturation.
- **Prix d'achat** - jamais saisi directement : il vient d'un **prix fournisseur déjà validé par le DG** (Partie 1, groupe Tiers et engagements commerciaux). Chiffrer une affaire est donc une raison de plus pour ne jamais laisser un prix fournisseur en attente de validation.
- **Remise** (facultative) - un montant ou un pourcentage.
- **Charges directes chiffrées** - le transport, la manutention, l'inspection, chacune sur son poste de coût, à sa **base** propre (au litre pour un transport, au forfait pour une inspection, imposée par le barème et non choisie par le commercial). Sans elles, la marge annoncée à l'approbation ignore ces montants et paraît meilleure qu'elle ne l'est - c'est précisément ce que le chiffrage sert à éviter.

À la création, l'affaire prend le statut **Brouillon**, puis évolue au fil de l'étude (**Étude de faisabilité**, **Chiffrée**) jusqu'à sa soumission, § 2.4.

## 2.2 La marge : comment elle se calcule

Deux marges sont affichées sur toute affaire, jamais une seule : la **marge directe**, qui ne regarde que ce qui est propre à cette affaire, et la **marge complète**, qui y ajoute la part des charges de structure qui lui revient. C'est TOUJOURS la marge complète qui est comparée aux seuils (§ 2.3).

### Marge directe

```
marge directe = prix de vente - remise/unité - prix d'achat - charges directes/unité - coût de portage/unité
```

Le **coût de portage** mérite un mot : c'est le coût de trésorerie du décalage entre le moment où vous payez votre fournisseur et le moment où votre client vous paie. Il se calcule à partir du délai de paiement accordé au client, du délai obtenu du fournisseur (souvent négatif chez Elyon : le fournisseur est payé **avant** livraison), et du taux de financement de l'exercice en cours - jamais un taux global figé dans le code, toujours celui que le Directeur Financier a saisi pour cet exercice précis (Partie 1, groupe Marché et pilotage).

### Marge complète, et le taux d'absorption

```
marge complète = marge directe - charges indirectes/unité
```

Les **charges indirectes par unité** ne sont pas un chiffre unique tombé du ciel : elles sont la **somme des taux d'absorption de tous les pools de charges indirectes qui couvrent le segment de l'affaire**. Un pool sans segment déclaré couvre tous les segments ; trois pools actifs (Administration, Finance, HSE, par exemple) donnent une charge indirecte qui est la somme des trois taux, jamais une moyenne ni un seul retenu.

Le **taux d'un pool**, lui, se calcule ainsi et ne se saisit **jamais** directement :

```
taux du pool = budget annuel du pool ÷ assiette
```

où l'**assiette** est la somme des volumes de la **prévision de vente budgétée** de l'exercice, sur les segments que ce pool couvre (Partie 1, § Marché et pilotage). C'est pour cette raison que la prévision de vente doit exister **avant** qu'on puisse saisir le budget d'un pool - l'ordre du menu Paramétrage le respecte déjà (Partie 1, § 1.2). Deux garde-fous stricts, sans exception : l'assiette refuse de mélanger des unités différentes (litres et tonnes n'ont rien à additionner), et elle refuse de se calculer si aucune prévision n'existe encore pour ces segments - dans les deux cas, l'outil arrête tout avec un motif écrit plutôt que de deviner.

### Exemple chiffré réel (FCFA par litre)

| Poste | Valeur |
|---|---|
| Prix de vente | 800 |
| Prix d'achat | -700 |
| Charges directes | -44,7222 |
| **= MARGE DIRECTE** | **55,2778** |
| Charges indirectes | -17 |
| **= MARGE COMPLÈTE** | **38,2778** |

Cette marge n'est jamais figée après approbation : elle est **recalculée en direct** à chaque consultation de l'affaire, contre les taux courants du moment. Elle est aussi **recalculée et réécrite automatiquement** dès qu'une charge change - l'ajout d'une ligne de coût sur une opération ou l'affectation d'un fret déclenchent ce recalcul tout seuls, sans geste manuel.

**Qui voit la marge ?** Le Coordinateur Logistique ne la voit jamais - il voit déjà le prix de vente, et un prix d'achat visible à côté livrerait la marge par simple soustraction. Ce n'est pas un oubli d'écran, c'est une règle délibérée.

## 2.3 Seuils et dérogations (réglés par le Directeur Financier, dérogation au DG)

Deux seuils, réglés par segment, produit, devise et unité (Partie 1, § Marché et pilotage), s'opposent à la marge complète :

- **Plancher direct** - un blocage dur : l'opération ne couvre pas ses propres coûts. Une dérogation du DG est obligatoire pour passer outre.
- **Seuil de marge** - en dessous, l'affaire n'est pas refusée mais elle appelle l'**accord du DG** avant de continuer (§ 2.4).

## 2.4 L'approbation (Directeur Financier, puis DG si besoin)

Une affaire chiffrée n'engage rien tant qu'elle n'a pas franchi ces étapes, dans cet ordre :

1. **Soumission au risque crédit** (statut *En attente de risque*) - le Directeur Financier vérifie l'exposition du client. Si le plafond de crédit est dépassé, l'affaire passe **Bloquée pour crédit** jusqu'à ce qu'une garantie (Partie 1) réduise l'exposition, ou que le plafond soit revu.
2. **Accord du DG** (statut *En attente d'accord DG*) - déclenché uniquement si la marge est sous le seuil (§ 2.3). Tant que personne ne tranche, l'affaire reste bloquée, et une tâche l'annonce explicitement à qui doit agir (« Bloquant : quelqu'un attend », visible sur le tableau de bord).
3. **Approuvée** - l'affaire peut être envoyée au client (proforma), puis marquée acceptée ou refusée par lui, avant de passer **En exécution** : c'est à partir de là qu'on peut créer des opérations (§ 2.5).

Toute dérogation (au plancher direct, à un prix d'achat hors bande, à un plafond de crédit) laisse une trace : auteur, motif, horodatage - jamais un contournement silencieux.

## 2.5 Créer une opération à partir de l'affaire (Coordinateur Logistique)

Une opération représente un mouvement physique concret : un camion qui charge, une barge qui livre. Elle naît toujours d'une affaire déjà approuvée - la base refuse de créer une opération sur une affaire qui ne l'est pas, avec son motif, jamais silencieusement.

- **Déroulé des types** - une opération peut enchaîner plusieurs types (transport routier, puis soutage à quai, par exemple). L'ordre choisi **est** le déroulé réel : ce n'est pas une liste de cases à cocher, mais une séquence qu'on monte, descend ou retire, parce que l'agent terrain recevra ses contrôles HSE dans cet ordre précis. Une opération reçoit l'**union** des checklists de tous ses types.
- **Volume, unité, mode de transport** - repris de l'affaire par défaut, modifiables : une affaire s'exécute souvent en plusieurs opérations.
- **Site de livraison** - jamais un choix ici. Il est **hérité automatiquement du site de l'affaire** : une opération qui s'écarterait du lieu contracté serait une erreur, pas une variante légitime, et l'écran ne fait que l'annoncer, sans jamais permettre de le changer.

### Le cycle de vie d'une opération

Une fois créée, une opération suit sa **propre** progression de statuts, distincte de celle de l'affaire : *Brouillon* → *Sourcing* → *Préparation HSE* (ou *Bloquée HSE*, § 2.7) → *Planifiée* → *Chargement* → *En transit* → *Livraison* → *Contrôle final* → **Close**. Deux issues de secours existent à tout moment : *Incident* et *Annulée*.

Qui fait avancer ce statut ? Deux mains, pas une seule :

- Le **Coordinateur Logistique** (ou le CCOO, ou le DG) depuis la console interne, pour tout ce qui se décide au bureau.
- L'**agent terrain**, depuis sa tablette, à mesure qu'il avance réellement sur le terrain - y compris **hors connexion** : la mise à jour part en attente sur l'appareil et se synchronise dès que le réseau revient, elle n'est jamais perdue.

Chaque action envoyée depuis la tablette (checklist, relevé, avancement, incident) reçoit l'un de quatre sorts, et l'écran le dit sans détour :

- **Enregistré** - l'effet est en base, l'agent peut passer à la suite.
- **Refusé** - la base a examiné la demande et l'a rejetée, avec son motif affiché en entier. Cette tentative-là ne repart jamais toute seule : l'agent doit **refaire le geste**, ce qui produit un événement neuf.
- **Conservé** - un refus antérieur sur la **même opération** n'a pas encore été résolu ; cette action-ci attend derrière lui et repartira d'elle-même une fois le refus corrigé.
- **Mis en file** - la tablette n'a pas encore pu joindre le serveur (pas de réseau, ou pas de réponse) ; rien n'est ni acquis ni perdu, l'envoi reprendra tout seul.

Un refus jamais repris reste visible du Coordinateur Logistique, regroupé par opération, sur le tableau de bord des tâches - c'est lui qui relance l'agent si un refus traîne.

## 2.6 Affecter les moyens et le tarif de fret (Coordinateur Logistique)

Affecter un véhicule, un chauffeur et un transporteur à une opération suppose qu'ils soient **conformes** - une pièce à jour (assurance, agrément, visite technique...) enregistrée dans l'écran Conformité. Un moyen non conforme ne peut être affecté sans dérogation du DG.

Le **fret retenu** est confronté au tarif négocié pour ce transporteur, ce mode et ce trajet (Partie 1, § Référentiel logistique). Sans tarif négocié pour ce transporteur, l'affectation n'est pas bloquée - un transporteur d'appoint doit rester mobilisable un jour de rupture. Mais si un tarif existe et que le montant retenu s'en écarte au-delà de la tolérance négociée (réglée à 0 % par défaut, une règle stricte de la direction), un **motif circonstancié d'au moins dix caractères est exigé** avant d'enregistrer l'affectation. Un écart qu'on ne motive pas aujourd'hui, personne ne saura l'expliquer dans six mois.

### Lever les exigences du site de livraison

Un site (Partie 1, § Référentiel logistique) peut porter des **exigences** propres - un badge d'accès, un créneau réservé, une procédure particulière - saisies une fois pour toutes au paramétrage du site, et **jamais** propres à un client : plusieurs clients se faisant livrer au même site en héritent tous.

Sur la fiche de l'opération, chaque exigence du site apparaît, **Bloquante** ou non. Pour chacune, le Coordinateur Logistique **atteste** qu'elle est concrètement levée - avec une note libre décrivant ce qui a été fait (« badge n° 4471 retiré le 06/08 ») - avant que l'opération ne parte. Une exigence bloquante non attestée empêche le chargement ou la livraison selon le cas ; laisser cette attestation pour plus tard revient à découvrir le blocage au moment du chargement, quand il est déjà trop tard pour retirer un badge.

## 2.7 Le contrôle HSE : renseigner, puis valider

Chaque opération porte sa checklist, dérivée de l'union de ses types (§ 2.5). Deux gestes distincts, par deux personnes distinctes :

- L'**agent terrain** *renseigne* chaque point de contrôle sur sa tablette, au fil de l'opération. Il ne valide rien : renseigner n'est pas trancher.
- Le **contrôleur HSE** *valide* ou *rejette* la checklist - depuis son propre accès terrain, à distance, sans avoir à se déplacer sur le site lui-même. Un rejet exige un motif et laisse la checklist modifiable, ce n'est pas un refus définitif. Dans certains cas, un agent en **délégation active** (suppléance du contrôleur, § Partie 4) peut valider à sa place ; en dehors de toute délégation, la base refuse la tentative avec son motif exact, jamais un simple accès refusé muet.

Un **point bloquant** non satisfait empêche l'opération d'avancer : le verrou s'affiche noir sur blanc (nombre de points bloquants en attente, dérogation en cours ou non), et se lève de deux façons seulement - le point est satisfait, ou le DG accorde une dérogation, tracée comme toute dérogation (§ 2.4).

## 2.8 Le terrain : suivi, clôture et signatures (Agent terrain)

Sur sa tablette, l'agent d'opération retrouve ses opérations en cours (et un historique paginé des opérations closes). Pour chaque opération, il dispose d'une **fiche de site** - adresse, consignes d'accès et de sécurité, contacts du client rattachés à l'affaire - et, au fil de sa progression, il renseigne la checklist HSE (§ 2.7) et fait avancer le statut de l'opération (§ 2.5).

### Relever les volumes (chargement et livraison)

À chaque bout de l'opération, l'agent relève **ce qu'il voit à la jauge** - jamais un volume déjà corrigé - accompagné de la **température observée** à cet instant, de la **densité mesurée à 15 °C**, et coche le cas échéant **Produit hors spécification**. C'est volontaire : d'anciens écrans demandaient un volume « déjà ramené à 15 °C » que personne ne corrigeait réellement, et un produit à 32 °C au chargement puis 26 °C à la livraison affichait un écart de dilatation pris pour une perte, plus du double du seuil critique. Le serveur applique désormais lui-même la correction physique (ASTM D1250) à partir des deux températures et des deux volumes observés.

**Un écart entre le volume chargé et le volume livré reste, chez Elyon, un signal, jamais un coût.** La règle de la direction est explicite : *« je livre ce que j'ai chargé »*. Le volume facturé au client est toujours le volume **chargé**, quel que soit l'écart constaté à la livraison. Cet écart alimente des statistiques et des alertes internes (qualité de transport, de jaugeage, de sûreté) - il ne réduit jamais une marge, ne se traduit jamais en ligne de coût, et ne modifie jamais une facture.

### Déclarer un incident

À tout moment de l'opération, l'agent peut **déclarer un incident** - un type, une gravité, un titre, une description d'au moins dix caractères et, en option, un lieu précis. Cela ouvre un événement HSE rattaché à l'opération ; ce n'est pas la même chose que de faire passer l'opération au statut *Incident* (§ 2.5) - une décision qui reste à l'appréciation de la coordination, au vu de la gravité réellement déclarée.

À la fin de l'opération, **une seule action** - *Clôturer l'opération* - génère **en même temps** les deux documents attendus :

- Le **rapport d'exécution**, qui n'exige que la signature de l'agent.
- Le **bon de livraison**, qui exige **deux signatures** - celle de l'agent et celle du **représentant du client**, toutes deux sur la tablette, sur place.

Les pièces jointes (photos) suivent le régime photographique propre au point de contrôle concerné - interdite en zone classée, facultative, ou exigée avant même d'enregistrer le point.

**Dès que les signatures requises sont réunies, le document se scelle automatiquement** (§ 2.9) - personne n'a besoin de cliquer quoi que ce soit d'autre. Pour le bon de livraison, cela veut dire concrètement : tant que le client n'a pas signé sur la tablette, le document reste modifiable ; à l'instant où il signe, il est scellé.

## 2.9 Scellement et vérification des documents

Un document produit reste rectifiable tant qu'il n'est pas **scellé**. Le scellement verrouille définitivement son contenu - empreinte, taille, fichier - et c'est ce qui donne sa valeur au **QR code d'authenticité** imprimé dessus :

- Chaque document porte un jeton d'authenticité imprévisible, généré avant même l'impression.
- Comme vu en § 2.8, le scellement est **automatique** dès que les signataires requis sont réunis. Un scellement manuel reste possible depuis la console interne (DG, CCOO, Directeur Financier, Comptable) pour les cas qui ne passent pas par ce circuit de signature.
- Le QR code renvoie vers une page de vérification **publique**, accessible à un client, un assureur ou un auditeur sans aucun compte.
- Cette page ne révèle que la nature du document, sa référence, son empreinte et son statut de scellement - jamais un montant, un client ni une marge.
- Une correction après scellement ne réécrit **jamais** l'original : elle crée un nouveau document (« annule et remplace »), avec son propre jeton. L'ancien reste vérifiable, mais annoncé comme remplacé.

## 2.10 Facturer (CCOO, Directeur Financier, Comptable - Chargé de Clientèle pour la création seule)

**Facturer ne dépend d'aucune opération, ni de sa clôture.** La seule condition posée par la base est que l'**affaire** soit **Approuvée** (§ 2.4) - exactement la même condition que pour créer une opération (§ 2.5). Les deux découlent indépendamment de l'affaire approuvée : chez Elyon, *« le volume commandé est le volume livré »*, la facture ne s'aligne jamais sur l'avancement réel d'une opération. On peut donc facturer avant qu'une opération existe, pendant son exécution, ou après sa clôture - peu importe : rien dans la facture ne référence une opération.

La facture suit un cycle propre à elle :

1. **Création** - une proforma, chiffrée sur l'affaire.
2. **Conversion** - la proforma devient la facture définitive.
3. **Émission** - transmise à la DGI si le paramètre système `FISCAL_NORMALIZED_INVOICING` l'exige ; en cas d'échec de la transmission, une reprise dédiée relance l'envoi sans tout ressaisir.
4. **Annulation** (DG, Directeur Financier ou Comptable seulement) - reste possible, motivée.

Deux règles s'imposent à tout montant facturé, vérifiées par la base et non par confiance :

- La **TVA est extraite** du total, jamais ajoutée par-dessus : `total = brut - réduction`, la TVA étant comprise dans ce total, pas rajoutée après coup.
- Le **montant brut** vaut toujours le volume multiplié par le prix - jamais un chiffre saisi à côté qui pourrait diverger du détail de la ligne.

## 2.11 Encaisser et gérer le crédit (Directeur Financier, Comptable)

Le règlement d'une facture s'enregistre comme **paiement**, réservé au Directeur Financier et au Comptable - ni le Commercial ni le Coordinateur Logistique n'y touchent. L'**exposition crédit** d'un client (ce qu'il doit, plus ce qui est engagé mais pas encore facturé) se compare en permanence à son plafond ; une **garantie active et non échue** (Partie 1) la réduit d'autant - son montant est calculé au cours du jour, jamais saisi à la main, pour qu'on ne puisse pas ouvrir un plafond en écrivant simplement un nombre.

## 2.12 Le point mort et le pilotage (DG, Directeur Financier)

Tout ce qui vient d'être saisi - prévision de vente, budgets de pools, nature FIXE ou VARIABLE de chaque pool (Partie 1) - alimente en fin de chaîne le **point mort** de l'exercice :

```
point mort = charges fixes de l'exercice ÷ marge sur coût variable
```

Les **charges fixes** sont la somme des budgets des seuls pools déclarés de nature FIXE - jamais ressaisies séparément : le budget d'un pool sert deux fois, au taux d'absorption ET aux charges fixes, une seule saisie ne pouvant jamais diverger d'elle-même. La **marge sur coût variable** ne retient que la marge directe des affaires, pondérée par le volume réellement réalisé. Le résultat s'exprime en **volume**, jamais en devise : c'est le volume qu'il faut vendre pour que l'exercice s'équilibre, pas un montant qui bougerait au gré du taux de change.

---

*Fin de la Partie 2.*

---

# Partie 3 - Le portail client

Cette partie s'adresse à toute personne qui doit expliquer le portail à un client, ou qui accompagne un client dans sa prise en main. Elle décrit ce qu'un client voit et peut faire, seul, sur son propre espace - de sa première connexion à la consultation de sa dernière facture, sans aucune assistance d'Elyon Trading.

## 3.0 Ce que le portail est, et ce qu'il n'est pas

Le portail (`portail.elyon-trading.com`, Partie 0 § 0.1) est un espace de **consultation et de deux gestes précis**, jamais un écran de travail complet. Un client n'y chiffre rien, n'y crée pas d'opération, ne voit ni prix d'achat ni marge ni encours de crédit : ces informations ne sont tout simplement jamais transmises par le serveur à cet espace, ce n'est pas un filtrage d'écran qui pourrait s'oublier quelque part.

Un client peut faire exactement trois choses en écriture, rien de plus :

1. **Déposer une demande de cotation** (§ 3.3).
2. **Approuver une offre reçue** sur cette demande (§ 3.3).
3. **Accepter la proforma** d'une affaire déjà chiffrée (§ 3.4).

Toute autre évolution - chiffrage, planification, exécution, facturation - reste entièrement du ressort d'Elyon Trading, décrite en Partie 2.

**Un compte portail est rattaché à un seul tiers**, créé une seule fois par un commercial depuis la fiche de ce tiers (Partie 0, § 0.5) - jamais par le client lui-même, jamais en autonomie. Il n'existe qu'un seul type de compte client : pas de rôle à distinguer, pas de menu qui varierait d'un client à l'autre.

## 3.1 Se connecter

L'écran de connexion se présente sur fond de marque Elyon Trading, avec une carte blanche : *« Bienvenue - Connectez-vous à votre espace ELYON TRADING »*. Deux champs, **Email** et **Mot de passe** (avec un bouton en forme d'œil pour l'afficher ou le masquer), puis **Se connecter**. En bas de carte : *« Portail client : accès réservé aux comptes rattachés à un tiers. Besoin d'aide ? Contactez votre interlocuteur Elyon Trading. »* - c'est la seule voie de recours prévue pour un client en difficulté : il n'y a pas de mot de passe oublié en libre-service sur cet espace.

Une erreur de connexion s'affiche dans un bandeau rouge, avec le motif exact renvoyé par le serveur, ou à défaut *« Connexion impossible »*.

Comme pour tout compte de l'ERP (Partie 0, § 0.2), un tout premier accès porte un **mot de passe provisoire** : un bandeau *« Mot de passe provisoire, un changement est requis »* reste affiché sur chaque écran, avec un lien **Le changer** vers **Mon compte** (§ 3.7). Ce bandeau ne bloque rien : le client peut consulter ses affaires ou ses factures avant même d'avoir changé son mot de passe, mais le bandeau reste jusqu'à ce que ce soit fait.

## 3.2 Se repérer : la coquille du portail

Une fois connecté, l'en-tête porte le logo Elyon Trading, le libellé « Portail client », puis à droite le nom et l'email du client connecté et un bouton **Déconnexion**. Le menu de gauche, sous le titre **Mon activité**, ne propose que cinq entrées, toujours dans le même ordre :

1. **Tableau de bord**
2. **Demandes de cotation**
3. **Affaires**
4. **Livraisons**
5. **Factures**

Ces cinq entrées sont **identiques pour tous les clients** - il n'existe pas de rôle côté portail qui en masquerait certaines : un client a un seul tiers à suivre, jamais plusieurs profils à démêler.

## 3.3 Demander un devis, puis approuver une offre

L'écran **Demandes de cotation** porte un sous-titre qui fixe d'emblée ce qu'il fait et ne fait pas : *« Exprimez un besoin : produit, volume, échéance souhaitée. Un commercial l'étudie et revient vers vous : cette demande ne vaut ni prix ni engagement. »*

Le formulaire **Nouvelle demande** rassemble :

- **Produit** - une liste déroulante qui ne montre jamais de tarif, seulement les produits qu'Elyon Trading propose.
- **Volume souhaité** et son **Unité** (Litre, Mètre cube, Tonne métrique, Baril).
- **Échéance de livraison souhaitée** (facultative).
- **Message** (facultatif), en texte libre.

**Envoyer la demande** ne devient actif qu'une fois le produit et le volume renseignés. Un message *« Demande envoyée »* confirme l'envoi. La demande apparaît alors dans le tableau du dessous, avec son statut : *Nouvelle*, *En cours d'étude*, *Proforma approuvée*, *Convertie en affaire*, ou *Déclinée*.

**Quand un commercial répond**, une ou plusieurs **proformas reçues** apparaissent sous la demande concernée : numéro, volume, unité et prix unitaire proposé. Pour chacune :

- si elle a déjà été retenue : un badge **Approuvée** ;
- si une autre proforma a été retenue sur la même demande : la mention **Non retenue** ;
- sinon : un bouton **Approuver cette offre**, qui confirme avec *« Offre {numéro} approuvée »*.

**Approuver une offre n'est pas la même chose que fixer un prix** : le client ne fait jamais que dire oui à un prix déjà proposé par un commercial - jamais le contraire. Si un document scellé existe pour cette proforma, un bouton **PDF** le télécharge directement.

## 3.4 Suivre ses affaires, et accepter une proforma

L'écran **Affaires** liste, en tableau, toutes les affaires du client : référence, produit, volume, incoterm, statut, et un lien **Consulter** vers le détail. Les statuts s'y lisent en clair, jamais sous leur nom technique : par exemple *À l'étude*, *Chiffrée*, *En instruction* (qui regroupe, sans les distinguer, l'attente de risque crédit, le blocage crédit et l'attente d'accord DG - un détail qui ne regarde pas le client), *Proforma envoyée*, *Acceptée*, *En cours d'exécution*, *Livrée*, *Facturée*, *Clôturée*...

**Le détail d'une affaire** ne montre ni prix d'achat, ni marge, ni aucun coût interne - seulement : le volume contracté, la devise, la date de création, et la date d'acceptation une fois qu'elle a eu lieu. Une section **Livraisons** y liste les opérations rattachées à cette affaire, avec leur propre statut.

**Quand une affaire atteint le statut « Proforma envoyée »**, un encart apparaît sur sa fiche : *« La proforma de cette affaire vous a été envoyée et attend votre acceptation »*, avec un bouton **Accepter la proforma**. C'est, dans tout le portail, **la seule transition de statut d'une affaire qu'un client peut lui-même déclencher** - toutes les autres (approbation crédit, accord DG, passage en exécution, livraison, facturation) restent au commercial ou à la direction, décrites en Partie 2. Accepter une proforma déjà acceptée, ou sur une affaire qui n'est pas à ce stade précis, est refusé avec un motif écrit, jamais silencieusement.

## 3.5 Suivre ses livraisons

L'écran **Livraisons** est **strictement de consultation** : aucun bouton, aucune action. Il liste, pour chaque opération rattachée à une affaire du client, son affaire d'origine, son volume, son mode de transport, sa destination et son statut - avec les mêmes libellés en clair que le détail d'une affaire (*Chargement*, *En transit*, *Livraison en cours*, *Clôturée*...).

**Ce que cet écran ne fait pas** : il n'offre ni QR code, ni vérification par scan d'un document - cette mécanique de vérification publique existe (Partie 2, § 2.9), mais uniquement sur la page dédiée que le QR code imprime sur un document, jamais comme fonction du portail lui-même.

## 3.6 Consulter ses factures

L'écran **Factures** porte, lui aussi, une précision en sous-titre : *« Vos factures émises par Elyon Trading. Les avoirs n'apparaissent pas ici. »* Le tableau donne, par facture : numéro, affaire, type (*Facture*, ou *Facture normalisée (FNE)*), volume, montant, montant déjà réglé, échéance, et statut (*Émise*, *Partiellement réglée*, *Réglée*, *Échue*, *En litige*, *Annulée*).

**Une facture qui n'a pas encore été formellement émise n'apparaît jamais ici**, pas plus qu'un avoir : ce ne sont pas des lignes filtrées à l'affichage, le serveur ne les transmet tout simplement pas à cet espace. Le bouton **PDF**, quand un document scellé existe, télécharge la facture.

## 3.7 Mon compte

Accessible depuis le lien du bandeau de mot de passe provisoire, cet écran affiche le nom et l'email du client puis un formulaire **Mot de passe** : **Mot de passe actuel**, **Nouveau mot de passe**, avec deux règles cochées en direct au fur et à mesure de la saisie (*Au moins 12 caractères*, *Différent de l'actuel*). **Changer le mot de passe** ne devient actif que lorsque les deux règles sont satisfaites. C'est le **seul** réglage personnel disponible sur le portail : pas de coordonnées à modifier, pas de préférence à régler.

## 3.8 Ce qui protège un client des données d'un autre

Chaque écran du portail n'interroge jamais que les données du tiers auquel le compte est rattaché - ce rattachement vient du jeton de connexion, jamais d'un identifiant que l'écran transmettrait lui-même. Tenter d'accéder à une affaire qui n'est pas la sienne, par exemple en modifiant une adresse dans le navigateur, rend exactement le même résultat qu'une affaire qui n'existe pas : *« Affaire introuvable »* - jamais un message qui confirmerait que l'affaire existe chez un autre client.

Chaque action du client - déposer une demande, approuver une offre, accepter une proforma - est enregistrée dans l'audit de l'application au même titre que toute action interne, avec l'identité du compte portail qui l'a faite.

---

*Fin de la Partie 3.*

---

# Partie 4 - Fiches par rôle

Cette partie ne se lit pas d'un bout à l'autre : chacun y cherche sa propre fiche, ou celle d'un collègue dont il doit comprendre le rôle. Chaque fiche résume, pour un rôle donné, ce qu'il peut faire à travers tout ce qui précède (Parties 1 à 3), puis ce qu'il **ne peut jamais** faire - ce deuxième point est souvent le plus utile : un bouton absent n'est pas une panne, c'est une frontière voulue.

Trois espaces, jamais mélangés (Partie 0, § 0.1) : un rôle de la console interne n'a aucun pouvoir côté terrain ou portail, et réciproquement.

## Console interne

### DG - Direction Générale

L'autorité de dernier ressort. Voit tout, y compris la marge et le prix d'achat de toute affaire (Partie 2, § 2.2).

**Peut notamment** : approuver le risque crédit d'une affaire et accorder sa dérogation propre (§ 2.4) ; valider seul un prix fournisseur (Partie 1, § Groupe 2) ; accorder une suppléance HSE à un agent, et valider une checklist à la place du contrôleur une fois cette suppléance accordée (§ 2.7) ; réviser une dérogation exceptionnelle ; annuler une facture émise ; gérer les comptes internes et terrain (Partie 0, § 0.5) ; régler qui voit quel écran, depuis **Accès aux écrans**.

**Ne peut jamais** : encaisser un paiement (réservé au Directeur Financier et au Comptable) ; se retirer lui-même l'accès à l'écran **Accès aux écrans** - cette route reste ouverte au DG quoi qu'il règle par ailleurs, pour ne jamais s'enfermer dehors.

### Assistant DG

Coordination transverse, en lecture large sur presque tout - avec une compétence d'écriture qui n'appartient qu'à elle.

**Peut notamment** : rédiger et modifier le contenu des **procédures opérationnelles** rattachées à chaque type d'opération - tous les autres rôles internes ne font que les lire ; consigner une interaction CRM ; déclarer un événement HSE ; déposer des documents et enregistrements de conformité.

**Ne peut jamais** : créer, transitionner ou approuver une affaire, une opération ou une facture ; valider ou rejeter une checklist HSE ; encaisser un paiement ; gérer un compte utilisateur.

### CCOO - Directeur Commercial & Opérations

Le rôle le plus transverse après le DG : présent dans presque tous les domaines métier, sans porter les décisions financières les plus sensibles.

**Peut notamment** : créer une affaire, la soumettre, y rattacher un prix fournisseur et ses lignes de coût (comme le Commercial) ; créer une opération, l'affecter, la faire avancer ; créer une facture, la convertir, l'émettre, relancer une transmission FNE ; créer et faire avancer une opportunité CRM ; créer un accès portail depuis la fiche d'un tiers.

**Ne peut jamais** : encaisser un paiement ni annuler une facture émise ; valider ou rejeter une checklist HSE ; gérer un compte interne ou terrain.

### Chargé de Clientèle & Devis (Commercial)

Rôle commercial de première ligne, cantonné au cycle de vente.

**Peut notamment** : créer une affaire, la soumettre pour approbation du risque, y rattacher un prix fournisseur validé et ses charges directes chiffrées (§ 2.1) ; créer et faire avancer une opportunité ou une demande de cotation (portail, § 3.3) ; créer une facture (mais pas la convertir ni l'émettre) ; créer un accès portail depuis la fiche d'un tiers.

**Ne peut jamais** : approuver le risque crédit ni la dérogation DG de sa propre affaire ; créer ou piloter une opération de transport ; convertir, émettre, annuler une facture, ni encaisser un paiement ; voir le journal d'audit.

### Coordinateur Logistique & Sourcing

Rôle opérationnel, structurellement privé de la vision financière des affaires - une restriction posée au niveau du serveur, pas seulement masquée à l'écran (§ 2.2).

**Peut notamment** : créer une opération à partir d'une affaire approuvée, affecter véhicule/chauffeur/transporteur et le fret (§ 2.5-2.6), lever les exigences du site de livraison, enregistrer un relevé de volume (§ 2.8), rattacher une dérogation HSE ; déposer des documents de conformité ; consulter (sans les valider) les checklists HSE.

**Ne peut jamais** : voir la marge ou le prix d'achat d'une affaire, quel que soit l'écran ; valider ou rejeter une checklist HSE ; encaisser un paiement ni créer une facture ; gérer un compte terrain - « il affecte des agents à des opérations, il ne gouverne pas leurs accès ».

### Directeur Financier

Gouvernance financière, co-titulaire de l'encaissement avec le Comptable.

**Peut notamment** : approuver le risque crédit d'une affaire (avec le DG) ; créer, convertir, émettre, annuler une facture et **encaisser un paiement** ; consulter et relancer le recouvrement (créances échues) ; régler les seuils de marge, taux de financement, tolérances et budgets (Partie 1, Groupes 5 et 6) ; créer et révoquer une dérogation.

**Ne peut jamais** : valider seul un prix fournisseur (réservé au DG) ; réviser seul une dérogation exceptionnelle (réservé au DG) ; gérer un compte utilisateur ; créer ou piloter une opération de transport.

### Comptable / Chargé Recouvrement

Périmètre resserré sur la facturation, l'encaissement et le recouvrement.

**Peut notamment** : créer, convertir, émettre une facture, relancer une transmission FNE, annuler une facture (avec DG/Directeur Financier) et **encaisser un paiement** (avec le Directeur Financier) ; consulter et relancer le recouvrement ; créer, encaisser et solder une facture fournisseur.

**Ne peut jamais** : créer, affecter ou transitionner une affaire ou une opération ; valider un prix fournisseur ; réviser ou créer seul une dérogation ; gérer un compte utilisateur.

### IT Admin

Le seul rôle interne sans aucun accès métier (ventes, opérations, facturation, HSE) - un rôle purement technique.

**Peut notamment** : gérer les comptes internes et terrain (avec le DG, Partie 0, § 0.5) ; consulter le journal d'audit complet (avec le DG) ; régler les paramètres système les plus techniques (avec DG et Directeur Financier).

**Ne peut jamais** : voir ou agir sur une affaire, une opération, une facture, un paiement, une checklist HSE ou un tiers commercial ; créer un accès portail - c'est un geste commercial, pas un geste d'exploitation, délibérément hors de son périmètre.

## Terrain

### Agent d'opération

Ne voit **que** les opérations qui lui sont personnellement affectées (Partie 2, § 2.8).

**Peut notamment** : renseigner chaque point de la checklist HSE, sans jamais la valider (§ 2.7) ; relever les volumes au chargement et à la livraison, déclarer un incident (§ 2.8) ; **seul habilité** à générer la clôture de l'opération - rapport d'exécution et bon de livraison en une seule action (§ 2.8) ; signer les documents produits.

**Ne peut jamais** : valider sa propre checklist HSE, sauf suppléance active et tracée accordée par le DG (§ 2.7) ; voir les opérations d'un autre agent ; clôturer une opération qui ne lui est pas affectée.

### Contrôleur HSE

Voit ses propres opérations affectées, plus toute opération dont une checklist attend spécifiquement sa validation - jamais plus : « il ne peut pas valider ce qu'il ne peut pas ouvrir ».

**Peut notamment** : valider ou rejeter une checklist HSE à distance, depuis son propre accès terrain (§ 2.7) ; recevoir une suppléance du DG, ou en accorder une compréhension inverse selon la délégation en cours.

**Ne peut jamais** : générer la clôture d'une opération - réservée à l'agent d'opération ; renseigner à la place de l'agent les points qu'il doit ensuite juger objectivement ; voir une opération hors de son périmètre de validation.

## Portail

### Client (compte portail)

Un seul type de compte, sans sous-rôle, rattaché à un unique tiers (Partie 3, § 3.0).

**Peut** : consulter le catalogue de produits (sans tarif), déposer une demande de cotation et approuver une offre reçue (§ 3.3), consulter ses affaires et **accepter une proforma** - sa seule action possible sur une affaire (§ 3.4), consulter ses livraisons et ses factures, télécharger ses documents scellés, changer son propre mot de passe.

**Ne peut jamais** : créer son propre accès - un accès portail naît toujours d'un geste commercial, depuis la fiche du tiers, jamais en autonomie (Partie 0, § 0.5) ; voir les données d'un autre tiers ; agir sur la facturation, les prix ou les marges - aucune de ces actions n'existe côté portail.

---

*Fin de la Partie 4.*

---

# Partie 5 - Lexique et formules

Cette partie est une référence, pas une lecture suivie : un formulaire complet des calculs déjà rencontrés, puis la table exhaustive des statuts d'une affaire et d'une opération (les Parties 2 et 3 n'en citaient que les principaux), et enfin un lexique des termes qui reviennent partout dans ce manuel.

## 5.1 Formulaire

**Marge directe** (Partie 2, § 2.2) :

```
marge directe = prix de vente - remise/unité - prix d'achat - charges directes/unité - coût de portage/unité
```

**Coût de portage** (Partie 2, § 2.2) - le coût de trésorerie du décalage entre le paiement au fournisseur et le règlement du client, fonction du délai client, du délai fournisseur et du taux de financement de l'exercice courant. Aucune formule fermée n'est donnée dans ce manuel au-delà de cette définition : le calcul dépend du sens des délais (le fournisseur est souvent payé avant livraison chez Elyon, ce qui inverse son effet).

**Marge complète** (Partie 2, § 2.2) - celle qui est comparée aux seuils :

```
marge complète = marge directe - charges indirectes/unité
charges indirectes/unité = somme des taux d'absorption des pools qui couvrent le segment de l'affaire
taux d'un pool = budget annuel du pool ÷ assiette
assiette = somme des volumes de la prévision de vente budgétée, sur les segments couverts par ce pool
```

**Facturation** (Partie 2, § 2.10) - la TVA est extraite du total, jamais ajoutée par-dessus :

```
total facturé = brut - réduction (TVA comprise dans ce total)
montant brut = volume × prix
```

**Point mort** (Partie 2, § 2.12) - exprimé en volume, jamais en devise :

```
point mort = charges fixes de l'exercice ÷ marge sur coût variable
charges fixes = somme des budgets des pools déclarés de nature FIXE
marge sur coût variable = marge directe des affaires, pondérée par le volume réellement réalisé
```

## 5.2 Table complète des statuts d'une affaire

Dix-sept statuts au total. Les Parties 2 et 3 n'en nommaient que les principaux au fil du récit ; les voici tous, dans l'ordre où une affaire les traverse (les embranchements, comme *Acceptée* ou *Refusée par le client*, sont deux issues possibles d'une même étape, jamais les deux à la fois) :

| Statut technique | Libellé à l'écran | Sens |
|---|---|---|
| `DRAFT` | Brouillon | Vient d'être créée, § 2.1 |
| `FEASIBILITY_STUDY` | Étude de faisabilité | En cours de chiffrage |
| `QUOTED` | Chiffrée | Chiffrage terminé, pas encore soumise |
| `PENDING_RISK` | Contrôle du risque | Soumise, attend le Directeur Financier, § 2.4 |
| `CREDIT_BLOCKED` | Bloquée pour crédit | Plafond de crédit dépassé, § 2.4 |
| `PENDING_DG_APPROVAL` | Accord DG attendu | Marge sous le seuil, § 2.3-2.4 |
| `APPROVED` | Approuvée | Peut être envoyée au client |
| `PROFORMA_SENT` | Proforma envoyée | Attend l'acceptation du client, § 3.4 |
| `CUSTOMER_ACCEPTED` | Acceptée par le client | Le client a accepté la proforma |
| `REJECTED_BY_CLIENT` | Refusée par le client | Le client a refusé la proforma |
| `IN_EXECUTION` | En exécution | Des opérations peuvent être créées, § 2.5 |
| `DELIVERED` | Livrée | Entièrement livrée |
| `PARTIALLY_DELIVERED` | Partiellement livrée | Livraison en cours |
| `QUALITY_CLAIM` | Réclamation qualité | Litige sur la qualité de la marchandise livrée |
| `INVOICED` | Facturée | Facturation émise, § 2.10 |
| `DISPUTED` | Litige | Contestation en cours, hors qualité |
| `CLOSED` | Clôturée | Dossier clos |
| `CANCELLED` | Annulée | Abandonnée avant exécution |

## 5.3 Table complète des statuts d'une opération

Douze statuts, décrits au fil de la Partie 2, § 2.5 :

| Statut technique | Libellé à l'écran | Sens |
|---|---|---|
| `DRAFT` | Brouillon | Vient d'être créée |
| `SOURCING` | Sourcing | Recherche des moyens |
| `HSE_PREPARATION` | Préparation HSE | Checklist en cours de constitution |
| `HSE_BLOCKED` | Bloquée HSE | Un point bloquant attend, § 2.7 |
| `PLANNED` | Planifiée | Moyens affectés, prête à partir |
| `LOADING` | Chargement | En cours de chargement |
| `IN_TRANSIT` | En transit | Chargée, en acheminement |
| `DELIVERING` | Livraison | Livraison en cours |
| `FINAL_CHECK` | Contrôle final | Avant clôture |
| `CLOSED` | Clôturée | Rapport et bon de livraison scellés, § 2.8-2.9 |
| `INCIDENT` | Incident | Issue de secours, à tout moment |
| `CANCELLED` | Annulée | Issue de secours, à tout moment |

## 5.4 Lexique

**Assiette** - dans le calcul d'un taux d'absorption (§ 2.2), la somme des volumes de la prévision de vente budgétée sur les segments couverts par un pool. Ne mélange jamais deux unités différentes.

**Dérogation** - une exception tracée à une règle (plancher direct, plafond de crédit, moyen non conforme, verrou HSE...), toujours avec un auteur, un motif et un horodatage. Certaines exigent une revue mensuelle par le DG (§ 2.4, § 2.7).

**Historisé** (réglage) - une ligne qui ne se réécrit jamais : la corriger publie une nouvelle ligne datée, l'ancienne restant close à cette date (Partie 1, § 1.1). S'oppose à **Modifiable**.

**Poste de coût** - une ligne de charge, **Directe** (imputée à une opération précise) ou **Indirecte** (rattachée à un pool et absorbée au volume) (Partie 1, groupe Coûts et absorption).

**Pool de charges indirectes** - un regroupement de charges de structure (Administration, HSE, Informatique...) dont le budget annuel, divisé par une assiette de volume, donne un taux d'absorption par litre (§ 2.2).

**Réalme** - un des trois espaces étanches de l'application : console interne, terrain, portail (Partie 0, § 0.1). Un compte d'un réalme n'ouvre jamais un écran d'un autre.

**Scellement** - le verrouillage définitif d'un document produit (empreinte, taille, fichier), qui donne sa valeur au QR code de vérification publique imprimé dessus. Automatique dès les signatures requises réunies (§ 2.8-2.9).

**Segment (commercial)** - Maritime, Entreprises ou Stations-service : il détermine la grille de seuils de marge applicable et les pools de charges indirectes qui s'appliquent à une affaire (§ 2.1-2.2).

**Suppléance (HSE)** - une délégation tracée, accordée par le DG, qui permet à un agent d'assumer temporairement le rôle du contrôleur HSE - ou au DG de valider lui-même à sa place (§ 2.7, Partie 4).

**Taux d'absorption** - le budget annuel d'un pool de charges indirectes, divisé par son assiette de volume : la part de charge de structure qu'un litre doit porter (§ 2.2).

**Tiers** - toute personne morale ou physique avec laquelle Elyon Trading traite : client, fournisseur, transporteur, prospect ou inspecteur, tous dans un seul référentiel distingué par leur Nature (Partie 1, groupe Tiers et engagements commerciaux).

**Verrou** - un blocage dur posé par la base elle-même (plancher direct, contrôle HSE bloquant, moyen non conforme...), qui ne se lève que par les moyens explicitement prévus - jamais par un contournement silencieux.

---

*Fin du manuel. Pour tout écran ou action qui ne trouverait pas sa place ici, la règle de la Partie 0 reste la même : ce n'est pas à vous de deviner, signalez-le à votre DG ou à l'IT Admin.*
