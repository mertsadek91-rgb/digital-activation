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

describe('validateEnv — keys other code reads from process.env', () => {
  // ConfigModule copies only what validateEnv returns into process.env, so a
  // key missing from the schema is silently dropped from the env file (TASK-0070).
  it('keeps the API public origin and its fallback', () => {
    const env = validateEnv(
      production({
        API_PUBLIC_URL: 'https://api.example.test',
        NEXT_PUBLIC_API_URL: 'https://api.example.test',
      }),
    );
    expect(env.API_PUBLIC_URL).toBe('https://api.example.test');
    expect(env.NEXT_PUBLIC_API_URL).toBe('https://api.example.test');
  });

  it('treats a blank API public origin as unset', () => {
    expect(validateEnv(production({ API_PUBLIC_URL: '' })).API_PUBLIC_URL).toBeUndefined();
  });
});

describe('validateEnv — BUG-0020: keys read directly from process.env', () => {
  it('passes them through so a value in the env file takes effect', () => {
    const env = validateEnv(
      production({
        FX_REFRESH: 'off',
        FX_RATES_URL: 'https://rates.example.test/usd',
        NEXT_PUBLIC_SITE_URL: 'https://shop.example.test',
        TRUST_PROXY_HOPS: '2',
      }),
    );
    expect(env).toMatchObject({
      FX_REFRESH: 'off',
      FX_RATES_URL: 'https://rates.example.test/usd',
      NEXT_PUBLIC_SITE_URL: 'https://shop.example.test',
      TRUST_PROXY_HOPS: '2',
    });
  });

  it('never refuses a boot over them', () => {
    expect(() =>
      validateEnv(production({ FX_REFRESH: 'false', TRUST_PROXY_HOPS: 'x' })),
    ).not.toThrow();
  });
});

describe('validateEnv — BUG-0008: Meilisearch is optional', () => {
  // Nothing reads MEILI_* (search is in-app, DEC-0009), so boot must not need it.
  it('boots in production with neither Meilisearch key', () => {
    const env = validateEnv(production({ MEILI_HOST: undefined, MEILI_MASTER_KEY: undefined }));
    expect(env.MEILI_HOST).toBeUndefined();
    expect(env.MEILI_MASTER_KEY).toBeUndefined();
  });

  it('treats blank Meilisearch keys as unset', () => {
    expect(() => validateEnv(production({ MEILI_HOST: '', MEILI_MASTER_KEY: '' }))).not.toThrow();
  });

  it('still refuses a malformed host when one is given', () => {
    expect(() => validateEnv(production({ MEILI_HOST: 'not a url' }))).toThrow(/MEILI_HOST/);
  });
});

describe('validateEnv — MONITOR_API_KEY', () => {
  const monitor = crypto.randomBytes(32).toString('base64url');
  const internal = crypto.randomBytes(32).toString('base64url');

  it('is optional, and kept when set', () => {
    expect(validateEnv(production()).MONITOR_API_KEY).toBeUndefined();
    expect(validateEnv(production({ MONITOR_API_KEY: '' })).MONITOR_API_KEY).toBeUndefined();
    expect(validateEnv(production({ MONITOR_API_KEY: monitor })).MONITOR_API_KEY).toBe(monitor);
  });

  it('refuses a short key', () => {
    expect(() => validateEnv(production({ MONITOR_API_KEY: 'short' }))).toThrow(/MONITOR_API_KEY/);
  });

  it('refuses the same value as INTERNAL_API_KEY', () => {
    expect(() =>
      validateEnv(production({ MONITOR_API_KEY: internal, INTERNAL_API_KEY: internal })),
    ).toThrow(/must differ from INTERNAL_API_KEY/);
    expect(() =>
      validateEnv(production({ MONITOR_API_KEY: monitor, INTERNAL_API_KEY: internal })),
    ).not.toThrow();
  });
});

describe('validateEnv — AUTO_DELIVERY, the incident switch', () => {
  it('defaults to on', () => {
    expect(validateEnv(production()).AUTO_DELIVERY).toBe('on');
  });

  it('keeps off, so a value in the env file takes effect', () => {
    expect(validateEnv(production({ AUTO_DELIVERY: 'off' })).AUTO_DELIVERY).toBe('off');
  });

  it('treats a blank value as unset', () => {
    expect(validateEnv(production({ AUTO_DELIVERY: '' })).AUTO_DELIVERY).toBe('on');
  });

  it('refuses a mistyped value rather than leaving delivery on', () => {
    expect(() => validateEnv(production({ AUTO_DELIVERY: 'of' }))).toThrow(/AUTO_DELIVERY/);
  });
});

describe('validateEnv — Final Processor', () => {
  const fp = {
    FP_BASE_URL: 'https://processor.example.test/payment',
    FP_SITE_ID: 'site_test0000000000',
    FP_SECRET: 'fpsec_' + 'env-test-'.repeat(3),
  };

  it('boots without Final Processor at all', () => {
    const env = validateEnv(production());
    expect(env.FP_SECRET).toBeUndefined();
  });

  it('boots with all three values and an https SITE_URL, and keeps them for process.env', () => {
    const env = validateEnv(production({ ...fp, SITE_URL: 'https://shop.example.test' }));
    expect(env.FP_BASE_URL).toBe(fp.FP_BASE_URL);
    expect(env.FP_SITE_ID).toBe(fp.FP_SITE_ID);
    expect(env.SITE_URL).toBe('https://shop.example.test');
  });

  it('refuses half a configuration, naming the missing key', () => {
    const { FP_SECRET: _omitted, ...partial } = fp;
    expect(() =>
      validateEnv(production({ ...partial, SITE_URL: 'https://shop.example.test' })),
    ).toThrow(/FP_SECRET/);
  });

  it('requires SITE_URL once configured', () => {
    expect(() => validateEnv(production(fp))).toThrow(/SITE_URL/);
  });

  it('refuses a SITE_URL with a path or a trailing slash', () => {
    expect(() =>
      validateEnv(production({ ...fp, SITE_URL: 'https://shop.example.test/' })),
    ).toThrow(/SITE_URL/);
    expect(() =>
      validateEnv(production({ ...fp, SITE_URL: 'https://shop.example.test/ar' })),
    ).toThrow(/SITE_URL/);
  });

  it('refuses plain http in production', () => {
    expect(() => validateEnv(production({ ...fp, SITE_URL: 'http://shop.example.test' }))).toThrow(
      /SITE_URL must be https/,
    );
  });

  it('never puts the secret in an error message', () => {
    try {
      validateEnv(production({ FP_SECRET: fp.FP_SECRET }));
      throw new Error('expected a refusal');
    } catch (error) {
      expect(String(error)).not.toContain(fp.FP_SECRET);
    }
  });
});
