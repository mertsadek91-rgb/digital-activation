'use client';

import type { Order } from '@da/contracts';
import { ROUTES } from '@da/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cartApi, CartError } from '../../../../lib/cart-client';
import { formatLineState, formatOrderStatus, formatPrice } from '../../../../lib/format';

/** Ask again every 4s, 15 times: about a minute of "confirming". */
const POLL_EVERY_MS = 4000;
const POLL_LIMIT = 15;

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
export default function OrderPage() {
  const params = useParams<{ locale: string; number: string }>();
  const locale = params.locale ?? 'ar';
  const number = params.number ?? '';
  const tf = useTranslations('format');
  const ar = locale === 'ar';
  const prefix = ar ? '' : `/${locale}`;

  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      // The key from an emailed link, if this page was opened from one.
      const key = new URLSearchParams(window.location.search).get('key');
      setOrder(await cartApi.order(number, { locale, key }));
    } catch (caught) {
      if (caught instanceof CartError && caught.status === 404) setNotFound(true);
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

  /**
   * Right after a card payment, the order is usually still PENDING_PAYMENT:
   * Stripe has taken the money, and the webhook that marks the order paid
   * lands a few seconds later. This page used to say "payment has not arrived
   * yet" at exactly the moment the customer had just paid — the one sentence
   * guaranteed to produce a second attempt or a support message.
   *
   * So when the checkout sends the shopper here after a card payment
   * (`?paid=card`, which also survives Stripe's own redirect back), the page
   * says it is confirming and asks again every few seconds, for about a
   * minute. After that it falls back to the plain statement, because a
   * webhook that has not arrived in a minute is worth knowing about.
   */
  const [confirming, setConfirming] = useState(false);
  const polls = useRef(0);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('paid') === 'card' && query.get('redirect_status') !== 'failed') {
      setConfirming(true);
    }
  }, []);

  const pending = order?.status === 'PENDING_PAYMENT';

  useEffect(() => {
    if (!confirming || !pending) return;
    const timer = window.setInterval(() => {
      polls.current += 1;
      if (polls.current > POLL_LIMIT) {
        setConfirming(false);
        return;
      }
      void load();
    }, POLL_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [confirming, pending, load]);

  if (!order) {
    return (
      <main className="shell">
        <h1>{ar ? 'طلبك' : 'Your order'}</h1>
        <p className="notice" role={error ? 'alert' : undefined}>
          {error ?? '…'}
        </p>
        {notFound ? (
          // Most often not a missing order but a different device: the page
          // opens for the browser that placed it, a signed-in customer, or
          // the link in the order email. Say which door is open.
          <p className="meta">
            {ar
              ? 'إن كان هذا طلبك، افتحه من الرابط في بريد الطلب، أو سجّل الدخول إلى حسابك بالبريد الذي طلبت به.'
              : 'If this is your order, open it from the link in your order email, or sign in to your account with the email you ordered with.'}{' '}
            <Link href={`${prefix}/account`}>{ar ? 'حسابي' : 'My account'}</Link>
          </p>
        ) : null}
        <Link href={`${prefix}${ROUTES.store}`} className="btn btn-ghost">
          {ar ? 'المتجر' : 'The store'}
        </Link>
      </main>
    );
  }

  const waiting = order.status === 'PENDING_PAYMENT';

  return (
    <main className="shell order-page">
      <h1>
        {ar ? 'طلب ' : 'Order '}
        <span dir="ltr">{order.number}</span>
      </h1>

      <p className={`pill ${waiting ? 'pill-draft' : 'pill-published'}`}>
        {formatOrderStatus(order.status, tf)}
      </p>

      {waiting && confirming ? (
        <p className="notice" role="status">
          {ar
            ? 'نؤكّد دفعتك… تستغرق عادةً بضع ثوانٍ، ولا حاجة للدفع مرة أخرى.'
            : 'Confirming your payment… this usually takes a few seconds. There is no need to pay again.'}
        </p>
      ) : waiting ? (
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
              <p className="order-line-state">{formatLineState(line.fulfillmentState, tf)}</p>

              {/* What will land in the inbox, said before it lands. A customer
                  expecting a key who receives a username and a password reads
                  it as the wrong email. */}
              <p className="order-line-kind">
                {line.credentialKind === 'ACCOUNT_CREDENTIALS'
                  ? ar
                    ? 'يُسلَّم كاسم مستخدم وكلمة مرور على بريدك'
                    : 'Delivered as a username and password to your email'
                  : ar
                    ? 'يُسلَّم كمفتاح تفعيل على بريدك'
                    : 'Delivered as an activation key to your email'}
              </p>

              {/* The same steps the licence email carries. Here because the
                  email is read on a phone and the activation happens at a
                  machine — and because an email can be lost. */}
              {line.activationSteps.length > 0 ? (
                <details className="order-line-how">
                  <summary>{ar ? 'طريقة التفعيل' : 'How to activate'}</summary>
                  <ol>
                    {line.activationSteps.map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ol>
                </details>
              ) : null}
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

      {/* What this says has to be true today. It promised the key would also
          be waiting in an account area that does not exist yet, which is the
          kind of sentence that turns a delivered order into a support ticket —
          so it says where the key actually is: the email, and only the email,
          with the activation steps here. */}
      <p className="lede">
        {ar
          ? 'المفتاح يُرسَل إلى بريدك — احفظ تلك الرسالة. خطوات التفعيل موجودة هنا في صفحة طلبك. ومعظم منتجاتنا تُجهَّز بعد الدفع، حتى لا تبدأ مدّة ترخيصك قبل أن تستخدمه.'
          : 'Your key is sent to your email — keep that message. The activation steps stay here on your order page. And most of our products are prepared after payment, so your licence term does not start before you use it.'}
      </p>

      {/* The answer to "I deleted the email", one click away rather than a
          support ticket. */}
      <p className="lede">
        <Link href={`${prefix}${ROUTES.licenses}`} className="btn btn-ghost">
          {ar ? 'افتح تراخيصي' : 'Open my licences'}
        </Link>
      </p>
    </main>
  );
}
