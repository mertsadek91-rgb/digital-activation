/**
 * Structured data. One graph per page, built here and nowhere else.
 *
 * This module exists because of a specific, measurable failure in the legacy
 * store: a product page emitted two separate JSON-LD blocks, each containing a
 * `Product` entity, disagreeing with each other —
 *
 *   block A: price 9.90  USD, availability InStock
 *   block B: price 36.36 USD, availability OutOfStock
 *
 * and the 36.36 was actually the AED figure shown on the page, mislabelled as
 * USD. Google discards conflicting markup, so the store emitted rich data and
 * received no rich results.
 *
 * Two invariants follow, and they are enforced by the types below rather than
 * by convention:
 *
 *   1. `buildGraph` is the only way to produce structured data. A page renders
 *      exactly one <script type="application/ld+json"> containing one @graph.
 *   2. `price` and `priceCurrency` come from the same `DisplayPrice` object the
 *      page renders, so the markup cannot drift from the visible price.
 */

export type JsonLdNode = Record<string, unknown> & {
  '@type': string | string[];
};

/** The price actually shown to this visitor, in the currency shown to them. */
export interface DisplayPrice {
  /** Decimal string, e.g. "36.36". */
  amount: string;
  /** ISO 4217 of the amount above — not of the base currency. */
  currency: string;
}

export interface OrganizationInput {
  name: string;
  url: string;
  logoUrl: string;
  /** Trustpilot, Google Business Profile, social profiles. */
  sameAs: string[];
  email?: string;
  phone?: string;
  legalName?: string;
  vatId?: string;
}

export interface BreadcrumbInput {
  name: string;
  url: string;
}

export interface FaqInput {
  q: string;
  a: string;
}

export interface ProductInput {
  url: string;
  name: string;
  description: string;
  sku: string;
  brandName?: string;
  imageUrls: string[];
  price: DisplayPrice;
  /** Derived from sellable stock, never hard-coded. */
  inStock: boolean;
  priceValidUntil?: string;
  /**
   * Set when the page offers more than one variant. The markup then states the
   * range the picker shows rather than one variant's price as if it were the
   * only one — in the same currency as `price`, which is the selected one.
   */
  priceRange?: { lowPrice: string; highPrice: string; offerCount: number };
  /** Omitted when the product carries no return or replacement promise. */
  returnPolicy?: ReturnPolicyInput;
  /**
   * Present only when there are approved, verified-purchase reviews. Absent
   * otherwise — an absent rating costs a star display; an invented one costs
   * the whole rich result and invites a manual action.
   */
  rating?: { value: string; count: number };
}

/**
 * What the shop does when a purchase goes wrong, as a MerchantReturnPolicy.
 *
 * Shaped for a digital key rather than a parcel: nothing is posted back, so
 * there is no return method or shipping fee to declare. What exists is a
 * window within which a key that does not work is replaced free of charge —
 * which schema.org calls an exchange, not a refund.
 */
export interface ReturnPolicyInput {
  /** ISO 3166-1 alpha-2 codes of the countries the policy applies in. */
  countries: string[];
  days: number;
  /** The page that states the policy in full. */
  url: string;
  refund: 'exchange' | 'full';
}

export interface ItemListInput {
  url: string;
  name: string;
  items: { url: string; name: string; position: number }[];
}

export interface ArticleInput {
  url: string;
  headline: string;
  description: string;
  imageUrl?: string;
  datePublished: string;
  dateModified: string;
  /**
   * `Organization` for a post the shop published without a by-line, which is
   * what the seven imported posts are. A named `Person` is better and is what
   * the `Author` table exists to hold; inventing one to fill the field would be
   * the same habit as the 565 reviews nobody wrote.
   */
  author: { name: string; url?: string; sameAs?: string[]; type?: 'Person' | 'Organization' };
  publisherName: string;
}

const SCHEMA = 'https://schema.org';

export function organization(input: OrganizationInput): JsonLdNode {
  return {
    '@type': 'Organization',
    '@id': `${input.url}#organization`,
    name: input.name,
    ...(input.legalName ? { legalName: input.legalName } : {}),
    url: input.url,
    logo: { '@type': 'ImageObject', url: input.logoUrl },
    sameAs: input.sameAs,
    ...(input.vatId ? { vatID: input.vatId } : {}),
    ...(input.email || input.phone
      ? {
          contactPoint: {
            '@type': 'ContactPoint',
            contactType: 'customer support',
            ...(input.email ? { email: input.email } : {}),
            ...(input.phone ? { telephone: input.phone } : {}),
            availableLanguage: ['ar', 'en'],
          },
        }
      : {}),
  };
}

export function website(input: { url: string; name: string; locale: string }): JsonLdNode {
  return {
    '@type': 'WebSite',
    '@id': `${input.url}#website`,
    url: input.url,
    name: input.name,
    inLanguage: input.locale,
    publisher: { '@id': `${input.url}#organization` },
  };
}

export function breadcrumbs(trail: BreadcrumbInput[]): JsonLdNode {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

/** Emit only when the page really shows these questions and answers. */
export function faqPage(items: FaqInput[]): JsonLdNode | null {
  if (items.length === 0) return null;
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
}

function returnPolicy(input: ReturnPolicyInput): JsonLdNode {
  return {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: input.countries,
    returnPolicyCategory: `${SCHEMA}/MerchantReturnFiniteReturnWindow`,
    merchantReturnDays: input.days,
    returnFees: `${SCHEMA}/FreeReturn`,
    refundType: input.refund === 'exchange' ? `${SCHEMA}/ExchangeRefund` : `${SCHEMA}/FullRefund`,
    merchantReturnLink: input.url,
  };
}

export function product(input: ProductInput): JsonLdNode {
  const shared = {
    url: input.url,
    priceCurrency: input.price.currency,
    availability: input.inStock ? `${SCHEMA}/InStock` : `${SCHEMA}/OutOfStock`,
    itemCondition: `${SCHEMA}/NewCondition`,
    ...(input.priceValidUntil ? { priceValidUntil: input.priceValidUntil } : {}),
    ...(input.returnPolicy ? { hasMerchantReturnPolicy: returnPolicy(input.returnPolicy) } : {}),
    seller: { '@id': `${new URL(input.url).origin}#organization` },
  };

  // An AggregateOffer only when there really is a range. A single variant is
  // one Offer with one price, the same one the page prints.
  const range = input.priceRange && input.priceRange.offerCount > 1 ? input.priceRange : null;

  return {
    '@type': 'Product',
    '@id': `${input.url}#product`,
    name: input.name,
    description: input.description,
    sku: input.sku,
    ...(input.brandName ? { brand: { '@type': 'Brand', name: input.brandName } } : {}),
    image: input.imageUrls,
    offers: range
      ? {
          '@type': 'AggregateOffer',
          lowPrice: range.lowPrice,
          highPrice: range.highPrice,
          offerCount: range.offerCount,
          ...shared,
        }
      : {
          '@type': 'Offer',
          // Same object the page rendered. This is the invariant.
          price: input.price.amount,
          ...shared,
        },
    ...(input.rating && input.rating.count > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: input.rating.value,
            reviewCount: input.rating.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };
}

/** Collection pages get an ItemList, which the legacy store never emitted. */
export function itemList(input: ItemListInput): JsonLdNode {
  return {
    '@type': 'ItemList',
    '@id': `${input.url}#itemlist`,
    name: input.name,
    numberOfItems: input.items.length,
    itemListElement: input.items.map((item) => ({
      '@type': 'ListItem',
      position: item.position,
      url: item.url,
      name: item.name,
    })),
  };
}

export function article(input: ArticleInput): JsonLdNode {
  return {
    '@type': 'Article',
    '@id': `${input.url}#article`,
    headline: input.headline,
    description: input.description,
    ...(input.imageUrl ? { image: input.imageUrl } : {}),
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    author: {
      '@type': input.author.type ?? 'Person',
      name: input.author.name,
      ...(input.author.url ? { url: input.author.url } : {}),
      ...(input.author.sameAs ? { sameAs: input.author.sameAs } : {}),
    },
    publisher: { '@id': `${new URL(input.url).origin}#organization` },
    mainEntityOfPage: { '@type': 'WebPage', '@id': input.url },
  };
}

/**
 * Assembles the page's single graph. Nulls are dropped, and a duplicate
 * `@type` in one graph throws in development rather than shipping the exact
 * defect this module was written to prevent.
 */
export function buildGraph(nodes: (JsonLdNode | null | undefined)[]): string {
  const graph = nodes.filter((node): node is JsonLdNode => Boolean(node));

  if (process.env.NODE_ENV !== 'production') {
    const singular = graph
      .map((node) => (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]))
      .flat()
      .filter((type) => type === 'Product' || type === 'ItemList' || type === 'Article');
    const duplicated = singular.filter((type, i) => singular.indexOf(type) !== i);
    if (duplicated.length > 0) {
      throw new Error(
        `Duplicate structured-data entity in one page graph: ${[...new Set(duplicated)].join(
          ', ',
        )}. Exactly one Product/ItemList/Article per page.`,
      );
    }
  }

  return escapeForScript(JSON.stringify({ '@context': SCHEMA, '@graph': graph }));
}

/**
 * Makes serialised JSON safe to place inside a <script> element.
 *
 * `JSON.stringify` does not escape `<`, so a product name or FAQ answer
 * containing `</script>` — typed by an editor, or imported from WordPress —
 * would close the element early and the rest would be parsed as HTML. The
 * unicode escapes are still the same JSON: every parser reads `<` as
 * `<`. U+2028 and U+2029 are escaped too, because older JavaScript engines
 * treat them as line terminators inside a string literal.
 */
export function escapeForScript(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
