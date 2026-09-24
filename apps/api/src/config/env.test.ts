import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { validateEnv } from './env.js';

/**
 * The production gate on payment keys: a store may open with no card payments
 * (bank transfer only), but never with half a Stripe configuration.
 */
function production(overrides: Record<string, string | undefined> = {}): Record<string, unknown> {
  return {
    NODE_ENV: 'production',
    STOREFRONT_URL: 'https://shop.example.test',
    ADMIN_URL: 'https://admin.example.test',
    DATABASE_URL: 'postgresql://app@localhost/db',
    DATABASE_URL_VAULT: 'postgresql://vault@localhost/db',
    REDIS_URL: 'redis://localhost:6379',
    MEILI_HOST: 'http://localhost:7700',
    MEILI_MASTER_KEY: 'test',
    JWT_ACCESS_SECRET: crypto.randomBytes(48).toString('base64url'),
    JWT_REFRESH_SECRET: crypto.randomBytes(48).toString('base64url'),
    KEK_PROVIDER: 'aws-kms',
    AWS_KMS_KEY_ID: 'arn:aws:kms:us-east-2:000000000000:key/test',
    AWS_REGION: 'us-east-2',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    S3_ENDPOINT: 'https://r2.example.test',
    S3_BUCKET: 'media',
    S3_ACCESS_KEY_ID: 'test',
    S3_SECRET_ACCESS_KEY: 'test',
    S3_PUBLIC_BASE_URL: 'https://cdn.example.test',
    MAIL_TRANSPORT: 'smtp',
    SMTP_URL: 'smtp://localhost:25',
    MAIL_FROM_TRANSACTIONAL: 'orders@example.test',
    MAIL_FROM_MARKETING: 'news@example.test',
    ...overrides,
  };
}

describe('validateEnv — Stripe in production', () => {
  it('boots with no Stripe key at all (bank transfer only)', () => {
    expect(() => validateEnv(production())).not.toThrow();
  });

  it('boots with all three Stripe keys', () => {
    const env = production({
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_x',
    });
    expect(() => validateEnv(env)).not.toThrow();
  });

  it('refuses a secret key without the webhook secret', () => {
    const env = production({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x' });
    expect(() => validateEnv(env)).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it('refuses a publishable key alone', () => {
    const env = production({ STRIPE_PUBLISHABLE_KEY: 'pk_test_x' });
    expect(() => validateEnv(env)).toThrow(/STRIPE_SECRET_KEY[\s\S]*STRIPE_WEBHOOK_SECRET/);
  });
});
