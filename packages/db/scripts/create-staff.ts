/**
 * Creates or updates a staff account.
 *
 *   pnpm db:staff -- --email you@example.com --name "Your Name" --role OWNER
 *
 * The password is generated, printed once, and never stored in the clear. It is
 * printed because there is no other way to hand a first credential over — and
 * because it has been printed it is treated as an enrolment token, not a
 * password: `mustChangePassword` is set, and the API refuses every route but
 * "change my password" until the owner has set one. TOTP enrolment stands in
 * front of that too, so the printed string alone is not a working credential.
 *
 * Re-running for the same email resets the password and clears the TOTP
 * enrolment, which is also the recovery path for a lost authenticator.
 */
import crypto from 'node:crypto';
import path from 'node:path';

import argon2 from 'argon2';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

import { prisma, StaffRole } from '../src/index.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const email = arg('email')?.trim().toLowerCase();
  const name = arg('name')?.trim();
  const roleInput = (arg('role') ?? 'OWNER').toUpperCase();

  if (!email || !name) {
    console.error(
      'Usage: pnpm db:staff -- --email you@example.com --name "Your Name" [--role OWNER]',
    );
    process.exitCode = 1;
    return;
  }

  if (!Object.values(StaffRole).includes(roleInput as StaffRole)) {
    console.error(`Unknown role "${roleInput}". One of: ${Object.values(StaffRole).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const role = roleInput as StaffRole;

  // base64url, so it survives being pasted anywhere without escaping.
  const password = crypto.randomBytes(18).toString('base64url');
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const existing = await prisma.staffUser.findUnique({ where: { email } });

  await prisma.staffUser.upsert({
    where: { email },
    update: {
      name,
      role,
      passwordHash,
      isActive: true,
      // Printed below, so it is an enrolment token rather than a password. The
      // API issues a session with it and refuses every route except changing
      // it, until the owner sets one of their own.
      mustChangePassword: true,
      passwordChangedAt: null,
      // Clearing these is the recovery path for a lost authenticator: the next
      // login walks through enrolment again.
      totpSecret: null,
      totpEnabledAt: null,
    },
    create: { email, name, role, passwordHash, isActive: true, mustChangePassword: true },
  });

  console.log('');
  console.log(existing ? 'Updated staff account.' : 'Created staff account.');
  console.log(`  email    ${email}`);
  console.log(`  role     ${role}`);
  console.log(`  password ${password}`);
  console.log('');
  console.log('Sign in at the admin. Two things happen before the panel opens:');
  console.log('  1. TOTP enrolment — scan the QR with an authenticator app.');
  console.log('  2. Set your own password. This one has been on a screen, so the');
  console.log('     API refuses every route until it is replaced.');
  console.log('Clear this from your scrollback once you are through.');
}

void main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
