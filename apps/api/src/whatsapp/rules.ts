import crypto from 'node:crypto';

/**
 * The WhatsApp channel's decisions, as pure functions.
 *
 * Like the retention rules beside them, each of these fails without a sound
 * when it is wrong: a STOP that does not match keeps messaging somebody who
 * asked us not to, a signature check that passes everything lets anyone opt
 * a customer out, and a channel choice that ignores consent is a PDPL breach
 * one template at a time. So they are kept where a test can reach them.
 */

// --- consent -------------------------------------------------------------------

export interface WhatsappContact {
  whatsappPhone: string | null;
  whatsappOptInAt: Date | null;
  whatsappOptOutAt: Date | null;
}

/**
 * A number, and WhatsApp consent on record and not withdrawn since.
 *
 * STOP clears the opt-in and stamps the opt-out; ticking the box again at a
 * later checkout sets a new opt-in after it. Both are compared, as for email,
 * so an old opt-in cannot outlive a newer STOP.
 */
export function hasWhatsappConsent(customer: WhatsappContact | null): boolean {
  if (!customer?.whatsappPhone || !customer.whatsappOptInAt) return false;
  return !customer.whatsappOptOutAt || customer.whatsappOptOutAt < customer.whatsappOptInAt;
}

// --- channel -------------------------------------------------------------------

export type Delivery = 'none' | 'held-out' | 'whatsapp' | 'email';

/**
 * Where one step of a sweep goes, if anywhere.
 *
 * WhatsApp only when all of it holds: the channel switched on and preferred,
 * the API credentials present, a template set up for this purpose, and the
 * customer's WhatsApp consent. Otherwise email, when email is allowed for this
 * step (cart recovery needs email marketing consent; a renewal reminder is a
 * service message and always may). A customer reachable on neither gets
 * nothing — and is not counted in the holdout either, because a customer who
 * could not have been messaged says nothing about what messaging does.
 */
export function chooseDelivery(input: {
  whatsappEnabled: boolean;
  preferWhatsapp: boolean;
  configured: boolean;
  templateName: string;
  customer: WhatsappContact | null;
  emailAllowed: boolean;
  heldOut: boolean;
}): Delivery {
  const whatsapp =
    input.whatsappEnabled &&
    input.preferWhatsapp &&
    input.configured &&
    input.templateName.trim() !== '' &&
    hasWhatsappConsent(input.customer);
  if (!whatsapp && !input.emailAllowed) return 'none';
  if (input.heldOut) return 'held-out';
  return whatsapp ? 'whatsapp' : 'email';
}

// --- opt-out keywords ----------------------------------------------------------

/**
 * Levels the ways people type the same word: case, surrounding punctuation,
 * Arabic diacritics and tatweel, and the hamza forms of alef (إلغاء, الغاء
 * and ألغاء are one word to the person typing it).
 */
export function normaliseKeyword(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_WORDS = new Set(
  ['stop', 'unsubscribe', 'stop all', 'إيقاف', 'ايقاف', 'الغاء', 'إلغاء', 'الغاء الاشتراك'].map(
    normaliseKeyword,
  ),
);

/**
 * Whether a message is an opt-out.
 *
 * The whole message, not a word inside one: "don't stop my licence" is a
 * support question, and treating it as STOP would silence a customer who is
 * asking for help. A quick-reply button's payload goes through the same test.
 */
export function isStopKeyword(text: string | null | undefined): boolean {
  if (!text) return false;
  return STOP_WORDS.has(normaliseKeyword(text));
}

/** Arabic letters in it: the confirmation should answer in the language of the STOP. */
export function looksArabic(text: string): boolean {
  return /[؀-ۿ]/.test(text);
}

// --- webhook signature ---------------------------------------------------------

/**
 * Meta's `X-Hub-Signature-256`: `sha256=` and the hex HMAC of the raw body
 * with the app secret.
 *
 * Over the raw bytes, because re-serialised JSON does not reproduce them, and
 * compared in constant time. A missing or malformed header is a refusal, not
 * a pass: an unsigned request to this endpoint is anybody opting customers
 * out of the store's messages.
 */
export function verifyMetaSignature(
  raw: Buffer,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header || !secret) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match?.[1]) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest();
  const given = Buffer.from(match[1], 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

// --- Meta errors ---------------------------------------------------------------

export type MetaErrorKind =
  | 'opted-out'
  | 're-engagement'
  | 'undeliverable'
  | 'template-missing'
  | 'auth'
  | 'rate-limited'
  | 'other';

/**
 * What a Cloud API error code means for the store.
 *
 * Only the ones that change what we do next are named. 131050 is the one that
 * matters most: the customer blocked marketing from this business inside
 * WhatsApp, which is a withdrawal of consent as surely as replying STOP, and
 * is recorded as one.
 */
export function classifyMetaError(code: number | null | undefined): MetaErrorKind {
  switch (code) {
    case 131050:
      return 'opted-out';
    case 131047:
      // Outside the 24-hour window with a non-template message. Templates are
      // exempt, so this means a free-form reply went out too late.
      return 're-engagement';
    case 131026:
      return 'undeliverable';
    case 132001:
      return 'template-missing';
    case 190:
    case 10:
    case 200:
      return 'auth';
    case 4:
    case 80007:
    case 130429:
    case 131056:
      return 'rate-limited';
    default:
      return 'other';
  }
}

// --- delivery status -----------------------------------------------------------

export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

const RANK: Record<DeliveryStatus, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return value === 'sent' || value === 'delivered' || value === 'read' || value === 'failed';
}

/**
 * The columns one status callback changes on its log row, or null for none.
 *
 * Meta sends callbacks more than once and not always in order — a `read` can
 * overtake its `delivered`. So a timestamp is only ever set when empty, and
 * the status only moves forward. Applying the same callback twice changes
 * nothing the second time, which is what makes the webhook safe to retry.
 */
export function statusPatch(
  row: {
    deliveryStatus: string | null;
    deliveredAt: Date | null;
    openedAt: Date | null;
    bouncedAt: Date | null;
  },
  status: DeliveryStatus,
  at: Date,
  error?: string | null,
): {
  deliveryStatus?: DeliveryStatus;
  deliveredAt?: Date;
  openedAt?: Date;
  bouncedAt?: Date;
  error?: string;
} | null {
  const patch: {
    deliveryStatus?: DeliveryStatus;
    deliveredAt?: Date;
    openedAt?: Date;
    bouncedAt?: Date;
    error?: string;
  } = {};
  const current = isDeliveryStatus(row.deliveryStatus) ? RANK[row.deliveryStatus] : 0;
  if (RANK[status] > current) patch.deliveryStatus = status;

  if ((status === 'delivered' || status === 'read') && !row.deliveredAt) patch.deliveredAt = at;
  if (status === 'read' && !row.openedAt) patch.openedAt = at;
  if (status === 'failed' && !row.bouncedAt) {
    patch.bouncedAt = at;
    if (error) patch.error = error;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

// --- message text --------------------------------------------------------------

/**
 * A template body parameter as Meta will take it: no newlines or tabs, no run
 * of more than four spaces, not empty, and short. A parameter that breaks any
 * of these is refused with the whole message, so it is cleaned rather than
 * trusted — product names come from the catalog and customer names from a
 * checkout form.
 */
export function templateParam(value: string, fallback: string, max = 200): string {
  const cleaned = value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  const text = cleaned === '' ? fallback : cleaned;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The part of a storefront link after the origin, for a template's URL button.
 *
 * An approved template fixes the button's base URL (`https://store/{{1}}`), and
 * only the suffix is sent per message.
 */
export function buttonSuffix(url: URL): string {
  return `${url.pathname.replace(/^\//, '')}${url.search}`;
}
