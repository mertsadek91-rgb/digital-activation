/**
 * Deactivates a staff account and revokes every one of its sessions.
 *
 *   pnpm --filter @da/db staff:deactivate --email them@example.com --by you@example.com
 *   pnpm --filter @da/db staff:deactivate --email them@example.com --by you@example.com --apply
 *
 * Dry run by default, like the importers: it says what it would do and writes
 * nothing until `--apply`. `--by` names the OWNER running it, who is recorded
 * as the actor on the `staff.deactivated` audit entry.
 *
 * Access ends on the account's next request either way (StaffGuard checks the
 * account and the session every time). Revoking the sessions is what stops a
 * later reactivation — `pnpm db:staff` for the same email — from reviving
 * them. Reactivating issues nothing: the person signs in again from scratch.
 */
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

import { prisma } from '../src/index.js';

import { deactivateStaff, planDeactivation } from './staff-lifecycle.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const email = arg('email');
  const by = arg('by');
  const apply = process.argv.includes('--apply');

  if (!email || !by || email.startsWith('--') || by.startsWith('--')) {
    console.error(
      'Usage: pnpm --filter @da/db staff:deactivate --email them@example.com --by owner@example.com [--apply]',
    );
    process.exitCode = 1;
    return;
  }

  const plan = await planDeactivation(prisma, { email, by });

  console.log('');
  console.log(`  account   ${plan.target.email} (${plan.target.role})`);
  console.log(`  active    ${plan.target.isActive ? 'yes' : 'no, already'}`);
  console.log(`  sessions  ${String(plan.liveSessions)} not yet revoked`);
  console.log(`  actor     ${plan.actor.email}`);
  console.log('');

  if (plan.noop) {
    console.log('Already inactive with no live sessions. Nothing to do.');
    return;
  }
  if (!apply) {
    console.log('Dry run. Nothing was written. Re-run with --apply to deactivate.');
    return;
  }

  const result = await deactivateStaff(prisma, { email, by });
  console.log(
    `Deactivated. ${String(result.sessionsRevoked)} session(s) revoked; audit entry staff.deactivated written.`,
  );
}

void main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
