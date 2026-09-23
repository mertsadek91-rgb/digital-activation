import { type NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';

const handleI18nRouting = createMiddleware(routing);

/**
 * Paths next-intl routes: everything except API routes, Next internals and
 * files with an extension. Redirects for the ~180 legacy URLs are served from
 * the database by the catch-all route, not from here. WordPress's sitemap and
 * feed URLs are fixed shapes rather than content, and are redirected in
 * `next.config.ts` before a request gets this far.
 */
const LOCALISED = /^\/(?!api|_next|_vercel|.*\..*)/;

/**
 * What the shop's pages may load and talk to, for this one response.
 *
 * Scripts run only with this request's nonce. Next reads it back out of the
 * `Content-Security-Policy` request header and stamps it on its own bootstrap,
 * chunks and inline RSC payload, so there is nothing to thread through
 * components. `'strict-dynamic'` then lets those trusted scripts load what they
 * load — which is how Stripe.js gets in: `loadStripe` inserts its own `<script>`.
 * Browsers that understand `'strict-dynamic'` ignore `'self'` and the Stripe
 * host; they are there for the ones that do not.
 *
 * JSON-LD needs no nonce: `application/ld+json` is a data block, which the
 * browser never executes and CSP never evaluates.
 *
 * Styles keep 'unsafe-inline'. React writes `style` attributes (the hero, the
 * motion wrapper), and Stripe Elements injects inline styles into the page;
 * a nonce cannot cover an attribute, and naming one in `style-src` would switch
 * 'unsafe-inline' off for everything else. Style injection cannot run script,
 * so the exposure is presentational.
 *
 * `connect-src` names the API and Stripe and nothing else, so a script that got
 * in could not post a card form or a session anywhere of its choosing.
 */
function contentSecurityPolicy(nonce: string): string {
  const api = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').origin;
  // React's development build reconstructs server error stacks with eval, and
  // the dev server's HMR socket is `ws:`. Neither exists in production.
  const dev = process.env.NODE_ENV !== 'production';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://js.stripe.com https://*.js.stripe.com${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${api} https://api.stripe.com${dev ? ' ws:' : ''}`,
    'frame-src https://js.stripe.com https://hooks.stripe.com https://*.stripe.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export default function proxy(request: NextRequest): NextResponse {
  // 128 random bits, fresh per response. A nonce that repeats is an allowlist
  // entry an attacker can read out of any earlier page.
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const csp = contentSecurityPolicy(nonce);

  // Set on the request so the render can read the nonce: next-intl forwards
  // the incoming request headers when it rewrites or passes a request through.
  request.headers.set('Content-Security-Policy', csp);
  request.headers.set('x-nonce', nonce);

  const response = LOCALISED.test(request.nextUrl.pathname)
    ? handleI18nRouting(request)
    : NextResponse.next({ request: { headers: request.headers } });

  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Wider than the locale matcher on purpose: the 404 for `/wp-login.php`, a
  // file under `public/` and a sitemap all need a policy too, and one source
  // for it means the header cannot be set twice and intersect. Only Next's
  // hashed build assets are skipped — they are scripts and images, not
  // documents, and a CSP header on them does nothing.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
