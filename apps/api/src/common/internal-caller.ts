import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * The storefront's server, speaking for a visitor.
 *
 * Pages rendered on the storefront's server reach the API from the
 * storefront's own address, so to a per-IP rate limit every shopper is one
 * person. With `INTERNAL_API_KEY` set on both sides, the storefront sends the
 * key and the visitor's address, and the API counts that address instead.
 *
 * The forwarded address is believed only alongside the key. Without that
 * condition anyone could send `x-da-client-ip` with a fresh value per request
 * and never be limited at all.
 */
export const INTERNAL_KEY_HEADER = 'x-da-internal';
export const CLIENT_IP_HEADER = 'x-da-client-ip';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Constant-time comparison. Hashing first gives both sides the same length,
 * which `timingSafeEqual` needs, without the length check leaking the key's.
 */
export function internalKeyMatches(presented: unknown, key: string | undefined): boolean {
  if (!key || typeof presented !== 'string' || presented.length === 0) return false;
  return timingSafeEqual(digest(presented), digest(key));
}

interface TrackedRequest {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

/** The address a rate limit should count this request against. */
export function trackerFor(request: TrackedRequest, key: string | undefined): string {
  const fallback = request.ip ?? 'unknown';
  if (!internalKeyMatches(request.headers[INTERNAL_KEY_HEADER], key)) return fallback;
  const forwarded = request.headers[CLIENT_IP_HEADER];
  return typeof forwarded === 'string' && isIP(forwarded) !== 0 ? forwarded : fallback;
}
