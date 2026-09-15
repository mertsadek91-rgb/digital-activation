import type { Metadata } from 'next';
import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';

import { ROUTES } from '@da/contracts';
import { alternates, buildGraph, canonical, jsonld } from '@da/seo';

import { getPosts } from '../../../lib/api';
import { robotsMeta } from '../../../lib/seo';
import { formatArticleDate, readingLabel } from '../../../lib/format';
import { MotionFadeIn } from '../../../components/motion-wrapper';

/**
 * /blog — the seven posts the old store had, and a place to put the next one.
 *
 * They were left out of the first migration because there was nowhere for them
 * to land. They are worth having: four of them answer a question somebody types
 * into a search engine rather than a shopping query, and on a migration whose
 * whole risk is losing organic traffic, throwing away the only editorial content
 * on the site would have been the one avoidable loss.
 *
 * No pagination over seven rows. A second page that exists to be crawled and
 * found empty is worse than no second page.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://digital-activation.com';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const ar = locale === 'ar';
  const links = alternates(SITE_URL, ROUTES.blog);

  return {
    title: ar ? 'المدونة' : 'Blog',
    description: ar
      ? 'مقالات عن التفعيل والتراخيص: كيف تختار النسخة المناسبة، وكيف تفعّلها، وما الفرق بين الإصدارات.'
      : 'Articles on licensing and activation: choosing the right edition, activating it, and what separates one version from the next.',
    robots: robotsMeta(process.env.NEXT_PUBLIC_SITE_URL),
    alternates: {
      canonical: canonical(SITE_URL, ROUTES.blog, ar ? 'ar' : 'en'),
      languages: Object.fromEntries(links.map((link) => [link.hrefLang, link.href])),
    },
  };
}

export default async function BlogPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const ar = locale === 'ar';
  const prefix = ar ? '' : `/${locale}`;

  const index = await getPosts({ locale });
  const posts = index?.posts ?? [];

  const graph = buildGraph([
    jsonld.breadcrumbs([
      { name: ar ? 'الرئيسية' : 'Home', url: new URL(prefix || '/', SITE_URL).toString() },
      {
        name: ar ? 'المدونة' : 'Blog',
        url: new URL(`${prefix}${ROUTES.blog}`, SITE_URL).toString(),
      },
    ]),
    // Only when there is a list. An empty ItemList is a claim about nothing.
    posts.length > 0
      ? jsonld.itemList({
          url: new URL(`${prefix}${ROUTES.blog}`, SITE_URL).toString(),
          name: ar ? 'المدونة' : 'Blog',
          items: posts.map((post, index) => ({
            position: index + 1,
            name: post.title,
            url: new URL(`${prefix}${ROUTES.post(post.slug)}`, SITE_URL).toString(),
          })),
        })
      : null,
  ]);

  return (
    <main className="shell blog-index">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />

      <header className="blog-head">
        <h1>{ar ? 'المدونة' : 'Blog'}</h1>
        <p>
          {ar
            ? 'كيف تختار الترخيص المناسب، وكيف تفعّله، وما الفرق بين الإصدارات — مكتوبة للسوق الخليجي.'
            : 'Choosing a licence, activating it, and what actually separates one edition from the next.'}
        </p>
      </header>

      {posts.length === 0 ? (
        /* Said plainly rather than left blank, and it is said differently in
           each language for a reason: the posts carried over are Arabic, so an
           English visitor is looking at a real gap rather than an outage. */
        <p className="blog-empty">
          {ar
            ? 'لا مقالات منشورة بعد.'
            : 'Nothing here in English yet — the articles on this store are written in Arabic.'}
        </p>
      ) : (
        <MotionFadeIn>
          <ul className="post-list">
            {posts.map((post) => (
              <li key={post.slug}>
                <article className="post-card">
                  <h2>
                    <Link href={`${prefix}${ROUTES.post(post.slug)}`}>{post.title}</Link>
                  </h2>
                  {post.summary ? <p className="post-summary">{post.summary}</p> : null}
                  <p className="post-meta">
                    {post.publishedAt ? (
                      <time dateTime={post.publishedAt}>
                        {formatArticleDate(post.publishedAt, locale)}
                      </time>
                    ) : null}
                    {post.readingMinutes > 0 ? (
                      <span>{readingLabel(post.readingMinutes, locale)}</span>
                    ) : null}
                  </p>
                  <div className="post-action">
                    <Link href={`${prefix}${ROUTES.post(post.slug)}`} className="post-read-link">
                      <span>{ar ? 'قراءة المقال' : 'Read article'}</span>
                      <span aria-hidden="true">{ar ? '←' : '→'}</span>
                    </Link>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </MotionFadeIn>
      )}
    </main>
  );
}
