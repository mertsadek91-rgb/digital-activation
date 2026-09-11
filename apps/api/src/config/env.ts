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
  PREVIEW_TOKEN: z.string().optional(),

  KEK_PROVIDER: z.enum(['local', 'aws-kms']).default('local'),
  KEK_LOCAL_BASE64: z.string().optional(),
  AWS_KMS_KEY_ID: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  VAULT_KEY_VERSION: z.coerce.number().int().min(1).default(1),

  // Cloudflare R2, through the S3 API.
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_PUBLIC_BASE_URL: z.string().url().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_MODE: z.enum(['sandbox', 'live']).default('sandbox'),

  /**
   * `ses` is gone rather than listed: an option the code does not implement is
   * worse than no option, because it boots and then silently sends nothing.
   * `capture` writes the rendered message to .cache/mail and sends nothing,
   * which is a development convenience and refused in production below.
   */
  MAIL_TRANSPORT: z.enum(['smtp', 'resend', 'capture']).default('smtp'),
  SMTP_URL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM_TRANSACTIONAL: z.string().email(),
  /** Where customers are told to write. Falls back to the From address. */
  SUPPORT_EMAIL: z.string().email().optional(),
  MAIL_FROM_MARKETING: z.string().email(),

  BASE_CURRENCY: z.string().length(3).default('USD'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SENTRY_DSN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  // An unset variable in a .env file is written `KEY=`, which dotenv hands over
  // as an empty string — not undefined. `.optional()` only admits undefined, so
  // without this every blank optional URL fails validation as a malformed one.
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value.trim() === '') continue;
    cleaned[key] = value;
  }

  const parsed = envSchema.safeParse(cleaned);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;

  const missing: string[] = [];

  // A local KEK is a development convenience and must never reach production:
  // it would put the one key that unwraps every licence into an environment
  // variable, on the same host as the ciphertext.
  if (env.NODE_ENV === 'production') {
    if (env.KEK_PROVIDER !== 'aws-kms') {
      throw new Error(
        `KEK_PROVIDER=${env.KEK_PROVIDER} is not allowed in production. Use aws-kms — the KEK must not be recoverable from a compromised host.`,
      );
    }
    if (env.MAIL_TRANSPORT === 'capture') {
      throw new Error(
        'MAIL_TRANSPORT=capture is not allowed in production. It writes message bodies to disk, and one of those bodies is a customer licence key.',
      );
    }
    if (env.MAIL_TRANSPORT === 'resend' && !env.RESEND_API_KEY) {
      missing.push('RESEND_API_KEY (required by MAIL_TRANSPORT=resend)');
    }
    if (env.MAIL_TRANSPORT === 'smtp' && !env.SMTP_URL) {
      missing.push('SMTP_URL (required by MAIL_TRANSPORT=smtp)');
    }
    if (!env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
    if (!env.STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET');
    // Media lives in R2; without it, uploads would silently fall back to a
    // container filesystem that vanishes on the next deploy.
    if (!env.S3_ENDPOINT) missing.push('S3_ENDPOINT');
    if (!env.S3_BUCKET) missing.push('S3_BUCKET');
    if (!env.S3_ACCESS_KEY_ID) missing.push('S3_ACCESS_KEY_ID');
    if (!env.S3_SECRET_ACCESS_KEY) missing.push('S3_SECRET_ACCESS_KEY');
    if (!env.S3_PUBLIC_BASE_URL) missing.push('S3_PUBLIC_BASE_URL');
  }

  if (env.KEK_PROVIDER === 'local' && !env.KEK_LOCAL_BASE64) {
    missing.push('KEK_LOCAL_BASE64 (32 raw bytes, base64) — required by KEK_PROVIDER=local');
  }

  if (env.KEK_PROVIDER === 'aws-kms') {
    if (!env.AWS_KMS_KEY_ID) missing.push('AWS_KMS_KEY_ID');
    if (!env.AWS_REGION) missing.push('AWS_REGION');
    // Explicit credentials, or an instance role if one is attached. Coolify
    // hosts have no instance role, so on this deployment they are required.
    if (!env.AWS_ACCESS_KEY_ID) missing.push('AWS_ACCESS_KEY_ID');
    if (!env.AWS_SECRET_ACCESS_KEY) missing.push('AWS_SECRET_ACCESS_KEY');
  }

  if (missing.length > 0) {
    throw new Error(
      `Invalid environment configuration — missing:\n${missing.map((m) => `  ${m}`).join('\n')}`,
    );
  }

  return env;
}
