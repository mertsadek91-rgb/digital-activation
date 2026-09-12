'use client';

import { ROUTES } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * The search box, in the header.
 *
 * A plain form that navigates, not a live-filtering widget. Three reasons, in
 * order of how much they matter here.
 *
 * A results page with a URL is a page somebody can send to support, bookmark,
 * or come back to — which on a store selling licence keys is most of what
 * search is for: "this is the one I bought". A dropdown that filters as you
 * type has no URL at all.
 *
 * It also costs nothing to draw. The header is on every page and is otherwise
 * static; a debounced typeahead would mean a request per keystroke against a
 * catalog of seventy-three products, and the round trip to the API is longer
 * than the render it would be racing.
 *
 * And it works before JavaScript does. `router.push` upgrades the submit, but
 * the form has a real action and a real method, so a visitor on a slow
 * connection who types and presses enter gets results either way.
 *
 * The box seeds itself from `window.location.search` in an effect rather than
 * from `useSearchParams`, and that is not a style preference. This component
 * lives in the header, which lives in the layout, which is on every page —
 * and `useSearchParams` makes the client tree up to the nearest Suspense
 * boundary client-rendered. Used here it took the entire site out of static
 * rendering; the build said so and refused. A Suspense boundary would fix the
 * build and still put a hydration boundary in the header of every page, to
 * seed a value nobody reads before hydration.
 */
export function SearchBox({ locale }: { locale: string }) {
  const ar = locale === 'ar';
  const prefix = ar ? '' : `/${locale}`;
  const router = useRouter();
  const [q, setQ] = useState('');

  // So the box still holds the query on the results page: an empty box over a
  // page of results reads as though nothing was asked. Read once on mount and
  // never again — after that the field belongs to whoever is typing in it.
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get('q');
    if (asked) setQ(asked);
  }, []);

  return (
    <form
      className="search-box"
      role="search"
      action={`${prefix}${ROUTES.search}`}
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        const value = q.trim();
        if (value.length === 0) return;
        router.push(`${prefix}${ROUTES.search}?q=${encodeURIComponent(value)}`);
      }}
    >
      <input
        type="search"
        name="q"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder={ar ? 'ابحث عن منتج' : 'Search products'}
        aria-label={ar ? 'ابحث في المتجر' : 'Search the store'}
        maxLength={120}
      />
      <button type="submit" aria-label={ar ? 'ابحث' : 'Search'}>
        {/* Drawn rather than a glyph from the font: the store's typeface is
            Tajawal, which has no icon set, and an emoji magnifier renders as a
            different picture on every platform. */}
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <line
            x1="12.8"
            y1="12.8"
            x2="17.5"
            y2="17.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </form>
  );
}
