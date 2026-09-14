import { serveSection } from '../../lib/sitemap';

/** /sitemap-posts.xml — listed in the index only when it has URLs. */
/** Rendered per request, for the reasons on `/sitemap-pages.xml`. */
export const dynamic = 'force-dynamic';

export function GET(): Promise<Response> {
  return serveSection('posts');
}
