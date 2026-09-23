'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { resolveLocale } from '../i18n/locale';
import { growthApi } from '../lib/growth-client';

import { GrowthDialog } from './growth-dialog';

/**
 * "Need 10+ licences? Get a business quote."
 *
 * A link under the buy box whenever the feature is on, rather than one that
 * appears only when the quantity picker reaches the threshold: a buyer for an
 * office reads the product page before touching the picker, and the picker is
 * capped per line anyway. Buying any quantity directly stays possible — the
 * quote is an offer, not a gate.
 *
 * The form sends the product slug, not its name; the API writes the name.
 */
export function BusinessQuote({
  productSlug,
  productName,
  minSeats,
  locale,
}: {
  productSlug: string;
  productName: string;
  minSeats: number;
  locale: string;
}) {
  const t = useTranslations('businessQuote');
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [form, setForm] = useState({
    company: '',
    name: '',
    email: '',
    phone: '',
    vatNumber: '',
    seats: String(minSeats),
    message: '',
    website: '',
  });

  function field(key: keyof typeof form) {
    return {
      value: form[key],
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((current) => ({ ...current, [key]: event.target.value })),
    };
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setStatus('sending');
    const ok = await growthApi.businessQuote({
      company: form.company.trim(),
      name: form.name.trim(),
      email: form.email.trim(),
      ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      ...(form.vatNumber.trim() ? { vatNumber: form.vatNumber.trim() } : {}),
      productSlug,
      seats: Math.max(1, Number.parseInt(form.seats, 10) || minSeats),
      ...(form.message.trim() ? { message: form.message.trim() } : {}),
      locale: resolveLocale(locale),
      ...(form.website ? { website: form.website } : {}),
    });
    setStatus(ok ? 'sent' : 'error');
  }

  return (
    <div className="business-quote">
      <button type="button" className="business-quote-link" onClick={() => setOpen(true)}>
        {t('link', { count: minSeats })}
      </button>

      {open ? (
        <GrowthDialog title={t('title')} onClose={() => setOpen(false)}>
          {status === 'sent' ? (
            <p className="growth-sent" role="status">
              {t('sent')}
            </p>
          ) : (
            <form className="growth-form" onSubmit={(event) => void submit(event)}>
              <p className="growth-lede">{t('lede', { product: productName })}</p>
              <label>
                {t('company')}
                <input {...field('company')} required minLength={2} maxLength={160} />
              </label>
              <label>
                {t('name')}
                <input
                  {...field('name')}
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="name"
                />
              </label>
              <label>
                {t('email')}
                <input
                  {...field('email')}
                  type="email"
                  required
                  dir="ltr"
                  autoComplete="email"
                  maxLength={320}
                />
              </label>
              <div className="growth-row">
                <label>
                  {t('phone')} <span className="growth-optional">{t('optional')}</span>
                  <input
                    {...field('phone')}
                    type="tel"
                    dir="ltr"
                    autoComplete="tel"
                    maxLength={40}
                  />
                </label>
                <label>
                  {t('vatNumber')} <span className="growth-optional">{t('optional')}</span>
                  <input {...field('vatNumber')} dir="ltr" maxLength={40} />
                </label>
              </div>
              <label>
                {t('seats')}
                <input {...field('seats')} type="number" min={1} max={100000} required dir="ltr" />
              </label>
              <label>
                {t('message')} <span className="growth-optional">{t('optional')}</span>
                <textarea {...field('message')} rows={3} maxLength={3000} />
              </label>
              {/* Honeypot: hidden from people and from assistive technology. */}
              <input
                {...field('website')}
                className="growth-honeypot"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
              />
              {status === 'error' ? (
                <p className="error" role="alert">
                  {t('error')}
                </p>
              ) : null}
              <button type="submit" className="btn btn-primary" disabled={status === 'sending'}>
                {status === 'sending' ? '…' : t('submit')}
              </button>
            </form>
          )}
        </GrowthDialog>
      ) : null}
    </div>
  );
}
