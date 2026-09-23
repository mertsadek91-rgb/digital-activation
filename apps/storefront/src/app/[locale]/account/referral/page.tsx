'use client';

import type { MyReferral } from '@da/contracts';
import { ROUTES } from '@da/contracts';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { AccountNav } from '../../../../components/account-nav';
import { isArabic, resolveLocale } from '../../../../i18n/locale';
import { ReferralAuthError, growthApi } from '../../../../lib/growth-client';

/**
 * ادعُ صديقاً — the customer's own referral link.
 *
 * One stable link, a copy button and a WhatsApp share, and the terms written
 * out: the friend's discount is for their first order only, and the reward
 * arrives as a single-use code after the friend's order has cleared the
 * refund window. Counts only — the friends' addresses are never shown here.
 */
export default function ReferralAccountPage() {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = resolveLocale(params.locale);
  const prefix = isArabic(locale) ? '' : `/${locale}`;
  const t = useTranslations('account');
  const tr = useTranslations('referral');

  const [data, setData] = useState<MyReferral | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setData(await growthApi.myReferral());
      } catch (caught) {
        if (caught instanceof ReferralAuthError) {
          router.replace(`${prefix}${ROUTES.account}`);
          return;
        }
        setError(true);
      }
    })();
  }, [prefix, router]);

  const link =
    data?.code && typeof window !== 'undefined'
      ? `${window.location.origin}${prefix}/r/${data.code}`
      : null;

  async function copy(): Promise<void> {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard refused (permissions, an old browser): the link is on screen
      // and selectable, which is the fallback.
      setCopied(false);
    }
  }

  return (
    <main className="shell account-page">
      <header className="page-head">
        <h1>{tr('accountTitle')}</h1>
      </header>

      <AccountNav prefix={prefix} />

      {error ? <p className="error">{t('sendFailed')}</p> : null}
      {!data && !error ? <p className="meta">…</p> : null}
      {data && !data.enabled ? <p className="notice">{tr('off')}</p> : null}

      {data?.enabled && link ? (
        <section className="referral-card">
          <p className="lede">
            {tr('terms', {
              percent: data.friendPercent,
              reward: data.referrerRewardUsd.toFixed(2),
              days: data.clearAfterDays,
            })}
            {data.licenceNumber ? (
              <small className="growth-licence">
                {' '}
                {tr('licence')} <span dir="ltr">{data.licenceNumber}</span>
              </small>
            ) : null}
          </p>

          <label className="referral-link">
            {tr('yourLink')}
            <input readOnly value={link} dir="ltr" onFocus={(event) => event.target.select()} />
          </label>

          <div className="referral-actions">
            <button type="button" className="btn btn-primary" onClick={() => void copy()}>
              {copied ? tr('copied') : tr('copy')}
            </button>
            <a
              className="btn btn-ghost"
              href={`https://wa.me/?text=${encodeURIComponent(
                tr('shareText', { percent: data.friendPercent, link }),
              )}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {tr('shareWhatsApp')}
            </a>
          </div>

          <dl className="referral-counts">
            <div>
              <dt>{tr('pending')}</dt>
              <dd>{data.pending}</dd>
            </div>
            <div>
              <dt>{tr('rewarded')}</dt>
              <dd>{data.rewarded}</dd>
            </div>
          </dl>
          <p className="account-hint">{tr('fineprint')}</p>
        </section>
      ) : null}
    </main>
  );
}
