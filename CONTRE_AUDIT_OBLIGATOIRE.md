# CONTRE-AUDIT OBLIGATOIRE — COUVERTURE COMPLÈTE DE L'ERP

Le premier audit est insuffisant.

Tu n'as manifestement pas exploré l'intégralité de l'application et certains défauts n'ont donc pas été détectés.

**Nous revenons donc à la phase d'audit. Aucune correction ne doit être effectuée pendant cette phase.**

Cette fois, je ne veux pas simplement que tu relises le code que tu connais déjà.

Je veux que tu **parcours méthodiquement l'intégralité de l'application et de ses fonctionnalités**, afin d'identifier les défauts que ton premier audit a manqués.

---

# 1. NOUVEL OBJECTIF

L'objectif est maintenant :

> **DÉCOUVRIR LES DÉFAUTS QUE LE PREMIER AUDIT N'A PAS DÉTECTÉS.**

Ne considère absolument pas le premier audit comme fiable ou exhaustif.

Pars de l'hypothèse suivante :

> **"Mon premier audit a raté des problèmes. Je dois découvrir lesquels."**

Tu dois donc chercher activement les angles morts du premier audit.

---

# 2. INTERDICTION DE RÉUTILISER LE PREMIER AUDIT COMME UNIQUE BASE

Ne te contente pas de :

* relire la liste précédente ;
* vérifier les bugs déjà identifiés ;
* confirmer les corrections proposées ;
* parcourir uniquement les fichiers déjà mentionnés.

Le premier audit constitue uniquement un **point de départ**.

Tu dois effectuer une exploration indépendante et systématique de l'application.

---

# 3. CARTOGRAPHIE OBLIGATOIRE DE L'APPLICATION

Avant de rechercher les bugs, établis une cartographie complète.

Explore réellement le repository et identifie :

### Frontend

* toutes les pages ;
* toutes les routes ;
* tous les modules ;
* tous les composants ;
* tous les formulaires ;
* toutes les fenêtres/modales ;
* tous les tableaux ;
* tous les filtres ;
* toutes les recherches ;
* toutes les actions utilisateur ;
* tous les services ;
* tous les guards ;
* toutes les directives ;
* tous les interceptors ;
* toutes les interfaces/types ;
* toutes les validations ;
* tous les mécanismes de navigation.

### Backend

* toutes les applications/services ;
* tous les controllers ;
* tous les endpoints ;
* tous les services métier ;
* tous les repositories ;
* toutes les entités ;
* tous les DTO ;
* toutes les validations ;
* toutes les exceptions ;
* tous les handlers ;
* tous les mécanismes d'authentification ;
* tous les mécanismes d'autorisation ;
* toutes les transactions ;
* toutes les tâches planifiées ;
* tous les listeners/events ;
* toutes les intégrations externes.

### Base de données

* toutes les tables ;
* toutes les relations ;
* toutes les contraintes ;
* tous les index ;
* toutes les migrations ;
* toutes les vues ;
* toutes les fonctions/procédures si présentes ;
* tous les mécanismes d'audit ;
* tous les champs sensibles.

### Infrastructure

* Docker ;
* Docker Compose ;
* reverse proxy ;
* variables d'environnement ;
* configuration ;
* scripts ;
* CI/CD ;
* logs ;
* monitoring ;
* health checks.

---

# 4. CRÉE UNE MATRICE DE COUVERTURE

Tu dois produire une matrice similaire à :

| Domaine | Module | Fonctionnalité | Frontend inspecté | Backend inspecté | DB inspectée | Tests inspectés | Scénarios testés | Défauts trouvés |
| ------- | ------ | -------------- | ----------------- | ---------------- | ------------ | --------------- | ---------------- | --------------- |

**Aucune fonctionnalité importante ne doit être laissée sans statut.**

Pour chaque ligne, indique clairement :

* INSPECTÉ
* PARTIELLEMENT INSPECTÉ
* NON INSPECTÉ

Tu n'as pas le droit d'affirmer qu'une fonctionnalité est inspectée si tu n'as réellement examiné son implémentation.

---

# 5. PARCOURS FONCTIONNEL COMPLET

Ne te limite pas à l'architecture.

Pour chaque fonctionnalité accessible à l'utilisateur, reconstruis le parcours :

```text
Utilisateur
    ↓
Page
    ↓
Composant
    ↓
Formulaire
    ↓
Validation
    ↓
Service frontend
    ↓
HTTP/API
    ↓
Controller
    ↓
DTO
    ↓
Service métier
    ↓
Repository
    ↓
Base de données
    ↓
Réponse
    ↓
Frontend
    ↓
Affichage
```

Analyse chaque étape.

Cherche les incohérences entre les couches.

---

# 6. PARCOURS UTILISATEUR

Pour chaque module, imagine et vérifie les parcours réels.

Exemples :

### Création

Créer → valider → enregistrer → confirmation → retrouver la donnée.

### Modification

Ouvrir → modifier → enregistrer → actualiser → vérifier la donnée.

### Suppression

Supprimer → confirmation → suppression → vérifier les dépendances.

### Recherche

Rechercher → filtrer → paginer → trier → ouvrir le résultat.

### Workflow

Créer → soumettre → valider → approuver → clôturer.

Tu dois rechercher les défauts à chaque étape.

---

# 7. PARCOURS NÉGATIFS

Pour CHAQUE fonctionnalité importante, teste également :

* utilisateur non autorisé ;
* donnée inexistante ;
* donnée déjà existante ;
* champ obligatoire absent ;
* valeur incorrecte ;
* valeur limite ;
* opération répétée ;
* opération dans le mauvais statut ;
* suppression d'une donnée utilisée ailleurs ;
* modification simultanée ;
* erreur réseau ;
* timeout ;
* erreur serveur ;
* réponse vide ;
* réponse partielle.

---

# 8. RECHERCHE SYSTÉMATIQUE DES FONCTIONNALITÉS INCOMPLÈTES

Recherche particulièrement :

* boutons sans implémentation ;
* TODO ;
* FIXME ;
* méthodes vides ;
* méthodes retournant des valeurs temporaires ;
* mocks laissés dans le code ;
* données hardcodées ;
* valeurs statiques ;
* composants jamais utilisés ;
* endpoints non utilisés ;
* endpoints sans frontend ;
* fonctionnalités frontend sans backend ;
* fonctionnalités backend sans interface ;
* écrans partiellement implémentés ;
* messages "Coming soon" ;
* fonctionnalités qui fonctionnent uniquement avec des données de démonstration ;
* fallback silencieux ;
* exceptions ignorées.

Ne suppose pas qu'un écran fonctionnel visuellement est réellement fonctionnel.

---

# 9. RECHERCHE DES INCOHÉRENCES

Compare systématiquement :

### Frontend ↔ Backend

* noms des champs ;
* types ;
* enums ;
* statuts ;
* formats de dates ;
* formats numériques ;
* codes d'erreur ;
* pagination ;
* filtres ;
* tri ;
* règles de validation.

### Backend ↔ Base

* types ;
* contraintes ;
* nullabilité ;
* relations ;
* valeurs par défaut ;
* longueurs ;
* unicité.

### Module ↔ Module

Vérifie que deux modules ne représentent pas différemment la même information.

---

# 10. AUDIT PAR RÔLE

Pour chaque rôle utilisateur présent dans l'application :

1. liste ce qu'il peut consulter ;
2. liste ce qu'il peut créer ;
3. liste ce qu'il peut modifier ;
4. liste ce qu'il peut supprimer ;
5. liste ce qu'il peut valider ;
6. liste ce qu'il peut exporter ;
7. liste ce qu'il peut administrer.

Puis vérifie réellement les contrôles correspondants.

Cherche notamment :

> "L'interface masque cette action, mais l'API permet-elle quand même de l'exécuter ?"

---

# 11. AUDIT DES DONNÉES

Pour chaque entité importante, vérifie son cycle de vie :

```text
Création
→ Lecture
→ Modification
→ Utilisation
→ Association
→ Désassociation
→ Suppression / archivage
```

Cherche les incohérences à chaque étape.

---

# 12. AUDIT DES CALCULS

Tous les calculs métier doivent être vérifiés.

Cherche :

* erreurs d'arrondi ;
* divisions par zéro ;
* valeurs négatives ;
* mauvais ordre des opérations ;
* unités incohérentes ;
* conversions incorrectes ;
* erreurs de devise ;
* erreurs de dates ;
* erreurs de cumul ;
* doublons dans les agrégations.

Ne suppose pas qu'un calcul est correct parce qu'il semble logique.

---

# 13. AUDIT DES ÉTATS ET WORKFLOWS

Pour chaque statut métier, construis mentalement une machine à états.

Exemple :

```text
BROUILLON
    ↓
SOUMIS
    ↓
VALIDÉ
    ↓
TRAITÉ
    ↓
CLÔTURÉ
```

Puis vérifie :

* transitions autorisées ;
* transitions interdites ;
* retour en arrière ;
* modification après validation ;
* suppression après validation ;
* double validation ;
* double traitement.

Recherche les états impossibles.

---

# 14. AUDIT DE CONCURRENCE

Tu dois explicitement rechercher les scénarios où plusieurs utilisateurs exécutent simultanément :

* création ;
* modification ;
* validation ;
* réservation ;
* mouvement ;
* paiement ;
* approbation ;
* suppression.

Cherche les race conditions et les doubles traitements.

---

# 15. AUDIT DES ERREURS

Pour chaque opération importante, demande :

> "Que se passe-t-il si cette opération échoue à cette étape précise ?"

Vérifie :

* transaction ;
* rollback ;
* état de la base ;
* message utilisateur ;
* logs ;
* retry ;
* possibilité de recommencer.

---

# 16. AUDIT DES ÉCRANS

Pour chaque écran, vérifie :

* chargement ;
* état vide ;
* état de chargement ;
* état erreur ;
* permissions ;
* données manquantes ;
* pagination ;
* tri ;
* filtres ;
* recherche ;
* rafraîchissement ;
* navigation ;
* retour arrière ;
* double clic ;
* boutons désactivés ;
* messages de confirmation.

---

# 17. RECHERCHE DES DÉFAUTS VISUELS AYANT UN IMPACT FONCTIONNEL

Ne recherche pas uniquement l'esthétique.

Recherche les défauts pouvant empêcher l'utilisateur de :

* voir une information ;
* comprendre un statut ;
* saisir une donnée ;
* valider une opération ;
* annuler une opération ;
* identifier une erreur ;
* distinguer deux états.

---

# 18. AUDIT DES DONNÉES RÉELLES

Si des données de test, seed, fixtures ou exemples existent :

* analyse leur structure ;
* vérifie qu'elles correspondent au modèle réel ;
* vérifie que l'application ne dépend pas accidentellement de ces données ;
* cherche les comportements qui fonctionnent uniquement grâce aux données de démonstration.

---

# 19. RECHERCHE DANS LE CODE

Effectue des recherches globales pour détecter notamment :

* TODO
* FIXME
* HACK
* mock
* stub
* placeholder
* hardcoded
* console.log
* System.out
* catch vide
* return null
* return []
* valeurs par défaut suspectes
* commentaires indiquant une fonctionnalité temporaire
* code inaccessible
* code mort
* méthodes non utilisées.

Ces recherches ne constituent pas à elles seules des preuves de bugs, mais servent à identifier des zones nécessitant une inspection.

---

# 20. CONTRAINTE DE COUVERTURE

Tu ne peux pas conclure l'audit tant que tu n'as pas :

* cartographié l'application ;
* identifié tous les modules ;
* identifié toutes les routes/pages ;
* identifié les endpoints ;
* identifié les principales entités ;
* identifié les workflows ;
* parcouru les principales fonctionnalités ;
* vérifié les interactions entre couches.

Si une partie n'a pas pu être inspectée, indique-la explicitement.

---

# 21. NE PAS INVENTER UNE COUVERTURE

Il est strictement interdit d'écrire :

> "Application entièrement auditée"

si ce n'est pas démontré.

Tu dois être capable de me montrer **ce que tu as effectivement inspecté**.

Si une partie n'est pas accessible ou exécutable :

> **NON INSPECTÉ — raison précise.**

---

# 22. RAPPORT FINAL

Ton rapport doit commencer par :

## COUVERTURE DE L'AUDIT

Indique :

* nombre de modules identifiés ;
* nombre de modules inspectés ;
* nombre de pages/routes ;
* nombre inspecté ;
* nombre d'endpoints ;
* nombre inspecté ;
* nombre d'entités ;
* nombre inspecté ;
* workflows identifiés ;
* workflows inspectés.

Puis :

## DÉFAUTS MANQUÉS PAR LE PREMIER AUDIT

Pour chaque nouveau défaut :

| ID | Gravité | Module | Localisation | Défaut | Preuve | Impact | Pourquoi le premier audit l'a probablement manqué |
| -- | ------- | ------ | ------------ | ------ | ------ | ------ | ------------------------------------------------- |

La dernière colonne est importante.

Je veux comprendre **pourquoi ton premier passage n'a pas détecté ce problème.**

---

# 23. IMPORTANT : AUCUNE CORRECTION

Pendant ce contre-audit :

**NE MODIFIE AUCUN FICHIER.**

Tu dois uniquement :

* explorer ;
* analyser ;
* tester ;
* documenter.

Même si tu trouves un défaut critique :

**tu le listes et tu continues l'audit.**

---

# 24. CRITÈRE DE FIN

Ne termine pas après avoir trouvé quelques nouveaux bugs.

Continue l'exploration jusqu'à ce que :

> **toute l'application ait été couverte selon la matrice de couverture.**

Ensuite seulement, présente le rapport.

---

# 25. INSTRUCTION FINALE

Cette fois, je ne veux pas une revue générale du code.

Je veux une **inspection exhaustive de l'application par fonctionnalités et parcours utilisateur**.

Tu as déjà produit le code.

Tu as déjà réalisé un premier audit.

Le premier audit a manqué des défauts.

**Considère donc que tes méthodes d'analyse précédentes étaient insuffisantes et change d'approche.**

Ne cherche pas à confirmer ton premier rapport.

**Cherche précisément ce qu'il n'a pas vu.**

Explore l'application entière.

Cartographie-la.

Parcours ses fonctionnalités.

Suis les données du frontend jusqu'à la base et inversement.

Teste les scénarios normaux, limites, négatifs, concurrents et d'erreur.

Puis liste tous les nouveaux défauts trouvés.

### RÈGLE ABSOLUE

**PAS DE CORRECTION.**

**PAS DE REFACTORING.**

**PAS DE MODIFICATION DE FICHIER.**

**AUDIT ET INVENTAIRE UNIQUEMENT.**

À la fin, arrête-toi et attends mon autorisation pour passer à la correction.
