/**
 * Sitemap generation.
 *
 * The legacy sitemap index listed five children — post, page, product, category
 * (blog categories) and local — and no product-category map at all. The result:
 * sixteen collection pages were never submitted to Google and, over 178 days,
 * not one of them received a single impression.
 *
 * So the set of sections is declared here as a constant, every section is
 * bilingual, and a section is impossible to forget because the index is built
 * from this list rather than assembled by hand.
 */
/**
 * Every section the finished store will have.
 *
 * This is the target, not the current index: the storefront builds its index
 * from the sections that actually have URLs today, because a sitemap that
 * points at an empty or non-existent section is a crawl error rather than a
 * placeholder. Content types arrive here as their pages are built.
 */
export const SITEMAP_SECTIONS = [
  'products',
  'collections',
  'brands',
  'pages',
  'blog',
  'guides',
  'comparisons',
  'glossary',
  'tools',
  'images',
] as const;

export type SitemapSection = (typeof SITEMAP_SECTIONS)[number];

/** Google caps a sitemap at 50,000 URLs; we split well below that. */
export const SITEMAP_MAX_URLS = 5_000;

export interface SitemapEntry {
  path: string;
  lastModified: Date;
  /** Omitted from output when absent — a guessed priority is noise. */
  changeFrequency?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  images?: string[];
}

export interface SitemapUrl {
  loc: string;
  lastmod: string;
  changefreq?: string;
  alternates: { hrefLang: string; href: string }[];
  images?: string[];
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function sitemapIndexXml(baseUrl: string, sections: readonly string[]): string {
  const entries = sections
    .map(
      (section) =>
        `  <sitemap><loc>${xmlEscape(new URL(`/sitemap-${section}.xml`, baseUrl).toString())}</loc></sitemap>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</sitemapindex>`;
}

/**
 * Each URL carries its own xhtml:link alternates, as Google requires.
 *
 * The image namespace is `schemas/sitemap-image/1.1`, not `image/1.1`. The
 * shorter spelling is a common typo and it fails silently: the file still
 * validates as XML, Google still fetches it, and every image entry in it is
 * ignored — which looks exactly like having submitted no images at all.
 */
export function sitemapXml(urls: SitemapUrl[]): string {
  const body = urls
    .map((url) => {
      const alternates = url.alternates
        .map(
          (alt) =>
            `    <xhtml:link rel="alternate" hreflang="${xmlEscape(alt.hrefLang)}" href="${xmlEscape(alt.href)}" />`,
        )
        .join('\n');
      const images = (url.images ?? [])
        .map((src) => `    <image:image><image:loc>${xmlEscape(src)}</image:loc></image:image>`)
        .join('\n');

      return [
        '  <url>',
        `    <loc>${xmlEscape(url.loc)}</loc>`,
        `    <lastmod>${url.lastmod}</lastmod>`,
        url.changefreq ? `    <changefreq>${url.changefreq}</changefreq>` : null,
        alternates || null,
        images || null,
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${body}
</urlset>`;
}

/**
 * robots.txt.
 *
 * The AI crawlers are allowed on purpose. The goal is to be cited by answer
 * engines, not hidden from them; blocking them would forfeit the whole GEO
 * side of the plan.
 */
export function robotsTxt(baseUrl: string, noindexPrefixes: readonly string[]): string {
  const disallow = noindexPrefixes.map((prefix) => `Disallow: ${prefix}`).join('\n');

  return `User-agent: *
${disallow}
Disallow: /*?add-to-cart=
Disallow: /*?orderby=
Disallow: /*?filter_
Disallow: /*?min_price=
Disallow: /*?max_price=
Allow: /

# Answer engines are welcome: citation is the point.
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: ${new URL('/sitemap.xml', baseUrl).toString()}
`;
}
