import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Everything except API routes, Next internals and files with an extension.
  // Redirects for the ~180 legacy URLs are served from the database by the
  // catch-all route, not from this matcher. WordPress's sitemap and feed URLs
  // are fixed shapes rather than content, and are redirected in
  // `next.config.ts` before a request gets this far.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
