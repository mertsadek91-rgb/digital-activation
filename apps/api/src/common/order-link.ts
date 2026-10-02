import crypto from 'node:crypto';

import {
  legacyLinkSecret,
  linkSigningSecret,
  safeEqual,
  transitionalLinkSecrets,
} from './link-secret.js';

/**
 * A key that opens one order, for the links in the order emails.
 *
 * The order page used to accept only the cart cookie of the browser that
 * placed the order. Every email linked to it anyway — the receipt, the
 * delivery, the transfer instructions — so a customer opening that link on
 * their phone, or a day later after the cookie changed, got a 404 on the page
 * that held their licence.
 *
 * An HMAC of the purpose, the order number and an expiry rather than a stored
 * token: nothing to write, nothing to look up, and it cannot be enumerated the
 * way the sequential numbers can. Signed with LINK_SIGNING_SECRET — see
 * `link-secret.ts` for the key, its fallback and the transition from v1.
 *
 * `v2.<purpose>.<expiresAtSeconds>.<mac>`, the MAC over all three. base64url
 * has no '.', so a v1 key (a bare 32-character MAC, no expiry) can never be
 * mistaken for one, and a key minted for one purpose never passes for another.
 */
export type OrderLinkPurpose = 'view' | 'pay';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * How long each kind of link opens its order.
 *
 * `view` — 30 days. These are the view links in the receipt, the delivery
 * email and the bank-transfer instructions. An unpaid order is cancelled after
 * 14 days (`expiry-sweep.service.ts`), so the link outlives everything the
 * instructions are for. A delivered key is looked at in the first days, and
 * again when an activation goes wrong — usually within the first weeks. Past
 * that, the page holds a licence key and a link sitting in a mailbox should
 * not open it forever: the customer signs in with an emailed sign-in link
 * (every order has a customer by email), and staff can resend any order
 * message, which mints a fresh link.
 *
 * `pay` — 48 hours, reserved for TASK-0017 (owner decision 2026-10-02): a
 * separate link that can pay for the order from another device but never
 * reveals its keys. Short because it is the one a forwarded email acts with.
 * Nothing mints or accepts it yet.
 *
 * Threat note — what a forwarded order email can do. Whoever holds the
 * message holds its links until they expire. A `view` link shows that order:
 * its lines, status and, once delivered, its licence keys — so it is as
 * sensitive as the delivery email itself, which already contains the keys;
 * the expiry bounds how long a mailbox leak keeps reopening them. It cannot
 * pay, change the order, or open any other order or account. A `pay` link,
 * once TASK-0017 accepts it, may start payment for that one order at the
 * amount on the order row — a stranger paying someone else's order — and
 * must be refused anywhere keys or personal details are returned.
 */
export const ORDER_LINK_TTL_MS: Readonly<Record<OrderLinkPurpose, number>> = {
  view: 30 * DAY_MS,
  pay: 48 * HOUR_MS,
};
/** The view window in days, for the docs and the tests. */
export const ORDER_LINK_DAYS = ORDER_LINK_TTL_MS.view / DAY_MS;

const MAC_LENGTH = 32;
const PURPOSES = new Set<string>(Object.keys(ORDER_LINK_TTL_MS));

function v2Mac(secret: string, purpose: OrderLinkPurpose, number: string, seconds: number): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`order-link:v2:${purpose}:${number}|${String(seconds)}`)
    .digest('base64url')
    .slice(0, MAC_LENGTH);
}

function v1Mac(secret: string, number: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`order-link:v1:${number}`)
    .digest('base64url')
    .slice(0, MAC_LENGTH);
}

export function orderAccessKey(
  number: string,
  purpose: OrderLinkPurpose = 'view',
  now: Date = new Date(),
): string {
  const seconds = Math.floor((now.getTime() + ORDER_LINK_TTL_MS[purpose]) / 1000);
  return `v2.${purpose}.${String(seconds)}.${v2Mac(linkSigningSecret(), purpose, number, seconds)}`;
}

/**
 * Whether `key` opens `number` for `purpose`. The purpose is required on
 * purpose: a caller must say what the link is allowed to do.
 */
export function verifyOrderAccessKey(
  number: string,
  key: string | undefined,
  purpose: OrderLinkPurpose,
  now: Date = new Date(),
): boolean {
  if (!key) return false;

  const v2 = /^v2\.([a-z]+)\.(\d{1,12})\.([A-Za-z0-9_-]+)$/.exec(key);
  if (v2) {
    const [, given = '', digits = '', mac = ''] = v2;
    if (given !== purpose || !PURPOSES.has(given)) return false;
    const seconds = Number(digits);
    // The MAC first, the expiry after: the answer for a forged key and an
    // expired one is the same false, and neither is cheaper to learn.
    const secrets = [linkSigningSecret(), ...transitionalLinkSecrets(now)];
    let valid = false;
    for (const secret of secrets) {
      if (safeEqual(mac, v2Mac(secret, purpose, number, seconds))) valid = true;
    }
    return valid && seconds * 1000 > now.getTime();
  }

  // A v1 key: no expiry and no purpose of its own. It was only ever a view
  // link, so it opens nothing else, and only until the cutoff.
  if (purpose !== 'view') return false;
  const legacy = legacyLinkSecret(now);
  if (!legacy) return false;
  return safeEqual(key, v1Mac(legacy, number));
}

/** The storefront URL of an order, carrying a view key. */
export function orderLink(base: string, path: string, number: string): string {
  const url = new URL(path, base);
  url.searchParams.set('key', orderAccessKey(number, 'view'));
  return url.toString();
}
