'use client';

import { type ContactTopic, CONTACT_REPLY_HOURS } from '@da/contracts';
import { useState } from 'react';

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
const TOPICS: { value: ContactTopic; ar: string; en: string }[] = [
  { value: 'ORDER', ar: 'استفسار عن طلب', en: 'About an order' },
  { value: 'ACTIVATION', ar: 'مشكلة تفعيل', en: 'Activation problem' },
  { value: 'PRESALE', ar: 'سؤال قبل الشراء', en: 'Question before buying' },
  { value: 'BUSINESS', ar: 'مبيعات الشركات', en: 'Business sales' },
  { value: 'OTHER', ar: 'أخرى', en: 'Something else' },
];

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function ContactForm({ locale }: { locale: string }) {
  const ar = locale === 'ar';

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
          locale: ar ? 'ar' : 'en',
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
            : ar
              ? 'تعذّر إرسال الرسالة. حاول بعد قليل.'
              : 'The message could not be sent. Try again shortly.',
        );
      }

      setSent(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : ar
            ? 'تعذّر إرسال الرسالة.'
            : 'The message could not be sent.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="contact-card">
        <p className="account-sent">
          {ar
            ? `وصلتنا رسالتك، وأرسلنا إليك تأكيداً على بريدك. نردّ خلال ${String(CONTACT_REPLY_HOURS)} ساعة كحدّ أقصى.`
            : `We have your message and sent a confirmation to your email. We reply within ${String(CONTACT_REPLY_HOURS)} hours at the latest.`}
        </p>
        <button type="button" className="btn btn-ghost" onClick={() => setSent(false)}>
          {ar ? 'أرسل رسالة أخرى' : 'Send another message'}
        </button>
      </div>
    );
  }

  return (
    <form
      className="contact-card"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <h2>{ar ? 'اكتب لنا' : 'Write to us'}</h2>

      <label className="account-field">
        {ar ? 'القسم' : 'Topic'}
        <select value={topic} onChange={(event) => setTopic(event.target.value as ContactTopic)}>
          {TOPICS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {ar ? entry.ar : entry.en}
            </option>
          ))}
        </select>
      </label>

      <div className="contact-row">
        <label className="account-field">
          {ar ? 'الاسم' : 'Name'}
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
          {ar ? 'البريد الإلكتروني' : 'Email'}
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
          {ar ? 'رقم الطلب (إن وُجد)' : 'Order number (if any)'}
          <input
            type="text"
            value={orderNumber}
            onChange={(event) => setOrderNumber(event.target.value)}
            dir="ltr"
            placeholder="DA-2026-00001"
          />
        </label>

        <label className="account-field">
          {ar ? 'الهاتف (اختياري)' : 'Phone (optional)'}
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
        {ar ? 'رسالتك' : 'Your message'}
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={6}
          required
          minLength={10}
          placeholder={
            ar
              ? 'صف المشكلة أو السؤال. إن كانت عن مفتاح، اذكر ما يظهر لك من رسالة خطأ.'
              : 'Describe the problem or the question. If it is about a key, quote the error you see.'
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
        disabled={busy || name.trim().length < 2 || message.trim().length < 10}
      >
        {busy ? '…' : ar ? 'أرسل' : 'Send'}
      </button>

      <p className="account-hint">
        {ar
          ? `نردّ خلال ${String(CONTACT_REPLY_HOURS)} ساعة كحدّ أقصى. لا نستخدم بريدك إلا للرد على رسالتك.`
          : `We reply within ${String(CONTACT_REPLY_HOURS)} hours at the latest, and use your address for nothing but that reply.`}
      </p>
    </form>
  );
}
