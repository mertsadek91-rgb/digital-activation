'use client';

import type { AdminDashboard, StaffMe } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api, ApiError } from '../../lib/api';
import { Nav } from '../nav';
import { Attention } from './attention';
import { Figure } from './figure';
import { useFormatters } from './formatters';
import { RevenueChart } from './revenue-chart';
import { STATUS_LABEL, STATUS_PILL } from './status';

/**
 * The panel's front page.
 *
 * Nine screens, each answering its own question well, and the two questions a
 * person actually opens this panel with — how much money came in, and what is
 * waiting on me — were answerable only by visiting five of them and knowing
 * which five. That is this screen's entire brief. It computes nothing: every
 * figure is the API's, so the queue's count here and the queue's count there
 * cannot drift apart.
 *
 * The order is deliberate. Money first, because it is what somebody looks for
 * before they have decided what to do with the day; then the work waiting, in
 * severity order, each row a sentence with a button that goes where it is
 * cleared; then what sold and what just arrived. Nothing on this page is a
 * control — it is read, and then left.
 */

export default function DashboardPage() {
  const router = useRouter();
  const t = useT('dashboard');
  const c = useT('common');
  const format = useFormatters();

  const [me, setMe] = useState<StaffMe | null>(null);
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api.dashboard());
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    } finally {
      setBusy(false);
    }
  }, [router, t]);

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

  return (
    <Nav me={me} current="dashboard">
      <div className="queue-head">
        <h1>{t('title')}</h1>
        <p className="who">{t('subtitle')}</p>
        <div className="dash-head-actions">
          {data ? (
            <span className="dash-stamp">
              {t('updatedAt', { time: format.time(data.generatedAt) })}
            </span>
          ) : null}
          <button
            type="button"
            className="ghost btn-sm"
            disabled={busy}
            onClick={() => void load()}
          >
            {busy ? c('busy') : t('refresh')}
          </button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {!data ? (
        <p className="notice">{c('loading')}</p>
      ) : (
        <>
          <section className="dash-kpis" aria-label={t('title')}>
            <Figure
              label={t('today')}
              window={data.today}
              comparison={t('vsYesterday')}
              format={format}
            />
            <Figure
              label={t('last7')}
              window={data.last7}
              comparison={t('vsPrevious7')}
              format={format}
            />
            <Figure
              label={t('last30')}
              window={data.last30}
              comparison={t('vsPrevious30')}
              format={format}
            />
            <div className="dash-figure">
              <p className="dash-figure-label">{t('averageOrder')}</p>
              <p className="dash-figure-value">
                {data.averageOrderUsd === null ? c('none') : format.money(data.averageOrderUsd)}
              </p>
              <p className="dash-figure-note">
                {data.averageOrderUsd === null
                  ? t('averageOrderEmpty')
                  : t.tp('ordersCount', data.last30.orders)}
              </p>
            </div>
            <div className="dash-figure">
              <p className="dash-figure-label">{t('refunded')}</p>
              <p className="dash-figure-value">{format.money(data.refundedUsd)}</p>
              <p className="dash-figure-note">{t('refundedNote')}</p>
            </div>
          </section>

          <p className="lede-sm dash-gross">{t('grossNote')}</p>

          <RevenueChart points={data.daily} format={format} />

          <Attention rows={data.attention} onGo={(path) => router.push(path)} />

          <div className="dash-split">
            <section className="vault-section dash-widget">
              <div className="dash-widget-header">
                <h2>{t('topTitle')}</h2>
                <p className="lede-sm">{t('topCaption')}</p>
              </div>
              {data.topProducts.length === 0 ? (
                <p className="notice">{t('topEmpty')}</p>
              ) : (
                <ul className="dash-top-list">
                  {data.topProducts.map((row, index) => (
                    <li key={row.sku} className="dash-top-item">
                      <div className="dash-top-rank">#{index + 1}</div>
                      <div className="dash-top-info">
                        <span className="dash-top-name">{row.name}</span>
                        <span className="dash-top-sku" dir="ltr">
                          {row.sku}
                        </span>
                      </div>
                      <div className="dash-top-metrics">
                        <span className="dash-top-revenue">{format.money(row.revenueUsd)}</span>
                        <span className="dash-top-qty">
                          {format.whole(row.qty)} {t('colQty')}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="vault-section dash-widget">
              <div className="dash-widget-header">
                <h2>{t('recentTitle')}</h2>
              </div>
              {data.recentOrders.length === 0 ? (
                <p className="notice">{t('recentEmpty')}</p>
              ) : (
                <ul className="dash-recent-list">
                  {data.recentOrders.map((order) => (
                    <li
                      key={order.number}
                      className="dash-recent-item"
                      onClick={() => router.push('/orders')}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          router.push('/orders');
                        }
                      }}
                    >
                      <div className="dash-recent-row-top">
                        <div className="dash-recent-id-status">
                          <span className="dash-recent-number" dir="ltr">
                            {order.number}
                          </span>
                          <span className={`pill ${STATUS_PILL[order.status]}`}>
                            {t(STATUS_LABEL[order.status])}
                          </span>
                        </div>
                        <span className="dash-recent-amount">{format.money(order.totalUsd)}</span>
                      </div>
                      <div className="dash-recent-row-bottom">
                        <span className="dash-recent-email" dir="ltr">
                          {order.email}
                        </span>
                        <div className="dash-recent-meta">
                          {order.waitingLines > 0 ? (
                            <span className="warn dash-waiting">
                              {t.tp('waitingLines', order.waitingLines)}
                            </span>
                          ) : null}
                          <span className="dash-recent-date">
                            {format.dateTime(order.placedAt)}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="vault-section">
            <h2>{t('lifetimeTitle')}</h2>
            <dl className="dash-lifetime">
              <div>
                <dt>{t('lifetimeRevenue')}</dt>
                <dd>{format.money(data.lifetime.revenueUsd)}</dd>
              </div>
              <div>
                <dt>{t('lifetimeOrders')}</dt>
                <dd>{format.whole(data.lifetime.orders)}</dd>
              </div>
              <div>
                <dt>{t('lifetimeCustomers')}</dt>
                <dd>{format.whole(data.lifetime.customers)}</dd>
              </div>
            </dl>
            <p className="lede-sm">{t('timeZoneNote', { zone: data.timeZone })}</p>
          </section>
        </>
      )}
    </Nav>
  );
}
