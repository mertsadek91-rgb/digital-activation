import {
  type AppLocale,
  localeSchema,
  ROUTES,
  type SitemapEntry,
  type SitemapFeed,
  sitemapFeedSchema,
} from '@da/contracts';
import {
  alternates,
  alternatesIn,
  indexingPolicy,
  sitemapIndexXml,
  sitemapXml,
  type SitemapUrl,
} from '@da/seo';
import { z } from 'zod';

/**
 * The sitemap, assembled.
 *
 * Sectioned rather than one flat file, and the sections are built from what
 * actually exists rather than from a list somebody maintains. The legacy store
 * shipped an index with five children and no product-category map at all —
 * sixteen collection pages were never submitted, and across 178 days not one
 * of them took a single impression. The failure was not the missing file; it
 * was that nothing in the system could notice the file was missing.
 *
 * So: an entry appears here because a page exists for it, and a section
 * appears in the index because it has entries. Both are derived.
 *
 * Every URL carries its own reciprocal hreflang alternates. Arabic is at the
 * root and English is prefixed, so each page is submitted once as `/x` with an
 * `/en/x` alternate rather than twice as two unrelated URLs.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/**
 * The routes that exist in the app directory and are not editorial content.
 *
 * Short by construction: everything else is either a catalog URL, which comes
 * from the API, or an editorial page, which comes from the content API. A path
 * belongs here only if a `page.tsx` renders it from nothing but code.
 */
export const STATIC_PATHS: { path: string; changeFrequency: 'daily' | 'weekly' }[] = [
  { path: ROUTES.home, changeFrequency: 'daily' },
  { path: ROUTES.store, changeFrequency: 'daily' },
  // The index itself. Its entries are in the posts section; this is the page
  // that links them, and it changes whenever one is published.
  { path: ROUTES.blog, changeFrequency: 'weekly' },
];

export type Section = 'pages' | 'products' | 'collections' | 'brands' | 'posts';

/** How often each kind of page genuinely changes. A guess here is noise. */
const CHANGE_FREQUENCY: Record<Section, 'daily' | 'weekly' | 'monthly'> = {
  pages: 'daily',
  products: 'weekly',
  collections: 'weekly',
  // A brand page changes when its shelf does, which is when a product is
  // published or retired — the same cadence as a collection.
  brands: 'weekly',
  // A post is written once and edited rarely. Claiming weekly would be the
  // kind of guess that teaches a crawler to ignore the field entirely.
  posts: 'monthly',
};

/**
 * Editorial pages, from the content API.
 *
 * Fetched rather than listed, for the same reason the catalog is: the warranty
 * page is a row somebody can edit and a second page will be added without
 * anyone remembering this file exists.
 */
async function slugFeed(path: string): Promise<{ slug: string; lastModified: string }[] | null> {
  try {
    const response = await fetch(new URL(path, API_URL), {
      headers: { accept: 'application/json' },
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    const parsed = z
      .array(z.object({ slug: z.string(), lastModified: z.string() }))
      .safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Post slugs with their lastmod and the languages each exists in. */
async function postFeed(): Promise<
  { slug: string; lastModified: string; locales: AppLocale[] }[] | null
> {
  try {
    const response = await fetch(new URL('/v1/content/post-slugs', API_URL), {
      headers: { accept: 'application/json' },
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    const parsed = z
      .array(
        z.object({
          slug: z.string(),
          lastModified: z.string(),
          locales: z.array(localeSchema).min(1),
        }),
      )
      .safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function feed(): Promise<SitemapFeed | null> {
  try {
    const response = await fetch(new URL('/v1/catalog/sitemap', API_URL), {
      headers: { accept: 'application/json' },
      // An hour. The catalog changes rarely, and a crawler that arrives during
      // that hour is not harmed by a lastmod that is sixty minutes stale.
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    const parsed = sitemapFeedSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    // A sitemap that cannot reach the API must not render half a catalog: a
    // short sitemap tells Google pages were removed. The caller answers 503,
    // which a crawler retries.
    return null;
  }
}

function toUrls(entries: SitemapEntry[], section: Section): SitemapUrl[] {
  return entries.map((entry) => ({
    // `loc` is the Arabic URL because Arabic is the default and sits at the
    // root; English is one of the alternates beside it.
    loc: new URL(entry.path, SITE_URL).toString(),
    lastmod: entry.lastModified,
    changefreq: CHANGE_FREQUENCY[section],
    alternates: alternates(SITE_URL, entry.path),
    ...(entry.images ? { images: entry.images } : {}),
  }));
}

/** The URLs of one section, or null when the catalog cannot be reached. */
export async function sectionUrls(section: Section): Promise<SitemapUrl[] | null> {
  if (section === 'pages') {
    const now = new Date().toISOString();
    const coded: SitemapUrl[] = STATIC_PATHS.map((entry) => ({
      loc: new URL(entry.path, SITE_URL).toString(),
      // The home and store pages render live catalog data, so "now" is honest
      // for them in a way it would not be for a page with its own edit history.
      lastmod: now,
      changefreq: entry.changeFrequency,
      alternates: alternates(SITE_URL, entry.path),
    }));

    const editorial = await slugFeed('/v1/content/pages');
    if (editorial === null) return null;

    return [
      ...coded,
      ...editorial.map((page) => ({
        loc: new URL(`/${page.slug}`, SITE_URL).toString(),
        // A real edit date: an editorial page changes when somebody changes it,
        // and claiming otherwise is how a crawler learns to ignore the field.
        lastmod: page.lastModified,
        changefreq: 'monthly' as const,
        alternates: alternates(SITE_URL, `/${page.slug}`),
      })),
    ];
  }

  if (section === 'posts') {
    const posts = await postFeed();
    if (posts === null) return null;
    return posts.map((post) => ({
      loc: new URL(ROUTES.post(post.slug), SITE_URL).toString(),
      lastmod: post.lastModified,
      changefreq: CHANGE_FREQUENCY.posts,
      // Only the languages the post was actually written in. Everything else
      // on this site falls back across locales; a post does not.
      alternates: alternatesIn(SITE_URL, ROUTES.post(post.slug), post.locales),
    }));
  }

  const data = await feed();
  if (!data) return null;
  const rows =
    section === 'products' ? data.products : section === 'brands' ? data.brands : data.collections;
  return toUrls(rows, section);
}

/**
 * One response, built the same way for every section.
 *
 * A host that is not the production origin gets a 404 rather than a sitemap.
 * robots.txt on such a host already answers `Disallow: /`, and the two have to
 * agree: a staging sitemap that somebody pastes into Search Console is exactly
 * the duplicate-content accident the indexing policy exists to prevent.
 */
export function xmlResponse(body: string | null): Response {
  if (body === null) {
    // Not an empty sitemap. A sitemap that lists nothing is a statement that
    // the site has no pages, and Google acts on it.
    return new Response('The catalog is unavailable.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '300' },
    });
  }

  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

export function indexable(): boolean {
  return indexingPolicy(process.env.NEXT_PUBLIC_SITE_URL).index;
}

export function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/** Serves one section, with every rule above applied. */
export async function serveSection(section: Section): Promise<Response> {
  if (!indexable()) return notFound();
  const urls = await sectionUrls(section);
  return xmlResponse(urls === null ? null : sitemapXml(urls));
}

/** Serves the index, listing only the sections that have URLs. */
export async function serveIndex(): Promise<Response> {
  if (!indexable()) return notFound();

  const sections: Section[] = ['pages', 'products', 'collections', 'brands', 'posts'];
  const present: string[] = [];
  for (const section of sections) {
    const urls = await sectionUrls(section);
    if (urls === null) return xmlResponse(null);
    if (urls.length > 0) present.push(section);
  }

  return xmlResponse(sitemapIndexXml(SITE_URL, present));
}
