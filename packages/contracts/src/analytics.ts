import { z } from 'zod';

import { localeSchema } from './primitives.js';

/**
 * First-party analytics (TASK-0096): the browsing half of the funnel.
 *
 * The storefront's server reports these to the API; no script runs in the
 * browser and no cookie is set. Checkout, payment and delivery are not events
 * here — they are already rows in their own tables.
 */
export const ANALYTICS_EVENT_TYPES = [
  'PRODUCT_VIEW',
  'CATEGORY_VIEW',
  'WHATSAPP_CLICK',
  'CART_VIEW',
] as const;
export const analyticsEventTypeSchema = z.enum(ANALYTICS_EVENT_TYPES);
export type AnalyticsEventType = z.infer<typeof analyticsEventTypeSchema>;

/** Where on the page a WhatsApp link sat (tracking plan §4, event 5). */
export const WHATSAPP_PLACEMENTS = [
  'fab',
  'header',
  'product_question',
  'product_back_in_stock',
  'contact',
  'footer',
] as const;
export const whatsappPlacementSchema = z.enum(WHATSAPP_PLACEMENTS);
export type WhatsappPlacement = z.infer<typeof whatsappPlacementSchema>;

/** The characters a UTM value may hold. Anything else is dropped, not stored. */
// 50 is long enough for any campaign label and too short for most tokens.
const UTM_VALUE = /^[A-Za-z0-9._~+\- ]{1,50}$/;

/**
 * A UTM parameter as it may be stored, or undefined.
 *
 * Allow-listed rather than escaped: a campaign tag is a short label, and a
 * value that is not one (an email address pasted into `utm_source`, a token)
 * is exactly what must not land in the table.
 */
export function cleanUtm(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!UTM_VALUE.test(trimmed) || trimmed.includes('@')) return undefined;
  return trimmed.toLowerCase();
}

const utmSchema = z.string().regex(UTM_VALUE).optional();
const slugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\s/?#]+$/);

/**
 * `POST /v1/analytics/events`, from the storefront's server only.
 *
 * `path` is a storefront path with no query string or fragment (both can carry
 * tokens). `referrer` may be a full URL; the API keeps only its host.
 * Products and categories go by slug, which is what the storefront has; the
 * API resolves them to ids.
 */
export const recordAnalyticsEventSchema = z
  .object({
    type: analyticsEventTypeSchema,
    path: z
      .string()
      .min(1)
      .max(512)
      .regex(/^\/[^?#\s]*$/, 'a path without query string or fragment'),
    locale: localeSchema,
    productSlug: slugSchema.optional(),
    categorySlug: slugSchema.optional(),
    placement: whatsappPlacementSchema.optional(),
    referrer: z.string().max(2048).optional(),
    utmSource: utmSchema,
    utmMedium: utmSchema,
    utmCampaign: utmSchema,
  })
  .strict();
export type RecordAnalyticsEvent = z.infer<typeof recordAnalyticsEventSchema>;

/** `GET /v1/admin/analytics/summary`: counts per type and UTC day, last 30 days. */
export const analyticsSummarySchema = z.object({
  since: z.string(),
  days: z.array(
    z.object({
      day: z.string(),
      type: analyticsEventTypeSchema,
      events: z.number().int(),
      visitors: z.number().int(),
    }),
  ),
});
export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;
