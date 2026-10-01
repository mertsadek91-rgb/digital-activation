'use client';

import type { AdminOrderDetail, OrderKeysRow, StaffMe } from '@da/contracts';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../../i18n/provider';
import { api, ApiError } from '../../../lib/api';
import { useStaff } from '../../../lib/use-staff';
import { Icon } from '../../icons';
import { Nav } from '../../nav';
import { STATUS_KEYS, stamp, statusPill } from '../order-shared';
import { CustomerCard, FactsCard } from './side-cards';
import { LinesTab } from './lines-tab';
import { MessagesTab } from './messages-tab';
import { NotesTab } from './notes-tab';
import { OverviewTab } from './overview-tab';
import { PaymentTab } from './payment-tab';

/**
 * One order, as a page.
 *
 * The list is for finding an order; this is for working it. Everything a
 * person does to an order — confirm the money, release a hold, paste the key
 * the supplier sent, refund, write to the customer, leave a note — happens
 * here, and the list no longer carries a drawer that tried to do all of it in
 * a table cell.
 *
 * Laid out as a record: who the customer is and what the order says, on the
 * side, where they stay put; what is happening to it in tabs, where each
 * kind of work has room. The next step is stated at the top of the overview
 * rather than left to be inferred from a status word.
 */

export type Tab = 'overview' | 'lines' | 'payment' | 'messages' | 'notes';

export interface Notice {
  kind: 'ok' | 'error';
  text: string;
}

export default function OrderPage() {
  const params = useParams<{ number: string }>();
  const number = decodeURIComponent(params.number);
  const router = useRouter();
  const t = useT('order');
  const o = useT('orders');
  const c = useT('common');
  const me = useStaff();

  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [keys, setKeys] = useState<OrderKeysRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const load = useCallback(async () => {
    try {
      setDetail(await api.order(number));
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(
        caught instanceof ApiError && caught.status === 404
          ? t('notFound')
          : caught instanceof Error
            ? caught.message
            : t('loadFailed'),
      );
    }
    // Key states are a separate, role-gated read; a role without them simply
    // sees the lines without the vault column.
    try {
      setKeys(await api.orderKeys(number));
    } catch {
      setKeys(null);
    }
  }, [number, router, t]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (!me) return <div className="admin-layout">{c('loading')}</div>;

  const primary = primaryAction(detail, me);

  return (
    <Nav me={me} current="orders">
      <div className="order-hero">
        <div className="order-hero__main">
          <nav className="crumbs" aria-label={t('breadcrumbOrders')}>
            <Link href="/orders">{t('breadcrumbOrders')}</Link>
            <span className="crumbs__sep">/</span>
            <span className="crumbs__current" dir="ltr">
              {number}
            </span>
          </nav>
          <h1 className="order-hero__title">
            <span dir="ltr">{number}</span>
            {detail ? (
              <>
                <span className={`pill ${statusPill(detail.status)}`}>
                  {o(STATUS_KEYS[detail.status])}
                </span>
                {detail.riskLevel === 'HIGH' || detail.riskLevel === 'BLOCKED' ? (
                  <span className="pill pill-blocked">
                    {t('riskLabel')} · {t(`risk${detail.riskLevel}`)}
                  </span>
                ) : null}
                {detail.payments.some((payment) => payment.testMode) ? (
                  <span className="pill pill-draft">{t('testBadge')}</span>
                ) : null}
              </>
            ) : null}
          </h1>
          {detail ? (
            <p className="order-hero__desc">
              {t('placedAt', { at: stamp(detail.placedAt) })}
              {' · '}
              {detail.paidAt ? t('paidAt', { at: stamp(detail.paidAt) }) : t('unpaid')}
              {' · '}
              <span dir="ltr">{detail.email}</span>
            </p>
          ) : null}
        </div>
        <div className="order-hero__actions">
          <Link href="/orders" className="button ghost">
            {t('backToOrders')}
          </Link>
          <button type="button" className="ghost" onClick={() => window.print()}>
            <Icon name="pages" />
            {t('print')}
          </button>
          {primary ? (
            <button type="button" onClick={() => setTab(primary.tab)}>
              {t(primary.label)}
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? (
        <p className={notice.kind === 'ok' ? 'ok-note' : 'error'} role="status">
          {notice.text}
        </p>
      ) : null}

      {!detail && !error ? <p className="loading-box">{c('loading')}</p> : null}

      {detail ? (
        <div className="order-layout">
          <aside className="order-side">
            <CustomerCard detail={detail} onNotice={setNotice} />
            <FactsCard detail={detail} onNotice={setNotice} />
          </aside>

          <section className="order-main card">
            <div className="tabs-bar" role="tablist">
              {(
                [
                  ['overview', 'tabOverview', null],
                  ['lines', 'tabLines', detail.lines.length],
                  ['payment', 'tabPayment', detail.payments.length],
                  ['messages', 'tabMessages', detail.emails.length],
                  ['notes', 'tabNotes', detail.notes.length],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={`tab${tab === key ? ' is-active' : ''}`}
                  onClick={() => setTab(key)}
                >
                  {t(label)}
                  {count !== null && count > 0 ? <span className="tab-count">{count}</span> : null}
                </button>
              ))}
            </div>

            <div className="tab-panel is-active">
              {tab === 'overview' ? (
                <OverviewTab detail={detail} onGo={setTab} />
              ) : tab === 'lines' ? (
                <LinesTab detail={detail} keys={keys} me={me} onDone={load} onNotice={setNotice} />
              ) : tab === 'payment' ? (
                <PaymentTab detail={detail} me={me} onDone={load} onNotice={setNotice} />
              ) : tab === 'messages' ? (
                <MessagesTab detail={detail} me={me} onDone={load} onNotice={setNotice} />
              ) : (
                <NotesTab detail={detail} me={me} onDone={load} onNotice={setNotice} />
              )}
            </div>
          </section>
        </div>
      ) : null}
    </Nav>
  );
}

/**
 * The one button in the header, when the order has an obvious next move for
 * this person: confirm the money, release the hold, deliver the waiting line.
 */
function primaryAction(
  detail: AdminOrderDetail | null,
  me: StaffMe,
): { tab: Tab; label: 'confirmPayment' | 'releaseHold' | 'deliverNow' } | null {
  if (!detail) return null;
  const canPay = ['OWNER', 'ADMIN'].includes(me.role);
  const canFulfil = ['OWNER', 'ADMIN', 'FULFILLMENT'].includes(me.role);
  const risky = detail.riskLevel === 'HIGH' || detail.riskLevel === 'BLOCKED';
  if (detail.status === 'PENDING_PAYMENT' && canPay)
    return { tab: 'payment', label: 'confirmPayment' };
  if (
    (detail.status === 'PAYMENT_REVIEW' ||
      (risky && ['PAID', 'FULFILLING'].includes(detail.status))) &&
    canPay
  )
    return { tab: 'payment', label: 'releaseHold' };
  if (detail.waitingLines > 0 && canFulfil && ['PAID', 'FULFILLING'].includes(detail.status))
    return { tab: 'lines', label: 'deliverNow' };
  return null;
}
