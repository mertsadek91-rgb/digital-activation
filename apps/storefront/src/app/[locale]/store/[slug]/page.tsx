import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ROUTES } from '@da/contracts';
import { alternates, buildGraph, canonical, jsonld } from '@da/seo';

import { Blocks } from '../../../../components/blocks';
import { BuyBox } from '../../../../components/buy-box';
import { SupportIcon } from '../../../../components/icons';
import { ProductCard } from '../../../../components/product-card';
import { ProductGallery } from '../../../../components/product-gallery';
import { ProductTrust } from '../../../../components/product-trust';
import { Reviews } from '../../../../components/reviews';
import { SocialProofNotices } from '../../../../components/social-proof';
import { StockAlert } from '../../../../components/stock-alert';
import { TrustBlock } from '../../../../components/trust-block';
import { isArabic } from '../../../../i18n/locale';
import { whatsappLink } from '../../../../lib/contact';
import { readingLabel } from '../../../../lib/format';
import { getMarketingPublic, getProduct, getProductReviews } from '../../../../lib/api';
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

export default async function ProductPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('product');
  const tc = await getTranslations('common');
  const tf = await getTranslations('format');
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

  /**
   * The price handed to the structured data is the same object the page
   * renders, field for field. That is the whole point: the legacy page printed
   * د.إ36.36 while its markup declared `"price":"36.36","priceCurrency":"USD"`
   * — the dirham figure labelled as dollars — and Google discards markup that
   * contradicts the page it sits on.
   */
  /**
   * The aggregate goes on the Product node that is already in the graph, never
   * in a second one — `buildGraph` throws on two Product entities in one page,
   * which is exactly the defect this store shipped for years.
   *
   * It is taken from the reviews response rather than the denormalised columns
   * on Product, because that is the same arithmetic over the same rows the
   * section below renders. The columns are the fast path for product cards and
   * are rewritten on every moderation decision; if the reviews call failed,
   * they are the fallback rather than emitting nothing.
   *
   * And when the count is zero, no rating is emitted at all. An AggregateRating
   * with a count of zero is not neutral — Google treats an empty or invented
   * rating as a reason to drop the whole rich result.
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
      price: { amount: selected.price.amount, currency: selected.price.currency },
      inStock: selected.inStock,
      // The range the licence picker shows, from the same variant prices.
      ...(product.variants.length > 1 ? { priceRange: priceRangeOf(product.variants) } : {}),
      priceValidUntil: PRICE_VALID_UNTIL,
      // The Golden Warranty is a replacement promise, not a refund: a key that
      // does not work within seven days is replaced free. Declared only on the
      // products that carry it — it has exclusions, and a product outside it
      // makes no such promise.
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
      // Emitted only from approved, verified-purchase reviews. Inventing one
      // is what produced 565 synthetic reviews on the store this replaces.
      ...(rating ? { rating } : {}),
    }),
    product.faq ? jsonld.faqPage(product.faq) : null,
  ]);

  return (
    <main className="shell product">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />

      <nav aria-label={tc('breadcrumb')} className="crumbs">
        {product.breadcrumbs.map((crumb, index) => (
          <span key={`${crumb.href}-${String(index)}`}>
            {index > 0 ? <span aria-hidden="true"> › </span> : null}
            {index === product.breadcrumbs.length - 1 ? (
              <span aria-current="page">{crumb.name}</span>
            ) : (
              <Link href={`${prefix}${crumb.href}`}>{crumb.name}</Link>
            )}
          </span>
        ))}
      </nav>

      <div className="product-top">
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
          {product.brand ? (
            <Link className="brand" href={`${prefix}/brands/${product.brand.slug}`}>
              {product.brand.name}
            </Link>
          ) : null}

          <h1>{product.name}</h1>
          {product.shortDesc ? <p className="lede">{product.shortDesc}</p> : null}

          {/* A link rather than a repeat: the stars belong to the section
              below, and a rating printed twice on one page is two numbers that
              can fall out of step. Absent entirely when nothing is published. */}
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

          {/* Real orders only, and only above the floor where a count is proof
              rather than noise. */}
          {product.salesCount > 0 ? (
            <p className="proof">
              {t('salesProof', { count: product.salesCount })}
            </p>
          ) : null}

          {/* The price, the picker, the specification table and the buy
              button move together. They all describe the selected variant, and
              a page where choosing "3 years" leaves the 1-year price on screen
              is worse than one with no picker. */}
          <BuyBox product={product} locale={locale} />

          {!selected.inStock ? (
            <div className="oos">
              {/* The legacy store greeted its highest-traffic product page with
                  "غير متوفر" and offered nothing else. Now the visit becomes a
                  queued buyer — one email when keys arrive — with a person on
                  WhatsApp beside it for anyone who would rather ask. */}
              <StockAlert variantId={selected.id} locale={locale} />
              <a
                className="notify"
                href={whatsappLink(t('whatsappWhenBack', { name: product.name, url: pageUrl }))}
                rel="noopener noreferrer"
              >
                {t('askWhenBack')}
              </a>
            </div>
          ) : null}

          {/* Below the buy box, not above it: on a phone the notices sit in the
              page here, and anything inserted above the button would push it
              down under a thumb that was already on its way. Keyed by slug so
              a new product starts a new, separately budgeted page. */}
          {marketing?.socialProof ? (
            <SocialProofNotices
              key={product.slug}
              slug={product.slug}
              locale={locale}
              settings={marketing.socialProof}
            />
          ) : null}

          {product.isDraft ? (
            <p className="draft-flag">{tc('draftPreview')}</p>
          ) : null}
        </div>
      </div>

      {product.activationSteps ? (
        <section className="prose steps">
          <h2>{t('howToActivate')}</h2>
          <ol>
            {product.activationSteps.map((step) => (
              <li key={step.step}>{step.text}</li>
            ))}
          </ol>
          {product.downloadUrl ? (
            <p>
              <a href={product.downloadUrl} rel="nofollow noopener" target="_blank">
                {t('officialDownload')}
              </a>
            </p>
          ) : null}
        </section>
      ) : null}

      {/*
        What this licence will not do.
        
        Above the description rather than below it, because the sentence that
        matters here — "not for Windows 10 Home", "region-locked to the GCC" —
        is the one a shopper needs before they decide, not after. A refund
        costs more than a sale not made.
      */}
      {product.warnings.length > 0 ? (
        <section className="product-warnings" aria-label={t('beforeYouBuy')}>
          <ul>
            {product.warnings.map((warning) => (
              <li key={warning.text} className={`warning-${warning.severity}`}>
                <span aria-hidden="true">{warning.severity === 'critical' ? '!' : 'i'}</span>
                {warning.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* The description and the reviews side by side, which is how the store
          this replaces lays out the same two things — and it is the right
          arrangement for a page whose description runs to two screens: stacked,
          the reviews are below a fold nobody reaches, and they are the part a
          hesitant buyer came for. One column on a phone, description first. */}
      <div className="product-detail">
        <div className="detail-main">
          {product.body.length > 0 ? (
            <section className="prose panel">
              <h2>{t('about')}</h2>
              <Blocks blocks={product.body} />
            </section>
          ) : null}

          {product.faq ? (
            <section className="prose panel faq">
              <h2>{t('faq')}</h2>
              <dl>
                {product.faq.map((item, index) => (
                  <div key={index}>
                    <dt>{item.q}</dt>
                    <dd>{item.a}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {/* The old page ends its description with an offer of help, and it
              is the right place for one: somebody who has read this far either
              bought it or has a question the page did not answer. */}
          <aside className="help-cta">
            <span className="help-mark" aria-hidden="true">
              <SupportIcon />
            </span>
            <div>
              <strong>{t('helpTitle')}</strong>
              <p>{t('helpBody')}</p>
            </div>
            {/* Prefilled with the product and its link, so the first reply is
                an answer rather than "which product?". */}
            <a
              className="btn btn-ghost"
              href={whatsappLink(t('whatsappQuestion', { name: product.name, url: pageUrl }))}
              rel="noopener noreferrer"
            >
              {t('getHelp')}
            </a>
          </aside>
        </div>

        {/* Rendered whether or not there are any, because "none yet, and here
            is why" is a claim worth making on a store whose predecessor showed
            4.6 stars on 81 products nobody had reviewed. Omitted only when the
            API could not be reached, where an empty section would be a lie. */}
        {reviews ? (
          <div className="detail-side">
            <Reviews reviews={reviews} />
          </div>
        ) : null}
      </div>

      {/* The other half of the article link: posts that name this product.
          A shelf answers "which one"; an article answers "why this one rather
          than that one", and the person still deciding is the one most likely
          to leave. Empty for most products — seven posts cannot cover
          sixty-eight — and absent rather than padded when it is. */}
      {product.articles.length > 0 ? (
        <section className="product-articles">
          <h2>{t('readBeforeBuy')}</h2>
          <ul>
            {product.articles.map((article) => (
              <li key={article.slug}>
                <Link href={`${prefix}${ROUTES.post(article.slug)}`}>
                  <strong>{article.title}</strong>
                  {article.summary ? <span>{article.summary}</span> : null}
                </Link>
                {article.readingMinutes > 0 ? (
                  <span className="post-meta">{readingLabel(article.readingMinutes, tf)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* What else is on the same shelf. Absent entirely when the shelf holds
          nothing else, rather than padded out with whatever the catalog has. */}
      {product.related.length > 0 ? (
        <section className="related">
          <h2>{t('related')}</h2>
          <div className="related-row">
            {product.related.map((card) => (
              <ProductCard key={card.slug} card={card} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
