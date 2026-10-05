'use client';

import type {
  Cart,
  Checkout,
  CheckoutFpMethod,
  CrossSell,
  PaymentProvider,
  PaymentSession,
  StartPayment,
} from '@da/contracts';
import { ROUTES, normalizeWhatsappPhone } from '@da/contracts';
import Image from 'next/image';
import { Link } from '../../../components/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
 * What each method is called, beside its radio.
 *
 * The server decides which of these a shopper may start; the wording stays
 * with the rest of the page's Arabic and English, in the `checkout` messages.
 * Final Processor has no label of its own here: each of its methods carries
 * the name the admin gave it.
 */
const METHOD_LABELS = {
  STRIPE: 'methodSTRIPE',
  PAYPAL: 'methodPAYPAL',
  BANK_TRANSFER: 'methodBANK_TRANSFER',
  CRYPTO: 'methodCRYPTO',
} as const satisfies Record<Exclude<PaymentProvider, 'FINAL_PROCESSOR'>, string>;

/**
 * One radio on the payment step. A Final Processor method is a choice of its
 * own, beside the other providers, because to the shopper "Card" and "Bank
 * transfer" are the same kind of thing.
 */
type PayChoice =
  | { key: string; provider: Exclude<PaymentProvider, 'FINAL_PROCESSOR'> }
  | { key: string; provider: 'FINAL_PROCESSOR'; method: CheckoutFpMethod };

/** In the server's order, with Final Processor expanded into its methods (in the admin's order). */
function payChoices(checkout: Checkout): PayChoice[] {
  return checkout.paymentMethods.flatMap((provider): PayChoice[] =>
    provider === 'FINAL_PROCESSOR'
      ? checkout.finalProcessorMethods.map((method) => ({
          key: `FINAL_PROCESSOR:${method.id}`,
          provider,
          method,
        }))
      : [{ key: provider, provider }],
  );
}

/**
 * An icon is drawn only from an https URL or a path on this site: what the
 * CSP's `img-src` allows, and what the admin screen accepts.
 */
function drawableIcon(url: string | null): string | null {
  if (!url) return null;
  return /^https:\/\/\S+$/.test(url) || /^\/[^\s/]\S*$/.test(url) ? url : null;
}

/** "$25.50" — the USD charge, written the same way in both languages. */
function usd(amount: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    Number(amount),
  );
}

/**
 * Why the processor sent the shopper back (`fp_result` on the cancel URL).
 * Display only: it chooses a sentence, never an order state.
 */
type ReturnNotice = 'fpCancelled' | 'fpExpired' | 'fpFailed';

function returnNoticeFor(result: string | null): ReturnNotice | null {
  if (result === null) return null;
  if (result === 'cancelled') return 'fpCancelled';
  if (result === 'expired') return 'fpExpired';
  return 'fpFailed';
}

/**
 * Makes the document's referrer policy `same-origin` from now on (A.2.9), so
 * the navigation to the payment gateway carries no Referer at all. A `<meta
 * name="referrer">` inserted, or whose content changes, updates the policy of
 * the current document. An existing one (React may own it through the
 * layout's metadata) is updated in place rather than removed.
 */
function restrictReferrer(): void {
  const existing = document.querySelector<HTMLMetaElement>('meta[name="referrer"]');
  if (existing) {
    existing.content = 'same-origin';
    return;
  }
  const meta = document.createElement('meta');
  meta.name = 'referrer';
  meta.content = 'same-origin';
  document.head.append(meta);
}

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
  const [selected, setSelected] = useState<string | null>(null);
  const [returnNotice, setReturnNotice] = useState<ReturnNotice | null>(null);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [activationEmail, setActivationEmail] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);

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

  // Back from the processor's cancel URL. The sentence is chosen from
  // `fp_result` and nothing else is read from it; the parameters are then
  // dropped from the address bar so a reload does not repeat the message.
  // The cart is untouched — it lives on the server, under the cart cookie.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('fp_result')) return;
    setReturnNotice(returnNoticeFor(url.searchParams.get('fp_result')));
    url.searchParams.delete('fp_result');
    url.searchParams.delete('fp_payment');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);

  // "Back" from the payment page can restore this page from the back/forward
  // cache, still busy from the moment it left (A.8.3). Release it and say the
  // payment did not go through; the cart is untouched.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setBusy(false);
      setReturnNotice((current) => current ?? returnNoticeFor('failed'));
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const payCheckout = stage.kind === 'pay' ? stage.checkout : null;
  const choices = useMemo(() => (payCheckout ? payChoices(payCheckout) : []), [payCheckout]);
  // The first offered method until the shopper picks another; a pick that is
  // no longer offered (the checkout was redrafted) falls back the same way.
  const chosen = choices.find((choice) => choice.key === selected) ?? choices[0] ?? null;

  // Asked for only where it is needed. A field with no purpose on a checkout
  // page costs conversions on every order that did not need it.
  const needsActivationEmail = (cart?.lines ?? []).some((line) => line.requiresActivationEmail);

  /**
   * The details as the API takes them. The WhatsApp number is checked here
   * with the same rule the API applies, so a typo is pointed at beside the
   * field instead of coming back as a refusal after a round trip.
   */
  function details(): Parameters<typeof cartApi.startCheckout>[0] {
    return {
      email,
      ...(name ? { name } : {}),
      ...(country ? { country } : {}),
      ...(needsActivationEmail ? { activationEmail } : {}),
      marketingOptIn,
      ...(whatsappPhone.trim() ? { whatsappPhone: whatsappPhone.trim() } : {}),
      whatsappOptIn,
    };
  }

  const whatsappError =
    whatsappPhone.trim() !== '' && !normalizeWhatsappPhone(whatsappPhone, country || null)
      ? t('whatsappPhoneInvalid')
      : whatsappOptIn && whatsappPhone.trim() === ''
        ? t('whatsappPhoneNeeded')
        : null;

  async function submitDetails(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (whatsappError) {
      setError(whatsappError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const checkout = await cartApi.startCheckout(details(), { locale });
      setStage({ kind: 'pay', checkout });
    } catch (caught) {
      setError(caught instanceof CartError ? caught.message : t('startFailed'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Redrafts the order from the same cart, for when the old draft cannot be
   * paid any more (`order_changed`) or the methods it offered went stale.
   */
  async function redraft(): Promise<boolean> {
    try {
      const fresh = await cartApi.startCheckout(details(), { locale });
      setCart(fresh.cart);
      setStage({ kind: 'pay', checkout: fresh });
      return true;
    } catch {
      return false;
    }
  }

  async function pay(checkout: Checkout, choice: PayChoice): Promise<void> {
    const orderNumber = checkout.order.number;
    const body: StartPayment =
      choice.provider === 'FINAL_PROCESSOR'
        ? { provider: 'FINAL_PROCESSOR', method: choice.method.id }
        : { provider: choice.provider };
    setBusy(true);
    setError(null);
    setReturnNotice(null);
    let leaving = false;
    try {
      const session = await cartApi.pay(orderNumber, body, { locale });
      if (session.provider === 'FINAL_PROCESSOR') {
        // Exactly as given: a parameter added here would reach the gateway
        // (A.2.9). The page stays busy while the browser leaves.
        //
        // The shop's address must not reach the gateway either. The
        // Referrer-Policy header only applies to a full load of this page, and
        // shoppers usually arrive by client-side navigation, which keeps the
        // policy of the first page they loaded. So the document's policy is
        // set here, immediately before leaving.
        restrictReferrer();
        leaving = true;
        window.location.assign(session.redirectUrl);
        return;
      }
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
      if (!(caught instanceof CartError)) {
        setError(t('startFailed'));
        return;
      }
      // The API's own sentence, in the order's language (A.6). What differs
      // by reason is what the page does next.
      if (caught.reason === 'order_changed') {
        // The draft was closed. A new one is drafted from the same cart, and
        // the shopper reviews it and pays again.
        setError((await redraft()) ? caught.message : t('startFailed'));
      } else if (caught.reason === 'unavailable') {
        // The method may have gone: redraw the list from the server.
        await redraft();
        setError(caught.message);
      } else {
        // 'retry' and everything else: the same button works in a moment.
        setError(caught.message);
      }
    } finally {
      if (!leaving) setBusy(false);
    }
  }

  async function addCrossSell(offer: CrossSell): Promise<void> {
    setBusy(true);
    try {
      await cartApi.addCrossSell(offer.variantId, { locale });
      // The order has to be redrafted: its lines and total just changed.
      const redrafted = await cartApi.startCheckout(details(), { locale });
      setCart(redrafted.cart);
      setStage({ kind: 'pay', checkout: redrafted });
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
          {returnNotice ? (
            <p className="notice notice-warn checkout-return-notice" role="alert">
              {t(returnNotice)}
            </p>
          ) : null}
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

              {/* Its own number and its own box, unticked: WhatsApp consent is
                  separate from email consent, and neither is assumed. */}
              <label>
                {t('whatsappPhone')}
                <input
                  type="tel"
                  value={whatsappPhone}
                  onChange={(event) => setWhatsappPhone(event.target.value)}
                  autoComplete="tel"
                  inputMode="tel"
                  dir="ltr"
                  maxLength={32}
                  aria-invalid={whatsappError && whatsappPhone.trim() !== '' ? true : undefined}
                />
                <small>{t('whatsappPhoneHint')}</small>
              </label>

              <label className="check">
                <input
                  type="checkbox"
                  checked={whatsappOptIn}
                  onChange={(event) => setWhatsappOptIn(event.target.checked)}
                />
                <span>{t('whatsappOptIn')}</span>
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

              {choices.length === 0 ? (
                // Nothing configured, so nothing is offered. A row of buttons
                // where every one leads to a 503 costs the order and the
                // goodwill; an address to write to keeps at least the order.
                <p className="notice">
                  {t.rich('noMethods', {
                    contact: (chunks) => <Link href={`${prefix}${ROUTES.contact}`}>{chunks}</Link>,
                  })}
                </p>
              ) : (
                <form
                  className="pay-choice-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (chosen) void pay(stage.checkout, chosen);
                  }}
                >
                  <fieldset className="pay-choices" disabled={busy}>
                    <legend className="visually-hidden">{t('howToPay')}</legend>
                    {choices.map((choice) => {
                      const icon =
                        choice.provider === 'FINAL_PROCESSOR'
                          ? drawableIcon(choice.method.iconUrl)
                          : null;
                      const label =
                        choice.provider === 'FINAL_PROCESSOR'
                          ? choice.method.label
                          : t(METHOD_LABELS[choice.provider]);
                      const description =
                        choice.provider === 'FINAL_PROCESSOR' ? choice.method.description : null;
                      return (
                        <label key={choice.key} className="pay-choice">
                          <input
                            type="radio"
                            name="payment-method"
                            value={choice.key}
                            checked={chosen?.key === choice.key}
                            onChange={() => setSelected(choice.key)}
                          />
                          <span className="pay-choice-body">
                            <span className="pay-choice-label">{label}</span>
                            {description ? (
                              <span className="pay-choice-description">{description}</span>
                            ) : null}
                          </span>
                          {icon ? (
                            // A plain <img>: the icon's host is whatever the
                            // admin or the processor chose, which next/image
                            // would refuse to optimise. `img-src` allows https.
                            <img
                              className="pay-choice-icon"
                              src={icon}
                              alt={label}
                              width={40}
                              height={28}
                              loading="lazy"
                              decoding="async"
                            />
                          ) : null}
                        </label>
                      );
                    })}
                  </fieldset>

                  {/* The server offers Final Processor only with a method behind
                      it; if that ever disagrees, the option says so instead of
                      being a radio that leads nowhere. */}
                  {stage.checkout.paymentMethods.includes('FINAL_PROCESSOR') &&
                  stage.checkout.finalProcessorMethods.length === 0 ? (
                    <p className="notice notice-warn" role="status">
                      {t('fpUnavailable')}
                    </p>
                  ) : null}

                  {chosen?.provider === 'FINAL_PROCESSOR' && stage.checkout.chargedInUsd ? (
                    <p className="notice pay-charged-usd">
                      {t.rich('chargedInUsd', {
                        amount: usd(stage.checkout.chargedInUsd.amountUsd),
                        strong: (chunks) => <strong dir="ltr">{chunks}</strong>,
                      })}
                    </p>
                  ) : null}

                  <button
                    type="submit"
                    className="btn btn-primary btn-wide pay-submit"
                    disabled={busy || chosen === null}
                  >
                    {busy ? '...' : t('payNow')}
                  </button>
                </form>
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
