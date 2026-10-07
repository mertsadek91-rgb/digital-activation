'use client';

import type { Order, OrderSuggestions } from '@da/contracts';
import { ROUTES } from '@da/contracts/constants';
import { Link } from '../../../../components/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ClientBreadcrumbs } from '../../../../components/breadcrumbs-client';
import {
  CheckIcon,
  FileIcon,
  InfoIcon,
  KeyIcon,
  LockIcon,
  WarningIcon,
} from '../../../../components/icons';
import { SuggestionList } from '../../../../components/offer-suggestions';
import { isArabic } from '../../../../i18n/locale';
import { cartApi, CartError } from '../../../../lib/cart-client';
import { formatLineState, formatOrderStatus, formatPrice } from '../../../../lib/format';

/** Ask again every 4s, 15 times: about a minute of "confirming". */
const POLL_EVERY_MS = 4000;
const POLL_LIMIT = 15;

type OrderLine = Order['lines'][number];

/**
 * Order confirmation, after the kit's order-details page (TASK-0105): the
 * order number as the title with its status chip, the lines as cards, the
 * "delivery details" card with one entry per line, and the order summary at
 * the side.
 *
 * Readable only by the cart that placed it — the API checks that, because order
 * numbers are sequential and DA-2026-00001 tells a guesser DA-2026-00002
 * exists. A stranger counting upwards gets the same answer as for an order that
 * does not exist.
 *
 * What it says about fulfilment is deliberately plain. Most of this catalog is
 * ordered from a supplier after payment, so a line sitting in the manual queue
 * is the normal, expected state and not a problem — and telling the customer
 * that, with the window, is what stops them writing in to ask.
 */
export default function OrderPage() {
  const params = useParams<{ locale: string; number: string }>();
  const locale = params.locale ?? 'ar';
  const number = params.number ?? '';
  const t = useTranslations('order');
  const tc = useTranslations('common');
  const tf = useTranslations('format');
  const prefix = isArabic(locale) ? '' : `/${locale}`;

  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      // The key from an emailed link, if this page was opened from one.
      const key = new URLSearchParams(window.location.search).get('key');
      setOrder(await cartApi.order(number, { locale, key }));
    } catch (caught) {
      if (caught instanceof CartError && caught.status === 404) setNotFound(true);
      setError(caught instanceof CartError ? caught.message : t('loadFailed'));
    }
  }, [number, locale, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Right after a card payment, the order is usually still PENDING_PAYMENT:
   * Stripe has taken the money, and the webhook that marks the order paid
   * lands a few seconds later. This page used to say "payment has not arrived
   * yet" at exactly the moment the customer had just paid — the one sentence
   * guaranteed to produce a second attempt or a support message.
   *
   * So when the checkout sends the shopper here after a card payment
   * (`?paid=card`, which also survives Stripe's own redirect back), the page
   * says it is confirming and asks again every few seconds, for about a
   * minute. After that it falls back to the plain statement, because a
   * webhook that has not arrived in a minute is worth knowing about.
   */
  const [confirming, setConfirming] = useState(false);
  const polls = useRef(0);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('paid') === 'card' && query.get('redirect_status') !== 'failed') {
      setConfirming(true);
    }
  }, []);

  const pending = order?.status === 'PENDING_PAYMENT';

  useEffect(() => {
    if (!confirming || !pending) return;
    const timer = window.setInterval(() => {
      polls.current += 1;
      if (polls.current > POLL_LIMIT) {
        setConfirming(false);
        return;
      }
      void load();
    }, POLL_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [confirming, pending, load]);

  const crumbs = [
    { name: tc('home'), href: `${prefix}/` },
    { name: t('myOrders'), href: `${prefix}${ROUTES.accountOrders}` },
    { name: number, href: `${prefix}${ROUTES.order(number)}` },
  ];

  if (!order) {
    return (
      <>
        <div className="page-band">
          <div className="shell">
            <ClientBreadcrumbs items={crumbs} />
            <header className="page-head">
              <h1>{t('title')}</h1>
            </header>
          </div>
        </div>
        <main className="shell order-page">
          {error ? (
            <p className="alert alert-error" role="alert">
              <WarningIcon size={20} />
              <span>{error}</span>
            </p>
          ) : (
            <p className="notice" aria-busy="true">
              …
            </p>
          )}
          {notFound ? (
            // Most often not a missing order but a different device: the page
            // opens for the browser that placed it, a signed-in customer, or
            // the link in the order email. Say which door is open.
            <p className="meta">
              {t('notFoundHint')} <Link href={`${prefix}/account`}>{t('myAccount')}</Link>
            </p>
          ) : null}
          <p>
            <Link href={`${prefix}${ROUTES.store}`} className="btn btn-outline">
              {t('theStore')}
            </Link>
          </p>
        </main>
      </>
    );
  }

  const waiting = order.status === 'PENDING_PAYMENT';

  return (
    <>
      <div className="page-band">
        <div className="shell">
          <ClientBreadcrumbs items={crumbs} />
          <header className="page-head order-head">
            <h1>
              {t.rich('heading', {
                number: order.number,
                ltr: (chunks) => <span dir="ltr">{chunks}</span>,
              })}
            </h1>
            <span className={`pill ${waiting ? 'pill-draft' : 'pill-published'}`}>
              {waiting ? null : <CheckIcon size={14} />}
              {formatOrderStatus(order.status, tf)}
            </span>
          </header>
        </div>
      </div>

      <main className="shell order-page">
        {waiting && confirming ? (
          <p className="alert alert-info" role="status">
            <InfoIcon size={20} />
            <span>{t('confirming')}</span>
          </p>
        ) : waiting ? (
          <p className="alert alert-warning">
            <WarningIcon size={20} />
            <span>{t('notPaid')}</span>
          </p>
        ) : null}

        <div className="order-layout">
          <div className="order-main">
            <section aria-labelledby="order-items">
              <h2 id="order-items" className="visually-hidden">
                {t('items')}
              </h2>
              <ul className="cart-lines order-lines">
                {order.lines.map((line) => (
                  <li key={line.sku} className="cart-line">
                    <div className="cart-line-media">
                      <span className="iconbox" aria-hidden="true">
                        <FileIcon size={22} />
                      </span>
                    </div>
                    <div className="cart-line-body">
                      {line.productSlug ? (
                        <Link
                          href={`${prefix}${ROUTES.product(line.productSlug)}`}
                          className="cart-line-name"
                        >
                          {line.productName}
                        </Link>
                      ) : (
                        <p className="cart-line-name">{line.productName}</p>
                      )}
                      <p className="cart-line-spec">
                        <bdi dir="ltr">{line.sku}</bdi>
                      </p>
                      <p className="cart-line-price">
                        <strong>{formatPrice(line.lineTotal)}</strong>
                      </p>
                    </div>
                    <div className="cart-line-controls">
                      <span className="chip is-static">{t('qty', { count: line.qty })}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel" aria-labelledby="order-delivery">
              <h2 id="order-delivery">{t('deliveryDetails')}</h2>

              {/* What will land in the inbox, said before it lands. A customer
                  expecting a key who receives a username and a password reads
                  it as the wrong email. The same steps the licence email
                  carries sit here too: the email is read on a phone and the
                  activation happens at a machine — and an email can be lost. */}
              <ul className="delivery-list">
                {order.lines.map((line) => (
                  <DeliveryCard key={line.sku} line={line} />
                ))}
              </ul>

              {/* What this says has to be true today: the key is in the email
                  and in the licences page, and the steps are here. */}
              <p className="alert alert-info">
                <InfoIcon size={20} />
                <span>{t('keyNote')}</span>
              </p>

              <dl className="kv-list">
                <div>
                  <dt>{t('email')}</dt>
                  <dd dir="ltr">{order.email}</dd>
                </div>
                {order.activationEmail ? (
                  <div>
                    <dt>{t('activationEmail')}</dt>
                    <dd dir="ltr">{order.activationEmail}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>{t('placed')}</dt>
                  <dd dir="ltr">
                    {new Date(order.placedAt).toISOString().slice(0, 16).replace('T', ' ')}
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <aside className="cart-summary" aria-labelledby="order-summary-title">
            <h2 id="order-summary-title">{t('summary')}</h2>
            <dl className="totals">
              <div>
                <dt>{tc('subtotal')}</dt>
                <dd>{formatPrice(order.subtotal)}</dd>
              </div>
              {Number(order.discount.amount) > 0 ? (
                <div className="totals-discount">
                  <dt>{order.couponCode ?? tc('discount')}</dt>
                  <dd>−{formatPrice(order.discount)}</dd>
                </div>
              ) : null}
              <div className="totals-total">
                <dt>{tc('total')}</dt>
                <dd>{formatPrice(order.total)}</dd>
              </div>
            </dl>

            {/* The answer to "I deleted the email", one click away rather
                than a support ticket. */}
            <Link href={`${prefix}${ROUTES.licenses}`} className="btn btn-primary btn-wide">
              <KeyIcon size={18} />
              {t('openLicences')}
            </Link>

            <p className="secure-note">
              <LockIcon size={20} />
              <span>{t('keyNoteShort')}</span>
            </p>
          </aside>
        </div>

        {!waiting ? (
          <SetupSuggestions number={order.number} locale={locale} currency={order.currency} />
        ) : null}
      </main>
    </>
  );
}

/** One line's delivery: its state, what arrives, and how to activate it. */
function DeliveryCard({ line }: { line: OrderLine }) {
  const t = useTranslations('order');
  const tf = useTranslations('format');
  const delivered = line.fulfillmentState === 'DELIVERED';

  return (
    <li className={`licence-card${delivered ? '' : ' is-waiting'}`}>
      <div className="licence-head">
        <p className="licence-name">{line.productName}</p>
        <span className={`pill ${delivered ? 'pill-published' : 'pill-draft'}`}>
          {delivered ? <CheckIcon size={14} /> : null}
          {formatLineState(line.fulfillmentState, tf)}
        </span>
      </div>
      <p className="licence-kind">
        {line.credentialKind === 'ACCOUNT_CREDENTIALS'
          ? t('deliveredAsAccount')
          : t('deliveredAsKey')}
      </p>
      {line.activationSteps.length > 0 ? (
        <details className="licence-how">
          <summary>{t('howToActivate')}</summary>
          <ol>
            {line.activationSteps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </details>
      ) : null}
    </li>
  );
}

/**
 * "Complete your setup": what goes with a paid order.
 *
 * Adding one puts it in a new cart — the paid cart is closed — and the shopper
 * pays for it the ordinary way; nothing is charged from this page. Because
 * this page is opened by the cart cookie, which the new cart replaces, the
 * order's signed link key goes into the address once something is added, so
 * a reload still opens the order.
 */
function SetupSuggestions({
  number,
  locale,
  currency,
}: {
  number: string;
  locale: string;
  currency: string;
}) {
  const to = useTranslations('offers');
  const [data, setData] = useState<OrderSuggestions | null>(null);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    let live = true;
    const key = new URLSearchParams(window.location.search).get('key');
    cartApi
      .orderSuggestions(number, { locale, currency, key })
      .then((result) => {
        if (live) setData(result);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [number, locale, currency]);

  if (!data || data.items.length === 0) return null;

  return (
    <section className="offer-strip" aria-labelledby="order-setup">
      <h2 id="order-setup">{to('setupTitle')}</h2>
      <p className="lede-sm">{to('setupLede')}</p>
      <SuggestionList
        items={data.items}
        locale={locale}
        licenceNumber={data.licenceNumber}
        onAdded={() => {
          const url = new URL(window.location.href);
          if (!url.searchParams.get('key')) {
            url.searchParams.set('key', data.accessKey);
            window.history.replaceState(window.history.state, '', url.toString());
          }
          setAdded(true);
        }}
      />
      {added ? (
        <p className="alert" role="status">
          <CheckIcon size={20} />
          <span>{to('setupAdded')}</span>
        </p>
      ) : null}
    </section>
  );
}
