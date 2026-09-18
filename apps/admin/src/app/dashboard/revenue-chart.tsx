'use client';

import type { DashboardPoint } from '@da/contracts';
import { useState } from 'react';

import { useT } from '../../i18n/provider';
import type { Formatters } from './formatters';

/**
 * Thirty days of revenue, as one line.
 *
 * One series, so there is no legend: the heading already says what is plotted,
 * and a box with a single swatch in it restates the heading. Two points are
 * labelled — the best day and the last one — and the rest are left to the
 * axis and the hover, because a number on every one of thirty points is a
 * number nobody reads.
 *
 * Drawn left to right in both languages. The panel is right-to-left in Arabic
 * and this one element is not: the axis is a run of Latin dates and dollar
 * amounts, and mirroring a time series is the kind of thing that gets a chart
 * read backwards once and then never trusted again. The table underneath it
 * follows the reading direction of the page, which is where the ordering
 * actually matters to a screen reader.
 */
export function RevenueChart({
  points,
  format,
}: {
  points: DashboardPoint[];
  format: Formatters;
}) {
  const t = useT('dashboard');
  const [hovered, setHovered] = useState<number | null>(null);
  const [tabular, setTabular] = useState(false);

  const values = points.map((point) => Number(point.revenueUsd));
  const total = values.reduce((sum, value) => sum + value, 0);
  /** `noUncheckedIndexedAccess` is on, and an out-of-range day is zero here. */
  const at = (index: number): number => values[index] ?? 0;
  const peakIndex = values.reduce((best, value, index) => (value > at(best) ? index : best), 0);

  // A round ceiling, so the gridlines land on numbers somebody would say out
  // loud. A max of exactly the peak would put the best day on the frame.
  const rawMax = Math.max(...values, 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawMax));
  const max = Math.ceil(rawMax / magnitude) * magnitude;

  const W = 720;
  const H = 240;
  const PAD = { top: 18, right: 16, bottom: 28, left: 56 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const x = (index: number) =>
    PAD.left + (points.length === 1 ? plotW / 2 : (index / (points.length - 1)) * plotW);
  const y = (value: number) => PAD.top + plotH - (value / max) * plotH;

  const line = points.map((point, index) => `${x(index)},${y(Number(point.revenueUsd))}`).join(' ');
  const area = `${PAD.left},${PAD.top + plotH} ${line} ${x(points.length - 1)},${PAD.top + plotH}`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((step) => step * max);
  // Five labels across thirty days. Every date is a label nobody can read at
  // this width, and the tooltip carries the exact one anyway.
  const labelEvery = Math.max(1, Math.ceil(points.length / 5));

  const active = hovered === null ? null : points[hovered];

  function pick(clientX: number, target: SVGSVGElement): void {
    const box = target.getBoundingClientRect();
    if (box.width === 0) return;
    const withinSvg = ((clientX - box.left) / box.width) * W;
    const ratio = (withinSvg - PAD.left) / plotW;
    const index = Math.round(ratio * (points.length - 1));
    setHovered(Math.min(points.length - 1, Math.max(0, index)));
  }

  return (
    <section className="vault-section dash-chart-section">
      <div className="dash-chart-head">
        <div>
          <h2>{t('chartTitle')}</h2>
          <p className="lede-sm">{t('chartCaption')}</p>
        </div>
        <button
          type="button"
          className="ghost btn-sm"
          aria-expanded={tabular}
          onClick={() => setTabular((open) => !open)}
        >
          {tabular ? t('chartTableHide') : t('chartTableToggle')}
        </button>
      </div>

      {total === 0 ? (
        <p className="notice">{t('chartEmpty')}</p>
      ) : (
        <div className="dash-chart" dir="ltr">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="dash-chart-svg"
            role="img"
            aria-label={`${t('chartTitle')} — ${t('chartCaption')}`}
            tabIndex={0}
            onPointerMove={(event) => pick(event.clientX, event.currentTarget)}
            onPointerLeave={() => setHovered(null)}
            onBlur={() => setHovered(null)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const step = event.key === 'ArrowRight' ? 1 : -1;
              setHovered((current) => {
                const next = (current ?? points.length - 1) + step;
                return Math.min(points.length - 1, Math.max(0, next));
              });
            }}
          >
            {ticks.map((value) => (
              <g key={value}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(value)}
                  y2={y(value)}
                  className="dash-grid"
                />
                <text x={PAD.left - 8} y={y(value) + 4} className="dash-axis" textAnchor="end">
                  {format.moneyShort(value)}
                </text>
              </g>
            ))}

            <polygon points={area} className="dash-area" />
            <polyline points={line} className="dash-line" />

            {points.map((point, index) =>
              index % labelEvery === 0 || index === points.length - 1 ? (
                <text
                  key={point.date}
                  x={x(index)}
                  y={H - 8}
                  className="dash-axis"
                  // The two on the ends are anchored inwards. Centred, a date
                  // at the last point hangs past the frame and is clipped by
                  // the card — and the last day is the one somebody reads.
                  textAnchor={
                    index === points.length - 1 ? 'end' : index === 0 ? 'start' : 'middle'
                  }
                >
                  {format.dayNumeric(point.date)}
                </text>
              ) : null,
            )}

            {/* The best day and the last day, and nothing else. */}
            {[peakIndex, points.length - 1]
              .filter((index, position, all) => all.indexOf(index) === position)
              .map((index) => (
                <circle
                  key={`mark-${String(index)}`}
                  cx={x(index)}
                  cy={y(at(index))}
                  r={4}
                  className="dash-dot"
                />
              ))}

            {at(peakIndex) > 0 ? (
              <text
                x={x(peakIndex)}
                y={y(at(peakIndex)) - 12}
                className="dash-point-label"
                textAnchor={peakIndex > points.length - 4 ? 'end' : 'middle'}
              >
                {format.moneyShort(at(peakIndex))}
              </text>
            ) : null}

            {hovered !== null ? (
              <g>
                <line
                  x1={x(hovered)}
                  x2={x(hovered)}
                  y1={PAD.top}
                  y2={PAD.top + plotH}
                  className="dash-crosshair"
                />
                <circle cx={x(hovered)} cy={y(at(hovered))} r={5} className="dash-dot is-live" />
              </g>
            ) : null}
          </svg>

          {active ? (
            <div
              className="dash-tip"
              role="status"
              // The box is inside the chart, which is left to right; its
              // contents are a sentence in the reader's language and are not.
              dir="auto"
              style={{
                // Anchored to the point and kept inside the box: at the right
                // edge a centred tooltip hangs off the card.
                insetInlineStart: `${String((x(hovered ?? 0) / W) * 100)}%`,
                transform: `translateX(${
                  (hovered ?? 0) > points.length - 5
                    ? '-90%'
                    : (hovered ?? 0) < 4
                      ? '-10%'
                      : '-50%'
                })`,
              }}
            >
              <strong>{format.money(active.revenueUsd)}</strong>
              <span>{format.dayLong(active.date)}</span>
              <span>{t.tp('ordersCount', active.orders)}</span>
            </div>
          ) : null}
        </div>
      )}

      {/*
        The same numbers, reachable without the chart. Not a fallback — a
        screen reader gets the shape of a line chart as a single alt string
        and nothing else, and somebody who wants the figure for a particular
        day should not have to hover thirty times to find it.
      */}
      {tabular ? (
        <div className="table-scroll dash-table">
          <table>
            <thead>
              <tr>
                <th>{t('colDay')}</th>
                <th className="num">{t('colRevenue')}</th>
                <th className="num">{t('colOrders')}</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((point) => (
                <tr key={point.date}>
                  <td className="meta">{format.dayLong(point.date)}</td>
                  <td className="num">{format.money(point.revenueUsd)}</td>
                  <td className="num">{format.whole(point.orders)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
