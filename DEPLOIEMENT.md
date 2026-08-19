# Déploiement — VPS unique, derrière Cloudflare

Cible : un seul VPS hébergeant la vitrine, l'ERP (console + terrain) et le
portail client, sous `elyon-trading.com`, Cloudflare devant en mode
**Full (strict)**.

```
                         Cloudflare (proxy DNS, WAF, TLS edge)
                                      │
                                      ▼
                         VPS — conteneur `proxy` (80/443)
                    ┌─────────────────┼─────────────────────┐
                    ▼                 ▼                     ▼
     elyon-trading.com    erp. / terrain.elyon-      portail.elyon-
     (vitrine statique)   trading.com → `web:8080`   trading.com → `portal:4000`
                                      │                      │
                                      └──────────┬───────────┘
                                                  ▼
                                            `api:3000`
                                                  │
                                      ┌───────────┴───────────┐
                                      ▼                       ▼
                                `postgres`                 `redis`
                         (réseau `data`, aucune route sortante)
```

`erp.` et `terrain.` pointent vers le **même** conteneur `web` — une seule
application Angular, deux réalms de session distincts (§ `app.routes.ts`).
Le sous-domaine ne fait que donner à l'agent terrain une adresse à lui ; il
n'ajoute aucune application séparée à construire ou à surveiller.

## 1. DNS (Cloudflare)

Quatre enregistrements, tous **proxiés** (nuage orange) :

| Type | Nom | Valeur | Proxy |
|---|---|---|---|
| A | `elyon-trading.com` | IP du VPS | ✅ |
| A | `www` | IP du VPS | ✅ |
| A | `erp` | IP du VPS | ✅ |
| A | `terrain` | IP du VPS | ✅ |
| A | `portail` | IP du VPS | ✅ |

Puis, dans **SSL/TLS → Overview** : mode **Full (strict)**.

## 2. Certificat d'origine Cloudflare

Dans **SSL/TLS → Origin Server → Create Certificate** :
- Liste d'hôtes : `elyon-trading.com, *.elyon-trading.com`
- Validité : 15 ans (par défaut)
- Format de clé : RSA (2048)

Cloudflare affiche deux blocs : le certificat et la clé privée. Sur le VPS :

```bash
mkdir -p certs/cloudflare
# Coller le certificat dans certs/cloudflare/cloudflare-origin.pem
# Coller la clé      dans certs/cloudflare/cloudflare-origin.key
chmod 600 certs/cloudflare/cloudflare-origin.key
```

Ce répertoire est exclu du dépôt (`.gitignore`) — il ne doit **jamais** être
committé, ni transiter autrement qu'en copie directe sur le VPS.

## 3. Le VPS

Recommandation de dimensionnement, faute de contrainte connue :
**4 vCPU / 8 Go RAM / 80 Go SSD**, Ubuntu 22.04 ou 24.04 LTS. Les limites
posées dans `docker-compose.yml` plafonnent chaque service à titre de
garde-fou (§ en-tête du fichier) ; elles ne présument pas d'une charge
simultanée à leur maximum.

Prérequis : Docker Engine + le plugin Compose (`docker compose version`
doit répondre). Rien d'autre — aucun Node, aucun nginx installés sur l'hôte,
tout vit en conteneur.

## 4. Premier déploiement

```bash
git clone <dépôt> elyon-erp && cd elyon-erp

cp .env.example .env
# Remplacer TOUTES les valeurs — voir les commentaires du fichier.
# CORS_ALLOWED_ORIGINS doit lister erp., terrain. ET portail. (trois
# origines distinctes pour le navigateur, une seule application pour deux
# d'entre elles) :
#   CORS_ALLOWED_ORIGINS=https://erp.elyon-trading.com,https://terrain.elyon-trading.com,https://portail.elyon-trading.com

mkdir -p certs/cloudflare
# … déposer le certificat et la clé, § 2 …

# Construction et démarrage des services de fond, PUIS migration, PUIS le
# reste — la base doit exister et être migrée avant que l'API ne démarre
# pour de bon, et le migrateur exige postgres déjà sain.
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres redis
docker compose --profile tools run --rm migrator
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Vérifier que les cinq services sont sains :

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

## 5. Après le premier déploiement — paramètres à mettre à jour

Deux réglages métier vivent en base (`system_settings`, paramétrage), pas
dans `.env` — ils sont posés à une valeur de test par le jeu de données de
démonstration et DOIVENT être corrigés avant tout document réel :

- **`DOCUMENT_VERIFY_BASE_URL`** → `https://erp.elyon-trading.com`. Sans
  cela, le QR code imprimé sur chaque pièce scellée (facture, bon de
  livraison, rapport d'exécution) pointe vers une adresse qui n'existe pas
  depuis un téléphone.
- **`FNE_API_BASE_URL`** → l'URL de production transmise par la DGI après
  validation des spécimens de factures (celle posée par défaut est
  l'environnement de test de la procédure de mai 2025).

Les deux se corrigent depuis l'écran **Paramétrage**, avec un compte DG —
jamais en écrivant directement en base.

## 6. Ce que ce déploiement NE couvre PAS

- **La vitrine** — `docker/vitrine/index.html` est un palier minimal
  (« site en construction »), pas le site définitif. Le remplacer ne
  demande aucun changement d'infrastructure : déposer le contenu réel dans
  `docker/vitrine/` et reconstruire le conteneur `proxy`.
- **Les sauvegardes** — `postgres_data` et `api_uploads` (photos et pièces
  terrain, § commentaire de `docker-compose.yml`) doivent être sauvegardés
  ensemble : un contrôle HSE validé sur photo perd sa preuve si l'un des
  deux est restauré sans l'autre.
- **La rotation du certificat d'origine** — 15 ans de validité par défaut,
  donc rien à automatiser à court terme ; à noter tout de même pour
  qui reprendra ce VPS dans plusieurs années.
