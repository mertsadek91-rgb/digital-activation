'use client';

import type { CatalogProduct, CatalogVariant } from '@da/contracts';
import { LOW_STOCK_THRESHOLD, MAX_LINE_QTY, ROUTES } from '@da/contracts';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

import { cartApi, CartError } from '../lib/cart-client';
import {
  formatActivation,
  formatDelivery,
  formatDevices,
  formatFulfillment,
  formatLicensePeriod,
  formatPlatform,
  formatPrice,
  variantLabel,
} from '../lib/format';

import { MinusIcon, PlusIcon, SpecMark, type SpecKind } from './icons';

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
 *
 * Shaped after the store this replaces, because that page is doing something
 * right: the specification grid, the stepper with a running total and the bar
 * that follows you down the page are all things a licence buyer uses. What is
 * not carried over is the part of that page which is not true — the certifier
 * badges it never earned and the "16 visitors are viewing this now" a plugin
 * makes up on every load.
 */
export function BuyBox({ product, locale }: { product: CatalogProduct; locale: string }) {
  const ar = locale === 'ar';

  const [selectedId, setSelectedId] = useState(product.selectedVariantId);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  /**
   * Whether the real buy row has gone up past the top of the screen, which is
   * the only thing the following bar needs to know.
   *
   * A scroll listener rather than an `IntersectionObserver`, which is the wrong
   * instrument here and quietly so. An observer reports one boolean, and above
   * the viewport and below it produce the same one — so moving between those
   * two states crosses no threshold and fires no callback. Measured on this
   * page: the row starts below the fold, and a flick that carries it past the
   * top in a single frame never reports anything at all, leaving the bar hidden
   * for the rest of the page.
   *
   * The cost this avoids is real but small, and it is paid for: the listener is
   * passive, and it never measures more than once a frame because the work is
   * deferred to a `requestAnimationFrame` that will not be queued twice.
   * Setting the same value again is a React no-op, so a screen's worth of
   * scrolling re-renders nothing.
   */
  const actionsRef = useRef<HTMLDivElement>(null);
  const [passed, setPassed] = useState(false);

  useEffect(() => {
    const node = actionsRef.current;
    if (!node) return;

    let frame = 0;
    const measure = (): void => {
      frame = 0;
      setPassed(node.getBoundingClientRect().bottom < 0);
    };
    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const selected: CatalogVariant =
    product.variants.find((variant) => variant.id === selectedId) ?? product.variants[0]!;

  const stocked = selected.fulfillmentMode === 'FROM_STOCK';
  const lowStock =
    selected.inStock && selected.available !== null && selected.available <= LOW_STOCK_THRESHOLD;
  // A stocked line cannot be sold beyond what is on the shelf; a made-to-order
  // one is capped only by the per-line limit that exists to catch fraud.
  const maxQty = stocked ? Math.min(MAX_LINE_QTY, selected.available ?? 0) : MAX_LINE_QTY;

  // Multiplied here rather than trusted from anywhere: it is the one number on
  // the page a shopper checks against their own arithmetic.
  const total = formatPrice({
    amount: (Number(selected.price.amount) * qty).toFixed(2),
    currency: selected.price.currency,
  });

  async function add(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // The client announces the new cart, which is how the header badge
      // hears about it — this component cannot reach it any other way.
      await cartApi.add(selected.id, qty, { locale, currency: selected.price.currency });
      setAdded(true);
    } catch (caught) {
      setError(
        caught instanceof CartError
          ? caught.message
          : ar
            ? 'تعذّر الإضافة إلى السلة.'
            : 'Could not add this to your cart.',
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * The specification rows, built from the variant rather than written per
   * product.
   *
   * The old store typed this table into each product's description by hand,
   * which is why one product says "مدى الحياة" and the next says "دائم" for the
   * same licence term. Here it is the same fields the cart, the licence email
   * and the structured data read, so the page cannot describe a variant the
   * shop would not actually deliver.
   */
  const specs: { kind: SpecKind; label: string; value: string }[] = [
    {
      kind: 'term',
      label: ar ? 'مدّة الترخيص' : 'Licence term',
      value: formatLicensePeriod(selected, locale),
    },
    {
      kind: 'devices',
      label: ar ? 'عدد الأجهزة' : 'Devices',
      value: formatDevices(selected.deviceCount, locale),
    },
    {
      kind: 'activation',
      label: ar ? 'نوع التفعيل' : 'Activation',
      value: formatActivation(selected.activationMethod, locale),
    },
    {
      kind: 'delivery',
      label: ar ? 'التسليم' : 'Delivery',
      value: formatDelivery(selected.deliverySlaSeconds, locale, selected.fulfillmentMode),
    },
    {
      kind: 'supply',
      label: ar ? 'طريقة التوريد' : 'How it is supplied',
      value: formatFulfillment(selected.fulfillmentMode, locale, selected.inStock),
    },
    {
      kind: 'platform',
      label: ar ? 'المنصّة' : 'Platform',
      value: formatPlatform(selected.platform, locale),
    },
  ];

  if (selected.requiresActivationEmail) {
    specs.push({
      kind: 'email',
      label: ar ? 'مطلوب منك' : 'We will need',
      value: ar
        ? 'بريدك الذي يُفعَّل عليه الترخيص — نطلبه عند الدفع'
        : 'The email to activate on — asked at checkout',
    });
  }
  if (product.hasGoldenWarranty) {
    specs.push({
      kind: 'warranty',
      label: ar ? 'الضمان' : 'Warranty',
      value: ar ? 'الضمان الذهبي' : 'Golden Warranty',
    });
  }

  const stepper = (
    <div className="stepper" role="group" aria-label={ar ? 'الكمية' : 'Quantity'}>
      <button
        type="button"
        onClick={() => {
          setQty(Math.max(1, qty - 1));
          setAdded(false);
        }}
        disabled={qty <= 1}
        aria-label={ar ? 'إنقاص الكمية' : 'Decrease quantity'}
      >
        <MinusIcon />
      </button>
      {/* The number is read, not edited: a text field here invites "0" and
          "-3", and every one of those is a validation message for a control
          with two buttons that cannot produce a wrong value. */}
      <output>{qty}</output>
      <button
        type="button"
        onClick={() => {
          setQty(Math.min(Math.max(1, maxQty), qty + 1));
          setAdded(false);
        }}
        disabled={qty >= Math.max(1, maxQty)}
        aria-label={ar ? 'زيادة الكمية' : 'Increase quantity'}
      >
        <PlusIcon />
      </button>
    </div>
  );

  return (
    <div className="buy">
      <div className="price-row">
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

        {/* Next to the price, where the old page puts it, because it is part
            of what the money buys rather than a line in a table. */}
        {product.hasGoldenWarranty ? (
          <a
            className="warranty-pill"
            href={ar ? ROUTES.goldenWarranty : `/${locale}${ROUTES.goldenWarranty}`}
          >
            <SpecMark kind="warranty" />
            <span>{ar ? 'برنامج الضمان الذهبي' : 'Golden Warranty'}</span>
          </a>
        ) : null}
      </div>

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
        {specs.map((spec) => (
          <div key={spec.kind}>
            <span className="spec-mark" aria-hidden="true">
              <SpecMark kind={spec.kind} />
            </span>
            <dt>{spec.label}</dt>
            <dd>{spec.value}</dd>
          </div>
        ))}
      </dl>

      {lowStock ? (
        <p className="stock stock-low">
          {ar
            ? `بقي ${String(selected.available ?? 0)} فقط`
            : `Only ${String(selected.available ?? 0)} left`}
        </p>
      ) : null}

      {/* The observed element is this wrapper rather than the button, so the
          bar behaves the same on a sold-out product — where there is no button
          to observe and the bar never appears anyway. */}
      <div ref={actionsRef}>
        {selected.inStock ? (
          <div className="buy-actions">
            {stepper}
            <button
              type="button"
              className="btn btn-accent btn-buy"
              onClick={() => void add()}
              disabled={busy}
            >
              {busy ? '…' : ar ? 'إضافة إلى السلة' : 'Add to cart'}
            </button>
            <p className="buy-total">
              <span>{ar ? 'الإجمالي' : 'Total'}</span>
              <strong>{total}</strong>
            </p>
          </div>
        ) : (
          <p className="stock stock-out">{ar ? 'غير متوفر حالياً' : 'Not available right now'}</p>
        )}
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {/* A live region that is always in the document, so the confirmation
          is announced when it appears — a region inserted together with its
          text is often not read at all. The link says where it goes: it
          opens the cart, and it was labelled "Go to checkout". */}
      <div role="status">
        <AnimatePresence>
          {added && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -6 }}
              transition={{ type: 'spring', damping: 22, stiffness: 320 }}
              className="added"
            >
              <span>{ar ? '✓ أُضيف إلى السلة بنجاح.' : '✓ Added to your cart.'}</span>{' '}
              <a href={ar ? ROUTES.cart : `/${locale}${ROUTES.cart}`}>
                {ar ? 'عرض السلة ←' : 'View cart →'}
              </a>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* The same controls, following the page down with Framer Motion slide-up */}
      <AnimatePresence>
        {selected.inStock && passed && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 280 }}
            className="buy-bar is-shown motion-controlled"
          >
            <div className="buy-bar-inner">
              <span className="buy-bar-name">{product.name}</span>
              <span className="buy-bar-price">{total}</span>
              {stepper}
              <button
                type="button"
                className="btn btn-accent btn-buy"
                onClick={() => void add()}
                disabled={busy}
              >
                {busy ? '…' : ar ? 'إضافة إلى السلة' : 'Add to cart'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
