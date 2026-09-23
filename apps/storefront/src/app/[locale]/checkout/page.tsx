'use client';

import type { Cart, Checkout, CrossSell, PaymentProvider, PaymentSession } from '@da/contracts';
import { ROUTES } from '@da/contracts';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { CardPayment } from '../../../components/card-payment';
import { CountrySelect } from '../../../components/country-select';
import { useMarketing } from '../../../components/marketing-context';
import { DiscountLicence } from '../../../components/offer-suggestions';
import { PaymentInstructionsPanel } from '../../../components/payment-instructions';
import { ProductTrust } from '../../../components/product-trust';
import { TrustBlock } from '../../../components/trust-block';
import { isArabic } from '../../../i18n/locale';
import { cartApi, CartError } from '../../../lib/cart-client';
import { formatPrice } from '../../../lib/format';

/**
 * Checkout.
 *
 * Two steps, in this order for a reason. The email is taken before payment,
 * because a cart abandoned at the payment step is the most valuable one there
 * is and without an address there is nobody to write to. Only then does the
 * page ask how to pay.
 *
 * The activation email is a separate field, asked only when a line in the cart
 * binds to one. People order from a work address and want the licence on a
 * personal Microsoft account, and a key issued against the wrong address is
 * unusable while the supplier order cannot be reversed — so the server refuses
 * the checkout rather than assuming, and this page asks plainly.
 */
type Stage =
  | { kind: 'details' }
  | { kind: 'pay'; checkout: Checkout }
  | { kind: 'card'; session: CardSession; checkout: Checkout }
  | { kind: 'manual'; session: ManualSession; orderNumber: string };

type CardSession = Extract<PaymentSession, { provider: 'STRIPE' }>;
type ManualSession = Extract<PaymentSession, { provider: 'BANK_TRANSFER' | 'CRYPTO' }>;

/**
 * What each method is called, on the button.
 *
 * The server decides which of these a shopper may start; the wording stays
 * with the rest of the page's Arabic and English, in the `checkout` messages.
 */
const METHOD_LABELS = {
  STRIPE: 'methodSTRIPE',
  PAYPAL: 'methodPAYPAL',
  BANK_TRANSFER: 'methodBANK_TRANSFER',
  CRYPTO: 'methodCRYPTO',
} as const satisfies Record<PaymentProvider, string>;

export default function CheckoutPage() {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'ar';
  const prefix = isArabic(locale) ? '' : `/${locale}`;
  const t = useTranslations('checkout');
  const trust = useMarketing()?.trust ?? null;
  const tCart = useTranslations('cart');
  const tOffers = useTranslations('offers');
  const tc = useTranslations('common');

  const [cart, setCart] = useState<Cart | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'details' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [activationEmail, setActivationEmail] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  const load = useCallback(async () => {
    try {
      setCart(await cartApi.get({ locale }));
    } catch (caught) {
      setError(caught instanceof CartError ? caught.message : tCart('loadFailed'));
    }
  }, [locale, tCart]);

  useEffect(() => {
    void load();
  }, [load]);

  // Asked for only where it is needed. A field with no purpose on a checkout
  // page costs conversions on every order that did not need it.
  const needsActivationEmail = (cart?.lines ?? []).some((line) => line.requiresActivationEmail);

  async function submitDetails(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const checkout = await cartApi.startCheckout(
        {
          email,
          ...(name ? { name } : {}),
          ...(country ? { country } : {}),
          ...(needsActivationEmail ? { activationEmail } : {}),
          marketingOptIn,
        },
        { locale },
      );
      setStage({ kind: 'pay', checkout });
    } catch (caught) {
      setError(caught instanceof CartError ? caught.message : t('startFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function pay(checkout: Checkout, provider: PaymentProvider): Promise<void> {
    const orderNumber = checkout.order.number;
    setBusy(true);
    setError(null);
    try {
      const session = await cartApi.pay(orderNumber, provider, { locale });
      if (session.provider === 'STRIPE') {
        setStage({ kind: 'card', session, checkout });
        return;
      }
      if (session.provider === 'PAYPAL') {
        // PayPal is in the contract and not yet wired, and the API refuses it
        // before this line is reached. Handled anyway so the union stays
        // exhaustive and a future provider cannot fall through to the manual
        // branch and render a set of bank details it does not have.
        setError(t('paypalUnavailable'));
        return;
      }
      setStage({ kind: 'manual', session, orderNumber });
    } catch (caught) {
      setError(caught instanceof CartError ? caught.message : t('startFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function addCrossSell(offer: CrossSell): Promise<void> {
    setBusy(true);
    try {
      await cartApi.addCrossSell(offer.variantId, { locale });
      // The order has to be redrafted: its lines and total just changed.
      const checkout = await cartApi.startCheckout(
        {
          email,
          ...(name ? { name } : {}),
          ...(country ? { country } : {}),
          ...(needsActivationEmail ? { activationEmail } : {}),
          marketingOptIn,
        },
        { locale },
      );
      setCart(checkout.cart);
      setStage({ kind: 'pay', checkout });
    } catch (caught) {
      setError(caught instanceof CartError ? caught.message : t('offerFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (cart && cart.lines.length === 0 && stage.kind === 'details') {
    return (
      <main className="shell">
        <h1>{t('title')}</h1>
        <p className="notice">{tCart('empty')}</p>
        <Link href={`${prefix}${ROUTES.store}`} className="btn btn-primary">
          {tCart('browseStore')}
        </Link>
      </main>
    );
  }

  if (stage.kind === 'manual') {
    return (
      <main className="shell">
        <h1>{t('completePayment')}</h1>
        <p className="notice">
          {t.rich('orderNumber', {
            number: stage.orderNumber,
            strong: (chunks) => <strong dir="ltr">{chunks}</strong>,
          })}
        </p>
        <p className="price">
          <strong>{formatPrice(stage.session.amount)}</strong>
        </p>
        <PaymentInstructionsPanel instructions={stage.session.instructions} />
        <Link
          href={`${prefix}${ROUTES.order(stage.orderNumber)}`}
          className="btn btn-primary"
          onClick={() => router.refresh()}
        >
          {t('viewOrder')}
        </Link>
      </main>
    );
  }

  return (
    <main className="shell checkout-page">
      <h1>{t('title')}</h1>

      {/* Two steps, said out loud. A form that turns into payment buttons with
          no signal between them reads as "did that work?" — the moment a
          shopper reloads and loses the page. */}
      <ol className="checkout-steps" aria-label={t('steps')}>
        <li aria-current={stage.kind === 'details' ? 'step' : undefined}>
          <span>1</span> {t('stepDetails')}
        </li>
        <li aria-current={stage.kind !== 'details' ? 'step' : undefined}>
          <span>2</span> {t('stepPayment')}
        </li>
      </ol>

      <div className="checkout-layout">
        <div className="checkout-main">
          {stage.kind === 'details' ? (
            <form className="checkout-form" onSubmit={(event) => void submitDetails(event)}>
              <h2>{t('stepDetails')}</h2>

              <label>
                {t('email')}
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  dir="ltr"
                />
                <small>{t('emailHint')}</small>
              </label>

              {needsActivationEmail ? (
                <label className="highlight">
                  {t('activationEmail')}
                  <input
                    type="email"
                    value={activationEmail}
                    onChange={(event) => setActivationEmail(event.target.value)}
                    required
                    dir="ltr"
                  />
                  <small>{t('activationEmailHint')}</small>
                </label>
              ) : null}

              <label>
                {t('name')}
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                />
              </label>

              <label>
                {t('country')}
                <CountrySelect locale={locale} value={country} onChange={setCountry} />
              </label>

              <label className="check">
                <input
                  type="checkbox"
                  checked={marketingOptIn}
                  onChange={(event) => setMarketingOptIn(event.target.checked)}
                />
                <span>{t('marketingOptIn')}</span>
              </label>

              {error ? (
                <p className="error" role="alert">
                  {error}
                </p>
              ) : null}

              <button type="submit" className="btn btn-primary btn-wide" disabled={busy}>
                {busy ? '...' : t('continue')}
              </button>
            </form>
          ) : stage.kind === 'card' ? (
            <div className="checkout-form">
              <h2>{t('payByCard')}</h2>
              <p className="notice">
                {t.rich('orderNumber', {
                  number: stage.checkout.order.number,
                  strong: (chunks) => <strong dir="ltr">{chunks}</strong>,
                })}
              </p>
              <p className="price">
                <strong>{formatPrice(stage.session.amount)}</strong>
              </p>
              <CardPayment
                session={stage.session}
                locale={locale}
                // `?paid=card` tells the order page to wait for the webhook
                // rather than announce that no payment has arrived.
                returnPath={`${prefix}/orders/${stage.checkout.order.number}?paid=card`}
                onPaid={() =>
                  router.push(`${prefix}/orders/${stage.checkout.order.number}?paid=card`)
                }
                onBack={() => setStage({ kind: 'pay', checkout: stage.checkout })}
              />
            </div>
          ) : (
            <div className="checkout-form">
              <h2>{t('howToPay')}</h2>
              <p className="notice">
                {t.rich('orderNumber', {
                  number: stage.checkout.order.number,
                  strong: (chunks) => <strong dir="ltr">{chunks}</strong>,
                })}
              </p>

              {stage.checkout.crossSell.length > 0 ? (
                <section className="cross-sell">
                  <h3>{t('crossSellTitle')}</h3>
                  {stage.checkout.crossSell.map((offer) => (
                    <div key={offer.variantId} className="cross-sell-item">
                      <div className="cross-sell-media">
                        {offer.image ? (
                          <Image src={offer.image.url} alt={offer.image.alt} fill sizes="72px" />
                        ) : null}
                      </div>
                      <div>
                        <p className="cross-sell-name">{offer.productName}</p>
                        <p className="cross-sell-price">
                          <strong>{formatPrice(offer.bundlePrice)}</strong>
                          <s>{formatPrice(offer.price)}</s>
                          <span className="badge badge-accent">
                            {t('save', { percent: String(offer.savePercent) })}
                          </span>
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => void addCrossSell(offer)}
                      >
                        {t('addOffer')}
                      </button>
                    </div>
                  ))}
                </section>
              ) : null}

              {error ? (
                <p className="error" role="alert">
                  {error}
                </p>
              ) : null}

              {stage.checkout.paymentMethods.length === 0 ? (
                // Nothing configured, so nothing is offered. A row of buttons
                // where every one leads to a 503 costs the order and the
                // goodwill; an address to write to keeps at least the order.
                <p className="notice">
                  {t.rich('noMethods', {
                    contact: (chunks) => <Link href={`${prefix}${ROUTES.contact}`}>{chunks}</Link>,
                  })}
                </p>
              ) : (
                <div className="pay-methods">
                  {stage.checkout.paymentMethods.map((provider, index) => (
                    <button
                      key={provider}
                      type="button"
                      className={
                        index === 0 ? 'btn btn-primary btn-wide' : 'btn btn-ghost btn-wide'
                      }
                      disabled={busy}
                      onClick={() => void pay(stage.checkout, provider)}
                    >
                      {t(METHOD_LABELS[provider])}
                    </button>
                  ))}
                </div>
              )}

              {/* The store's guarantee and registration, beside the buttons
                  that ask for the money — the one place a buyer weighs them. */}
              {trust?.showOnCheckout ? <TrustBlock trust={trust} locale={locale} compact /> : null}

              {/* The policies, where the decision is made. The refund policy was
                  published and linked from almost nowhere; the moment before
                  paying for a key that cannot be returned is where it belongs. */}
              <p className="meta checkout-terms">
                {t.rich('terms', {
                  terms: (chunks) => <Link href={`${prefix}/terms`}>{chunks}</Link>,
                  refunds: (chunks) => <Link href={`${prefix}/refunds`}>{chunks}</Link>,
                })}
              </p>

              <button type="button" className="linky" onClick={() => setStage({ kind: 'details' })}>
                {t('editDetails')}
              </button>
            </div>
          )}
        </div>

        <aside className="cart-summary">
          <h2>{tCart('summary')}</h2>
          {cart ? (
            <>
              <ul className="summary-lines">
                {cart.lines.map((line) => (
                  <li key={line.id}>
                    <span>
                      {line.productName} × {line.qty}
                    </span>
                    <span>{formatPrice(line.lineTotal)}</span>
                  </li>
                ))}
              </ul>
              <dl className="totals">
                <div>
                  <dt>{tc('subtotal')}</dt>
                  <dd>{formatPrice(cart.subtotal)}</dd>
                </div>
                {/* The one discount the total carries: the coupon, or the
                    volume / pair discount that beat it. */}
                {cart.automaticDiscount ? (
                  <div className="totals-discount">
                    <dt>
                      {cart.automaticDiscount.kind === 'volume'
                        ? tOffers('volumeApplied', { percent: cart.automaticDiscount.percent })
                        : tOffers('pairApplied')}
                      <DiscountLicence number={cart.automaticDiscount.licenceNumber} />
                    </dt>
                    <dd>−{formatPrice(cart.discount)}</dd>
                  </div>
                ) : cart.coupon ? (
                  <div className="totals-discount">
                    <dt>{cart.coupon.name}</dt>
                    <dd>−{formatPrice(cart.discount)}</dd>
                  </div>
                ) : null}
                <div className="totals-total">
                  <dt>{tc('total')}</dt>
                  <dd>{formatPrice(cart.total)}</dd>
                </div>
              </dl>
              <Link href={`${prefix}${ROUTES.cart}`} className="linky">
                {t('editCart')}
              </Link>

              <div style={{ marginBlockStart: '16px' }}>
                <ProductTrust showPerks={false} />
              </div>
            </>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
