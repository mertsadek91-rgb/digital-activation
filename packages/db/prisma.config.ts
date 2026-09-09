import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// One .env for the whole monorepo, at the repo root.
loadEnv({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

/**
 * Prisma 7 reads its configuration from this file rather than from the
 * `prisma` key in package.json.
 *
 * `schema` points at a folder: the model set is large enough that one file
 * would be unreadable, so it is split by domain (catalog, inventory, vault,
 * commerce, marketing, content, system) and Prisma concatenates them.
 *
 * Migrations run as the owner role (`DATABASE_URL_MIGRATE`), not as the
 * application role. The application connects as `da_app`, which has no grant
 * on the `vault` schema and therefore could not create it.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL_MIGRATE'),
  },
});
