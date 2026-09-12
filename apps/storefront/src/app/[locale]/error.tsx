'use client';

import { useEffect } from 'react';

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
 * A client component by necessity — an error boundary has to be — so it reads
 * the language from the document rather than from a param it cannot receive.
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

  const ar = typeof document === 'undefined' || document.documentElement.lang !== 'en';

  return (
    <main className="shell missing">
      <header className="page-head">
        <h1>{ar ? 'حدث خطأ عندنا' : 'Something went wrong on our side'}</h1>
        <p className="lede">
          {ar
            ? 'الصفحة موجودة، لكن تحميلها تعذّر الآن. حاوِل مرّة أخرى — وإن تكرّر، راسِلنا ولن يضيع طلبك.'
            : 'The page exists, but it could not be loaded just now. Try again — and if it keeps happening, write to us; your order is not lost.'}
        </p>
      </header>

      <p className="missing-actions">
        <button type="button" className="btn btn-primary" onClick={reset}>
          {ar ? 'حاوِل مرّة أخرى' : 'Try again'}
        </button>
        <a className="btn btn-ghost" href={ar ? '/contact' : '/en/contact'}>
          {ar ? 'راسِلنا' : 'Write to us'}
        </a>
      </p>

      {error.digest ? (
        <p className="missing-hint">
          {ar ? 'رقم الخطأ للدعم: ' : 'Reference for support: '}
          <code dir="ltr">{error.digest}</code>
        </p>
      ) : null}
    </main>
  );
}
