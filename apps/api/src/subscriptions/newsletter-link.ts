import crypto from 'node:crypto';

import {
  legacyLinkSecret,
  linkSigningSecret,
  retiredLinkSecrets,
  safeEqual,
  transitionalLinkSecrets,
} from '../common/link-secret.js';

/**
 * The newsletter links: confirm a subscription, and leave it.
 *
 * Self-contained, nothing stored until one is used: an HMAC over the purpose,
 * the address and an expiry. Until TASK-0098 they were signed with
 * JWT_ACCESS_SECRET and never expired; they now use LINK_SIGNING_SECRET like
 * the order and cart links (`common/link-secret.ts`), each under its own
 * purpose, so a confirm link can never be replayed as an unsubscribe.
 *
 * `v2.<base64url(email)>.<expiresAtSeconds, or 0 for never>.<mac>`, the MAC
 * over all of it. A v1 token is `<base64url(email)>.<mac>` — two parts, not
 * four, so the formats cannot be mistaken for each other.
 */
export type NewsletterPurpose = 'newsletter-confirm' | 'welcome-confirm' | 'newsletter-unsubscribe';

const DAY_MS = 86_400_000;

/**
 * How long each link works; null is never.
 *
 * Confirm — 7 days. A confirmation is followed within minutes or not at all,
 * and an old one in a mailbox is a standing "subscribe this address" that a
 * forwarded or leaked message hands to anyone. Asking again costs nothing:
 * the form sends a fresh link. The welcome one is the same link with a code
 * behind it, so it gets the same window.
 *
 * Unsubscribe — never. Withdrawing consent must be as easy as giving it
 * (GDPR art. 7(3)); an opt-out link has to keep working after the message is
 * sent (CAN-SPAM: at least 30 days, and in practice people unsubscribe from
 * year-old mail); Gmail and Yahoo require one-click unsubscribe (RFC 8058)
 * that works. An expired unsubscribe link is the store breaking that promise.
 * What a non-expiring one risks is small: whoever holds the message can take
 * that one address off the list, which its owner undoes by subscribing again.
 * It opens nothing and reveals nothing. For the same reason its old keys are
 * never retired either — v1 links and the derived fallback keep working past
 * LEGACY_LINK_CUTOFF (`retiredLinkSecrets`). Only rotating LINK_SIGNING_SECRET
 * or JWT_ACCESS_SECRET retires unsubscribe links already sent
 * (docs/deployment.md).
 */
export const NEWSLETTER_LINK_TTL_MS: Readonly<Record<NewsletterPurpose, number | null>> = {
  'newsletter-confirm': 7 * DAY_MS,
  'welcome-confirm': 7 * DAY_MS,
  'newsletter-unsubscribe': null,
};

function v2Mac(
  secret: string,
  purpose: NewsletterPurpose,
  payload: string,
  seconds: number,
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`newsletter-link:v2:${purpose}:${payload}|${String(seconds)}`)
    .digest('base64url');
}

function v1Mac(secret: string, purpose: NewsletterPurpose, payload: string): string {
  return crypto.createHmac('sha256', secret).update(`${purpose}:v1:${payload}`).digest('base64url');
}

function anyMatches(given: string, expected: string[]): boolean {
  // Every candidate is compared, so the time taken does not say which key a
  // token was close to.
  let valid = false;
  for (const candidate of expected) {
    if (safeEqual(given, candidate)) valid = true;
  }
  return valid;
}

export function newsletterToken(
  email: string,
  purpose: NewsletterPurpose,
  now: Date = new Date(),
): string {
  const ttl = NEWSLETTER_LINK_TTL_MS[purpose];
  const seconds = ttl === null ? 0 : Math.floor((now.getTime() + ttl) / 1000);
  const payload = Buffer.from(email).toString('base64url');
  return `v2.${payload}.${String(seconds)}.${v2Mac(linkSigningSecret(), purpose, payload, seconds)}`;
}

/** The address the link was issued for, or null if it is forged, for another purpose or expired. */
export function readNewsletterToken(
  token: string,
  purpose: NewsletterPurpose,
  now: Date = new Date(),
): string | null {
  const ttl = NEWSLETTER_LINK_TTL_MS[purpose];
  const parts = token.split('.');

  let payload: string;
  if (parts.length === 4 && parts[0] === 'v2') {
    const [, body = '', digits = '', mac = ''] = parts;
    if (!body || !/^\d{1,12}$/.test(digits)) return null;
    const seconds = Number(digits);
    const secrets = [
      linkSigningSecret(),
      ...(ttl === null ? retiredLinkSecrets().v2 : transitionalLinkSecrets(now)),
    ];
    const authentic = anyMatches(
      mac,
      secrets.map((secret) => v2Mac(secret, purpose, body, seconds)),
    );
    // The MAC first, the expiry after: a forged token and an expired one get
    // the same null. A never-expiring purpose is signed with 0 and nothing else.
    if (!authentic) return null;
    if (ttl === null ? seconds !== 0 : seconds === 0 || seconds * 1000 <= now.getTime()) {
      return null;
    }
    payload = body;
  } else if (parts.length === 2) {
    // v1: signed with JWT_ACCESS_SECRET, no expiry. Confirm links are accepted
    // until the cutoff like every other legacy link; unsubscribe links always.
    const [body = '', mac = ''] = parts;
    if (!body || !mac) return null;
    const secret = ttl === null ? retiredLinkSecrets().v1 : legacyLinkSecret(now);
    if (!secret || !safeEqual(mac, v1Mac(secret, purpose, body))) return null;
    payload = body;
  } else {
    return null;
  }

  const email = Buffer.from(payload, 'base64url').toString('utf8');
  return email || null;
}
