'use client';

import type { BusinessQuoteList } from '@da/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useT } from '../../../i18n/provider';
import { growthApi } from '../../../lib/growth-api';
import { messageOf, useStaff } from '../../content/shared';
import { Nav } from '../../nav';
import { GROWTH_ROLES, NumberField, useFeatureSettings } from '../growth-settings';

/**
 * Business quotes: the product-page link for buyers who need many licences,
 * and the requests it has brought in. The requests themselves are answered in
 * the messages inbox, where they arrive as the BUSINESS topic.
 */
export default function BusinessMarketingPage() {
  const me = useStaff();
  const t = useT('marketingBusiness');
  const m = useT('marketing');
  const c = useT('common');
  const allowed = me ? GROWTH_ROLES.includes(me.role) : false;
  const { draft, patch, save, saving, saved, error } = useFeatureSettings('business', allowed);
  const [quotes, setQuotes] = useState<BusinessQuoteList | null>(null);
  const [quotesError, setQuotesError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    void growthApi
      .businessQuotes()
      .then(setQuotes)
      .catch((caught: unknown) => setQuotesError(messageOf(caught, c('actionFailed'))));
  }, [allowed, c]);

  if (!me) return <div className="admin-layout">{c('loading')}</div>;

  return (
    <Nav me={me} current="marketing">
      <div className="queue-head">
        <p className="meta">
          <Link href="/marketing">{m('title')}</Link>
        </p>
        <h1>{m('businessTitle')}</h1>
        <p className="who">{t('lede')}</p>
      </div>

      {!allowed ? <p className="notice">{m('noAccess')}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {draft ? (
        <form
          className="promo-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="check">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => patch({ enabled: event.target.checked })}
            />
            <span>{t('enabled')}</span>
          </label>
          <NumberField
            label={t('minSeats')}
            hint={t('minSeatsHint')}
            value={draft.minSeats}
            min={2}
            max={1000}
            onChange={(minSeats) => patch({ minSeats })}
          />
          <label className="field">
            <span>{t('notifyEmail')}</span>
            <input
              type="email"
              dir="ltr"
              value={draft.notifyEmail}
              onChange={(event) => patch({ notifyEmail: event.target.value })}
              placeholder="sales@example.com"
            />
            <small>{t('notifyEmailHint')}</small>
          </label>
          <div className="actions">
            <button type="submit" disabled={saving}>
              {saving ? c('busy') : c('save')}
            </button>
            {saved ? <span className="ok-note">{t('saved')}</span> : null}
          </div>
        </form>
      ) : null}

      {allowed ? (
        <section className="vault-section">
          <h2>{t('recentTitle')}</h2>
          {quotesError ? <p className="error">{quotesError}</p> : null}
          {quotes ? (
            <>
              <p className="lede-sm">
                {t('recentSummary', { waiting: quotes.waiting, month: quotes.last30Days })}{' '}
                <Link href="/messages">{t('openInbox')}</Link>
              </p>
              {quotes.rows.length === 0 ? (
                <p className="notice">{t('none')}</p>
              ) : (
                <div className="table-scroll">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>{t('colDate')}</th>
                        <th>{t('colRequest')}</th>
                        <th>{t('colFrom')}</th>
                        <th>{t('colStatus')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quotes.rows.map((row) => (
                        <tr key={row.id}>
                          <td dir="ltr">{row.createdAt.slice(0, 10)}</td>
                          <td dir="auto">{row.summary}</td>
                          <td>
                            <span dir="auto">{row.name}</span>
                            <br />
                            <span className="meta" dir="ltr">
                              {row.email}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`pill ${row.status === 'NEW' ? 'pill-ready' : 'pill-draft'}`}
                            >
                              {row.status === 'NEW' ? t('statusNew') : t('statusHandled')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </section>
      ) : null}
    </Nav>
  );
}
