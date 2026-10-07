import path from 'node:path';

import { KekService, fingerprint, open } from './kek.js';
import { VaultPrismaService } from './vault-prisma.service.js';

/**
 * Recomputes every licence fingerprint under the current
 * VAULT_FINGERPRINT_SALT, once, when the salt is first set or changed
 * (TASK-0011).
 *
 *   pnpm --filter @da/api vault:refingerprint            report only
 *   pnpm --filter @da/api vault:refingerprint --apply    recompute and write
 *
 * Why it has to exist: the fingerprint is how an import or a manual delivery
 * spots a licence already in the vault. Rows fingerprinted under another salt
 * no longer match, so a key sold once could be stocked and sold again. Only
 * the fingerprint column changes; the sealed licence is opened in memory to
 * hash it, never printed, and its buffer is dropped at once.
 *
 * Two rows that turn out to hold the same licence are reported by id and left
 * untouched — the unique index would refuse the second write, and which one
 * to keep is a person's call. Running it twice changes nothing the second
 * time.
 *
 * Needs VAULT_FINGERPRINT_SALT, DATABASE_URL_VAULT and the KEK variables the
 * API uses (KEK_PROVIDER and its key).
 */
// The repo-root .env when there is one (a laptop); on a host the variables are
// already in the environment. Either way a variable already set wins.
try {
  process.loadEnvFile(path.join(__dirname, '..', '..', '..', '..', '.env'));
} catch {
  // No file: the environment is all there is.
}

const REQUIRED = ['VAULT_FINGERPRINT_SALT', 'DATABASE_URL_VAULT'] as const;

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Not set: ${missing.join(', ')}. Nothing was read.`);
    process.exitCode = 1;
    return;
  }

  const kek = new KekService();
  const vault = new VaultPrismaService();
  const rows = await vault.client.licenseKey.findMany({
    select: {
      id: true,
      ciphertext: true,
      iv: true,
      authTag: true,
      wrappedDek: true,
      kekVersion: true,
      fingerprint: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  // Every row's new fingerprint first, so duplicates are known before any write.
  const next = new Map<string, string>();
  const owners = new Map<string, string[]>();
  let unreadable = 0;
  for (const row of rows) {
    try {
      const print = fingerprint(await open(row, kek));
      next.set(row.id, print);
      owners.set(print, [...(owners.get(print) ?? []), row.id]);
    } catch (error) {
      unreadable += 1;
      console.error(`${row.id}: ${error instanceof Error ? error.message : 'could not open'}`);
    }
  }

  const duplicates = [...owners.values()].filter((ids) => ids.length > 1);
  const blocked = new Set(duplicates.flat());
  const stale = rows.filter((row) => {
    const print = next.get(row.id);
    return print !== undefined && print !== row.fingerprint && !blocked.has(row.id);
  });

  let written = 0;
  let failed = 0;
  if (apply) {
    for (const row of stale) {
      try {
        const { count } = await vault.client.licenseKey.updateMany({
          where: { id: row.id, fingerprint: row.fingerprint },
          data: { fingerprint: next.get(row.id) ?? row.fingerprint },
        });
        if (count !== 1) throw new Error('the row changed while it was being updated');
        written += 1;
      } catch (error) {
        failed += 1;
        console.error(`${row.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await vault.client.$disconnect();

  // A command-line report: stdout is its output. Ids only, never a licence.
  /* eslint-disable no-console */
  console.log(`${String(rows.length)} licence rows`);
  const current = rows.filter((row) => next.get(row.id) === row.fingerprint).length;
  console.log(`  already under this salt:   ${String(current)}`);
  console.log(`  to recompute:              ${String(stale.length)}`);
  console.log(`  could not be opened:       ${String(unreadable)}`);
  if (duplicates.length > 0) {
    console.log(`  same licence in two rows:  ${String(duplicates.length)} (left as they are)`);
    for (const ids of duplicates) console.log(`    ${ids.join(', ')}`);
  }
  if (apply) {
    console.log(`  recomputed:                ${String(written)}`);
    console.log(`  failed:                    ${String(failed)}`);
  } else if (stale.length > 0) {
    console.log('Report only. Run again with --apply to write them.');
  }
  /* eslint-enable no-console */
  if (failed > 0 || unreadable > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
