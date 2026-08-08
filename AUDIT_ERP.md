# PROMPT — AUDIT GÉNÉRIQUE D'UN ERP

> Prompt réutilisable, indépendant du secteur et de la stack. Renseigner le bloc §1, puis coller dans Claude Code à la racine du dépôt (ou versionner en `docs/AUDIT_ERP.md` et invoquer : `Exécute docs/AUDIT_ERP.md`).

---

## 1. PARAMÈTRES (à renseigner avant exécution)

```
DOMAINE MÉTIER      : ..............................  (ce que l'entreprise fait réellement)
OBJET DE L'ERP      : ..............................  (le job en une phrase)
RÉFÉRENTIEL         : ..............................  (chemin du cahier des charges / specs)
STACK               : ..............................  (à défaut : "à déduire en phase 0")
ENVIRONNEMENT CIBLE : ..............................  (prod live / pré-prod / non déployé)
UTILISATEURS        : ..............................  (nombre, profils, niveau)
ENJEU FINANCIER     : ..............................  (volume transitant par le système)
```

Si un champ reste vide, ne l'invente pas : traite-le comme une inconnue déclarée en tête de rapport.

---

## 2. RÔLE

Tu es auditeur technique indépendant. Ta mission n'est ni de corriger, ni de valoriser le code : elle est de déterminer, preuves à l'appui, **si ce système fait le travail pour lequel il a été construit**.

Quatre axes : couverture fonctionnelle, logique métier, cohérence, sécurité, architecture.

---

## 3. MODÈLE DE RÉFÉRENCE — CE QU'EST UN ERP

Cette section fixe la logique d'audit. Quel que soit le secteur, un ERP est un **système de référence** qui doit tenir cinq propriétés. Un ERP qui perd l'une d'elles ne fait pas son travail, même si toutes ses fonctionnalités sont présentes.

| # | Propriété | Question d'audit |
|---|---|---|
| P1 | **Fidélité** | Ce qui est enregistré correspond-il à ce qui s'est réellement passé dans le monde physique ? |
| P2 | **Intégrité** | Une opération métier touchant plusieurs tables aboutit-elle en totalité ou pas du tout ? |
| P3 | **Invariance** | Les règles du métier sont-elles infranchissables, y compris hors interface ? |
| P4 | **Traçabilité** | Peut-on reconstituer qui a fait quoi, quand, et sur quelle valeur antérieure ? |
| P5 | **Restitution** | Le système sait-il rendre l'état de l'activité (soldes, encours, positions) de façon juste et reproductible ? |

Chaque constat de l'audit doit pouvoir être rattaché à l'une de ces cinq propriétés. Si un constat ne se rattache à aucune, il relève du confort, pas de l'audit.

**Principe directeur** : une règle métier n'existe que là où elle est appliquée. Une règle présente uniquement dans l'interface n'est pas une règle, c'est une suggestion. Pour chaque règle examinée, pose systématiquement la question du contournement : *que se passe-t-il si la requête est envoyée directement au serveur, sans passer par l'écran ?*

---

## 4. RÈGLES D'ENGAGEMENT (non négociables)

1. **Lecture seule.** Aucune modification du code. Tu n'écris que dans `./audit/`.
2. **Aucun constat sans preuve** : `chemin/fichier:ligne` + extrait de 1 à 5 lignes. Sans référence, le constat n'existe pas.
3. **Trois statuts épistémiques obligatoires** :
   - `CONSTATÉ` — lu directement dans le code ;
   - `INFÉRÉ` — déduit d'un faisceau d'indices, que tu explicites ;
   - `NON VÉRIFIABLE` — requiert l'exécution, la production, ou une information absente.
   Ne jamais présenter un `INFÉRÉ` comme un `CONSTATÉ`.
4. **Les manques sont déclarés en tête de rapport**, pas en note de bas de page.
5. **Interdiction du raisonnement circulaire.** Si le référentiel est absent, dis-le et demande-le : ne reconstitue pas le besoin à partir du code, sinon le code se valide lui-même.
6. **Pas de remplissage.** Un axe sain se conclut par « RAS, sous les réserves suivantes ». Ne fabrique pas de constats pour étoffer un rapport.
7. **Pas de généralité.** « Renforcer la sécurité » n'est pas un livrable. Un fichier, une ligne, un scénario d'exploitation, un correctif : voilà un livrable.
8. **Écriture incrémentale.** Tu rédiges au fil de l'analyse, module par module, sans tout charger en mémoire.

---

## 5. PHASE 0 — RECONNAISSANCE

Établis la carte du terrain avant tout jugement :

- Arborescence, modules, couches, points d'entrée, fichiers de configuration, orchestration/déploiement.
- Stack réelle et versions (langage, framework, base, runtime, dépendances majeures).
- Volumétrie : fichiers, lignes par couche, ratio code/tests.
- Historique : nombre de commits, contributeurs, dernier commit, rythme, branches actives.
- Gestion du schéma de base : migrations versionnées ou génération automatique ?
- Localisation du référentiel fonctionnel, du modèle de données, de la documentation.

**Puis arrête-toi** et présente la carte + tes hypothèses avant de poursuivre.

Livrable : `audit/00_PERIMETRE.md`.

---

## 6. PHASE 1 — LE TEST « FAIT-IL LE JOB ? »

Pièce maîtresse de l'audit. Tout le reste en découle.

### 6.1 Matrice de couverture

Une ligne par exigence du référentiel :

| Exigence (réf.) | Module | Statut | Preuve (fichier:ligne) | Écart |
|---|---|---|---|---|

Statuts autorisés :
- `IMPLÉMENTÉ` — interface + service + persistance + règle appliquée, cohérents entre eux ;
- `PARTIEL` — précise le maillon manquant (écran sans service, service sans écran, règle déclarée mais non appliquée, table sans usage) ;
- `ABSENT` ;
- `HORS-RÉFÉRENTIEL` — présent sans être demandé : dette non pilotée, à signaler.

### 6.2 Parcours de bout en bout

Déroule dans le code le **cycle métier principal** du domaine, de l'événement déclencheur jusqu'à sa traduction financière et comptable. Nomme le **premier point de rupture** : l'endroit précis où la chaîne casse, où la donnée doit être ressaisie, ou où l'utilisateur doit sortir du système (tableur, papier, appel).

Un ERP dont le cycle principal ne se déroule pas de bout en bout ne fait pas son travail, quel que soit son taux de couverture fonctionnelle.

### 6.3 Trois réponses explicites

1. Quelles exigences critiques ne sont pas couvertes, classées par impact opérationnel ou financier ?
2. Le système impose-t-il des ressaisies, des contournements, ou des travaux hors outil ?
3. Que fait le code qui n'était pas demandé, et à quel coût de maintenance ?

Livrable : `audit/01_COUVERTURE_FONCTIONNELLE.md`.

---

## 7. AXE A — LOGIQUE MÉTIER

Structure d'analyse par **invariants**, valables pour tout ERP. Pour chacun : localise la règle, détermine son niveau d'application (base de données > serveur > client), teste sa contournabilité.

**A1. Chaîne documentaire et propagation**
Le domaine impose un enchaînement de pièces (engagement → exécution → facturation → règlement, quelle qu'en soit la terminologie locale). Un maillon peut-il être sauté ? Les quantités et montants se propagent-ils ? Un aval peut-il excéder son amont sans justification explicite (facturer plus que livré, livrer plus que commandé, encaisser plus que facturé) ?

**A2. Cycle de vie et machine à états**
Les statuts sont-ils modélisés explicitement ou déduits de champs épars ? Les transitions autorisées sont-elles centralisées ? Une transition interdite est-elle atteignable par appel direct au service ? Existe-t-il des états terminaux réellement terminaux ?

**A3. Immutabilité et correction**
Une pièce validée peut-elle être modifiée ou supprimée ? La correction passe-t-elle par contre-passation / avoir / annulation tracée, ou par écrasement ? Toute suppression physique d'un document engageant est un constat majeur.

**A4. Numérotation et séquences**
Unicité garantie par la base ou par le code applicatif ? Comportement en concurrence (deux créations simultanées) ? Trous de séquence possibles ? Numérotation par exercice, par site, par type de pièce — cohérente avec les obligations du domaine ?

**A5. Arithmétique monétaire**
Type décimal exact ou flottant ? Tout montant en virgule flottante est un constat critique. Règle d'arrondi unique et centralisée ou dispersée ? Nombre de décimales conforme à la devise ? En multi-devise : le taux est-il figé avec l'opération ou recalculé a posteriori (ce qui réécrit le passé) ?

**A6. Unités et conversions**
Unité d'achat, unité de stock, unité de vente : distinguées ? Les facteurs de conversion sont-ils centralisés, versionnés, portés par la donnée de référence — ou codés en dur et dupliqués ? Toute conversion recopiée à plusieurs endroits finira par diverger.

**A7. Soldes et positions dérivés**
Stocks, encours clients, soldes de comptes : stockés en tant que valeur mise à jour, ou dérivés d'un journal de mouvements en écriture seule ? Un solde stocké modifiable directement est une source de dérive silencieuse. Existe-t-il un moyen de recalculer et de réconcilier ? Les valeurs négatives interdites le sont-elles par contrainte de base ou par simple test applicatif ?

**A8. Concurrence et idempotence**
Deux utilisateurs agissant simultanément sur la même ressource : verrouillage optimiste ou pessimiste présent ? Double soumission d'une opération sensible (double clic, rejeu réseau) : produit-elle deux effets ? Les opérations financières sont-elles idempotentes ?

**A9. Données de référence et paramétrage**
Tiers, articles, tarifs, taxes, conditions : gérés comme du paramétrage ou figés dans le code ? Les valeurs à effet temporel (prix, taux, barèmes) portent-elles des dates d'effet, ou l'historique est-il écrasé à chaque mise à jour ? Un ERP sans historisation du paramétrage ne peut pas rejouer le passé.

**A10. Périodes et clôtures**
Notion d'exercice ou de période close ? Une écriture antidatée est-elle possible ? Peut-on modifier une donnée d'une période verrouillée ? Le verrou existe-t-il autrement que par convention entre utilisateurs ?

**A11. Dimensions et cloisonnement**
Multi-société, multi-site, multi-dépôt, multi-devise, multi-utilisateur : l'isolation est-elle appliquée à chaque requête côté serveur, ou dépend-elle d'un filtre passé par le client ? Le cloisonnement est à la fois une question métier et une question de sécurité — traite-le dans les deux axes.

**A12. Cohérence temporelle**
Fuseaux horaires, dates de valeur vs dates de saisie, dérive UTC sur les dates comptables. Les dates métier doivent être stables quel que soit le lieu d'exécution du serveur.

**A13. Conformité comptable et réglementaire du domaine**
Le référentiel comptable applicable est-il respecté (plan de comptes, lettrage, justificatifs, obligations déclaratives) ? Les obligations sectorielles (agréments, licences, seuils, déclarations) sont-elles suivies dans l'outil ou hors outil ?

Livrable : `audit/02_LOGIQUE_METIER.md`.

---

## 8. AXE B — COHÉRENCE

- **Contrat client/serveur** : modèles d'échange alignés ? Champs orphelins, types divergents, énumérations désynchronisées.
- **Modèle de données** : entités doublons, champs redondants, sources de vérité multiples pour une même information.
- **Sémantique** : un même terme métier désigne-t-il la même chose partout ? Les divergences de vocabulaire entre modules signalent presque toujours une divergence de modèle.
- **Nomenclature et conventions** : cartographie l'hétérogénéité plutôt que d'en dresser la liste exhaustive.
- **Gestion des erreurs** : mécanisme unique ou improvisation par module ? Codes de retour cohérents ? Le client sait-il traiter les erreurs qu'il reçoit ?
- **Formats** : dates, montants, séparateurs, langues — homogènes entre stockage, service et affichage ?
- **Code mort et travaux inachevés** : points d'entrée non appelés, écrans non routés, marqueurs `TODO`/`FIXME` sur les chemins critiques.

Livrable : `audit/03_COHERENCE.md`.

---

## 9. AXE C — SÉCURITÉ

Ordonne par exploitabilité réelle, pas par catégorie théorique.

**Authentification** — mécanisme, durée de vie et révocation des sessions/jetons, stockage des secrets de signature, algorithme de hachage des mots de passe, politique de complexité, protection contre le brute force.

**Autorisation** — priorité maximale sur un ERP :
- Chaque point d'entrée est-il protégé **côté serveur** ? Un contrôle côté client n'est pas un contrôle de sécurité.
- Contrôle d'appartenance de la ressource : un utilisateur peut-il accéder à un enregistrement d'un autre en changeant l'identifiant dans l'URL ? Inventorie les points d'entrée exposant un identifiant.
- **Séparation des tâches** : la personne qui saisit peut-elle valider ? Celle qui valide peut-elle payer ? Sur un système financier, l'absence de séparation des rôles est un constat majeur, indépendamment de toute faille technique.
- Cloisonnement multi-entités appliqué serveur, jamais délégué à un paramètre client.

**Entrées et injection** — requêtes construites par concaténation, validation présente côté serveur et pas seulement dans les formulaires, liaison directe des données entrantes aux objets persistants (permettant de forcer un rôle, un montant, un statut), traitement des fichiers déposés.

**Exposition** — politique d'origines croisées permissive, consoles d'administration/documentation d'API/outils de diagnostic accessibles en production, traces d'erreur techniques renvoyées au client, secrets présents dans les fichiers de configuration versionnés **et dans l'historique du dépôt**, données sensibles écrites dans les journaux.

**Infrastructure** — privilèges d'exécution des conteneurs/services, ports de base de données publiés, images ou dépendances non figées, chiffrement du transport, en-têtes de sécurité, versions porteuses de vulnérabilités connues (signale les versions, sans scan réseau si l'accès est indisponible).

**Continuité** — stratégie de sauvegarde, restauration testée, point de reprise. Un ERP sans restauration éprouvée est un risque d'arrêt d'activité, pas un risque informatique.

**Piste d'audit** — journalisation des opérations engageantes : auteur, horodatage, valeur avant/après, non altérable par l'utilisateur. Sur un système manipulant de l'argent, son absence est critique (propriété P4).

Livrable : `audit/04_SECURITE.md`.

---

## 10. AXE D — ARCHITECTURE

- **Couches et responsabilités** : la logique métier est-elle concentrée dans une couche identifiable, ou dispersée entre interface, points d'entrée et base ? Les objets de persistance sont-ils exposés directement vers l'extérieur ?
- **Frontières transactionnelles** : une opération métier touchant plusieurs tables est-elle atomique ? Un échec en cours de route laisse-t-il un état partiel (propriété P2) ? C'est le point le plus coûteux à découvrir en production.
- **Schéma et migrations** : versionnées et rejouables, ou générées automatiquement ? La génération automatique de schéma en production est un constat critique.
- **Intégrité au niveau de la base** : clés étrangères, unicité, non-nullité, contraintes de validation. Les invariants sont-ils garantis par le moteur ou seulement espérés par le code ? Un invariant non tenu par la base sera tôt ou tard violé par un script, un import ou une intégration.
- **Performance structurelle** : requêtes en cascade, absence de pagination sur les listes, index manquants sur les clés étrangères et colonnes de recherche. Évalue à la volumétrie **cible**, pas à celle du jeu de test.
- **Interfaces et intégrations** : cohérence de l'API, versionnement, idempotence des opérations sensibles, gestion des flux entrants/sortants et des reprises sur erreur.
- **Tests** : existent-ils, et couvrent-ils les invariants critiques (calculs, conversions, transitions d'état, soldes) ou seulement les opérations élémentaires ?
- **Exploitabilité** : gestion des profils d'environnement, journaux exploitables, supervision, procédure de reprise de service.
- **Reprenabilité** : un développeur tiers peut-il reprendre ce système ? Documentation, lisibilité, dépendance à une personne unique. C'est un risque d'entreprise, à traiter comme tel.

Livrable : `audit/05_ARCHITECTURE.md`.

---

## 11. BARÈME DE SÉVÉRITÉ

| Niveau | Définition |
|---|---|
| **S1 — Critique** | Perte financière possible, corruption ou perte de données, faille exploitable, ou fonction essentielle absente rendant l'ERP inapte à son objet |
| **S2 — Majeur** | Invariant contournable, contrôle dépendant du client, dette bloquant l'évolution |
| **S3 — Modéré** | Incohérence générant erreurs de saisie, ressaisies ou surcoût de maintenance |
| **S4 — Mineur** | Qualité, lisibilité, confort |

Chaque S1 et S2 s'accompagne d'un **scénario concret** — « un utilisateur X peut faire Y, conséquence Z » — et d'un chiffrage quand il est possible. Pas d'impact abstrait.

---

## 12. FORMAT DES CONSTATS

```
### [S1] Titre court et factuel
Propriété    : P1 Fidélité | P2 Intégrité | P3 Invariance | P4 Traçabilité | P5 Restitution
Axe          : Couverture | Métier | Cohérence | Sécurité | Architecture
Statut       : CONSTATÉ | INFÉRÉ | NON VÉRIFIABLE
Localisation : chemin/fichier:ligne
Extrait      :
    <1 à 5 lignes>
Mécanisme    : <description factuelle, sans jugement>
Impact       : <scénario concret + chiffrage si possible>
Correctif    : <action précise, effort S / M / L>
```

---

## 13. LIVRABLES

Dans `./audit/` :

```
00_PERIMETRE.md                 carte du dépôt, inconnues, hypothèses
01_COUVERTURE_FONCTIONNELLE.md  matrice référentiel ↔ code + parcours de bout en bout
02_LOGIQUE_METIER.md            invariants A1 → A13
03_COHERENCE.md
04_SECURITE.md
05_ARCHITECTURE.md
99_SYNTHESE.md                  verdict + plan de remédiation priorisé
```

`99_SYNTHESE.md` — rédigé **en dernier**, deux pages maximum, lisible par un dirigeant non technicien :

1. **Verdict en une phrase** : l'ERP fait-il le job — oui, partiellement, non ?
2. **État des cinq propriétés** (P1 à P5) : tenue / partielle / non tenue, une ligne de justification chacune.
3. **Les cinq problèmes qui comptent**, par impact décroissant.
4. **Exploitable en production en l'état ?** Oui / Oui sous conditions (lesquelles) / Non (pourquoi).
5. **Plan de remédiation** : `Action | Axe | Sévérité | Effort | Prérequis`, en trois vagues — avant mise en production / 30 jours / trimestre.
6. **Ce que l'audit n'a pas pu couvrir**, et ce qu'il faudrait pour le couvrir.

---

## 14. SÉQUENCE D'EXÉCUTION

1. Phase 0 → `00_PERIMETRE.md`, puis **arrêt** : présente la carte et tes hypothèses avant de poursuivre.
2. Phase 1 → couverture fonctionnelle. Si le référentiel est introuvable, demande-le ici et n'avance pas sans.
3. Axes A → B → C → D, module par module, rapports écrits au fil de l'eau.
4. Synthèse en dernier, une fois tous les axes clos.

Traite par module : lis, écris, libère, passe au suivant. Ne cherche pas à tenir l'ensemble du dépôt en mémoire.