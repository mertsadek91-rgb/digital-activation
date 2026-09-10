-- ===========================================================================
-- Postgres roles and schema isolation for the licence vault.
--
-- Runs automatically on first `docker compose up` (mounted into
-- /docker-entrypoint-initdb.d). In production the same statements are applied
-- once by hand against the managed instance.
--
-- Three roles, deliberately:
--   da        owner. Only `prisma migrate` uses it.
--   da_app    the API's normal role. Full access to `public`, NONE to `vault`.
--   da_vault  used only by the API's licence-vault module. Access to `vault`,
--             plus read on the few `public` tables it must join for reporting.
--
-- The point of the split: an SQL-injection or a compromised handler anywhere in
-- the ordinary application cannot read encrypted key rows, because its
-- connection has no grant on that schema at all.
-- ===========================================================================

CREATE SCHEMA IF NOT EXISTS public;
CREATE SCHEMA IF NOT EXISTS vault;

-- --- roles -----------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'da_app') THEN
    CREATE ROLE da_app LOGIN PASSWORD 'da_local_dev';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'da_vault') THEN
    CREATE ROLE da_vault LOGIN PASSWORD 'da_local_dev';
  END IF;
END
$$;

-- --- nobody gets anything by default ---------------------------------------
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA vault  FROM PUBLIC;
ALTER DATABASE da_main OWNER TO da;
ALTER SCHEMA public OWNER TO da;
ALTER SCHEMA vault  OWNER TO da;

-- --- da_app: public only ---------------------------------------------------
GRANT USAGE ON SCHEMA public TO da_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO da_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO da_app;
ALTER DEFAULT PRIVILEGES FOR ROLE da IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO da_app;
ALTER DEFAULT PRIVILEGES FOR ROLE da IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO da_app;

-- The vault is not merely ungranted, it is explicitly denied, so a future
-- blanket GRANT cannot quietly open it.
REVOKE ALL ON SCHEMA vault FROM da_app;

-- --- da_vault: vault read/write, public read-only --------------------------
GRANT USAGE ON SCHEMA vault TO da_vault;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA vault TO da_vault;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA vault TO da_vault;
ALTER DEFAULT PRIVILEGES FOR ROLE da IN SCHEMA vault
  GRANT SELECT, INSERT, UPDATE ON TABLES TO da_vault;
ALTER DEFAULT PRIVILEGES FOR ROLE da IN SCHEMA vault
  GRANT USAGE, SELECT ON SEQUENCES TO da_vault;

-- Keys are never hard-deleted; they move to REVOKED/EXPIRED so the audit trail
-- survives. Withholding DELETE makes that a database guarantee, not a habit.
REVOKE DELETE ON ALL TABLES IN SCHEMA vault FROM da_vault;

GRANT USAGE ON SCHEMA public TO da_vault;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO da_vault;
ALTER DEFAULT PRIVILEGES FOR ROLE da IN SCHEMA public
  GRANT SELECT ON TABLES TO da_vault;
