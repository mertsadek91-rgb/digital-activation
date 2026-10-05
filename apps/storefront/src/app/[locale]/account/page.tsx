'use client';

import { ROUTES } from '@da/contracts/constants';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useEffect, useState } from 'react';

import { ClientBreadcrumbs } from '../../../components/breadcrumbs-client';
import { CheckIcon, EnvelopeIcon, WarningIcon } from '../../../components/icons';
import { isArabic, resolveLocale } from '../../../i18n/locale';
import { accountApi, AccountError } from '../../../lib/account-client';

/**
 * Sign in to see your own licences — after the kit's login page (TASK-0105):
 * one centred card with the welcome, the one field and the one button.
 *
 * One field and no password. Every order here is a guest order, and the
 * licence was emailed to this address in the first place — so control of the
 * address is exactly the bar that already handed the key over. Saying that out
 * loud on the page matters as much as implementing it: a store that sells
 * activation keys and asks for no password looks broken unless it explains why.
 *
 * The same page handles the click from the email. The token arrives as a query
 * parameter, is traded for a session cookie, and is then stripped from the URL
 * with `replace` so it does not sit in history, in a bookmark, or in the
 * referrer of the next request.
 *
 * `useSearchParams` lives behind a Suspense boundary because reading the URL
 * forces everything up to the nearest one to render on the client; without it
 * the whole route is that boundary.
 */
export default function AccountPage() {
  return (
    <Suspense fallback={<main className="shell account-page" />}>
      <AccountEntry />
    </Suspense>
  );
}

function AccountEntry() {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const search = useSearchParams();
  const token = search.get('token');

  const t = useTranslations('account');
  const tc = useTranslations('common');
  const prefix = isArabic(params.locale) ? '' : `/${params.locale ?? 'en'}`;

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(token !== null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    void (async () => {
      try {
        await accountApi.exchange(token);
        if (cancelled) return;
        // `replace`, not `push`: the token must not be reachable with Back.
        router.replace(`${prefix}${ROUTES.licenses}`);
      } catch (caught) {
        if (cancelled) return;
        setExchanging(false);
        setError(caught instanceof AccountError ? caught.message : t('linkFailed'));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, router, prefix, t]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await accountApi.requestLink(email.trim(), resolveLocale(params.locale));
      setSent(true);
    } catch (caught) {
      setError(caught instanceof AccountError ? caught.message : t('sendFailed'));
    } finally {
      setBusy(false);
    }
  }

  const band = (
    <div className="page-band">
      <div className="shell">
        <ClientBreadcrumbs
          items={[
            { name: tc('home'), href: `${prefix}/` },
            { name: t('metaTitle'), href: `${prefix}${ROUTES.account}` },
          ]}
        />
        <header className="page-head">
          <h1>{t('metaTitle')}</h1>
        </header>
      </div>
    </div>
  );

  if (exchanging) {
    return (
      <>
        {band}
        <main className="shell account-page">
          <p className="notice" aria-busy="true">
            {t('signingIn')}
          </p>
        </main>
      </>
    );
  }

  return (
    <>
      {band}
      <main className="shell account-page">
        {sent ? (
          <div className="auth-card">
            <h2>{t('welcome')}</h2>
            <p className="alert" role="status">
              <CheckIcon size={20} />
              <span>{t('sent')}</span>
            </p>
            {/* Said plainly, because the alternative is a customer who waits for
              an email that was never going to arrive. */}
            <p className="account-hint">{t('sentHelp')}</p>
            <button type="button" className="btn btn-outline" onClick={() => setSent(false)}>
              {t('useAnother')}
            </button>
          </div>
        ) : (
          <form
            className="auth-card"
            onSubmit={(event) => {
              void submit(event);
            }}
          >
            <h2>{t('welcome')}</h2>
            <p className="lede">{t('intro')}</p>

            <label className="field">
              <span>{t('email')}</span>
              <span className="input-icon">
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  dir="ltr"
                  placeholder="you@example.com"
                />
                <EnvelopeIcon />
              </span>
            </label>

            {error ? (
              <p className="alert alert-error" role="alert">
                <WarningIcon size={20} />
                <span>{error}</span>
              </p>
            ) : null}

            <button
              type="submit"
              className="btn btn-primary btn-wide"
              disabled={busy || email.length < 5}
            >
              {busy ? '…' : t('sendLink')}
            </button>

            {/* Why there is no password field. Without this the page reads as
              unfinished, and a customer who expects a password assumes they
              are on the wrong site. */}
            <p className="account-hint">{t('noPassword')}</p>
          </form>
        )}
      </main>
    </>
  );
}
