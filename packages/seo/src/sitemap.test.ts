import { describe, expect, it } from 'vitest';

import {
  SITEMAP_SECTIONS,
  type SitemapUrl,
  robotsTxt,
  sitemapIndexXml,
  sitemapXml,
} from './sitemap.js';

/**
 * Guards the two ways a sitemap fails without ever looking broken.
 *
 * An unescaped `&` in a filtered URL makes the file malformed XML and Google
 * drops the whole document — not the one entry. And the image namespace has to
 * be spelled `schemas/sitemap-image/1.1`; the shorter `schemas/image/1.1` was
 * shipped once, and it validates, fetches and is then ignored entirely, which
 * is indistinguishable from having submitted no images at all.
 */
const IMAGE_NS = 'http://www.google.com/schemas/sitemap-image/1.1';

function url(overrides: Partial<SitemapUrl> = {}): SitemapUrl {
  return {
    loc: 'https://digital-activation.com/store/windows-11-pro',
    lastmod: '2026-09-01T00:00:00.000Z',
    alternates: [],
    ...overrides,
  };
}

describe('sitemapXml', () => {
  it('declares the image namespace Google actually reads', () => {
    expect(sitemapXml([url()])).toContain(`xmlns:image="${IMAGE_NS}"`);
  });

  it('does not use the short image namespace, which is ignored in silence', () => {
    expect(sitemapXml([url()])).not.toContain('http://www.google.com/schemas/image/1.1');
  });

  it('escapes the ampersand in a filtered URL, which would otherwise void the file', () => {
    const xml = sitemapXml([
      url({ loc: 'https://digital-activation.com/store?filter_brand=eset&orderby=price' }),
    ]);

    expect(xml).toContain(
      '<loc>https://digital-activation.com/store?filter_brand=eset&amp;orderby=price</loc>',
    );
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it('escapes every XML metacharacter, not only the ampersand', () => {
    const xml = sitemapXml([url({ loc: `https://example.com/<>"'&` })]);

    expect(xml).toContain('<loc>https://example.com/&lt;&gt;&quot;&apos;&amp;</loc>');
  });

  it('escapes image locations too, because product images carry query strings', () => {
    const xml = sitemapXml([url({ images: ['https://cdn.example.com/a.jpg?w=800&h=600'] })]);

    expect(xml).toContain('<image:loc>https://cdn.example.com/a.jpg?w=800&amp;h=600</image:loc>');
  });

  it('escapes alternate hrefs, which are built from the same paths as the loc', () => {
    const xml = sitemapXml([
      url({
        alternates: [{ hrefLang: 'en', href: 'https://digital-activation.com/en/store?a=1&b=2' }],
      }),
    ]);

    expect(xml).toContain('href="https://digital-activation.com/en/store?a=1&amp;b=2"');
  });

  it('emits one image element per image and none when there are none', () => {
    expect(
      sitemapXml([
        url({ images: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'] }),
      ]),
    ).toContain('<image:image><image:loc>https://cdn.example.com/b.jpg</image:loc></image:image>');
    expect(sitemapXml([url()])).not.toContain('<image:image>');
  });

  it('omits changefreq rather than guessing one', () => {
    expect(sitemapXml([url()])).not.toContain('<changefreq>');
    expect(sitemapXml([url({ changefreq: 'weekly' })])).toContain(
      '<changefreq>weekly</changefreq>',
    );
  });

  it('writes an xhtml:link for each alternate, which is how Google pairs the locales', () => {
    const xml = sitemapXml([
      url({
        alternates: [
          { hrefLang: 'ar', href: 'https://digital-activation.com/store/win' },
          { hrefLang: 'en', href: 'https://digital-activation.com/en/store/win' },
          { hrefLang: 'x-default', href: 'https://digital-activation.com/store/win' },
        ],
      }),
    ]);

    expect(xml.match(/<xhtml:link /g)).toHaveLength(3);
    expect(xml).toContain('hreflang="x-default"');
  });

  it('produces a document with a matching urlset open and close even when empty', () => {
    const xml = sitemapXml([]);

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
  });
});

describe('sitemapIndexXml', () => {
  it('turns each section into an absolute URL on the given host', () => {
    const xml = sitemapIndexXml('https://digital-activation.com', ['products', 'collections']);

    expect(xml).toContain('<loc>https://digital-activation.com/sitemap-products.xml</loc>');
    expect(xml).toContain('<loc>https://digital-activation.com/sitemap-collections.xml</loc>');
  });

  it('ignores a path on the base URL, so a trailing segment cannot nest the sitemaps', () => {
    expect(sitemapIndexXml('https://digital-activation.com/en/', ['products'])).toContain(
      '<loc>https://digital-activation.com/sitemap-products.xml</loc>',
    );
  });

  it('lists a sitemap for every declared section when handed the full set', () => {
    const xml = sitemapIndexXml('https://digital-activation.com', SITEMAP_SECTIONS);

    // The legacy index omitted product categories entirely: sixteen collection
    // pages were never submitted and earned no impressions in 178 days.
    expect(xml).toContain('<loc>https://digital-activation.com/sitemap-collections.xml</loc>');
    expect(xml.match(/<sitemap>/g)).toHaveLength(SITEMAP_SECTIONS.length);
  });
});

describe('robotsTxt', () => {
  it('points at an absolute sitemap URL on the serving host', () => {
    expect(robotsTxt('https://digital-activation.com', [])).toContain(
      'Sitemap: https://digital-activation.com/sitemap.xml',
    );
  });

  it('disallows each prefix it is given, one line each', () => {
    const txt = robotsTxt('https://digital-activation.com', ['/checkout', '/account']);

    expect(txt).toContain('Disallow: /checkout');
    expect(txt).toContain('Disallow: /account');
  });

  it('keeps the answer engines allowed, because citation is the point', () => {
    const txt = robotsTxt('https://digital-activation.com', []);

    for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) {
      expect(txt).toContain(`User-agent: ${bot}`);
    }
  });

  it('blocks the WooCommerce query parameters that produced the duplicate crawl', () => {
    const txt = robotsTxt('https://digital-activation.com', []);

    for (const pattern of ['/*?add-to-cart=', '/*?orderby=', '/*?filter_']) {
      expect(txt).toContain(`Disallow: ${pattern}`);
    }
  });
});
