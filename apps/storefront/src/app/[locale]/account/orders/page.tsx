'use client';

import type { AccountOrder, AccountOrderList, CustomerMe } from '@da/contracts';
import { ROUTES } from '@da/contracts';
import { Link } from '../../../../components/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { AccountShell } from '../../../../components/account-shell';
import { CheckIcon, InfoIcon, WarningIcon } from '../../../../components/icons';
import { isArabic } from '../../../../i18n/locale';
import { accountApi, AccountError } from '../../../../lib/account-client';
import { formatOrderStatus, formatPrice } from '../../../../lib/format';

/**
 * طلباتي — what this customer bought, what it cost, and where it has got to.
 * Drawn after the kit's orders page (TASK-0105): one table — number, date,
 * what was in it, status, total — each row opening the order itself. On a
 * phone the rows stack into cards with their labels.
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

  return (
    <AccountShell locale={locale} title={t('myOrders')} email={me?.email}>
      {!me ? (
        <p className="notice" aria-busy="true">
          …
        </p>
      ) : null}

      {error ? (
        <p className="alert alert-error" role="alert">
          <WarningIcon size={20} />
          <span>{error}</span>
        </p>
      ) : null}

      {list && list.rows.length === 0 ? (
        <p className="alert alert-info">
          <InfoIcon size={20} />
          <span>{t('noOrders')}</span>
        </p>
      ) : null}

      {list && list.rows.length > 0 ? (
        <div className="table-card">
          <table className="order-table">
            <thead>
              <tr>
                <th scope="col">{t('colNumber')}</th>
                <th scope="col">{t('colDate')}</th>
                <th scope="col">{t('colItems')}</th>
                <th scope="col">{t('colStatus')}</th>
                <th scope="col" className="is-money">
                  {t('colTotal')}
                </th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((order) => (
                <OrderRow key={order.number} order={order} prefix={prefix} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </AccountShell>
  );
}

function OrderRow({ order, prefix }: { order: AccountOrder; prefix: string }) {
  const t = useTranslations('account');
  const tf = useTranslations('format');
  // Paid is the line this page draws, not fulfilled: an order that has been
  // paid for is one the store owes something on, and that is the distinction a
  // customer scanning the list is looking for.
  const paid = order.paidAt !== null;
  const first = order.lines[0];
  const rest = order.lines.length - 1;

  return (
    <tr className={paid ? undefined : 'is-waiting'}>
      <td data-label={t('colNumber')}>
        {/* The order page is where the activation steps and the delivery
            wording live, and it is reachable without signing in at all. This
            list's job is to get the customer to the right one of them. */}
        <Link href={`${prefix}${ROUTES.order(order.number)}`} className="order-number">
          <span dir="ltr">{order.number}</span>
        </Link>
      </td>
      <td data-label={t('colDate')}>
        <span dir="ltr">{order.placedAt.slice(0, 10)}</span>
      </td>
      <td data-label={t('colItems')} className="order-items">
        {first ? first.productName : t('lineCount', { count: 0 })}
        {rest > 0 ? <span className="meta"> {t('moreLines', { count: rest })}</span> : null}
      </td>
      <td data-label={t('colStatus')}>
        <span className={`pill ${paid ? 'pill-published' : 'pill-draft'}`}>
          {paid ? <CheckIcon size={14} /> : null}
          {formatOrderStatus(order.status, tf)}
        </span>
      </td>
      <td data-label={t('colTotal')} className="is-money">
        {formatPrice({ amount: order.total, currency: order.currency })}
      </td>
    </tr>
  );
}
