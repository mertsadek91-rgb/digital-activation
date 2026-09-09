/**
 * Two clients, on purpose.
 *
 * `prisma` connects as `da_app`, which has no grant on the `vault` schema, so
 * an ordinary handler cannot read an encrypted key row even if it tries.
 *
 * `vaultPrisma` connects as `da_vault` and belongs to the licence-vault module
 * alone. Keep it that way: the isolation is only worth something while this is
 * its single import site. The role split is the floor, not the whole control —
 * revealing a key still needs a fresh TOTP challenge and still writes a
 * KeyAccessLog row.
 *
 * Prisma 7 no longer reads a connection URL from the schema, so each client is
 * constructed with its own pg driver adapter. That is what makes the two-role
 * arrangement expressible at all.
 */
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';

export * from '../generated/prisma/client.js';

declare global {
  // Reused across dev hot reloads so we do not exhaust the connection pool.
  var __daPrisma: PrismaClient | undefined;
  var __daVaultPrisma: PrismaClient | undefined;
}

const isProd = process.env.NODE_ENV === 'production';

function createClient(envVar: 'DATABASE_URL' | 'DATABASE_URL_VAULT'): PrismaClient {
  const connectionString = process.env[envVar];
  if (!connectionString) {
    throw new Error(`${envVar} is not set. Copy .env.example to .env at the repo root.`);
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: isProd ? ['warn', 'error'] : ['warn', 'error'],
  });
}

export const prisma: PrismaClient = globalThis.__daPrisma ?? createClient('DATABASE_URL');

/** Do not import outside the licence-vault module. */
export const vaultPrisma: PrismaClient =
  globalThis.__daVaultPrisma ?? createClient('DATABASE_URL_VAULT');

if (!isProd) {
  globalThis.__daPrisma = prisma;
  globalThis.__daVaultPrisma = vaultPrisma;
}
