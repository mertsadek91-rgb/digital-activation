'use client';

import type { Suggestion } from '@da/contracts';
import { ROUTES } from '@da/contracts';
import { Link } from './link';
import { usePathname } from 'next/navigation';
import { createTranslator } from 'next-intl';
import { useEffect, useState } from 'react';

import type arMessages from '../../messages/ar.json';
import { isArabic } from '../i18n/locale';

import { ArrowIcon, SearchIcon } from './icons';

/** The `notFound` namespace of one catalogue. */
export type NotFoundMessages = (typeof arMessages)['notFound'];

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
 *
 * For the same reason the copy does not come from `useTranslations`: there is
 * no intl provider above this page to ask. It builds its own translator over
 * the `notFound` namespace alone, in both languages, handed down by the
 * server `not-found.tsx` that imports the catalogues. Importing them here
 * put every string of copy in both languages into a chunk that every page
 * loaded, since a not-found boundary travels with its layout: 28 KB of
 * script that no page used (TASK-0101). A JSON import is not trimmed to the
 * property that was read.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function NotFoundPage({ messages }: { messages: Record<'ar' | 'en', NotFoundMessages> }) {
  const pathname = usePathname();
  const en = pathname === '/en' || pathname.startsWith('/en/');
  const locale = en ? 'en' : 'ar';
  const ar = isArabic(locale);
  const prefix = en ? '/en' : '';
  const t = createTranslator({
    locale,
    messages: { notFound: messages[locale] },
    namespace: 'notFound',
  });

  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          new URL(`/v1/content/suggest?path=${encodeURIComponent(pathname)}&locale=${locale}`, API),
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
  }, [pathname, locale]);

  // The miss is not reported from here. `goneOrRedirect` already did it on the
  // server with the real referrer header — the field that tells somebody's
  // broken link apart from a crawler guessing — and reporting it again would
  // double every count on the panel's 404 list.

  return (
    <main className="shell missing" dir={ar ? 'rtl' : 'ltr'} lang={ar ? 'ar' : 'en'}>
      {/* The kit's 404: the round mark, the number, the sentence, the way
          out (TASK-0107). */}
      <header className="status-hero">
        <span className="iconbox status-icon" aria-hidden="true">
          <SearchIcon size={32} />
        </span>
        <p className="missing-code" aria-hidden="true">
          404
        </p>
        <h1>{t('title')}</h1>
        <p>{t('body')}</p>
        <p className="missing-actions">
          <Link className="btn btn-primary" href={`${prefix}${ROUTES.home}`}>
            {t('home')}
            <ArrowIcon size={18} />
          </Link>
          <Link className="btn btn-outline" href={`${prefix}${ROUTES.store}`}>
            {t('browseStore')}
          </Link>
        </p>
      </header>

      {/* Nothing at all while it is being asked, and nothing at all when the
          answer is empty. A "we found nothing" heading is a second piece of bad
          news on a page that has already delivered one. */}
      {suggestions !== null && suggestions.length > 0 ? (
        <section className="missing-guess">
          <h2>{t('didYouMean')}</h2>
          <ul>
            {suggestions.map((entry) => (
              <li key={entry.href}>
                <Link href={entry.href}>{entry.title}</Link>
                <span className="missing-kind">{t(`kind.${entry.kind}`)}</span>
              </li>
            ))}
          </ul>
          <p className="missing-hint">
            {t.rich('noneOfThese', {
              contact: (chunks) => <Link href={`${prefix}${ROUTES.contact}`}>{chunks}</Link>,
            })}
          </p>
        </section>
      ) : null}
    </main>
  );
}
