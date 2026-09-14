import { ROUTES } from '@da/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { buildGraph, jsonld } from '@da/seo';
import { BRAND } from '@da/ui';

import { CategoryMark, StepMark } from '../../components/icons';
import { ProductCard } from '../../components/product-card';
import { getHome } from '../../lib/api';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://digital-activation.com';

/** The catalog changes rarely; the home page is the most-hit page on the site. */
export const revalidate = 300;

/**
 * Home page.
 *
 * The shape follows the store the owner already has — a hero, a trust strip,
 * then a row of products per category — because that layout works and the
 * owner likes it. Three things are deliberately different.
 *
 * There is no reviews section. The legacy home page showed a 4.9 rating and
 * two testimonials drawn from 565 reviews that no purchase stands behind, and
 * `Review.orderItemId` in this schema is required precisely so that cannot
 * happen again. The section returns when there are real reviews to put in it.
 *
 * There is no carousel. The legacy hero was a slider, which puts the largest
 * image on the page behind a script and makes the headline arrive late; a
 * static hero whose LCP element is text is simply faster.
 *
 * And there is an FAQ, which the legacy home page did not have. It is the part
 * of a home page an answer engine can actually quote, and every answer here is
 * one the store can stand behind — including what the warranty does not cover.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'home' });

  return {
    title: `${t('heroHeadline')} | ${locale === 'ar' ? BRAND.nameAr : BRAND.nameEn}`,
    description: t('heroBody'),
  };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');

  const home = await getHome({ locale, revalidate: 300 });

  const faq = [1, 2, 3, 4, 5].map((n) => ({
    q: t(`faq${String(n)}Q`),
    a: t(`faq${String(n)}A`),
  }));

  const href = (path: string): string => (locale === 'ar' ? path : `/${locale}${path}`);

  // One graph, one script tag. Assembled through buildGraph so a second
  // Product/ItemList/Article entity on the same page throws in development —
  // the legacy store shipped two conflicting Product blocks per page and
  // therefore got no rich results at all.
  //
  // The single ItemList is the best-seller row, and it is emitted only when
  // that row has something in it: an ItemList of zero items is a claim about
  // nothing.
  const rail = home && home.bestSellers.length > 0 ? home.bestSellers : null;
  const graph = buildGraph([
    jsonld.organization({
      name: locale === 'ar' ? BRAND.nameAr : BRAND.nameEn,
      url: SITE_URL,
      logoUrl: `${SITE_URL}/logo.svg`,
      sameAs: [],
    }),
    jsonld.website({
      url: SITE_URL,
      name: locale === 'ar' ? BRAND.nameAr : BRAND.nameEn,
      locale,
    }),
    jsonld.faqPage(faq),
    rail
      ? jsonld.itemList({
          url: `${SITE_URL}${href(ROUTES.home)}`,
          name: t('bestSellersTitle'),
          items: rail.map((card, index) => ({
            url: `${SITE_URL}${href(ROUTES.product(card.slug))}`,
            name: card.name,
            position: index + 1,
          })),
        })
      : null,
  ]);

  const trust = [
    { key: 'Genuine', icon: '⌘' },
    { key: 'Delivery', icon: '↯' },
    { key: 'Warranty', icon: '✦' },
    { key: 'Support', icon: '✆' },
  ] as const;

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />

      {home?.isPreview ? <p className="preview-bar">{t('previewNotice')}</p> : null}

      <section className="hero">
        <div className="hero-inner">
          <h1>{t('heroHeadline')}</h1>
          <p className="hero-body">{t('heroBody')}</p>

          <div className="hero-actions">
            <Link href={href(ROUTES.store)} className="btn btn-primary">
              {t('heroCta')}
            </Link>
            <Link href={href(ROUTES.goldenWarranty)} className="btn btn-ghost">
              {t('heroCtaSecondary')}
            </Link>
          </div>

          {/* Read from the catalog, so the page cannot advertise a range it
              does not stock. */}
          {home ? (
            <dl className="hero-stats">
              <div>
                <dt>{home.productCount}</dt>
                <dd>{t('statProducts')}</dd>
              </div>
              <div>
                <dt>{home.brands.length}</dt>
                <dd>{t('statBrands')}</dd>
              </div>
              <div>
                {/* Just the number. "< 5" reads as "5 >" in RTL — the bracket
                    is bidi-neutral and reorders to the wrong side of the
                    digit — so the qualifier lives in the label as a word. */}
                <dt>5</dt>
                <dd>{t('statDelivery')}</dd>
              </div>
            </dl>
          ) : null}
        </div>
      </section>

      <section className="trust" aria-labelledby="trust-title">
        <h2 id="trust-title" className="visually-hidden">
          {t('trustTitle')}
        </h2>
        <ul className="trust-grid">
          {trust.map((entry) => (
            <li key={entry.key}>
              <span className="trust-icon" aria-hidden="true">
                {entry.icon}
              </span>
              <h3>{t(`trust${entry.key}Title`)}</h3>
              {/* A label alone is decoration. The sentence under it is the
                  part a buyer — or an answer engine — can act on. */}
              <p>{t(`trust${entry.key}Body`)}</p>
            </li>
          ))}
        </ul>
      </section>

      {home === null ? (
        <section className="section">
          <p className="notice">{t('emptyCatalog')}</p>
        </section>
      ) : (
        <>
          {home.categories.length > 0 ? (
            <section className="section" aria-labelledby="categories-title">
              <header className="section-head">
                <h2 id="categories-title">{t('categoriesTitle')}</h2>
                <p>{t('categoriesBody')}</p>
              </header>
              <ul className="category-grid">
                {home.categories.map((category) => (
                  <li key={category.slug}>
                    <Link href={href(category.href)}>
                      {/* The same mark the product menu uses, so a category is
                          the same object wherever it is met. */}
                      <CategoryMark slug={category.slug} size={30} />
                      <strong>{category.name}</strong>
                      {category.headline ? <span>{category.headline}</span> : null}
                      <em>{t('productCount', { count: category.productCount })}</em>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {home.bestSellers.length > 0 ? (
            <Rail
              title={t('bestSellersTitle')}
              body={t('bestSellersBody')}
              cards={home.bestSellers}
              locale={locale}
            />
          ) : null}

          {home.rails.map((entry) => (
            <Rail
              key={entry.slug}
              title={entry.name}
              body={entry.headline}
              cards={entry.products}
              locale={locale}
              more={{
                href: href(entry.href),
                label: `${t('viewAll')} (${String(entry.productCount)})`,
              }}
            />
          ))}

          {home.newest.length > 0 ? (
            <Rail title={t('newestTitle')} cards={home.newest} locale={locale} />
          ) : null}

          {home.brands.length > 0 ? (
            <section className="section" aria-labelledby="brands-title">
              <header className="section-head">
                <h2 id="brands-title">{t('brandsTitle')}</h2>
              </header>
              <ul className="brand-strip">
                {home.brands.map((brand) => (
                  <li key={brand.slug}>
                    <Link href={href(brand.href)}>
                      {brand.name}
                      <span>{t('productCount', { count: brand.productCount })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <section className="section steps" aria-labelledby="steps-title">
        <header className="section-head">
          <h2 id="steps-title">{t('stepsTitle')}</h2>
        </header>
        <ol className="steps-grid">
          {[1, 2, 3].map((n) => (
            <li key={n}>
              <span className="step-art" aria-hidden="true">
                <StepMark step={n} />
                <span className="step-number">{n}</span>
              </span>
              <h3>{t(`step${String(n)}Title`)}</h3>
              <p>{t(`step${String(n)}Body`)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Rendered as text, and the same objects feed the FAQPage node above, so
          the markup cannot answer a question the page does not show. */}
      <section className="section faq" aria-labelledby="faq-title">
        <header className="section-head">
          <h2 id="faq-title">{t('faqTitle')}</h2>
        </header>
        <div className="faq-list">
          {faq.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}

/** A titled row of product cards, with an optional link to the full listing. */
function Rail({
  title,
  body,
  cards,
  locale,
  more,
}: {
  title: string;
  body?: string | null;
  cards: Parameters<typeof ProductCard>[0]['card'][];
  locale: string;
  more?: { href: string; label: string };
}) {
  return (
    <section className="section rail">
      <header className="section-head">
        <h2>{title}</h2>
        {body ? <p>{body}</p> : null}
        {more ? (
          <Link href={more.href} className="section-more">
            {more.label}
          </Link>
        ) : null}
      </header>
      <div className="grid">
        {cards.map((card) => (
          <ProductCard key={card.slug} card={card} locale={locale} />
        ))}
      </div>
    </section>
  );
}
