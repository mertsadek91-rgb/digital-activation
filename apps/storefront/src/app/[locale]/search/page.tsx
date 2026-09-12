import { ROUTES } from '@da/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';

import { ProductCard } from '../../../components/product-card';
import { searchProducts } from '../../../lib/api';

/**
 * Search results.
 *
 * The page this store did not have. Browsing seventy-three products by
 * category is fine for somebody discovering what is sold here; it is the wrong
 * shape entirely for the visitor who arrives knowing they want Office 2021,
 * which on a software store is most of them.
 *
 * Server-rendered like every other list, so a result is a URL that can be sent
 * to support or bookmarked — "this is the one I bought" is what search is
 * actually for here. It is `noindex` all the same: `/search` has been in
 * `NOINDEX_PREFIXES` since the SEO rules were written, because a search-result
 * page in an index is a thin page competing with the product pages it links
 * to, and an unbounded query string is an unbounded number of them.
 *
 * When nothing matches, the page says so and then offers the store, because a
 * dead end with no way forward is the same mistake the 404 page was built to
 * stop making.
 */
const PER_PAGE = 24;

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  const q = first((await searchParams).q).trim();
  const ar = locale !== 'en';

  return {
    title: q
      ? ar
        ? `نتائج البحث عن ${q}`
        : `Search results for ${q}`
      : ar
        ? 'ابحث في المتجر'
        : 'Search the store',
    // Not a suggestion. A results page is thin by construction and competes
    // with the products it links to.
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ar = locale !== 'en';
  const prefix = ar ? '' : `/${locale}`;
  const search = await searchParams;
  const q = first(search.q).trim();
  const page = Math.max(1, Number.parseInt(first(search.page), 10) || 1);

  const results = q
    ? await searchProducts({ locale, q, page, perPage: PER_PAGE })
    : { q: '', products: [], total: 0, page: 1, perPage: PER_PAGE };

  // The API being unreachable is not "no results" — saying so would tell the
  // visitor their product does not exist when it does.
  if (!results) {
    return (
      <main className="shell">
        <header className="page-head">
          <h1>{ar ? 'البحث' : 'Search'}</h1>
        </header>
        <p className="notice">
          {ar
            ? 'تعذّر البحث الآن. حاوِل مرّة أخرى بعد قليل، أو تصفّح المتجر.'
            : 'Search is unavailable just now. Try again shortly, or browse the store.'}
        </p>
        <p className="missing-actions">
          <Link className="btn btn-primary" href={`${prefix}${ROUTES.store}`}>
            {ar ? 'تصفّح المتجر' : 'Browse the store'}
          </Link>
        </p>
      </main>
    );
  }

  const lastPage = Math.max(1, Math.ceil(results.total / PER_PAGE));
  const href = (next: number): string =>
    `${prefix}${ROUTES.search}?q=${encodeURIComponent(q)}${next > 1 ? `&page=${String(next)}` : ''}`;

  return (
    <main className="shell">
      <header className="page-head">
        <h1>
          {q ? (ar ? 'نتائج البحث' : 'Search results') : ar ? 'ابحث في المتجر' : 'Search the store'}
        </h1>
        {q ? (
          <p className="lede">
            {ar ? 'عن ' : 'for '}
            <strong>{q}</strong>
          </p>
        ) : (
          <p className="lede">
            {ar
              ? 'اكتب اسم المنتج في مربّع البحث أعلى الصفحة — بالعربية أو بالإنجليزية.'
              : 'Type a product name in the box at the top of the page — in English or in Arabic.'}
          </p>
        )}
      </header>

      {q && results.total > 0 ? (
        <div className="store-bar">
          <p className="result-count">
            {ar
              ? `${String(results.total)} نتيجة`
              : `${String(results.total)} result${results.total === 1 ? '' : 's'}`}
          </p>
        </div>
      ) : null}

      {q && results.total === 0 ? (
        <>
          <p className="notice">
            {ar
              ? 'لا نتائج لهذا البحث. جرّب اسماً أقصر — «أوفيس» بدل «أوفيس 2021 برو بلس».'
              : 'Nothing matched. Try a shorter name — "Office" rather than "Office 2021 Pro Plus".'}
          </p>
          <p className="missing-actions">
            <Link className="btn btn-primary" href={`${prefix}${ROUTES.store}`}>
              {ar ? 'تصفّح المتجر' : 'Browse the store'}
            </Link>
            <Link className="btn btn-ghost" href={`${prefix}${ROUTES.contact}`}>
              {ar ? 'اسألنا عنه' : 'Ask us for it'}
            </Link>
          </p>
        </>
      ) : null}

      {results.products.length > 0 ? (
        <div className="grid">
          {results.products.map((card) => (
            <ProductCard key={card.slug} card={card} locale={locale} />
          ))}
        </div>
      ) : null}

      {lastPage > 1 ? (
        <nav className="pager" aria-label={ar ? 'الصفحات' : 'Pagination'}>
          {page > 1 ? (
            <Link href={href(page - 1)} rel="prev">
              {ar ? 'السابق' : 'Previous'}
            </Link>
          ) : null}
          <span>
            {ar
              ? `صفحة ${String(page)} من ${String(lastPage)}`
              : `Page ${String(page)} of ${String(lastPage)}`}
          </span>
          {page < lastPage ? (
            <Link href={href(page + 1)} rel="next">
              {ar ? 'التالي' : 'Next'}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
