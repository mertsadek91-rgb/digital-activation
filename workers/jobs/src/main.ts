import path from 'node:path';

import { config as loadEnv } from 'dotenv';
import { Redis } from 'ioredis';
import pino from 'pino';

import { QUEUES } from './queues.js';

loadEnv({
  path: path.join(import.meta.dirname, '..', '..', '..', '.env'),
  quiet: true,
});

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // Belt and braces: nothing that could carry a key or a credential is ever
  // logged, even if a payload changes shape later.
  redact: {
    paths: [
      '*.licenseKey',
      '*.licenseCode',
      '*.ciphertext',
      '*.password',
      '*.passwordHash',
      '*.totpSecret',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[redacted]',
  },
});

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is not set.');

  // BullMQ requires maxRetriesPerRequest: null on its connection.
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  await connection.ping();

  logger.info(
    { queues: Object.values(QUEUES) },
    'worker connected; processors are added as Release 1 and 2 land',
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await connection.quit();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main().catch((error: unknown) => {
  logger.error({ err: error }, 'worker failed to start');
  process.exit(1);
});
