'use client';

import { useState } from 'react';

interface FooterNewsletterProps {
  locale: string;
}

export function FooterNewsletter({ locale }: FooterNewsletterProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const ar = locale !== 'en';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setStatus('error');
      return;
    }
    setStatus('loading');
    // Simulated subscription with instant feedback
    setTimeout(() => {
      setStatus('success');
      setEmail('');
    }, 600);
  };

  return (
    <div className="footer-newsletter-card">
      <div className="newsletter-text">
        <div className="newsletter-headline">
          <span className="newsletter-badge">🎁 {ar ? 'نادي التفعيل الرقمي' : 'VIP Club'}</span>
          <h3>{ar ? 'انضم لنادي العروض والخصومات الحصرية' : 'Get exclusive discounts & license deals'}</h3>
        </div>
        <p>
          {ar
            ? 'اشترك ليصلك أحدث كوبونات التخفيض وتحديثات الإصدارات الجديدة فور صدورها.'
            : 'Subscribe for instant access to member-only coupon drops and software releases.'}
        </p>
      </div>

      <div className="newsletter-form-wrap">
        {status === 'success' ? (
          <div className="newsletter-success" role="alert">
            <span className="success-icon">✓</span>
            <span>
              {ar
                ? 'تم الاشتراك بنجاح! تفقد بريدك قريباً لكوبون الترحيب.'
                : 'Subscribed successfully! Check your inbox soon for your welcome offer.'}
            </span>
          </div>
        ) : (
          <form className="newsletter-form" onSubmit={handleSubmit} noValidate>
            <div className="newsletter-input-group">
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (status === 'error') setStatus('idle');
                }}
                placeholder={ar ? 'أدخل بريدك الإلكتروني...' : 'Enter your email address...'}
                aria-label={ar ? 'البريد الإلكتروني للاشتراك' : 'Email subscription'}
                className={`newsletter-input${status === 'error' ? ' is-error' : ''}`}
                disabled={status === 'loading'}
                required
              />
              <button
                type="submit"
                disabled={status === 'loading'}
                className="newsletter-submit"
              >
                {status === 'loading'
                  ? (ar ? 'جاري التسجيل...' : 'Subscribing...')
                  : (ar ? 'اشترك الآن' : 'Subscribe')}
              </button>
            </div>
            {status === 'error' && (
              <p className="newsletter-error-msg">
                {ar ? 'يرجى إدخال بريد إلكتروني صحيح' : 'Please enter a valid email address'}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
