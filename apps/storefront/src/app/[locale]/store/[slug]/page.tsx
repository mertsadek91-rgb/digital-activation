import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ROUTES } from '@da/contracts';
import { alternates, buildGraph, canonical, jsonld } from '@da/seo';

import { Blocks } from '../../../../components/blocks';
import { Breadcrumbs } from '../../../../components/breadcrumbs';
import { BusinessQuote } from '../../../../components/business-quote';
import { BuyBox } from '../../../../components/buy-box';
import {
  ArrowIcon,
  DownloadIcon,
  HeadsetIcon,
  InfoIcon,
  PlusIcon,
  WarningIcon,
} from '../../../../components/icons';
import { ProductCard } from '../../../../components/product-card';
import { ProductGallery } from '../../../../components/product-gallery';
import { ProductTrust } from '../../../../components/product-trust';
import { SaleNotice } from '../../../../components/sale-notice';
import { Reviews } from '../../../../components/reviews';
import { SocialProofNotices } from '../../../../components/social-proof';
import { StockAlert } from '../../../../components/stock-alert';
import { TrustBlock } from '../../../../components/trust-block';
import { isArabic } from '../../../../i18n/locale';
import { whatsappLink } from '../../../../lib/contact';
import { readingLabel } from '../../../../lib/format';
import {
  getMarketingPublic,
  getProduct,
  getProductReviews,
  recordEvent,
} from '../../../../lib/api';
import { goneOrRedirect } from '../../../../lib/gone';
import { notFoundMetadata, openGraphDefaults, pageTitle, robotsMeta } from '../../../../lib/seo';
import { deliveryPromise, localText } from '../../../../lib/trust';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://digital-activation.com';

/**
 * Where the warranty's replacement promise applies: the Gulf market the store
 * sells to. Google asks for the countries explicitly on a return policy.
 */
const GCC_COUNTRIES = ['SA', 'AE', 'KW', 'QA', 'BH', 'OM'];

/**
 * The end of next year. Google warns on an offer with no `priceValidUntil`,
 * and a date that far out makes no promise the page cannot keep — prices here
 * are rewritten by the catalog, not by a campaign with an end date.
 */
const PRICE_VALID_UNTIL = `${String(new Date().getFullYear() + 1)}-12-31`;

/** Lowest and highest variant price, as the decimal strings the API sends. */
function priceRangeOf(variants: { price: { amount: string } }[]): {
  lowPrice: string;
  highPrice: string;
  offerCount: number;
} {
  const sorted = [...variants].sort((a, b) => Number(a.price.amount) - Number(b.price.amount));
  return {
    lowPrice: sorted[0]?.price.amount ?? '0',
    highPrice: sorted[sorted.length - 1]?.price.amount ?? '0',
    offerCount: variants.length,
  };
}

interface Props {
  params: Promise<{ locale: string; slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const product = await getProduct(slug, { locale });
  if (!product) return notFoundMetadata(locale);

  const path = ROUTES.product(slug);
  const links = alternates(SITE_URL, path);

  return {
    title: pageTitle(product.seo.title ?? product.name),
    description: product.seo.description ?? product.shortDesc,
    robots: robotsMeta(process.env.NEXT_PUBLIC_SITE_URL),
    alternates: {
      canonical: canonical(SITE_URL, path, isArabic(locale) ? 'ar' : 'en'),
      languages: Object.fromEntries(links.map((link) => [link.hrefLang, link.href])),
    },
    openGraph: {
      ...openGraphDefaults(locale),
      title: product.seo.title ?? product.name,
      description: product.seo.description ?? product.shortDesc ?? undefined,
      // The product's own picture when it has one; the brand mark otherwise.
      ...(product.images[0]
        ? { images: [{ url: product.images[0].url, alt: product.images[0].alt }] }
        : {}),
    },
  };
}

/**
 * The product page, after the kit (`04_Inner_Pages/*\/product` and
 * `product_secondary`, TASK-0103).
 *
 * A title band with the breadcrumb; then the kit's `details` — the picture on
 * the start side, and beside it the badge, the name, one line about it, the
 * price, the licence picker, what the licence includes, and the buy button;
 * then the kit's tabs over the description, the activation steps and the FAQ;
 * then the reviews as cards on the page ground, the articles that name this
 * product, and "you may also like" as a grid.
 *
 * What stays from the page this replaces, because it is the shop's own truth:
 * the specification rows built from the selected variant, the warnings about
 * what a licence will not do, the sale notice, the queued-buyer form when a
 * product is out, the payment marks and the registration block.
 */
export default async function ProductPage({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('product');
  const tc = await getTranslations('common');
  const tf = await getTranslations('format');
  const tr = await getTranslations('reviews');
  const ar = isArabic(locale);

  const [product, reviews, marketing] = await Promise.all([
    getProduct(slug, { locale }),
    getProductReviews(slug, { locale }),
    getMarketingPublic({ locale }),
  ]);
  // A slug that no longer exists may have been renamed rather than removed —
  // the redirect map is consulted before the 404, and the miss is recorded.
  // Narrowed by hand: `goneOrRedirect` never returns, but TypeScript
  // cannot see that through an awaited `Promise<never>`.
  if (!product) {
    await goneOrRedirect(ROUTES.product(slug), locale);
    notFound();
  }

  const selected =
    product.variants.find((variant) => variant.id === product.selectedVariantId) ??
    product.variants[0];
  if (!selected) notFound();

  const prefix = ar ? '' : `/${locale}`;
  const pageUrl = new URL(`${prefix}${ROUTES.product(slug)}`, SITE_URL).toString();

  // First-party analytics: one row per view, sent from here and not awaited.
  recordEvent({
    type: 'PRODUCT_VIEW',
    path: `${prefix}${ROUTES.product(slug)}`,
    locale,
    productSlug: slug,
    searchParams: (await searchParams) ?? {},
  });

  /**
   * The aggregate goes on the Product node that is already in the graph, never
   * in a second one — `buildGraph` throws on two Product entities in one page.
   * It is taken from the reviews response rather than the denormalised columns
   * on Product, because that is the same arithmetic over the same rows the
   * section below renders; the columns are the fallback if the reviews call
   * failed. When the count is zero, no rating is emitted at all.
   */
  const rating =
    reviews && reviews.aggregate.count > 0
      ? { value: reviews.aggregate.average, count: reviews.aggregate.count }
      : (product.rating ?? undefined);

  const graph = buildGraph([
    jsonld.breadcrumbs(
      product.breadcrumbs.map((crumb) => ({
        name: crumb.name,
        url: new URL(`${prefix}${crumb.href}`, SITE_URL).toString(),
      })),
    ),
    jsonld.product({
      url: pageUrl,
      name: product.name,
      description: product.seo.description ?? product.shortDesc ?? product.name,
      sku: selected.sku,
      ...(product.brand ? { brandName: product.brand.name } : {}),
      imageUrls: product.images.map((image) => image.url),
      // The price handed to the structured data is the same object the page
      // renders, field for field.
      price: { amount: selected.price.amount, currency: selected.price.currency },
      inStock: selected.inStock,
      // The range the licence picker shows, from the same variant prices.
      ...(product.variants.length > 1 ? { priceRange: priceRangeOf(product.variants) } : {}),
      // During a seasonal sale the offer is valid until the sale ends, when
      // the price really comes back — the same date the page counts down to.
      priceValidUntil: product.sale ? product.sale.endsAt.slice(0, 10) : PRICE_VALID_UNTIL,
      // The Golden Warranty is a replacement promise, not a refund: a key that
      // does not work within seven days is replaced free. Declared only on the
      // products that carry it.
      ...(product.hasGoldenWarranty
        ? {
            returnPolicy: {
              countries: GCC_COUNTRIES,
              days: 7,
              url: new URL(`${prefix}${ROUTES.goldenWarranty}`, SITE_URL).toString(),
              refund: 'exchange' as const,
            },
          }
        : {}),
      // Emitted only from approved, verified-purchase reviews.
      ...(rating ? { rating } : {}),
    }),
    product.faq ? jsonld.faqPage(product.faq) : null,
  ]);

  // The page's sections, for the kit's tab row. Only the ones that exist.
  const sections: { id: string; label: string }[] = [];
  if (product.body.length > 0) sections.push({ id: 'about', label: t('about') });
  if (product.activationSteps) sections.push({ id: 'activation', label: t('howToActivate') });
  if (product.faq) sections.push({ id: 'faq', label: t('faq') });
  if (reviews) sections.push({ id: 'reviews', label: tr('title') });

  return (
    <main className="product-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />

      <div className="page-band">
        <div className="shell">
          <Breadcrumbs
            items={product.breadcrumbs.map((crumb) => ({
              name: crumb.name,
              href: `${prefix}${crumb.href}`,
            }))}
          />
        </div>
      </div>

      <div className="shell">
        <div className="details">
          <div className="product-media-col">
            <ProductGallery
              images={product.images.map((image) => ({ url: image.url, alt: image.alt }))}
              slug={product.slug}
              name={product.name}
            />

            <ProductTrust hasGoldenWarranty={product.hasGoldenWarranty} />

            {/* The store's own guarantee and registration, from the marketing
                panel; absent while that feature is off or says nothing. */}
            {marketing?.trust?.showOnProduct ? (
              <TrustBlock
                trust={marketing.trust}
                locale={locale}
                delivery={deliveryPromise(
                  product.variants,
                  localText(marketing.trust.instantDeliveryText, locale),
                  tf,
                )}
              />
            ) : null}
          </div>

          <div className="buybox">
            <div className="badge-row">
              <span className="badge">{t('digitalProduct')}</span>
              {product.brand ? (
                <Link className="badge badge-brand" href={`${prefix}/brands/${product.brand.slug}`}>
                  {product.brand.name}
                </Link>
              ) : null}
            </div>

            <h1>{product.name}</h1>
            {product.shortDesc ? <p className="lede">{product.shortDesc}</p> : null}

            {/* A link rather than a repeat: the stars belong to the section
                below, and a rating printed twice on one page is two numbers that
                can fall out of step. Absent entirely when nothing is published. */}
            <div className="proof-row">
              {reviews && reviews.aggregate.count > 0 ? (
                <p className="proof">
                  <a href="#reviews">
                    {t('ratingProof', {
                      average: reviews.aggregate.average,
                      count: reviews.aggregate.count,
                    })}
                  </a>
                </p>
              ) : null}
              {/* Real orders only, and only above the floor where a count is
                  proof rather than noise. */}
              {product.salesCount > 0 ? (
                <p className="proof">{t('salesProof', { count: product.salesCount })}</p>
              ) : null}
            </div>

            {/* The badge and licence number sit above the price they explain;
                the price itself already is the sale price. */}
            {product.sale ? <SaleNotice sale={product.sale} /> : null}

            {/* The price, the picker, the specification rows and the buy
                button move together: they all describe the selected variant. */}
            <BuyBox product={product} locale={locale} />

            <p className="access-note">
              <DownloadIcon size={20} />
              <span>{t('accessNote')}</span>
            </p>

            {marketing?.business ? (
              <BusinessQuote
                productSlug={product.slug}
                productName={product.name}
                minSeats={marketing.business.minSeats}
                locale={locale}
              />
            ) : null}

            {!selected.inStock ? (
              <div className="oos">
                {/* The legacy store greeted its highest-traffic product page with
                    "غير متوفر" and offered nothing else. Now the visit becomes a
                    queued buyer — one email when keys arrive — with a person on
                    WhatsApp beside it for anyone who would rather ask. */}
                <StockAlert variantId={selected.id} locale={locale} />
                <a
                  className="btn btn-outline"
                  href={whatsappLink(
                    t('whatsappWhenBack', { name: product.name, url: pageUrl }),
                    'product_back_in_stock',
                  )}
                  rel="noopener"
                >
                  {t('askWhenBack')}
                </a>
              </div>
            ) : null}

            {/* Below the buy box, not above it: on a phone the notices sit in
                the page here, and anything inserted above the button would push
                it down under a thumb that was already on its way. */}
            {marketing?.socialProof ? (
              <SocialProofNotices
                key={product.slug}
                slug={product.slug}
                locale={locale}
                settings={marketing.socialProof}
              />
            ) : null}

            {product.isDraft ? <p className="draft-flag">{tc('draftPreview')}</p> : null}
          </div>
        </div>
      </div>

      {/* --- the kit's tabs, over the sections they point at ---------------- */}
      {sections.length > 0 ? (
        <div className="shell product-sections">
          <nav className="tabs" aria-label={t('sections')}>
            {sections.map((section) => (
              <a key={section.id} className="tab" href={`#${section.id}`}>
                {section.label}
              </a>
            ))}
          </nav>

          {/* What this licence will not do, before the description rather than
              after it: "not for Windows 10 Home", "region-locked to the GCC" is
              what a shopper needs before they decide. A refund costs more than
              a sale not made. */}
          {product.warnings.length > 0 ? (
            <section className="product-warnings" aria-label={t('beforeYouBuy')}>
              {product.warnings.map((warning) => (
                <p
                  key={warning.text}
                  className={`alert ${warning.severity === 'critical' ? 'alert-error' : 'alert-warning'}`}
                >
                  {warning.severity === 'critical' ? <WarningIcon /> : <InfoIcon size={20} />}
                  <span>{warning.text}</span>
                </p>
              ))}
            </section>
          ) : null}

          {product.body.length > 0 ? (
            <section className="panel prose" id="about">
              <h2>{t('about')}</h2>
              <Blocks blocks={product.body} />
            </section>
          ) : null}

          {product.activationSteps ? (
            <section className="panel prose activation" id="activation">
              <h2>{t('howToActivate')}</h2>
              <ol className="steps-list">
                {product.activationSteps.map((step) => (
                  <li key={step.step}>
                    <span className="stepnum" dir="ltr">
                      {String(step.step).padStart(2, '0')}
                    </span>
                    <span>{step.text}</span>
                  </li>
                ))}
              </ol>
              {product.downloadUrl ? (
                <p>
                  <a
                    className="btn btn-text"
                    href={product.downloadUrl}
                    rel="nofollow noopener"
                    target="_blank"
                  >
                    <DownloadIcon size={20} />
                    <span>{t('officialDownload')}</span>
                  </a>
                </p>
              ) : null}
            </section>
          ) : null}

          {product.faq ? (
            <section className="panel" id="faq">
              <h2>{t('faq')}</h2>
              <div className="faq-list">
                {product.faq.map((item, index) => (
                  <details key={index} className="faqrow">
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
          ) : null}

          {/* The offer of help at the end of the description: somebody who has
              read this far either bought it or has a question the page did not
              answer. A link to WhatsApp and nothing else. */}
          <aside className="help-cta">
            <span className="iconbox" aria-hidden="true">
              <HeadsetIcon />
            </span>
            <div>
              <h3>{t('helpTitle')}</h3>
              <p>{t('helpBody')}</p>
            </div>
            <a
              className="btn btn-outline"
              href={whatsappLink(
                t('whatsappQuestion', { name: product.name, url: pageUrl }),
                'product_question',
              )}
              rel="noopener"
            >
              {t('getHelp')}
            </a>
          </aside>
        </div>
      ) : null}

      {/* Rendered whether or not there are any, because "none yet, and here is
          why" is a claim worth making on a store whose predecessor showed 4.6
          stars on 81 products nobody had reviewed. Omitted only when the API
          could not be reached, where an empty section would be a lie. */}
      {reviews ? (
        <div className="band band-soft">
          <div className="shell">
            <Reviews reviews={reviews} />
          </div>
        </div>
      ) : null}

      {/* Posts that name this product. Empty for most products and absent
          rather than padded when it is. */}
      {product.articles.length > 0 ? (
        <div className="shell">
          <section className="product-articles">
            <h2>{t('readBeforeBuy')}</h2>
            <ul className="post-strip">
              {product.articles.map((article) => (
                <li key={article.slug} className="article">
                  <Link href={`${prefix}${ROUTES.post(article.slug)}`}>
                    <strong>{article.title}</strong>
                    {article.summary ? (
                      <span className="post-strip-sub">{article.summary}</span>
                    ) : null}
                    {article.readingMinutes > 0 ? (
                      <span className="article-more">
                        {readingLabel(article.readingMinutes, tf)}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {/* What else is on the same shelf: the kit's "you may also like" grid.
          Absent entirely when the shelf holds nothing else. */}
      {product.related.length > 0 ? (
        <div className="band band-soft">
          <section className="shell related">
            <header className="section-head">
              <h2>{t('related')}</h2>
              <Link className="section-more" href={`${prefix}${ROUTES.store}`}>
                <span>{t('viewAllRelated')}</span>
                <ArrowIcon size={18} />
              </Link>
            </header>
            <div className="grid">
              {product.related.slice(0, 4).map((card) => (
                <ProductCard key={card.slug} card={card} locale={locale} />
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
