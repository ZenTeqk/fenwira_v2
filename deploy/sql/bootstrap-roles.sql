-- One-time database bootstrap for a managed PostgreSQL 16 (Amazon RDS) or any server where the
-- connecting admin is not a true superuser. Equivalent of the Compose init script
-- infrastructure/docker/postgres/init/01-roles.sh. Run as the RDS master user:
--
--   psql "host=<endpoint> dbname=postgres user=<master> sslmode=verify-full sslrootcert=<bundle>" \
--     -v owner_pw='<owner password>' -v app_pw='<app password>' -v db=fenwira \
--     -f deploy/sql/bootstrap-roles.sql
--
-- Roles (docs/MULTI_TENANCY.md): fenwira_owner owns the schema and runs migrations; fenwira_app is
-- the runtime role WITHOUT BYPASSRLS; fenwira_system (NOLOGIN, BYPASSRLS) owns the documented
-- SECURITY DEFINER system functions. Re-running fails on the existing roles: it is a one-time step.
\set ON_ERROR_STOP on

CREATE ROLE fenwira_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEROLE;
CREATE ROLE fenwira_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
-- On RDS this statement is the one to verify first: it requires the admin to be allowed to grant
-- BYPASSRLS. If it is refused, stop; the system functions depend on this role.
CREATE ROLE fenwira_system NOLOGIN BYPASSRLS NOSUPERUSER;
GRANT fenwira_system TO fenwira_owner;
-- Managed PostgreSQL: the admin must be a member of the owner to create a database owned by it.
GRANT fenwira_owner TO CURRENT_USER;

CREATE DATABASE :"db" OWNER fenwira_owner;
\connect :"db"

REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO fenwira_app;
ALTER SCHEMA public OWNER TO fenwira_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS system AUTHORIZATION fenwira_owner;
GRANT USAGE, CREATE ON SCHEMA system TO fenwira_system;
GRANT USAGE ON SCHEMA public, system TO fenwira_app;
