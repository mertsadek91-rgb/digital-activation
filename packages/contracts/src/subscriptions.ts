import { z } from 'zod';

import { emailSchema } from './primitives.js';

/** "Tell me when this is back." One variant, one address, one email. */
export const stockAlertSchema = z.object({
  email: emailSchema,
  variantId: z.string().min(1).max(64),
  locale: z.enum(['ar', 'en']).default('ar'),
});
export type StockAlertRequest = z.infer<typeof stockAlertSchema>;

/** The footer box. Sends a confirmation; subscribes nobody by itself. */
export const newsletterSubscribeSchema = z.object({
  email: emailSchema,
  locale: z.enum(['ar', 'en']).default('ar'),
  /**
   * Where the address was typed. The welcome window's confirmation is the one
   * that may mint a code, so it signs a different token.
   */
  source: z.enum(['footer', 'welcome']).default('footer'),
});
export type NewsletterSubscribe = z.infer<typeof newsletterSubscribeSchema>;

/** The signed token from the confirmation or unsubscribe link. */
export const newsletterTokenSchema = z.object({
  token: z.string().min(10).max(1000),
});
export type NewsletterToken = z.infer<typeof newsletterTokenSchema>;

/** Confirming from the emailed link; the locale is the page it was opened on. */
export const newsletterConfirmSchema = newsletterTokenSchema.extend({
  locale: z.enum(['ar', 'en']).default('ar'),
});
export type NewsletterConfirm = z.infer<typeof newsletterConfirmSchema>;
