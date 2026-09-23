/**
 * The decisions behind the growth features, as pure functions.
 *
 * Kept apart from the services so they can be tested without a database: each
 * one is a rule the store has promised to keep (a welcome code only for a first
 * order, no rewarding yourself, no reward for an order that was refunded), and
 * a rule that is only enforced somewhere inside a query is a rule nobody can
 * show is enforced.
 */

/** Order states that mean the money arrived and has not gone back. */
export const PAID_STATES = ['PAID', 'FULFILLING', 'FULFILLED', 'COMPLETED'] as const;

/** States that end a referral with no reward. */
const LOST_STATES = ['CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FAILED'] as const;

// --- first order -----------------------------------------------------------

/**
 * Is this the customer's first paid order?
 *
 * Counted over every order that was ever paid — `paidAt` set — whatever its
 * state now. A refunded order still counts: "first order" discounts exist to
 * win a new buyer, and someone who bought and refunded is not one.
 */
export function isFirstOrder(priorPaidOrders: number): boolean {
  return priorPaidOrders === 0;
}

// --- identity --------------------------------------------------------------

/**
 * One mailbox, however it is spelled.
 *
 * `Name+anything@x` reaches `name@x` at every large provider, and Gmail
 * ignores dots in the local part. Without this, a referrer refers themselves
 * as `me+1@gmail.com` and collects both sides of the reward.
 */
export function canonicalEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf('@');
  if (at < 1) return lower;
  let local = lower.slice(0, at);
  let domain = lower.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

export interface Party {
  customerId: string | null;
  email: string;
}

/**
 * Self-referral: the friend is the referrer.
 *
 * Refused outright — same customer row, or the same mailbox by
 * `canonicalEmail`. A friend on the same network is not refused (families and
 * offices share one), only flagged for a person to look at; see `referralFlags`.
 */
export function isSelfReferral(referrer: Party, friend: Party): boolean {
  if (referrer.customerId && friend.customerId && referrer.customerId === friend.customerId) {
    return true;
  }
  return canonicalEmail(referrer.email) === canonicalEmail(friend.email);
}

/** Signals worth a look, not a refusal. */
export function referralFlags(input: {
  referrerIps: string[];
  friendIp: string | null;
  referrerEmail: string;
  friendEmail: string;
}): string[] {
  const flags: string[] = [];
  if (input.friendIp && input.referrerIps.includes(input.friendIp)) flags.push('SAME_IP');
  const [, referrerDomain] = input.referrerEmail.toLowerCase().split('@');
  const [, friendDomain] = input.friendEmail.toLowerCase().split('@');
  // Two addresses on one small private domain are more often one person than
  // two friends; on a public provider it says nothing.
  const publicDomains = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com'];
  if (
    referrerDomain &&
    referrerDomain === friendDomain &&
    !publicDomains.includes(referrerDomain)
  ) {
    flags.push('SAME_DOMAIN');
  }
  return flags;
}

// --- clearing --------------------------------------------------------------

export type Clearance =
  { action: 'WAIT'; until: Date } | { action: 'CLEAR' } | { action: 'VOID'; reason: string };

/**
 * Whether a referred friend's order has earned the referrer their reward.
 *
 * Cleared only when the order is still paid, `clearAfterDays` after payment,
 * with nothing refunded and no dispute (a dispute sets the order's risk level
 * to BLOCKED). A payment held for review waits: it may yet be released.
 */
export function referralClearance(input: {
  status: string;
  paidAt: Date | null;
  riskLevel: string;
  refundedPayments: number;
  clearAfterDays: number;
  now: Date;
}): Clearance {
  if ((LOST_STATES as readonly string[]).includes(input.status)) {
    return { action: 'VOID', reason: `ORDER_${input.status}` };
  }
  if (input.refundedPayments > 0) return { action: 'VOID', reason: 'REFUNDED' };
  if (input.riskLevel === 'BLOCKED') return { action: 'VOID', reason: 'DISPUTED' };
  if (!input.paidAt || !(PAID_STATES as readonly string[]).includes(input.status)) {
    return { action: 'WAIT', until: input.now };
  }
  const until = new Date(input.paidAt.getTime() + input.clearAfterDays * 86_400_000);
  if (input.now < until) return { action: 'WAIT', until };
  return { action: 'CLEAR' };
}

// --- welcome code ----------------------------------------------------------

export type WelcomeDecision =
  | { mint: true; expiresAt: Date }
  | { mint: false; reason: 'NO_DISCOUNT' | 'HAS_ORDERED' | 'ALREADY_ISSUED' | 'DISABLED' };

/**
 * Whether a confirmed welcome sign-up gets a code.
 *
 * Only a first-time buyer, only once per address, only when a discount is
 * configured — and only ever after the confirmation link, which is the caller's
 * job: this runs from `confirm`, never from `subscribe`.
 */
export function welcomeCodeDecision(input: {
  enabled: boolean;
  discountPercent: number;
  discountValidDays: number;
  priorPaidOrders: number;
  alreadyIssued: boolean;
  now: Date;
}): WelcomeDecision {
  if (!input.enabled) return { mint: false, reason: 'DISABLED' };
  if (input.discountPercent <= 0) return { mint: false, reason: 'NO_DISCOUNT' };
  if (input.alreadyIssued) return { mint: false, reason: 'ALREADY_ISSUED' };
  if (!isFirstOrder(input.priorPaidOrders)) return { mint: false, reason: 'HAS_ORDERED' };
  return {
    mint: true,
    expiresAt: new Date(input.now.getTime() + input.discountValidDays * 86_400_000),
  };
}

// --- codes -----------------------------------------------------------------

/** No 0/O or 1/I: codes are read off phones and typed back. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(length: number, random: (n: number) => Buffer): string {
  const bytes = random(length);
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += ALPHABET[(bytes[index] ?? 0) % ALPHABET.length];
  }
  return out;
}

/** Prefixes that let the panel count what each feature minted. */
export const WELCOME_CODE_PREFIX = 'WELCOME-';
export const REFERRAL_FRIEND_PREFIX = 'REF-';
export const REFERRAL_REWARD_PREFIX = 'THANKS-';

/** The API-domain cookie holding a followed referral code (httpOnly). */
export const REFERRAL_COOKIE = 'da_ref';
