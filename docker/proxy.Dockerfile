# syntax=docker/dockerfile:1.7
# ===========================================================================
#  RELAIS PUBLIC — image de production
#  Réf. DEPLOIEMENT.md
#
#  Seul conteneur exposé sur l'hôte (80/443). Route par sous-domaine vers
#  `web`, `terrain` (même service que `web`), `portal`, et sert la vitrine en
#  statique. Le certificat d'origine Cloudflare est monté à l'exécution — un
#  secret ne se construit pas dans une image (voir docker-compose.prod.yml).
# ===========================================================================

ARG NGINX_VERSION=1.27.2-alpine3.20
# Défaut = production. L'overlay staging (docker-compose.staging.yml) substitue
# docker/nginx/proxy.staging.conf — mêmes blocs, sous-domaines distincts — sans
# dupliquer ce Dockerfile.
ARG NGINX_CONF=docker/nginx/proxy.conf

FROM nginx:${NGINX_VERSION} AS runtime
ARG NGINX_CONF

COPY ${NGINX_CONF} /etc/nginx/conf.d/default.conf
COPY docker/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY docker/vitrine/ /usr/share/nginx/vitrine/

# Même traitement que web.Dockerfile : écriture redirigée vers /tmp, port non
# privilégié, utilisateur non-root — pour tourner en système de fichiers en
# lecture seule et sans capacité superflue.
RUN sed -i 's|/var/run/nginx.pid|/tmp/nginx.pid|' /etc/nginx/nginx.conf \
 && sed -i '/^user /d' /etc/nginx/nginx.conf

USER nginx
EXPOSE 80 443

# --no-check-certificate : le certificat d'origine Cloudflare n'est reconnu
# que par Cloudflare, jamais par une chaîne de confiance générique — attendu,
# pas une anomalie à corriger ici.
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD wget -q --no-check-certificate --spider https://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
