import crypto from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { summaryOf } from './business.service.js';
import {
  canonicalEmail,
  isFirstOrder,
  isSelfReferral,
  randomCode,
  referralClearance,
  referralFlags,
  welcomeCodeDecision,
} from './rules.js';

const DAY = 86_400_000;
const now = new Date('2026-09-23T12:00:00Z');

/**
 * The promises the growth features make, each of which costs money or
 * consent when broken: first-order codes for first orders, no rewarding
 * yourself, no reward for an order that did not stick.
 */
describe('first-order eligibility', () => {
  it('is a first order only with no earlier paid order', () => {
    expect(isFirstOrder(0)).toBe(true);
    expect(isFirstOrder(1)).toBe(false);
    expect(isFirstOrder(7)).toBe(false);
  });
});

describe('self-referral', () => {
  const referrer = { customerId: 'c1', email: 'Mona.Ali@gmail.com' };

  it('refuses the same customer row', () => {
    expect(isSelfReferral(referrer, { customerId: 'c1', email: 'other@x.com' })).toBe(true);
  });

  it('refuses the same mailbox spelled with a +tag or Gmail dots', () => {
    expect(isSelfReferral(referrer, { customerId: null, email: 'monaali+2@gmail.com' })).toBe(true);
    expect(
      isSelfReferral(referrer, { customerId: null, email: 'm.o.n.a.ali@googlemail.com' }),
    ).toBe(true);
  });

  it('allows a different person', () => {
    expect(isSelfReferral(referrer, { customerId: 'c2', email: 'sara@gmail.com' })).toBe(false);
  });

  it('keeps dots significant outside Gmail', () => {
    expect(canonicalEmail('a.b@company.sa')).toBe('a.b@company.sa');
    expect(canonicalEmail('ab+x@company.sa')).toBe('ab@company.sa');
  });

  it('flags a shared IP and a shared private domain, not a shared Gmail', () => {
    expect(
      referralFlags({
        referrerIps: ['1.2.3.4'],
        friendIp: '1.2.3.4',
        referrerEmail: 'a@acme.sa',
        friendEmail: 'b@acme.sa',
      }),
    ).toEqual(['SAME_IP', 'SAME_DOMAIN']);
    expect(
      referralFlags({
        referrerIps: [],
        friendIp: null,
        referrerEmail: 'a@gmail.com',
        friendEmail: 'b@gmail.com',
      }),
    ).toEqual([]);
  });
});

describe('referral clearing', () => {
  const base = {
    status: 'FULFILLED',
    paidAt: new Date(now.getTime() - 15 * DAY),
    riskLevel: 'LOW',
    refundedPayments: 0,
    clearAfterDays: 14,
    now,
  };

  it('clears a paid order past the window', () => {
    expect(referralClearance(base)).toEqual({ action: 'CLEAR' });
  });

  it('waits inside the window', () => {
    const verdict = referralClearance({ ...base, paidAt: new Date(now.getTime() - 3 * DAY) });
    expect(verdict.action).toBe('WAIT');
  });

  it('waits while a payment is held for review', () => {
    expect(referralClearance({ ...base, status: 'PAYMENT_REVIEW' }).action).toBe('WAIT');
  });

  it('voids a refunded, partially refunded or cancelled order', () => {
    expect(referralClearance({ ...base, status: 'REFUNDED' })).toEqual({
      action: 'VOID',
      reason: 'ORDER_REFUNDED',
    });
    expect(referralClearance({ ...base, status: 'PARTIALLY_REFUNDED' }).action).toBe('VOID');
    expect(referralClearance({ ...base, status: 'CANCELLED' }).action).toBe('VOID');
  });

  it('voids a refund recorded on a payment even if the order still reads paid', () => {
    expect(referralClearance({ ...base, refundedPayments: 1 })).toEqual({
      action: 'VOID',
      reason: 'REFUNDED',
    });
  });

  it('voids a disputed order', () => {
    expect(referralClearance({ ...base, riskLevel: 'BLOCKED' })).toEqual({
      action: 'VOID',
      reason: 'DISPUTED',
    });
  });

  it('clears on the day with a zero-day window', () => {
    expect(referralClearance({ ...base, paidAt: now, clearAfterDays: 0 })).toEqual({
      action: 'CLEAR',
    });
  });
});

describe('welcome code minting', () => {
  const base = {
    enabled: true,
    discountPercent: 10,
    discountValidDays: 14,
    priorPaidOrders: 0,
    alreadyIssued: false,
    now,
  };

  it('mints for a first-time buyer, expiring after the valid days', () => {
    const decision = welcomeCodeDecision(base);
    expect(decision).toEqual({ mint: true, expiresAt: new Date(now.getTime() + 14 * DAY) });
  });

  it('mints nothing when there is no discount', () => {
    expect(welcomeCodeDecision({ ...base, discountPercent: 0 })).toEqual({
      mint: false,
      reason: 'NO_DISCOUNT',
    });
  });

  it('mints nothing for someone who has already ordered', () => {
    expect(welcomeCodeDecision({ ...base, priorPaidOrders: 1 })).toEqual({
      mint: false,
      reason: 'HAS_ORDERED',
    });
  });

  it('mints once per address, so a second click sends nothing', () => {
    expect(welcomeCodeDecision({ ...base, alreadyIssued: true })).toEqual({
      mint: false,
      reason: 'ALREADY_ISSUED',
    });
  });

  it('mints nothing while the feature is off', () => {
    expect(welcomeCodeDecision({ ...base, enabled: false }).mint).toBe(false);
  });
});

describe('codes and summaries', () => {
  it('draws codes from an alphabet without look-alikes', () => {
    const code = randomCode(64, crypto.randomBytes);
    expect(code).toHaveLength(64);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/);
  });

  it('summarises a stored quote from its labelled lines', () => {
    expect(summaryOf('Company: Acme\nSeats: 25\nProduct: Office (office)\n\nHello')).toBe(
      'Acme · 25 · Office (office)',
    );
  });
});
