import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * Everything analytics does to keep personal data out of its table.
 *
 * Tracking plan §5: no email, name or IP is stored; the referrer is reduced to
 * its host; the visitor identifier is a cookieless hash that rotates daily
 * (the "no banner" option the owner chose on 2026-10-02).
 */

/**
 * The visitor's identifier for one UTC day, or null with no usable address or
 * no salt.
 *
 * HMAC(salt of the day, ip + user agent), the salt being 32 random bytes kept
 * in the database for that day only (`VisitorSaltService`, TASK-0097). The
 * same browser on the same day is one visitor, the next day it is a stranger,
 * and once the day's salt is deleted nobody can recompute or brute-force the
 * id from an address, whatever secrets they hold. Truncated to 128 bits, which
 * is plenty to count distinct visitors.
 */
export function visitorId(
  ip: string | undefined,
  userAgent: string | undefined,
  salt: Uint8Array | null,
): string | null {
  if (!ip || isIP(ip) === 0 || !salt || salt.length === 0) return null;
  return createHmac('sha256', salt)
    .update(
      `${ip}
${userAgent ?? ''}`,
    )
    .digest('base64url')
    .slice(0, 22);
}

/**
 * The host of a referrer, lower-cased, or null.
 *
 * Never the path or query: a referring URL can carry a login token, a cart
 * recovery link or someone's search. Only http(s) referrers count.
 */
export function referrerHost(raw: string | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  return host.length > 0 && host.length <= 253 ? host : null;
}

/**
 * Crawlers, link previewers and lab tools. Their visits are not shoppers, and
 * WhatsApp's own preview fetch of a shared product link is the commonest one.
 */
const BOT =
  /bot|crawl|spider|slurp|preview|lighthouse|headless|facebookexternalhit|whatsapp|curl|wget|python-requests|httpclient/i;

export function isBot(userAgent: string | undefined): boolean {
  return !userAgent || BOT.test(userAgent);
}
