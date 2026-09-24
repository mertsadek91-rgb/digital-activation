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
  /**
   * Shared with the storefront's server, which sends it with the visitor's
   * address so the routes it calls per visitor can be limited per visitor.
   * Optional: unset, those routes are simply not limited. Whoever holds it can
   * choose the address a limit counts, so it is a secret like any other.
   */
  INTERNAL_API_KEY: z.string().min(32, 'must be at least 32 characters').optional(),
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
  /**
   * Read by the API and handed to the browser with the payment session, rather
   * than built into the storefront bundle. It is not a secret, but keeping it
   * on one side means a key rotation is a restart of one service instead of a
   * rebuild of the storefront.
   */
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
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

  /**
   * The store's own clock, used to decide the hours a marketing email may be
   * sent. Not the server's timezone and not the customer's: a store's working
   * hours are a property of the store.
   */
  STORE_TIMEZONE: z
    .string()
    .min(1)
    .default('Asia/Riyadh')
    // Checked here rather than where it is used: an unknown zone makes Intl
    // throw, and the place it would throw is inside a scheduled sweep at 9am,
    // where nobody is looking.
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat('en-GB', { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    }, 'is not an IANA timezone name'),

  /**
   * WhatsApp Cloud API, directly with Meta. All optional: without the token
   * and number id the retention sweeps keep to email, and without the app
   * secret the webhook refuses every delivery rather than trusting one.
   */
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z
    .string()
    .regex(/^\d+$/, 'is the numeric id, not the phone number')
    .optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),

  BASE_CURRENCY: z.string().length(3).default('USD'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SENTRY_DSN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Whether a secret is a stand-in rather than a generated value.
 *
 * Length is not the test — the example file's placeholder is long enough.
 * The words people type into placeholders are, and so is how few distinct
 * characters a hand-typed string has next to 32 random bytes.
 */
export function looksLikePlaceholder(secret: string): boolean {
  if (/change[_-]?me|placeholder|example|replace|your[_-]?secret/i.test(secret)) return true;
  return new Set(secret).size < 12;
}

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
    // The access secret signs the staff session, and the guard trusts the
    // role inside it without a database read — so whoever knows it can mint
    // an OWNER token. The `.env.example` placeholder is 38 characters and
    // passes the length check, which is exactly how it ends up in production.
    if (looksLikePlaceholder(env.JWT_ACCESS_SECRET)) {
      throw new Error(
        'JWT_ACCESS_SECRET looks like a placeholder. Generate one with `pnpm secrets:generate` — anyone who knows this value can sign in as the owner.',
      );
    }
    // Card payments are optional: a store can open on bank transfer alone, and
    // with no Stripe key the checkout simply does not offer a card. What is
    // refused is half a configuration. Without the webhook secret a card is
    // charged and the order never learns it was paid; without the publishable
    // key the card option disappears with no error anywhere to say why.
    const stripeKeys = {
      STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET,
      STRIPE_PUBLISHABLE_KEY: env.STRIPE_PUBLISHABLE_KEY,
    };
    if (Object.values(stripeKeys).some(Boolean)) {
      for (const [key, value] of Object.entries(stripeKeys)) {
        if (!value) missing.push(`${key} (the other Stripe keys are set)`);
      }
    }
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
