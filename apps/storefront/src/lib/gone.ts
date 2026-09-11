import { headers } from 'next/headers';
import { notFound, permanentRedirect, redirect } from 'next/navigation';

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
  const target = await getRedirect(pathname);

  if (!target) {
    // Recorded on the way past. The generated map covers what the WordPress
    // export knew about; this is how the store finds out about the links it did
    // not — an old forum post, a printed invoice, a partner's page.
    reportNotFound(pathname, (await headers()).get('referer') ?? undefined);
    notFound();
  }

  // The locale travels with the visitor. Somebody who followed an old link from
  // an English result should not be dropped into Arabic.
  const prefix = locale === 'ar' ? '' : `/${locale}`;
  const destination = `${prefix}${target.to}`;

  if (target.code === 301 || target.code === 308) permanentRedirect(destination);
  redirect(destination);
}
