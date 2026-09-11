import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { LOW_STOCK_THRESHOLD, ROUTES } from '@da/contracts';
import { alternates, buildGraph, canonical, jsonld } from '@da/seo';

import { Blocks } from '../../../../components/blocks';
import { getProduct } from '../../../../lib/api';
import {
  formatActivation,
  formatDelivery,
  formatFulfillment,
  formatDevices,
  formatLicensePeriod,
  formatPrice,
  variantLabel,
} from '../../../../lib/format';
import { robotsMeta } from '../../../../lib/seo';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://digital-activation.com';

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const product = await getProduct(slug, { locale });
  if (!product) return { title: 'Not found', robots: { index: false, follow: false } };

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

  const product = await getProduct(slug, { locale });
  if (!product) notFound();

  const selected =
    product.variants.find((variant) => variant.id === product.selectedVariantId) ??
    product.variants[0];
  if (!selected) notFound();

  const prefix = ar ? '' : `/${locale}`;
  const pageUrl = new URL(`${prefix}${ROUTES.product(slug)}`, SITE_URL).toString();
  const lowStock =
    selected.inStock && selected.available !== null && selected.available <= LOW_STOCK_THRESHOLD;

  /**
   * The price handed to the structured data is the same object the page
   * renders, field for field. That is the whole point: the legacy page printed
   * د.إ36.36 while its markup declared `"price":"36.36","priceCurrency":"USD"`
   * — the dirham figure labelled as dollars — and Google discards markup that
   * contradicts the page it sits on.
   */
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
      // Emitted only from approved, verified-purchase reviews. There are none
      // yet, and inventing one is what produced 565 synthetic reviews on the
      // store this replaces.
      ...(product.rating ? { rating: product.rating } : {}),
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

          {/* Real orders only, and only above the floor where a count is proof
              rather than noise. */}
          {product.salesCount > 0 ? (
            <p className="proof">
              {ar
                ? `تم بيعه ${String(product.salesCount)} مرة`
                : `Sold ${String(product.salesCount)} times`}
            </p>
          ) : null}

          <p className="price">
            <strong>{formatPrice(selected.price)}</strong>
            {selected.price.compareAt ? (
              <>
                <s>
                  {formatPrice({
                    amount: selected.price.compareAt,
                    currency: selected.price.currency,
                  })}
                </s>
                {selected.price.discountPercent ? (
                  <span className="badge badge-accent">
                    {ar
                      ? `خصم ${String(selected.price.discountPercent)}%`
                      : `${String(selected.price.discountPercent)}% off`}
                  </span>
                ) : null}
              </>
            ) : null}
          </p>

          {product.variants.length > 1 ? (
            <fieldset className="variants">
              <legend>{ar ? 'اختر الترخيص' : 'Choose your licence'}</legend>
              <div className="variant-list">
                {product.variants.map((variant) => (
                  <label
                    key={variant.id}
                    className={`variant${variant.id === selected.id ? ' is-selected' : ''}${
                      variant.inStock ? '' : ' is-out'
                    }`}
                  >
                    <input
                      type="radio"
                      name="variant"
                      value={variant.id}
                      defaultChecked={variant.id === selected.id}
                      disabled={!variant.inStock}
                    />
                    <span className="variant-label">{variantLabel(variant, locale)}</span>
                    <span className="variant-price">{formatPrice(variant.price)}</span>
                    {!variant.inStock ? (
                      <span className="variant-out">{ar ? 'نافد' : 'Sold out'}</span>
                    ) : null}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <dl className="specs">
            <div>
              <dt>{ar ? 'مدّة الترخيص' : 'Licence term'}</dt>
              <dd>{formatLicensePeriod(selected, locale)}</dd>
            </div>
            <div>
              <dt>{ar ? 'عدد الأجهزة' : 'Devices'}</dt>
              <dd>{formatDevices(selected.deviceCount, locale)}</dd>
            </div>
            <div>
              <dt>{ar ? 'طريقة التفعيل' : 'Activation'}</dt>
              <dd>{formatActivation(selected.activationMethod, locale)}</dd>
            </div>
            <div>
              <dt>{ar ? 'التسليم' : 'Delivery'}</dt>
              <dd>
                {formatDelivery(selected.deliverySlaSeconds, locale, selected.fulfillmentMode)}
              </dd>
            </div>
            {/* How the licence is supplied, said plainly. Most of this catalog
                is ordered from a supplier after purchase, and the reason —
                that a code's term starts the moment it is bought — is the
                reason a buyer should prefer it, not something to hide. */}
            <div>
              <dt>{ar ? 'طريقة التوريد' : 'How it is supplied'}</dt>
              <dd>{formatFulfillment(selected.fulfillmentMode, locale)}</dd>
            </div>
            {selected.requiresActivationEmail ? (
              <div>
                <dt>{ar ? 'مطلوب منك' : 'We will need'}</dt>
                <dd>
                  {ar
                    ? 'البريد الإلكتروني الذي تريد تفعيل الترخيص عليه — نطلبه عند الدفع'
                    : 'The email address the licence should be activated on — asked at checkout'}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>{ar ? 'المنصّة' : 'Platform'}</dt>
              <dd>{selected.platform.replace('_', ' ').toLowerCase()}</dd>
            </div>
            {product.hasGoldenWarranty ? (
              <div>
                <dt>{ar ? 'الضمان' : 'Warranty'}</dt>
                <dd>{ar ? 'الضمان الذهبي' : 'Golden Warranty'}</dd>
              </div>
            ) : null}
          </dl>

          {selected.inStock ? (
            <>
              {lowStock ? (
                <p className="stock stock-low">
                  {ar
                    ? `بقي ${String(selected.available ?? 0)} فقط`
                    : `Only ${String(selected.available ?? 0)} left`}
                </p>
              ) : null}
              <button type="button" className="buy">
                {ar ? 'أضف إلى السلة' : 'Add to cart'}
              </button>
            </>
          ) : (
            <div className="oos">
              <p className="stock stock-out">{ar ? 'غير متوفر حالياً' : 'Out of stock'}</p>
              {/* The legacy store greeted its highest-traffic product page with
                  "غير متوفر" and offered nothing else. A waiting list turns that
                  visit into a queued buyer. */}
              <button type="button" className="notify">
                {ar ? 'نبّهني عند التوفّر' : 'Notify me when available'}
              </button>
            </div>
          )}

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

      {product.body.length > 0 ? (
        <section className="prose">
          <Blocks blocks={product.body} />
        </section>
      ) : null}

      {product.faq ? (
        <section className="prose faq">
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
    </main>
  );
}
