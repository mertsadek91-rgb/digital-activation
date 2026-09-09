import { z } from 'zod';

/**
 * Environment validation. The process refuses to start on a bad or missing
 * value rather than failing later at the worst moment — a licence key not
 * delivered because a mail credential was blank is a refund, not a log line.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  STOREFRONT_URL: z.string().url(),
  ADMIN_URL: z.string().url(),

  // Two roles, two URLs. The vault URL is read only by the licence-vault module.
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_VAULT: z.string().min(1),

  REDIS_URL: z.string().min(1),
  MEILI_HOST: z.string().url(),
  MEILI_MASTER_KEY: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  TOTP_ISSUER: z.string().default('Digital Activation'),

  KEK_PROVIDER: z.enum(['local', 'aws-kms', 'vault']).default('local'),
  KEK_LOCAL_BASE64: z.string().optional(),
  AWS_KMS_KEY_ID: z.string().optional(),
  AWS_REGION: z.string().optional(),
  VAULT_KEY_VERSION: z.coerce.number().int().min(1).default(1),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_MODE: z.enum(['sandbox', 'live']).default('sandbox'),

  MAIL_TRANSPORT: z.enum(['smtp', 'resend', 'ses']).default('smtp'),
  SMTP_URL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM_TRANSACTIONAL: z.string().email(),
  MAIL_FROM_MARKETING: z.string().email(),

  BASE_CURRENCY: z.string().length(3).default('USD'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SENTRY_DSN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;

  // A local KEK is a development convenience and must never reach production:
  // it would put the key that unwraps every licence in an environment variable.
  if (env.NODE_ENV === 'production') {
    if (env.KEK_PROVIDER === 'local') {
      throw new Error('KEK_PROVIDER=local is not allowed in production. Use aws-kms or vault.');
    }
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
      throw new Error('Stripe credentials are required in production.');
    }
  }

  if (env.KEK_PROVIDER === 'local' && !env.KEK_LOCAL_BASE64) {
    throw new Error('KEK_PROVIDER=local requires KEK_LOCAL_BASE64 (32 raw bytes, base64).');
  }
  if (env.KEK_PROVIDER === 'aws-kms' && !env.AWS_KMS_KEY_ID) {
    throw new Error('KEK_PROVIDER=aws-kms requires AWS_KMS_KEY_ID.');
  }

  return env;
}
