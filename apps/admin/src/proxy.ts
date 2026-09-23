import { type NextRequest, NextResponse } from 'next/server';

/**
 * What the panel's pages may load and talk to, for this one response.
 *
 * The panel can change bank details and reveal licence keys, so a script that
 * got in — through a product body, say — must neither run nor send anything
 * anywhere but the API. Scripts run only with this request's nonce: Next reads
 * it back out of the `Content-Security-Policy` request header and stamps it on
 * its own bootstrap, chunks and inline RSC payload. An injected `<script>` or
 * `onerror=` attribute has no nonce and does not run, which is a second line
 * behind the rich-text sanitiser rather than instead of it.
 *
 * Styles keep 'unsafe-inline': React writes `style` attributes, a nonce cannot
 * cover an attribute, and naming one in `style-src` would switch
 * 'unsafe-inline' off. Style injection cannot run script.
 *
 * Every page already renders per request — the root layout reads the locale
 * cookie — so the nonce costs no caching here.
 */
function contentSecurityPolicy(nonce: string): string {
  const api = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').origin;
  // React's development build uses eval for error stacks and the dev server's
  // HMR socket is `ws:`. Neither exists in production.
  const dev = process.env.NODE_ENV !== 'production';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${api}${dev ? ' ws:' : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export default function proxy(request: NextRequest): NextResponse {
  // 128 random bits, fresh per response.
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const csp = contentSecurityPolicy(nonce);

  const headers = new Headers(request.headers);
  headers.set('Content-Security-Policy', csp);
  headers.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Next's hashed build assets are scripts and images, not documents; a CSP
  // header on them does nothing. Everything else — every page, the 404 — gets
  // one, from here and only here.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
