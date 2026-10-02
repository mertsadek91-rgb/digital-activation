import crypto from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LEGACY_LINK_CUTOFF, linkSecretIsFallback } from './link-secret.js';
import {
  ORDER_LINK_DAYS,
  ORDER_LINK_TTL_MS,
  orderAccessKey,
  orderLink,
  verifyOrderAccessKey,
} from './order-link.js';
import { readLink, signLink } from './signed-link.js';

/**
 * TASK-0018: emailed order and cart links under their own key, with an expiry,
 * and the links already sent honoured until LEGACY_LINK_CUTOFF.
 *
 * Secrets are random per run: a literal reads as a leaked key to the secret
 * scanner, and nothing here depends on the value.
 */
const DAY = 86_400_000;
const BEFORE_CUTOFF = new Date(LEGACY_LINK_CUTOFF.getTime() - 10 * DAY);
const AFTER_CUTOFF = new Date(LEGACY_LINK_CUTOFF.getTime() + DAY);
const NUMBER = 'DA-10042';

let access: string;
let link: string;

/** How v1 order keys were minted before TASK-0018 — written out, not imported. */
function v1OrderKey(secret: string, number: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`order-link:v1:${number}`)
    .digest('base64url')
    .slice(0, 32);
}

/** How v1 cart-restore tokens were minted before TASK-0018. */
function v1CartToken(secret: string, value: string, expiresAt: Date): string {
  const seconds = Math.floor(expiresAt.getTime() / 1000);
  const payload = Buffer.from(`${value}|${String(seconds)}`).toString('base64url');
  const mac = crypto
    .createHmac('sha256', secret)
    .update(`cart-restore:v1:${payload}`)
    .digest('base64url');
  return `${payload}.${mac}`;
}

beforeEach(() => {
  access = crypto.randomBytes(48).toString('base64url');
  link = crypto.randomBytes(48).toString('base64url');
  vi.stubEnv('JWT_ACCESS_SECRET', access);
  vi.stubEnv('LINK_SIGNING_SECRET', link);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const view = (issued: Date): string => orderAccessKey(NUMBER, 'view', issued);
const opens = (key: string | undefined, now: Date, number = NUMBER): boolean =>
  verifyOrderAccessKey(number, key, 'view', now);

describe('order links — new (v2)', () => {
  it('signs a view key that verifies for its order', () => {
    const key = view(BEFORE_CUTOFF);
    expect(key).toMatch(/^v2\.view\.\d+\.[A-Za-z0-9_-]{32}$/);
    expect(opens(key, BEFORE_CUTOFF)).toBe(true);
  });

  it('is URL-safe in the link it builds', () => {
    const url = new URL(orderLink('https://shop.example.test', '/orders/DA-10042', NUMBER));
    expect(opens(url.searchParams.get('key') ?? undefined, new Date())).toBe(true);
  });

  it('is signed with LINK_SIGNING_SECRET, not the session key', () => {
    const key = view(BEFORE_CUTOFF);
    vi.stubEnv('LINK_SIGNING_SECRET', crypto.randomBytes(48).toString('base64url'));
    expect(opens(key, BEFORE_CUTOFF)).toBe(false);
  });

  it(`expires after ${String(ORDER_LINK_DAYS)} days, also after the cutoff`, () => {
    for (const issued of [BEFORE_CUTOFF, AFTER_CUTOFF]) {
      const key = view(issued);
      const lastDay = new Date(issued.getTime() + (ORDER_LINK_DAYS - 1) * DAY);
      const expired = new Date(issued.getTime() + ORDER_LINK_DAYS * DAY + 1000);
      expect(opens(key, lastDay)).toBe(true);
      expect(opens(key, expired)).toBe(false);
    }
  });

  it('refuses a key for another order, an extended expiry, or a tampered MAC', () => {
    const key = view(BEFORE_CUTOFF);
    const [, , seconds = '', mac = ''] = key.split('.');
    expect(opens(key, BEFORE_CUTOFF, 'DA-10043')).toBe(false);
    expect(opens(`v2.view.${String(Number(seconds) + DAY)}.${mac}`, BEFORE_CUTOFF)).toBe(false);
    const flipped = `${mac.slice(0, -1)}${mac.endsWith('A') ? 'B' : 'A'}`;
    expect(opens(`v2.view.${seconds}.${flipped}`, BEFORE_CUTOFF)).toBe(false);
    expect(opens(`${key}x`, BEFORE_CUTOFF)).toBe(false);
    expect(opens(`v2.view.${seconds}.`, BEFORE_CUTOFF)).toBe(false);
    expect(opens(`v2.${seconds}.${mac}`, BEFORE_CUTOFF)).toBe(false);
    expect(opens('v2...', BEFORE_CUTOFF)).toBe(false);
    expect(opens('', BEFORE_CUTOFF)).toBe(false);
    expect(opens(undefined, BEFORE_CUTOFF)).toBe(false);
  });
});

describe('order links — purposes', () => {
  it('binds the purpose: a view key never pays, a pay key never views', () => {
    const viewKey = view(BEFORE_CUTOFF);
    const payKey = orderAccessKey(NUMBER, 'pay', BEFORE_CUTOFF);
    expect(verifyOrderAccessKey(NUMBER, viewKey, 'pay', BEFORE_CUTOFF)).toBe(false);
    expect(verifyOrderAccessKey(NUMBER, payKey, 'view', BEFORE_CUTOFF)).toBe(false);
    expect(verifyOrderAccessKey(NUMBER, payKey, 'pay', BEFORE_CUTOFF)).toBe(true);
    // Relabelling the purpose in the key breaks its MAC.
    const relabelled = payKey.replace(/^v2\.pay\./, 'v2.view.');
    expect(opens(relabelled, BEFORE_CUTOFF)).toBe(false);
    expect(opens(payKey.replace(/^v2\.pay\./, 'v2.admin.'), BEFORE_CUTOFF)).toBe(false);
  });

  it('gives each purpose its own expiry (pay: 48 hours)', () => {
    expect(ORDER_LINK_TTL_MS.pay).toBe(48 * 3_600_000);
    const payKey = orderAccessKey(NUMBER, 'pay', BEFORE_CUTOFF);
    const at = (hours: number) => new Date(BEFORE_CUTOFF.getTime() + hours * 3_600_000);
    expect(verifyOrderAccessKey(NUMBER, payKey, 'pay', at(47))).toBe(true);
    expect(verifyOrderAccessKey(NUMBER, payKey, 'pay', at(49))).toBe(false);
  });
});

describe('order links — the transition from v1', () => {
  it('honours a link emailed before TASK-0018 until the cutoff, as a view link only', () => {
    const old = v1OrderKey(access, NUMBER);
    expect(opens(old, BEFORE_CUTOFF)).toBe(true);
    expect(opens(old, BEFORE_CUTOFF, 'DA-10043')).toBe(false);
    expect(verifyOrderAccessKey(NUMBER, old, 'pay', BEFORE_CUTOFF)).toBe(false);
  });

  it('refuses it from the cutoff on', () => {
    const old = v1OrderKey(access, NUMBER);
    expect(opens(old, LEGACY_LINK_CUTOFF)).toBe(false);
    expect(opens(old, AFTER_CUTOFF)).toBe(false);
  });

  it('never accepts a v1 key made with the link secret', () => {
    expect(opens(v1OrderKey(link, NUMBER), BEFORE_CUTOFF)).toBe(false);
  });
});

describe('order links — LINK_SIGNING_SECRET not set yet', () => {
  it('still signs and verifies, with a key that is not the session key', () => {
    vi.stubEnv('LINK_SIGNING_SECRET', '');
    expect(linkSecretIsFallback()).toBe(true);
    const key = view(AFTER_CUTOFF);
    expect(opens(key, AFTER_CUTOFF)).toBe(true);
    // Not simply the access secret under the v2 label.
    const [, , seconds = ''] = key.split('.');
    const underAccess = crypto
      .createHmac('sha256', access)
      .update(`order-link:v2:view:${NUMBER}|${seconds}`)
      .digest('base64url')
      .slice(0, 32);
    expect(key.endsWith(underAccess)).toBe(false);
  });

  it('keeps those links working once the secret is added, until the cutoff', () => {
    vi.stubEnv('LINK_SIGNING_SECRET', '');
    const sentWhileMissing = view(BEFORE_CUTOFF);
    const fallbackLate = view(new Date(LEGACY_LINK_CUTOFF.getTime() - DAY));
    vi.stubEnv('LINK_SIGNING_SECRET', link);
    expect(linkSecretIsFallback()).toBe(false);
    expect(opens(sentWhileMissing, BEFORE_CUTOFF)).toBe(true);
    const lateIssue = view(new Date(LEGACY_LINK_CUTOFF.getTime() - DAY));
    expect(opens(lateIssue, AFTER_CUTOFF)).toBe(true);
    expect(opens(fallbackLate, AFTER_CUTOFF)).toBe(false);
  });
});

describe('cart restore links', () => {
  it('round-trips under the link secret until they expire', () => {
    const token = signLink('cart-restore', 'cart_abc', new Date(BEFORE_CUTOFF.getTime() + DAY));
    expect(readLink('cart-restore', token, BEFORE_CUTOFF)).toBe('cart_abc');
    expect(readLink('cart-restore', token, new Date(BEFORE_CUTOFF.getTime() + 2 * DAY))).toBe(null);
    vi.stubEnv('LINK_SIGNING_SECRET', crypto.randomBytes(48).toString('base64url'));
    expect(readLink('cart-restore', token, BEFORE_CUTOFF)).toBeNull();
  });

  it('refuses a tampered token', () => {
    const token = signLink('cart-restore', 'cart_abc', new Date(BEFORE_CUTOFF.getTime() + DAY));
    const [, mac = ''] = token.split('.');
    const swapped = `${Buffer.from('cart_xyz|9999999999').toString('base64url')}.${mac}`;
    expect(readLink('cart-restore', swapped, BEFORE_CUTOFF)).toBeNull();
    expect(readLink('cart-restore', `${token}.x`, BEFORE_CUTOFF)).toBeNull();
  });

  it('honours a v1 token until the cutoff, and its own expiry still applies', () => {
    const old = v1CartToken(access, 'cart_old', new Date(BEFORE_CUTOFF.getTime() + 5 * DAY));
    expect(readLink('cart-restore', old, BEFORE_CUTOFF)).toBe('cart_old');
    expect(readLink('cart-restore', old, new Date(BEFORE_CUTOFF.getTime() + 6 * DAY))).toBeNull();
  });

  it('refuses a v1 token after the cutoff, even one not yet expired', () => {
    const old = v1CartToken(access, 'cart_old', new Date(AFTER_CUTOFF.getTime() + 20 * DAY));
    expect(readLink('cart-restore', old, AFTER_CUTOFF)).toBeNull();
  });
});
