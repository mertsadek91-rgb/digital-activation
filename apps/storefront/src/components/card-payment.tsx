'use client';

import type { PaymentSession } from '@da/contracts';
import {
  loadStripe,
  type Stripe,
  type StripeElements,
  type StripeError,
  type StripePaymentElement,
} from '@stripe/stripe-js';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { resolveLocale } from '../i18n/locale';

/**
 * The card step.
 *
 * The API opens a PaymentIntent and hands back a client secret; before this
 * component existed nothing in the page ever mounted Stripe.js, so the card
 * button opened a payment that could never be confirmed and left the shopper on
 * a screen with no card form on it.
 *
 * Three things have to be handled and all three are ordinary, not edge cases: a
 * card the bank declines, a card that asks for 3-D Secure, and a store with no
 * Stripe keys configured at all. The last one is the state this repository is
 * in today — the catalog, the cart and the panel all work without payment keys
 * — so it renders an explanation rather than throwing inside Stripe.js.
 *
 * Nothing here logs, stores or puts into a URL the publishable key, the client
 * secret or the amount. The amount shown is the one the server sent with the
 * session; the amount charged is the one on the order row, which this code
 * never sees and cannot influence.
 */
type CardSession = Extract<PaymentSession, { provider: 'STRIPE' }>;

type Phase =
  /** Stripe.js is loading and the Payment Element has not mounted yet. */
  | 'loading'
  /** Mounted, waiting for the shopper. */
  | 'ready'
  /** Confirming; the 3-D Secure sheet, if the bank asks for one, is up. */
  | 'confirming'
  /** The bank took the payment but has not settled it yet. */
  | 'processing'
  /** The bank wants a step this page cannot finish on the shopper's behalf. */
  | 'action'
  | 'paid'
  /** No usable key, or Stripe.js could not be fetched at all. */
  | 'unavailable';

export function CardPayment({
  session,
  returnPath,
  locale,
  onPaid,
  onBack,
}: {
  session: CardSession;
  /** Where the shopper lands once the payment is done, as a site path. */
  returnPath: string;
  locale: string;
  onPaid: () => void;
  onBack: () => void;
}) {
  const t = useTranslations('cardPayment');
  const stripeLocale = resolveLocale(locale);
  const mount = useRef<HTMLDivElement | null>(null);
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [elements, setElements] = useState<StripeElements | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState<string | null>(null);

  const { clientSecret, publishableKey } = session;

  useEffect(() => {
    // An empty key is the configured-nothing case, and `loadStripe('')` throws
    // on it. Checked before the call so the shopper gets a sentence instead of
    // an unhandled rejection.
    if (publishableKey === '') {
      setPhase('unavailable');
      return;
    }

    let cancelled = false;
    let element: StripePaymentElement | null = null;

    void (async () => {
      // A blocked or failed script is the same outcome as no key: the card
      // form cannot appear, and saying so beats an empty box.
      const loaded = await loadStripe(publishableKey).catch(() => null);
      if (cancelled) return;
      if (!loaded) {
        setPhase('unavailable');
        return;
      }

      const created = loaded.elements({
        clientSecret,
        // Stripe renders its own RTL inside the iframe from this, which the
        // page's own direction cannot reach.
        locale: stripeLocale,
      });
      element = created.create('payment');

      const node = mount.current;
      if (!node) return;
      element.mount(node);

      setStripe(loaded);
      setElements(created);
      setPhase('ready');
    })();

    return () => {
      cancelled = true;
      element?.destroy();
    };
  }, [stripeLocale, clientSecret, publishableKey]);

  async function confirm(): Promise<void> {
    if (!stripe || !elements) return;
    setMessage(null);
    setPhase('confirming');

    // Stripe wants the element validated before the intent is confirmed;
    // skipping it turns a missing expiry date into a declined payment.
    const submitted = await elements.submit();
    if (submitted.error) {
      setPhase('ready');
      setMessage(readable(submitted.error, t('failed')));
      return;
    }

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Absolute, because Stripe redirects the whole browser here for the
        // card types that cannot be confirmed in a modal. Stripe appends its
        // own query parameters on the way back; this code adds none, and the
        // order page reads its status from the server rather than from the URL,
        // because the webhook is what actually marks an order paid.
        return_url: `${window.location.origin}${returnPath}`,
      },
      // Keeps the shopper on this page whenever the bank does not insist on a
      // full redirect, which is most of the time and every 3-D Secure modal.
      redirect: 'if_required',
    });

    if (result.error) {
      setPhase('ready');
      setMessage(readable(result.error, t('failed')));
      return;
    }

    const intent = result.paymentIntent;
    if (intent.status === 'succeeded') {
      setPhase('paid');
      onPaid();
      return;
    }
    if (intent.status === 'processing') {
      setPhase('processing');
      return;
    }
    if (intent.status === 'requires_action') {
      setPhase('action');
      return;
    }

    // requires_payment_method, and anything Stripe adds later: the card did not
    // work and another one is the answer, so the form stays where it is.
    setPhase('ready');
    setMessage(t('declined'));
  }

  if (phase === 'unavailable') {
    return (
      <div className="card-pay">
        <p className="notice">{t('unavailable')}</p>
        <button type="button" className="btn btn-ghost btn-wide" onClick={onBack}>
          {t('anotherMethod')}
        </button>
      </div>
    );
  }

  if (phase === 'paid') {
    return <p className="added">{t('paid')}</p>;
  }

  if (phase === 'processing') {
    return <p className="notice">{t('processing')}</p>;
  }

  return (
    <div className="card-pay">
      {/* Stripe mounts its own fields in here; the page styles the box, not
          the inputs, which live in an iframe this code cannot reach into. */}
      <div ref={mount} className="card-pay-element" />

      {phase === 'loading' ? <p className="hold-note">{t('loading')}</p> : null}

      {phase === 'action' ? <p className="notice">{t('action')}</p> : null}

      {message ? <p className="error">{message}</p> : null}

      <button
        type="button"
        className="btn btn-primary btn-wide"
        disabled={phase !== 'ready'}
        onClick={() => void confirm()}
      >
        {phase === 'confirming' ? t('paying') : t('payNow')}
      </button>

      <button type="button" className="linky" onClick={onBack} disabled={phase === 'confirming'}>
        {t('anotherMethod')}
      </button>
    </div>
  );
}

/**
 * The message to put in front of the shopper.
 *
 * Stripe's own text is used only for the two kinds the shopper can act on — a
 * declined card and a field they filled in wrong. Everything else is an API
 * error, a rate limit or a misconfiguration on our side, and repeating "No such
 * payment_intent" to a customer tells them nothing they can do anything about.
 */
function readable(error: StripeError, fallback: string): string {
  const actionable = error.type === 'card_error' || error.type === 'validation_error';
  if (actionable && error.message) return error.message;
  return fallback;
}
