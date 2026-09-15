'use client';

import type { Cart, Checkout, CrossSell, PaymentProvider, PaymentSession } from '@da/contracts';
import { ROUTES } from '@da/contracts';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { CardPayment } from '../../../components/card-payment';
import { PaymentInstructionsPanel } from '../../../components/payment-instructions';
import { ProductTrust } from '../../../components/product-trust';
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
 * here, beside the rest of the page's Arabic and English.
 */
const METHOD_LABELS: Record<PaymentProvider, { ar: string; en: string }> = {
  STRIPE: { ar: 'بطاقة بنكية', en: 'Card' },
  PAYPAL: { ar: 'PayPal', en: 'PayPal' },
  BANK_TRANSFER: { ar: 'تحويل بنكي', en: 'Bank transfer' },
  CRYPTO: { ar: 'عملات رقمية', en: 'Cryptocurrency' },
};

export default function CheckoutPage() {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'ar';
  const ar = locale === 'ar';
  const prefix = ar ? '' : `/${locale}`;

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
      setError(caught instanceof CartError ? caught.message : 'تعذّر تحميل السلة.');
    }
  }, [locale]);

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
      setError(caught instanceof CartError ? caught.message : 'تعذّر بدء عملية الدفع.');
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
        setError(ar ? 'PayPal غير متاح بعد.' : 'PayPal is not available yet.');
        return;
      }
      setStage({ kind: 'manual', session, orderNumber });
    } catch (caught) {
      setError(caught instanceof CartError ? caught.message : 'تعذّر بدء عملية الدفع.');
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
      setError(caught instanceof CartError ? caught.message : 'تعذّر إضافة العرض.');
    } finally {
      setBusy(false);
    }
  }

  if (cart && cart.lines.length === 0 && stage.kind === 'details') {
    return (
      <main className="shell">
        <h1>{ar ? 'إتمام الشراء' : 'Checkout'}</h1>
        <p className="notice">{ar ? 'سلتك فارغة.' : 'Your cart is empty.'}</p>
        <Link href={`${prefix}${ROUTES.store}`} className="btn btn-primary">
          {ar ? 'تصفّح المتجر' : 'Browse the store'}
        </Link>
      </main>
    );
  }

  if (stage.kind === 'manual') {
    return (
      <main className="shell">
        <h1>{ar ? 'أكمل الدفع' : 'Complete your payment'}</h1>
        <p className="notice">
          {ar ? 'رقم طلبك: ' : 'Your order number: '}
          <strong dir="ltr">{stage.orderNumber}</strong>
        </p>
        <p className="price">
          <strong>{formatPrice(stage.session.amount)}</strong>
        </p>
        <PaymentInstructionsPanel instructions={stage.session.instructions} locale={locale} />
        <Link
          href={`${prefix}${ROUTES.order(stage.orderNumber)}`}
          className="btn btn-primary"
          onClick={() => router.refresh()}
        >
          {ar ? 'عرض الطلب' : 'View the order'}
        </Link>
      </main>
    );
  }

  return (
    <main className="shell checkout-page">
      <h1>{ar ? 'إتمام الشراء' : 'Checkout'}</h1>

      <div className="checkout-layout">
        <div className="checkout-main">
          {stage.kind === 'details' ? (
            <form className="checkout-form" onSubmit={(event) => void submitDetails(event)}>
              <h2>{ar ? 'بياناتك' : 'Your details'}</h2>

              <label>
                {ar ? 'البريد الإلكتروني' : 'Email address'}
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  dir="ltr"
                />
                <small>
                  {ar
                    ? 'يُرسَل إليه إيصال الشراء والمفتاح.'
                    : 'Your receipt and your key are sent here.'}
                </small>
              </label>

              {needsActivationEmail ? (
                <label className="highlight">
                  {ar ? 'بريد تفعيل الترخيص' : 'Licence activation email'}
                  <input
                    type="email"
                    value={activationEmail}
                    onChange={(event) => setActivationEmail(event.target.value)}
                    required
                    dir="ltr"
                  />
                  <small>
                    {ar
                      ? 'أحد منتجات سلتك يُفعَّل على بريد تحدّده أنت — وقد يكون غير بريد الشراء. المفتاح الصادر على العنوان الخطأ لا يمكن استخدامه ولا إلغاؤه.'
                      : 'One item in your cart activates on an address you choose — often not the one you order from. A key issued against the wrong address cannot be used or reversed.'}
                  </small>
                </label>
              ) : null}

              <label>
                {ar ? 'الاسم (اختياري)' : 'Name (optional)'}
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                />
              </label>

              <label>
                {ar ? 'الدولة (اختياري)' : 'Country (optional)'}
                <input
                  type="text"
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                  maxLength={2}
                  placeholder={ar ? 'AE' : 'AE'}
                  autoComplete="country"
                  dir="ltr"
                />
              </label>

              <label className="check">
                <input
                  type="checkbox"
                  checked={marketingOptIn}
                  onChange={(event) => setMarketingOptIn(event.target.checked)}
                />
                <span>
                  {ar
                    ? 'أرغب في تلقّي العروض والخصومات بالبريد.'
                    : 'Send me offers and discounts by email.'}
                </span>
              </label>

              {error ? <p className="error">{error}</p> : null}

              <button type="submit" className="btn btn-primary btn-wide" disabled={busy}>
                {busy ? '...' : ar ? 'متابعة إلى الدفع' : 'Continue to payment'}
              </button>
            </form>
          ) : stage.kind === 'card' ? (
            <div className="checkout-form">
              <h2>{ar ? 'ادفع بالبطاقة' : 'Pay by card'}</h2>
              <p className="notice">
                {ar ? 'رقم طلبك: ' : 'Your order number: '}
                <strong dir="ltr">{stage.checkout.order.number}</strong>
              </p>
              <p className="price">
                <strong>{formatPrice(stage.session.amount)}</strong>
              </p>
              <CardPayment
                session={stage.session}
                locale={locale}
                returnPath={`${prefix}/orders/${stage.checkout.order.number}`}
                onPaid={() => router.push(`${prefix}/orders/${stage.checkout.order.number}`)}
                onBack={() => setStage({ kind: 'pay', checkout: stage.checkout })}
              />
            </div>
          ) : (
            <div className="checkout-form">
              <h2>{ar ? 'طريقة الدفع' : 'How would you like to pay?'}</h2>
              <p className="notice">
                {ar ? 'رقم طلبك: ' : 'Your order number: '}
                <strong dir="ltr">{stage.checkout.order.number}</strong>
              </p>

              {stage.checkout.crossSell.length > 0 ? (
                <section className="cross-sell">
                  <h3>{ar ? 'أضفها ووفّر' : 'Add it and save'}</h3>
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
                            {ar
                              ? `وفّر ${String(offer.savePercent)}%`
                              : `Save ${String(offer.savePercent)}%`}
                          </span>
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => void addCrossSell(offer)}
                      >
                        {ar ? 'أضف' : 'Add'}
                      </button>
                    </div>
                  ))}
                </section>
              ) : null}

              {error ? <p className="error">{error}</p> : null}

              {stage.checkout.paymentMethods.length === 0 ? (
                // Nothing configured, so nothing is offered. A row of buttons
                // where every one leads to a 503 costs the order and the
                // goodwill; an address to write to keeps at least the order.
                <p className="notice">
                  {ar ? (
                    <>
                      لا توجد طريقة دفع متاحة الآن. طلبك محفوظ برقمه —{' '}
                      <Link href={`${prefix}${ROUTES.contact}`}>راسلنا</Link> وسنُكمله معك.
                    </>
                  ) : (
                    <>
                      No payment method is available right now. Your order is saved under its number
                      — <Link href={`${prefix}${ROUTES.contact}`}>write to us</Link> and we will
                      finish it with you.
                    </>
                  )}
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
                      {ar ? METHOD_LABELS[provider].ar : METHOD_LABELS[provider].en}
                    </button>
                  ))}
                </div>
              )}

              <button type="button" className="linky" onClick={() => setStage({ kind: 'details' })}>
                {ar ? 'تعديل بياناتي' : 'Edit my details'}
              </button>
            </div>
          )}
        </div>

        <aside className="cart-summary">
          <h2>{ar ? 'الملخّص' : 'Summary'}</h2>
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
                  <dt>{ar ? 'المجموع' : 'Subtotal'}</dt>
                  <dd>{formatPrice(cart.subtotal)}</dd>
                </div>
                {cart.coupon ? (
                  <div className="totals-discount">
                    <dt>{cart.coupon.name}</dt>
                    <dd>−{formatPrice(cart.discount)}</dd>
                  </div>
                ) : null}
                <div className="totals-total">
                  <dt>{ar ? 'الإجمالي' : 'Total'}</dt>
                  <dd>{formatPrice(cart.total)}</dd>
                </div>
              </dl>
              <Link href={`${prefix}${ROUTES.cart}`} className="linky">
                {ar ? 'تعديل السلة' : 'Edit cart'}
              </Link>

              <div style={{ marginBlockStart: '16px' }}>
                <ProductTrust locale={locale} showPerks={false} />
              </div>
            </>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
