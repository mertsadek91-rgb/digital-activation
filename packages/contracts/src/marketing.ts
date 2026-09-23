import { z } from 'zod';

/**
 * Marketing settings, one document per feature.
 *
 * Every conversion feature in the store is configured here and switched on
 * here, from the panel, rather than in code. Three rules hold for all of them,
 * because they are what separates marketing from the dark patterns the Gulf's
 * consumer-protection laws and the FTC now prosecute:
 *
 *  - Nothing is invented. Social proof comes from real paid orders, scarcity
 *    from real stock, deadlines from real end dates.
 *  - A price reduction shown in Saudi Arabia needs a Ministry of Commerce
 *    discount licence; the fields for its number sit beside the discount.
 *  - Marketing messages need consent per channel (PDPL). A service message
 *    ("your licence expires in 14 days") and a marketing one ("…and here is
 *    10% off") are different sends with different rules.
 *
 * Each feature starts disabled. Turning one on is a decision somebody makes,
 * not a default somebody forgot to change.
 */

const localized = z.object({
  ar: z.string().trim().max(500).default(''),
  en: z.string().trim().max(500).default(''),
});
export type LocalizedText = z.infer<typeof localized>;

const percent = z.number().min(0).max(90);

/**
 * Held-out share of eligible customers who are deliberately not sent a given
 * automation, so its real lift can be measured at low order volume.
 */
const holdoutPercent = z.number().int().min(0).max(50).default(0);

// --- retention -------------------------------------------------------------

/** Reminders before (and just after) a time-limited licence runs out. */
export const renewalSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Days before expiry each reminder goes out, e.g. [30, 14, 3]. */
  daysBefore: z.array(z.number().int().min(1).max(120)).max(5).default([30, 14, 3]),
  /** One last message this many days after expiry; 0 for none. */
  daysAfter: z.number().int().min(0).max(60).default(7),
  /**
   * Optional renewal discount. Only sent to customers with marketing consent;
   * everyone else gets the plain service reminder.
   */
  discountPercent: percent.default(0),
  discountLicenceNumber: z.string().trim().max(100).default(''),
  holdoutPercent,
});
export type RenewalSettings = z.infer<typeof renewalSettingsSchema>;

/** The abandoned-cart ladder, for carts that captured an email at checkout. */
export const cartRecoverySettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Hours after the last activity each step is sent. Discount on the last only. */
  steps: z
    .array(
      z.object({
        afterHours: z.number().min(0.5).max(240),
        discountPercent: percent.default(0),
      }),
    )
    .max(4)
    .default([
      { afterHours: 1, discountPercent: 0 },
      { afterHours: 24, discountPercent: 0 },
      { afterHours: 72, discountPercent: 10 },
    ]),
  /** A minted recovery code lives this long. */
  codeValidHours: z.number().int().min(1).max(720).default(48),
  discountLicenceNumber: z.string().trim().max(100).default(''),
  /** Don't send between these store-time hours (e.g. 23 → 9). */
  quietFromHour: z.number().int().min(0).max(23).default(23),
  quietToHour: z.number().int().min(0).max(23).default(9),
  holdoutPercent,
});
export type CartRecoverySettings = z.infer<typeof cartRecoverySettingsSchema>;

// --- basket size -----------------------------------------------------------

/**
 * Offers: volume tiers ("3 devices, save 15%") and curated "goes well with"
 * pairs shown after add-to-cart, in the cart and on the order confirmation.
 * Bundles themselves are BUNDLE_DISCOUNT promotions, managed on the promotions
 * screen; this is the rest.
 */
export const offerSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Quantity tiers across the whole cart, e.g. 2 licences → 5%, 3+ → 10%. */
  volumeTiers: z
    .array(z.object({ minItems: z.number().int().min(2).max(100), percent }))
    .max(5)
    .default([]),
  volumeLicenceNumber: z.string().trim().max(100).default(''),
  /** "Goes well with": for a product, up to four suggestions and an optional discount. */
  pairs: z
    .array(
      z.object({
        productId: z.string().min(1),
        suggestProductIds: z.array(z.string().min(1)).max(4),
        discountPercent: percent.default(0),
      }),
    )
    .max(200)
    .default([]),
  /** Where suggestions appear. */
  showAfterAddToCart: z.boolean().default(true),
  showInCart: z.boolean().default(true),
  showOnConfirmation: z.boolean().default(true),
  /** A "spend X more to unlock Y" bar in the cart, tied to the first tier. */
  showProgressBar: z.boolean().default(true),
});
export type OfferSettings = z.infer<typeof offerSettingsSchema>;

// --- trust -----------------------------------------------------------------

export const trustSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  guarantee: localized.default({ ar: '', en: '' }),
  /** Shown for stocked keys; made-to-order keys use their own delivery window. */
  instantDeliveryText: localized.default({ ar: '', en: '' }),
  /** Registration numbers shown in the footer and on checkout. Empty hides. */
  commercialRegistration: z.string().trim().max(100).default(''),
  vatNumber: z.string().trim().max(100).default(''),
  maroofUrl: z.string().trim().url().or(z.literal('')).default(''),
  showOnProduct: z.boolean().default(true),
  showOnCheckout: z.boolean().default(true),
});
export type TrustSettings = z.infer<typeof trustSettingsSchema>;

export const reviewRequestSettingsSchema = z.object({
  /** Days after delivery the first request goes; licences are judged once activated. */
  firstAfterDays: z.number().int().min(1).max(30).default(2),
  secondAfterDays: z.number().int().min(0).max(60).default(9),
});
export type ReviewRequestSettings = z.infer<typeof reviewRequestSettingsSchema>;

/**
 * "Someone in Saudi Arabia bought this 3 hours ago."
 *
 * From real paid orders only, never names, never cities — the country and how
 * long ago. Nothing is shown for a product until it has `minOrders` in the
 * window, so a quiet catalogue shows nothing rather than "1 sold this month".
 */
export const socialProofSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  windowHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(72),
  minOrders: z.number().int().min(1).max(100).default(3),
  showCountry: z.boolean().default(true),
  /** Seconds between two notices on the same page; 0 shows the summary line only. */
  intervalSeconds: z.number().int().min(0).max(600).default(25),
  maxPerPage: z.number().int().min(0).max(10).default(3),
});
export type SocialProofSettings = z.infer<typeof socialProofSettingsSchema>;

// --- growth ----------------------------------------------------------------

/**
 * A scheduled sale. The price comes back when it ends, which is what makes a
 * countdown honest; the licence number is shown with the discount, as the
 * Saudi Ministry of Commerce requires.
 */
export const seasonalSaleSchema = z.object({
  id: z.string().min(1).max(40),
  name: localized,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  percent,
  /** Empty means the whole catalogue. */
  productIds: z.array(z.string()).default([]),
  categoryIds: z.array(z.string()).default([]),
  licenceNumber: z.string().trim().max(100).default(''),
  showCountdown: z.boolean().default(false),
});
export type SeasonalSale = z.infer<typeof seasonalSaleSchema>;

export const seasonalSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  sales: z.array(seasonalSaleSchema).max(50).default([]),
});
export type SeasonalSettings = z.infer<typeof seasonalSettingsSchema>;

export const businessSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Seats at or above which the product page offers a quote. */
  minSeats: z.number().int().min(2).max(1000).default(10),
  notifyEmail: z.string().trim().email().or(z.literal('')).default(''),
});
export type BusinessSettings = z.infer<typeof businessSettingsSchema>;

/** The one-field email capture, with an optional welcome code. */
export const welcomeSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  trigger: z.enum(['exit', 'delay']).default('exit'),
  delaySeconds: z.number().int().min(5).max(300).default(30),
  /** Days before the same visitor may see it again. */
  frequencyDays: z.number().int().min(1).max(365).default(14),
  headline: localized.default({ ar: '', en: '' }),
  /** 0 = capture only, no code. The code is minted single-use on confirmation. */
  discountPercent: percent.default(0),
  discountValidDays: z.number().int().min(1).max(90).default(14),
  discountLicenceNumber: z.string().trim().max(100).default(''),
});
export type WelcomeSettings = z.infer<typeof welcomeSettingsSchema>;

export const referralSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Off the friend's first order. */
  friendPercent: percent.default(10),
  /** Credited to the referrer once the friend's order clears. */
  referrerRewardUsd: z.number().min(0).max(500).default(5),
  /** Days after payment before a referral pays out, past the refund window. */
  clearAfterDays: z.number().int().min(0).max(60).default(14),
  licenceNumber: z.string().trim().max(100).default(''),
});
export type ReferralSettings = z.infer<typeof referralSettingsSchema>;

// --- registry --------------------------------------------------------------

export const MARKETING_SCHEMAS = {
  renewals: renewalSettingsSchema,
  cartRecovery: cartRecoverySettingsSchema,
  offers: offerSettingsSchema,
  trust: trustSettingsSchema,
  reviewRequests: reviewRequestSettingsSchema,
  socialProof: socialProofSettingsSchema,
  seasonal: seasonalSettingsSchema,
  business: businessSettingsSchema,
  welcome: welcomeSettingsSchema,
  referral: referralSettingsSchema,
} as const;

export type MarketingFeature = keyof typeof MARKETING_SCHEMAS;
export const MARKETING_FEATURES = Object.keys(MARKETING_SCHEMAS) as MarketingFeature[];
export const marketingFeatureSchema = z.enum(
  MARKETING_FEATURES as [MarketingFeature, ...MarketingFeature[]],
);

export type MarketingSettings = { [F in MarketingFeature]: z.infer<(typeof MARKETING_SCHEMAS)[F]> };

/** The `Setting.key` a feature is stored under. */
export const marketingSettingKey = (feature: MarketingFeature): string => `marketing.${feature}`;

/**
 * What the storefront may read without signing in. Only the display parts —
 * never holdout shares, notify addresses or anything a competitor would like.
 */
export const publicMarketingSchema = z.object({
  trust: trustSettingsSchema
    .pick({
      enabled: true,
      guarantee: true,
      instantDeliveryText: true,
      commercialRegistration: true,
      vatNumber: true,
      maroofUrl: true,
      showOnProduct: true,
      showOnCheckout: true,
    })
    .nullable(),
  offers: offerSettingsSchema
    .pick({
      volumeTiers: true,
      volumeLicenceNumber: true,
      showAfterAddToCart: true,
      showInCart: true,
      showOnConfirmation: true,
      showProgressBar: true,
    })
    .nullable(),
  socialProof: socialProofSettingsSchema
    .pick({ intervalSeconds: true, maxPerPage: true, showCountry: true })
    .nullable(),
  welcome: welcomeSettingsSchema
    .pick({
      trigger: true,
      delaySeconds: true,
      frequencyDays: true,
      headline: true,
      discountPercent: true,
    })
    .nullable(),
  business: businessSettingsSchema.pick({ minSeats: true }).nullable(),
  referral: referralSettingsSchema.pick({ friendPercent: true }).nullable(),
  /** Sales running now, with their end date for an honest countdown. */
  activeSales: z.array(
    seasonalSaleSchema.pick({
      id: true,
      name: true,
      endsAt: true,
      percent: true,
      productIds: true,
      categoryIds: true,
      licenceNumber: true,
      showCountdown: true,
    }),
  ),
});
export type PublicMarketing = z.infer<typeof publicMarketingSchema>;
