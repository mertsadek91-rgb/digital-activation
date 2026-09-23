import { afterEach, describe, expect, it } from 'vitest';

import {
  type JsonLdNode,
  type ProductInput,
  breadcrumbs,
  buildGraph,
  faqPage,
  itemList,
  organization,
  product,
  website,
} from './jsonld.js';

/**
 * Guards the invariant the module was written for: one page, one graph, one
 * Product.
 *
 * The legacy product pages emitted two JSON-LD blocks, each with a Product,
 * disagreeing on price and availability — 9.90 USD / InStock against 36.36 USD /
 * OutOfStock, where 36.36 was the AED figure mislabelled as dollars. Google
 * discards conflicting markup, so the store shipped structured data and earned
 * no rich results at all. Nothing about that failure is visible on the page.
 */
const PRICE = { amount: '9.90', currency: 'USD' };

function aProduct(overrides: Partial<ProductInput> = {}): JsonLdNode {
  return product({
    url: 'https://digital-activation.com/store/windows-11-pro',
    name: 'Windows 11 Pro',
    description: 'Retail licence key.',
    sku: 'win-11-pro-life-1pc',
    imageUrls: ['https://cdn.example.com/win11.jpg'],
    price: PRICE,
    inStock: true,
    ...overrides,
  });
}

function aList(url = 'https://digital-activation.com/collections/windows'): JsonLdNode {
  return itemList({
    url,
    name: 'Windows',
    items: [{ url: `${url}/a`, name: 'A', position: 1 }],
  });
}

/**
 * Reads a nested node out of a built graph. Checked at runtime rather than
 * asserted, so a shape change fails here instead of somewhere confusing.
 */
function fields(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected an object node, got ${typeof value}`);
  }
  // Narrowed to a non-null, non-array object above; this only names the index
  // signature TypeScript will not infer for `object`.
  return value as Record<string, unknown>;
}

/** The `@graph` array of a document `buildGraph` produced. */
function graphOf(json: string): unknown[] {
  const graph = fields(JSON.parse(json))['@graph'];
  if (!Array.isArray(graph)) throw new Error('buildGraph produced no @graph array');
  return graph;
}

describe('buildGraph', () => {
  it('throws when a second Product reaches one page graph', () => {
    expect(() => buildGraph([aProduct(), aProduct()])).toThrow(/Duplicate structured-data entity/);
  });

  it('names the duplicated entity, so the offending block can be found', () => {
    expect(() => buildGraph([aProduct(), aProduct()])).toThrow(/Product/);
  });

  it('throws when a second ItemList reaches one page graph', () => {
    // A collection page that renders its list and a "related collections" list
    // is the same defect in a different shape.
    const two = [aList(), aList('https://digital-activation.com/collections/office')];

    expect(() => buildGraph(two)).toThrow(/ItemList/);
  });

  it('accepts one Product beside the nodes a page legitimately also carries', () => {
    const json = buildGraph([
      organization({
        name: 'Digital Activation',
        url: 'https://digital-activation.com',
        logoUrl: 'https://cdn.example.com/logo.png',
        sameAs: [],
      }),
      website({ url: 'https://digital-activation.com', name: 'Digital Activation', locale: 'ar' }),
      breadcrumbs([{ name: 'Home', url: 'https://digital-activation.com' }]),
      aProduct(),
      faqPage([{ q: 'Is it genuine?', a: 'Yes.' }]),
    ]);

    expect(fields(JSON.parse(json))['@context']).toBe('https://schema.org');
    expect(graphOf(json)).toHaveLength(5);
  });

  it('drops the nulls a page passes for the sections it does not have', () => {
    expect(graphOf(buildGraph([aProduct(), faqPage([]), null, undefined]))).toHaveLength(1);
  });

  it('emits one parseable JSON document, because a page renders exactly one script tag', () => {
    expect(() => graphOf(buildGraph([aProduct()]))).not.toThrow();
  });

  it('cannot be closed early by a </script> inside the data', () => {
    // A product description is editor-written text. Unescaped, this string
    // ends the script element and whatever follows is parsed as HTML.
    const hostile = 'Pro </script><script>alert(1)</script> & more\u2028';
    const json = buildGraph([aProduct({ description: hostile })]);

    expect(json).not.toMatch(/<\/script/i);
    expect(json).not.toContain('<');
    expect(json).not.toContain('\u2028');
    // Still the same data once parsed.
    const node = fields(graphOf(json)[0]);
    expect(node.description).toBe(hostile);
  });
});

describe('buildGraph in production', () => {
  const saved = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = saved;
  });

  it('is a development-time assertion: a live page ships the duplicate rather than failing', () => {
    // Deliberate, and worth pinning — the guard catches the mistake in CI and in
    // development, and refuses to take the storefront down for it in front of a
    // customer.
    process.env.NODE_ENV = 'production';

    expect(() => buildGraph([aProduct(), aProduct()])).not.toThrow();
  });
});

describe('faqPage', () => {
  it('returns null for an empty list rather than an FAQPage with no questions', () => {
    expect(faqPage([])).toBeNull();
  });

  it('builds one Question per entry when the page really shows them', () => {
    const node = faqPage([
      { q: 'Is it genuine?', a: 'Yes.' },
      { q: 'How fast is delivery?', a: 'Within a minute.' },
    ]);

    expect(node?.['@type']).toBe('FAQPage');
    expect(node?.mainEntity).toHaveLength(2);
  });
});

describe('product', () => {
  it('carries the amount and the currency of the same DisplayPrice the page rendered', () => {
    const offers = fields(aProduct({ price: { amount: '36.36', currency: 'AED' } }).offers);

    expect(offers.price).toBe('36.36');
    expect(offers.priceCurrency).toBe('AED');
  });

  it('derives availability from stock rather than hard-coding InStock', () => {
    expect(fields(aProduct({ inStock: false }).offers).availability).toBe(
      'https://schema.org/OutOfStock',
    );
    expect(fields(aProduct({ inStock: true }).offers).availability).toBe(
      'https://schema.org/InStock',
    );
  });

  it('omits aggregateRating when there are no reviews, rather than inventing stars', () => {
    expect(aProduct().aggregateRating).toBeUndefined();
    expect(aProduct({ rating: { value: '4.8', count: 0 } }).aggregateRating).toBeUndefined();
  });

  it('includes aggregateRating once there are real reviews to back it', () => {
    expect(aProduct({ rating: { value: '4.8', count: 12 } }).aggregateRating).toMatchObject({
      ratingValue: '4.8',
      reviewCount: 12,
    });
  });

  it('stays a single Offer when there is only one variant', () => {
    const offers = fields(
      aProduct({ priceRange: { lowPrice: '9.90', highPrice: '9.90', offerCount: 1 } }).offers,
    );

    expect(offers['@type']).toBe('Offer');
    expect(offers.price).toBe('9.90');
  });

  it('states the range as an AggregateOffer when there is more than one variant', () => {
    const offers = fields(
      aProduct({ priceRange: { lowPrice: '9.90', highPrice: '24.00', offerCount: 3 } }).offers,
    );

    expect(offers).toMatchObject({
      '@type': 'AggregateOffer',
      lowPrice: '9.90',
      highPrice: '24.00',
      offerCount: 3,
      priceCurrency: 'USD',
    });
    expect(offers.price).toBeUndefined();
  });

  it('carries the return policy and price validity only when given', () => {
    expect(fields(aProduct().offers).hasMerchantReturnPolicy).toBeUndefined();

    const offers = fields(
      aProduct({
        priceValidUntil: '2027-12-31',
        returnPolicy: {
          countries: ['SA'],
          days: 7,
          url: 'https://digital-activation.com/golden-warranty',
          refund: 'exchange',
        },
      }).offers,
    );

    expect(offers.priceValidUntil).toBe('2027-12-31');
    expect(offers.hasMerchantReturnPolicy).toMatchObject({
      '@type': 'MerchantReturnPolicy',
      merchantReturnDays: 7,
      refundType: 'https://schema.org/ExchangeRefund',
    });
  });

  it('points the seller at the organization node on the same origin', () => {
    expect(fields(aProduct().offers).seller).toEqual({
      '@id': 'https://digital-activation.com#organization',
    });
  });
});

describe('itemList', () => {
  it('reports the number of items it actually lists', () => {
    const node = itemList({
      url: 'https://digital-activation.com/collections/windows',
      name: 'Windows',
      items: [
        { url: 'https://digital-activation.com/store/a', name: 'A', position: 1 },
        { url: 'https://digital-activation.com/store/b', name: 'B', position: 2 },
      ],
    });

    expect(node.numberOfItems).toBe(2);
    expect(node.itemListElement).toHaveLength(2);
  });
});

describe('breadcrumbs', () => {
  it('numbers positions from one, in the order given', () => {
    const node = breadcrumbs([
      { name: 'Home', url: 'https://digital-activation.com' },
      { name: 'Windows', url: 'https://digital-activation.com/collections/windows' },
    ]);

    expect(node.itemListElement).toMatchObject([{ position: 1 }, { position: 2 }]);
  });
});
