import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Link } from '../../../../components/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ROUTES } from '@da/contracts/constants';
import { alternates, buildGraph, canonical, jsonld } from '@da/seo';

import { Blocks } from '../../../../components/blocks';
import { Breadcrumbs } from '../../../../components/breadcrumbs';
import { BandArt } from '../../../../components/band-art';
import { collectionArt } from '../../../../lib/family-art';
import { isArabic } from '../../../../i18n/locale';
import { CategoryRail } from '../../../../components/category-rail';
import {
  ListingChips,
  ListingFilterPanel,
  ListingNoResults,
  ListingSorts,
} from '../../../../components/listing-filters';
import { Pagination } from '../../../../components/pagination';
import { ProductCard } from '../../../../components/product-card';
import { getCollection, recordEvent } from '../../../../lib/api';
import { goneOrRedirect } from '../../../../lib/gone';
import {
  apiFilters,
  isFiltered,
  listingHref,
  listingSeo,
  parseListing,
} from '../../../../lib/listing';
import { notFoundMetadata, pageSuffix, pageTitle, paginatedUrl } from '../../../../lib/seo';

/**
 * A shelf, after the kit's category page (`04_Inner_Pages/*\/category`,
 * TASK-0103): the same bones as the store index — title band, chips with the
 * filters at the end, count and sorts, grid, numbered pages — with this
 * shelf's chip filled in and its sub-shelves as a second row of pills.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://digital-activation.com';
const PER_PAGE = 24;

interface Props {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const state = parseListing(await searchParams);
  const { page } = state;

  // The same request the page makes, so the two share one cached response.
  const collection = await getCollection(slug, {
    locale,
    page,
    perPage: PER_PAGE,
    sort: state.sort,
    filters: apiFilters(state.filters),
  });
  if (!collection) return notFoundMetadata(locale);

  const path = ROUTES.collection(slug);
  const title = `${collection.seo.title ?? collection.name}${pageSuffix(page, locale)}`;

  return {
    // The legacy store had no meta description on a single category page, and
    // not one of its sixteen categories ever earned a search impression.
    // Page N says so in its title, or every page of a category shows the same
    // title in a result and in Search Console's duplicate-title report.
    title: pageTitle(title),
    description: collection.seo.description ?? collection.headline,
    // Filtered: noindex and canonical to the bare shelf; see `listingSeo`.
    ...listingSeo(state, {
      canonical: canonical(SITE_URL, path, isArabic(locale) ? 'ar' : 'en'),
      languages: alternates(SITE_URL, path),
    }),
  };
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  const bandArt = collectionArt(slug);
  setRequestLocale(locale);
  const state = parseListing(await searchParams);
  const { page } = state;
  const t = await getTranslations('collection');
  const ts = await getTranslations('store');
  const tk = await getTranslations('catalog');
  const tf = await getTranslations('filters');
  const ar = isArabic(locale);

  const collection = await getCollection(slug, {
    locale,
    page,
    perPage: PER_PAGE,
    sort: state.sort,
    filters: apiFilters(state.filters),
  });
  // Same as a product: a renamed collection is a redirect, not a dead end.
  // Narrowed by hand: `goneOrRedirect` never returns, but TypeScript
  // cannot see that through an awaited `Promise<never>`.
  if (!collection) {
    await goneOrRedirect(ROUTES.collection(slug), locale);
    notFound();
  }

  const prefix = ar ? '' : `/${locale}`;
  const listPath = `${prefix}${ROUTES.collection(slug)}`;
  // First-party analytics: one row per view, sent from here and not awaited.
  recordEvent({
    type: 'CATEGORY_VIEW',
    path: listPath,
    locale,
    categorySlug: slug,
    searchParams: await searchParams,
  });
  // With the locale prefix: the English list used to identify itself by the
  // Arabic URL, so its `@id` collided with the Arabic page's.
  const pageUrl = paginatedUrl(new URL(listPath, SITE_URL).toString(), page);

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
    <main className="catalog-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />

      <div className={bandArt ? 'page-band has-art' : 'page-band'}>
        <div className="shell">
          <div className="band-copy">
            <Breadcrumbs
              items={collection.breadcrumbs.map((crumb) => ({
                name: crumb.name,
                href: `${prefix}${crumb.href}`,
              }))}
            />
            <header className="page-head">
              <h1>{collection.name}</h1>
              {collection.headline ? <p className="lede">{collection.headline}</p> : null}
            </header>
          </div>
          {bandArt ? <BandArt art={bandArt} /> : null}
        </div>
      </div>

      <div className="shell">
        <div className="listing-bar">
          <CategoryRail
            categories={collection.siblings}
            current={collection.slug}
            locale={locale}
            title={tk('categories')}
            allHref={`${prefix}${ROUTES.store}`}
            allLabel={tk('all')}
          />
          {collection.facets ? (
            <ListingFilterPanel
              facets={collection.facets}
              state={state}
              path={listPath}
              total={collection.total}
            />
          ) : null}
        </div>

        {collection.children.length > 0 ? (
          <nav className="subnav" aria-label={tk('subcategories')}>
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

        <div className="store-bar">
          <p className="result-count" role="status">
            {tk('productCount', { count: collection.total })}
          </p>
          {/* `position` on a shelf is its own curated order, not sales. */}
          <ListingSorts state={state} path={listPath} positionLabel={tf('sortFeatured')} />
        </div>

        <ListingChips facets={collection.facets} state={state} path={listPath} />

        {collection.products.length === 0 ? (
          isFiltered(state.filters) ? (
            <ListingNoResults state={state} path={listPath} />
          ) : (
            <p className="empty">{t('empty')}</p>
          )
        ) : (
          <div className="grid">
            {collection.products.map((card, index) => (
              <ProductCard key={card.slug} card={card} locale={locale} priority={index < 2} />
            ))}
          </div>
        )}

        <Pagination
          page={page}
          lastPage={lastPage}
          hrefFor={(n) => listingHref(listPath, state, { page: n })}
        />

        {/* Where to go from the end of one shelf. */}
        <p className="listing-foot">
          <Link href={`${prefix}${ROUTES.store}`} className="btn btn-outline">
            {ts('title')}
          </Link>
        </p>
      </div>
    </main>
  );
}
