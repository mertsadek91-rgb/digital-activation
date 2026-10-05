import NextLink from 'next/link';
import type { ComponentProps } from 'react';

/**
 * `next/link` with prefetching off.
 *
 * Every page here renders per request (the root layout calls `connection()`
 * so the CSP nonce works), and no route has a `loading.tsx`, so what the
 * default prefetch fetches for a link is the shared layout up to the nearest
 * boundary: one or two kilobytes that the navigation then fetches again. The
 * header, the drawer and the footer carry about twenty links between them,
 * and Next prefetched each as it scrolled into view, twice over — 35 to 43
 * requests on the home page in the Lighthouse run (TASK-0101), more than half
 * the request budget, for nothing the visitor gets to see sooner.
 *
 * The one case where a prefetch would pay is a static route with a loading
 * state, and there is none. A link that wants it back passes `prefetch`
 * explicitly; the storefront's lint rule points `next/link` imports here.
 */
export function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
