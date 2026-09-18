import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';

import { ROUTES } from '@da/contracts';
import { alternates, buildGraph, canonical, jsonld } from '@da/seo';

import { Blocks } from '../../../../components/blocks';
import { CategoryRail } from '../../../../components/category-rail';
import { ProductCard } from '../../../../components/product-card';
import { getBrand } from '../../../../lib/api';
import { goneOrRedirect } from '../../../../lib/gone';
import { notFoundMetadata, robotsMeta } from '../../../../lib/seo';

/**
 * One maker's shelf — the page 71 of 72 products have been linking to.
 *
 * The brand line above every product title and the strip of fifteen makers on
 * the home page both pointed here, and there was nothing at the other end.
 * That is the whole reason this exists; nothing about the layout is new, and
 * deliberately so — somebody arriving from a product page should recognise
 * where they landed, so it is the collection page's grid, rail and pager with
 * the one thing a brand has that a shelf does not: the maker's own site.
 */

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

  const brand = await getBrand(slug, { locale, page, perPage: PER_PAGE });
  if (!brand) return notFoundMetadata(locale);

  const path = ROUTES.brand(slug);
  const links = alternates(SITE_URL, path);

  return {
    title: brand.seo.title ?? brand.name,
    // A brand has no headline field, so the description falls back to a true
    // sentence rather than to nothing at all. No count in it: Arabic agreement
    // changes at three and again at eleven, and a description that reads
    // "3 منتجاً" on one page and right on the next is worse than one without
    // a number. The count is on the page, where the grid backs it up.
    description:
      brand.seo.description ??
      (locale === 'ar'
        ? `كل ما نوفّره من ${brand.name} بتفعيل أصلي.`
        : `Every ${brand.name} licence we carry, with genuine activation.`),
    robots: robotsMeta(process.env.NEXT_PUBLIC_SITE_URL),
    alternates: {
      canonical: canonical(SITE_URL, path, locale === 'en' ? 'en' : 'ar'),
      languages: Object.fromEntries(links.map((link) => [link.hrefLang, link.href])),
    },
  };
}

export default async function BrandPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const page = pageNumber((await searchParams).page);
  const ar = locale === 'ar';

  const brand = await getBrand(slug, { locale, page, perPage: PER_PAGE });
  // A renamed brand is a redirect, not a dead end — the same rule products and
  // collections follow. `goneOrRedirect` never returns, but TypeScript cannot
  // see that through an awaited `Promise<never>`.
  if (!brand) {
    await goneOrRedirect(ROUTES.brand(slug), locale);
    notFound();
  }

  const pageUrl = new URL(ROUTES.brand(slug), SITE_URL).toString();
  const prefix = ar ? '' : `/${locale}`;

  const graph = buildGraph([
    jsonld.breadcrumbs(
      brand.breadcrumbs.map((crumb) => ({
        name: crumb.name,
        url: new URL(`${prefix}${crumb.href}`, SITE_URL).toString(),
      })),
    ),
    jsonld.itemList({
      url: pageUrl,
      name: brand.name,
      items: brand.products.map((card, index) => ({
        url: new URL(`${prefix}${ROUTES.product(card.slug)}`, SITE_URL).toString(),
        name: card.name,
        position: (page - 1) * PER_PAGE + index + 1,
      })),
    }),
  ]);

  const lastPage = Math.max(1, Math.ceil(brand.total / brand.perPage));

  return (
    <main className="shell">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />

      <nav aria-label={ar ? 'مسار التنقّل' : 'Breadcrumb'} className="crumbs">
        {brand.breadcrumbs.map((crumb, index) => (
          <span key={crumb.href}>
            {index > 0 ? <span aria-hidden="true"> › </span> : null}
            {index === brand.breadcrumbs.length - 1 ? (
              <span aria-current="page">{crumb.name}</span>
            ) : (
              <Link href={`${prefix}${crumb.href}`}>{crumb.name}</Link>
            )}
          </span>
        ))}
      </nav>

      <header className="page-head brand-head">
        {/* Both dimensions or no image: `next/image` needs an intrinsic size to
            reserve the space, and a logo that lands after the heading has moved
            is worse than a heading with no logo. Every asset in this catalog
            has them; the contract allows null, so this says what happens then.
            No brand carries a logo today, so this is the branch that runs. */}
        {brand.logo && brand.logo.width !== null && brand.logo.height !== null ? (
          <Image
            className="brand-logo"
            src={brand.logo.url}
            alt={brand.logo.alt}
            width={brand.logo.width}
            height={brand.logo.height}
          />
        ) : null}
        <div>
          <h1>{brand.name}</h1>
          {/* No count here: the result line below the rail already carries it,
              and a number printed twice on one page is two numbers that can
              fall out of step — the same rule the product page applies to its
              rating. */}
          <p className="lede">
            {ar
              ? `كل ما نوفّره من ${brand.name} بتفعيل أصلي.`
              : `Every ${brand.name} licence we carry, with genuine activation.`}
          </p>
          {/* The maker's own site, and the only outbound link on the page.
              `rel` because it is a link we do not vouch for and do not want to
              pass ranking to — this is a shop that sells their licences, not a
              partner of theirs, and the markup should not imply otherwise. */}
          {brand.website ? (
            <a
              className="brand-site"
              href={brand.website}
              rel="nofollow noopener noreferrer"
              target="_blank"
            >
              {ar ? 'الموقع الرسمي' : 'Official site'}
            </a>
          ) : null}
        </div>
      </header>

      <div className="catalog-layout">
        <CategoryRail
          categories={brand.siblings}
          current={brand.slug}
          locale={locale}
          title={ar ? 'العلامات' : 'Brands'}
          hrefFor={ROUTES.brand}
        />

        <div className="catalog-main">
          {brand.intro.length > 0 ? (
            <div className="prose">
              <Blocks blocks={brand.intro} />
            </div>
          ) : null}

          <p className="result-count">
            {ar
              ? `${String(brand.total)} منتجاً`
              : `${String(brand.total)} product${brand.total === 1 ? '' : 's'}`}
          </p>

          {brand.products.length === 0 ? (
            <p className="empty">
              {ar ? 'لا منتجات من هذه العلامة بعد.' : 'Nothing from this brand yet.'}
            </p>
          ) : (
            <div className="grid">
              {brand.products.map((card) => (
                <ProductCard key={card.slug} card={card} locale={locale} />
              ))}
            </div>
          )}

          {lastPage > 1 ? (
            <nav className="pager" aria-label={ar ? 'الصفحات' : 'Pagination'}>
              {page > 1 ? (
                <Link href={`${prefix}${ROUTES.brand(slug)}?page=${String(page - 1)}`} rel="prev">
                  {ar ? 'السابق' : 'Previous'}
                </Link>
              ) : null}
              <span>
                {ar
                  ? `صفحة ${String(page)} من ${String(lastPage)}`
                  : `Page ${String(page)} of ${String(lastPage)}`}
              </span>
              {page < lastPage ? (
                <Link href={`${prefix}${ROUTES.brand(slug)}?page=${String(page + 1)}`} rel="next">
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
