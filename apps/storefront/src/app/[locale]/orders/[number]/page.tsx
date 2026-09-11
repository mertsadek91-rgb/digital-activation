'use client';

import type { Order } from '@da/contracts';
import { ROUTES } from '@da/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { cartApi, CartError } from '../../../../lib/cart-client';
import { formatPrice } from '../../../../lib/format';

/**
 * Order confirmation.
 *
 * Readable only by the cart that placed it — the API checks that, because order
 * numbers are sequential and DA-2026-00001 tells a guesser DA-2026-00002
 * exists. A stranger counting upwards gets the same answer as for an order that
 * does not exist.
 *
 * What it says about fulfilment is deliberately plain. Most of this catalog is
 * ordered from a supplier after payment, so a line sitting in the manual queue
 * is the normal, expected state and not a problem — and telling the customer
 * that, with the window, is what stops them writing in to ask.
 */
const STATE_AR: Record<string, string> = {
  PENDING: 'في الانتظار',
  AUTO_ASSIGNED: 'تم تخصيص المفتاح',
  MANUAL_QUEUE: 'قيد الطلب من المورّد',
  DELIVERED: 'تم التسليم',
  FAILED: 'تعذّر — فريقنا يتابعه',
};

const STATE_EN: Record<string, string> = {
  PENDING: 'Pending',
  AUTO_ASSIGNED: 'Key assigned',
  MANUAL_QUEUE: 'Being ordered from the supplier',
  DELIVERED: 'Delivered',
  FAILED: 'Failed — our team is on it',
};

const STATUS_AR: Record<string, string> = {
  PENDING_PAYMENT: 'في انتظار الدفع',
  PAYMENT_REVIEW: 'قيد المراجعة',
  PAID: 'مدفوع',
  FULFILLING: 'قيد التجهيز',
  FULFILLED: 'تم التجهيز',
  COMPLETED: 'مكتمل',
  CANCELLED: 'ملغى',
  REFUNDED: 'مُسترَد',
  PARTIALLY_REFUNDED: 'مُسترَد جزئياً',
  FAILED: 'فشل',
};

export default function OrderPage() {
  const params = useParams<{ locale: string; number: string }>();
  const locale = params.locale ?? 'ar';
  const number = params.number ?? '';
  const ar = locale === 'ar';
  const prefix = ar ? '' : `/${locale}`;

  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOrder(await cartApi.order(number, { locale }));
    } catch (caught) {
      setError(
        caught instanceof CartError
          ? caught.message
          : ar
            ? 'تعذّر تحميل الطلب.'
            : 'Could not load the order.',
      );
    }
  }, [number, locale, ar]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!order) {
    return (
      <main className="shell">
        <h1>{ar ? 'طلبك' : 'Your order'}</h1>
        <p className="notice">{error ?? '…'}</p>
        <Link href={`${prefix}${ROUTES.store}`} className="btn btn-ghost">
          {ar ? 'المتجر' : 'The store'}
        </Link>
      </main>
    );
  }

  const waiting = order.status === 'PENDING_PAYMENT';
  const states = ar ? STATE_AR : STATE_EN;

  return (
    <main className="shell order-page">
      <h1>
        {ar ? 'طلب ' : 'Order '}
        <span dir="ltr">{order.number}</span>
      </h1>

      <p className={`pill ${waiting ? 'pill-draft' : 'pill-published'}`}>
        {ar ? (STATUS_AR[order.status] ?? order.status) : order.status.replace(/_/g, ' ')}
      </p>

      {waiting ? (
        <p className="notice notice-warn">
          {ar
            ? 'لم يصل الدفع بعد. سيبدأ تجهيز طلبك بعد تأكيد الدفع.'
            : 'Payment has not arrived yet. Your order starts once it does.'}
        </p>
      ) : null}

      <dl className="order-meta">
        <div>
          <dt>{ar ? 'البريد' : 'Email'}</dt>
          <dd dir="ltr">{order.email}</dd>
        </div>
        {order.activationEmail ? (
          <div>
            <dt>{ar ? 'بريد التفعيل' : 'Activation email'}</dt>
            <dd dir="ltr">{order.activationEmail}</dd>
          </div>
        ) : null}
        <div>
          <dt>{ar ? 'التاريخ' : 'Placed'}</dt>
          <dd dir="ltr">{new Date(order.placedAt).toISOString().slice(0, 16).replace('T', ' ')}</dd>
        </div>
      </dl>

      <ul className="order-lines">
        {order.lines.map((line) => (
          <li key={line.sku}>
            <div>
              <p className="order-line-name">{line.productName}</p>
              <p className="order-line-spec" dir="ltr">
                {line.sku} × {line.qty}
              </p>
              <p className="order-line-state">{states[line.fulfillmentState]}</p>
            </div>
            <p className="order-line-total">{formatPrice(line.lineTotal)}</p>
          </li>
        ))}
      </ul>

      <dl className="totals">
        <div>
          <dt>{ar ? 'المجموع' : 'Subtotal'}</dt>
          <dd>{formatPrice(order.subtotal)}</dd>
        </div>
        {Number(order.discount.amount) > 0 ? (
          <div className="totals-discount">
            <dt>{order.couponCode ?? (ar ? 'خصم' : 'Discount')}</dt>
            <dd>−{formatPrice(order.discount)}</dd>
          </div>
        ) : null}
        <div className="totals-total">
          <dt>{ar ? 'الإجمالي' : 'Total'}</dt>
          <dd>{formatPrice(order.total)}</dd>
        </div>
      </dl>

      <p className="lede">
        {ar
          ? 'سيصلك المفتاح على بريدك، وستجده أيضاً في حسابك. معظم منتجاتنا تُطلَب من المورّد بعد الدفع، حتى لا تبدأ مدّة ترخيصك قبل أن تستخدمه.'
          : 'Your key arrives by email and stays in your account. Most of our products are ordered from the supplier after payment, so your licence term does not start before you use it.'}
      </p>
    </main>
  );
}
