# AUTO-AUDIT ADVERSARIAL — RECHERCHE DES DÉFAUTS RÉELS DE L'ERP

Tu es l'agent qui a développé tout ou partie de cette application ERP.

Je te demande maintenant de **réexaminer ton propre travail avec pour objectif explicite de découvrir ce qui ne va pas actuellement dans l'application**.

Tu ne dois PAS chercher à démontrer que ton travail est correct.

Tu dois chercher à démontrer **où il est incorrect, incomplet, fragile, incohérent ou dangereux**.

---

## 1. RÈGLE FONDAMENTALE

Considère que **ton implémentation actuelle contient nécessairement des défauts**.

Ta mission n'est donc pas de vérifier si le code "semble bon".

Ta mission est de trouver les défauts existants.

Adopte cette hypothèse de travail :

> **"Le code que j'ai produit contient des erreurs que je n'ai pas détectées. Je dois maintenant les trouver."**

Tu dois activement essayer de réfuter tes propres choix précédents.

---

# 2. INTERDICTION DE L'AUTO-JUSTIFICATION

Il est interdit d'utiliser comme argument :

* "cela fonctionne" ;
* "cela compile" ;
* "les tests passent" ;
* "c'était nécessaire" ;
* "c'est une bonne pratique" ;
* "c'est standard" ;
* "c'est déjà implémenté" ;
* "cela devrait fonctionner" ;
* "aucun problème n'a été signalé" ;
* "j'ai déjà vérifié cela" ;
* "l'architecture actuelle est correcte".

Ces affirmations ne constituent **aucune preuve d'absence de défaut**.

Pour déclarer qu'un comportement est correct, tu dois pouvoir le démontrer par :

* le code ;
* un test ;
* une exécution ;
* une contrainte de base de données ;
* un comportement observable ;
* ou une exigence fonctionnelle explicitement présente dans le projet.

---

# 3. OBLIGATION DE CHERCHER DES ERREURS

Pour chaque module important, tu dois activement rechercher :

### Fonctionnel

* fonctionnalités incomplètes ;
* boutons qui ne font pas ce qui est attendu ;
* actions qui fonctionnent seulement dans certains cas ;
* états impossibles ;
* workflows incomplets ;
* transitions de statut incorrectes ;
* données affichées incorrectement ;
* filtres incorrects ;
* recherches incorrectes ;
* pagination incorrecte ;
* calculs incorrects ;
* validations absentes ou incorrectes.

### Métier

Recherche les situations où l'application permet :

* une opération qui devrait être interdite ;
* une opération impossible dans la réalité métier ;
* une modification d'une donnée qui devrait être verrouillée ;
* une suppression qui devrait être impossible ;
* une validation sans prérequis ;
* une double opération ;
* une opération dans un mauvais statut ;
* une incohérence entre deux modules.

### Données

Recherche :

* doublons ;
* données orphelines ;
* incohérences ;
* relations incorrectes ;
* pertes de données ;
* écrasement de données ;
* problèmes de concurrence ;
* problèmes transactionnels ;
* valeurs nulles inattendues ;
* valeurs négatives ;
* valeurs extrêmes ;
* arrondis incorrects ;
* problèmes de dates ;
* problèmes de fuseaux horaires.

### Sécurité

Cherche activement à contourner :

* authentification ;
* autorisation ;
* rôles ;
* permissions ;
* restrictions d'accès ;
* accès aux ressources d'un autre utilisateur ;
* accès aux ressources d'une autre organisation ;
* restrictions du frontend en appelant directement l'API.

**Ne considère jamais une restriction frontend comme une protection suffisante.**

---

# 4. TEST DE "CASSAGE" OBLIGATOIRE

Pour chaque fonctionnalité critique, essaie mentalement ou réellement de la casser.

Teste notamment :

### Cas normal

Utilisateur → action normale → résultat attendu.

### Cas limite

* valeur vide ;
* valeur nulle ;
* valeur zéro ;
* valeur négative ;
* valeur très grande ;
* caractère inattendu ;
* doublon ;
* ID inexistant.

### Cas utilisateur

* utilisateur sans permission ;
* utilisateur avec un rôle différent ;
* utilisateur accédant à une ressource qui ne lui appartient pas ;
* appel direct de l'API sans passer par l'interface.

### Cas concurrence

* deux utilisateurs effectuent la même opération ;
* deux modifications simultanées ;
* double soumission ;
* double clic ;
* même transaction exécutée deux fois.

### Cas panne

* réseau interrompu ;
* backend indisponible ;
* base indisponible ;
* timeout ;
* erreur pendant une transaction ;
* redémarrage du serveur.

### Cas données

* base vide ;
* base volumineuse ;
* données anciennes ;
* données incohérentes ;
* données partiellement renseignées.

---

# 5. NE TE FIE PAS AUX TESTS EXISTANTS

Les tests existants sont eux-mêmes susceptibles d'être insuffisants ou mal conçus.

Tu dois déterminer :

> **"Qu'est-ce que les tests actuels ne testent pas ?"**

Cherche notamment :

* chemins d'erreur non testés ;
* cas limites non testés ;
* permissions non testées ;
* concurrence non testée ;
* rollback non testé ;
* intégrité des données non testée ;
* appels API invalides non testés ;
* comportement avec des données réelles non testé ;
* tests qui vérifient uniquement que le code s'exécute sans vérifier le résultat métier.

---

# 6. VÉRIFICATION PAR LE CODE ET PAR L'EXÉCUTION

Lorsque c'est possible, ne te contente pas de lire le code.

Tu dois :

1. lancer l'application ;
2. compiler ;
3. exécuter les tests ;
4. examiner les erreurs ;
5. examiner les logs ;
6. tester les endpoints ;
7. tester les scénarios critiques ;
8. vérifier la base de données ;
9. vérifier les migrations ;
10. vérifier les interactions frontend/backend.

Si tu peux réellement tester quelque chose, **teste-le au lieu de supposer**.

---

# 7. RÈGLE DE PREUVE

Pour chaque défaut identifié, donne obligatoirement :

**ID**

**Gravité :**

* CRITIQUE
* MAJEUR
* MODÉRÉ
* MINEUR
* DETTE TECHNIQUE

**Localisation :**

* fichier ;
* classe/composant ;
* méthode ;
* ligne si disponible.

**Défaut :**
Description précise.

**Preuve :**
Explique exactement ce que tu as trouvé dans le code ou observé lors de l'exécution.

**Scénario permettant de provoquer le problème :**
Explique comment le problème peut apparaître.

**Impact réel :**
Explique ce que cela provoque pour l'utilisateur, les données ou le métier.

**Correction envisagée :**
Explique ce qu'il faudrait changer, MAIS SANS ENCORE LE FAIRE.

---

# 8. INTERDICTION DE CLASSER "CORRECT" SANS PREUVE

Ne produis pas une longue liste de modules avec simplement :

> "Module X : OK"

Cela n'a aucune valeur.

Si tu conclus qu'un module ne présente pas de défaut détecté, indique :

> **"Aucun défaut détecté après analyse — cela ne constitue pas une preuve d'absence de défaut."**

Et indique ce que tu as effectivement vérifié.

---

# 9. OBLIGATION DE REVENIR SUR TES PROPRES DÉCISIONS

Pour les parties que tu as toi-même développées, pose-toi systématiquement :

* Pourquoi ai-je choisi cette implémentation ?
* Quelle hypothèse ai-je faite ?
* Cette hypothèse est-elle réellement garantie ?
* Que se passe-t-il si elle est fausse ?
* Ai-je oublié un cas limite ?
* Ai-je supposé que le frontend protégerait une règle métier ?
* Ai-je supposé qu'une opération ne serait jamais exécutée deux fois ?
* Ai-je supposé qu'un utilisateur ne ferait jamais une requête directement ?
* Ai-je supposé que les données seraient toujours propres ?
* Ai-je supposé qu'une transaction réussirait toujours ?
* Ai-je supposé qu'il n'y aurait qu'un seul utilisateur ?
* Ai-je introduit une simplification qui peut devenir un problème en production ?

**Toute hypothèse non garantie doit être considérée comme une piste de défaut.**

---

# 10. RECHERCHE DES DÉFAUTS CACHÉS

Tu dois également rechercher les problèmes qui ne sont pas visibles lors d'une utilisation normale :

* N+1 queries ;
* requêtes excessives ;
* appels réseau inutiles ;
* fuite mémoire ;
* listeners non nettoyés ;
* subscriptions non nettoyées ;
* transactions trop larges ;
* absence de verrouillage ;
* race conditions ;
* erreurs silencieuses ;
* exceptions avalées ;
* logs insuffisants ;
* données sensibles dans les logs ;
* timeouts absents ;
* retry incorrect ;
* opérations non idempotentes ;
* caches incohérents ;
* problèmes de pagination ;
* problèmes de tri ;
* problèmes de timezone ;
* problèmes de précision monétaire ;
* problèmes de concurrence.

---

# 11. RÈGLE D'HONNÊTETÉ ABSOLUE

Tu ne dois jamais transformer une incertitude en certitude.

Utilise exactement ces catégories :

### CONFIRMÉ

Le défaut est démontré par le code ou par une exécution.

### PROBABLE

Le défaut est fortement suggéré mais nécessite une vérification supplémentaire.

### À VÉRIFIER

Tu as identifié un risque mais tu ne peux pas encore confirmer le comportement.

Tu dois clairement distinguer ces trois catégories.

---

# 12. INTERDICTION ABSOLUE DE MODIFIER LE PROJET

Pendant cet audit :

**NE MODIFIE AUCUN FICHIER.**

Tu n'as pas le droit de :

* corriger ;
* refactorer ;
* améliorer ;
* nettoyer ;
* formater ;
* renommer ;
* supprimer ;
* créer ;
* modifier la base ;
* modifier une migration ;
* modifier une configuration.

Même si tu trouves un bug extrêmement évident :

**TU LE SIGNALES UNIQUEMENT.**

---

# 13. RAPPORT FINAL

À la fin de l'analyse, produis :

## 1. Résumé

* nombre de défauts confirmés ;
* nombre de défauts probables ;
* nombre de points à vérifier ;
* nombre de critiques ;
* nombre de majeurs ;
* nombre de modérés ;
* nombre de mineurs ;
* nombre de dettes techniques.

## 2. Tableau principal

| ID | Statut | Gravité | Module | Localisation | Défaut | Impact |
| -- | ------ | ------- | ------ | ------------ | ------ | ------ |

## 3. Défauts critiques

Détail complet.

## 4. Défauts majeurs

Détail complet.

## 5. Défauts modérés

Détail complet.

## 6. Défauts mineurs

Détail complet.

## 7. Dette technique

Détail complet.

## 8. Points nécessitant une vérification

Liste séparée.

## 9. Mes propres erreurs

Ajoute une section intitulée exactement :

### "ERREURS DE MON IMPLÉMENTATION"

Dans cette section, liste spécifiquement les problèmes provenant de choix ou de code que **tu as toi-même produit**.

Ne cherche pas à les minimiser.

---

# 14. CONDITION DE FIN OBLIGATOIRE

Lorsque le rapport est terminé :

**ARRÊTE-TOI.**

Ne corrige rien.

Ne modifie rien.

Ne commence aucun refactoring.

Ne crée aucun commit.

Ne propose pas d'appliquer automatiquement les corrections.

Termine uniquement par :

> **"Audit terminé. J'attends ton autorisation avant toute modification du code."**

---

# OBJECTIF FINAL

Je ne te demande pas de me convaincre que l'ERP fonctionne.

Je te demande de trouver **ce qui ne fonctionne pas, ce qui pourrait mal fonctionner et ce qui est actuellement insuffisant**.

Tu es autorisé à critiquer tes propres décisions.

Tu es même **obligé de le faire**.

La qualité de ton travail sur cette mission sera évaluée non pas au nombre de fois où tu affirmes que le code est correct, mais à ta capacité à **identifier honnêtement les défauts réels de l'application que tu as toi-même construite.**

**Cherche les problèmes. Prouve-les. Liste-les. Puis arrête-toi.**
