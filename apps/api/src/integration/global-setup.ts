import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { testDatabaseUrl } from './guard.js';

/**
 * Brings the test database up to the committed migrations, once per run.
 *
 * `migrate deploy` rather than `db push`: the suite should run against the
 * schema production gets, which is the migration history, not whatever the
 * schema files say today. A no-op when CI has already applied them.
 *
 * The role script (prisma/init/01-roles.sql) is deliberately not applied. It
 * creates `da_app` and `da_vault` with fixed passwords and revokes the vault
 * schema from the application role; the suite instead connects as the owner
 * for both clients. What is under test is checkout, payment and fulfilment,
 * not the grants — and the grants are a property of the database the roles
 * script is run against, which a CI container is not.
 */
export default function setup(): void {
  const url = testDatabaseUrl();
  if (!url) return;

  const dbPackage = path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'db');
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['prisma', 'migrate', 'deploy'], {
    cwd: dbPackage,
    env: { ...process.env, DATABASE_URL_MIGRATE: url },
    stdio: 'inherit',
    // npx.cmd is a batch file, which Node only runs through a shell.
    shell: process.platform === 'win32',
  });
}
