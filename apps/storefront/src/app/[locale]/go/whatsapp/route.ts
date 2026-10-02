import { ROUTES, whatsappPlacementSchema } from '@da/contracts';
import { type NextRequest, NextResponse } from 'next/server';

import { recordEvent } from '../../../../lib/api';
import { whatsappDirect } from '../../../../lib/contact';

/** WhatsApp caps a prefilled message well below this; a longer one is not ours. */
const MAX_TEXT = 1000;

/**
 * Paths that carry something personal in a segment: an order number, a
 * referral code, a reset token. Stored as their route template, so a click
 * from an order page is not tied to that order (TASK-0096 review).
 */
const PERSONAL_SEGMENTS: [RegExp, string][] = [
  [/^((?:\/en)?\/orders)\/[^/]+/, '$1/:number'],
  [/^((?:\/en)?\/checkout\/return)\/[^/]+/, '$1/:number'],
  [/^((?:\/en)?\/r)\/[^/]+/, '$1/:code'],
  [/^((?:\/en)?\/account)\/.+/, '$1/*'],
  [/^((?:\/en)?\/(?:reset|verify|unsubscribe)[^/]*)\/.+/, '$1/*'],
];

function routeTemplate(path: string): string {
  for (const [pattern, template] of PERSONAL_SEGMENTS) {
    if (pattern.test(path)) return path.replace(pattern, template);
  }
  return path;
}

/** `/store/<slug>`, with or without the `/en` prefix. */
const PRODUCT_PATH = new RegExp(`^(?:/en)?${ROUTES.product('')}([^/]+)$`);

/**
 * Where the page that linked here is, from its own Referer.
 *
 * Same-origin only: the storefront's links point here, and a click arriving
 * from another site has no page of ours to attribute it to.
 */
function origin(request: NextRequest): { path: string; locale: 'ar' | 'en'; productSlug?: string } {
  const fallback = { path: '/', locale: 'ar' as const };
  const referer = request.headers.get('referer');
  if (!referer) return fallback;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return fallback;
  }
  const own = [
    request.nextUrl.host,
    request.headers.get('x-forwarded-host'),
    process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL).host : null,
  ];
  if (!own.includes(url.host)) return fallback;
  const path = url.pathname || '/';
  const locale = path === '/en' || path.startsWith('/en/') ? 'en' : 'ar';
  const match = PRODUCT_PATH.exec(path);
  let productSlug: string | undefined;
  try {
    productSlug = match?.[1] ? decodeURIComponent(match[1]) : undefined;
  } catch {
    productSlug = undefined;
  }
  return {
    path: routeTemplate(path).slice(0, 512),
    locale,
    ...(productSlug ? { productSlug } : {}),
  };
}

/**
 * `/go/whatsapp?p=<placement>&text=<message>`: count the click, then go to
 * WhatsApp (TASK-0096).
 *
 * A same-site redirect instead of a script, so the CSP and the page weight are
 * untouched and the click is counted with JavaScript off. The destination is
 * always the store's own number — only the prefilled message comes from the
 * query — so this cannot be used to redirect anywhere else. The recording is
 * not awaited: the visitor is on their way to WhatsApp either way.
 */
export function GET(request: NextRequest): NextResponse {
  const query = request.nextUrl.searchParams;
  const text = query.get('text')?.slice(0, MAX_TEXT) || undefined;
  const placement = whatsappPlacementSchema.safeParse(query.get('p'));
  const from = origin(request);

  // Counted only for a real click on one of our pages: a cross-site <img> or
  // link would otherwise inflate the count (browsers send Sec-Fetch-*; a
  // client that sends none is counted, as before, on the Referer check alone).
  const site = request.headers.get('sec-fetch-site');
  const dest = request.headers.get('sec-fetch-dest');
  const genuine =
    (site === null || site === 'same-origin') && (dest === null || dest === 'document');

  if (genuine)
    recordEvent({
      type: 'WHATSAPP_CLICK',
      path: from.path,
      locale: from.locale,
      ...(from.productSlug ? { productSlug: from.productSlug } : {}),
      ...(placement.success ? { placement: placement.data } : {}),
    });

  const response = NextResponse.redirect(whatsappDirect(text), 302);
  response.headers.set('Cache-Control', 'no-store');
  // The page the visitor was on is ours to know, not WhatsApp's.
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}
