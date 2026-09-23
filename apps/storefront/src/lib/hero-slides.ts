import type { CatalogProduct } from '@da/contracts';
import { getTranslations } from 'next-intl/server';

import { isArabic } from '../i18n/locale';

import { getProduct } from './api';
import {
  type FormatT,
  formatDelivery,
  formatDevices,
  formatLicensePeriod,
  formatPrice,
} from './format';

/**
 * The featured products in the home page hero, read from the catalog.
 *
 * The slider shipped with four products written into it — name, price, old
 * price, saving, a description and three features, all typed by hand. Two of
 * the four were not in the catalog at all, and the prices on the other two
 * were not the prices at checkout: Windows 11 Pro read $14.99 on the home
 * page and sold for $9.90. A hero that quotes a price the buy button will not
 * honour is the most-seen page on the site making a promise the next page
 * breaks.
 *
 * So the only thing chosen here is *which* products, and a colour for each.
 * Everything a shopper can act on — the name, the price, the strike-through,
 * the licence term, the device count, the delivery promise, the warranty —
 * comes from the same product endpoint the product page renders from, so the
 * two cannot disagree. A slug that is no longer published drops out of the
 * slider rather than showing a stale card.
 */

interface FeaturedProduct {
  slug: string;
  theme: SlideTheme;
}

export interface SlideTheme {
  accent: string;
  bgGlow: string;
  badgeBg: string;
  badgeBorder: string;
}

export interface HeroSlide {
  slug: string;
  /** The product page, already prefixed for the locale. */
  href: string;
  name: string;
  brand: string | null;
  /** The category the product sits in, for the small label beside the brand. */
  category: string | null;
  description: string | null;
  price: string;
  /** True when the product has several variants and the price is the lowest. */
  priceIsFrom: boolean;
  /** Strike-through, when the catalog carries a genuine one. */
  oldPrice: string | null;
  /** Whole percent off, when there is a genuine strike-through. */
  savePercent: number | null;
  /** What the licence is, said in the buyer's terms. Never more than four. */
  features: string[];
  theme: SlideTheme;
}

function theme(accent: string, rgb: string): SlideTheme {
  return {
    accent,
    bgGlow: `radial-gradient(circle at 80% 20%, rgba(${rgb}, 0.16) 0%, transparent 60%)`,
    badgeBg: `rgba(${rgb}, 0.12)`,
    badgeBorder: `rgba(${rgb}, 0.3)`,
  };
}

/**
 * Which products the hero shows, in this order.
 *
 * The three lines this shop sells most, and its security best-seller. A slug
 * here has to exist and be published, or the slide is silently left out —
 * which is the right failure for a hero, and the reason this list is short.
 */
const FEATURED: FeaturedProduct[] = [
  { slug: 'windows-11-pro', theme: theme('#0284C7', '2, 132, 199') },
  { slug: 'office-2021-pro-plus', theme: theme('#EA580C', '234, 88, 12') },
  { slug: 'adobe-creative-cloud', theme: theme('#E11D48', '225, 29, 72') },
  { slug: 'eset-internet-security-nod32', theme: theme('#059669', '5, 150, 105') },
];

function toSlide(
  product: CatalogProduct,
  locale: string,
  entry: FeaturedProduct,
  tf: FormatT,
  goldenWarranty: string,
): HeroSlide {
  const ar = isArabic(locale);
  const variant =
    product.variants.find((candidate) => candidate.id === product.selectedVariantId) ??
    product.variants[0];
  if (!variant) throw new Error(`product ${product.slug} has no variant`);

  const features = [
    formatLicensePeriod(variant, tf),
    formatDevices(variant.deviceCount, tf),
    formatDelivery(variant.deliverySlaSeconds, tf, variant.fulfillmentMode),
    ...(product.hasGoldenWarranty ? [goldenWarranty] : []),
  ];

  // The crumb before the product itself is its category; the ones before that
  // are the store and the home page, which are not worth a label.
  const crumbs = product.breadcrumbs;
  const category = crumbs.length >= 4 ? (crumbs[crumbs.length - 2]?.name ?? null) : null;

  return {
    slug: product.slug,
    href: ar ? `/store/${product.slug}` : `/${locale}/store/${product.slug}`,
    name: product.name,
    brand: product.brand?.name ?? null,
    category,
    description: product.shortDesc,
    price: formatPrice(variant.price),
    priceIsFrom: product.variants.length > 1,
    oldPrice: variant.price.compareAt
      ? formatPrice({ amount: variant.price.compareAt, currency: variant.price.currency })
      : null,
    savePercent: variant.price.discountPercent,
    features,
    theme: entry.theme,
  };
}

/**
 * The slides, in the featured order, minus anything the catalog no longer has.
 *
 * Fetched in parallel and cached with the same window as the rest of the home
 * page: four extra requests at build time, none at request time.
 */
export async function loadHeroSlides(locale: string): Promise<HeroSlide[]> {
  const [results, tf, th] = await Promise.all([
    // Settled, not all-or-nothing. `getProduct` throws when the API cannot
    // answer, which is right for a product page — an outage must not read as
    // "deleted" — but the hero is one panel of the home page, and one failed
    // fetch here answered the whole home page with a 500. A product that
    // cannot be read is simply not a slide.
    Promise.allSettled(
      FEATURED.map((entry) => getProduct(entry.slug, { locale, revalidate: 300 })),
    ),
    getTranslations({ locale, namespace: 'format' }),
    getTranslations({ locale, namespace: 'hero' }),
  ]);
  const products = results.map((result) => (result.status === 'fulfilled' ? result.value : null));

  const slides: HeroSlide[] = [];
  for (const [index, product] of products.entries()) {
    const entry = FEATURED[index];
    // A draft is reachable only on a preview host; the hero shows what a
    // shopper can buy, so it is left out there too.
    if (!product || !entry || product.isDraft) continue;
    slides.push(toSlide(product, locale, entry, tf, th('goldenWarranty')));
  }
  return slides;
}
