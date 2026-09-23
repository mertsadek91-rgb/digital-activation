'use client';

import type { Cart, CartLine } from '@da/contracts';
import { MAX_LINE_QTY, ROUTES } from '@da/contracts';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { ProductTrust } from '../../../components/product-trust';
import { cartApi, CartError } from '../../../lib/cart-client';
import { formatDelivery, formatFulfillment, formatPrice, variantLabel } from '../../../lib/format';

/**
 * The cart.
 *
 * A client page, because the cart is identified by an httpOnly cookie the API
 * holds and is different for every visitor — there is nothing here to cache or
 * to index, and the layout marks it noindex for that reason.
 *
 * Two things it refuses to do quietly. When stock granted less than was asked
 * for, it says so with the numbers rather than showing a trimmed line; and
 * when a price has moved since the line was added, it keeps charging the old
 * one and shows the difference, because a total that changes on the way to the
 * pay button is how a sale is lost.
 */
export default function CartPage() {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'ar';
  const ar = locale === 'ar';
  const prefix = ar ? '' : `/${locale}`;

  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const load = useCallback(async () => {
    try {
      setCart(await cartApi.get({ locale }));
    } catch (caught) {
      setError(
        caught instanceof CartError
          ? caught.message
          : ar
            ? 'تعذّر تحميل السلة.'
            : 'Could not load your cart.',
      );
    }
  }, [locale, ar]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(key: string, run: () => Promise<Cart>): Promise<void> {
    setBusy(key);
    setError(null);
    try {
      setCart(await run());
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof CartError
          ? caught.message
          : ar
            ? 'تعذّر تحديث السلة.'
            : 'Could not update your cart.',
      );
    } finally {
      setBusy(null);
    }
  }

  if (!cart) {
    return (
      <main className="shell">
        <h1>{ar ? 'سلة الشراء' : 'Your cart'}</h1>
        <p className="notice" role={error ? 'alert' : undefined}>
          {error ?? '…'}
        </p>
      </main>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <main className="shell">
        <h1>{ar ? 'سلة الشراء' : 'Your cart'}</h1>
        <p className="notice">{ar ? 'سلتك فارغة.' : 'Your cart is empty.'}</p>
        <Link href={`${prefix}${ROUTES.store}`} className="btn btn-primary">
          {ar ? 'تصفّح المتجر' : 'Browse the store'}
        </Link>
      </main>
    );
  }

  return (
    <main className="shell cart-page">
      <h1>{ar ? 'سلة الشراء' : 'Your cart'}</h1>

      {/* Stated, not silently applied. A cart that trims a line without saying
          so sends the shopper to checkout expecting something else. */}
      {cart.adjustments.map((entry) => (
        <p key={entry.sku} className="notice notice-warn">
          {ar
            ? `${entry.sku}: طلبت ${String(entry.requestedQty)} والمتاح ${String(entry.grantedQty)}.`
            : `${entry.sku}: you asked for ${String(entry.requestedQty)}, ${String(entry.grantedQty)} available.`}
        </p>
      ))}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="cart-layout">
        <ul className="cart-lines">
          {cart.lines.map((line) => (
            <Line
              key={line.id}
              line={line}
              locale={locale}
              busy={busy === line.variantId}
              onQty={(qty) =>
                void act(line.variantId, () => cartApi.setQty(line.variantId, qty, { locale }))
              }
            />
          ))}
        </ul>

        <aside className="cart-summary">
          <h2>{ar ? 'الملخّص' : 'Summary'}</h2>

          <dl className="totals">
            <div>
              <dt>{ar ? 'المجموع' : 'Subtotal'}</dt>
              <dd>{formatPrice(cart.subtotal)}</dd>
            </div>
            {cart.coupon ? (
              <div className="totals-discount">
                <dt>
                  {cart.coupon.name}
                  <button
                    type="button"
                    className="linky"
                    onClick={() => void act('coupon', () => cartApi.removeCoupon({ locale }))}
                  >
                    {ar ? 'إزالة' : 'remove'}
                  </button>
                </dt>
                <dd>−{formatPrice(cart.discount)}</dd>
              </div>
            ) : null}
            <div className="totals-total">
              <dt>{ar ? 'الإجمالي' : 'Total'}</dt>
              <dd>{formatPrice(cart.total)}</dd>
            </div>
          </dl>

          {!cart.coupon ? (
            <form
              className="coupon"
              onSubmit={(event) => {
                event.preventDefault();
                void act('coupon', () => cartApi.applyCoupon(code, { locale }));
              }}
            >
              <label>
                {ar ? 'كود خصم' : 'Discount code'}
                <input
                  type="text"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  dir="ltr"
                  autoComplete="off"
                />
              </label>
              <button type="submit" className="btn btn-ghost" disabled={busy === 'coupon' || !code}>
                {ar ? 'تطبيق' : 'Apply'}
              </button>
            </form>
          ) : null}

          {cart.couponError ? (
            <p className="error" role="alert">
              {cart.couponError}
            </p>
          ) : null}

          {/* Shown only when something is actually being held. Most of this
              catalog is made to order and holds nothing, so a countdown there
              would be invented urgency. */}
          {cart.reservationExpiresAt ? (
            <p className="hold-note">
              {ar
                ? 'المنتجات المتوفّرة في المخزون محجوزة لك مؤقتاً.'
                : 'The in-stock items are held for you for a short while.'}
            </p>
          ) : null}

          <Link href={`${prefix}${ROUTES.checkout}`} className="btn btn-primary btn-wide">
            {ar ? 'إتمام الشراء' : 'Checkout'}
          </Link>

          <div style={{ marginBlockStart: '16px' }}>
            <ProductTrust showPerks={false} />
          </div>
        </aside>
      </div>
    </main>
  );
}

function Line({
  line,
  locale,
  busy,
  onQty,
}: {
  line: CartLine;
  locale: string;
  busy: boolean;
  onQty: (qty: number) => void;
}) {
  const tf = useTranslations('format');
  const ar = locale === 'ar';
  const prefix = ar ? '' : `/${locale}`;
  // The room left above what this line already has, plus what it has.
  const maxQty = Math.min(MAX_LINE_QTY, line.qty + line.availableToAdd);

  return (
    <li className="cart-line">
      <div className="cart-line-media">
        {line.image ? (
          <Image src={line.image.url} alt={line.image.alt} fill sizes="96px" />
        ) : (
          <span className="card-media-empty">{ar ? 'لا صورة' : 'No image'}</span>
        )}
      </div>

      <div className="cart-line-body">
        <Link href={`${prefix}${ROUTES.product(line.productSlug)}`} className="cart-line-name">
          {line.productName}
        </Link>
        <p className="cart-line-spec">{variantLabel(line, tf)}</p>
        <p className="cart-line-spec">
          {formatDelivery(line.deliverySlaSeconds, tf, line.fulfillmentMode)} ·{' '}
          {formatFulfillment(line.fulfillmentMode, tf)}
        </p>
        {line.requiresActivationEmail ? (
          <p className="cart-line-note">
            {ar
              ? 'سنطلب بريد التفعيل عند الدفع'
              : 'We will ask for the activation email at checkout'}
          </p>
        ) : null}

        {/* The snapshot is what gets charged; the change is disclosed.
            Through the formatter rather than a "$" typed around the number,
            which read "12.00$" in Arabic. The API reports the new price in
            USD only (`nowUsd`), so it is shown in dollars rather than labelled
            with the line's display currency it was never converted to. */}
        {line.priceChanged ? (
          <p className="cart-line-note">
            {ar ? 'السعر الحالي ' : 'The current price is '}
            <bdi dir="ltr">
              {formatPrice({ amount: line.priceChanged.nowUsd, currency: 'USD' })}
            </bdi>
            {ar ? ' — سعرك محفوظ كما أضفته.' : ' — you keep the price you added at.'}
          </p>
        ) : null}
      </div>

      <div className="cart-line-qty">
        <label>
          <span className="visually-hidden">{ar ? 'الكمية' : 'Quantity'}</span>
          <select
            value={line.qty}
            disabled={busy}
            onChange={(event) => onQty(Number(event.target.value))}
          >
            {Array.from({ length: Math.max(1, maxQty) }, (_, index) => index + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="linky" disabled={busy} onClick={() => onQty(0)}>
          {ar ? 'إزالة' : 'Remove'}
        </button>
      </div>

      <p className="cart-line-total">{formatPrice(line.lineTotal)}</p>
    </li>
  );
}
