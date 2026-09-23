import { testDatabaseUrl } from './guard.js';

/**
 * The environment the integration suite boots the API with.
 *
 * Runs before any test file is imported, because AppModule validates the
 * environment at import time.
 *
 * Every provider credential is set to the empty string rather than deleted.
 * ConfigModule fills in from the repo's `.env`, but never over a variable that
 * already exists — so an empty value is what stops a developer's real Stripe
 * or SMTP key being picked up by a test run, and `validateEnv` then drops the
 * empty strings as unset. Stripe in particular stays unconfigured: the suite
 * hands the webhook handler events it built itself and never calls Stripe.
 */
// One owner connection for both clients; see global-setup.ts for why the role
// split is not reproduced here. Without a test database the suites skip, and
// the URL is a dead address, never whatever DATABASE_URL the shell had: the
// test files still import AppModule, and nothing they import may reach a
// database somebody actually uses.
const url = testDatabaseUrl() ?? 'postgresql://integration:skipped@127.0.0.1:1/skipped';
process.env.DATABASE_URL = url;
process.env.DATABASE_URL_VAULT = url;

const fixed: Record<string, string> = {
  NODE_ENV: 'test',
  STOREFRONT_URL: 'http://localhost:3000',
  ADMIN_URL: 'http://localhost:3001',
  REDIS_URL: 'redis://localhost:1',
  MEILI_HOST: 'http://localhost:1',
  MEILI_MASTER_KEY: 'integration',
  JWT_ACCESS_SECRET: 'integration-tests-only-4f8a1c9e2b7d6053',
  JWT_REFRESH_SECRET: 'integration-tests-only-9d2e7b1a4c8f3065',
  KEK_PROVIDER: 'local',
  KEK_LOCAL_BASE64: Buffer.alloc(32, 7).toString('base64'),
  // Writes each message to .cache/mail and sends nothing; the assertions read
  // the NotificationLog row every send leaves behind.
  MAIL_TRANSPORT: 'capture',
  MAIL_FROM_TRANSACTIONAL: 'orders@example.test',
  MAIL_FROM_MARKETING: 'news@example.test',
  STORE_TIMEZONE: 'UTC',
  FX_REFRESH: 'off',
  LOG_LEVEL: 'warn',
};
const blank = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PUBLISHABLE_KEY',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
  'SMTP_URL',
  'RESEND_API_KEY',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_PUBLIC_BASE_URL',
  'AWS_KMS_KEY_ID',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'SENTRY_DSN',
];

for (const [key, value] of Object.entries(fixed)) process.env[key] = value;
for (const key of blank) process.env[key] = '';
