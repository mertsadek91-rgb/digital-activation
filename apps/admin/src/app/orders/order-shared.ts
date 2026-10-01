import type { AdminOrderEvent, AdminOrderRow, FpRefundStatus } from '@da/contracts';

/**
 * What the list and the order page say about the same states.
 *
 * Spelled out rather than built from the status name, so a status added to
 * the contract fails the build instead of rendering its own enum name in
 * front of somebody. Shared so the pill on the row and the pill on the page
 * cannot disagree.
 */
export const STATUS_KEYS = {
  PENDING_PAYMENT: 'statusPendingPayment',
  PAYMENT_REVIEW: 'statusPaymentReview',
  PAID: 'statusPaid',
  FULFILLING: 'statusFulfilling',
  FULFILLED: 'statusFulfilled',
  COMPLETED: 'statusCompleted',
  CANCELLED: 'statusCancelled',
  REFUNDED: 'statusRefunded',
  PARTIALLY_REFUNDED: 'statusPartiallyRefunded',
  FAILED: 'statusFailed',
} as const satisfies Record<AdminOrderRow['status'], string>;

export const ACTOR_KEYS = {
  SYSTEM: 'actorSystem',
  STAFF: 'actorStaff',
  PROVIDER: 'actorProvider',
} as const satisfies Record<AdminOrderEvent['actorType'], string>;

export const FP_REFUND_KEYS = {
  PENDING: 'fpRefundPENDING',
  SUCCEEDED: 'fpRefundSUCCEEDED',
  FAILED: 'fpRefundFAILED',
} as const satisfies Record<FpRefundStatus, string>;

export const FP_STATE_KEYS = {
  REQUIRES_ACTION: 'fpStateREQUIRES_ACTION',
  PROCESSING: 'fpStatePROCESSING',
  SUCCEEDED: 'fpStateSUCCEEDED',
  FAILED: 'fpStateFAILED',
  CANCELLED: 'fpStateCANCELLED',
  REFUNDED: 'fpStateREFUNDED',
} as const;

export const FP_REFUND_PILLS = {
  PENDING: 'pill-draft',
  SUCCEEDED: 'pill-published',
  FAILED: 'pill-blocked',
} as const satisfies Record<FpRefundStatus, string>;

/** The same shape the API accepts for a refund amount: USD, two decimals at most. */
export const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * A decimal USD string as whole cents. A third decimal (the money type allows
 * one) is dropped, which only ever lowers the cap it is compared against.
 */
export function toCents(value: string): number {
  const [whole = '0', fraction = ''] = value.replace(/^-/, '').split('.');
  return Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
}

export function statusPill(status: AdminOrderRow['status']): string {
  switch (status) {
    case 'PENDING_PAYMENT':
      return 'pill-draft';
    case 'PAYMENT_REVIEW':
      return 'pill-warning';
    case 'PAID':
    case 'FULFILLING':
      return 'pill-info';
    case 'FULFILLED':
    case 'COMPLETED':
      return 'pill-published';
    default:
      return 'pill-blocked';
  }
}

/** `2026-10-01 14:05` from an ISO stamp — the panel's compact form. */
export function stamp(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '—';
}

/** Two letters for an avatar, from a name or, failing that, an address. */
export function initialsOf(name: string | null, email: string): string {
  const source = (name ?? '').trim() || email.split('@')[0] || '?';
  const words = source.split(/[\s._-]+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase();
}
