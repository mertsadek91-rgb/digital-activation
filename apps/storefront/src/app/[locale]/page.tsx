import { ROUTES } from '@da/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { alternates, buildGraph, canonical, jsonld } from '@da/seo';
import { BRAND } from '@da/ui';

import {
  ArrowIcon,
  BookIcon,
  CartIcon,
  CategoryMark,
  CreditCardIcon,
  DownloadIcon,
  HeadsetIcon,
  KeyIcon,
  PlusIcon,
  ShieldCheckIcon,
} from '../../components/icons';
import { HeroSlider } from '../../components/hero-slider';
import { MotionFadeIn } from '../../components/motion-wrapper';
import { ProductCard } from '../../components/product-card';
import { readingLabel } from '../../lib/format';
import { isArabic } from '../../i18n/locale';
import { getHome } from '../../lib/api';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://digital-activation.com';

/** The catalog changes rarely; the home page is the most-hit page on the site. */
export const revalidate = 300;

/**
 * Home page, after the UI Kit (`03_Homepage_Sections`, TASK-0102).
 *
 * The kit's order, with the sections the catalog can actually fill: hero,
 * benefits, categories, best sellers, one row per category, new arrivals,
 * brands, the dark promo panel (which here carries the Golden Warranty — the
 * one promise this shop makes that the kit's sample store did not), how it
 * works, the blog as the kit's "resources" cards, and the FAQ. The newsletter
 * card sits above the footer on every page.
 *
 * Three things are deliberately absent.
 *
 * There is no reviews section. The legacy home page showed a 4.9 rating and
 * two testimonials drawn from 565 reviews that no purchase stands behind, and
 * `Review.orderItemId` in this schema is required precisely so that cannot
 * happen again. The section returns when there are real reviews to put in it.
 *
 * There is no plan-comparison table: the shop sells licences, not tiers.
 *
 * And there is no carousel. The hero's picture is the four product families
 * the shop is known for, drawn once; the LCP element stays the headline.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'home' });

  return {
    // Absolute: this one already ends in the brand, and the layout's template
    // would add it a second time.
    title: {
      absolute: `${t('heroHeadline')} | ${isArabic(locale) ? BRAND.nameAr : BRAND.nameEn}`,
    },
    description: t('heroBody'),
    // The home page's own canonical and hreflang, which used to be declared by
    // the layout and so, wrongly, by every other page too.
    alternates: {
      canonical: canonical(SITE_URL, ROUTES.home, isArabic(locale) ? 'ar' : 'en'),
      languages: Object.fromEntries(
        alternates(SITE_URL, ROUTES.home).map((link) => [link.hrefLang, link.href]),
      ),
    },
  };
}

/** The four product families on the hero, as the kit's banner draws them. */
const HERO_ART = [
  { name: 'windows', width: 560, height: 506 },
  { name: 'office', width: 560, height: 489 },
  { name: 'adobe', width: 560, height: 552 },
  { name: 'autodesk', width: 560, height: 569 },
] as const;

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const tf = await getTranslations('format');
  const tk = await getTranslations('catalog');

  const home = await getHome({ locale, revalidate: 300 });

  const faq = ([1, 2, 3, 4, 5] as const).map((n) => ({
    q: t(`faq${n}Q`),
    a: t(`faq${n}A`),
  }));

  const href = (path: string): string => (isArabic(locale) ? path : `/${locale}${path}`);

  // One slide per family. Each links to its category when the catalog has
  // one (matched by slug prefix, as the category marks are), else the store.
  const slides = HERO_ART.map((art) => {
    const category = home?.categories.find((entry) => entry.slug.startsWith(art.name));
    return {
      key: art.name,
      name: t(`slides.${art.name}.name`),
      title: t(`slides.${art.name}.title`),
      body: t(`slides.${art.name}.body`),
      cta: t(`slides.${art.name}.cta`),
      href: href(category ? category.href : ROUTES.store),
      image: { src: `/home/${art.name}.webp`, width: art.width, height: art.height },
    };
  });

  // One graph, one script tag. Assembled through buildGraph so a second
  // Product/ItemList/Article entity on the same page throws in development —
  // the legacy store shipped two conflicting Product blocks per page and
  // therefore got no rich results at all.
  //
  // The single ItemList is the best-seller row, and it is emitted only when
  // that row has something in it: an ItemList of zero items is a claim about
  // nothing.
  const rail = home && home.bestSellers.length > 0 ? home.bestSellers : null;
  // The Organization and WebSite nodes are emitted by the layout, on every
  // page, so they are not repeated here.
  const graph = buildGraph([
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

  const benefits = [
    { key: 'Genuine', icon: <KeyIcon /> },
    { key: 'Delivery', icon: <DownloadIcon /> },
    { key: 'Warranty', icon: <ShieldCheckIcon size={24} /> },
    { key: 'Support', icon: <HeadsetIcon /> },
  ] as const;

  const steps = [
    { n: 1, icon: <CartIcon /> },
    { n: 2, icon: <CreditCardIcon size={24} /> },
    { n: 3, icon: <DownloadIcon /> },
  ] as const;

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />

      {home?.isPreview ? <p className="preview-bar">{t('previewNotice')}</p> : null}

      {/* --- hero: a slide per product family, the kit's mint card ----------- */}
      <div className="section hero-section">
        <HeroSlider slides={slides}>
          <Link href={href(ROUTES.goldenWarranty)} className="btn btn-outline">
            {t('heroCtaSecondary')}
          </Link>
        </HeroSlider>
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
              <dt>5</dt>
              <dd>{t('statDelivery')}</dd>
            </div>
          </dl>
        ) : null}
      </div>

      {/* --- benefits: the kit's four-up strip under the hero ----------------- */}
      <MotionFadeIn>
        <section className="section trust" aria-labelledby="trust-title">
          <h2 id="trust-title" className="visually-hidden">
            {t('trustTitle')}
          </h2>
          <ul className="trust-grid">
            {benefits.map((entry) => (
              <li key={entry.key} className="benefit">
                <span className="iconbox" aria-hidden="true">
                  {entry.icon}
                </span>
                <div>
                  <h3>{t(`trust${entry.key}Title`)}</h3>
                  {/* A label alone is decoration. The sentence under it is the
                      part a buyer — or an answer engine — can act on. */}
                  <p>{t(`trust${entry.key}Body`)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </MotionFadeIn>

      {home === null ? (
        <section className="section">
          <p className="notice">{t('emptyCatalog')}</p>
        </section>
      ) : (
        <>
          {/* --- categories: the kit's mint tiles ----------------------------- */}
          {home.categories.length > 0 ? (
            <MotionFadeIn>
              <section className="section" aria-labelledby="categories-title">
                <header className="section-head">
                  <h2 id="categories-title">{t('categoriesTitle')}</h2>
                  <Link className="section-more" href={href(ROUTES.store)}>
                    <span>{t('viewAll')}</span>
                    <ArrowIcon size={18} />
                  </Link>
                </header>
                <ul className="category-grid">
                  {home.categories.map((category) => (
                    <li key={category.slug}>
                      <Link href={href(category.href)} className="category">
                        <CategoryMark slug={category.slug} size={36} />
                        <span className="category-name">{category.name}</span>
                        <span className="category-count">
                          {tk('productCount', { count: category.productCount })}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </MotionFadeIn>
          ) : null}

          {/* --- best sellers, on the page ground like the kit's row --------- */}
          {home.bestSellers.length > 0 ? (
            <div className="band band-soft">
              <Rail
                title={t('bestSellersTitle')}
                body={t('bestSellersBody')}
                cards={home.bestSellers}
                locale={locale}
                more={{ href: href(ROUTES.store), label: t('viewAll') }}
              />
            </div>
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
            <div className="band band-soft">
              <Rail title={t('newestTitle')} cards={home.newest} locale={locale} />
            </div>
          ) : null}

          {home.brands.length > 0 ? (
            <section className="section brands" aria-labelledby="brands-title">
              <header className="section-head">
                <h2 id="brands-title">{t('brandsTitle')}</h2>
              </header>
              <ul className="brand-strip">
                {home.brands.map((brand) => (
                  <li key={brand.slug}>
                    <Link href={href(brand.href)}>
                      {brand.name}
                      <span>{tk('productCount', { count: brand.productCount })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {/* --- the dark promo panel: the Golden Warranty ------------------------ */}
      <MotionFadeIn>
        <section className="section" aria-labelledby="promo-title">
          <div className="promo">
            <div className="promo-content">
              <p className="eyebrow">{t('promoEyebrow')}</p>
              <h2 id="promo-title">{t('promoTitle')}</h2>
              <p>{t('promoBody')}</p>
              <div className="hero-actions">
                <Link href={href(ROUTES.goldenWarranty)} className="btn btn-light">
                  <ArrowIcon />
                  <span>{t('promoCta')}</span>
                </Link>
              </div>
            </div>
            <div className="promo-art" aria-hidden="true">
              <ShieldCheckIcon size={160} />
            </div>
          </div>
        </section>
      </MotionFadeIn>

      {/* --- how it works: the kit's tinted band with three numbered steps ----- */}
      <MotionFadeIn>
        <div className="band band-tint">
          <section className="section steps" aria-labelledby="steps-title">
            <header className="section-head">
              <h2 id="steps-title">{t('stepsTitle')}</h2>
            </header>
            <ol className="steps-grid">
              {steps.map((step) => (
                <li key={step.n} className="step">
                  <span className="stepnum" dir="ltr">
                    {`0${String(step.n)}`}
                  </span>
                  <span className="iconbox" aria-hidden="true">
                    {step.icon}
                  </span>
                  <h3>{t(`step${step.n}Title`)}</h3>
                  <p>{t(`step${step.n}Body`)}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </MotionFadeIn>

      {/* --- the blog, as the kit's "resources" cards --------------------------
          Absent on the English home page, because the posts are Arabic and the
          API does not pretend otherwise. */}
      {home && home.posts.length > 0 ? (
        <section className="section posts-rail" aria-labelledby="posts-title">
          <header className="section-head">
            <h2 id="posts-title">{t('postsTitle')}</h2>
            <Link className="section-more" href={href(ROUTES.blog)}>
              <span>{t('postsAll')}</span>
              <ArrowIcon size={18} />
            </Link>
          </header>
          <ul className="post-strip">
            {home.posts.map((post) => (
              <li key={post.slug} className="article">
                <Link href={href(ROUTES.post(post.slug))}>
                  <span className="article-art" aria-hidden="true">
                    <BookIcon size={72} />
                  </span>
                  <span className="eyebrow">
                    {post.readingMinutes > 0
                      ? readingLabel(post.readingMinutes, tf)
                      : t('postsTitle')}
                  </span>
                  <strong>{post.title}</strong>
                  {post.summary ? <span className="post-strip-sub">{post.summary}</span> : null}
                  <span className="article-more">
                    <span>{t('postRead')}</span>
                    <ArrowIcon size={16} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* --- FAQ: the kit's accordion rows ------------------------------------
          Rendered as text, and the same objects feed the FAQPage node above, so
          the markup cannot answer a question the page does not show. */}
      <MotionFadeIn>
        <section className="section faq" aria-labelledby="faq-title">
          <header className="section-head">
            <h2 id="faq-title">{t('faqTitle')}</h2>
          </header>
          <div className="faq-list">
            {faq.map((item) => (
              <details key={item.q} className="faqrow">
                <summary>
                  <span>{item.q}</span>
                  <span className="faq-toggle" aria-hidden="true">
                    <PlusIcon />
                  </span>
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </MotionFadeIn>
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
    <MotionFadeIn>
      <section className="section rail">
        <header className="section-head">
          <div className="section-head-text">
            <h2>{title}</h2>
            {body ? <p>{body}</p> : null}
          </div>
          {more ? (
            <Link href={more.href} className="section-more">
              <span>{more.label}</span>
              <ArrowIcon size={18} />
            </Link>
          ) : null}
        </header>
        <div className="grid">
          {cards.map((card) => (
            <ProductCard key={card.slug} card={card} locale={locale} />
          ))}
        </div>
      </section>
    </MotionFadeIn>
  );
}
