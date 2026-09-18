import type { AdminDashboard } from '@da/contracts';

/**
 * How an order's status is written and coloured on this page.
 *
 * Its own module so the two lookups stay together and so the page file is a
 * page: both are read by the orders table on the front screen, and neither is
 * a component.
 */

type OrderStatus = AdminDashboard['recentOrders'][number]['status'];

/**
 * Spelled out rather than built from the status name.
 *
 * `t(\`status${status}\`)` would compile to a string the dictionary cannot be
 * checked against, which is the one thing this message layer exists to
 * prevent: a status added to the contract would then render its own enum name
 * in front of somebody instead of failing the build.
 */
export const STATUS_LABEL = {
  PENDING_PAYMENT: 'statusPENDING_PAYMENT',
  PAYMENT_REVIEW: 'statusPAYMENT_REVIEW',
  PAID: 'statusPAID',
  FULFILLING: 'statusFULFILLING',
  FULFILLED: 'statusFULFILLED',
  COMPLETED: 'statusCOMPLETED',
  CANCELLED: 'statusCANCELLED',
  REFUNDED: 'statusREFUNDED',
  PARTIALLY_REFUNDED: 'statusPARTIALLY_REFUNDED',
  FAILED: 'statusFAILED',
} as const satisfies Record<OrderStatus, string>;

export const STATUS_PILL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'pill-draft',
  PAYMENT_REVIEW: 'pill-blocked',
  PAID: 'pill-published',
  FULFILLING: 'pill-draft',
  FULFILLED: 'pill-published',
  COMPLETED: 'pill-published',
  CANCELLED: 'pill-draft',
  REFUNDED: 'pill-blocked',
  PARTIALLY_REFUNDED: 'pill-blocked',
  FAILED: 'pill-blocked',
};
