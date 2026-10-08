import path from 'node:path';

import { prisma } from '@da/db';

import { parseExpected, purgeTestData, type PurgeReport } from './purge-test-data.js';
import { VaultPrismaService } from './vault-prisma.service.js';

/**
 * Clears staging's test data before launch: every order, customer and the
 * reviews on them; every licence key revoked (owner decision 2026-10-08).
 * See purge-test-data.ts for what goes and in what order.
 *
 *   pnpm --filter @da/api data:purge-test
 *       report only: what would go, as counts
 *   pnpm --filter @da/api data:purge-test --apply \
 *       --expect-orders N --expect-customers N --expect-keys N
 *       writes, only if the database still holds exactly the reported counts
 *
 * Prints counts and variant ids only — never a licence, an email or a name.
 * Needs DATABASE_URL and DATABASE_URL_VAULT, as the API does.
 */
// The repo-root .env when there is one (a laptop); on a host the variables are
// already in the environment. Either way a variable already set wins.
try {
  process.loadEnvFile(path.join(__dirname, '..', '..', '..', '..', '.env'));
} catch {
  // No file: the environment is all there is.
}

const REQUIRED = ['DATABASE_URL', 'DATABASE_URL_VAULT'] as const;

/* eslint-disable no-console -- a command-line report: stdout is its output */
function print(report: PurgeReport): void {
  console.log(report.applied ? 'Removed:' : 'Would remove:');
  console.log(`  orders:              ${String(report.orders)}`);
  console.log(`    lines:             ${String(report.orderLines)}`);
  console.log(`    payments:          ${String(report.payments)}`);
  console.log(`    refunds:           ${String(report.refunds)}`);
  console.log(`    reviews on them:   ${String(report.reviews)}`);
  console.log(`  customers:           ${String(report.customers)}`);
  console.log(
    `  licence keys:        ${String(report.keys)} (${report.applied ? 'revoked' : 'to revoke'}; the vault keeps the rows)`,
  );
  const stock = Object.entries(report.stockTaken);
  if (stock.length > 0) {
    console.log('  stock taken off:');
    for (const [variantId, taken] of stock) console.log(`    ${variantId}: -${String(taken)}`);
  }
  if (!report.applied) {
    console.log('');
    console.log('Report only. To write, run again with:');
    console.log(
      `  --apply --expect-orders ${String(report.orders)} --expect-customers ${String(report.customers)} --expect-keys ${String(report.keys)}`,
    );
  }
}

async function main(): Promise<void> {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Not set: ${missing.join(', ')}. Nothing was read.`);
    process.exitCode = 1;
    return;
  }

  const apply = process.argv.includes('--apply');
  const expected = parseExpected(process.argv);
  const vault = new VaultPrismaService();
  try {
    print(await purgeTestData({ app: prisma, vault: vault.client, apply, expected }));
  } finally {
    await Promise.all([prisma.$disconnect(), vault.client.$disconnect()]);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'failed');
  process.exitCode = 1;
});
/* eslint-enable no-console */
