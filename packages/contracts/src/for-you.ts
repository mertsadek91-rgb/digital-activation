import { z } from 'zod';

import { catalogCardSchema } from './catalog.js';

/**
 * What to suggest to a customer who has bought before.
 *
 * Two kinds of suggestion, and the split is the whole design. The shop already
 * had a cross-sell — it reads the cart, offers a bundle, and knows nothing
 * about the person. This reads what they own.
 *
 * A renewal is not a guess. A one-year Office licence delivered on a known
 * date runs out on a known date, and the customer will need another one
 * whether or not anybody suggests it. Everything else here is inference; this
 * is arithmetic, so it is separated, dated, and put first.
 */

export const renewalSchema = z.object({
  /** The product to buy again — usually the same one. */
  product: catalogCardSchema,
  /** The order line this renewal came from, so the page can say "your …". */
  orderNumber: z.string(),
  /** When the licence was delivered. */
  startedAt: z.string(),
  /** When the term runs out. Past means it already has. */
  expiresAt: z.string(),
  /** Negative once it has lapsed, which the page says plainly. */
  daysLeft: z.number().int(),
  /** `3 months`, `1 year` — the term as it was sold, for the sentence. */
  termLabel: z.string(),
});
export type Renewal = z.infer<typeof renewalSchema>;

/** Why a product is being suggested. Shown, because an unexplained shelf is an ad. */
export const forYouReasonSchema = z.enum(['sameBrand', 'sameCategory', 'relatedToOwned']);
export type ForYouReason = z.infer<typeof forYouReasonSchema>;

export const forYouItemSchema = z.object({
  product: catalogCardSchema,
  reason: forYouReasonSchema,
  /** The brand or section the reason refers to, named in the sentence. */
  becauseOf: z.string(),
});
export type ForYouItem = z.infer<typeof forYouItemSchema>;

export const forYouSchema = z.object({
  /**
   * How many delivered lines this is built from.
   *
   * Zero means the page has nothing personal to say, and says so rather than
   * filling itself with the best-sellers and calling them chosen.
   */
  purchases: z.number().int().min(0),
  renewals: z.array(renewalSchema),
  suggestions: z.array(forYouItemSchema),
});
export type ForYou = z.infer<typeof forYouSchema>;
