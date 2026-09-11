import { serveSection } from '../../lib/sitemap';

/** /sitemap-products.xml — listed in the index only when it has URLs. */
/**
 * Rendered per request, not prerendered.
 *
 * With a `revalidate` segment option and no request-time API, Next builds this
 * into a static file at build time — which for a sitemap is the wrong trade
 * twice over. A build that cannot reach the catalog would bake its own 503
 * into a file and serve it; and the first thing a crawler reads after a deploy
 * would be a snapshot of whatever was published when the build ran.
 *
 * Freshness is handled where it belongs instead: the catalog fetch is cached
 * for an hour, so the API is asked at most once an hour, and the response
 * carries `s-maxage=3600` so a CDN serves the rest.
 */
export const dynamic = 'force-dynamic';

export function GET(): Promise<Response> {
  return serveSection('products');
}
