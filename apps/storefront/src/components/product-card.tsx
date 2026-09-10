import type { CatalogCard } from '@da/contracts';
import { LOW_STOCK_THRESHOLD } from '@da/contracts';
import Image from 'next/image';
import Link from 'next/link';

import { formatPrice } from '../lib/format';

/**
 * Grid card.
 *
 * Every claim on it is read from real data. There is no decorative countdown
 * and no invented rating: "only N left" appears because N is the sellable
 * stock, and "sold N times" appears because N orders exist. The legacy store
 * showed 4.6 stars from synthetic reviews on 81 products, which is the habit
 * this card is built to avoid.
 */
export function ProductCard({ card, locale }: { card: CatalogCard; locale: string }) {
  const ar = locale === 'ar';
  const href = locale === 'ar' ? `/store/${card.slug}` : `/${locale}/store/${card.slug}`;
  const lowStock = card.inStock && card.available > 0 && card.available <= LOW_STOCK_THRESHOLD;

  return (
    <article className="card">
      <Link href={href} className="card-link">
        <div className="card-media" aria-hidden={card.image ? undefined : true}>
          {card.image ? (
            <Image
              src={card.image.url}
              alt={card.image.alt}
              fill
              sizes="(max-width: 700px) 50vw, 220px"
            />
          ) : (
            <span className="card-media-empty">{ar ? 'لا صورة' : 'No image'}</span>
          )}
        </div>

        <div className="card-body">
          {card.brand ? <p className="card-brand">{card.brand}</p> : null}
          <h3 className="card-title">{card.name}</h3>
          {card.shortDesc ? <p className="card-desc">{card.shortDesc}</p> : null}

          <div className="card-badges">
            {card.hasGoldenWarranty ? (
              <span className="badge badge-warranty">
                {ar ? 'الضمان الذهبي' : 'Golden Warranty'}
              </span>
            ) : null}
            {card.variantCount > 1 ? (
              <span className="badge">
                {ar
                  ? `${String(card.variantCount)} خيارات`
                  : `${String(card.variantCount)} options`}
              </span>
            ) : null}
            {card.salesCount > 0 ? (
              <span className="badge">
                {ar
                  ? `تم بيعه ${String(card.salesCount)} مرة`
                  : `Sold ${String(card.salesCount)} times`}
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
                  {ar ? `بقي ${String(card.available)}` : `Only ${String(card.available)} left`}
                </span>
              ) : (
                <span className="stock stock-in">{ar ? 'متوفر' : 'In stock'}</span>
              )
            ) : (
              <span className="stock stock-out">{ar ? 'غير متوفر' : 'Out of stock'}</span>
            )}
          </div>
        </div>
      </Link>

      {card.isDraft ? <p className="draft-flag">{ar ? 'مسودّة' : 'Draft'}</p> : null}
    </article>
  );
}
