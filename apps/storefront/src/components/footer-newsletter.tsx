'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { resolveLocale } from '../i18n/locale';

import { SUBSCRIBED_KEY, memory } from '../lib/growth-client';
import { subscriptionsApi } from '../lib/subscriptions-client';

/**
 * The footer newsletter, for real this time.
 *
 * The version before this waited 600ms and announced a subscription and a
 * welcome coupon while sending the address nowhere. This one posts it, and
 * what it says afterwards is what actually happens next: a confirmation email.
 * No coupon is promised, because none is issued.
 */
export function FooterNewsletter({ locale }: { locale: string }) {
  const t = useTranslations('newsletter');
  const ts = useTranslations('stockAlert');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!email.includes('@')) {
      setStatus('error');
      return;
    }
    setStatus('loading');
    const ok = await subscriptionsApi.subscribe({ email, locale: resolveLocale(locale) });
    setStatus(ok ? 'sent' : 'error');
    if (ok) {
      setEmail('');
      // The welcome window does not ask a browser that has already asked here.
      memory.set(SUBSCRIBED_KEY, String(Date.now()));
    }
  }

  return (
    <div className="footer-newsletter-card">
      <div className="newsletter-text">
        <div className="newsletter-headline">
          <h3>{t('title')}</h3>
        </div>
        <p>
          {t('body')}
        </p>
      </div>

      <div className="newsletter-form-wrap">
        {status === 'sent' ? (
          <div className="newsletter-success" role="status">
            <span className="success-icon">✓</span>
            <span>
              {t('sent')}
            </span>
          </div>
        ) : (
          <form className="newsletter-form" onSubmit={(event) => void submit(event)} noValidate>
            <div className="newsletter-input-group">
              <input
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (status === 'error') setStatus('idle');
                }}
                placeholder={ts('placeholder')}
                aria-label={t('inputLabel')}
                className={`newsletter-input${status === 'error' ? ' is-error' : ''}`}
                disabled={status === 'loading'}
                dir="ltr"
                required
              />
              <button type="submit" disabled={status === 'loading'} className="newsletter-submit">
                {status === 'loading' ? '…' : t('subscribe')}
              </button>
            </div>
            {status === 'error' ? (
              <p className="newsletter-error-msg" role="alert">
                {t('error')}
              </p>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}
