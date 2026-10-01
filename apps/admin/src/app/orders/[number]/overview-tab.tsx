'use client';

import type { AdminOrderDetail } from '@da/contracts';

import { useT } from '../../../i18n/provider';
import { ACTOR_KEYS, STATUS_KEYS, stamp } from '../order-shared';
import type { Tab } from './page';

/**
 * The order at a glance: how far along it is, what to do next, and how it
 * got here. Nothing on this tab is a form; it says where the forms are.
 */
export function OverviewTab({
  detail,
  onGo,
}: {
  detail: AdminOrderDetail;
  onGo: (tab: Tab) => void;
}) {
  const t = useT('order');
  const o = useT('orders');

  const delivered = detail.lines.filter((line) => line.fulfillmentState === 'DELIVERED').length;
  const waiting = detail.lines.filter((line) =>
    ['MANUAL_QUEUE', 'AUTO_ASSIGNED'].includes(line.fulfillmentState),
  ).length;
  const risky = detail.riskLevel === 'HIGH' || detail.riskLevel === 'BLOCKED';

  const next: {
    text: string;
    tab: Tab;
    tone: 'danger' | 'warning' | 'info' | 'success' | 'neutral';
  } =
    detail.status === 'PENDING_PAYMENT'
      ? { text: t('nextConfirm'), tab: 'payment', tone: 'warning' }
      : detail.status === 'PAYMENT_REVIEW' ||
          (risky && ['PAID', 'FULFILLING'].includes(detail.status))
        ? { text: t('nextRelease'), tab: 'payment', tone: 'danger' }
        : ['PAID', 'FULFILLING'].includes(detail.status) && waiting > 0
          ? { text: t('nextFulfil'), tab: 'lines', tone: 'info' }
          : ['FULFILLED', 'COMPLETED'].includes(detail.status)
            ? { text: t('nextDone'), tab: 'messages', tone: 'success' }
            : { text: t('nextCancelled'), tab: 'payment', tone: 'neutral' };

  return (
    <div className="overview">
      <div className={`next-step is-${next.tone}`}>
        <div>
          <p className="next-step__label">{t('nextStepHeading')}</p>
          <p className="next-step__text">{next.text}</p>
        </div>
        <button type="button" className="ghost btn-sm" onClick={() => onGo(next.tab)}>
          {t(
            next.tab === 'payment'
              ? 'tabPayment'
              : next.tab === 'lines'
                ? 'tabLines'
                : 'tabMessages',
          )}
        </button>
      </div>

      <div className="stat-row">
        <div className="stat-tile">
          <span className="stat-tile__label">{t('summaryHeading')}</span>
          <strong className="stat-tile__value">{t.tp('linesCount', detail.lines.length)}</strong>
          <span className="stat-tile__note">
            {t('deliveredCount', { delivered, total: detail.lines.length })}
          </span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">{t('total')}</span>
          <strong className="stat-tile__value" dir="ltr">
            ${detail.amounts.totalUsd}
          </strong>
          <span className="stat-tile__note" dir="ltr">
            {detail.amounts.charged
              ? `${detail.amounts.charged.amount} ${detail.amounts.charged.currency}`
              : detail.payments[0]
                ? t(`provider${detail.payments[0].provider}`)
                : '—'}
          </span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">{t('tabMessages')}</span>
          <strong className="stat-tile__value">{detail.emails.length}</strong>
          <span className="stat-tile__note">
            {waiting > 0 ? t('waitingCount', { count: waiting }) : o(STATUS_KEYS[detail.status])}
          </span>
        </div>
      </div>

      <h3 className="card__subtitle">{t('timelineHeading')}</h3>
      <ol className="timeline">
        <li className="timeline__item">
          <span className="timeline__dot" />
          <div>
            <p className="timeline__title">{t('historyPlaced')}</p>
            <p className="timeline__time" dir="ltr">
              {stamp(detail.placedAt)}
            </p>
          </div>
        </li>
        {detail.history.map((event) => (
          <li key={event.id} className="timeline__item">
            <span className="timeline__dot" />
            <div>
              <p className="timeline__title">
                {event.from ? `${o(STATUS_KEYS[event.from])} → ` : ''}
                <strong>{o(STATUS_KEYS[event.to])}</strong>
              </p>
              {event.reason ? <p className="meta">{event.reason}</p> : null}
              <p className="timeline__time">
                {o(ACTOR_KEYS[event.actorType])}
                {event.actor ? (
                  <>
                    {' · '}
                    <span dir="ltr">{event.actor}</span>
                  </>
                ) : null}
                {' · '}
                <span dir="ltr">{stamp(event.createdAt)}</span>
              </p>
            </div>
          </li>
        ))}
      </ol>
      {detail.history.length === 0 && detail.status !== 'PENDING_PAYMENT' ? (
        <p className="meta">{t('historyNotRecorded')}</p>
      ) : null}
    </div>
  );
}
