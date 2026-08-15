# syntax=docker/dockerfile:1.7
# ===========================================================================
#  Portail client Angular SSR — image de production
#  Réf. SPECIFICATIONS.md § 1.1, § 13
#
#  Application SÉPARÉE de la console interne (apps/web) — même charte visuelle,
#  autre socle : rendu serveur Node/Express (pas nginx statique), parce que le
#  portail sert un contenu par tiers et bénéficie du SEO/temps d'affichage du
#  SSR, là où la console interne est un outil de travail derrière connexion.
#  Build multi-stage, exécution en utilisateur non privilégié — même discipline
#  que docker/api.Dockerfile.
# ===========================================================================

ARG NODE_VERSION=22.11.0-alpine3.20

# ---------------------------------------------------------------------------
#  Étape 1 — Dépendances de production uniquement
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY apps/portal/package.json apps/portal/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --ignore-scripts; \
    else npm install --omit=dev --ignore-scripts; fi

# ---------------------------------------------------------------------------
#  Étape 2 — Compilation (build browser + serveur)
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY apps/portal/package.json apps/portal/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --ignore-scripts; \
    else npm install --ignore-scripts; fi
COPY apps/portal/ ./
RUN npm run build

# ---------------------------------------------------------------------------
#  Étape 3 — Runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime

RUN apk add --no-cache tini=~0.19 && rm -rf /var/cache/apk/*

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PORT=4000

WORKDIR /app

COPY --from=deps  --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/dist          ./dist
COPY --from=build --chown=root:root /app/package.json  ./package.json

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||4000,path:'/connexion',timeout:4000},r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/portal/server/server.mjs"]
