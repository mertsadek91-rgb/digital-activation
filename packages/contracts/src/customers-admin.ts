import { z } from 'zod';

import { adminOrderRowSchema } from './admin.js';
import { localeSchema, moneySchema } from './primitives.js';

/**
 * Customers, for the panel.
 *
 * Money here is what the customer has actually paid for: orders that reached
 * PAID or beyond and were not refunded in full, in USD. A customer row's own
 * `totalSpentUsd` aggregate is not used — nothing keeps it current, and a
 * lifetime value that silently reads zero is worse than one computed live.
 */

/**
 * Marketing consent, as one state.
 *
 * OPTED_IN only when the latest recorded choice is a yes: a customer who opted
 * in and later out is OPTED_OUT, whatever order the timestamps were written in.
 * NONE is the default — never asked, or asked and never answered — and is not
 * consent. Transactional mail does not depend on any of this.
 */
export const marketingConsentStateSchema = z.enum(['OPTED_IN', 'OPTED_OUT', 'NONE']);
export type MarketingConsentState = z.infer<typeof marketingConsentStateSchema>;

export const adminCustomerRowSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  /** Orders that were paid, including those later partly refunded. */
  paidOrders: z.number().int().min(0),
  totalSpentUsd: moneySchema,
  /** The newest order of any status: a draft is still a visit. */
  lastOrderAt: z.string().nullable(),
  marketingEmail: marketingConsentStateSchema,
  createdAt: z.string(),
});
export type AdminCustomerRow = z.infer<typeof adminCustomerRowSchema>;

export const adminCustomerListSchema = z.object({
  rows: z.array(adminCustomerRowSchema),
  /** 1-based, with one-more-than-a-page paging like the orders list. */
  page: z.number().int().min(1),
  hasMore: z.boolean(),
});
export type AdminCustomerList = z.infer<typeof adminCustomerListSchema>;

export const adminCustomerDetailSchema = adminCustomerRowSchema.extend({
  phone: z.string().nullable(),
  company: z.string().nullable(),
  locale: localeSchema,
  emailVerifiedAt: z.string().nullable(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'BLOCKED']),
  consent: z.object({
    marketingOptInAt: z.string().nullable(),
    marketingOptOutAt: z.string().nullable(),
  }),
  /** The customer's own referral code, when they have opened the page. */
  referralCode: z.string().nullable(),
  /**
   * Licence keys bound to their order lines. A count of vault ids — the
   * panel never needs, and this never carries, a key itself.
   */
  licenceCount: z.number().int().min(0),
  orders: z.array(
    z.object({
      number: z.string(),
      status: adminOrderRowSchema.shape.status,
      currency: z.string(),
      totalUsd: moneySchema,
      placedAt: z.string(),
    }),
  ),
});
export type AdminCustomerDetail = z.infer<typeof adminCustomerDetailSchema>;
