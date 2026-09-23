import crypto from 'node:crypto';

/**
 * A self-contained, expiring, purpose-bound token for an emailed link.
 *
 * Same construction as the order and newsletter links — an HMAC over the
 * payload with the access secret and a label of its own — plus an expiry,
 * because the links this is for (restoring an abandoned cart) hand over
 * something live and should not work forever. Nothing is stored: the link
 * carries its own proof, and rotating the secret retires every one.
 *
 * `<base64url(value|expiresAtSeconds)>.<hmac>`.
 */
export type LinkPurpose = 'cart-restore';

function secret(): string {
  const value = process.env.JWT_ACCESS_SECRET;
  if (!value) throw new Error('JWT_ACCESS_SECRET is required to sign emailed links.');
  return value;
}

function mac(purpose: LinkPurpose, payload: string): string {
  return crypto.createHmac('sha256', secret()).update(`${purpose}:v1:${payload}`).digest('base64url');
}

export function signLink(purpose: LinkPurpose, value: string, expiresAt: Date): string {
  const seconds = Math.floor(expiresAt.getTime() / 1000);
  const payload = Buffer.from(`${value}|${String(seconds)}`).toString('base64url');
  return `${payload}.${mac(purpose, payload)}`;
}

/** The value the link was issued for, or null if it is forged, reused elsewhere or expired. */
export function readLink(purpose: LinkPurpose, token: string, now: Date = new Date()): string | null {
  const [payload, given] = token.split('.');
  if (!payload || !given) return null;
  const expected = Buffer.from(mac(purpose, payload));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

  const decoded = Buffer.from(payload, 'base64url').toString('utf8');
  const bar = decoded.lastIndexOf('|');
  if (bar <= 0) return null;
  const seconds = Number.parseInt(decoded.slice(bar + 1), 10);
  if (!Number.isFinite(seconds) || seconds * 1000 < now.getTime()) return null;
  return decoded.slice(0, bar);
}
