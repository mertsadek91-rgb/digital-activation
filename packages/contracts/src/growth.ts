import { z } from 'zod';

import { emailSchema } from './primitives.js';

/**
 * Growth features: business quotes, the welcome capture, and referrals.
 *
 * Their settings live in `marketing.ts` with every other marketing feature;
 * this file holds what the storefront sends and what the panel reads back.
 */

// --- business quotes -------------------------------------------------------

/**
 * A volume quote request from the product page.
 *
 * Only the product slug is sent. The name that reaches the inbox is looked up
 * from it, so the form cannot put words in the store's mouth.
 */
export const businessQuoteSchema = z.object({
  company: z.string().trim().min(2).max(160),
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  phone: z.string().trim().max(40).optional(),
  vatNumber: z.string().trim().max(40).optional(),
  productSlug: z.string().trim().max(200).optional(),
  seats: z.number().int().min(1).max(100_000),
  message: z.string().trim().max(3000).optional(),
  locale: z.enum(['ar', 'en']).default('ar'),
  /** Honeypot, as on the contact form: filled in only by bots. */
  website: z.string().max(200).optional(),
});
export type BusinessQuote = z.infer<typeof businessQuoteSchema>;

export const businessQuoteRowSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  status: z.enum(['NEW', 'HANDLED']),
  /** The first line of the structured body, "Company · N seats · product". */
  summary: z.string(),
  createdAt: z.string(),
});
export type BusinessQuoteRow = z.infer<typeof businessQuoteRowSchema>;

export const businessQuoteListSchema = z.object({
  rows: z.array(businessQuoteRowSchema),
  waiting: z.number().int(),
  last30Days: z.number().int(),
});
export type BusinessQuoteList = z.infer<typeof businessQuoteListSchema>;

// --- welcome capture -------------------------------------------------------

export const welcomeStatsSchema = z.object({
  /** Confirmation emails sent from the window. */
  captures: z.number().int(),
  /** Of those addresses, how many followed the link. */
  confirmations: z.number().int(),
  codesIssued: z.number().int(),
  codesRedeemed: z.number().int(),
  /** Since when the numbers count. */
  sinceDays: z.number().int(),
});
export type WelcomeStats = z.infer<typeof welcomeStatsSchema>;

// --- referrals -------------------------------------------------------------

export const referralCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,16}$/);

/** A visitor followed a referral link. */
export const referralVisitSchema = z.object({ code: referralCodeSchema });
export type ReferralVisit = z.infer<typeof referralVisitSchema>;

/** What a signed-in customer sees about their own link. */
export const myReferralSchema = z.object({
  enabled: z.boolean(),
  code: z.string().nullable(),
  friendPercent: z.number(),
  referrerRewardUsd: z.number(),
  clearAfterDays: z.number().int(),
  licenceNumber: z.string(),
  /** Counts only — never the friends' addresses. */
  pending: z.number().int(),
  rewarded: z.number().int(),
});
export type MyReferral = z.infer<typeof myReferralSchema>;

export const referralStatusSchema = z.enum(['ISSUED', 'PENDING', 'REWARDED', 'VOID']);

export const adminReferralRowSchema = z.object({
  id: z.string(),
  status: referralStatusSchema,
  referrerEmail: z.string(),
  code: z.string(),
  friendEmail: z.string().nullable(),
  orderNumber: z.string().nullable(),
  orderStatus: z.string().nullable(),
  friendDiscountUsd: z.string().nullable(),
  rewardUsd: z.string().nullable(),
  paidAt: z.string().nullable(),
  rewardedAt: z.string().nullable(),
  voidReason: z.string().nullable(),
  flags: z.array(z.string()),
  createdAt: z.string(),
});
export type AdminReferralRow = z.infer<typeof adminReferralRowSchema>;

export const adminReferralListSchema = z.object({
  rows: z.array(adminReferralRowSchema),
  totals: z.object({
    referrers: z.number().int(),
    issued: z.number().int(),
    pending: z.number().int(),
    rewarded: z.number().int(),
    void: z.number().int(),
    flagged: z.number().int(),
    friendDiscountUsd: z.string(),
    rewardUsd: z.string(),
  }),
});
export type AdminReferralList = z.infer<typeof adminReferralListSchema>;
