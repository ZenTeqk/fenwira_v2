-- Probe whether this PostgreSQL server allows Fenwira's role model (deploy/sql/bootstrap-roles.sql)
-- BEFORE bootstrapping it. Changes nothing: everything runs in one transaction that is rolled back.
-- Run as the RDS master user, from the Fenwira app server (the database is private):
--
--   psql "host=<rds-endpoint> dbname=postgres user=fenwira_admin sslmode=verify-full \
--         sslrootcert=/etc/fenwira/rds-global-bundle.pem" -f deploy/sql/verify-rds-privileges.sql
--
-- Every line must say PASS. Any FAIL means the role model is incompatible as-is: stop, do not
-- weaken RLS, and report the exact message (infra/terraform/README.md → RDS privilege gate).
\set ON_ERROR_STOP off
\pset tuples_only on
\pset format unaligned

SELECT 'INFO server ' || version();
SELECT format('INFO current_user=%s superuser=%s createrole=%s createdb=%s bypassrls=%s',
              r.rolname, r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls)
FROM pg_roles r WHERE r.rolname = current_user;

BEGIN;

DO $probe$
BEGIN
  BEGIN
    CREATE ROLE fenwira_probe_owner NOLOGIN NOSUPERUSER NOCREATEROLE;
    RAISE NOTICE 'PASS create owner-style role';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'FAIL create owner-style role: % (%)', SQLERRM, SQLSTATE;
  END;

  BEGIN
    CREATE ROLE fenwira_probe_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    RAISE NOTICE 'PASS create runtime role without BYPASSRLS';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'FAIL create runtime role: % (%)', SQLERRM, SQLSTATE;
  END;

  -- The critical one: fenwira_system owns the SECURITY DEFINER system functions.
  BEGIN
    CREATE ROLE fenwira_probe_system NOLOGIN BYPASSRLS NOSUPERUSER;
    RAISE NOTICE 'PASS create BYPASSRLS role (fenwira_system model is supported)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'FAIL create BYPASSRLS role: % (%)', SQLERRM, SQLSTATE;
  END;

  BEGIN
    EXECUTE 'GRANT fenwira_probe_system TO fenwira_probe_owner';
    EXECUTE format('GRANT fenwira_probe_owner TO %I', current_user);
    RAISE NOTICE 'PASS role grants (system → owner, owner → admin)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'FAIL role grants: % (%)', SQLERRM, SQLSTATE;
  END;

  BEGIN
    CREATE EXTENSION IF NOT EXISTS citext;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    RAISE NOTICE 'PASS extensions citext, pg_trgm';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'FAIL extensions: % (%)', SQLERRM, SQLSTATE;
  END;
END
$probe$;

ROLLBACK;
SELECT 'INFO rolled back; no roles or extensions were left behind';
