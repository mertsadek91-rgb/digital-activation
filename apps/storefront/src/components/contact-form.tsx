'use client';

import { type ContactTopic, CONTACT_REPLY_HOURS } from '@da/contracts';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { resolveLocale } from '../i18n/locale';

/**
 * The contact form.
 *
 * Short on purpose: every extra field is a customer who gives up halfway. The
 * topic is a select because it changes how the message is read on the other
 * end — an activation failure on a paid order is not a pre-sales question —
 * and the order number is asked for because a message about an order that does
 * not name one costs a round trip before anything can start.
 *
 * The honeypot is a real input, hidden from people and from screen readers,
 * that no human ever fills. A submission carrying it is accepted and dropped
 * by the API; refusing it would teach a bot what to change.
 */
const TOPICS: ContactTopic[] = ['ORDER', 'ACTIVATION', 'PRESALE', 'BUSINESS', 'OTHER'];

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function ContactForm({ locale }: { locale: string }) {
  const t = useTranslations('contactForm');

  const [topic, setTopic] = useState<ContactTopic>('ORDER');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(new URL('/v1/content/contact', API), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          topic,
          name: name.trim(),
          email: email.trim(),
          message: message.trim(),
          locale: resolveLocale(locale),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(orderNumber.trim() ? { orderNumber: orderNumber.trim() } : {}),
          ...(website ? { website } : {}),
        }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const record = (payload ?? {}) as Record<string, unknown>;
        throw new Error(
          typeof record.message === 'string'
            ? record.message
            : t('sendFailedRetry'),
        );
      }

      setSent(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t('sendFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="contact-card contact-form-card">
        <p className="account-sent">
          {t('sent', { hours: String(CONTACT_REPLY_HOURS) })}
        </p>
        <button type="button" className="btn btn-ghost" onClick={() => setSent(false)}>
          {t('sendAnother')}
        </button>
      </div>
    );
  }

  return (
    <form
      className="contact-card contact-form-card"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="contact-card-header">
        <h2>{t('title')}</h2>
        <p>
          {t('intro')}
        </p>
      </div>

      <label className="account-field">
        {t('topic')}
        <select value={topic} onChange={(event) => setTopic(event.target.value as ContactTopic)}>
          {TOPICS.map((entry) => (
            <option key={entry} value={entry}>
              {t(`topic${entry}`)}
            </option>
          ))}
        </select>
      </label>

      <div className="contact-row">
        <label className="account-field">
          {t('name')}
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
            autoComplete="name"
          />
        </label>

        <label className="account-field">
          {t('email')}
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            dir="ltr"
            autoComplete="email"
            placeholder="you@example.com"
          />
        </label>
      </div>

      <div className="contact-row">
        <label className="account-field">
          {t('orderNumber')}
          <input
            type="text"
            value={orderNumber}
            onChange={(event) => setOrderNumber(event.target.value)}
            dir="ltr"
            placeholder="DA-2026-00001"
          />
        </label>

        <label className="account-field">
          {t('phone')}
          <input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            dir="ltr"
            autoComplete="tel"
          />
        </label>
      </div>

      <label className="account-field">
        {t('message')}
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={6}
          required
          minLength={10}
          placeholder={
            t('messagePlaceholder')
          }
        />
      </label>

      {/* The honeypot. Hidden from people and from assistive technology, and
          left in the tab order's blind spot — a bot fills every input it finds
          and a person never sees this one. */}
      <div className="hp" aria-hidden="true">
        <label>
          Website
          <input
            type="text"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            tabIndex={-1}
            autoComplete="off"
          />
        </label>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <button
        type="submit"
        className="btn btn-primary"
        style={{ minBlockSize: '48px', fontSize: 'var(--text-base)' }}
        disabled={busy || name.trim().length < 2 || message.trim().length < 10}
      >
        {busy ? (t('sending')) : t('submit')}
      </button>

      <p className="account-hint">
        {t('hint', { hours: String(CONTACT_REPLY_HOURS) })}
      </p>
    </form>
  );
}
