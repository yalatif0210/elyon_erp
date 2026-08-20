# Déploiement — staging, second VPS

Complète `DEPLOIEMENT.md` (production) : ce document couvre uniquement ce qui
diffère pour le staging. Se référer à `DEPLOIEMENT.md` pour tout le reste
(dimensionnement, prérequis Docker, principe du certificat d'origine
Cloudflare).

## Ce que le staging valide, et ce qu'il ne valide pas

Voir le plan approuvé (`git log` ou l'historique de conversation) pour le
raisonnement complet. En résumé : le staging démarre **vide**, comme la
production (`db:deploy`, jamais `db:setup`) — il n'a donc **aucun compte
utilisateur**, ni pour un humain, ni pour la suite de recette. Ce n'est pas un
oubli : sa fonction est de prouver que le **déploiement lui-même** fonctionne
(migrations, conteneurs sains, réseau, TLS) sur une base neuve, exactement les
défauts qui ne se voient qu'à un déploiement réel — pas de rejouer les
parcours métier, ce que la CI fait déjà, en continu, sur une pile éphémère et
semée.

Si un jour vous voulez aussi parcourir le staging à la main, `npm run
db:bootstrap-admin` (§ 3) crée le premier compte, de rôle DG — depuis lequel
les autres comptes se créent, dans l'écran « Gérer les utilisateurs ».

## 1. DNS (Cloudflare)

Trois enregistrements supplémentaires, tous **proxiés**, pointant vers l'IP
du **second** VPS (distincte de celle de production) :

| Type | Nom | Valeur | Proxy |
|---|---|---|---|
| A | `staging-erp` | IP du VPS de staging | ✅ |
| A | `staging-terrain` | IP du VPS de staging | ✅ |
| A | `staging-portail` | IP du VPS de staging | ✅ |

Aucun nouveau certificat à émettre : celui déjà obtenu pour la production
(`elyon-trading.com, *.elyon-trading.com`, § 2 de `DEPLOIEMENT.md`) couvre
déjà ces sous-domaines. Le déposer sur le VPS de staging exactement comme sur
celui de production (`certs/cloudflare/`) — c'est le même fichier, copié une
seconde fois, pas un nouveau à générer.

## 2. Le VPS

Un second VPS, plus modeste que celui de production faute de trafic réel à
servir — **2 vCPU / 4 Go RAM / 40 Go SSD** est un point de départ raisonnable,
à ajuster si la suite de recette s'y révèle trop lente. Mêmes prérequis que
la production : Docker Engine + le plugin Compose, rien d'autre installé sur
l'hôte.

### 2.1 Installer Docker

```bash
# Connecté avec l'accès initial du fournisseur (root, sur VPS neuf) :
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
rm get-docker.sh
docker compose version   # doit répondre - sinon le plugin Compose manque
```

### 2.2 Utilisateur dédié au déploiement automatique

Le pipeline CI/CD (`deploy-staging.yml`) se connecte en SSH pour chaque
déploiement. Il lui faut son propre utilisateur, non-root, avec sa propre
clé - jamais la clé personnelle d'un administrateur, jamais celle de la
production : une fuite d'un côté ne doit rien ouvrir de l'autre.

```bash
# Sur un poste de confiance (pas forcément le VPS) - clé SANS phrase de
# passe : GitHub Actions ne peut pas en saisir une à l'exécution.
ssh-keygen -t ed25519 -N "" -C "elyon-erp-staging-deploy" -f staging_deploy
```

```bash
# Sur le VPS, toujours avec l'accès root initial :
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh
echo "<contenu de staging_deploy.pub>" >> /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

`staging_deploy` (la clé PRIVÉE) devient la valeur du secret
`STAGING_SSH_KEY` (§ 4) ; `deploy` devient `STAGING_SSH_USER`. Ne jamais
déposer la clé privée sur le VPS lui-même - seule la clé publique y va.

### 2.3 Accès personnel (administrateur humain)

`deploy` (§ 2.2) est un compte de service, réservé au pipeline - jamais un
accès pour une personne. Une fois le mot de passe root désactivé (§ 2.4),
c'est le SEUL autre moyen de se connecter : il en faut donc un avant de
fermer cette porte, pas après.

```bash
# Sur le poste de l'administrateur - sa propre clé, distincte de celle du
# pipeline et de celle de production :
ssh-keygen -t ed25519 -C "<nom> - acces staging" -f ~/.ssh/id_ed25519_elyon_staging
```

```bash
# Sur le VPS, toujours avec l'accès root initial :
adduser --disabled-password --gecos "" <utilisateur>
usermod -aG sudo,docker <utilisateur>
mkdir -p /home/<utilisateur>/.ssh
echo "<contenu de id_ed25519_elyon_staging.pub>" >> /home/<utilisateur>/.ssh/authorized_keys
chown -R <utilisateur>:<utilisateur> /home/<utilisateur>/.ssh
chmod 700 /home/<utilisateur>/.ssh
chmod 600 /home/<utilisateur>/.ssh/authorized_keys
```

Vérifier `ssh -i ~/.ssh/id_ed25519_elyon_staging <utilisateur>@<vps>` puis
`sudo whoami` (doit répondre `root`) avant de passer à la suite.

> **Si cette étape a été oubliée et que le mot de passe root est déjà
> désactivé** : un compte membre du groupe `docker` (ici `deploy`) permet de
> revenir à une racine root sans mot de passe ni console fournisseur - le
> groupe `docker` est root-équivalent par construction (accès direct au
> socket) :
> ```bash
> ssh -i staging_deploy deploy@<vps> \
>   "docker run --rm -v /:/host --privileged alpine chroot /host \
>     sh -c 'adduser --disabled-password --gecos \"\" <utilisateur> && \
>            usermod -aG sudo,docker <utilisateur>'"
> ```
> À réserver au dépannage : la voie normale reste la création manuelle
> ci-dessus, root et console fournisseur en main.

### 2.4 Durcissement minimal

```bash
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd
```

⚠️ Vérifier que `ssh -i staging_deploy deploy@<vps>` ET l'accès personnel
(§ 2.3) fonctionnent TOUS LES DEUX avant de fermer la session root : une
fois `PasswordAuthentication` désactivé, une clé mal copiée ferme la porte
pour de bon (l'accès console du fournisseur mis à part, qui reste toujours
disponible en dernier recours).

## 3. Premier déploiement manuel

⚠️ Cette étape UNIQUEMENT construit les images localement, plutôt que de les
récupérer depuis GHCR — parce qu'à ce stade, rien n'a encore été publié : le
workflow `CI` n'a pas encore tourné sur `dev`. C'est un geste de bootstrap, une
seule fois. Tous les déploiements automatiques suivants (§ 4) récupèrent les
images déjà construites et testées, sans jamais reconstruire sur ce VPS.

Identique à `DEPLOIEMENT.md` § 4, avec trois différences : la branche
(`dev`), le fichier `.env` modèle, et l'overlay de surcharge supplémentaire.

⚠️ À exécuter connecté en tant que `deploy` (§ 2.2), au chemin qui deviendra
`STAGING_DEPLOY_PATH` (§ 4, ex. `/home/deploy/elyon-erp`) - le pipeline
automatique reprendra ce même clone, avec les mêmes droits, pour chaque
déploiement suivant.

```bash
git clone <dépôt> elyon-erp && cd elyon-erp
git checkout dev

cp .env.staging.example .env
# Remplacer TOUTES les valeurs — secrets DISTINCTS de ceux de production,
# voir les commentaires du fichier.

mkdir -p certs/cloudflare
# … déposer le MÊME certificat d'origine que la production …

docker compose -f docker-compose.yml -f docker-compose.prod.yml \
                -f docker-compose.staging.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
                -f docker-compose.staging.yml up -d postgres redis

# db:deploy, jamais la commande par défaut du conteneur — voir
# l'avertissement dans docker-compose.yml et DEPLOIEMENT.md § 4.
docker compose --profile tools run --rm migrator sh -c "npm ci && npm run db:deploy"

# Premier compte (rôle DG) — variables BOOTSTRAP_ADMIN_* dans .env, DISTINCTES
# de celles de production. Sans effet si un DG existe déjà.
docker compose --profile tools run --rm migrator sh -c "npm ci && npm run db:bootstrap-admin"

docker compose -f docker-compose.yml -f docker-compose.prod.yml \
                -f docker-compose.staging.yml up -d
```

Vérifier que les cinq services sont sains :

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.staging.yml ps
```

Ce premier déploiement manuel, construit localement, n'est nécessaire qu'une
fois. Ensuite, `.github/workflows/deploy-staging.yml` prend le relais à
chaque `push` réussi sur `dev` — mais **récupère** `api`/`web`/`portal` déjà
construites et validées par la recette en CI (`docker compose pull`), il ne
les reconstruit plus jamais sur ce VPS. Seul `proxy` continue de se
construire ici, sa configuration nginx différant par environnement.

## 4. Activer le déploiement automatique

Dans les paramètres du dépôt GitHub, **Settings → Environments**, créer un
environnement nommé `staging` et y poser quatre secrets :

| Secret | Valeur |
|---|---|
| `STAGING_SSH_KEY` | Clé privée SSH dédiée (jamais celle de production), dont la clé publique correspondante est déjà autorisée (`~/.ssh/authorized_keys`) sur le VPS de staging. |
| `STAGING_SSH_HOST` | Adresse IP ou nom d'hôte du VPS de staging. |
| `STAGING_SSH_USER` | Utilisateur SSH (non-root, membre du groupe `docker`). |
| `STAGING_DEPLOY_PATH` | Chemin absolu du dépôt cloné sur le VPS, ex. `/home/deploy/elyon-erp` — celui du § 3. |

Aucun secret supplémentaire pour récupérer les images depuis GHCR : le
workflow s'authentifie avec son propre jeton `GITHUB_TOKEN`, forgé et détruit
à chaque exécution — rien de longue durée à stocker sur le VPS ni à faire
tourner. Si `docker login ghcr.io` échoue malgré tout une fois le pipeline
activé, vérifier dans **Settings → Packages** du dépôt que les paquets
`api`/`web`/`portal` sont bien visibles par ce dépôt (ils le sont par défaut
dès leur première publication depuis `ci.yml`).

Une fois les quatre secrets posés, tout `push` sur `dev` qui fait réussir le
workflow `CI` déclenche automatiquement `deploy-staging.yml`. Avant cela, le
workflow échoue à la connexion SSH — attendu, pas un défaut de sa part.

## 5. Outils d'exploitation — Portainer et pgAdmin

Identique à `DEPLOIEMENT.md` § 7 : même `docker-compose.tools.yml`, mêmes
principes (aucune exposition publique, tunnel SSH uniquement,
`PGADMIN_DEFAULT_EMAIL`/`PGADMIN_DEFAULT_PASSWORD` dans
`.env.staging.example`), simplement pointé vers ce second VPS :

```bash
ssh -L 9000:localhost:9000 -L 5050:localhost:5050 <utilisateur>@<vps-staging>
```

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
                -f docker-compose.staging.yml -f docker-compose.tools.yml up -d
```

Utiliser un **compte pgAdmin distinct** de celui de production (voir
`.env.staging.example`) — même logique que les secrets applicatifs : une
fuite d'un côté ne doit rien donner de l'autre.

## 6. Ce que ce déploiement NE couvre PAS

- **La promotion vers la production** — reste manuelle à ce stade (voir le
  plan). Un `deploy-prod.yml` viendra dans un second temps, une fois le
  staging éprouvé.
- **Les sauvegardes** — un environnement de staging vide n'a rien d'unique à
  perdre ; contrairement à la production, le reconstruire de zéro
  (`docker compose down -v` puis redéploiement) est une réponse acceptable à
  n'importe quel incident.
