# Manuel de formation - ERP Elyon Trading

> Document vivant, rédigé partie par partie. Chaque section est ancrée dans l'interface réelle de l'application au moment de la rédaction : libellés, boutons et messages sont ceux que vous verrez à l'écran, pas une paraphrase.

## Sommaire

- Partie 0 - Avant de commencer
- **Partie 1 - Les fondations du paramétrage** *(ce document)*
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

Avant qu'une affaire ne puisse se créer, l'outil doit connaître un minimum de choses : dans quelle devise on travaille, quels sont vos produits, quels tiers existent, quels sites livrent quoi. C'est l'objet de l'écran **Paramétrage**. Cette partie explique comment cet écran fonctionne, puis dans quel ordre le renseigner - un ordre qui n'est pas arbitraire : chaque réglage n'en vise jamais un autre qui n'aurait pas déjà été posé plus haut.

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

*Fin de la Partie 1. La Partie 2 reprend le fil : le cycle complet d'une affaire, du chiffrage à l'encaissement, avec chaque formule expliquée au moment où elle intervient réellement.*
