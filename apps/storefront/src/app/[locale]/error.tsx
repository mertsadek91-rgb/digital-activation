'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { isArabic } from '../../i18n/locale';

/**
 * What a visitor sees when something on this side actually broke.
 *
 * Distinct from `not-found.tsx` on purpose, and the difference is not
 * cosmetic: a 404 means the page is gone and the honest advice is to look
 * elsewhere, while this means the page is fine and the store failed. Telling
 * somebody mid-purchase to "browse the store" when the checkout threw is
 * advice that loses the order — so the action here is "try again", and the
 * second line is where to write if it keeps happening.
 *
 * The message from the exception is deliberately not shown. It is written by
 * the server, it is written in English, and on this store it can name an
 * internal route or a database constraint. `digest` is Next's own hash of it,
 * which is safe to print and is the one string that lets somebody match what
 * the visitor saw against a line in the log.
 *
 * A client component by necessity — an error boundary has to be — so it takes
 * the language from the locale layout's intl provider, which wraps it, rather
 * than from a param it cannot receive.
 */
export default function StoreError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Into the browser console and nowhere else. There is no error-reporting
    // endpoint on this store yet, and inventing one here would put whatever the
    // exception says into a request body — which is the thing this component
    // is careful not to display.
    console.error(error);
  }, [error]);

  const t = useTranslations('errors');
  const ar = isArabic(useLocale());

  return (
    <main className="shell missing">
      <header className="page-head">
        <h1>{t('title')}</h1>
        <p className="lede">{t('body')}</p>
      </header>

      <p className="missing-actions">
        <button type="button" className="btn btn-primary" onClick={reset}>
          {t('retry')}
        </button>
        <a className="btn btn-ghost" href={ar ? '/contact' : '/en/contact'}>
          {t('contact')}
        </a>
      </p>

      {error.digest ? (
        <p className="missing-hint">
          {t.rich('reference', {
            digest: error.digest,
            code: (chunks) => <code dir="ltr">{chunks}</code>,
          })}
        </p>
      ) : null}
    </main>
  );
}
