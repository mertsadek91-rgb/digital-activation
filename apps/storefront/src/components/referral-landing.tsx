'use client';

import { ROUTES } from '@da/contracts';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { isArabic } from '../i18n/locale';
import { growthApi, publicMarketing } from '../lib/growth-client';

/**
 * A followed referral link.
 *
 * Says what the friend gets and when, before they spend anything: the
 * discount is on a first order only, and it is applied in the cart
 * automatically — there is no code to copy.
 */
export function ReferralLanding({ code, locale }: { code: string; locale: string }) {
  const t = useTranslations('referral');
  const prefix = isArabic(locale) ? '' : `/${locale}`;
  const [state, setState] = useState<'working' | 'ok' | 'invalid'>('working');
  const [offer, setOffer] = useState<{ percent: number; licence: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const valid = /^[A-Za-z0-9]{4,16}$/.test(code);
      const [result, marketing] = await Promise.all([
        valid ? growthApi.visitReferral(code) : Promise.resolve({ ok: false, attached: false }),
        publicMarketing(),
      ]);
      if (cancelled) return;
      if (marketing?.referral) {
        setOffer({
          percent: marketing.referral.friendPercent,
          licence: marketing.referral.licenceNumber,
        });
      }
      setState(result.ok ? 'ok' : 'invalid');
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <main className="shell referral-landing">
      {state === 'working' ? <p className="notice">{t('working')}</p> : null}
      {state === 'ok' ? (
        <>
          <h1>{t('landingTitle')}</h1>
          <p className="lede">
            {offer ? t('landingOffer', { percent: offer.percent }) : t('landingGeneric')}
            {offer?.licence ? (
              <small className="growth-licence">
                {' '}
                {t('licence')} <span dir="ltr">{offer.licence}</span>
              </small>
            ) : null}
          </p>
          <p>{t('landingHow')}</p>
        </>
      ) : null}
      {state === 'invalid' ? (
        <>
          <h1>{t('invalidTitle')}</h1>
          <p className="lede">{t('invalidBody')}</p>
        </>
      ) : null}
      {state !== 'working' ? (
        <Link className="btn btn-primary" href={`${prefix}${ROUTES.store}`}>
          {t('browse')}
        </Link>
      ) : null}
    </main>
  );
}
