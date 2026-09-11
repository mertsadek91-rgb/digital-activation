'use client';

import type { CatalogProduct, CatalogVariant } from '@da/contracts';
import { LOW_STOCK_THRESHOLD, MAX_LINE_QTY, ROUTES } from '@da/contracts';
import { useState } from 'react';

import { cartApi, CartError } from '../lib/cart-client';
import {
  formatActivation,
  formatDelivery,
  formatDevices,
  formatFulfillment,
  formatLicensePeriod,
  formatPrice,
  variantLabel,
} from '../lib/format';

/**
 * Everything on a product page that changes when the shopper chooses.
 *
 * Split out as a client component so the licence picker actually works: the
 * price, the specification table and the delivery promise all belong to the
 * selected variant, and a page where picking "3 years" leaves the 1-year price
 * on screen is worse than one with no picker at all.
 *
 * It still renders on the server for the first paint, so the crawler sees the
 * default variant's price and specs in the HTML — which is what the structured
 * data on the page claims, and the two must agree.
 */
export function BuyBox({ product, locale }: { product: CatalogProduct; locale: string }) {
  const ar = locale === 'ar';

  const [selectedId, setSelectedId] = useState(product.selectedVariantId);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const selected: CatalogVariant =
    product.variants.find((variant) => variant.id === selectedId) ?? product.variants[0]!;

  const stocked = selected.fulfillmentMode === 'FROM_STOCK';
  const lowStock =
    selected.inStock && selected.available !== null && selected.available <= LOW_STOCK_THRESHOLD;
  // A stocked line cannot be sold beyond what is on the shelf; a made-to-order
  // one is capped only by the per-line limit that exists to catch fraud.
  const maxQty = stocked ? Math.min(MAX_LINE_QTY, selected.available ?? 0) : MAX_LINE_QTY;

  async function add(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // The client announces the new cart, which is how the header badge
      // hears about it — this component cannot reach it any other way.
      await cartApi.add(selected.id, qty, { locale, currency: selected.price.currency });
      setAdded(true);
    } catch (caught) {
      setError(caught instanceof CartError ? caught.message : 'تعذّر الإضافة إلى السلة.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="buy">
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
                  checked={variant.id === selected.id}
                  disabled={!variant.inStock}
                  onChange={() => {
                    setSelectedId(variant.id);
                    setQty(1);
                    setAdded(false);
                  }}
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
          <dd>{formatDelivery(selected.deliverySlaSeconds, locale, selected.fulfillmentMode)}</dd>
        </div>
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
                : 'The email the licence should be activated on — asked at checkout'}
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

      {lowStock ? (
        <p className="stock stock-low">
          {ar
            ? `بقي ${String(selected.available ?? 0)} فقط`
            : `Only ${String(selected.available ?? 0)} left`}
        </p>
      ) : null}

      {selected.inStock ? (
        <div className="buy-actions">
          <label className="qty">
            <span>{ar ? 'الكمية' : 'Quantity'}</span>
            <select
              value={qty}
              onChange={(event) => {
                setQty(Number(event.target.value));
                setAdded(false);
              }}
            >
              {Array.from({ length: Math.max(1, maxQty) }, (_, index) => index + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="btn btn-primary btn-buy"
            onClick={() => void add()}
            disabled={busy}
          >
            {busy ? '...' : ar ? 'أضف إلى السلة' : 'Add to cart'}
          </button>
        </div>
      ) : (
        <p className="stock stock-out">{ar ? 'غير متوفر حالياً' : 'Not available right now'}</p>
      )}

      {error ? <p className="error">{error}</p> : null}

      {added ? (
        <p className="added">
          {ar ? 'أُضيف إلى السلة.' : 'Added to your cart.'}{' '}
          <a href={ar ? ROUTES.cart : `/${locale}${ROUTES.cart}`}>
            {ar ? 'إتمام الشراء' : 'Go to checkout'}
          </a>
        </p>
      ) : null}
    </div>
  );
}
