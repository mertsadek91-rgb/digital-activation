import type {
  SocialProof,
  SocialProofAgo,
  SocialProofPreview,
  SocialProofSettings,
} from '@da/contracts';
import { OrderStatus } from '@da/db';

/**
 * The arithmetic behind "bought 7 times in the last 3 days", kept free of
 * Prisma and Nest so the rules that make it honest can be tested directly.
 *
 * Those rules, in the order they are applied:
 *
 *  1. Only orders that were actually paid count, and only inside the window.
 *  2. Below `minOrders` the answer is empty — "1 sold this month" is not proof
 *     of anything and tells a competitor how quiet the store is.
 *  3. What leaves this file is a count, a coarse age and, at most, a country.
 *     Each output object is built field by field rather than spread from the
 *     row, so a column added to the query later cannot ride along.
 */

/**
 * "Paid (or later)". Refunded and partially refunded orders are left out: a
 * sale that was given back is not somebody vouching for the product.
 */
export const PAID_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.FULFILLING,
  OrderStatus.FULFILLED,
  OrderStatus.COMPLETED,
];

const HOUR_MS = 60 * 60 * 1000;

/**
 * An order younger than this is counted but never shown as a notice.
 *
 * Two reasons. "A few hours ago" is wrong about an order placed four minutes
 * ago; and a buyer who has just paid, still on the site, would otherwise see
 * their own purchase — with their country — announced back to them and to
 * whoever else is looking at the page at that moment.
 */
export const MIN_NOTICE_AGE_MS = HOUR_MS;

/** The only fields the storefront query selects. There is no name here to leak. */
export interface PaidOrderRow {
  paidAt: Date;
  billingCountry: string | null;
}

/**
 * How long ago, in buckets wide enough that nobody can be picked out:
 * under a day, about a day, several days.
 */
export function agoBucket(paidAt: Date, now: Date): SocialProofAgo {
  const hours = (now.getTime() - paidAt.getTime()) / HOUR_MS;
  if (hours < 24) return 'hours';
  if (hours < 48) return 'day';
  return 'days';
}

/** An ISO 3166 alpha-2 code, or nothing — free text typed at checkout is not a country. */
function countryCode(value: string | null): string | undefined {
  if (!value) return undefined;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : undefined;
}

export function emptyProof(windowHours: number): SocialProof {
  return { count: 0, windowHours, recent: [] };
}

/**
 * What one product page may say about its recent sales.
 *
 * `rows` should already be the paid orders in the window, one per order; they
 * are filtered again here so a query that drifts cannot widen what is shown.
 */
export function aggregateSocialProof(
  rows: readonly PaidOrderRow[],
  settings: SocialProofSettings,
  now: Date,
): SocialProof {
  if (!settings.enabled) return emptyProof(settings.windowHours);

  const since = now.getTime() - settings.windowHours * HOUR_MS;
  const inWindow = rows.filter((row) => {
    const at = row.paidAt.getTime();
    return at >= since && at <= now.getTime();
  });

  const count = inWindow.length;
  if (count < settings.minOrders) return emptyProof(settings.windowHours);

  // Notices only when the page is going to show them; otherwise the summary
  // line is all, and there is no reason to send anything more.
  const noticeBudget = settings.intervalSeconds > 0 ? settings.maxPerPage : 0;

  const recent = [...inWindow]
    .filter((row) => now.getTime() - row.paidAt.getTime() >= MIN_NOTICE_AGE_MS)
    .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime())
    .slice(0, noticeBudget)
    .map((row) => {
      const country = settings.showCountry ? countryCode(row.billingCountry) : undefined;
      const ago = agoBucket(row.paidAt, now);
      return country ? { country, ago } : { ago };
    });

  return { count, windowHours: settings.windowHours, recent };
}

/** One paid line for the admin preview. */
export interface PaidLineRow {
  orderId: string;
  productId: string;
  slug: string;
  name: string;
}

/**
 * Which products would show a notice now, and with what count — the admin's
 * way to see the threshold's effect before switching the feature on.
 *
 * Counted by distinct order, like the storefront: two lines of the same
 * product in one basket are one person buying it once.
 */
export function previewSocialProof(
  lines: readonly PaidLineRow[],
  settings: SocialProofSettings,
): SocialProofPreview {
  const products = new Map<string, { slug: string; name: string; orders: Set<string> }>();
  for (const line of lines) {
    const entry = products.get(line.productId) ?? {
      slug: line.slug,
      name: line.name,
      orders: new Set<string>(),
    };
    entry.orders.add(line.orderId);
    products.set(line.productId, entry);
  }

  const rows = [...products.entries()]
    .map(([productId, entry]) => ({
      productId,
      slug: entry.slug,
      name: entry.name,
      count: entry.orders.size,
      // Regardless of `enabled`: the preview is for deciding whether to turn
      // it on, and the screen says separately whether it is.
      shown: entry.orders.size >= settings.minOrders,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    enabled: settings.enabled,
    windowHours: settings.windowHours,
    minOrders: settings.minOrders,
    rows,
  };
}
