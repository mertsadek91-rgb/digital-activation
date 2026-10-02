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
 * The key the daily visitor hash is made with.
 *
 * Derived from `JWT_ACCESS_SECRET` with a label of its own rather than read
 * from a new variable: the environment schema is owned elsewhere, and
 * `JWT_ACCESS_SECRET` is the one secret that is always set (INTERNAL_API_KEY is
 * optional). The label makes the derived key useless for anything the access
 * secret signs, and rotating the access secret simply starts new visitor ids.
 */
const VISITOR_KEY_LABEL = 'da:analytics:visitor-id:v1';

function visitorKey(): Buffer {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET is required to derive analytics visitor ids.');
  return createHmac('sha256', secret).update(VISITOR_KEY_LABEL).digest();
}

/**
 * The visitor's identifier for one UTC day, or null with no usable address.
 *
 * HMAC(HMAC(key, day), ip + user agent): the same browser on the same day is
 * one visitor, the next day it is a stranger, and the address itself is never
 * stored. Truncated to 128 bits, which is plenty to count distinct visitors.
 */
export function visitorId(
  ip: string | undefined,
  userAgent: string | undefined,
  now: Date,
): string | null {
  if (!ip || isIP(ip) === 0) return null;
  const day = now.toISOString().slice(0, 10);
  const daily = createHmac('sha256', visitorKey()).update(day).digest();
  return createHmac('sha256', daily)
    .update(`${ip}\n${userAgent ?? ''}`)
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
