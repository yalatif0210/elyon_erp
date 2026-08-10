# CORRECTION EXHAUSTIVE DES DÉFAUTS DE L'ERP

L'audit vient d'être réalisé.

Tu disposes maintenant de la liste des défauts, risques et anomalies identifiés dans l'application ERP.

Ta mission est désormais de **corriger les défauts identifiés jusqu'à obtenir une application aussi proche que possible de zéro défaut détectable**.

---

# 1. OBJECTIF ABSOLU

L'objectif de cette phase est :

> **ZERO DÉFAUT CONFIRMÉ APRÈS CORRECTION.**

Cela signifie que tu ne dois pas simplement corriger les anomalies listées une par une.

Après chaque correction, tu dois rechercher :

* les régressions ;
* les effets secondaires ;
* les nouveaux bugs ;
* les incohérences introduites ;
* les problèmes similaires ailleurs dans le code ;
* les scénarios non couverts par l'audit initial.

**La fin de la mission n'est PAS atteinte lorsque les bugs de l'audit initial sont corrigés.**

Elle est atteinte uniquement lorsque :

1. les défauts identifiés sont corrigés ;
2. les corrections sont vérifiées ;
3. aucune régression n'est détectée ;
4. un nouvel audit ne révèle plus de défaut confirmé.

---

# 2. NE CORRIGE PAS AVEUGLEMENT

Avant chaque correction :

1. lis le code concerné ;
2. comprends la cause réelle du problème ;
3. recherche les usages de la fonctionnalité ;
4. identifie les dépendances ;
5. identifie les impacts frontend/backend ;
6. identifie les impacts base de données ;
7. vérifie les règles métier concernées.

**Corrige la cause racine, pas uniquement le symptôme.**

Exemple :

Si cinq endpoints présentent le même problème, ne corrige pas uniquement les cinq symptômes si le problème provient d'une mauvaise abstraction commune.

Recherche la cause systémique.

---

# 3. PRIORITÉ DES CORRECTIONS

Traite les problèmes dans cet ordre :

### PRIORITÉ 1 — CRITIQUE

* sécurité ;
* perte de données ;
* corruption de données ;
* erreurs financières ;
* violations de permissions ;
* transactions incohérentes ;
* blocage majeur du système.

### PRIORITÉ 2 — MAJEUR

* fonctionnalités métier incorrectes ;
* workflows incorrects ;
* incohérences entre modules ;
* problèmes importants de données ;
* erreurs API ;
* problèmes de concurrence.

### PRIORITÉ 3 — MODÉRÉ

* erreurs fonctionnelles limitées ;
* validations ;
* UX provoquant des erreurs ;
* problèmes de performance significatifs.

### PRIORITÉ 4 — MINEUR

* défauts d'interface ;
* incohérences mineures ;
* améliorations de robustesse.

### PRIORITÉ 5 — DETTE TECHNIQUE

Corrige-la lorsque cela améliore réellement :

* fiabilité ;
* maintenabilité ;
* testabilité ;
* sécurité ;
* évolutivité.

---

# 4. RÈGLE : UNE CORRECTION DOIT ÊTRE PROUVÉE

Après chaque correction significative :

1. compile le code concerné ;
2. exécute les tests pertinents ;
3. ajoute les tests manquants ;
4. exécute les tests de régression ;
5. vérifie le comportement réel lorsque possible.

Ne dis jamais :

> "La correction devrait fonctionner."

Tu dois vérifier.

Si tu ne peux pas vérifier quelque chose, indique explicitement :

> **NON VÉRIFIÉ**

---

# 5. TESTS OBLIGATOIRES

Pour chaque bug corrigé, crée ou améliore un test lorsque cela est pertinent.

Un test doit vérifier le **comportement attendu**, pas simplement l'exécution du code.

Pour les fonctionnalités critiques, teste au minimum :

### Cas nominal

Entrées valides → résultat attendu.

### Cas invalide

Entrées incorrectes → rejet contrôlé.

### Cas limite

* null ;
* vide ;
* zéro ;
* valeurs négatives ;
* valeurs maximales ;
* doublons ;
* ressources inexistantes.

### Sécurité

* utilisateur non authentifié ;
* utilisateur sans permission ;
* mauvais rôle ;
* accès à une ressource interdite.

### Concurrence

Lorsque pertinent :

* double soumission ;
* double clic ;
* deux utilisateurs ;
* opérations simultanées.

### Transaction

Vérifie que :

> opération complète = succès

et

> échec intermédiaire = état cohérent / rollback correct.

---

# 6. NE PAS INTRODUIRE DE NOUVEAUX BUGS

Avant chaque modification importante, identifie :

* les composants impactés ;
* les services impactés ;
* les endpoints impactés ;
* les tables impactées ;
* les autres fonctionnalités utilisant le même code.

Après modification :

**réexécute les tests concernés.**

Si une modification casse quelque chose :

1. identifie la cause ;
2. corrige la régression ;
3. reteste.

Ne laisse jamais volontairement un test cassé en disant :

> "Cela existait déjà."

Si le test était incorrect, corrige le test.

---

# 7. RECHERCHE DES PROBLÈMES SIMILAIRES

Lorsqu'un défaut est découvert, recherche immédiatement les occurrences similaires dans tout le projet.

Exemple :

Si tu découvres :

> absence de vérification d'autorisation sur un endpoint

ne corrige pas uniquement cet endpoint.

Recherche :

* les autres endpoints similaires ;
* les contrôleurs similaires ;
* les services utilisant la même logique ;
* les autres ressources accessibles par ID.

Même principe pour :

* validation ;
* transactions ;
* gestion des erreurs ;
* calculs ;
* pagination ;
* permissions ;
* concurrence ;
* requêtes SQL ;
* gestion des dates ;
* montants ;
* uploads ;
* suppression.

---

# 8. AUDIT POST-CORRECTION OBLIGATOIRE

Une fois tous les défauts de l'audit initial corrigés, tu dois effectuer un **SECOND AUDIT COMPLET**.

Important :

Ne considère pas le premier audit comme suffisant.

Recommence l'analyse depuis le début.

Pose-toi à nouveau :

> "Maintenant que j'ai modifié le code, qu'est-ce qui pourrait encore mal fonctionner ?"

Cherche notamment les problèmes créés par les corrections.

---

# 9. BOUCLE DE QUALITÉ OBLIGATOIRE

Tu dois fonctionner selon cette boucle :

```text
AUDIT
   ↓
IDENTIFICATION DES DÉFAUTS
   ↓
CORRECTION
   ↓
TESTS
   ↓
TESTS DE RÉGRESSION
   ↓
NOUVEL AUDIT
   ↓
NOUVEAUX DÉFAUTS ?
   ↓
 OUI ───────────────→ CORRECTION
   ↓
 NON
   ↓
VÉRIFICATION FINALE
```

**Tu dois répéter cette boucle autant de fois que nécessaire.**

---

# 10. INTERDICTION DE DÉCLARER "ZERO BUG" TROP FACILEMENT

Tu n'as pas le droit de déclarer :

> "L'application est sans bug."

Un logiciel complexe ne peut pas être mathématiquement prouvé sans défaut par une simple revue.

Tu dois utiliser une formulation basée sur les vérifications réellement effectuées :

> **"Aucun défaut confirmé n'a été détecté après les vérifications réalisées."**

Si des éléments restent non vérifiables :

> **"Des points restent non vérifiés : ..."**

---

# 11. RÈGLE DE TRANSPARENCE

Pour chaque anomalie initiale, indique :

| ID | Défaut | Correction | Test | Résultat |
| -- | ------ | ---------- | ---- | -------- |

Résultat possible :

* CORRIGÉ ET VÉRIFIÉ
* CORRIGÉ — VÉRIFICATION PARTIELLE
* NON CORRIGÉ
* NON VÉRIFIABLE

**Ne classe jamais un problème comme "corrigé et vérifié" sans avoir réellement effectué la vérification.**

---

# 12. PROTECTION DES DONNÉES

Comme il s'agit d'un ERP, une correction ne doit jamais provoquer involontairement :

* perte de données ;
* suppression de données ;
* modification massive non contrôlée ;
* corruption de relations ;
* modification irréversible du schéma.

Avant toute modification de :

* migration ;
* schéma ;
* données ;
* contraintes ;
* index ;
* relations ;

analyse les conséquences.

Si une migration est nécessaire, assure-toi qu'elle est cohérente avec l'historique des migrations existantes.

---

# 13. RÈGLE SUR LES REFACTORINGS

Ne réalise pas de refactoring massif simplement pour rendre le code "plus beau".

Un refactoring est justifié s'il permet de :

* corriger un défaut ;
* supprimer une cause de bugs ;
* améliorer significativement la sécurité ;
* améliorer la cohérence ;
* réduire une duplication dangereuse ;
* améliorer la testabilité ;
* prévenir une régression.

Chaque refactoring important doit être suivi de tests.

---

# 14. RÈGLE SUR LES TESTS

Ne triche pas avec les tests.

Il est strictement interdit de :

* supprimer un test uniquement parce qu'il échoue ;
* désactiver un test ;
* réduire les assertions pour faire passer un test ;
* modifier le comportement attendu uniquement pour faire passer le code ;
* mocker excessivement une fonctionnalité afin de masquer son comportement réel ;
* ignorer volontairement une erreur ;
* marquer un test comme réussi sans vérifier son résultat.

Si un test échoue après une correction :

**considère d'abord que ta correction est potentiellement incorrecte.**

---

# 15. VÉRIFICATION DE L'APPLICATION RÉELLE

Lorsque l'environnement le permet, ne limite pas la vérification aux tests unitaires.

Vérifie également :

* frontend ;
* backend ;
* API ;
* base de données ;
* authentification ;
* autorisation ;
* workflows ;
* intégrations ;
* migrations ;
* configuration ;
* logs ;
* erreurs runtime.

Le fait que les tests unitaires passent ne suffit pas.

---

# 16. TEST DE RÉSISTANCE FINAL

Avant de déclarer la mission terminée, réalise un dernier passage en cherchant volontairement à casser l'application.

Imagine :

> "Je suis un utilisateur qui veut faire une opération interdite."

Puis :

> "Je suis un utilisateur qui modifie directement les requêtes API."

Puis :

> "Je suis deux utilisateurs qui travaillent simultanément."

Puis :

> "Le réseau tombe au mauvais moment."

Puis :

> "La base contient une donnée inattendue."

Puis :

> "L'application doit gérer 10 fois plus de données."

Puis :

> "Une opération est répétée deux fois."

Puis :

> "Une opération échoue au milieu."

Analyse chaque scénario.

---

# 17. CRITÈRE DE TERMINAISON

Tu ne dois considérer la mission comme terminée que lorsque :

* tous les défauts confirmés de l'audit initial sont corrigés ;
* les corrections ont été testées ;
* les tests existants passent ;
* les nouveaux tests passent ;
* aucune régression n'est détectée ;
* un nouvel audit complet a été réalisé ;
* aucun nouveau défaut confirmé n'a été découvert.

Si un nouveau défaut est découvert :

**la mission continue.**

---

# 18. RAPPORT FINAL

À la fin, fournis :

## 1. Défauts corrigés

Nombre total.

## 2. Défauts restant

Nombre total.

## 3. Défauts non vérifiables

Liste détaillée.

## 4. Tests exécutés

Pour chaque catégorie :

* backend ;
* frontend ;
* intégration ;
* API ;
* base de données ;
* sécurité ;
* autres.

Indique les commandes réellement exécutées et leurs résultats.

## 5. Fichiers modifiés

Liste précise.

## 6. Régressions détectées

Liste des régressions rencontrées et de leur résolution.

## 7. Second audit

Résultats du nouvel audit.

## 8. État final

Utilise uniquement l'une des formulations suivantes :

### ÉTAT A

> **Aucun défaut confirmé détecté après correction et ré-audit.**

### ÉTAT B

> **Des défauts confirmés restent présents.**

### ÉTAT C

> **L'état final ne peut pas être complètement vérifié dans l'environnement disponible.**

---

# 19. RÈGLE FINALE — NE JAMAIS ARRÊTER PAR COMPLAISANCE

Ne t'arrête pas parce que :

* le nombre de bugs est élevé ;
* les corrections sont longues ;
* le code doit être refactoré ;
* plusieurs fichiers sont concernés ;
* les tests échouent ;
* une première correction en crée une autre ;
* le problème est complexe.

Continue jusqu'à ce que les vérifications montrent que les défauts ont été réellement traités.

**Le but n'est pas de terminer rapidement.**

**Le but est de livrer l'état le plus fiable possible de l'ERP.**

Et surtout :

> **NE CONSIDÈRE JAMAIS TON PROPRE CODE COMME CORRECT PAR DÉFAUT.**

Après chaque correction, considère que tu peux avoir créé un nouveau problème et cherche activement à le découvrir.

**CORRIGE → TESTE → CASSE → RÉAUDITE → CORRIGE À NOUVEAU.**

Continue cette boucle jusqu'à ce qu'aucun défaut confirmé ne soit détecté.

---

## AUTORISATION

Tu es maintenant autorisé à modifier le code pour corriger les défauts identifiés dans l'audit.

Commence par les défauts **CRITIQUES**, puis **MAJEURS**, puis les autres.

Ne modifie que ce qui est nécessaire, mais **ne laisse aucun défaut confirmé volontairement non corrigé.**
