# ERP Elyon Trading

ERP de négoce, distribution et transport d'hydrocarbures (Fuel 180, MGO, Diesel, Essence),
exploitation de barge et opérations terrain. **Côte d'Ivoire** · pivot **USD** · locale **XOF**.

📄 **Toute la spécification est dans [SPECIFICATIONS.md](SPECIFICATIONS.md)** — source de vérité unique.

---

## État d'avancement

| Lot | Contenu | État |
| :--- | :--- | :--- |
| **1 — Fondations** | Socle Docker, référentiels complets, conformité transport, seuils, dérogations, audit · API à trois réalms · **console Angular** | ✅ **Livré et recetté** (18/18) |
| 2 — Cœur commercial & exécution | Contrat/Deal/Opération, 4 formules de prix, 3 verrous, HSE, relevés, facturation, FNE | À venir |
| 3a — Terrain mobile | Application tablette hors connexion | À venir |
| 3b — B2B & Retail | Activation des deux segments | À venir |
| 4 — Barge, CRM, pilotage | Prévision, point mort, BFR | À venir |

---

## Démarrage

```bash
cp .env.example .env          # puis remplacer TOUTES les valeurs REMPLACER
openssl rand -base64 48       # JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (distincts)
openssl rand -hex 32          # TOTP_ENCRYPTION_KEY

docker compose up -d postgres redis
docker compose --profile tools run --rm migrator
docker compose up -d --build api web

# Console interne
open http://localhost:4200            # dg@elyon-trading.example / ChangeMe!2026
```

**Comptes du jeu de données** — tous avec le mot de passe `ChangeMe!2026` :

| Compte | Rôle |
| :--- | :--- |
| `dg@elyon-trading.example` | Directeur Général — voit tout, seul habilité aux dérogations critiques |
| `cfo@elyon-trading.example` | Directeur Financier |
| `ccoo@elyon-trading.example` | Directeur Commercial & Opérations |
| `logistique@elyon-trading.example` | Coordinateur Logistique |
| `achats@maritime-atlantique.example` | Client (réalm portail) |
| `hse@elyon-trading.example` | Contrôleur HSE (réalm terrain) |

Le conteneur `migrator` enchaîne : génération du client Prisma → création de la
migration **avec le SQL métier injecté** → application → jeu de données. Il est le
**seul** à se connecter avec le rôle propriétaire `erp_migrator`.

### Développement

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

⚠️ Cette surcharge expose PostgreSQL et Redis en écoute locale. **Jamais en production.**

---

## Arborescence

```
erp/
├── SPECIFICATIONS.md              Source de vérité unique
├── instructions.md                Rôle et processus de l'agent de développement
├── addedum_cahier_de_charge.md    Cahier de cadrage client du 01/08/2026 (archive)
├── docker-compose.yml             Orchestration — réseau `data` cloisonné
├── docker-compose.dev.yml         Surcharge de développement
├── docker/
│   ├── api.Dockerfile · web.Dockerfile
│   └── nginx/                     Config du relais + en-têtes de sécurité
└── apps/
    ├── api/
    │   ├── prisma/
    │   │   ├── schema.prisma      32 modèles (lot 1)
    │   │   ├── seed.ts            Jeu de données exerçant les contraintes
    │   │   └── sql/
    │   │       ├── 01_business_constraints.sql   Invariants en base
    │   │       ├── 02_audit_immutability.sql     Journaux append-only
    │   │       ├── 03_views_and_functions.sql    Vues et fonctions de résolution
    │   │       └── 04_grants.sql                 Moindre privilège
    │   ├── scripts/prepare-migrations.mjs        Injecte le SQL DANS les migrations
    │   └── src/
    │       ├── common/            Config, Prisma, Redis, crypto, audit, guards, filtres
    │       ├── auth/              Trois réalms : interne, portail, terrain
    │       ├── referentials/      Référentiels et conformité
    │       └── admin/             Registre des dérogations
    └── web/                       Console Angular (Tailwind + Angular CDK)
        └── src/app/
            ├── core/              Session, intercepteur, guards
            ├── shared/            Icônes, badges de statut, formatage
            └── features/          Connexion, coque, tableau de bord, écrans
```

---

## Faire évoluer le schéma sans casser les invariants

Prisma ne modélise ni les `CHECK`, ni les triggers, ni les vues, ni les privilèges.
Les appliquer **à côté** des migrations les rend invisibles à l'historique : au
`prisma migrate dev` suivant, Prisma constate un écart et propose de réinitialiser
la base.

Le SQL de `prisma/sql/` est donc **injecté dans le fichier de migration** par
`scripts/prepare-migrations.mjs`.

> **Règle : ne jamais lancer `prisma migrate dev` directement.**

```bash
# Modifier prisma/schema.prisma et/ou prisma/sql/, puis :
npm run db:migration -- ajout_module_recouvrement
npm run db:migrate
```

Le script gère **aussi le cas d'un correctif SQL seul**, sans changement de schéma :
Prisma ne générant alors aucune migration, le script en crée une vide et y injecte le
SQL. Sans cela, il écrirait dans la migration précédente — **déjà appliquée** —, ce qui
changerait son empreinte et ferait échouer tout `migrate deploy` ultérieur.

---

## Ce qui est garanti par la base, et non par le code

Les règles critiques sont portées par PostgreSQL. Un bug applicatif, un script
d'administration ou une refonte de l'API ne peuvent pas les contourner.

**14 tentatives de violation, 14 refus** — y compris exécutées avec le rôle propriétaire :

| Tentative | Résultat |
| :--- | :--- |
| Dérogation conformité transport accordée par le CFO | refusé — DG seul |
| Taux EUR→XOF saisi manuellement, ou `PEG` divergent | refusé — parité fixe 655,957 |
| `UPDATE` / `DELETE` sur `audit_logs` | refusé — append-only |
| Taux d'absorption ≠ budget ÷ assiette budgétée | refusé |
| Plancher direct supérieur au seuil minimum | refusé |
| Poste de coût `INDIRECT` sans regroupement | refusé |
| Tolérance d'ullage avec alerte > critique | refusé |
| Seconde devise pivot | refusé |
| Pièce de conformité rattachée à deux porteurs | refusé |
| Client sans segment commercial | refusé |
| Exonération TVA sans référence opposable | refusé |
| Suppléance avec deux suppléants désignés | refusé |

Les invariants transactionnels — verrou finance, verrou HSE, facture assise sur le
relevé faisant autorité, prix indexé arrêté — arrivent au **lot 2** avec les entités
Deal et Opération.

---

## Sécurité — vérifié à l'exécution

| Contrôle | Résultat |
| :--- | :--- |
| API en utilisateur non privilégié | `uid=1000(node)` |
| Écriture dans `/app` | refusée — lecture seule |
| Écriture dans `/tmp` | autorisée — tmpfs, seule exception |
| PostgreSQL et Redis exposés à l'hôte | non — aucun port publié |
| `erp_app` tente un `CREATE TABLE` | `permission denied for schema public` |
| `erp_app` tente un `DELETE` sur l'audit | `permission denied for table audit_logs` |

- **Deux rôles PostgreSQL** : `erp_migrator` (DDL, migrations uniquement) et `erp_app`
  (DML seul). Une injection SQL réussie contre l'API ne peut ni créer d'objet, ni
  effacer une trace.
- **Trois réalms d'authentification** : `User` (interne), `PortalUser` (client),
  `FieldUser` (terrain) — trois tables distinctes, aucune élévation de privilège
  par confusion de rôle.
- **Réseau cloisonné** : PostgreSQL et Redis sur un réseau Docker `internal`.
- **Conteneurs durcis** : non-root, `cap_drop: ALL`, `no-new-privileges`, images
  épinglées, limites de ressources.
- **Mots de passe** en Argon2id (paramètres OWASP), changement imposé à la 1ʳᵉ connexion.

---

## Pièges rencontrés — à ne pas réintroduire

**`node_modules` doit vivre dans un volume nommé**, jamais dans le bind mount.
Sous Windows et macOS, `npm install` à travers la couche de traduction du système
de fichiers passe de 2 minutes à jamais.

**Le conteneur `migrator` a besoin des deux réseaux.** Rattaché au seul réseau `data`
déclaré `internal`, il n'a aucune route vers le registre npm et attend indéfiniment.

**`rootDir` doit être explicite dans `tsconfig.json`.** Sans lui, TypeScript déduit la
racine du plus petit ancêtre commun des fichiers inclus : ajouter `prisma/**/*.ts` à
`include` faisait atterrir `main.js` dans `dist/src/` au lieu de `dist/`.
Le seed est exécuté par `tsx` et n'a pas besoin d'être listé.

**Prisma ne mappe pas les exceptions de trigger.** Un `RAISE EXCEPTION` remonte en
`PrismaClientUnknownRequestError`, avec le code SQLSTATE et le message enfouis dans le
texte. Le filtre d'exceptions doit attraper cette classe, sans quoi **tous les invariants
métier remontent en 500 muets** : les garde-fous fonctionnent, et l'utilisateur n'en voit
rien.

**`add_header` nginx n'est pas cumulatif.** Une seule directive dans un bloc `location`
annule tous les en-têtes hérités du niveau `server`. Les en-têtes de sécurité vivent donc
dans un fragment réinclus explicitement dans chaque `location`.

**Le parseur de template Angular lit `<` comme une ouverture de balise.** Toute
comparaison dans une interpolation (`{{ n < 0 ? … }}`) casse le rendu ; un `/` dans un
nom de binding (`[class.ring-rose-500/40]`) aussi. Les conditions se calculent dans le
composant.

**Toute propriété d'un DTO doit porter un décorateur de validation.** Avec
`forbidNonWhitelisted`, class-transformer matérialise la propriété même absente de la
requête, et le validateur rejette la requête entière en 400.
