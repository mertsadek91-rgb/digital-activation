/**
 * Database doctor.
 *
 * Run this after pointing .env at a real database — Coolify, RDS, Neon, or the
 * local docker-compose. It does not trust the setup, it tests it:
 *
 *   - all three connection strings actually connect
 *   - the server version and encoding are what the schema expects
 *   - migrations have been applied and none failed
 *   - the `vault` schema exists
 *   - **da_app is genuinely denied the vault** — the single assertion the whole
 *     licence-key security design rests on. A misconfigured GRANT here silently
 *     removes the protection while everything else keeps working, so it is
 *     checked rather than assumed.
 *   - da_vault can read the vault but cannot DELETE from it
 *
 * Exit code is non-zero if any assertion fails, so it can gate a deploy.
 *
 *   pnpm db:doctor
 */
import path from 'node:path';

import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

type Status = 'pass' | 'fail' | 'warn' | 'skip';

interface Check {
  name: string;
  status: Status;
  detail: string;
}

const checks: Check[] = [];

function record(name: string, status: Status, detail: string): void {
  checks.push({ name, status, detail });
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '<unparseable connection string>';
  }
}

async function connect(label: string, url: string | undefined): Promise<Client | null> {
  if (!url) {
    record(`${label}: connects`, 'fail', 'environment variable is not set');
    return null;
  }

  // A Coolify-generated password routinely contains characters that are not
  // legal in a URL. If it was pasted in raw, this is where it shows up, and the
  // fix is percent-encoding rather than a new password.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    record(
      `${label}: connects`,
      'fail',
      'connection string will not parse as a URL — percent-encode the password (@ : / ? # [ ] and space all need escaping)',
    );
    return null;
  }

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    const { rows } = await client.query<{ user: string; db: string }>(
      'SELECT current_user AS user, current_database() AS db',
    );
    const row = rows[0];
    record(
      `${label}: connects`,
      'pass',
      `${parsed.hostname}:${parsed.port || 5432} as ${row?.user ?? '?'} on ${row?.db ?? '?'}`,
    );
    return client;
  } catch (error) {
    // node-postgres leaves `message` empty for a refused connection, so fall
    // back to the errno code — "nothing is listening" is the useful signal.
    const err = error as { message?: string; code?: string; errno?: number };
    const reason = err.message || err.code || (err.errno ? `errno ${err.errno}` : 'unknown error');
    record(`${label}: connects`, 'fail', `${redactUrl(url)} — ${reason}`);
    return null;
  }
}

/** Does this connection get a permission error touching the vault? */
async function isDeniedVault(client: Client): Promise<{ denied: boolean; detail: string }> {
  try {
    await client.query('SELECT 1 FROM vault."LicenseKey" LIMIT 1');
    return { denied: false, detail: 'the query SUCCEEDED — this role can read encrypted keys' };
  } catch (error) {
    const code = (error as { code?: string }).code;
    // 42501 insufficient_privilege, 3F000 invalid_schema_name (no USAGE)
    if (code === '42501' || code === '3F000') {
      return { denied: true, detail: `permission denied (SQLSTATE ${code})` };
    }
    return {
      denied: false,
      detail: `unexpected error ${code ?? '?'}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

async function main(): Promise<void> {
  const migrate = await connect('DATABASE_URL_MIGRATE', process.env.DATABASE_URL_MIGRATE);
  const app = await connect('DATABASE_URL', process.env.DATABASE_URL);
  const vault = await connect('DATABASE_URL_VAULT', process.env.DATABASE_URL_VAULT);

  if (migrate) {
    const { rows } = await migrate.query<{ version: string; num: string; encoding: string }>(
      `SELECT version() AS version,
              current_setting('server_version_num') AS num,
              pg_encoding_to_char(encoding) AS encoding
         FROM pg_database WHERE datname = current_database()`,
    );
    const row = rows[0];
    const major = Number(row?.num ?? 0);
    record(
      'server version >= 16',
      major >= 160000 ? 'pass' : 'fail',
      row?.version.split(' ').slice(0, 2).join(' ') ?? 'unknown',
    );
    record(
      'encoding is UTF8',
      row?.encoding === 'UTF8' ? 'pass' : 'fail',
      `${row?.encoding ?? 'unknown'} — Arabic content requires UTF8`,
    );

    const schemas = await migrate.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace WHERE nspname IN ('public', 'vault')`,
    );
    const names = schemas.rows.map((r) => r.nspname);
    record(
      'both schemas exist',
      names.includes('public') && names.includes('vault') ? 'pass' : 'fail',
      `found: ${names.join(', ') || 'none'}`,
    );

    try {
      const migrations = await migrate.query<{
        total: string;
        failed: string;
        latest: string | null;
      }>(
        `SELECT count(*)::text AS total,
                count(*) FILTER (WHERE finished_at IS NULL)::text AS failed,
                max(migration_name) AS latest
           FROM "_prisma_migrations"`,
      );
      const m = migrations.rows[0];
      const failed = Number(m?.failed ?? 0);
      record(
        'migrations applied',
        failed > 0 ? 'fail' : Number(m?.total ?? 0) > 0 ? 'pass' : 'warn',
        failed > 0
          ? `${failed} migration(s) never finished — resolve before deploying`
          : `${m?.total ?? 0} applied, latest ${m?.latest ?? 'none'}`,
      );

      // Prisma's own bookkeeping table is not part of the model.
      const tables = await migrate.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM information_schema.tables
          WHERE table_schema IN ('public','vault')
            AND table_type = 'BASE TABLE'
            AND table_name <> '_prisma_migrations'`,
      );
      const n = Number(tables.rows[0]?.n ?? 0);
      record(
        'model tables',
        n === 64 ? 'pass' : 'warn',
        `${n} of 64 — ${n === 64 ? 'complete' : 'the schema and the database disagree'}`,
      );
    } catch {
      record(
        'migrations applied',
        'fail',
        '_prisma_migrations is missing — run `pnpm --filter @da/db migrate:deploy`',
      );
    }
  }

  // --- the assertion that matters -------------------------------------------
  if (app) {
    const result = await isDeniedVault(app);
    record(
      'VAULT ISOLATION: da_app is denied vault.LicenseKey',
      result.denied ? 'pass' : 'fail',
      result.detail,
    );

    const { rows } = await app.query<{ user: string }>('SELECT current_user AS user');
    const user = rows[0]?.user;
    record(
      'app role is not the owner',
      user && user !== 'postgres' && !user.endsWith('_owner') ? 'pass' : 'warn',
      `connected as ${user ?? '?'} — running the API as the database owner defeats the role split`,
    );
  }

  if (vault) {
    const result = await isDeniedVault(vault);
    record(
      'vault role can read the vault',
      result.denied ? 'fail' : 'pass',
      result.denied ? result.detail : 'select succeeded',
    );

    try {
      await vault.query('BEGIN');
      await vault.query('DELETE FROM vault."LicenseKey" WHERE false');
      await vault.query('ROLLBACK');
      record(
        'vault role cannot DELETE keys',
        'fail',
        'DELETE was permitted — keys must move to REVOKED/EXPIRED, never disappear',
      );
    } catch (error) {
      await vault.query('ROLLBACK').catch(() => undefined);
      const code = (error as { code?: string }).code;
      record(
        'vault role cannot DELETE keys',
        code === '42501' ? 'pass' : 'warn',
        code === '42501' ? 'DELETE denied' : `unexpected SQLSTATE ${code ?? '?'}`,
      );
    }
  }

  for (const client of [migrate, app, vault]) {
    if (client) await client.end();
  }

  // --- report ---------------------------------------------------------------
  const icon: Record<Status, string> = {
    pass: ' ok  ',
    fail: 'FAIL ',
    warn: 'warn ',
    skip: ' --  ',
  };
  const width = Math.max(...checks.map((c) => c.name.length));

  console.log('');
  for (const check of checks) {
    console.log(`[${icon[check.status]}] ${check.name.padEnd(width)}  ${check.detail}`);
  }

  const failed = checks.filter((c) => c.status === 'fail');
  const warned = checks.filter((c) => c.status === 'warn');
  console.log('');
  console.log(
    `${checks.length - failed.length - warned.length} passed, ${warned.length} warning(s), ${failed.length} failed`,
  );

  if (failed.length > 0) {
    console.log('');
    console.error('Database is not ready. Fix the failures above before deploying.');
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
