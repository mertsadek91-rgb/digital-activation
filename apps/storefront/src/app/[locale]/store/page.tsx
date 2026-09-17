import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { ROUTES } from '@da/contracts';
import { alternates, buildGraph, canonical, jsonld } from '@da/seo';

import { MotionFadeIn } from '../../../components/motion-wrapper';
import { CategoryRail } from '../../../components/category-rail';
import { ProductCard } from '../../../components/product-card';
import { getStore } from '../../../lib/api';
import { robotsMeta } from '../../../lib/seo';

/**
 * /store — everything on sale.
 *
 * The header has linked here since the storefront existed and the page did not,
 * so the most prominent link on every page of the site was a 404. It is also
 * the only page a visitor can use before they know a single category name,
 * which is why the collections are listed on it rather than hidden behind a
 * menu: this catalog has no brand pages and no search yet, so collections are
 * the entire navigation.
 *
 * Sorting offers the three orders that are real. Price is not among them: a
 * product's price is the cheapest of its variants, and ordering a page of 24 in
 * memory would sort that page rather than the catalog — which looks like a
 * price sort and is not one.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://digital-activation.com';
const PER_PAGE = 24;

const SORTS = ['position', 'newest', 'best-selling'] as const;
type Sort = (typeof SORTS)[number];

const SORT_LABELS: Record<Sort, { ar: string; en: string }> = {
  // The default order is sales-first, so it is labelled for what it is rather
  // than as "default" — a sort called "default" tells a shopper nothing.
  position: { ar: 'الأكثر شيوعاً', en: 'Most popular' },
  newest: { ar: 'الأحدث', en: 'Newest' },
  'best-selling': { ar: 'الأكثر مبيعاً', en: 'Best selling' },
};

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pageNumber(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(first(value) ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function sortFor(value: string | string[] | undefined): Sort {
  const raw = first(value);
  return SORTS.includes(raw as Sort) ? (raw as Sort) : 'position';
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const ar = locale === 'ar';
  const links = alternates(SITE_URL, ROUTES.store);

  return {
    title: ar ? 'المتجر — كل المنتجات' : 'Store — all products',
    description: ar
      ? 'مفاتيح تفعيل وتراخيص أصلية: ويندوز، أوفيس، أدوبي، برامج الحماية والتصميم — تسليم على بريدك.'
      : 'Genuine activation keys and licences: Windows, Office, Adobe, security and design software — delivered to your email.',
    robots: robotsMeta(process.env.NEXT_PUBLIC_SITE_URL),
    alternates: {
      canonical: canonical(SITE_URL, ROUTES.store, ar ? 'ar' : 'en'),
      languages: Object.fromEntries(links.map((link) => [link.hrefLang, link.href])),
    },
  };
}

export default async function StorePage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const search = await searchParams;
  const page = pageNumber(search.page);
  const sort = sortFor(search.sort);
  const ar = locale === 'ar';
  const prefix = ar ? '' : `/${locale}`;

  const store = await getStore({ locale, page, perPage: PER_PAGE, sort });
  if (!store) notFound();

  const lastPage = Math.max(1, Math.ceil(store.total / store.perPage));

  // One ItemList for the grid, and breadcrumbs that start at the home page.
  // `buildGraph` throws on a second ItemList, which is what kept the legacy
  // product pages out of rich results entirely.
  const graph = buildGraph([
    jsonld.breadcrumbs([
      { name: ar ? 'الرئيسية' : 'Home', url: new URL(`${prefix}/`, SITE_URL).toString() },
      {
        name: ar ? 'المتجر' : 'Store',
        url: new URL(`${prefix}${ROUTES.store}`, SITE_URL).toString(),
      },
    ]),
    jsonld.itemList({
      url: new URL(`${prefix}${ROUTES.store}`, SITE_URL).toString(),
      name: ar ? 'المتجر' : 'Store',
      items: store.products.map((card, index) => ({
        url: new URL(`${prefix}${ROUTES.product(card.slug)}`, SITE_URL).toString(),
        name: card.name,
        position: (page - 1) * PER_PAGE + index + 1,
      })),
    }),
  ]);

  /** Keeps the other parameter when one of them changes. */
  const href = (next: { page?: number; sort?: Sort }): string => {
    const query = new URLSearchParams();
    const nextSort = next.sort ?? sort;
    const nextPage = next.page ?? page;
    if (nextSort !== 'position') query.set('sort', nextSort);
    if (nextPage > 1) query.set('page', String(nextPage));
    const suffix = query.toString();
    return `${prefix}${ROUTES.store}${suffix ? `?${suffix}` : ''}`;
  };

  return (
    <main className="shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />

      <header className="page-head">
        <h1>{ar ? 'المتجر' : 'Store'}</h1>
        <p className="lede">
          {ar
            ? 'تراخيص ومفاتيح تفعيل أصلية، تصل على بريدك. أغلبها يُجهَّز بعد الدفع حتى لا تبدأ مدّة ترخيصك قبل أن تستخدمه.'
            : 'Genuine licences and activation keys, delivered to your email. Most are prepared after payment, so your licence term does not start before you use it.'}
        </p>
      </header>

      {/* The rail replaces the horizontal strip that was here. Same links, same
          counts; a column at desktop width and the strip again below it. */}
      <div className="catalog-layout">
        <CategoryRail
          categories={store.collections}
          locale={locale}
          title={ar ? 'التصنيفات' : 'Categories'}
        />

        <div className="catalog-main">
          <div className="store-bar">
            <p className="result-count">
              {ar
                ? `${String(store.total)} منتجاً`
                : `${String(store.total)} product${store.total === 1 ? '' : 's'}`}
            </p>

            {/* Links, not a <select>: the page is server-rendered, each sort is a
            real URL a crawler can follow, and nothing here needs JavaScript. */}
            <nav className="sorts" aria-label={ar ? 'الترتيب' : 'Sort'}>
              {(['position', 'newest'] as const).map((option) => (
                <Link
                  key={option}
                  href={href({ sort: option, page: 1 })}
                  className={option === sort ? 'is-active' : undefined}
                  aria-current={option === sort ? 'true' : undefined}
                >
                  {ar ? SORT_LABELS[option].ar : SORT_LABELS[option].en}
                </Link>
              ))}
            </nav>
          </div>

          {store.products.length === 0 ? (
            <p className="empty">{ar ? 'لا منتجات منشورة بعد.' : 'Nothing published yet.'}</p>
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
            <nav className="pager" aria-label={ar ? 'الصفحات' : 'Pagination'}>
              {page > 1 ? (
                <Link href={href({ page: page - 1 })} rel="prev">
                  {ar ? 'السابق' : 'Previous'}
                </Link>
              ) : null}
              <span>
                {ar
                  ? `صفحة ${String(page)} من ${String(lastPage)}`
                  : `Page ${String(page)} of ${String(lastPage)}`}
              </span>
              {page < lastPage ? (
                <Link href={href({ page: page + 1 })} rel="next">
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
