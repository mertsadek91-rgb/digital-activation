import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { ROUTES } from '@da/contracts';
import { alternates, buildGraph, canonical, jsonld } from '@da/seo';

import { Blocks } from '../../../../components/blocks';
import { BuyBox } from '../../../../components/buy-box';
import { SupportIcon } from '../../../../components/icons';
import { ProductCard } from '../../../../components/product-card';
import { Reviews } from '../../../../components/reviews';
import { getProduct, getProductReviews } from '../../../../lib/api';
import { goneOrRedirect } from '../../../../lib/gone';
import { notFoundMetadata, robotsMeta } from '../../../../lib/seo';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://digital-activation.com';
/** Digits only: `wa.me` takes no groups. The same number the footer prints. */
const WHATSAPP_DIAL = '966534255367';

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
    title: product.seo.title ?? product.name,
    description: product.seo.description ?? product.shortDesc,
    robots: robotsMeta(process.env.NEXT_PUBLIC_SITE_URL),
    alternates: {
      canonical: canonical(SITE_URL, path, locale === 'en' ? 'en' : 'ar'),
      languages: Object.fromEntries(links.map((link) => [link.hrefLang, link.href])),
    },
    openGraph: {
      title: product.seo.title ?? product.name,
      description: product.seo.description ?? product.shortDesc ?? undefined,
      images: product.images.slice(0, 1).map((image) => ({ url: image.url, alt: image.alt })),
      type: 'website',
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const ar = locale === 'ar';

  const [product, reviews] = await Promise.all([
    getProduct(slug, { locale }),
    getProductReviews(slug, { locale }),
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
      // Emitted only from approved, verified-purchase reviews. Inventing one
      // is what produced 565 synthetic reviews on the store this replaces.
      ...(rating ? { rating } : {}),
    }),
    product.faq ? jsonld.faqPage(product.faq) : null,
  ]);

  return (
    <main className="shell product">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />

      <nav aria-label={ar ? 'مسار التنقّل' : 'Breadcrumb'} className="crumbs">
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
        <div className="gallery">
          {product.images[0] ? (
            <Image
              src={product.images[0].url}
              alt={product.images[0].alt}
              fill
              priority
              sizes="(max-width: 900px) 100vw, 480px"
            />
          ) : (
            <div className="gallery-empty">{ar ? 'لا صورة بعد' : 'No image yet'}</div>
          )}
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
                {ar
                  ? `${reviews.aggregate.average} من 5 — ${String(reviews.aggregate.count)} تقييماً من مشترين`
                  : `${reviews.aggregate.average} out of 5 — ${String(reviews.aggregate.count)} verified reviews`}
              </a>
            </p>
          ) : null}

          {/* Real orders only, and only above the floor where a count is proof
              rather than noise. */}
          {product.salesCount > 0 ? (
            <p className="proof">
              {ar
                ? `تم بيعه ${String(product.salesCount)} مرة`
                : `Sold ${String(product.salesCount)} times`}
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
                  "غير متوفر" and offered nothing else. A waiting list turns
                  that visit into a queued buyer. */}
              <button type="button" className="notify">
                {ar ? 'نبّهني عند التوفّر' : 'Notify me when available'}
              </button>
            </div>
          ) : null}

          {product.isDraft ? (
            <p className="draft-flag">
              {ar ? 'مسودّة — مرئية في المعاينة فقط' : 'Draft — visible in preview only'}
            </p>
          ) : null}
        </div>
      </div>

      {product.activationSteps ? (
        <section className="prose steps">
          <h2>{ar ? 'خطوات التفعيل' : 'How to activate'}</h2>
          <ol>
            {product.activationSteps.map((step) => (
              <li key={step.step}>{step.text}</li>
            ))}
          </ol>
          {product.downloadUrl ? (
            <p>
              <a href={product.downloadUrl} rel="nofollow noopener" target="_blank">
                {ar ? 'رابط التحميل الرسمي' : 'Official download link'}
              </a>
            </p>
          ) : null}
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
              <h2>{ar ? 'وصف المنتج' : 'About this product'}</h2>
              <Blocks blocks={product.body} />
            </section>
          ) : null}

          {product.faq ? (
            <section className="prose panel faq">
              <h2>{ar ? 'أسئلة متكرّرة' : 'Frequently asked'}</h2>
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
              <strong>{ar ? 'لا تتردّد في طلب الدعم' : 'Ask us before you buy'}</strong>
              <p>
                {ar
                  ? 'عندك سؤال عن التفعيل أو عن النسخة المناسبة لك؟ راسلنا وسنردّ عليك.'
                  : 'Not sure which licence you need, or how it activates? Message us and a person will answer.'}
              </p>
            </div>
            <a
              className="btn btn-ghost"
              href={`https://wa.me/${WHATSAPP_DIAL}`}
              rel="noopener noreferrer"
            >
              {ar ? 'اطلب الدعم' : 'Get help'}
            </a>
          </aside>
        </div>

        {/* Rendered whether or not there are any, because "none yet, and here
            is why" is a claim worth making on a store whose predecessor showed
            4.6 stars on 81 products nobody had reviewed. Omitted only when the
            API could not be reached, where an empty section would be a lie. */}
        {reviews ? (
          <div className="detail-side">
            <Reviews reviews={reviews} locale={locale} />
          </div>
        ) : null}
      </div>

      {/* What else is on the same shelf. Absent entirely when the shelf holds
          nothing else, rather than padded out with whatever the catalog has. */}
      {product.related.length > 0 ? (
        <section className="related">
          <h2>{ar ? 'منتجات قد تعجبك' : 'You might also like'}</h2>
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
