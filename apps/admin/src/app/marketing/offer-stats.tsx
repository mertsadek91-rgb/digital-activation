'use client';

import type { OfferStats } from '@da/contracts';

import { useT } from '../../i18n/provider';

type Group = 'volume' | 'pair' | 'sale';

/**
 * Paid orders in the last 30 days that used an offer, with their average
 * order value beside the orders that used none.
 *
 * A comparison, not a proof: a shopper buying five licences was going to spend
 * more anyway, so the numbers say whether an offer is being used and on what
 * size of order, not how much it caused. Orders placed before offers were
 * recorded are counted apart rather than folded into "no offer".
 */
export function OfferStatsPanel({ stats, show }: { stats: OfferStats; show: Group[] }) {
  const t = useT('marketingOffers');
  const money = (value: string | null): string => (value === null ? '—' : `$${value}`);
  const rows: { key: Group | 'others'; label: string }[] = [
    ...show.map((key) => ({
      key,
      label: key === 'volume' ? t('statsVolume') : key === 'pair' ? t('statsPair') : t('statsSale'),
    })),
    { key: 'others', label: t('statsOthers') },
  ];

  return (
    <section className="offers-stats" aria-labelledby="offers-stats">
      <h2 id="offers-stats">{t('statsTitle', { days: stats.days })}</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">{t('statsGroup')}</th>
            <th scope="col">{t('statsOrders')}</th>
            <th scope="col">{t('statsAverage')}</th>
            <th scope="col">{t('statsRevenue')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const group = stats[row.key];
            return (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td dir="ltr">{group.orders}</td>
                <td dir="ltr">{money(group.averageUsd)}</td>
                <td dir="ltr">{money(group.revenueUsd)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="lede-sm">{t('statsNote')}</p>
      {stats.untracked > 0 ? (
        <p className="lede-sm">{t('statsUntracked', { count: stats.untracked })}</p>
      ) : null}
    </section>
  );
}
