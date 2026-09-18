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

-- --- the ledgers cannot be rewritten by the application ---------------------
--
-- `AuditLog` carries a hash chain so that a row removed from the middle breaks
-- every hash after it, and `StockMovement` is the ledger that answers "where
-- did this key go" without trusting a mutable counter. Both were append-only
-- by convention only: the services never call update or delete, but `da_app`
-- held both grants, with no trigger and no row-level security behind them. A
-- single injected statement, a stray raw query, or a console open on the app
-- connection could edit or erase either one.
--
-- The chain proved the point before this was written. Three audit rows from
-- 11–12 September are missing: their successors carry a `hashPrev` that no
-- surviving row's `hash` matches, and a successor can only have read a hash
-- that was committed at the time. So the rows existed, and then did not.
--
-- Same reasoning as the vault above, and the same remedy: withhold the grant
-- and the guarantee stops depending on every future caller's restraint.
-- `KeyAccessLog` is who-read-which-key and is only ever appended to, so UPDATE
-- goes too; `LicenseKey` keeps UPDATE because its states genuinely move
-- (AVAILABLE -> RESERVED -> ASSIGNED -> DELIVERED).
--
-- `prisma migrate` owns these tables and can still correct them. Re-run this
-- file (`pnpm db:roles`) after a migration that recreates one, or the default
-- privileges above will hand the grants back.
REVOKE UPDATE, DELETE ON public."AuditLog"       FROM da_app;
REVOKE UPDATE, DELETE ON public."StockMovement"  FROM da_app;
REVOKE UPDATE, DELETE ON public."KeyImportBatch" FROM da_app;
REVOKE UPDATE ON vault."KeyAccessLog" FROM da_vault;
