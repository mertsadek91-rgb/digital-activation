'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { isArabic, resolveLocale } from '../i18n/locale';

import { subscriptionsApi } from '../lib/subscriptions-client';

/**
 * Acts on the token in an emailed newsletter link, once, and says what
 * happened.
 *
 * A POST from the page rather than a GET the link itself performs: mail
 * scanners open links to check them, and a GET that confirmed or unsubscribed
 * would be done by the scanner before the person ever saw the email.
 */
export function NewsletterTokenPage({ mode }: { mode: 'confirm' | 'unsubscribe' }) {
  const params = useParams<{ locale: string }>();
  const t = useTranslations('newsletter');
  const locale = resolveLocale(params.locale);
  const prefix = isArabic(locale) ? '' : '/en';
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    const run =
      mode === 'confirm'
        ? subscriptionsApi.confirm({ token, locale })
        : subscriptionsApi.unsubscribe({ token });
    void run.then((ok) => setState(ok ? 'done' : 'failed'));
  }, [mode, locale]);

  const text = {
    working: t('working'),
    done:
      mode === 'confirm'
        ? t('confirmed')
        : t('unsubscribed'),
    failed: t('invalidLink'),
  }[state];

  return (
    <main className="shell">
      <h1>{t('metaTitle')}</h1>
      <p className="notice" role={state === 'failed' ? 'alert' : 'status'}>
        {text}
      </p>
      <Link href={`${prefix}/store`} className="btn btn-ghost">
        {t('theStore')}
      </Link>
    </main>
  );
}
