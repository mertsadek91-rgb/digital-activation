'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

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
  const ar = (params.locale ?? 'ar') !== 'en';
  const prefix = ar ? '' : '/en';
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    const run =
      mode === 'confirm'
        ? subscriptionsApi.confirm({ token, locale: ar ? 'ar' : 'en' })
        : subscriptionsApi.unsubscribe({ token });
    void run.then((ok) => setState(ok ? 'done' : 'failed'));
  }, [mode, ar]);

  const text = {
    working: ar ? 'لحظة…' : 'One moment…',
    done:
      mode === 'confirm'
        ? ar
          ? 'تمّ تأكيد اشتراكك. ستصلك العروض الجديدة على بريدك.'
          : 'Your subscription is confirmed. New deals will reach your inbox.'
        : ar
          ? 'ألغينا اشتراكك. لن تصلك رسائل تسويقية بعد الآن.'
          : 'You are unsubscribed. You will receive no more marketing email.',
    failed: ar
      ? 'هذا الرابط غير صالح أو منتهٍ. اطلب رابطاً جديداً من أسفل أي صفحة.'
      : 'This link is not valid. Ask for a new one from the bottom of any page.',
  }[state];

  return (
    <main className="shell">
      <h1>{ar ? 'النشرة البريدية' : 'Newsletter'}</h1>
      <p className="notice" role={state === 'failed' ? 'alert' : 'status'}>
        {text}
      </p>
      <Link href={`${prefix}/store`} className="btn btn-ghost">
        {ar ? 'المتجر' : 'The store'}
      </Link>
    </main>
  );
}
