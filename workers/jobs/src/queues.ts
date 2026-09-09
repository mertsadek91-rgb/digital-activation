/**
 * Queue names and their contracts.
 *
 * Declared as data so the API (which enqueues) and the worker (which consumes)
 * cannot disagree about a queue name or a payload shape.
 */
import { z } from 'zod';

export const QUEUES = {
  /** Assign a vault key to a paid order item and send it. The SLA is 60s. */
  keyDelivery: 'key-delivery',
  /** Transactional mail: order confirmation, key delivery, password reset. */
  transactionalMail: 'transactional-mail',
  /** Marketing mail and push, on a separate queue so a blast cannot delay a key. */
  marketing: 'marketing',
  /** Walks carts up the recovery ladder: 1h, 24h, 72h, day 7, day 14. */
  cartRecovery: 'cart-recovery',
  /** Review invitations on day 3 and day 10 after delivery. */
  reviewInvite: 'review-invite',
  /** Back-in-stock, price-drop and renewal notifications. */
  stockAlerts: 'stock-alerts',
  /** Daily FX refresh. Display prices depend on it; the base price does not. */
  fxRates: 'fx-rates',
  /** Regenerate sitemaps after a publish. */
  sitemap: 'sitemap',
  /** Release expired stock reservations. */
  reservationSweep: 'reservation-sweep',
  /** Refresh product salesCount / ratingAvg and segment counts. */
  aggregates: 'aggregates',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const keyDeliveryJobSchema = z.object({
  orderId: z.string(),
  orderItemId: z.string(),
  /** Retry attempt; after the cap the item moves to the manual queue with an alert. */
  attempt: z.number().int().min(0).default(0),
});

export const cartRecoveryJobSchema = z.object({
  cartId: z.string(),
  stage: z.enum(['NUDGE_1H', 'REMINDER_24H', 'URGENCY_72H', 'MANAGER_QUEUE', 'CLOSED']),
});

export const transactionalMailJobSchema = z.object({
  template: z.string(),
  to: z.string().email(),
  locale: z.enum(['ar', 'en']),
  /**
   * Template variables. A licence key is never passed here — the mail worker
   * fetches it from the vault at send time and it is never written to Redis,
   * where a queue payload would otherwise sit in plaintext.
   */
  vars: z.record(z.string(), z.unknown()).default({}),
  /** Set for key-delivery mail; the worker resolves the key itself. */
  orderItemId: z.string().optional(),
});

export type KeyDeliveryJob = z.infer<typeof keyDeliveryJobSchema>;
export type CartRecoveryJob = z.infer<typeof cartRecoveryJobSchema>;
export type TransactionalMailJob = z.infer<typeof transactionalMailJobSchema>;
