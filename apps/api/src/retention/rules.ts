import crypto from 'node:crypto';

import { CartStage } from '@da/db';

/**
 * The decisions the two retention sweeps make, as pure functions.
 *
 * Kept out of the services so each can be tested without a database: who is
 * due what, who is held out, whether it is a decent hour, and who agreed to be
 * marketed to. Every one of these fails silently when wrong — nothing throws,
 * an email simply does or does not go.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// --- renewals ----------------------------------------------------------------

/**
 * How long after its moment the "after expiry" message may still go.
 *
 * A sweep that was down on the day should still send it the next morning; one
 * switched on for the first time must not email everybody whose licence
 * lapsed last year.
 */
export const AFTER_EXPIRY_GRACE_DAYS = 7;

/**
 * Which reminder a licence line is due now, as days relative to expiry
 * (positive before, negative after), or null.
 *
 * Only the most recent one that has come due: a line first seen three days
 * before expiry gets the three-day reminder, not the thirty- and fourteen-day
 * ones in a burst. A reminder whose moment falls before the licence was even
 * delivered (a one-month licence and a thirty-day reminder) is skipped rather
 * than sent on the day the key arrives.
 */
export function dueRenewalOffset(input: {
  expiresAt: Date;
  deliveredAt: Date;
  now: Date;
  daysBefore: number[];
  daysAfter: number;
}): number | null {
  const { expiresAt, deliveredAt, now } = input;
  const expires = expiresAt.getTime();

  if (now.getTime() < expires) {
    const due = [...new Set(input.daysBefore)]
      .filter((days) => days > 0)
      .filter((days) => {
        const at = expires - days * DAY_MS;
        return at >= deliveredAt.getTime() && at <= now.getTime();
      })
      .sort((a, b) => a - b);
    return due[0] ?? null;
  }

  if (input.daysAfter <= 0) return null;
  const at = expires + input.daysAfter * DAY_MS;
  if (now.getTime() >= at && now.getTime() < at + AFTER_EXPIRY_GRACE_DAYS * DAY_MS) {
    return -input.daysAfter;
  }
  return null;
}

// --- cart recovery -------------------------------------------------------------

/**
 * The stage each rung of the ladder leaves a cart in, by position.
 *
 * The enum was named for the default ladder (1h, 24h, 72h) and the settings let
 * the hours change, so the stage records the rung, not the hour: the first
 * email leaves NUDGE_1H whatever its delay. A fourth rung is OFFER_SENT.
 * MANAGER_QUEUE is not on the ladder: a cart there is a person's to handle,
 * and the sweep leaves it alone.
 */
export const LADDER_STAGES = [
  CartStage.NUDGE_1H,
  CartStage.REMINDER_24H,
  CartStage.URGENCY_72H,
  CartStage.OFFER_SENT,
] as const;

/** Which rung a cart has reached: -1 for none yet, null for off the ladder. */
export function ladderPosition(stage: CartStage): number | null {
  if (stage === CartStage.ACTIVE) return -1;
  const index = (LADDER_STAGES as readonly CartStage[]).indexOf(stage);
  return index >= 0 ? index : null;
}

/**
 * How stale a rung may be and still be sent.
 *
 * A cart whose next email came due two days ago — the sweep was down, or the
 * feature was only just switched on over a month of old carts — is not
 * "abandoned an hour ago" any more, and writing to it as if it were is how a
 * store looks automated.
 */
export const STALE_STEP_HOURS = 48;

/**
 * The next rung to send, or null.
 *
 * Steps are ordered by delay first, whatever order they were saved in. If more
 * than one rung has come due, only the latest goes; the earlier ones are
 * passed over rather than sent in a burst.
 */
export function nextCartStep(input: {
  position: number;
  idleHours: number;
  steps: { afterHours: number }[];
}): number | null {
  for (let index = input.steps.length - 1; index > input.position; index -= 1) {
    const step = input.steps[index];
    if (!step) continue;
    if (input.idleHours >= step.afterHours) {
      return input.idleHours - step.afterHours <= STALE_STEP_HOURS ? index : null;
    }
  }
  return null;
}

/** The ladder in delay order, with the stage each rung maps to. */
export function orderedSteps<T extends { afterHours: number }>(steps: T[]): T[] {
  return [...steps].sort((a, b) => a.afterHours - b.afterHours).slice(0, LADDER_STAGES.length);
}

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / HOUR_MS;
}

// --- holdout -----------------------------------------------------------------

/**
 * Whether an id falls in the held-out share.
 *
 * Deterministic — a hash, not a coin toss — so the same cart or customer lands
 * in the same group on every pass and every replica, and the assignment can be
 * recomputed later to check it. Salted by feature, so being held out of the
 * cart ladder says nothing about being held out of renewal reminders.
 */
export function holdoutBucket(feature: string, id: string): number {
  const digest = crypto.createHash('sha256').update(`${feature}:${id}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export function inHoldout(feature: string, id: string, percent: number): boolean {
  if (percent <= 0) return false;
  return holdoutBucket(feature, id) < percent;
}

// --- time --------------------------------------------------------------------

export function storeTimeZone(): string {
  return process.env.STORE_TIMEZONE ?? 'Asia/Riyadh';
}

/** The hour of day in a timezone, without pulling in a date library. */
export function storeHour(now: Date, timeZone: string = storeTimeZone()): number {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).format(now);
  // en-GB writes midnight as "24" in some engines and "00" in others.
  return Number.parseInt(formatted, 10) % 24;
}

/**
 * Whether an hour falls in the quiet window, which may wrap midnight
 * (23 → 9 is quiet from 23:00 to 08:59). Equal ends mean no quiet hours.
 */
export function inQuietHours(hour: number, fromHour: number, toHour: number): boolean {
  if (fromHour === toHour) return false;
  if (fromHour < toHour) return hour >= fromHour && hour < toHour;
  return hour >= fromHour || hour < toHour;
}

// --- consent -----------------------------------------------------------------

/**
 * Explicit marketing consent, and not withdrawn since.
 *
 * Unsubscribing clears `marketingOptInAt` and stamps `marketingOptOutAt`; a
 * later confirmation sets a new opt-in after it. Both are compared so an old
 * opt-in cannot outlive a newer withdrawal.
 */
export function hasMarketingConsent(
  customer: { marketingOptInAt: Date | null; marketingOptOutAt: Date | null } | null,
): boolean {
  if (!customer?.marketingOptInAt) return false;
  return !customer.marketingOptOutAt || customer.marketingOptOutAt < customer.marketingOptInAt;
}

/** Said "stop" at some point and has not said "yes" again since. */
export function hasOptedOut(
  customer: { marketingOptInAt: Date | null; marketingOptOutAt: Date | null } | null,
): boolean {
  if (!customer?.marketingOptOutAt) return false;
  return !customer.marketingOptInAt || customer.marketingOptInAt < customer.marketingOptOutAt;
}

// --- codes -------------------------------------------------------------------

/**
 * A single-use code: a readable prefix and ten characters from an alphabet
 * without the letters that read as digits, so a customer typing it from a
 * phone screen gets it right. Fits `promotionCodeSchema`.
 */
export function mintCode(prefix: 'RENEW' | 'BACK'): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  let body = '';
  for (const byte of bytes) body += alphabet[byte % alphabet.length];
  return `${prefix}-${body}`;
}
