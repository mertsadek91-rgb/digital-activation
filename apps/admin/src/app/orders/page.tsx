'use client';

import type { AdminOrderList, AdminOrderRow } from '@da/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api, ApiError } from '../../lib/api';
import { softBreakEmail } from '../../lib/text';
import { useStaff } from '../../lib/use-staff';
import { Nav } from '../nav';
import { STATUS_KEYS, stamp, statusPill } from './order-shared';

/**
 * Orders — the list.
 *
 * For finding an order, not for working it: every row opens its own page,
 * where the money is confirmed, the key pasted and the customer written to.
 * The filter that opens first is "awaiting payment", because the transfer
 * that arrived outside the store is the thing somebody checks first thing
 * in the morning.
 */
const FILTERS = [
  { key: 'awaiting-payment', label: 'filterAwaitingPayment' },
  { key: 'in-review', label: 'filterInReview' },
  { key: 'paid', label: 'filterPaid' },
  { key: 'done', label: 'filterDone' },
  { key: 'all', label: 'filterAll' },
] as const;

export default function OrdersPage() {
  const router = useRouter();
  const t = useT('orders');
  const c = useT('common');
  const me = useStaff();
  const [data, setData] = useState<AdminOrderList | null>(null);
  const [filter, setFilter] = useState('awaiting-payment');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');

  const load = useCallback(async () => {
    try {
      setData(
        await api.orders(filter === 'all' ? undefined : filter, query.trim() || undefined, page),
      );
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    }
  }, [filter, query, page, router, t]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (!me) return <div className="admin-layout">{c('loading')}</div>;

  const canExport = ['OWNER', 'ADMIN'].includes(me.role);

  async function exportCsv(): Promise<void> {
    setError(null);
    setNote(null);
    try {
      await api.exportOrders({
        from: exportFrom,
        to: exportTo,
        status: filter === 'all' ? undefined : filter,
      });
      setNote(t('exportCsv'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : c('actionFailed'));
    }
  }

  return (
    <Nav me={me} current="orders">
      <div className="queue-head">
        <h1>{t('title')}</h1>
        <p className="who">
          {data ? t('summary', { count: data.counts.all, paid: data.counts.paid }) : c('loading')}
          {data && data.counts.awaitingPayment > 0 ? (
            <strong className="overdue-count">
              {' '}
              · {t('awaitingPayment', { count: data.counts.awaitingPayment })}
            </strong>
          ) : null}
        </p>
      </div>

      <div className="store-bar">
        <nav className="sorts" aria-label={c('filter')}>
          {FILTERS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={`tab${filter === entry.key ? ' is-active' : ''}`}
              onClick={() => {
                setFilter(entry.key);
                setPage(1);
              }}
            >
              {t(entry.label)}
            </button>
          ))}
        </nav>

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
            dir="ltr"
          />
          <button type="submit" className="ghost">
            {c('search')}
          </button>
        </form>
      </div>

      {/* The export, for the people the API lets have it. It follows the
          status tab that is open, so the file is the list on screen over a
          date range rather than a second set of filters to get right. */}
      {canExport ? (
        <form
          className="lookup-form export-bar"
          onSubmit={(event) => {
            event.preventDefault();
            void exportCsv();
          }}
        >
          <label>
            {t('exportFrom')}
            <input
              type="date"
              value={exportFrom}
              onChange={(event) => setExportFrom(event.target.value)}
            />
          </label>
          <label>
            {t('exportTo')}
            <input
              type="date"
              value={exportTo}
              onChange={(event) => setExportTo(event.target.value)}
            />
          </label>
          <button type="submit" className="ghost">
            {t('exportCsv')}
          </button>
          <small className="meta">{t('exportHint')}</small>
        </form>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="ok-note">{note}</p> : null}

      {data && data.rows.length === 0 ? <p className="notice">{t('empty')}</p> : null}

      {data && data.rows.length > 0 ? (
        <div className="table-scroll">
          <table className="admin-table orders-table">
            <thead>
              <tr>
                <th>{t('colOrder')}</th>
                <th>{t('colStatus')}</th>
                <th>{t('colCustomer')}</th>
                <th className="num">{t('colItems')}</th>
                <th className="num">{t('colTotal')}</th>
                <th>{t('colDate')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <OrderRow key={row.number} row={row} />
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

function OrderRow({ row }: { row: AdminOrderRow }) {
  const t = useT('orders');
  const c = useT('common');
  const risky = row.riskLevel === 'HIGH' || row.riskLevel === 'BLOCKED';
  const href = `/orders/${encodeURIComponent(row.number)}`;

  return (
    <tr className={`order-row${risky ? ' is-risky' : ''}`}>
      <td>
        <Link href={href} className="order-number" dir="ltr">
          {row.number}
        </Link>
      </td>
      <td>
        <span className={`pill ${statusPill(row.status)}`}>{t(STATUS_KEYS[row.status])}</span>
        {risky ? (
          <span className="pill pill-blocked">{t('riskPill', { level: row.riskLevel })}</span>
        ) : null}
        {row.waitingLines > 0 && row.status !== 'PENDING_PAYMENT' ? (
          <span className="pill pill-draft">{t('inFulfilment', { count: row.waitingLines })}</span>
        ) : null}
      </td>
      <td className="order-customer">
        {row.customerName ? <strong>{row.customerName}</strong> : null}
        <span dir="ltr">{softBreakEmail(row.email)}</span>
      </td>
      <td className="num">{row.itemCount}</td>
      <td className="num order-total" dir="ltr">
        ${row.totalUsd}
      </td>
      <td className="order-date" dir="ltr">
        {stamp(row.placedAt)}
      </td>
      <td className="actions">
        <Link href={href} className="as-button">
          {c('details')}
        </Link>
      </td>
    </tr>
  );
}
