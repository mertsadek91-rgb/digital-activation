import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';

import { ROUTES } from '@da/contracts';
import { productCount } from '@da/i18n';
import { alternates, buildGraph, canonical, jsonld } from '@da/seo';

import { Blocks } from '../../../../components/blocks';
import { CategoryRail } from '../../../../components/category-rail';
import { ProductCard } from '../../../../components/product-card';
import { getCollection } from '../../../../lib/api';
import { goneOrRedirect } from '../../../../lib/gone';
import {
  notFoundMetadata,
  pageSuffix,
  pageTitle,
  paginatedUrl,
  robotsMeta,
} from '../../../../lib/seo';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://digital-activation.com';
const PER_PAGE = 24;

interface Props {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pageNumber(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const page = pageNumber((await searchParams).page);

  const collection = await getCollection(slug, { locale, page, perPage: PER_PAGE });
  if (!collection) return notFoundMetadata(locale);

  const path = ROUTES.collection(slug);
  const links = alternates(SITE_URL, path);
  const title = `${collection.seo.title ?? collection.name}${pageSuffix(page, locale)}`;

  return {
    // The legacy store had no meta description on a single category page, and
    // not one of its sixteen categories ever earned a search impression.
    // Page N says so in its title, or every page of a category shows the same
    // title in a result and in Search Console's duplicate-title report.
    title: pageTitle(title),
    description: collection.seo.description ?? collection.headline,
    robots: robotsMeta(process.env.NEXT_PUBLIC_SITE_URL),
    alternates: {
      canonical: paginatedUrl(canonical(SITE_URL, path, locale === 'en' ? 'en' : 'ar'), page),
      languages: Object.fromEntries(
        links.map((link) => [link.hrefLang, paginatedUrl(link.href, page)]),
      ),
    },
  };
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const page = pageNumber((await searchParams).page);
  const ar = locale === 'ar';

  const collection = await getCollection(slug, { locale, page, perPage: PER_PAGE });
  // Same as a product: a renamed collection is a redirect, not a dead end.
  // Narrowed by hand: `goneOrRedirect` never returns, but TypeScript
  // cannot see that through an awaited `Promise<never>`.
  if (!collection) {
    await goneOrRedirect(ROUTES.collection(slug), locale);
    notFound();
  }

  const prefix = ar ? '' : `/${locale}`;
  // With the locale prefix: the English list used to identify itself by the
  // Arabic URL, so its `@id` collided with the Arabic page's.
  const pageUrl = paginatedUrl(
    new URL(`${prefix}${ROUTES.collection(slug)}`, SITE_URL).toString(),
    page,
  );

  // One graph, one script tag. `buildGraph` throws in development if a second
  // ItemList or Product entity reaches it — the legacy product pages emitted two
  // conflicting Product blocks and therefore earned no rich results at all.
  const graph = buildGraph([
    jsonld.breadcrumbs(
      collection.breadcrumbs.map((crumb) => ({
        name: crumb.name,
        url: new URL(`${prefix}${crumb.href}`, SITE_URL).toString(),
      })),
    ),
    jsonld.itemList({
      url: pageUrl,
      name: collection.name,
      items: collection.products.map((card, index) => ({
        url: new URL(`${prefix}${ROUTES.product(card.slug)}`, SITE_URL).toString(),
        name: card.name,
        position: (page - 1) * PER_PAGE + index + 1,
      })),
    }),
    collection.faq ? jsonld.faqPage(collection.faq) : null,
  ]);

  const lastPage = Math.max(1, Math.ceil(collection.total / collection.perPage));

  return (
    <main className="shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />

      <nav aria-label={ar ? 'مسار التنقّل' : 'Breadcrumb'} className="crumbs">
        {collection.breadcrumbs.map((crumb, index) => (
          <span key={crumb.href}>
            {index > 0 ? <span aria-hidden="true"> › </span> : null}
            {index === collection.breadcrumbs.length - 1 ? (
              <span aria-current="page">{crumb.name}</span>
            ) : (
              <Link href={`${prefix}${crumb.href}`}>{crumb.name}</Link>
            )}
          </span>
        ))}
      </nav>

      <header className="page-head">
        <h1>{collection.name}</h1>
        {collection.headline ? <p className="lede">{collection.headline}</p> : null}
      </header>

      <div className="catalog-layout">
        <CategoryRail
          categories={collection.siblings}
          current={collection.slug}
          locale={locale}
          title={ar ? 'التصنيفات' : 'Categories'}
        />

        <div className="catalog-main">
          {collection.children.length > 0 ? (
            <nav className="subnav" aria-label={ar ? 'التصنيفات الفرعية' : 'Subcategories'}>
              {collection.children.map((child) => (
                <Link key={child.slug} href={`${prefix}${ROUTES.collection(child.slug)}`}>
                  {child.name}
                  <span className="count">{child.productCount}</span>
                </Link>
              ))}
            </nav>
          ) : null}

          {collection.body.length > 0 ? (
            <div className="prose">
              <Blocks blocks={collection.body} />
            </div>
          ) : null}

          <p className="result-count">{productCount(collection.total, locale)}</p>

          {collection.products.length === 0 ? (
            <p className="empty">
              {ar ? 'لا منتجات في هذا التصنيف بعد.' : 'No products here yet.'}
            </p>
          ) : (
            <div className="grid">
              {collection.products.map((card) => (
                <ProductCard key={card.slug} card={card} locale={locale} />
              ))}
            </div>
          )}

          {lastPage > 1 ? (
            <nav className="pager" aria-label={ar ? 'الصفحات' : 'Pagination'}>
              {page > 1 ? (
                <Link
                  href={`${prefix}${ROUTES.collection(slug)}?page=${String(page - 1)}`}
                  rel="prev"
                >
                  {ar ? 'السابق' : 'Previous'}
                </Link>
              ) : null}
              <span>
                {ar
                  ? `صفحة ${String(page)} من ${String(lastPage)}`
                  : `Page ${String(page)} of ${String(lastPage)}`}
              </span>
              {page < lastPage ? (
                <Link
                  href={`${prefix}${ROUTES.collection(slug)}?page=${String(page + 1)}`}
                  rel="next"
                >
                  {ar ? 'التالي' : 'Next'}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      </div>
    </main>
  );
}
