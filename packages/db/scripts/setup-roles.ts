/**
 * Creates the two application Postgres roles and the vault schema.
 *
 *   pnpm db:roles
 *
 * Does the same job as prisma/init/roles.prod.sql, but over the `pg` client we
 * already depend on, so it needs no `psql` on PATH — which Windows machines
 * generally do not have. The SQL file remains the reference for anyone applying
 * this by hand on a server.
 *
 * Runs as the database owner (DATABASE_URL_MIGRATE) and is idempotent: safe to
 * re-run after a restore or a password rotation.
 *
 * The point of the exercise: `da_app` — the role the entire API runs as — is
 * given no grant on the `vault` schema, so an injection or a careless handler
 * in ordinary application code cannot read an encrypted licence key. `db:doctor`
 * then asserts that denial rather than trusting this script.
 */
import path from 'node:path';

import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

/**
 * CREATE ROLE takes no bind parameters for a password, so the value has to be
 * interpolated into the statement text. The quoting is therefore what stands
 * between this and an injection point, and it is done by `pg`'s own
 * `escapeLiteral` / `escapeIdentifier` rather than by hand.
 *
 * An earlier version had Postgres build the DDL with `format(%L, %I)` over a
 * round trip. That looked tidier but hung: `format` is VARIADIC "any", and
 * Postgres cannot infer the type of an untyped bind parameter in that position,
 * which left the client waiting on a statement the server had already parked.
 * Escaping client-side is both correct and one round trip instead of two.
 */
function ident(client: Client, value: string): string {
  return client.escapeIdentifier(value);
}

function literal(client: Client, value: string): string {
  return client.escapeLiteral(value);
}

async function roleExists(client: Client, role: string): Promise<boolean> {
  const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  return (rowCount ?? 0) > 0;
}

interface RoleSpec {
  name: string;
  passwordEnv: 'DA_APP_PASSWORD' | 'DA_VAULT_PASSWORD';
  connectionLimit: number;
}

const ROLES: RoleSpec[] = [
  { name: 'da_app', passwordEnv: 'DA_APP_PASSWORD', connectionLimit: 40 },
  { name: 'da_vault', passwordEnv: 'DA_VAULT_PASSWORD', connectionLimit: 10 },
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_MIGRATE;
  if (!url) throw new Error('DATABASE_URL_MIGRATE is not set.');

  const missing = ROLES.filter((role) => !process.env[role.passwordEnv]).map(
    (role) => role.passwordEnv,
  );
  if (missing.length > 0) {
    throw new Error(`${missing.join(' and ')} not set. Run \`pnpm secrets:generate\` first.`);
  }

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  await client.connect();

  const { rows: whoami } = await client.query<{ user: string; db: string; version: string }>(
    `SELECT current_user AS user, current_database() AS db,
            current_setting('server_version') AS version`,
  );
  const owner = whoami[0]?.user;
  if (!owner) throw new Error('could not determine the connected role');
  console.log(
    `connected to ${whoami[0]?.db ?? '?'} as ${owner} (Postgres ${whoami[0]?.version ?? '?'})`,
  );

  const ownerId = ident(client, owner);

  await client.query('CREATE SCHEMA IF NOT EXISTS vault');

  for (const role of ROLES) {
    const password = process.env[role.passwordEnv] ?? '';
    const exists = await roleExists(client, role.name);

    const roleId = ident(client, role.name);

    if (exists) {
      await client.query(`ALTER ROLE ${roleId} PASSWORD ${literal(client, password)}`);
      console.log(`role ${role.name}: existed, password synced`);
    } else {
      await client.query(`CREATE ROLE ${roleId} LOGIN PASSWORD ${literal(client, password)}`);
      console.log(`role ${role.name}: created`);
    }

    await client.query(`ALTER ROLE ${roleId} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await client.query(`ALTER ROLE ${roleId} CONNECTION LIMIT ${role.connectionLimit}`);
  }

  // Nothing is granted by default.
  await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await client.query('REVOKE ALL ON SCHEMA vault FROM PUBLIC');

  // Database-level CONNECT is left alone on the default maintenance database.
  // Coolify's Postgres resource came up as postgres/postgres — its Username and
  // Initial Database fields never applied — and revoking PUBLIC's rights on the
  // maintenance database is the kind of change that surprises platform tooling
  // later. The schema-level revokes above are what the vault isolation rests
  // on; this one is only hygiene.
  const dbName = whoami[0]?.db ?? '';
  if (!['postgres', 'template0', 'template1'].includes(dbName)) {
    await client.query(`REVOKE ALL ON DATABASE ${ident(client, dbName)} FROM PUBLIC`);
  } else {
    console.log(`database ${dbName}: skipping database-level REVOKE (maintenance database)`);
  }

  // --- da_app: public only, and explicitly denied the vault -----------------
  const appStatements = [
    'GRANT USAGE ON SCHEMA public TO da_app',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO da_app',
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO da_app',
    // Explicit, so a later blanket GRANT cannot quietly open the vault.
    'REVOKE ALL ON SCHEMA vault FROM da_app',
    'REVOKE ALL ON ALL TABLES IN SCHEMA vault FROM da_app',
  ];
  for (const statement of appStatements) await client.query(statement);

  await client.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerId} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO da_app`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerId} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO da_app`,
  );
  console.log('da_app: granted public, denied vault');

  // --- da_vault: the vault, plus read-only public ---------------------------
  const vaultStatements = [
    'GRANT USAGE ON SCHEMA vault TO da_vault',
    'GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA vault TO da_vault',
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA vault TO da_vault',
    // Keys move to REVOKED/EXPIRED; they never disappear. Withholding DELETE
    // makes that a database guarantee rather than a convention.
    'REVOKE DELETE ON ALL TABLES IN SCHEMA vault FROM da_vault',
    'GRANT USAGE ON SCHEMA public TO da_vault',
    'GRANT SELECT ON ALL TABLES IN SCHEMA public TO da_vault',
  ];
  for (const statement of vaultStatements) await client.query(statement);

  await client.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerId} IN SCHEMA vault GRANT SELECT, INSERT, UPDATE ON TABLES TO da_vault`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerId} IN SCHEMA vault REVOKE DELETE ON TABLES FROM da_vault`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerId} IN SCHEMA vault GRANT USAGE, SELECT ON SEQUENCES TO da_vault`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerId} IN SCHEMA public GRANT SELECT ON TABLES TO da_vault`,
  );
  console.log('da_vault: granted vault (no DELETE) and read-only public');

  const { rows: report } = await client.query<{
    role: string;
    public_usage: boolean;
    vault_usage: boolean;
    conn_limit: number;
  }>(
    `SELECT rolname AS role,
            has_schema_privilege(rolname, 'public', 'USAGE') AS public_usage,
            has_schema_privilege(rolname, 'vault',  'USAGE') AS vault_usage,
            rolconnlimit AS conn_limit
       FROM pg_roles
      WHERE rolname IN ('da_app', 'da_vault')
      ORDER BY rolname`,
  );

  console.log('');
  console.log('role      public  vault  conn');
  for (const row of report) {
    console.log(
      `${row.role.padEnd(9)} ${String(row.public_usage).padEnd(7)} ${String(row.vault_usage).padEnd(6)} ${row.conn_limit}`,
    );
  }

  const app = report.find((row) => row.role === 'da_app');
  if (app?.vault_usage) {
    console.error('');
    console.error('da_app has USAGE on vault. That must not happen — stop and investigate.');
    process.exitCode = 1;
  }

  await client.end();

  console.log('');
  console.log('Next:  pnpm --filter @da/db run migrate:deploy');
}

void main().catch((error: unknown) => {
  // node-postgres leaves `message` empty for a refused connection, so fall back
  // to the errno code — "nothing is listening" is the useful signal.
  const err = error as { message?: string; code?: string; errno?: number };
  const reason = err.message || err.code || (err.errno ? `errno ${err.errno}` : 'unknown error');
  console.error('');
  console.error(`Failed: ${reason}`);
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    console.error('');
    console.error('DATABASE_URL_MIGRATE points somewhere nothing is listening. Either the local');
    console.error('stack is down (`pnpm infra:up`), or the URL still points at localhost while');
    console.error(
      'the database lives on Coolify. `pnpm env:check` prints the host it resolves to.',
    );
  }
  process.exitCode = 1;
});
