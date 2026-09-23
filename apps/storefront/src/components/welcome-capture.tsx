'use client';

import type { PublicMarketing } from '@da/contracts';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { resolveLocale } from '../i18n/locale';
import {
  SUBSCRIBED_KEY,
  WELCOME_SEEN_KEY,
  growthApi,
  memory,
  publicMarketing,
} from '../lib/growth-client';

import { GrowthDialog } from './growth-dialog';

/**
 * Paths the window never opens on. Somebody paying, reading their licences or
 * looking at an order is doing the thing the window is meant to lead to.
 */
const QUIET = [
  /\/cart(\/|$)/,
  /\/checkout(\/|$)/,
  /\/account(\/|$)/,
  /\/orders(\/|$)/,
  /\/newsletter(\/|$)/,
  /\/r\//,
];

/** Exit intent is not armed for the first seconds: never on first paint. */
const ARM_AFTER_MS = 5_000;
const DAY_MS = 86_400_000;

type Welcome = NonNullable<PublicMarketing['welcome']>;

/**
 * The welcome window: one email field and an explicit consent line.
 *
 * It opens on exit intent on a desktop pointer (the cursor leaving through the
 * top of the page), and after `delaySeconds` on touch screens — which have no
 * exit intent — or when the delay trigger is chosen. Once opened it stays away
 * for `frequencyDays`, and never comes back in a browser that has already asked
 * for the newsletter from here or from the footer.
 *
 * The submit is the ordinary double opt-in: a confirmation email and nothing
 * else. Any code is minted after the link in it is followed. There is no wheel,
 * scratch card or draw — a chance element is a licensed contest in Saudi law.
 */
export function WelcomeCapture({ locale }: { locale: string }) {
  const pathname = usePathname();
  const [settings, setSettings] = useState<Welcome | null>(null);
  const [open, setOpen] = useState(false);
  const quiet = QUIET.some((pattern) => pattern.test(pathname));

  useEffect(() => {
    let cancelled = false;
    void publicMarketing().then((value) => {
      if (!cancelled) setSettings(value?.welcome ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settings || quiet || open) return;
    if (memory.get(SUBSCRIBED_KEY)) return;
    const seen = Number(memory.get(WELCOME_SEEN_KEY) ?? 0);
    if (seen && Date.now() - seen < settings.frequencyDays * DAY_MS) return;

    const show = (): void => {
      memory.set(WELCOME_SEEN_KEY, String(Date.now()));
      setOpen(true);
    };

    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (settings.trigger === 'exit' && finePointer) {
      const armedAt = Date.now() + ARM_AFTER_MS;
      const onLeave = (event: MouseEvent): void => {
        if (Date.now() < armedAt) return;
        if (event.relatedTarget === null && event.clientY <= 0) show();
      };
      document.addEventListener('mouseout', onLeave);
      return () => document.removeEventListener('mouseout', onLeave);
    }

    const timer = window.setTimeout(show, Math.max(5, settings.delaySeconds) * 1000);
    return () => window.clearTimeout(timer);
  }, [settings, quiet, open]);

  if (!open || !settings || quiet) return null;
  return <WelcomeDialog settings={settings} locale={locale} onClose={() => setOpen(false)} />;
}

function WelcomeDialog({
  settings,
  locale,
  onClose,
}: {
  settings: Welcome;
  locale: string;
  onClose: () => void;
}) {
  const t = useTranslations('welcome');
  const lang = resolveLocale(locale);
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const headline = settings.headline[lang] || t('defaultHeadline');

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!consent || !email.includes('@')) {
      setStatus('error');
      return;
    }
    setStatus('sending');
    const ok = await growthApi.welcomeSubscribe({ email: email.trim(), locale: lang });
    if (ok) memory.set(SUBSCRIBED_KEY, String(Date.now()));
    setStatus(ok ? 'sent' : 'error');
  }

  return (
    <GrowthDialog title={headline} onClose={onClose} className="welcome-dialog">
      {status === 'sent' ? (
        <p className="growth-sent" role="status">
          {settings.discountPercent > 0 ? t('sentWithCode') : t('sent')}
        </p>
      ) : (
        <form className="growth-form" onSubmit={(event) => void submit(event)} noValidate>
          {settings.discountPercent > 0 ? (
            <p className="growth-lede">
              {t('offer', { percent: settings.discountPercent })}
              {settings.discountLicenceNumber ? (
                <small className="growth-licence">
                  {' '}
                  {t('licence')} <span dir="ltr">{settings.discountLicenceNumber}</span>
                </small>
              ) : null}
            </p>
          ) : (
            <p className="growth-lede">{t('body')}</p>
          )}
          <label>
            {t('email')}
            <input
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (status === 'error') setStatus('idle');
              }}
              required
              dir="ltr"
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>
          <label className="growth-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              required
            />
            <span>{t('consent')}</span>
          </label>
          {status === 'error' ? (
            <p className="error" role="alert">
              {consent ? t('error') : t('needConsent')}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={status === 'sending'}>
            {status === 'sending' ? '…' : t('submit')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('noThanks')}
          </button>
        </form>
      )}
    </GrowthDialog>
  );
}
