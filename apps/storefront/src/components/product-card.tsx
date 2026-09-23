import type { CatalogCard } from '@da/contracts';
import { LOW_STOCK_THRESHOLD } from '@da/contracts';
import Image from 'next/image';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { isArabic } from '../i18n/locale';
import { formatPrice } from '../lib/format';

import { AddToCart } from './add-to-cart';
import { BoltIcon, ProductGlyph, ShieldCheckIcon } from './icons';

/**
 * Grid card.
 *
 * Every claim on it is read from real data.
 * The buy button sits outside the link rather than inside it.
 *
 * A plain server-rendered `<article>`. It was a framer-motion element for a
 * 4px hover lift, which made every card on every listing a client component
 * shipping an animation runtime; `.card:hover` in catalog.css already lifts
 * it, in CSS.
 */
export function ProductCard({ card, locale }: { card: CatalogCard; locale: string }) {
  const t = useTranslations('productCard');
  const to = useTranslations('offers');
  const tc = useTranslations('common');
  const href = isArabic(locale) ? `/store/${card.slug}` : `/${locale}/store/${card.slug}`;
  const lowStock =
    card.inStock &&
    card.available !== null &&
    card.available > 0 &&
    card.available <= LOW_STOCK_THRESHOLD;

  const discount = card.price.discountPercent;

  return (
    <article className="card">
      <Link href={href} className="card-link">
        <div className="card-media">
          {card.image ? (
            <Image
              src={card.image.url}
              alt={card.image.alt}
              fill
              sizes="(max-width: 700px) 50vw, 260px"
            />
          ) : (
            <ProductGlyph slug={card.slug} />
          )}

          {discount ? (
            <span
              className="card-discount-tag"
              aria-label={t('discountLabel', { percent: String(discount) })}
            >
              {`-${String(discount)}%`}
            </span>
          ) : null}

          {card.fulfillmentMode === 'FROM_STOCK' && card.inStock ? (
            <span className="card-instant-tag">
              <BoltIcon size={12} />
              <span>{t('instant')}</span>
            </span>
          ) : null}
        </div>

        <div className="card-body">
          {card.brand ? <p className="card-brand">{card.brand}</p> : null}
          <h3 className="card-title">{card.name}</h3>
          {card.shortDesc ? <p className="card-desc">{card.shortDesc}</p> : null}

          <div className="card-badges">
            {card.hasGoldenWarranty ? (
              <span className="badge badge-warranty">
                <ShieldCheckIcon size={13} />
                <span>{tc('goldenWarranty')}</span>
              </span>
            ) : null}
            {card.variantCount > 1 ? (
              <span className="badge badge-options">
                {t('options', { count: card.variantCount })}
              </span>
            ) : null}
            {card.salesCount > 0 ? (
              <span className="badge badge-sales">
                {t('sold', { count: String(card.salesCount) })}
              </span>
            ) : null}
          </div>

          {/* A sale's discount carries its Ministry of Commerce licence number
              wherever the discount is shown, the grid included. */}
          {card.sale?.licenceNumber ? (
            <p className="card-licence">
              {to.rich('licence', {
                number: card.sale.licenceNumber,
                ltr: (chunks) => <span dir="ltr">{chunks}</span>,
              })}
            </p>
          ) : null}

          <div className="card-footer">
            <p className="card-price">
              {card.variantCount > 1 ? <span className="card-from">{t('from')}</span> : null}
              <strong>{formatPrice(card.price)}</strong>
              {card.price.compareAt ? (
                <s>
                  {formatPrice({ amount: card.price.compareAt, currency: card.price.currency })}
                </s>
              ) : null}
            </p>

            {card.inStock ? (
              lowStock ? (
                <span className="stock stock-low">
                  {t('onlyLeft', { count: String(card.available ?? 0) })}
                </span>
              ) : (
                <span className="stock stock-in">
                  {card.fulfillmentMode === 'FROM_STOCK' ? t('inStock') : t('availableToOrder')}
                </span>
              )
            ) : (
              <span className="stock stock-out">{t('outOfStock')}</span>
            )}
          </div>
        </div>
      </Link>

      {/* Outside the link, so pressing it adds rather than navigates. */}
      {card.inStock ? (
        <div className="card-actions">
          {card.buyableVariantId ? (
            <AddToCart
              variantId={card.buyableVariantId}
              locale={locale}
              currency={card.price.currency}
            />
          ) : (
            /* More than one thing to buy here, so the honest control is the
               one that goes and asks which. */
            <Link href={href} className="card-buy card-buy-choose">
              {t('chooseOption')}
            </Link>
          )}
        </div>
      ) : null}

      {card.isDraft ? <p className="draft-flag">{tc('draft')}</p> : null}
    </article>
  );
}
