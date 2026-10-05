import type { Metadata } from 'next';
import { Link } from '../../../../components/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ROUTES } from '@da/contracts';
import { BRAND } from '@da/ui';
import { alternatesIn, buildGraph, canonical, jsonld } from '@da/seo';

import { Blocks } from '../../../../components/blocks';
import { Breadcrumbs } from '../../../../components/breadcrumbs';
import { ArrowIcon, BookIcon } from '../../../../components/icons';
import { ProductCard } from '../../../../components/product-card';
import { isArabic } from '../../../../i18n/locale';
import { getPost } from '../../../../lib/api';
import { formatArticleDate, readingLabel } from '../../../../lib/format';
import { goneOrRedirect } from '../../../../lib/gone';
import { notFoundMetadata, openGraphDefaults, pageTitle, robotsMeta } from '../../../../lib/seo';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://digital-activation.com';

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const post = await getPost(slug, { locale });
  if (!post) return notFoundMetadata(locale);

  const path = ROUTES.post(slug);
  // Only the language this post exists in. A post is not translated the way a
  // product page is, and declaring an `en` alternate for an Arabic-only post
  // points Search Console at a URL that answers 404.
  // Every language the post was written in, falling back to the one served —
  // an older API does not send the field, and a missing hreflang alternate is
  // a smaller problem than a page that will not render.
  const links = alternatesIn(SITE_URL, path, post.locales ?? [post.locale]);

  return {
    title: pageTitle(post.seo.title ?? post.title),
    description: post.seo.description ?? post.summary,
    robots: robotsMeta(process.env.NEXT_PUBLIC_SITE_URL),
    alternates: {
      canonical: canonical(SITE_URL, path, isArabic(locale) ? 'ar' : 'en'),
      languages: Object.fromEntries(links.map((link) => [link.hrefLang, link.href])),
    },
    openGraph: {
      ...openGraphDefaults(locale),
      title: post.seo.title ?? post.title,
      description: post.seo.description ?? post.summary ?? undefined,
      type: 'article',
      ...(post.publishedAt ? { publishedTime: post.publishedAt } : {}),
      modifiedTime: post.updatedAt,
    },
  };
}

/**
 * /blog/[slug] — one post.
 *
 * The body is the WordPress HTML, rendered through the same `richText` block
 * the product bodies use and sanitised on the way out of the API. That matters
 * more here than anywhere else on the site: three of these seven carry a
 * `<style>` block, and the store this replaces prints the CSS inside it as the
 * article's own summary because it derived that summary by stripping tags.
 */
export default async function PostPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('blog');
  const tc = await getTranslations('common');
  const tf = await getTranslations('format');
  const ar = isArabic(locale);

  const post = await getPost(slug, { locale });
  // A slug that no longer exists may have been renamed rather than removed, so
  // the redirect map is consulted before the 404 and the miss is recorded.
  if (!post) {
    await goneOrRedirect(ROUTES.post(slug), locale);
    notFound();
  }

  const prefix = ar ? '' : `/${locale}`;
  const pageUrl = new URL(`${prefix}${ROUTES.post(slug)}`, SITE_URL).toString();

  /*
   * The FAQ blocks become FAQPage markup, the same as on a product page and an
   * editorial page — the posts written for this blog carry one each, and until
   * now the questions rendered for a reader and were invisible to anything
   * reading the page as data. Merged into one entity rather than emitted per
   * block, because `buildGraph` refuses a second FAQPage.
   *
   * Not for rich results: Google restricted those in August 2023 to
   * authoritative government and health sites, so no shop gets the expandable
   * answers under a listing. It is for the engines that read structured data to
   * decide what to quote, which is where this content is now read.
   */
  const questions = post.blocks.flatMap((block) => (block.type === 'faq' ? block.items : []));

  const graph = buildGraph([
    jsonld.breadcrumbs([
      { name: tc('home'), url: new URL(prefix || '/', SITE_URL).toString() },
      {
        name: t('title'),
        url: new URL(`${prefix}${ROUTES.blog}`, SITE_URL).toString(),
      },
      { name: post.title, url: pageUrl },
    ]),
    jsonld.article({
      url: pageUrl,
      headline: post.title,
      description: post.seo.description ?? post.summary ?? post.title,
      datePublished: post.publishedAt ?? post.updatedAt,
      dateModified: post.updatedAt,
      /**
       * The shop, as an organisation, because that is who published these —
       * none of them carries a by-line and the `Author` table is empty. A
       * named person here would be a person who does not exist, which is the
       * same habit that put 565 reviews nobody wrote on the old store.
       */
      author: { type: 'Organization', name: ar ? BRAND.nameAr : BRAND.nameEn, url: SITE_URL },
      publisherName: ar ? BRAND.nameAr : BRAND.nameEn,
    }),
    questions.length > 0 ? jsonld.faqPage(questions) : null,
  ]);

  // The band carries the breadcrumb, the title and the meta; the post is one
  // column of text under it, then the products it names and what to read
  // next as the kit's article cards (TASK-0107).
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />

      <div className="page-band">
        <div className="shell">
          <Breadcrumbs
            items={[
              { name: tc('home'), href: `${prefix}/` },
              { name: t('title'), href: `${prefix}${ROUTES.blog}` },
              { name: post.title, href: `${prefix}${ROUTES.post(slug)}` },
            ]}
          />
          <header className="page-head">
            <h1>{post.title}</h1>
          </header>
          <p className="post-meta">
            {post.publishedAt ? (
              <time dateTime={post.publishedAt}>{formatArticleDate(post.publishedAt, locale)}</time>
            ) : null}
            {post.readingMinutes > 0 ? (
              <span>
                <BookIcon size={16} />
                {readingLabel(post.readingMinutes, tf)}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <main className="shell post-page">
        <article className="post-body">
          {/* Rendered as the opening paragraph rather than hidden in a meta
              tag: it is the answer-first summary, and it is the passage most
              likely to be quoted by an answer engine. */}
          {post.summary ? <p className="post-lede">{post.summary}</p> : null}
          {post.isDraft ? <p className="draft-flag">{tc('draftPreview')}</p> : null}

          <div className="prose">
            <Blocks blocks={post.blocks} />
          </div>
        </article>

        {/* What the article is about, on sale. Absent rather than padded when
            the post names nothing in the catalog. */}
        {post.products.length > 0 ? (
          <section className="post-section" aria-labelledby="post-products">
            <h2 id="post-products">{t('productsInArticle')}</h2>
            <div className="grid">
              {post.products.map((card) => (
                <ProductCard key={card.slug} card={card} locale={locale} />
              ))}
            </div>
          </section>
        ) : null}

        {post.more.length > 0 ? (
          <section className="post-section" aria-labelledby="post-more">
            <h2 id="post-more">{t('readNext')}</h2>
            <ul className="blog-grid">
              {post.more.map((other) => (
                <li key={other.slug} className="article">
                  <Link href={`${prefix}${ROUTES.post(other.slug)}`}>
                    <span className="article-meta">
                      {other.readingMinutes > 0 ? (
                        <span>{readingLabel(other.readingMinutes, tf)}</span>
                      ) : null}
                    </span>
                    <h3 className="article-title">{other.title}</h3>
                    {other.summary ? <span className="post-strip-sub">{other.summary}</span> : null}
                    <span className="article-more">
                      <span>{t('readArticle')}</span>
                      <ArrowIcon size={16} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </>
  );
}
