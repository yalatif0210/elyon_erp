# syntax=docker/dockerfile:1.7
# ===========================================================================
#  API NestJS — image de production
#  Réf. SPECIFICATIONS.md § 1.5
#
#  Build multi-stage : les outils de compilation, les devDependencies et les
#  sources TypeScript n'existent pas dans l'image finale. Exécution en
#  utilisateur non privilégié, système de fichiers destiné à être monté en
#  lecture seule (cf. docker-compose.yml).
# ===========================================================================

# --- Version épinglée. Jamais 'latest' : un build doit être reproductible. ---
ARG NODE_VERSION=22.11.0-alpine3.20

# ---------------------------------------------------------------------------
#  Étape 1 — Dépendances de production uniquement
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY apps/api/package.json apps/api/package-lock.json* ./
# npm ci exige un lockfile — obligatoire dès qu'il existe, pour un build
# reproductible. Repli sur npm install au tout premier build.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --ignore-scripts; \
    else npm install --omit=dev --ignore-scripts; fi

# ---------------------------------------------------------------------------
#  Étape 2 — Compilation
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY apps/api/package.json apps/api/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --ignore-scripts; \
    else npm install --ignore-scripts; fi
COPY apps/api/ ./
RUN npx prisma generate && npm run build

# ---------------------------------------------------------------------------
#  Étape 3 — Runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime

# tini : PID 1 correct, propagation des signaux, pas de processus zombie.
RUN apk add --no-cache tini=~0.19 \
 && rm -rf /var/cache/apk/*

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PORT=3000

WORKDIR /app

# L'utilisateur 'node' (uid 1000) existe déjà dans l'image officielle.
# Les fichiers appartiennent à root et sont seulement lisibles par node :
# le processus ne peut pas réécrire son propre code.
COPY --from=deps  --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/dist         ./dist
COPY --from=build --chown=root:root /app/package.json ./package.json
# Client Prisma généré (moteurs de requête inclus).
COPY --from=build --chown=root:root /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=root:root /app/prisma        ./prisma

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/health',timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
