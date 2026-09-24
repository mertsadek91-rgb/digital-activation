import path from 'node:path';

import { KekService } from './kek.js';
import { VaultPrismaService } from './vault-prisma.service.js';

/**
 * Moves every licence wrapped by the local KEK under AWS KMS, once, at the
 * switch to `KEK_PROVIDER=aws-kms`.
 *
 *   pnpm --filter @da/api vault:rewrap            report only
 *   pnpm --filter @da/api vault:rewrap --apply    rewrap and write
 *
 * Why it has to exist: under KMS the API sends every wrapped data key to KMS
 * to open, and a key wrapped locally is not something KMS ever issued. Without
 * this, every licence imported before the switch — delivered ones included,
 * which customers reveal again from their account — fails to open the moment
 * production starts.
 *
 * Only the wrapped data key changes. The licence ciphertext, iv and tag are
 * untouched, and the plaintext licence is never decrypted: the data key is
 * opened with the local KEK, sealed again by KMS, and zeroed.
 *
 * A row is treated as local when the local KEK opens it — AES-GCM refuses
 * anything it did not seal, so a KMS blob fails that test rather than being
 * misread. Each new wrap is opened back through KMS and compared before it is
 * written, and the write is conditional on the row still holding the blob that
 * was read. Running it twice rewraps nothing the second time.
 *
 * Needs KEK_LOCAL_BASE64, AWS_KMS_KEY_ID, AWS_REGION, the AWS credentials and
 * DATABASE_URL_VAULT, whatever KEK_PROVIDER currently says. New rows are
 * stamped with VAULT_KEY_VERSION: set it to 2 first, so a KMS row can be told
 * from a local one by its version as well.
 */
// The repo-root .env when there is one (a laptop); on a host the variables are
// already in the environment. Either way a variable already set wins.
try {
  process.loadEnvFile(path.join(__dirname, '..', '..', '..', '..', '.env'));
} catch {
  // No file: the environment is all there is.
}

const REQUIRED = [
  'KEK_LOCAL_BASE64',
  'AWS_KMS_KEY_ID',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'DATABASE_URL_VAULT',
] as const;

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
    select: { id: true, wrappedDek: true, kekVersion: true },
    orderBy: { createdAt: 'asc' },
  });

  let local = 0;
  let already = 0;
  let rewrapped = 0;
  let failed = 0;

  for (const row of rows) {
    let dek: Buffer;
    try {
      dek = await kek.unwrap(row.wrappedDek, row.kekVersion, 'local');
    } catch {
      // Not sealed by this local KEK: KMS already, or a KEK that is gone.
      already += 1;
      continue;
    }
    local += 1;
    if (!apply) {
      dek.fill(0);
      continue;
    }

    try {
      const { wrapped, version } = await kek.wrap(dek, 'aws-kms');
      const check = await kek.unwrap(wrapped, version, 'aws-kms');
      const same = check.equals(dek);
      check.fill(0);
      if (!same) throw new Error('KMS returned a different data key');

      const { count } = await vault.client.licenseKey.updateMany({
        where: { id: row.id, wrappedDek: { equals: row.wrappedDek } },
        data: { wrappedDek: Uint8Array.from(wrapped), kekVersion: version },
      });
      if (count !== 1) throw new Error('the row changed while it was being rewrapped');
      rewrapped += 1;
    } catch (error) {
      failed += 1;
      console.error(`${row.id}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      dek.fill(0);
    }
  }

  await vault.client.$disconnect();

  // A command-line report: stdout is its output.
  /* eslint-disable no-console */
  console.log(`${String(rows.length)} licence rows`);
  console.log(`  wrapped by the local KEK:  ${String(local)}`);
  console.log(`  not opened by it (KMS):    ${String(already)}`);
  if (apply) {
    console.log(`  rewrapped under KMS:       ${String(rewrapped)}`);
    console.log(`  failed:                    ${String(failed)}`);
  } else if (local > 0) {
    console.log('Report only. Run again with --apply to rewrap them.');
  }
  /* eslint-enable no-console */
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
