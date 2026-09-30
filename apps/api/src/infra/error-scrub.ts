import { SECRET_FIELDS, SECRET_QUERY, maskEmails, scrubUrl } from './logging.js';

/**
 * What leaves the process for the error reporter, cleaned by the same rules
 * as the log (logging.ts) plus the one the log does not need.
 *
 * The log redacts by path and masks emails. An error event is looser: the
 * reporter's SDK attaches the request it saw, breadcrumbs of earlier HTTP
 * calls, and an exception message that may quote whatever a query returned.
 * So this walks the whole event, redacts every field the log redacts wherever
 * it sits, scrubs anything that is a URL, masks emails, and — because an
 * event is free text sent to a third party — masks anything shaped like a
 * licence key, a JWT, a bearer credential or a random token, and replaces an
 * order number in a URL path with `:number`.
 */

const REDACTED = '[redacted]';

/** Header names redacted outright, whatever the rules below make of them. */
const SECRET_HEADERS = new Set(['x-da-internal', 'x-da-monitor']);

/**
 * Stems that make a field secret wherever they appear in its name, in any
 * case: `sessionToken`, `passwordHash`, `clientSecret`, `set-cookie`,
 * `proxy-authorization`. Long enough not to occur by accident inside an
 * unrelated word.
 */
const SECRET_STEMS = [
  'token',
  'secret',
  'password',
  'passwd',
  'authorization',
  'cookie',
  // The vault's own vocabulary: a decrypted key is `plaintext`.
  'plaintext',
  'ciphertext',
  'credential',
  'recoverycode',
  'mfacode',
];

/**
 * Short words that are secret only as a whole word of the name — or as its
 * ending, for names written in one run (`apikey`, `licensekey`). As a bare
 * substring `otp` is inside `isNotPaid` and `key` inside `monkey`.
 */
const SECRET_WORDS = new Set(['key', 'keys', 'otp', 'totp', 'dsn', 'dek', 'licence', 'license']);
const SECRET_ENDINGS = /(?:key|keys|otp)$/;

/**
 * A name whose LAST word is one of these describes a secret rather than
 * holding one, and is kept: `keyId`, `keyVersion`, `tokenType`,
 * `passwordChangedAt`, `keyCount`. Deliberately narrow — `keyHash`,
 * `keyFingerprint` and `tokenPrefix` are still redacted, since each is
 * derived from the secret itself.
 */
const DESCRIPTIVE_ENDINGS = new Set(['id', 'ids', 'version', 'count', 'type', 'at', 'length']);

function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Whether a field of this name is redacted at any depth. Exported for the tests. */
export function isSecretName(name: string): boolean {
  const lower = name.toLowerCase();
  if (SECRET_HEADERS.has(lower)) return true;
  const parts = words(name);
  const last = parts.at(-1);
  if (parts.length > 1 && last !== undefined && DESCRIPTIVE_ENDINGS.has(last)) return false;
  return namesSecret(name);
}

/** The stem and word rules alone, without the descriptive-ending exception. */
function namesSecret(name: string): boolean {
  const lower = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (SECRET_STEMS.some((stem) => lower.includes(stem))) return true;
  if (words(name).some((part) => SECRET_WORDS.has(part))) return true;
  return SECRET_ENDINGS.test(lower);
}

/**
 * A descriptive name (`secretVersion`, `tokenAt`) is kept for what such fields
 * normally hold: a number, a flag, a date, a short label. A long string under
 * one is treated as the secret it is named after.
 */
function descriptiveButHoldsSecret(name: string, value: unknown): boolean {
  return typeof value === 'string' && value.length > 24 && namesSecret(name);
}

// The log's exact-name list must stay a subset of what is redacted here.
for (const name of SECRET_FIELDS) {
  if (!isSecretName(name)) throw new Error(`error-scrub does not redact ${name}`);
}

/** Fields whose value is a URL or a query string. */
const URL_NAMES = new Set(['url', 'href', 'from', 'to']);

/**
 * Licence keys, two shapes:
 *
 * - `ABCDE-FGHIJ-KLMNO-PQRST-UVWXY`: four or more groups of four to six, in
 *   either case.
 * - `abcd-12ef-g3h4`: three groups, but only with a digit somewhere, because
 *   three short words joined by dashes (`read-only-mode`) are ordinary prose.
 *
 * The run must stand alone — nothing alphanumeric, `_` or `-` touching either
 * end — so a UUID (8-4-4-4-12) is not partly masked from its middle, and a
 * slug is masked only when the whole slug has the shape. Order numbers
 * (`DA-2026-00187`) start with a two-letter group and never match.
 */
const LICENCE_KEY =
  /(?<![A-Za-z0-9_-])(?:[A-Za-z0-9]{4,6}(?:-[A-Za-z0-9]{4,6}){3,}|(?=[A-Za-z-]*\d)[A-Za-z0-9]{4,6}(?:-[A-Za-z0-9]{4,6}){2})(?![A-Za-z0-9_-])/g;

/** A JWT: its header is base64url JSON, so it always opens with `eyJ`. */
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;

/**
 * `Bearer <credential>` — the scheme names what follows as a credential. Eight
 * characters or more, so "the bearer of bad news" is left as it is.
 */
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi;

/** `Basic <base64 user:password>`, as in an Authorization header quoted in a message. */
const BASIC = /\bBasic\s+[A-Za-z0-9+/]{8,}={0,2}/gi;

/**
 * A long run of base64url characters, candidate for a random token. Masked
 * only if it mixes upper case, lower case and digits (32 random base64url
 * characters all but always do; a slug, a word or a UUID does not), or is 32+
 * hex digits with no dashes (a digest). The API's own tokens are 24–48 random
 * bytes in base64url: 32 characters and up.
 */
const LONG_RUN = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g;

function looksRandom(run: string): boolean {
  if (/^[0-9a-f]+$/i.test(run)) return true;
  return /[A-Z]/.test(run) && /[a-z]/.test(run) && /\d/.test(run);
}

/**
 * An order number as a path segment — `/v1/orders/DA-2026-00187/keys` —
 * becomes the route's own placeholder. Only after a slash: an order number in
 * a message is the reference support needs; in a URL it is the customer's.
 * Also as a query value (`?number=DA-…`), and in either case.
 */
const ORDER_IN_PATH = /(?<=[/=])DA-\d{4}-\d+(?![A-Za-z0-9-])/gi;

export function maskLicenceKeys(text: string): string {
  return text.includes('-') ? text.replace(LICENCE_KEY, '[key]') : text;
}

/** JWTs and bearer credentials: whole credentials, masked before anything else. */
function maskCredentials(text: string): string {
  return text
    .replace(BEARER, 'Bearer [token]')
    .replace(BASIC, 'Basic [token]')
    .replace(JWT, '[token]');
}

function maskLongRuns(text: string): string {
  return text.replace(LONG_RUN, (run) => (looksRandom(run) ? '[token]' : run));
}

/** JWTs, bearer credentials and long random-looking runs. */
export function maskTokens(text: string): string {
  return maskLongRuns(maskCredentials(text));
}

export function maskOrderPaths(text: string): string {
  return /[/=]da-/i.test(text) ? text.replace(ORDER_IN_PATH, ':number') : text;
}

export function scrubText(text: string): string {
  // Credentials first, so a dash inside a JWT segment is never read as the
  // start of a licence key and the JWT left in pieces.
  return maskOrderPaths(maskLongRuns(maskLicenceKeys(maskCredentials(maskEmails(text)))));
}

function scrubQueryString(value: unknown): unknown {
  if (typeof value === 'string') {
    const scrubbed = scrubUrl(`?${value.replace(/^\?/, '')}`);
    return scrubText(scrubbed.slice(1));
  }
  if (Array.isArray(value)) {
    // Sentry's `[[name, value], ...]` form.
    return value.map((pair: unknown) =>
      Array.isArray(pair) && typeof pair[0] === 'string'
        ? [pair[0], SECRET_QUERY.test(pair[0]) ? REDACTED : scrub(pair[1], 2)]
        : scrub(pair, 2),
    );
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [name, inner] of Object.entries(value)) {
      out[name] = SECRET_QUERY.test(name) ? REDACTED : scrub(inner, 2);
    }
    return out;
  }
  return value;
}

/** A deep copy of `value` with secrets redacted and free text masked. */
export function scrub(value: unknown, depth = 10): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth === 0) return REDACTED;
  if (Array.isArray(value)) return value.map((item: unknown) => scrub(item, depth - 1));

  const out: Record<string, unknown> = {};
  for (const [name, inner] of Object.entries(value)) {
    const lower = name.toLowerCase();
    if (isSecretName(name) || descriptiveButHoldsSecret(name, inner)) out[name] = REDACTED;
    else if (lower === 'query_string' || lower === 'query') out[name] = scrubQueryString(inner);
    else if (URL_NAMES.has(lower) && typeof inner === 'string')
      out[name] = scrubText(scrubUrl(inner));
    else out[name] = scrub(inner, depth - 1);
  }
  return out;
}

/** Request headers worth sending. Everything else is dropped, not redacted. */
const SAFE_HEADERS = new Set(['content-type', 'user-agent', 'x-request-id', 'accept-language']);

interface EventLike {
  user?: unknown;
  request?: {
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, unknown>;
    [field: string]: unknown;
  };
  [field: string]: unknown;
}

/**
 * Sentry's `beforeSend`. Structural, not Sentry-typed, so the adapter stays
 * loadable without the package.
 *
 * Beyond `scrub`: the user and the request body and cookies are removed
 * outright — a body is a checkout, a login or a reveal — and request headers
 * are cut down to an allowlist.
 */
export function scrubEvent<E>(event: E): E {
  const copy = { ...(event as EventLike) };
  delete copy.user;
  if (copy.request) {
    const request = { ...copy.request };
    delete request.data;
    delete request.cookies;
    if (request.headers) {
      request.headers = Object.fromEntries(
        Object.entries(request.headers).filter(([name]) => SAFE_HEADERS.has(name.toLowerCase())),
      );
    }
    copy.request = request;
  }
  return scrub(copy) as E;
}

/** Sentry's `beforeBreadcrumb`: the same rules, one crumb at a time. */
export function scrubBreadcrumb<B>(breadcrumb: B): B {
  return scrub(breadcrumb) as B;
}
