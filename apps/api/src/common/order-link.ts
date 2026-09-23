import crypto from 'node:crypto';

/**
 * A key that opens one order page, for the links in the order emails.
 *
 * The order page used to accept only the cart cookie of the browser that
 * placed the order. Every email linked to it anyway — the receipt, the
 * delivery, the transfer instructions — so a customer opening that link on
 * their phone, or a day later after the cookie changed, got a 404 on the page
 * that held their licence.
 *
 * An HMAC of the order number rather than a stored token: nothing to write,
 * nothing to look up, and it cannot be enumerated the way the sequential
 * numbers can. Derived from the access secret with its own label so it can
 * never be confused with a session signature. Rotating that secret retires
 * every emailed link; the customer then signs in, which still works.
 */
function secret(): string {
  const value = process.env.JWT_ACCESS_SECRET;
  if (!value) throw new Error('JWT_ACCESS_SECRET is required to sign order links.');
  return value;
}

export function orderAccessKey(number: string): string {
  return crypto
    .createHmac('sha256', secret())
    .update(`order-link:v1:${number}`)
    .digest('base64url')
    .slice(0, 32);
}

export function verifyOrderAccessKey(number: string, key: string | undefined): boolean {
  if (!key) return false;
  const expected = Buffer.from(orderAccessKey(number));
  const given = Buffer.from(key);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** The storefront URL of an order, carrying its key. */
export function orderLink(base: string, path: string, number: string): string {
  const url = new URL(path, base);
  url.searchParams.set('key', orderAccessKey(number));
  return url.toString();
}
