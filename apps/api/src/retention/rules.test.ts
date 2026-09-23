import { randomBytes } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { CartStage } from '@da/db';

import { addTerm, licenceExpiry, termOf } from '../common/licence-term.js';
import { readLink, signLink } from '../common/signed-link.js';

import {
  dueRenewalOffset,
  hasMarketingConsent,
  hasOptedOut,
  holdoutBucket,
  inHoldout,
  inQuietHours,
  ladderPosition,
  mintCode,
  nextCartStep,
  orderedSteps,
  storeHour,
} from './rules.js';

/**
 * The retention sweeps' decisions. Each of these fails without a sound: a
 * wrong one sends an email at 3am, twice, or never.
 */

const DAY = 86_400_000;
const at = (iso: string): Date => new Date(iso);

describe('licence expiry', () => {
  it('adds calendar months and years, clamping short months', () => {
    expect(addTerm(at('2026-01-31T12:00:00Z'), 'MONTH', 1).toISOString()).toBe(
      '2026-02-28T12:00:00.000Z',
    );
    expect(addTerm(at('2028-02-29T00:00:00Z'), 'YEAR', 1).toISOString()).toBe(
      '2029-02-28T00:00:00.000Z',
    );
    expect(addTerm(at('2026-03-10T00:00:00Z'), 'DAY', 30).toISOString()).toBe(
      '2026-04-09T00:00:00.000Z',
    );
  });

  it('never expires a lifetime licence', () => {
    expect(licenceExpiry(at('2026-01-01T00:00:00Z'), { unit: 'LIFETIME', value: null })).toBeNull();
    expect(licenceExpiry(at('2026-01-01T00:00:00Z'), null)).toBeNull();
  });

  it('prefers the order line snapshot over the variant as it is now', () => {
    const term = termOf(
      { licensePeriodUnit: 'YEAR', licensePeriodValue: 1 },
      { unit: 'MONTH', value: 6 },
    );
    expect(term).toEqual({ unit: 'YEAR', value: 1 });
    expect(licenceExpiry(at('2026-05-01T00:00:00Z'), term)?.toISOString()).toBe(
      '2027-05-01T00:00:00.000Z',
    );
  });

  it('falls back to the variant for lines written before snapshots', () => {
    expect(termOf(null, { unit: 'MONTH', value: 3 })).toEqual({ unit: 'MONTH', value: 3 });
    expect(termOf({ licensePeriodUnit: 'FOREVER' }, null)).toBeNull();
  });
});

describe('renewal step selection', () => {
  const deliveredAt = at('2025-06-01T00:00:00Z');
  const expiresAt = at('2026-06-01T00:00:00Z');
  const base = { deliveredAt, expiresAt, daysBefore: [30, 14, 3], daysAfter: 7 };

  it('sends nothing before the first reminder', () => {
    expect(dueRenewalOffset({ ...base, now: new Date(expiresAt.getTime() - 40 * DAY) })).toBeNull();
  });

  it('picks the most recent reminder that has come due, not a burst', () => {
    expect(dueRenewalOffset({ ...base, now: new Date(expiresAt.getTime() - 20 * DAY) })).toBe(30);
    expect(dueRenewalOffset({ ...base, now: new Date(expiresAt.getTime() - 2 * DAY) })).toBe(3);
  });

  it('sends the after-expiry message only inside its grace window', () => {
    expect(dueRenewalOffset({ ...base, now: new Date(expiresAt.getTime() + 2 * DAY) })).toBeNull();
    expect(dueRenewalOffset({ ...base, now: new Date(expiresAt.getTime() + 8 * DAY) })).toBe(-7);
    expect(dueRenewalOffset({ ...base, now: new Date(expiresAt.getTime() + 30 * DAY) })).toBeNull();
    expect(
      dueRenewalOffset({ ...base, daysAfter: 0, now: new Date(expiresAt.getTime() + 8 * DAY) }),
    ).toBeNull();
  });

  it('skips a reminder that would fall before the licence was delivered', () => {
    // A one-month licence: the 30-day reminder would be due before delivery.
    const short = {
      deliveredAt: at('2026-05-05T00:00:00Z'),
      expiresAt: at('2026-06-01T00:00:00Z'),
      daysBefore: [30, 14],
      daysAfter: 0,
    };
    expect(dueRenewalOffset({ ...short, now: at('2026-05-06T00:00:00Z') })).toBeNull();
    expect(dueRenewalOffset({ ...short, now: at('2026-05-20T00:00:00Z') })).toBe(14);
  });
});

describe('cart ladder step selection', () => {
  const steps = orderedSteps([
    { afterHours: 72, discountPercent: 10 },
    { afterHours: 1, discountPercent: 0 },
    { afterHours: 24, discountPercent: 0 },
  ]);

  it('orders steps by delay whatever order they were saved in', () => {
    expect(steps.map((step) => step.afterHours)).toEqual([1, 24, 72]);
  });

  it('sends the first rung once it is due', () => {
    expect(nextCartStep({ position: -1, idleHours: 0.5, steps })).toBeNull();
    expect(nextCartStep({ position: -1, idleHours: 2, steps })).toBe(0);
  });

  it('never repeats a rung', () => {
    expect(nextCartStep({ position: 0, idleHours: 5, steps })).toBeNull();
    expect(nextCartStep({ position: 0, idleHours: 25, steps })).toBe(1);
    expect(nextCartStep({ position: 2, idleHours: 100, steps })).toBeNull();
  });

  it('jumps to the latest due rung instead of sending a backlog', () => {
    expect(nextCartStep({ position: -1, idleHours: 80, steps })).toBe(2);
  });

  it('leaves a cart alone once its due rung is long stale', () => {
    expect(nextCartStep({ position: -1, idleHours: 72 + 49, steps })).toBeNull();
  });

  it('maps stages to rungs and leaves the manager queue alone', () => {
    expect(ladderPosition(CartStage.ACTIVE)).toBe(-1);
    expect(ladderPosition(CartStage.NUDGE_1H)).toBe(0);
    expect(ladderPosition(CartStage.OFFER_SENT)).toBe(3);
    expect(ladderPosition(CartStage.MANAGER_QUEUE)).toBeNull();
    expect(ladderPosition(CartStage.CLOSED)).toBeNull();
  });
});

describe('holdout assignment', () => {
  it('is deterministic per id and per feature', () => {
    expect(holdoutBucket('cartRecovery', 'cart_1')).toBe(holdoutBucket('cartRecovery', 'cart_1'));
    const ids = Array.from({ length: 50 }, (_, i) => `id_${String(i)}`);
    const differs = ids.some(
      (id) => holdoutBucket('cartRecovery', id) !== holdoutBucket('renewals', id),
    );
    expect(differs).toBe(true);
  });

  it('holds out nobody at 0% and roughly the share asked for', () => {
    const ids = Array.from({ length: 4000 }, (_, i) => `cart_${String(i)}`);
    expect(ids.filter((id) => inHoldout('cartRecovery', id, 0))).toHaveLength(0);
    const share = ids.filter((id) => inHoldout('cartRecovery', id, 20)).length / ids.length;
    expect(share).toBeGreaterThan(0.17);
    expect(share).toBeLessThan(0.23);
  });
});

describe('quiet hours', () => {
  it('wraps midnight', () => {
    expect(inQuietHours(23, 23, 9)).toBe(true);
    expect(inQuietHours(3, 23, 9)).toBe(true);
    expect(inQuietHours(9, 23, 9)).toBe(false);
    expect(inQuietHours(15, 23, 9)).toBe(false);
  });

  it('handles a same-day window and no window', () => {
    expect(inQuietHours(13, 12, 14)).toBe(true);
    expect(inQuietHours(14, 12, 14)).toBe(false);
    expect(inQuietHours(3, 5, 5)).toBe(false);
  });

  it('reads the hour in the store timezone', () => {
    // 21:30 UTC is 00:30 in Riyadh (UTC+3) and 01:30 in Dubai (UTC+4).
    expect(storeHour(at('2026-09-23T21:30:00Z'), 'Asia/Riyadh')).toBe(0);
    expect(storeHour(at('2026-09-23T21:30:00Z'), 'Asia/Dubai')).toBe(1);
  });
});

describe('consent', () => {
  const t1 = at('2026-01-01T00:00:00Z');
  const t2 = at('2026-02-01T00:00:00Z');

  it('needs an opt-in that has not been withdrawn since', () => {
    expect(hasMarketingConsent(null)).toBe(false);
    expect(hasMarketingConsent({ marketingOptInAt: null, marketingOptOutAt: null })).toBe(false);
    expect(hasMarketingConsent({ marketingOptInAt: t1, marketingOptOutAt: null })).toBe(true);
    expect(hasMarketingConsent({ marketingOptInAt: t1, marketingOptOutAt: t2 })).toBe(false);
    expect(hasMarketingConsent({ marketingOptInAt: t2, marketingOptOutAt: t1 })).toBe(true);
  });

  it('treats an unsubscribe as standing until consent is given again', () => {
    expect(hasOptedOut({ marketingOptInAt: null, marketingOptOutAt: t1 })).toBe(true);
    expect(hasOptedOut({ marketingOptInAt: t2, marketingOptOutAt: t1 })).toBe(false);
    expect(hasOptedOut({ marketingOptInAt: null, marketingOptOutAt: null })).toBe(false);
  });
});

describe('codes and signed links', () => {
  beforeAll(() => {
    // Random per run: a literal here reads as a leaked key to the secret
    // scanner, and nothing in the test depends on its value.
    process.env.JWT_ACCESS_SECRET = randomBytes(32).toString('base64url');
  });

  it('mints codes the promotion schema accepts', () => {
    const code = mintCode('BACK');
    expect(code).toMatch(/^BACK-[A-Z0-9]{10}$/);
    // No characters that read as each other on a phone screen.
    expect(code.slice('BACK-'.length)).not.toMatch(/[OIL01]/);
  });

  it('round-trips a restore link until it expires', () => {
    const now = at('2026-09-23T00:00:00Z');
    const token = signLink('cart-restore', 'cart_abc', new Date(now.getTime() + DAY));
    expect(readLink('cart-restore', token, now)).toBe('cart_abc');
    expect(readLink('cart-restore', token, new Date(now.getTime() + 2 * DAY))).toBeNull();
  });

  it('refuses a forged or tampered link', () => {
    const now = at('2026-09-23T00:00:00Z');
    const token = signLink('cart-restore', 'cart_abc', new Date(now.getTime() + DAY));
    const [, mac] = token.split('.');
    const forged = `${Buffer.from('cart_xyz|9999999999').toString('base64url')}.${mac ?? ''}`;
    expect(readLink('cart-restore', forged, now)).toBeNull();
    expect(readLink('cart-restore', 'garbage', now)).toBeNull();
    expect(readLink('cart-restore', `${token}x`, now)).toBeNull();
  });
});
