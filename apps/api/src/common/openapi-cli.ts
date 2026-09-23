import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

/**
 * Writes the OpenAPI document to a file: `pnpm --filter @da/api openapi`.
 *
 * For the storefront and admin teams, and for CI to publish as an artefact,
 * without a database, Redis or a single secret. Two things make that possible:
 *
 *  - Nest's `preview` mode builds the module graph — every controller, route
 *    and pipe the document is read from — without instantiating a provider.
 *    Nothing connects to anything, so nothing needs to be reachable.
 *  - The environment is still validated when AppModule is imported, so any
 *    variable not already set is given an obviously fake value first. They are
 *    never used: in preview mode no code that reads them runs.
 *
 * Usage: node dist/common/openapi-cli.js [output path, default ./openapi.json]
 */
const PLACEHOLDERS: Record<string, string> = {
  NODE_ENV: 'development',
  STOREFRONT_URL: 'http://localhost:3000',
  ADMIN_URL: 'http://localhost:3001',
  DATABASE_URL: 'postgresql://openapi:openapi@localhost:1/openapi',
  DATABASE_URL_VAULT: 'postgresql://openapi:openapi@localhost:1/openapi',
  REDIS_URL: 'redis://localhost:1',
  MEILI_HOST: 'http://localhost:1',
  MEILI_MASTER_KEY: 'openapi',
  JWT_ACCESS_SECRET: 'openapi-document-only-not-a-secret-a',
  JWT_REFRESH_SECRET: 'openapi-document-only-not-a-secret-b',
  KEK_PROVIDER: 'local',
  KEK_LOCAL_BASE64: Buffer.alloc(32).toString('base64'),
  MAIL_TRANSPORT: 'capture',
  MAIL_FROM_TRANSACTIONAL: 'openapi@example.test',
  MAIL_FROM_MARKETING: 'openapi@example.test',
  FX_REFRESH: 'off',
};

async function main(): Promise<void> {
  for (const [key, value] of Object.entries(PLACEHOLDERS)) process.env[key] ??= value;

  // Imported after the placeholders: ConfigModule validates on import.
  const { AppModule } = await import('../app.module.js');
  const { buildOpenApiDocument } = await import('./openapi.js');

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    preview: true,
    logger: ['error', 'warn'],
  });
  // Must match main.ts: the document's paths carry the global prefix.
  app.setGlobalPrefix('v1', { exclude: ['health', 'health/ready'] });

  const document = buildOpenApiDocument(app);
  const out = resolve(process.argv[2] ?? 'openapi.json');
  writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await app.close();

  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${out}: ${String(Object.keys(document.paths).length)} paths, ${String(
      Object.keys(document.components?.schemas ?? {}).length,
    )} schemas.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
