import { z } from 'zod';

/**
 * WhatsApp: the phone number rules the storefront and the API share, and the
 * admin screen's shapes.
 *
 * The number is normalised in one place because it is the key everything else
 * hangs on. Consent is recorded against it, Meta addresses messages to it, and
 * an inbound STOP identifies its sender by it — so "0501234567" typed at
 * checkout and "+966501234567" arriving on the webhook must be the same
 * string, or the opt-out lands on nobody.
 */

// --- phone numbers -----------------------------------------------------------

interface NumberingPlan {
  code: string;
  /** Digits after the country code, trunk zero removed. */
  length: number;
  /** WhatsApp is a mobile service; a landline number is a typo, not a customer. */
  mobile: RegExp;
}

/**
 * Where the store's buyers are, with each country's mobile plan. Anything else
 * is accepted in international form on the generic E.164 rule.
 */
const PLANS: Record<string, NumberingPlan> = {
  SA: { code: '966', length: 9, mobile: /^5/ },
  AE: { code: '971', length: 9, mobile: /^5/ },
  KW: { code: '965', length: 8, mobile: /^[569]/ },
  QA: { code: '974', length: 8, mobile: /^[3567]/ },
  BH: { code: '973', length: 8, mobile: /^[36]/ },
  OM: { code: '968', length: 8, mobile: /^[79]/ },
  EG: { code: '20', length: 10, mobile: /^1/ },
  JO: { code: '962', length: 9, mobile: /^7/ },
};

/** Longest code first, so a prefix match never picks a shorter code by accident. */
const BY_CODE = Object.values(PLANS).sort((a, b) => b.code.length - a.code.length);

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits, which a Gulf keyboard types by default. */
function latinDigits(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function checkInternational(digits: string): string | null {
  const plan = BY_CODE.find((candidate) => digits.startsWith(candidate.code));
  if (plan) {
    // "+966 0501234567" is common: the trunk zero kept after the country code.
    let national = digits.slice(plan.code.length);
    if (national.startsWith('0')) national = national.slice(1);
    if (national.length !== plan.length || !plan.mobile.test(national)) return null;
    return `+${plan.code}${national}`;
  }
  // E.164: at most fifteen digits, never a leading zero. Eight is the shortest
  // mobile number anywhere a customer of this store plausibly lives.
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `+${digits}`;
}

/**
 * A typed phone number as E.164 (`+9665XXXXXXXX`), or null if it is not one.
 *
 * Local formats are read against the selected country: "0501234567" with SA
 * is +966501234567, with AE +971501234567. Without a country (or one not in
 * the table) only an international number is accepted — guessing the country
 * of "0501234567" is how a message reaches a stranger.
 */
export function normalizeWhatsappPhone(raw: string, country?: string | null): string | null {
  const text = latinDigits(raw).trim();
  if (text === '') return null;
  // Separators people type, and nothing else: letters mean this is not a number.
  if (!/^\+?[\d\s\-.()/]+$/.test(text)) return null;

  const digits = text.replace(/\D/g, '');
  if (text.startsWith('+')) return checkInternational(digits);
  if (digits.startsWith('00')) return checkInternational(digits.slice(2));

  const plan = country ? PLANS[country.toUpperCase()] : undefined;
  if (plan) {
    // Typed with the country code but without the "+": 966501234567.
    if (digits.startsWith(plan.code) && digits.length === plan.code.length + plan.length) {
      return checkInternational(digits);
    }
    const national = digits.startsWith('0') ? digits.slice(1) : digits;
    return checkInternational(`${plan.code}${national}`);
  }

  // No usable country: only a number that already names a known one.
  const known = BY_CODE.find(
    (candidate) =>
      digits.startsWith(candidate.code) &&
      digits.length === candidate.code.length + candidate.length,
  );
  return known ? checkInternational(digits) : null;
}

// --- settings ----------------------------------------------------------------

/**
 * One approved template: its name in WhatsApp Manager and the language codes
 * it was approved in. An empty name means "not set up", and that purpose keeps
 * going by email.
 */
export const whatsappTemplateSchema = z.object({
  templateName: z
    .string()
    .trim()
    .max(512)
    // Meta's own rule for template names.
    .regex(/^[a-z0-9_]*$/, 'lowercase letters, digits and underscores only')
    .default(''),
  languageAr: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(_[A-Z]{2})?$/)
    .default('ar'),
  languageEn: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(_[A-Z]{2})?$/)
    .default('en'),
});
export type WhatsappTemplate = z.infer<typeof whatsappTemplateSchema>;

const noTemplate = { templateName: '', languageAr: 'ar', languageEn: 'en' };

/**
 * WhatsApp as a channel for cart recovery and renewal reminders.
 *
 * It replaces the email for a step, never adds to it, and only for a customer
 * who ticked the WhatsApp box — consent there is its own consent. Holdout,
 * quiet hours and timing come from the feature being delivered, not from here.
 */
export const whatsappSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Send on WhatsApp instead of email when the customer agreed to WhatsApp. */
  preferWhatsapp: z.boolean().default(false),
  cartRecovery: whatsappTemplateSchema.default(noTemplate),
  renewal: whatsappTemplateSchema.default(noTemplate),
});
export type WhatsappSettings = z.infer<typeof whatsappSettingsSchema>;

export const whatsappPurposeSchema = z.enum(['cartRecovery', 'renewal']);
export type WhatsappPurpose = z.infer<typeof whatsappPurposeSchema>;

// --- admin -------------------------------------------------------------------

/** What the screen shows about the connection. Booleans only: no secret leaves the API. */
export const whatsappStatusSchema = z.object({
  configured: z.boolean(),
  accessToken: z.boolean(),
  phoneNumberId: z.boolean(),
  appSecret: z.boolean(),
  verifyToken: z.boolean(),
  /** Where Meta should deliver webhooks, or null when API_PUBLIC_URL is not set. */
  webhookUrl: z.string().nullable(),
  stats: z.object({
    windowDays: z.number().int(),
    sent: z.number().int(),
    delivered: z.number().int(),
    read: z.number().int(),
    failed: z.number().int(),
    optOuts: z.number().int(),
  }),
});
export type WhatsappStatus = z.infer<typeof whatsappStatusSchema>;

export const whatsappTestSchema = z
  .object({
    /** International form; a test has no checkout country to read a local one against. */
    to: z.string().trim().min(6).max(32),
    purpose: whatsappPurposeSchema,
    locale: z.enum(['ar', 'en']).default('ar'),
  })
  .transform((value, ctx) => {
    const to = normalizeWhatsappPhone(value.to);
    if (!to) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message:
          'رقم غير صالح. اكتبه بالصيغة الدولية، مثل ‎+966501234567 — Use international form.',
      });
      return z.NEVER;
    }
    return { ...value, to };
  });
export type WhatsappTest = z.infer<typeof whatsappTestSchema>;

export const whatsappTestResultSchema = z.object({
  ok: z.boolean(),
  messageId: z.string().nullable(),
  error: z.string().nullable(),
});
export type WhatsappTestResult = z.infer<typeof whatsappTestResultSchema>;
