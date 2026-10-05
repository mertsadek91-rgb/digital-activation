import type { Metadata } from 'next';
import { Link } from '../../../components/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ROUTES } from '@da/contracts/constants';
import { alternates, buildGraph, canonical, jsonld } from '@da/seo';

import { isArabic } from '../../../i18n/locale';
import { getPosts } from '../../../lib/api';
import { robotsMeta } from '../../../lib/seo';
import { formatArticleDate, readingLabel } from '../../../lib/format';
import { Breadcrumbs } from '../../../components/breadcrumbs';
import { ArrowIcon, BookIcon } from '../../../components/icons';

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
  const t = await getTranslations({ locale, namespace: 'blog' });
  const links = alternates(SITE_URL, ROUTES.blog);

  return {
    title: t('title'),
    description: t('metaDescription'),
    robots: robotsMeta(process.env.NEXT_PUBLIC_SITE_URL),
    alternates: {
      canonical: canonical(SITE_URL, ROUTES.blog, isArabic(locale) ? 'ar' : 'en'),
      languages: Object.fromEntries(links.map((link) => [link.hrefLang, link.href])),
    },
  };
}

export default async function BlogPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('blog');
  const tc = await getTranslations('common');
  const tf = await getTranslations('format');
  const ar = isArabic(locale);
  const prefix = ar ? '' : `/${locale}`;

  const index = await getPosts({ locale });
  const posts = index?.posts ?? [];

  const graph = buildGraph([
    jsonld.breadcrumbs([
      { name: tc('home'), url: new URL(prefix || '/', SITE_URL).toString() },
      {
        name: t('title'),
        url: new URL(`${prefix}${ROUTES.blog}`, SITE_URL).toString(),
      },
    ]),
    // Only when there is a list. An empty ItemList is a claim about nothing.
    posts.length > 0
      ? jsonld.itemList({
          url: new URL(`${prefix}${ROUTES.blog}`, SITE_URL).toString(),
          name: t('title'),
          items: posts.map((post, index) => ({
            position: index + 1,
            name: post.title,
            url: new URL(`${prefix}${ROUTES.post(post.slug)}`, SITE_URL).toString(),
          })),
        })
      : null,
  ]);

  // The kit has no blog page: the index uses the home page's article cards
  // (the kit's `article`) under the usual page band (TASK-0108).
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />

      <div className="page-band">
        <div className="shell">
          <Breadcrumbs
            items={[
              { name: tc('home'), href: `${prefix}/` },
              { name: t('title'), href: `${prefix}${ROUTES.blog}` },
            ]}
          />
          <header className="page-head">
            <h1>{t('title')}</h1>
            <p className="lede">{t('lede')}</p>
          </header>
        </div>
      </div>

      <main className="shell blog-index">
        {posts.length === 0 ? (
          /* Said plainly rather than left blank, and it is said differently in
             each language for a reason: the posts carried over are Arabic, so an
             English visitor is looking at a real gap rather than an outage. */
          <div className="empty-state">
            <span className="iconbox status-icon" aria-hidden="true">
              <BookIcon size={32} />
            </span>
            <p>{t('empty')}</p>
            <Link className="btn btn-primary" href={`${prefix}${ROUTES.store}`}>
              {t('browseStore')}
              <ArrowIcon size={18} />
            </Link>
          </div>
        ) : (
          <ul className="blog-grid">
            {posts.map((post) => (
              <li key={post.slug} className="article">
                <Link href={`${prefix}${ROUTES.post(post.slug)}`}>
                  <span className="article-art" aria-hidden="true">
                    <BookIcon size={64} />
                  </span>
                  <span className="article-meta">
                    {post.publishedAt ? (
                      <time dateTime={post.publishedAt}>
                        {formatArticleDate(post.publishedAt, locale)}
                      </time>
                    ) : null}
                    {post.readingMinutes > 0 ? (
                      <span>{readingLabel(post.readingMinutes, tf)}</span>
                    ) : null}
                  </span>
                  <h2 className="article-title">{post.title}</h2>
                  {post.summary ? <span className="post-strip-sub">{post.summary}</span> : null}
                  <span className="article-more">
                    <span>{t('readArticle')}</span>
                    <ArrowIcon size={16} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
