'use client';

import type { WelcomeStats } from '@da/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useT } from '../../../i18n/provider';
import { growthApi } from '../../../lib/growth-api';
import { messageOf, useStaff } from '../../content/shared';
import { Nav } from '../../nav';
import { GROWTH_ROLES, NumberField, useFeatureSettings } from '../growth-settings';

/**
 * The sign-up window: when it opens, what it says, and whether a confirmed
 * sign-up earns a first-order code.
 *
 * The preview shows the window as a visitor will see it in each language,
 * including the consent line, because that line is not optional and the
 * headline has to read well above it.
 */
export default function WelcomeMarketingPage() {
  const me = useStaff();
  const t = useT('marketingWelcome');
  const m = useT('marketing');
  const c = useT('common');
  const allowed = me ? GROWTH_ROLES.includes(me.role) : false;
  const { draft, patch, save, saving, saved, error } = useFeatureSettings('welcome', allowed);
  const [stats, setStats] = useState<WelcomeStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    void growthApi
      .welcomeStats()
      .then(setStats)
      .catch((caught: unknown) => setStatsError(messageOf(caught, c('actionFailed'))));
  }, [allowed, c]);

  if (!me) return <div className="admin-layout">{c('loading')}</div>;

  return (
    <Nav me={me} current="marketing">
      <div className="queue-head">
        <p className="meta">
          <Link href="/marketing">{m('title')}</Link>
        </p>
        <h1>{m('welcomeTitle')}</h1>
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

          <label className="field">
            <span>{t('trigger')}</span>
            <select
              value={draft.trigger}
              onChange={(event) =>
                patch({ trigger: event.target.value === 'delay' ? 'delay' : 'exit' })
              }
            >
              <option value="exit">{t('triggerExit')}</option>
              <option value="delay">{t('triggerDelay')}</option>
            </select>
            <small>{t('triggerHint')}</small>
          </label>
          <NumberField
            label={t('delaySeconds')}
            value={draft.delaySeconds}
            min={5}
            max={300}
            onChange={(delaySeconds) => patch({ delaySeconds })}
          />
          <NumberField
            label={t('frequencyDays')}
            hint={t('frequencyDaysHint')}
            value={draft.frequencyDays}
            min={1}
            max={365}
            onChange={(frequencyDays) => patch({ frequencyDays })}
          />

          <label className="field">
            <span>{t('headlineAr')}</span>
            <input
              dir="rtl"
              value={draft.headline.ar}
              maxLength={500}
              onChange={(event) =>
                patch({ headline: { ...draft.headline, ar: event.target.value } })
              }
            />
          </label>
          <label className="field">
            <span>{t('headlineEn')}</span>
            <input
              dir="ltr"
              value={draft.headline.en}
              maxLength={500}
              onChange={(event) =>
                patch({ headline: { ...draft.headline, en: event.target.value } })
              }
            />
            <small>{t('headlineHint')}</small>
          </label>

          <NumberField
            label={t('discountPercent')}
            hint={t('discountPercentHint')}
            value={draft.discountPercent}
            min={0}
            max={90}
            onChange={(discountPercent) => patch({ discountPercent })}
          />
          <NumberField
            label={t('discountValidDays')}
            value={draft.discountValidDays}
            min={1}
            max={90}
            onChange={(discountValidDays) => patch({ discountValidDays })}
          />
          <label className="field">
            <span>{t('licenceNumber')}</span>
            <input
              dir="ltr"
              value={draft.discountLicenceNumber}
              maxLength={100}
              onChange={(event) => patch({ discountLicenceNumber: event.target.value })}
            />
            <small>{t('licenceNumberHint')}</small>
          </label>

          <div className="actions">
            <button type="submit" disabled={saving}>
              {saving ? c('busy') : c('save')}
            </button>
            {saved ? <span className="ok-note">{t('saved')}</span> : null}
          </div>
        </form>
      ) : null}

      {draft ? (
        <section className="vault-section">
          <h2>{t('previewTitle')}</h2>
          <div className="growth-preview-pair">
            {(['ar', 'en'] as const).map((lang) => (
              <div
                key={lang}
                className="growth-preview"
                dir={lang === 'ar' ? 'rtl' : 'ltr'}
                lang={lang}
              >
                <strong>
                  {draft.headline[lang] ||
                    (lang === 'ar' ? t('previewDefaultAr') : t('previewDefaultEn'))}
                </strong>
                {draft.discountPercent > 0 ? (
                  <p>
                    {lang === 'ar'
                      ? t('previewCodeAr', { percent: draft.discountPercent })
                      : t('previewCodeEn', { percent: draft.discountPercent })}
                    {draft.discountLicenceNumber ? (
                      <small>
                        {' '}
                        ({lang === 'ar' ? t('previewLicenceAr') : t('previewLicenceEn')}{' '}
                        <span dir="ltr">{draft.discountLicenceNumber}</span>)
                      </small>
                    ) : null}
                  </p>
                ) : null}
                <input type="email" disabled placeholder="you@example.com" dir="ltr" />
                <small>{lang === 'ar' ? t('previewConsentAr') : t('previewConsentEn')}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {allowed ? (
        <section className="vault-section">
          <h2>{t('statsTitle', { days: stats?.sinceDays ?? 90 })}</h2>
          {statsError ? <p className="error">{statsError}</p> : null}
          {stats ? (
            <dl className="growth-figures">
              <div>
                <dt>{t('captures')}</dt>
                <dd>{stats.captures}</dd>
              </div>
              <div>
                <dt>{t('confirmations')}</dt>
                <dd>{stats.confirmations}</dd>
              </div>
              <div>
                <dt>{t('codesIssued')}</dt>
                <dd>{stats.codesIssued}</dd>
              </div>
              <div>
                <dt>{t('codesRedeemed')}</dt>
                <dd>{stats.codesRedeemed}</dd>
              </div>
            </dl>
          ) : null}
          <p className="lede-sm">{t('statsHint')}</p>
        </section>
      ) : null}
    </Nav>
  );
}
