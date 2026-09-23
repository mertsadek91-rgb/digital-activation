'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { resolveLocale } from '../i18n/locale';

import { subscriptionsApi } from '../lib/subscriptions-client';

/**
 * "Email me when it is back", for a variant with no keys in stock.
 *
 * The out-of-stock pages carry the most traffic and have nothing to sell, and
 * the button that stood here did nothing. This one queues the address; the API
 * sends one email when keys arrive.
 */
export function StockAlert({ variantId, locale }: { variantId: string; locale: string }) {
  const t = useTranslations('stockAlert');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setStatus('loading');
    const ok = await subscriptionsApi.stockAlert({ email, variantId, locale: resolveLocale(locale) });
    setStatus(ok ? 'done' : 'error');
  }

  if (status === 'done') {
    return (
      <p className="oos-done" role="status">
        {t('done')}
      </p>
    );
  }

  return (
    <form className="oos-form" onSubmit={(event) => void submit(event)}>
      <label className="oos-label" htmlFor={`oos-${variantId}`}>
        {t('label')}
      </label>
      <div className="oos-row">
        <input
          id={`oos-${variantId}`}
          type="email"
          required
          dir="ltr"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t('placeholder')}
          disabled={status === 'loading'}
        />
        <button type="submit" className="btn" disabled={status === 'loading'}>
          {status === 'loading' ? '…' : t('submit')}
        </button>
      </div>
      {status === 'error' ? (
        <p className="error" role="alert">
          {t('error')}
        </p>
      ) : null}
    </form>
  );
}
