'use client';

import type { AccountOrder, AccountOrderList, CustomerMe } from '@da/contracts';
import { ROUTES } from '@da/contracts';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { AccountNav } from '../../../../components/account-nav';
import { isArabic } from '../../../../i18n/locale';
import { accountApi, AccountError } from '../../../../lib/account-client';
import { formatLineState, formatOrderStatus, formatPrice } from '../../../../lib/format';

/**
 * طلباتي — what this customer bought, what it cost, and where it has got to.
 *
 * Separate from the licences page because the two answer different questions.
 * The licences page is for "my key is gone"; this one is for "did the payment
 * go through", "what did I pay in March", and "which of these three orders was
 * the Office one" — questions that were, until now, a support email, and
 * support answering them meant a member of staff opening the order in the
 * admin panel.
 *
 * No key is on this page and none can be reached from it. An order lists what
 * was bought and its state; the key stays in the vault and comes out through
 * the reveal on the licences page, which writes to the access log every time.
 *
 * Cancelled and unpaid orders are listed like any other. They are usually the
 * reason somebody came — an order that quietly vanished from the list is how a
 * customer concludes the store took the money and lost the purchase.
 */
export default function OrdersPage() {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'ar';
  const prefix = isArabic(locale) ? '' : `/${locale}`;
  const t = useTranslations('account');
  const tc = useTranslations('common');

  const [me, setMe] = useState<CustomerMe | null>(null);
  const [list, setList] = useState<AccountOrderList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await accountApi.orders());
    } catch (caught) {
      if (caught instanceof AccountError && caught.status === 401) {
        router.replace(`${prefix}${ROUTES.account}`);
        return;
      }
      setError(caught instanceof Error ? caught.message : null);
    }
  }, [router, prefix]);

  useEffect(() => {
    void (async () => {
      try {
        setMe(await accountApi.me());
      } catch {
        // Not signed in, or the twelve hours are up. Straight back to the one
        // page that can fix it rather than an error the visitor cannot act on.
        router.replace(`${prefix}${ROUTES.account}`);
      }
    })();
  }, [router, prefix]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (!me) {
    return (
      <main className="shell account-shell">
        <p className="notice">…</p>
      </main>
    );
  }

  return (
    <main className="shell account-shell">
      <div className="account-head">
        <h1>{t('myOrders')}</h1>
        <p className="who" dir="ltr">
          {me.email}
        </p>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            void accountApi.signOut().then(() => router.replace(`${prefix}${ROUTES.account}`));
          }}
        >
          {tc('signOut')}
        </button>
      </div>

      <AccountNav prefix={prefix} />

      {error ? <p className="error">{error}</p> : null}

      {list && list.rows.length === 0 ? <p className="notice">{t('noOrders')}</p> : null}

      <ul className="order-history">
        {(list?.rows ?? []).map((order) => (
          <OrderCard key={order.number} order={order} prefix={prefix} />
        ))}
      </ul>
    </main>
  );
}

function OrderCard({ order, prefix }: { order: AccountOrder; prefix: string }) {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const tf = useTranslations('format');
  // Paid is the line this page draws, not fulfilled: an order that has been
  // paid for is one the store owes something on, and that is the distinction a
  // customer scanning the list is looking for.
  const paid = order.paidAt !== null;
  const money = (amount: string): string => formatPrice({ amount, currency: order.currency });

  return (
    <li className={`order-history-card${paid ? '' : ' is-waiting'}`}>
      <div className="order-history-head">
        <div>
          <Link href={`${prefix}${ROUTES.order(order.number)}`} className="order-history-number">
            <span dir="ltr">{order.number}</span>
          </Link>
          <p className="order-history-dates">
            <span dir="ltr">{order.placedAt.slice(0, 10)}</span>
            {order.paidAt ? (
              <span>
                {' · '}
                {t.rich('paidOn', {
                  date: order.paidAt.slice(0, 10),
                  ltr: (chunks) => <span dir="ltr">{chunks}</span>,
                })}
              </span>
            ) : null}
          </p>
        </div>
        <span className={`pill ${paid ? 'pill-published' : 'pill-draft'}`}>
          {formatOrderStatus(order.status, tf)}
        </span>
      </div>

      <ul className="order-history-lines">
        {order.lines.map((line) => (
          <li key={line.sku}>
            <div>
              <p className="order-line-name">{line.productName}</p>
              <p className="order-line-spec" dir="ltr">
                {line.sku} × {line.qty}
              </p>
              <p className="order-line-state">{formatLineState(line.fulfillmentState, tf)}</p>
            </div>
            <p className="order-line-total">{money(line.lineTotal)}</p>
          </li>
        ))}
      </ul>

      <dl className="totals">
        <div>
          <dt>{tc('subtotal')}</dt>
          <dd>{money(order.subtotal)}</dd>
        </div>
        {Number(order.discount) > 0 ? (
          <div className="totals-discount">
            <dt>{tc('discount')}</dt>
            <dd>−{money(order.discount)}</dd>
          </div>
        ) : null}
        {Number(order.tax) > 0 ? (
          <div>
            <dt>{tc('tax')}</dt>
            <dd>{money(order.tax)}</dd>
          </div>
        ) : null}
        <div className="totals-total">
          <dt>{tc('total')}</dt>
          <dd>{money(order.total)}</dd>
        </div>
      </dl>

      {/* The order page is where the activation steps and the delivery wording
          live, and it is reachable without signing in at all. This list's job
          is to get the customer to the right one of them. */}
      <Link href={`${prefix}${ROUTES.order(order.number)}`} className="btn btn-ghost">
        {t('orderDetails')}
      </Link>
    </li>
  );
}
