import type { CatalogCard } from '@da/contracts';
import { LOW_STOCK_THRESHOLD } from '@da/contracts';
import Image from 'next/image';
import Link from 'next/link';

import { formatPrice } from '../lib/format';

import { AddToCart } from './add-to-cart';
import { BoltIcon, ProductGlyph, ShieldCheckIcon } from './icons';
import { MotionCard } from './motion-wrapper';

/**
 * Grid card.
 *
 * Every claim on it is read from real data.
 * The buy button sits outside the link rather than inside it.
 */
export function ProductCard({ card, locale }: { card: CatalogCard; locale: string }) {
  const ar = locale === 'ar';
  const href = locale === 'ar' ? `/store/${card.slug}` : `/${locale}/store/${card.slug}`;
  const lowStock =
    card.inStock &&
    card.available !== null &&
    card.available > 0 &&
    card.available <= LOW_STOCK_THRESHOLD;

  const discount = card.price.discountPercent;

  return (
    <MotionCard className="card">
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
              aria-label={ar ? `خصم ${discount}%` : `${discount}% discount`}
            >
              {ar ? `-${discount}%` : `-${discount}%`}
            </span>
          ) : null}

          {card.fulfillmentMode === 'FROM_STOCK' && card.inStock ? (
            <span className="card-instant-tag">
              <BoltIcon size={12} />
              <span>{ar ? 'فوري' : 'Instant'}</span>
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
                <span>{ar ? 'الضمان الذهبي' : 'Golden Warranty'}</span>
              </span>
            ) : null}
            {card.variantCount > 1 ? (
              <span className="badge badge-options">
                {ar
                  ? `${String(card.variantCount)} خيارات`
                  : `${String(card.variantCount)} options`}
              </span>
            ) : null}
            {card.salesCount > 0 ? (
              <span className="badge badge-sales">
                {ar ? `تم بيع ${String(card.salesCount)}` : `Sold ${String(card.salesCount)}`}
              </span>
            ) : null}
          </div>

          <div className="card-footer">
            <p className="card-price">
              {card.variantCount > 1 ? (
                <span className="card-from">{ar ? 'يبدأ من' : 'from'}</span>
              ) : null}
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
                  {ar
                    ? `بقي ${String(card.available ?? 0)}`
                    : `Only ${String(card.available ?? 0)} left`}
                </span>
              ) : (
                <span className="stock stock-in">
                  {card.fulfillmentMode === 'FROM_STOCK'
                    ? ar
                      ? 'متوفر فوراً'
                      : 'In stock'
                    : ar
                      ? 'متاح للطلب'
                      : 'Available to order'}
                </span>
              )
            ) : (
              <span className="stock stock-out">{ar ? 'غير متوفر' : 'Out of stock'}</span>
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
              {ar ? 'اختر الخيار المناسب' : 'Choose an option'}
            </Link>
          )}
        </div>
      ) : null}

      {card.isDraft ? <p className="draft-flag">{ar ? 'مسودّة' : 'Draft'}</p> : null}
    </MotionCard>
  );
}
