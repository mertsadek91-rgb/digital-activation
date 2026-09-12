import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { alternates, buildGraph, canonical, jsonld } from '@da/seo';

import { Blocks } from '../../../components/blocks';
import { getPage } from '../../../lib/api';
import { goneOrRedirect } from '../../../lib/gone';
import { notFoundMetadata, robotsMeta } from '../../../lib/seo';

/**
 * Editorial pages: the warranty, the policies, whatever is written next.
 *
 * A catch-all, and last in the routing order by construction — every real
 * route above it (`/store`, `/cart`, `/collections/[slug]`, …) is a more
 * specific match, so this only sees paths nothing else claimed. That makes it
 * both the page renderer and the 404: a path with no Page row behind it is not
 * found, which is the same answer the router would have given anyway.
 *
 * One URL per page in both languages. The API falls back to the other locale
 * when a translation has not been written, because answering in the wrong
 * language beats a 404 on a page the header links to in both.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://digital-activation.com';

interface Props {
  params: Promise<{ locale: string; slug: string[] }>;
}

/** `['golden-warranty']` → `golden-warranty`. Nested paths are not pages yet. */
function slugFor(segments: string[]): string | null {
  return segments.length === 1 ? (segments[0] ?? null) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const key = slugFor(slug);
  const page = key ? await getPage(key, { locale }) : null;
  if (!page) return notFoundMetadata(locale);

  const path = `/${page.slug}`;
  const links = alternates(SITE_URL, path);

  return {
    title: page.seo.title ?? page.title,
    description: page.seo.description,
    robots: robotsMeta(process.env.NEXT_PUBLIC_SITE_URL),
    alternates: {
      canonical: canonical(SITE_URL, path, locale === 'en' ? 'en' : 'ar'),
      languages: Object.fromEntries(links.map((link) => [link.hrefLang, link.href])),
    },
  };
}

export default async function ContentPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const key = slugFor(slug);
  const page = key ? await getPage(key, { locale }) : null;
  // Narrowed by hand: `goneOrRedirect` never returns, but TypeScript cannot
  // see that through an awaited `Promise<never>`.
  if (!page) {
    await goneOrRedirect(`/${slug.join('/')}`, locale);
    notFound();
  }

  const ar = locale === 'ar';
  const prefix = ar ? '' : `/${locale}`;
  const url = new URL(`${prefix}/${page.slug}`, SITE_URL).toString();

  // The FAQ blocks become FAQPage markup — the one part of a page like this
  // that can be quoted directly into a search result. `buildGraph` refuses a
  // second FAQPage, so they are merged into one rather than emitted per block.
  const questions = page.blocks.flatMap((block) => (block.type === 'faq' ? block.items : []));

  const graph = buildGraph([
    jsonld.breadcrumbs([
      { name: ar ? 'الرئيسية' : 'Home', url: new URL(`${prefix}/`, SITE_URL).toString() },
      { name: page.title, url },
    ]),
    questions.length > 0 ? jsonld.faqPage(questions) : null,
  ]);

  return (
    <main className="shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />

      <header className="page-head">
        <h1>{page.title}</h1>
      </header>

      <div className="prose">
        <Blocks blocks={page.blocks} />
      </div>
    </main>
  );
}
