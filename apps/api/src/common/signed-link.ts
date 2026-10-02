import crypto from 'node:crypto';

import {
  legacyLinkSecret,
  linkSigningSecret,
  safeEqual,
  transitionalLinkSecrets,
} from './link-secret.js';

/**
 * A self-contained, expiring, purpose-bound token for an emailed link.
 *
 * An HMAC over the payload with LINK_SIGNING_SECRET and a label of its own,
 * plus an expiry, because the links this is for (restoring an abandoned cart)
 * hand over something live and should not work forever. Nothing is stored: the
 * link carries its own proof, and rotating the secret retires every one.
 *
 * `<base64url(value|expiresAtSeconds)>.<hmac>`. The label is `v2` under the
 * link secret; `v1` tokens were signed with the access secret and are accepted
 * until LEGACY_LINK_CUTOFF (`link-secret.ts`) — they carry their own expiry,
 * which still applies.
 */
export type LinkPurpose = 'cart-restore';

function mac(secret: string, version: 'v1' | 'v2', purpose: LinkPurpose, payload: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${purpose}:${version}:${payload}`)
    .digest('base64url');
}

export function signLink(purpose: LinkPurpose, value: string, expiresAt: Date): string {
  const seconds = Math.floor(expiresAt.getTime() / 1000);
  const payload = Buffer.from(`${value}|${String(seconds)}`).toString('base64url');
  return `${payload}.${mac(linkSigningSecret(), 'v2', purpose, payload)}`;
}

function authentic(purpose: LinkPurpose, payload: string, given: string, now: Date): boolean {
  const candidates = [linkSigningSecret(), ...transitionalLinkSecrets(now)].map((secret) =>
    mac(secret, 'v2', purpose, payload),
  );
  const legacy = legacyLinkSecret(now);
  if (legacy) candidates.push(mac(legacy, 'v1', purpose, payload));

  let valid = false;
  for (const expected of candidates) {
    if (safeEqual(given, expected)) valid = true;
  }
  return valid;
}

/** The value the link was issued for, or null if it is forged, reused elsewhere or expired. */
export function readLink(
  purpose: LinkPurpose,
  token: string,
  now: Date = new Date(),
): string | null {
  const [payload, given, extra] = token.split('.');
  if (!payload || !given || extra !== undefined) return null;
  if (!authentic(purpose, payload, given, now)) return null;

  const decoded = Buffer.from(payload, 'base64url').toString('utf8');
  const bar = decoded.lastIndexOf('|');
  if (bar <= 0) return null;
  const seconds = Number.parseInt(decoded.slice(bar + 1), 10);
  if (!Number.isFinite(seconds) || seconds * 1000 < now.getTime()) return null;
  return decoded.slice(0, bar);
}
