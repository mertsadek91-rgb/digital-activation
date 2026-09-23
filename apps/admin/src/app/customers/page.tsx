'use client';

import type {
  AdminCustomerDetail,
  AdminCustomerList,
  AdminCustomerRow,
  AdminOrderRow,
  StaffMe,
} from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api, ApiError } from '../../lib/api';
import { Nav } from '../nav';

/**
 * Customers.
 *
 * The question this answers is the one behind every support message and
 * every held payment: who is this, and have they bought from us before? It
 * used to be answerable only by searching the orders list by email and
 * counting rows by eye.
 *
 * A row per customer, the same table as orders so the two screens read
 * alike; the detail opens under the row. Consent is its own column because
 * the export offers "opted in only" and the person pressing it should be able
 * to see what that will leave out.
 */
const CONSENT_KEYS = {
  OPTED_IN: 'consentOptedIn',
  OPTED_OUT: 'consentOptedOut',
  NONE: 'consentNone',
} as const satisfies Record<AdminCustomerRow['marketingEmail'], string>;

const STATUS_KEYS = {
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

const COLUMNS = 6;

function stamp(value: string | null): string {
  return value ? value.slice(0, 16).replace('T', ' ') : '—';
}

export default function CustomersPage() {
  const router = useRouter();
  const t = useT('customers');
  const c = useT('common');
  const [me, setMe] = useState<StaffMe | null>(null);
  const [data, setData] = useState<AdminCustomerList | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.customers(query.trim() || undefined, page));
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    }
  }, [query, page, router, t]);

  useEffect(() => {
    void (async () => {
      try {
        const staff = await api.me();
        if (staff.mustChangePassword) {
          router.push('/password');
          return;
        }
        setMe(staff);
      } catch {
        router.push('/login');
      }
    })();
  }, [router]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (!me) return <div className="admin-layout">{c('loading')}</div>;

  // The API's rule, mirrored so the buttons are not offered to a role that
  // would only be refused.
  const canExport = ['OWNER', 'ADMIN'].includes(me.role);

  async function exportFile(optedInOnly: boolean): Promise<void> {
    setError(null);
    setNote(null);
    try {
      await api.exportCustomers({ q: query.trim() || undefined, optedInOnly });
      setNote(t('exportDone'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : c('actionFailed'));
    }
  }

  return (
    <Nav me={me} current="customers">
      <div className="queue-head">
        <h1>{t('title')}</h1>
      </div>

      <div className="store-bar">
        <form
          className="lookup-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (page !== 1) setPage(1);
            else void load();
          }}
        >
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
          />
          <button type="submit" className="ghost">
            {c('search')}
          </button>
        </form>

        {canExport ? (
          <div className="lookup-form">
            <button type="button" className="ghost" onClick={() => void exportFile(false)}>
              {t('exportAll')}
            </button>
            <button type="button" className="ghost" onClick={() => void exportFile(true)}>
              {t('exportOptedIn')}
            </button>
          </div>
        ) : null}
      </div>
      {canExport ? <p className="meta">{t('exportHint')}</p> : null}

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="ok-note">{note}</p> : null}

      {data && data.rows.length === 0 ? <p className="notice">{t('empty')}</p> : null}

      {data && data.rows.length > 0 ? (
        <div className="table-scroll">
          <table className="admin-table orders-table">
            <thead>
              <tr>
                <th>{t('colCustomer')}</th>
                <th className="num">{t('colOrders')}</th>
                <th className="num">{t('colSpent')}</th>
                <th>{t('colLastOrder')}</th>
                <th>{t('colConsent')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <CustomerRow key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && (data.page > 1 || data.hasMore) ? (
        <nav className="pager" aria-label={t('pagerLabel')}>
          <button
            type="button"
            className="ghost"
            disabled={data.page <= 1}
            onClick={() => setPage(data.page - 1)}
          >
            {t('pagePrev')}
          </button>
          <span>{t('pageNumber', { page: data.page })}</span>
          <button
            type="button"
            className="ghost"
            disabled={!data.hasMore}
            onClick={() => setPage(data.page + 1)}
          >
            {t('pageNext')}
          </button>
        </nav>
      ) : null}
    </Nav>
  );
}

function CustomerRow({ row }: { row: AdminCustomerRow }) {
  const t = useT('customers');
  const o = useT('orders');
  const c = useT('common');
  const [open, setOpen] = useState(false);
  /** Loaded on first open and kept, like the orders drawer. */
  const [detail, setDetail] = useState<AdminCustomerDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      setDetailError(null);
      try {
        setDetail(await api.customer(row.id));
      } catch (caught) {
        setDetailError(caught instanceof Error ? caught.message : t('detailFailed'));
      }
    }
  }

  const consentPill =
    row.marketingEmail === 'OPTED_IN'
      ? 'pill-published'
      : row.marketingEmail === 'OPTED_OUT'
        ? 'pill-blocked'
        : 'pill-draft';

  return (
    <>
      <tr className={`order-row${open ? ' is-open' : ''}`}>
        <td className="order-customer">
          {row.name ? <strong>{row.name}</strong> : null}
          <span dir="ltr">{row.email}</span>
        </td>
        <td className="num">{row.paidOrders}</td>
        <td className="num order-total" dir="ltr">
          ${row.totalSpentUsd}
        </td>
        <td className="order-date" dir="ltr">
          {stamp(row.lastOrderAt)}
        </td>
        <td>
          <span className={`pill ${consentPill}`}>{t(CONSENT_KEYS[row.marketingEmail])}</span>
        </td>
        <td className="actions">
          <button
            type="button"
            className={`ghost${open ? ' is-active' : ''}`}
            aria-expanded={open}
            onClick={() => void toggle()}
          >
            {open ? c('hide') : c('details')}
          </button>
        </td>
      </tr>

      {open ? (
        <tr className="order-drawer">
          <td colSpan={COLUMNS}>
            <div className="order-detail">
              {detailError ? <p className="error">{detailError}</p> : null}
              {!detail && !detailError ? (
                <p className="meta loading-box">{t('loadingDetail')}</p>
              ) : null}

              {detail ? (
                <>
                  <div className="detail-section">
                    <h3 className="detail-heading">{t('profileHeading')}</h3>
                    <dl className="customer-facts">
                      <dt>{t('colJoined')}</dt>
                      <dd dir="ltr">{stamp(detail.createdAt)}</dd>
                      <dt>{t('phone')}</dt>
                      <dd dir="ltr">{detail.phone ?? '—'}</dd>
                      <dt>{t('company')}</dt>
                      <dd>{detail.company ?? '—'}</dd>
                      <dt>{t('language')}</dt>
                      <dd>{detail.locale === 'en' ? 'English' : 'العربية'}</dd>
                      <dt>{t('emailVerified')}</dt>
                      <dd dir="ltr">
                        {detail.emailVerifiedAt ? stamp(detail.emailVerifiedAt) : t('notVerified')}
                      </dd>
                      <dt>{t('risk')}</dt>
                      <dd>{detail.riskLevel}</dd>
                      <dt>{t('referralCode')}</dt>
                      <dd dir="ltr">{detail.referralCode ?? t('noReferral')}</dd>
                      <dt>{t('licences')}</dt>
                      <dd>{detail.licenceCount}</dd>
                    </dl>
                  </div>

                  <div className="detail-section">
                    <h3 className="detail-heading">{t('consentHeading')}</h3>
                    <dl className="customer-facts">
                      <dt>{t('optedInAt')}</dt>
                      <dd dir="ltr">
                        {detail.consent.marketingOptInAt
                          ? stamp(detail.consent.marketingOptInAt)
                          : t('never')}
                      </dd>
                      <dt>{t('optedOutAt')}</dt>
                      <dd dir="ltr">
                        {detail.consent.marketingOptOutAt
                          ? stamp(detail.consent.marketingOptOutAt)
                          : t('never')}
                      </dd>
                    </dl>
                  </div>

                  <div className="detail-section">
                    <h3 className="detail-heading">
                      {t('ordersHeading', { count: detail.orders.length })}
                    </h3>
                    {detail.orders.length === 0 ? (
                      <p className="meta empty-state-text">{t('noOrders')}</p>
                    ) : (
                      <ul className="order-notes-list">
                        {detail.orders.map((order) => (
                          <li key={order.number} className="order-note-item">
                            <div className="note-meta-row">
                              <span className="order-number" dir="ltr">
                                {order.number}
                              </span>
                              <span className="pill pill-draft">
                                {o(STATUS_KEYS[order.status])}
                              </span>
                              <span dir="ltr">${order.totalUsd}</span>
                              <span className="note-date" dir="ltr">
                                {stamp(order.placedAt)}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
