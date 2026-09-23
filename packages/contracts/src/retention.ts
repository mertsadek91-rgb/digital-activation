import { z } from 'zod';

import { cartSchema } from './cart.js';

/**
 * Renewal reminders and abandoned-cart recovery: the shapes that cross the
 * wire. Their settings live with every other feature's in `marketing.ts`.
 */

/** The storefront hands back the signed link from a recovery email. */
export const cartRestoreSchema = z.object({
  token: z.string().min(10).max(400),
});
export type CartRestore = z.infer<typeof cartRestoreSchema>;

/**
 * The cart the browser now holds. `restored` is false when the link was
 * expired, forged or for a cart already paid for — the visitor then keeps the
 * cart they had, and the page says why.
 */
export const cartRestoreResultSchema = z.object({
  restored: z.boolean(),
  cart: cartSchema,
});
export type CartRestoreResult = z.infer<typeof cartRestoreResultSchema>;

/**
 * Treated against held out, for one automation.
 *
 * `converted` counts the ones that bought afterwards. Both groups are real
 * counts; a rate is left to the screen, which can say "too few to tell" when
 * the groups are small instead of printing a percentage of three.
 */
export const liftSchema = z.object({
  treated: z.number().int(),
  treatedConverted: z.number().int(),
  heldOut: z.number().int(),
  heldOutConverted: z.number().int(),
});
export type Lift = z.infer<typeof liftSchema>;

export const renewalStatsSchema = z.object({
  windowDays: z.number().int(),
  /** Sent per reminder offset; negative offsets are after expiry. */
  sentByOffset: z.array(
    z.object({ offsetDays: z.number().int(), sent: z.number().int(), failed: z.number().int() }),
  ),
  withCode: z.number().int(),
  /** Paid orders for the same product after a reminder. */
  renewedOrders: z.number().int(),
  renewedRevenueUsd: z.string(),
  lift: liftSchema,
});
export type RenewalStats = z.infer<typeof renewalStatsSchema>;

export const cartRecoveryStatsSchema = z.object({
  windowDays: z.number().int(),
  /** Per ladder stage, in ladder order. */
  sentByStage: z.array(
    z.object({
      stage: z.string(),
      sent: z.number().int(),
      heldOut: z.number().int(),
      clicked: z.number().int(),
      withCode: z.number().int(),
    }),
  ),
  recoveredOrders: z.number().int(),
  recoveredRevenueUsd: z.string(),
  lift: liftSchema,
});
export type CartRecoveryStats = z.infer<typeof cartRecoveryStatsSchema>;
