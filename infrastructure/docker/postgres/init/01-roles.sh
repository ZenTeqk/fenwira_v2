#!/usr/bin/env bash
# Runs once, as the postgres superuser, on first container start (docs/DEPLOYMENT.md →
# Postgres initialization). Also used by CI against a service container (set PGHOST etc.).
set -euo pipefail

: "${FENWIRA_OWNER_PASSWORD:?FENWIRA_OWNER_PASSWORD is required}"
: "${FENWIRA_APP_PASSWORD:?FENWIRA_APP_PASSWORD is required}"
DATABASES="${FENWIRA_DATABASES:-fenwira fenwira_test}"

psql_su() { psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" "$@"; }

psql_su --dbname postgres \
  -v owner_pw="$FENWIRA_OWNER_PASSWORD" -v app_pw="$FENWIRA_APP_PASSWORD" <<'SQL'
-- Migrations/DDL. Not a superuser: FORCE ROW LEVEL SECURITY applies to it at runtime too.
CREATE ROLE fenwira_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEROLE;
-- Runtime role for api and worker: DML only, can never bypass RLS.
CREATE ROLE fenwira_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
-- Owns the system.* SECURITY DEFINER functions; cannot log in (docs/MULTI_TENANCY.md).
CREATE ROLE fenwira_system NOLOGIN BYPASSRLS NOSUPERUSER;
-- Lets the owner assign function ownership to fenwira_system during post-migrate.
GRANT fenwira_system TO fenwira_owner;
SQL

for db in $DATABASES; do
  psql_su --dbname postgres -c "CREATE DATABASE ${db} OWNER fenwira_owner"
  psql_su --dbname "$db" <<SQL
REVOKE ALL ON DATABASE ${db} FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO fenwira_app;
ALTER SCHEMA public OWNER TO fenwira_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS system AUTHORIZATION fenwira_owner;
GRANT USAGE, CREATE ON SCHEMA system TO fenwira_system;
GRANT USAGE ON SCHEMA public, system TO fenwira_app;
SQL
done

echo "fenwira roles and databases initialised: ${DATABASES}"
