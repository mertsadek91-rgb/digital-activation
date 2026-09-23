import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ROUTES } from '@da/contracts';
import { alternates, buildGraph, canonical, jsonld } from '@da/seo';

import { MotionFadeIn } from '../../../components/motion-wrapper';
import { CategoryRail } from '../../../components/category-rail';
import {
  ListingChips,
  ListingFilterPanel,
  ListingNoResults,
  ListingSorts,
} from '../../../components/listing-filters';
import { ProductCard } from '../../../components/product-card';
import { isArabic } from '../../../i18n/locale';
import { getStore } from '../../../lib/api';
import {
  apiFilters,
  isFiltered,
  listingHref,
  listingSeo,
  parseListing,
} from '../../../lib/listing';
import { pageSuffix, paginatedUrl } from '../../../lib/seo';

/**
 * /store — everything on sale.
 *
 * The header has linked here since the storefront existed and the page did not,
 * so the most prominent link on every page of the site was a 404. It is also
 * the only page a visitor can use before they know a single category name,
 * which is why the collections are listed on it rather than hidden behind a
 * menu.
 *
 * Sorting offers the orders that are real, price among them now that the API
 * sorts on each product's cheapest published variant across the whole
 * catalogue rather than within one page. Filters narrow the same list; every
 * state is a URL (see `lib/listing`), and the filtered ones are `noindex`.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://digital-activation.com';
const PER_PAGE = 24;

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  const state = parseListing(await searchParams);
  const t = await getTranslations({ locale, namespace: 'store' });

  return {
    title: `${t('metaTitle')}${pageSuffix(state.page, locale)}`,
    description: t('metaDescription'),
    ...listingSeo(state, {
      canonical: canonical(SITE_URL, ROUTES.store, isArabic(locale) ? 'ar' : 'en'),
      languages: alternates(SITE_URL, ROUTES.store),
    }),
  };
}

export default async function StorePage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('store');
  const tc = await getTranslations('common');
  const tk = await getTranslations('catalog');

  const state = parseListing(await searchParams);
  const { page, sort } = state;
  const ar = isArabic(locale);
  const prefix = ar ? '' : `/${locale}`;
  const path = `${prefix}${ROUTES.store}`;

  // Null only when the API refused the request itself (a page number past the
  // end, say). An outage throws instead and lands on `error.tsx` — a store
  // page that answered 404 while the API was down told crawlers the whole
  // catalogue was gone.
  const store = await getStore({
    locale,
    page,
    perPage: PER_PAGE,
    sort,
    filters: apiFilters(state.filters),
  });
  if (!store) notFound();

  const lastPage = Math.max(1, Math.ceil(store.total / store.perPage));
  const filtered = isFiltered(state.filters);

  // One ItemList for the grid, and breadcrumbs that start at the home page.
  // `buildGraph` throws on a second ItemList, which is what kept the legacy
  // product pages out of rich results entirely.
  const graph = buildGraph([
    jsonld.breadcrumbs([
      { name: tc('home'), url: new URL(`${prefix}/`, SITE_URL).toString() },
      {
        name: t('title'),
        url: new URL(path, SITE_URL).toString(),
      },
    ]),
    jsonld.itemList({
      url: paginatedUrl(new URL(path, SITE_URL).toString(), page),
      name: t('title'),
      items: store.products.map((card, index) => ({
        url: new URL(`${prefix}${ROUTES.product(card.slug)}`, SITE_URL).toString(),
        name: card.name,
        position: (page - 1) * PER_PAGE + index + 1,
      })),
    }),
  ]);

  return (
    <main className="shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />

      <header className="page-head">
        <h1>{t('title')}</h1>
        <p className="lede">{t('lede')}</p>
      </header>

      {/* The rail replaces the horizontal strip that was here. Same links, same
          counts; a column at desktop width and the strip again below it. The
          filters sit under it on desktop and behind a button on a phone. */}
      <div className="catalog-layout">
        <aside className="catalog-side">
          <CategoryRail categories={store.collections} locale={locale} title={tk('categories')} />
          {store.facets ? (
            <ListingFilterPanel
              facets={store.facets}
              state={state}
              path={path}
              total={store.total}
            />
          ) : null}
        </aside>

        <div className="catalog-main">
          <div className="store-bar">
            <p className="result-count" role="status">
              {tk('productCount', { count: store.total })}
            </p>
            <ListingSorts state={state} path={path} positionLabel={t('sortPosition')} />
          </div>

          <ListingChips facets={store.facets} state={state} path={path} />

          {store.products.length === 0 ? (
            filtered ? (
              <ListingNoResults state={state} path={path} />
            ) : (
              <p className="empty">{t('empty')}</p>
            )
          ) : (
            <MotionFadeIn>
              <div className="grid">
                {store.products.map((card) => (
                  <ProductCard key={card.slug} card={card} locale={locale} />
                ))}
              </div>
            </MotionFadeIn>
          )}

          {lastPage > 1 ? (
            <nav className="pager" aria-label={tk('pagination')}>
              {page > 1 ? (
                <Link href={listingHref(path, state, { page: page - 1 })} rel="prev">
                  {tk('previous')}
                </Link>
              ) : null}
              <span>{tk('pageOf', { page: String(page), last: String(lastPage) })}</span>
              {page < lastPage ? (
                <Link href={listingHref(path, state, { page: page + 1 })} rel="next">
                  {tk('next')}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      </div>
    </main>
  );
}
