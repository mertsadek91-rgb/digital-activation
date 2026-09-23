'use client';

import { useState } from 'react';

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
  const ar = locale !== 'en';
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!email.includes('@')) {
      setStatus('error');
      return;
    }
    setStatus('loading');
    const ok = await subscriptionsApi.subscribe({ email, locale: ar ? 'ar' : 'en' });
    setStatus(ok ? 'sent' : 'error');
    if (ok) setEmail('');
  }

  return (
    <div className="footer-newsletter-card">
      <div className="newsletter-text">
        <div className="newsletter-headline">
          <h3>{ar ? 'عروض التراخيص في بريدك' : 'Licence deals in your inbox'}</h3>
        </div>
        <p>
          {ar
            ? 'نرسل العروض والإصدارات الجديدة فقط، ويمكنك إلغاء الاشتراك في أي وقت.'
            : 'Deals and new releases only, and you can unsubscribe at any time.'}
        </p>
      </div>

      <div className="newsletter-form-wrap">
        {status === 'sent' ? (
          <div className="newsletter-success" role="status">
            <span className="success-icon">✓</span>
            <span>
              {ar
                ? 'أرسلنا رسالة تأكيد إلى بريدك. اضغط الرابط فيها لإتمام الاشتراك.'
                : 'We sent a confirmation email. Follow its link to finish subscribing.'}
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
                placeholder={ar ? 'بريدك الإلكتروني' : 'Your email address'}
                aria-label={ar ? 'البريد الإلكتروني للاشتراك' : 'Email for the newsletter'}
                className={`newsletter-input${status === 'error' ? ' is-error' : ''}`}
                disabled={status === 'loading'}
                dir="ltr"
                required
              />
              <button type="submit" disabled={status === 'loading'} className="newsletter-submit">
                {status === 'loading' ? '…' : ar ? 'اشترك' : 'Subscribe'}
              </button>
            </div>
            {status === 'error' ? (
              <p className="newsletter-error-msg" role="alert">
                {ar
                  ? 'تعذّر الاشتراك. تأكّد من البريد وأعد المحاولة.'
                  : 'Could not subscribe. Check the address and try again.'}
              </p>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}
