-- ===========================================================================
-- Production role setup for a managed Postgres (Coolify, RDS, Neon, …).
--
-- The local docker-compose runs 01-roles.sql automatically on first boot. A
-- managed database has no init-script hook, so this runs once by hand, as the
-- database owner, with the passwords passed in as psql variables — never
-- hardcoded and never committed:
--
--   psql "$DATABASE_URL_MIGRATE" \
--     -v ON_ERROR_STOP=1 \
--     -v owner_role="$PGUSER" \
--     -v app_password="$DA_APP_PASSWORD" \
--     -v vault_password="$DA_VAULT_PASSWORD" \
--     -f packages/db/prisma/init/roles.prod.sql
--
-- Idempotent: safe to re-run after a database restore or a password rotation.
--
-- Why three roles at all: vault.LicenseKey holds the product itself, and a
-- leaked key cannot be recalled. da_app — the role the whole API runs as — is
-- given no grant on the vault schema, so an injection or a careless handler
-- anywhere in ordinary application code cannot read one. Run db:doctor
-- afterwards; it asserts that denial rather than assuming it.
-- ===========================================================================

\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS vault;

-- --- roles (created only if absent, password always synced) -----------------

SELECT format('CREATE ROLE da_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'da_app')
\gexec

SELECT format('CREATE ROLE da_vault LOGIN PASSWORD %L', :'vault_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'da_vault')
\gexec

SELECT format('ALTER ROLE da_app PASSWORD %L', :'app_password') \gexec
SELECT format('ALTER ROLE da_vault PASSWORD %L', :'vault_password') \gexec

-- Neither role may create databases, roles, or bypass RLS.
ALTER ROLE da_app   NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE da_vault NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- Cap concurrent connections so one runaway app cannot starve the database.
ALTER ROLE da_app   CONNECTION LIMIT 40;
ALTER ROLE da_vault CONNECTION LIMIT 10;

-- --- nothing is granted by default -----------------------------------------

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA vault  FROM PUBLIC;

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()) \gexec

-- --- da_app: public only, and explicitly denied the vault -------------------

GRANT USAGE ON SCHEMA public TO da_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO da_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO da_app;

ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO da_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO da_app;

-- Explicit, so a later blanket GRANT cannot quietly open the vault.
REVOKE ALL ON SCHEMA vault FROM da_app;
REVOKE ALL ON ALL TABLES IN SCHEMA vault FROM da_app;

-- --- da_vault: the vault, plus read-only public for reporting joins --------

GRANT USAGE ON SCHEMA vault TO da_vault;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA vault TO da_vault;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA vault TO da_vault;

ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA vault
  GRANT SELECT, INSERT, UPDATE ON TABLES TO da_vault;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA vault
  GRANT USAGE, SELECT ON SEQUENCES TO da_vault;

-- Keys are never hard-deleted; they move to REVOKED or EXPIRED so the audit
-- trail survives. Withholding DELETE makes that a database guarantee.
REVOKE DELETE ON ALL TABLES IN SCHEMA vault FROM da_vault;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA vault
  REVOKE DELETE ON TABLES FROM da_vault;

GRANT USAGE ON SCHEMA public TO da_vault;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO da_vault;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT SELECT ON TABLES TO da_vault;

-- --- report -----------------------------------------------------------------

SELECT
  r.rolname                                        AS role,
  has_schema_privilege(r.rolname, 'public', 'USAGE') AS public_usage,
  has_schema_privilege(r.rolname, 'vault', 'USAGE')  AS vault_usage,
  r.rolconnlimit                                   AS conn_limit
FROM pg_roles r
WHERE r.rolname IN ('da_app', 'da_vault')
ORDER BY r.rolname;
