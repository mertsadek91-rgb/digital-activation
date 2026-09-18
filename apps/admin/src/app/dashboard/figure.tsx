'use client';

import type { DashboardWindow } from '@da/contracts';

import { useT } from '../../i18n/provider';
import type { Formatters } from './formatters';

/**
 * One span of trading, with its change against the span before it.
 *
 * The change is a percentage and a direction rather than a second figure: two
 * numbers side by side ask the reader to do the subtraction, and the reason
 * anybody wants a comparison is to skip it. Where the previous span was empty
 * there is no percentage to state — a rise from nothing is not "+100%", it is
 * the first sale — so it says so instead.
 */
export function Figure({
  label,
  window: span,
  comparison,
  format,
}: {
  label: string;
  window: DashboardWindow;
  comparison: string;
  format: Formatters;
}) {
  const t = useT('dashboard');
  const now = Number(span.revenueUsd);
  const before = Number(span.previousRevenueUsd);

  const change = before === 0 ? null : ((now - before) / before) * 100;
  const direction = change === null || Math.abs(change) < 0.5 ? 'flat' : change > 0 ? 'up' : 'down';

  return (
    <div className="dash-figure">
      <p className="dash-figure-label">{label}</p>
      <p className="dash-figure-value">{format.money(span.revenueUsd)}</p>
      <p className={`dash-delta is-${direction}`}>
        {change === null ? (
          <span className="dash-delta-note">{t('noComparison')}</span>
        ) : (
          <>
            {/*
              Isolated, because the arrow and the sign are bidi-neutral and an
              Arabic paragraph reorders them around the digits: "↑ +38%" was
              being drawn as "38%+ ↑", which puts the plus on the wrong end of
              the number and the arrow on the wrong end of the phrase. `bdi`
              holds the three together and left to right, where they mean what
              they say.

              The arrow is not the only carrier of direction: the sign is on
              the number and the phrase beside it names the period, so this
              reads without colour and without the glyph.
            */}
            <bdi dir="ltr">
              <span aria-hidden="true">
                {direction === 'up' ? '↑' : direction === 'down' ? '↓' : '·'}
              </span>{' '}
              {direction === 'flat'
                ? t('flat')
                : `${change > 0 ? '+' : '−'}${Math.abs(change).toFixed(0)}%`}
            </bdi>{' '}
            <span className="dash-delta-note">{comparison}</span>
          </>
        )}
      </p>
      <p className="dash-figure-note">{t.tp('ordersCount', span.orders)}</p>
    </div>
  );
}
