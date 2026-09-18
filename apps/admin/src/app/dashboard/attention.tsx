'use client';

import type { DashboardAttention } from '@da/contracts';

import { useT } from '../../i18n/provider';

/**
 * What is waiting on a person, loudest first.
 *
 * Rows the API sent as zero are already gone, so anything here is real. The
 * severity is carried by a spine on the leading edge as well as by the order —
 * a list where everything looks alike is a list whose first row is the only
 * one anybody reads.
 *
 * Classes of its own rather than the launch checklist's, which they started
 * out borrowing. That list is styled as a grid of cards, each with its title
 * stacked over its button, which is right for six paragraphs of explanation
 * and wrong for eight one-line counts: the same markup here produced rows
 * three times taller than their text, so half the list was below the fold.
 */
export function Attention({
  rows,
  onGo,
}: {
  rows: DashboardAttention[];
  onGo: (path: string) => void;
}) {
  const t = useT('dashboard');

  return (
    <section className="vault-section">
      <h2>{t('attentionTitle')}</h2>
      {rows.length === 0 ? (
        <p className="launch-verdict is-ready">{t('attentionEmpty')}</p>
      ) : (
        <ul className="dash-attention-list">
          {rows.map((row) => (
            <li key={row.key} className={`dash-attention is-${row.severity}`}>
              <strong className="dash-attention-count">{row.count}</strong>
              <span className="dash-attention-text">{t.tp(row.key, row.count)}</span>
              <button type="button" className="ghost btn-sm" onClick={() => onGo(row.fix)}>
                {t('open')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
