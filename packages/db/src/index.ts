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
export {
  minPublishedPrice,
  refreshProductPrice,
  type ProductPriceWriter,
} from './product-price.js';

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

/**
 * Constructed on first use, not on import.
 *
 * Importing this package must not require the environment to be loaded yet.
 * ES module imports are hoisted, so a script that calls `dotenv` before its
 * `import { prisma }` line still evaluates this module first — and eager
 * construction turned that into "DATABASE_URL is not set" from a file that had
 * just set it. Deferring also means a process that imports the package but
 * never touches the database opens no connection.
 */
function lazyClient(
  envVar: 'DATABASE_URL' | 'DATABASE_URL_VAULT',
  cacheKey: '__daPrisma' | '__daVaultPrisma',
): PrismaClient {
  let instance: PrismaClient | undefined;

  const resolve = (): PrismaClient => {
    instance ??= globalThis[cacheKey] ?? createClient(envVar);
    // Reused across dev hot reloads so we do not exhaust the connection pool.
    if (!isProd) globalThis[cacheKey] = instance;
    return instance;
  };

  return new Proxy({} as PrismaClient, {
    get(_target, property, receiver): unknown {
      const client = resolve();
      const value: unknown = Reflect.get(client, property, receiver);
      // Methods must keep the real client as their receiver, or `this` would be
      // the empty proxy target.
      return typeof value === 'function'
        ? (value as (...args: never[]) => unknown).bind(client)
        : value;
    },
    has(_target, property) {
      return Reflect.has(resolve(), property);
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(resolve());
    },
  });
}

export const prisma: PrismaClient = lazyClient('DATABASE_URL', '__daPrisma');

/** Do not import outside the licence-vault module. */
export const vaultPrisma: PrismaClient = lazyClient('DATABASE_URL_VAULT', '__daVaultPrisma');
