#!/bin/sh
# ===========================================================================
#  Création du rôle applicatif de moindre privilège (SPECIFICATIONS.md § 1.4).
#  Exécuté une seule fois, à l'initialisation du volume PostgreSQL.
#
#  POSTGRES_USER vaut erp_migrator : il est propriétaire de la base et porte
#  les migrations. erp_app, créé ici, ne servira qu'à l'application et ne
#  recevra jamais de droit DDL (cf. prisma/sql/04_grants.sql).
# ===========================================================================
set -e

if [ -z "$ERP_APP_PASSWORD" ]; then
  echo "ERREUR : ERP_APP_PASSWORD non défini. Refus de créer un rôle sans mot de passe." >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE ROLE erp_app WITH LOGIN PASSWORD '${ERP_APP_PASSWORD}'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;

    GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO erp_app;

    -- Aucun droit par défaut sur le schéma public : tout est accordé
    -- explicitement après migration par 04_grants.sql.
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    REVOKE CREATE ON SCHEMA public FROM erp_app;

    -- Le rôle applicatif ne doit pas pouvoir énumérer les autres bases.
    REVOKE ALL ON DATABASE "${POSTGRES_DB}" FROM PUBLIC;
EOSQL

echo "Rôle erp_app créé avec les privilèges minimaux."
