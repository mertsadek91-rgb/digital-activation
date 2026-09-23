'use client';

import type { Cart, CartLine, OfferSuggestions } from '@da/contracts';
import { MAX_LINE_QTY, ROUTES } from '@da/contracts';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { DiscountLicence, SuggestionList } from '../../../components/offer-suggestions';
import { ProductTrust } from '../../../components/product-trust';
import { isArabic } from '../../../i18n/locale';
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
 * pay button is how a sale is lost. The exception is a seasonal sale price,
 * which was advertised with an end date: when the sale ends the line goes back
 * to the current price and says so (`saleEnded`).
 *
 * One discount per cart — the coupon, the volume tier or the pair discount,
 * whichever is largest — and when a typed code is not the one applied, the
 * summary says why instead of listing it as though it were.
 */
export default function CartPage() {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'ar';
  const prefix = isArabic(locale) ? '' : `/${locale}`;
  const t = useTranslations('cart');
  const tc = useTranslations('common');
  const to = useTranslations('offers');

  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const load = useCallback(async () => {
    try {
      setCart(await cartApi.get({ locale }));
    } catch (caught) {
      setError(caught instanceof CartError ? caught.message : t('loadFailed'));
    }
  }, [locale, t]);

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
      setError(caught instanceof CartError ? caught.message : t('updateFailed'));
    } finally {
      setBusy(null);
    }
  }

  if (!cart) {
    return (
      <main className="shell">
        <h1>{t('title')}</h1>
        <p className="notice" role={error ? 'alert' : undefined}>
          {error ?? '…'}
        </p>
      </main>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <main className="shell">
        <h1>{t('title')}</h1>
        <p className="notice">{t('empty')}</p>
        <Link href={`${prefix}${ROUTES.store}`} className="btn btn-primary">
          {t('browseStore')}
        </Link>
      </main>
    );
  }

  return (
    <main className="shell cart-page">
      <h1>{t('title')}</h1>

      {/* Stated, not silently applied. A cart that trims a line without saying
          so sends the shopper to checkout expecting something else. */}
      {cart.adjustments.map((entry) => (
        <p key={entry.sku} className="notice notice-warn">
          {t('adjusted', {
            sku: entry.sku,
            requested: String(entry.requestedQty),
            granted: String(entry.grantedQty),
          })}
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
          <h2>{t('summary')}</h2>

          <VolumeProgress cart={cart} />

          <dl className="totals">
            <div>
              <dt>{tc('subtotal')}</dt>
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
                    {t('removeCoupon')}
                  </button>
                  {/* One discount per cart: said plainly when the code is not
                      the one being applied, rather than showing it and
                      quietly not taking it off. */}
                  {cart.couponSuperseded && cart.automaticDiscount ? (
                    <span className="offer-superseded">
                      {cart.automaticDiscount.kind === 'volume'
                        ? to('couponSupersededVolume')
                        : to('couponSupersededPair')}
                    </span>
                  ) : null}
                </dt>
                {cart.couponSuperseded ? null : <dd>−{formatPrice(cart.discount)}</dd>}
              </div>
            ) : null}
            {cart.automaticDiscount ? (
              <div className="totals-discount">
                <dt>
                  {cart.automaticDiscount.kind === 'volume'
                    ? to('volumeApplied', { percent: cart.automaticDiscount.percent })
                    : to('pairApplied')}
                  <DiscountLicence number={cart.automaticDiscount.licenceNumber} />
                </dt>
                <dd>−{formatPrice(cart.discount)}</dd>
              </div>
            ) : null}
            <div className="totals-total">
              <dt>{tc('total')}</dt>
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
                {t('couponLabel')}
                <input
                  type="text"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  dir="ltr"
                  autoComplete="off"
                />
              </label>
              <button type="submit" className="btn btn-ghost" disabled={busy === 'coupon' || !code}>
                {t('applyCoupon')}
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
          {cart.reservationExpiresAt ? <p className="hold-note">{t('holdNote')}</p> : null}

          <Link href={`${prefix}${ROUTES.checkout}`} className="btn btn-primary btn-wide">
            {t('checkout')}
          </Link>

          <div style={{ marginBlockStart: '16px' }}>
            <ProductTrust showPerks={false} />
          </div>
        </aside>
      </div>

      <CartSuggestions
        slugs={cart.lines.map((line) => line.productSlug)}
        locale={locale}
        currency={cart.currency}
        onAdded={(next) => {
          setCart(next);
          router.refresh();
        }}
      />
    </main>
  );
}

/**
 * "Add 1 more licence to save 10%". Only from the real tiers, and only when
 * the panel asks for the bar; the numbers are the API's, not recomputed here.
 */
function VolumeProgress({ cart }: { cart: Cart }) {
  const to = useTranslations('offers');
  const volume = cart.volume;
  if (!volume?.showProgressBar) return null;
  if (volume.next) {
    return (
      <div className="volume-progress">
        <p>{to('progressNext', { count: volume.next.itemsToGo, percent: volume.next.percent })}</p>
        <progress
          value={cart.itemCount}
          max={volume.next.minItems}
          aria-label={to('progressLabel')}
        />
        <DiscountLicence number={volume.licenceNumber} />
      </div>
    );
  }
  if (volume.applied) {
    return (
      <div className="volume-progress is-top">
        <p>{to('progressTop', { percent: volume.applied.percent })}</p>
      </div>
    );
  }
  return null;
}

/** The "goes well with" strip under the cart, when the panel shows it there. */
function CartSuggestions({
  slugs,
  locale,
  currency,
  onAdded,
}: {
  slugs: string[];
  locale: string;
  currency: string;
  onAdded: (cart: Cart) => void;
}) {
  const to = useTranslations('offers');
  const [data, setData] = useState<OfferSuggestions | null>(null);
  const key = slugs.join(',');

  useEffect(() => {
    if (!key) return;
    let live = true;
    cartApi
      .suggestions(key.split(','), 'cart', { locale, currency })
      .then((result) => {
        if (live) setData(result);
      })
      // A strip that cannot load is a strip that is not there.
      .catch(() => {
        if (live) setData(null);
      });
    return () => {
      live = false;
    };
  }, [key, locale, currency]);

  if (!data || data.items.length === 0) return null;
  return (
    <section className="offer-strip" aria-labelledby="cart-suggestions">
      <h2 id="cart-suggestions">{to('cartTitle')}</h2>
      <SuggestionList
        items={data.items}
        locale={locale}
        licenceNumber={data.licenceNumber}
        onAdded={onAdded}
      />
    </section>
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
  const t = useTranslations('cart');
  const tc = useTranslations('common');
  const tf = useTranslations('format');
  const to = useTranslations('offers');
  const prefix = isArabic(locale) ? '' : `/${locale}`;
  // The room left above what this line already has, plus what it has.
  const maxQty = Math.min(MAX_LINE_QTY, line.qty + line.availableToAdd);

  return (
    <li className="cart-line">
      <div className="cart-line-media">
        {line.image ? (
          <Image src={line.image.url} alt={line.image.alt} fill sizes="96px" />
        ) : (
          <span className="card-media-empty">{tc('noImage')}</span>
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
          <p className="cart-line-note">{t('activationEmailNote')}</p>
        ) : null}

        {/* The snapshot is what gets charged; the change is disclosed.
            Through the formatter rather than a "$" typed around the number,
            which read "12.00$" in Arabic. The API reports the new price in
            USD only (`nowUsd`), so it is shown in dollars rather than labelled
            with the line's display currency it was never converted to. */}
        {line.sale ? (
          <div className="cart-line-sale">
            <span className="badge badge-accent">
              {line.sale.name
                ? to('saleBadge', { name: line.sale.name, percent: line.sale.percent })
                : to('saleBadgeNoName', { percent: line.sale.percent })}
            </span>
            <DiscountLicence number={line.sale.licenceNumber} />
          </div>
        ) : null}
        {line.saleEnded ? <p className="cart-line-note">{to('saleEnded')}</p> : null}

        {line.priceChanged ? (
          <p className="cart-line-note">
            {t.rich('priceChanged', {
              price: formatPrice({ amount: line.priceChanged.nowUsd, currency: 'USD' }),
              bdi: (chunks) => <bdi dir="ltr">{chunks}</bdi>,
            })}
          </p>
        ) : null}
      </div>

      <div className="cart-line-qty">
        <label>
          <span className="visually-hidden">{t('quantity')}</span>
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
          {t('removeLine')}
        </button>
      </div>

      <p className="cart-line-total">{formatPrice(line.lineTotal)}</p>
    </li>
  );
}
