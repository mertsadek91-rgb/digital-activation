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
 * Builds DDL server-side with format(%L / %I) and then executes it.
 *
 * CREATE ROLE takes no bind parameters for a password, so the value has to be
 * interpolated. Having Postgres do the quoting is the difference between that
 * being safe and being an injection point.
 */
async function execFormatted(client: Client, template: string, args: unknown[]): Promise<void> {
  const placeholders = args.map((_, i) => `$${i + 2}`).join(', ');
  const { rows } = await client.query<{ ddl: string }>(
    `SELECT format($1${placeholders ? `, ${placeholders}` : ''}) AS ddl`,
    [template, ...args],
  );
  const ddl = rows[0]?.ddl;
  if (!ddl) throw new Error(`format() returned nothing for: ${template}`);
  await client.query(ddl);
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

  await client.query('CREATE SCHEMA IF NOT EXISTS vault');

  for (const role of ROLES) {
    const password = process.env[role.passwordEnv] ?? '';
    const exists = await roleExists(client, role.name);

    if (exists) {
      await execFormatted(client, 'ALTER ROLE %I PASSWORD %L', [role.name, password]);
      console.log(`role ${role.name}: existed, password synced`);
    } else {
      await execFormatted(client, 'CREATE ROLE %I LOGIN PASSWORD %L', [role.name, password]);
      console.log(`role ${role.name}: created`);
    }

    await execFormatted(client, 'ALTER ROLE %I NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS', [
      role.name,
    ]);
    await execFormatted(client, 'ALTER ROLE %I CONNECTION LIMIT %s', [
      role.name,
      role.connectionLimit,
    ]);
  }

  // Nothing is granted by default.
  await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await client.query('REVOKE ALL ON SCHEMA vault FROM PUBLIC');
  await execFormatted(client, 'REVOKE ALL ON DATABASE %I FROM PUBLIC', [
    whoami[0]?.db ?? 'postgres',
  ]);

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

  await execFormatted(
    client,
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO da_app',
    [owner],
  );
  await execFormatted(
    client,
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO da_app',
    [owner],
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

  await execFormatted(
    client,
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA vault GRANT SELECT, INSERT, UPDATE ON TABLES TO da_vault',
    [owner],
  );
  await execFormatted(
    client,
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA vault REVOKE DELETE ON TABLES FROM da_vault',
    [owner],
  );
  await execFormatted(
    client,
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA vault GRANT USAGE, SELECT ON SEQUENCES TO da_vault',
    [owner],
  );
  await execFormatted(
    client,
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO da_vault',
    [owner],
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
