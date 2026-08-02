# syntax=docker/dockerfile:1.7
# ===========================================================================
#  CONSOLE INTERNE ANGULAR — image de production
#  Réf. SPECIFICATIONS.md § 1.5
#
#  Build multi-stage : Node compile, nginx sert. L'image finale ne contient
#  ni Node, ni npm, ni les sources — seulement des fichiers statiques et un
#  serveur web, ce qui réduit d'autant la surface d'attaque.
# ===========================================================================

ARG NODE_VERSION=22.11.0-alpine3.20
ARG NGINX_VERSION=1.27.2-alpine3.20

# ---------------------------------------------------------------------------
#  Étape 1 — Compilation
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
# .npmrc est requis par npm ci — voir le fichier pour la raison.
COPY apps/web/package.json apps/web/package-lock.json* apps/web/.npmrc ./
RUN if [ -f package-lock.json ]; then npm ci --ignore-scripts; \
    else npm install --ignore-scripts --no-audit --no-fund; fi
COPY apps/web/ ./
RUN npm run build

# ---------------------------------------------------------------------------
#  Étape 2 — Service statique
# ---------------------------------------------------------------------------
FROM nginx:${NGINX_VERSION} AS runtime

COPY docker/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist/browser /usr/share/nginx/html

# nginx écrit ses caches et son PID : on les redirige vers /tmp, ce qui permet
# de monter le système de fichiers en lecture seule.
RUN sed -i 's|/var/run/nginx.pid|/tmp/nginx.pid|' /etc/nginx/nginx.conf \
 && sed -i '/^user /d' /etc/nginx/nginx.conf

# Le port 80 est privilégié : on écoute sur 8080 pour tourner sans privilège.
USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
