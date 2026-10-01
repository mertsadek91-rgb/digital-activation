import { headers } from 'next/headers';
import { notFound, permanentRedirect, redirect } from 'next/navigation';

import type { RedirectTarget } from '@da/contracts';

import { isArabic } from '../i18n/locale';

import { getRedirect, reportNotFound } from './api';

/**
 * What to do with a path this site can no longer answer.
 *
 * Every route that is about to call `notFound()` calls this instead, because a
 * 404 is the last moment at which a redirect is still worth serving and the
 * only moment at which the store can learn the URL exists. It began life inside
 * the editorial catch-all, which was the wrong place for it on its own: a
 * catch-all never sees `/store/<slug>` or `/collections/<slug>`, since both are
 * more specific routes, so renaming a product's slug produced a permanent 404
 * that nothing in the system reported.
 *
 * `permanentRedirect` answers 308 rather than 301 and `redirect` answers 307
 * rather than 302, because a Server Component cannot choose its own status
 * code. Google documents the pairs as equivalent for ranking, and the
 * alternative — a proxy holding the whole map in memory — is the one thing
 * Next's own documentation tells you not to build there.
 *
 * Never returns: it either redirects or renders the 404.
 */
export async function goneOrRedirect(pathname: string, locale: string): Promise<never> {
  const target = (await getRedirect(pathname)) ?? (await legacyCategoryRedirect(pathname));

  if (!target) {
    // Recorded on the way past. The generated map covers what the WordPress
    // export knew about; this is how the store finds out about the links it did
    // not — an old forum post, a printed invoice, a partner's page.
    reportNotFound(pathname, (await headers()).get('referer') ?? undefined);
    notFound();
  }

  // The locale travels with the visitor. Somebody who followed an old link from
  // an English result should not be dropped into Arabic.
  const prefix = isArabic(locale) ? '' : `/${locale}`;
  const destination = `${prefix}${target.to}`;

  if (target.code === 301 || target.code === 308) permanentRedirect(destination);
  redirect(destination);
}

/**
 * A WooCommerce category archive, under the permalink the legacy site serves.
 *
 * The redirect map keys category archives as `/product-category/<term-slug>`,
 * which is WooCommerce's default base and what the export's term rows imply.
 * The live site had its base renamed to `collections`, and nests children
 * under their parents — `/collections/ويندوز-windows/windows-11-ويندوز/` — so
 * the URLs Google has indexed are not the ones the map holds (TASK-0042 crawl,
 * 2026-10-01: 15 of 16 answered 404). The term slug is the last segment in
 * both spellings, so the row the generator wrote is still the right answer.
 *
 * Only consulted for a `/collections/…` path that was about to 404 anyway, so
 * a live collection never pays for the second lookup, and the new site's own
 * collection slugs are Latin and single-segment, so nothing it serves is
 * shadowed.
 */
async function legacyCategoryRedirect(pathname: string): Promise<RedirectTarget | null> {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'collections' || segments.length < 2) return null;
  return getRedirect(`/product-category/${segments[segments.length - 1] ?? ''}`);
}
