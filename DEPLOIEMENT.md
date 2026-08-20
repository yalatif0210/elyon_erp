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

Suppose le domaine `elyon-trading.com` déjà actif dans Cloudflare (zone
créée, serveurs de noms déjà pointés dessus) - ce qui suit ajoute seulement
les enregistrements, pas la zone elle-même.

1. Se connecter sur [dash.cloudflare.com](https://dash.cloudflare.com),
   sélectionner le compte puis la zone **`elyon-trading.com`**.
2. Dans le menu de gauche : **DNS → Records**.
3. Bouton **Add record**, une fois par ligne du tableau ci-dessous :
   - **Type** : `A`
   - **Name** : la valeur de la colonne « Nom » (`@` pour la racine du
     domaine si Cloudflare ne propose pas `elyon-trading.com` tel quel)
   - **IPv4 address** : l'IP du VPS de production
   - **Proxy status** : basculer sur **Proxied** (nuage orange - jamais
     « DNS only », qui exposerait l'IP réelle et court-circuiterait le TLS
     Cloudflare)
   - **TTL** : `Auto`
   - **Save**

| Type | Nom | Valeur | Proxy |
|---|---|---|---|
| A | `elyon-trading.com` | IP du VPS | ✅ Proxied |
| A | `www` | IP du VPS | ✅ Proxied |
| A | `erp` | IP du VPS | ✅ Proxied |
| A | `terrain` | IP du VPS | ✅ Proxied |
| A | `portail` | IP du VPS | ✅ Proxied |

4. Toujours dans le menu de gauche : **SSL/TLS → Overview**, sélectionner le
   mode **Full (strict)** (pas « Flexible » : le VPS chiffre lui aussi côté
   origine, avec le certificat du § 2 - « Flexible » laisserait la moitié du
   trajet en clair).

Propagation : quelques minutes en général, jusqu'à 24 h dans de rares cas
(`dig erp.elyon-trading.com` doit renvoyer l'IP du VPS pour confirmer).

## 2. Certificat d'origine Cloudflare

Un seul certificat, couvrant tout le domaine avec le joker (`*`) - le même
fichier sert à la production ET au staging (`DEPLOIEMENT_STAGING.md` § 1),
à copier une seconde fois, jamais à régénérer.

1. Toujours dans la zone `elyon-trading.com` : **SSL/TLS → Origin Server**.
2. Bouton **Create Certificate**.
3. Dans la boîte de dialogue :
   - **Private key type** : laisser sur « Generate private key and CSR with
     Cloudflare » (le plus simple - Cloudflare génère la clé pour vous,
     inutile de fournir son propre CSR).
   - **Hostnames** : `elyon-trading.com` et `*.elyon-trading.com`, un par
     ligne (le joker couvre `erp.`, `terrain.`, `portail.`, `staging-erp.`,
     etc. - tous les sous-domaines actuels et futurs).
   - **Key format** : `RSA (2048)`.
   - **Certificate Validity** : `15 years` (par défaut).
4. Bouton **Create**. Cloudflare affiche deux zones de texte :
   - **Origin Certificate** - commence par `-----BEGIN CERTIFICATE-----`.
   - **Private Key** - commence par `-----BEGIN PRIVATE KEY-----`.

   ⚠️ **La clé privée ne s'affiche qu'à cet instant, une seule fois.**
   Fermer la boîte de dialogue sans l'avoir copiée oblige à créer un nouveau
   certificat (l'ancien reste valide mais inutilisable sans sa clé) - copier
   les DEUX blocs, avec leurs lignes `BEGIN`/`END`, avant de fermer.

5. Sur le VPS (connecté avec l'accès personnel du § 3.1) :

```bash
mkdir -p certs/cloudflare
nano certs/cloudflare/cloudflare-origin.pem   # coller le bloc « Origin Certificate », enregistrer (Ctrl+O, Entrée, Ctrl+X)
nano certs/cloudflare/cloudflare-origin.key   # coller le bloc « Private Key », enregistrer
chmod 600 certs/cloudflare/cloudflare-origin.key
```

Ce répertoire est exclu du dépôt (`.gitignore`) — il ne doit **jamais** être
committé, ni transiter autrement qu'en copie directe sur le VPS (jamais par
messagerie, jamais collé dans un outil tiers).

## 3. Le VPS

Recommandation de dimensionnement, faute de contrainte connue :
**4 vCPU / 8 Go RAM / 80 Go SSD**, Ubuntu 22.04 ou 24.04 LTS. Les limites
posées dans `docker-compose.yml` plafonnent chaque service à titre de
garde-fou (§ en-tête du fichier) ; elles ne présument pas d'une charge
simultanée à leur maximum.

Prérequis : Docker Engine + le plugin Compose (`docker compose version`
doit répondre). Rien d'autre — aucun Node, aucun nginx installés sur l'hôte,
tout vit en conteneur.

### 3.1 Accès SSH

Aucun pipeline automatique ne se connecte à ce VPS aujourd'hui (la promotion
vers la production reste manuelle - voir `DEPLOIEMENT_STAGING.md` § 6) - pas
de compte de service `deploy` à créer ici, contrairement au staging. Il faut
malgré tout un accès personnel, par clé, pour quiconque opère ce VPS : suivre
`DEPLOIEMENT_STAGING.md` § 2.1 (Docker), § 2.3 (créer un utilisateur
non-root, membre de `sudo` et `docker`, avec sa propre clé) et § 2.4
(`PermitRootLogin no`, `PasswordAuthentication no`) - identique, sans le
§ 2.2 (utilisateur `deploy`) qui ne concerne que le pipeline de staging. Le
jour où un `deploy-prod.yml` existera, le § 2.2 s'appliquera aussi ici, avec
sa propre clé, distincte de celle du staging.

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

# ⚠️ NE JAMAIS lancer `migrator` sans substituer sa commande en production.
#
#    Sa commande PAR DÉFAUT (utilisée en développement local et en CI) enchaîne
#    migration PUIS semis du jeu de données de démonstration (`db:setup` →
#    `db:seed`) : des tiers, sites et affaires fictifs atterriraient dans la
#    base réelle. `db:deploy` applique uniquement les migrations déjà commises
#    au dépôt — jamais de génération de migration, jamais de semis.
docker compose --profile tools run --rm migrator sh -c "npm ci && npm run db:deploy"

# ⚠️ Sans cette étape, personne - pas même le DG - ne peut se connecter.
#
#    La seule création de compte de tout le projet vit dans le semis de
#    démonstration, volontairement absent de `db:deploy` ci-dessus. Ce script
#    crée le tout premier compte, de rôle DG - celui qui pourra ensuite en
#    créer d'autres depuis l'écran « Gérer les utilisateurs ». Sans effet si
#    un DG existe déjà : rejouable sans risque après un redéploiement.
#    Variables requises dans .env : BOOTSTRAP_ADMIN_EMAIL,
#    BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_PASSWORD.
docker compose --profile tools run --rm migrator sh -c "npm ci && npm run db:bootstrap-admin"

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Vérifier que les cinq services sont sains :

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

## 5. Après le premier déploiement — une base d'affaires VIDE, à peupler

⚠️ `db:deploy` (§ 4) n'exécute AUCUN semis : la production démarre sans le
moindre tiers, site, devise ou modèle de checklist fictif — seulement le
schéma et les vues. C'est voulu : les tiers, sites et affaires du jeu de
démonstration (« Compagnie Maritime Atlantique SA », etc.) n'ont rien à faire
dans une base réelle.

Chaque réglage absent tourne sur son repli codé (`SettingsService`), tracé et
listé dans l'écran **Surveillance** (« Paramètres dont les verrous
dépendent ») — l'application ne plante pas, elle affiche ce qui manque
plutôt que d'inventer une valeur. Le compte DG créé au § 4 permet de se
connecter dès le premier démarrage ; c'est depuis ce compte que les autres
comptes (internes, terrain, portail) se créent ensuite, dans l'écran **Gérer
les utilisateurs** — voir le commentaire d'en-tête de
`apps/api/src/admin/user-admin.controller.ts` pour le détail des trois
réalmes. Avant tout document réel, ce compte DG doit aussi, depuis les
écrans **Paramétrage** et **Référentiels** :

- Créer les devises, pays, postes de coûts, modèles de checklist HSE et
  autres référentiels métier RÉELS d'Elyon Trading — rien n'est pré-rempli.
- Régler en particulier deux paramètres système, dont le repli codé ne
  convient à aucun déploiement réel :
  - **`DOCUMENT_VERIFY_BASE_URL`** → `https://erp.elyon-trading.com`. Son
    repli codé est une chaîne vide : tant qu'il n'est pas réglé, le lien du
    QR code imprimé sur chaque pièce scellée (facture, bon de livraison,
    rapport d'exécution) reste relatif, donc injoignable depuis un téléphone.
  - **`FNE_API_BASE_URL`** → l'URL de production transmise par la DGI après
    validation des spécimens de factures. Son repli codé est également une
    chaîne vide : tant qu'il n'est pas réglé, toute transmission FNE est
    proprement refusée (« FNE_API_BASE_URL non paramétré »), jamais envoyée
    au mauvais endroit.

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

## 7. Outils d'exploitation — Portainer et pgAdmin (optionnel)

`docker-compose.tools.yml` ajoute Portainer (pilotage de Docker) et pgAdmin
(inspection de PostgreSQL), sur ce VPS comme sur celui de staging. Aucun des
deux n'est requis pour que l'application tourne — à activer seulement si vous
voulez ces interfaces.

⚠️ **Ni l'un ni l'autre n'est joignable depuis Internet, par construction.**
Portainer pilote Docker sur l'hôte (donc, en cas de compromission, équivalent
à un accès root) et pgAdmin donne un accès direct aux données réelles de
l'entreprise. Les deux publient leur port sur `127.0.0.1` **uniquement** —
aucun sous-domaine, aucune route dans le relais public. Le seul chemin
d'accès est un tunnel SSH depuis un poste déjà autorisé à se connecter au
VPS :

```bash
ssh -L 9000:localhost:9000 -L 5050:localhost:5050 <utilisateur>@<vps>
```

puis, depuis le navigateur **de ce poste** (jamais une adresse publique) :
`http://localhost:9000` pour Portainer, `http://localhost:5050` pour
pgAdmin. Fermer le terminal ferme l'accès — rien ne reste ouvert entre deux
sessions.

### Activer

```bash
# En plus des variables habituelles du § 4, dans .env :
#   PGADMIN_DEFAULT_EMAIL=...
#   PGADMIN_DEFAULT_PASSWORD=...

docker compose -f docker-compose.yml -f docker-compose.prod.yml \
                -f docker-compose.tools.yml up -d
```

- **Portainer** : ouvrir `http://localhost:9000` (par le tunnel) **dans les 5
  minutes** suivant le premier démarrage — passé ce délai, la création du
  compte administrateur se verrouille et il faut redémarrer le conteneur
  (`docker compose restart portainer`) pour rouvrir la fenêtre.
- **pgAdmin** : se connecter avec `PGADMIN_DEFAULT_EMAIL`/`PASSWORD`, puis
  ajouter le serveur PostgreSQL à la main (« Add New Server ») — rien n'est
  préconfiguré :
  - Hôte : `postgres` · Port : `5432` · Base : la valeur de `POSTGRES_DB`.
  - Rôle : `erp_app` pour l'inspection courante (celui de l'application,
    DML seul). N'utiliser `erp_migrator` (DDL) que pour une intervention de
    schéma délibérée — jamais par défaut, jamais pour consulter des données.

### Durcissement — un écart assumé et documenté

Le reste de cette pile tourne en système de fichiers en lecture seule, sans
capacité Linux superflue (`cap_drop: ALL`), sans élévation de privilège
possible. **pgAdmin ne le supporte pas** : son script de démarrage a besoin
d'écrire sa configuration et de changer d'utilisateur via `sudo` à chaque
lancement — contraint en lecture seule ou sans `no-new-privileges`, il ne
démarre tout simplement pas (constaté en le testant, pas une supposition).
`docker-compose.tools.yml` le documente en commentaire à l'endroit précis. La
frontière de sécurité qui reste, pour ces deux outils, est donc entièrement
l'absence d'exposition réseau ci-dessus — pas l'isolation du conteneur.
Portainer, lui, garde le même durcissement que le reste de la pile ; sa seule
exception inévitable est l'accès au socket Docker, sans quoi il n'aurait
justement rien à piloter.
