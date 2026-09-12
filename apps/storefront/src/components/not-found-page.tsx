'use client';

import type { Suggestion } from '@da/contracts';
import { ROUTES } from '@da/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * The whole 404, in the browser, and not by preference.
 *
 * Next's own documentation names this app's exact shape as one of the two
 * cases where a 404 cannot be composed from a layout plus a `not-found` file:
 * "your root layout is defined using top-level dynamic segments (e.g.
 * `app/[country]/layout.tsx`)". This store's root layout is
 * `app/[locale]/layout.tsx`, because Arabic is served from `/` and English
 * from `/en` — so what Next sends for a `notFound()` is an `<html
 * id="__next_error__">` with an empty body, and the page arrives on hydration
 * whatever is written in it. `getLocale()` returns an empty string in that
 * context for the same reason: there is no resolved request config behind it.
 *
 * The documented answer, `global-not-found.js`, does not apply either: it
 * handles URLs that match no route at all, and every 404 on this site is a
 * `notFound()` from the catch-all, which matches everything.
 *
 * So rather than pretend, the page is a client component and reads what it
 * needs from the one thing that is reliable there — the path. Which the Next
 * documentation endorses in as many words: "If you need to use Client
 * Component hooks like `usePathname` to display content based on the path, you
 * must fetch data on the client-side instead."
 *
 * `dir` and `lang` are written on this element rather than on `<html>`,
 * because `<html>` here is Next's and carries neither. Without them an Arabic
 * 404 renders left-to-right with its punctuation in the wrong place — which is
 * the single most visible thing on the page.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const KIND_AR: Record<Suggestion['kind'], string> = {
  product: 'منتج',
  collection: 'قسم',
  page: 'صفحة',
};

const KIND_EN: Record<Suggestion['kind'], string> = {
  product: 'Product',
  collection: 'Category',
  page: 'Page',
};

export function NotFoundPage() {
  const pathname = usePathname();
  const en = pathname === '/en' || pathname.startsWith('/en/');
  const ar = !en;
  const prefix = en ? '/en' : '';

  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          new URL(
            `/v1/content/suggest?path=${encodeURIComponent(pathname)}&locale=${en ? 'en' : 'ar'}`,
            API,
          ),
          { cache: 'no-store' },
        );
        if (!response.ok) throw new Error('no suggestions');
        const payload = (await response.json()) as { suggestions?: Suggestion[] };
        if (!cancelled) setSuggestions(payload.suggestions ?? []);
      } catch {
        // A dead end that cannot reach the API is still a dead end with a way
        // out: the two buttons below do not depend on this.
        if (!cancelled) setSuggestions([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, en]);

  // The miss is not reported from here. `goneOrRedirect` already did it on the
  // server with the real referrer header — the field that tells somebody's
  // broken link apart from a crawler guessing — and reporting it again would
  // double every count on the panel's 404 list.

  return (
    <main className="shell missing" dir={ar ? 'rtl' : 'ltr'} lang={ar ? 'ar' : 'en'}>
      <header className="page-head">
        <h1>{ar ? 'هذه الصفحة لم تعد هنا' : 'This page is not here any more'}</h1>
        <p className="lede">
          {ar
            ? 'ربما تغيّر رابطها مع تحديث المتجر، أو نُسخ الرابط ناقصاً. المنتج نفسه غالباً ما زال موجوداً.'
            : 'Its address may have changed when the store was rebuilt, or the link may have been copied short. The product itself is most likely still here.'}
        </p>
      </header>

      <p className="missing-actions">
        <Link className="btn btn-primary" href={`${prefix}${ROUTES.store}`}>
          {ar ? 'تصفّح المتجر' : 'Browse the store'}
        </Link>
        <Link className="btn btn-ghost" href={`${prefix}${ROUTES.home}`}>
          {ar ? 'الصفحة الرئيسية' : 'Home'}
        </Link>
      </p>

      {/* Nothing at all while it is being asked, and nothing at all when the
          answer is empty. A "we found nothing" heading is a second piece of bad
          news on a page that has already delivered one. */}
      {suggestions !== null && suggestions.length > 0 ? (
        <section className="missing-guess">
          <h2>{ar ? 'هل تقصد؟' : 'Did you mean?'}</h2>
          <ul>
            {suggestions.map((entry) => (
              <li key={entry.href}>
                <Link href={entry.href}>{entry.title}</Link>
                <span className="missing-kind">{(ar ? KIND_AR : KIND_EN)[entry.kind]}</span>
              </li>
            ))}
          </ul>
          <p className="missing-hint">
            {ar ? 'لم يكن أيٌّ منها؟ ' : 'None of these? '}
            <Link href={`${prefix}${ROUTES.contact}`}>{ar ? 'راسِلنا' : 'write to us'}</Link>.
          </p>
        </section>
      ) : null}
    </main>
  );
}
