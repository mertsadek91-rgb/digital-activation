'use client';

import type { Cart, OfferSuggestion } from '@da/contracts';
import { ROUTES } from '@da/contracts';
import Image from 'next/image';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { isArabic } from '../i18n/locale';
import { CartError, cartApi } from '../lib/cart-client';
import { formatPrice } from '../lib/format';

/**
 * "Goes well with" cards, shared by the after-add dialog, the cart page and
 * the order page.
 *
 * Every one is an explicit button press — nothing is pre-selected, pre-ticked
 * or added for the shopper. A product with more than one variant gets a link
 * to choose rather than a button that would pick a licence term for them.
 *
 * A pair percent is stated as what it is: taken in the cart as the pair
 * discount, one of the "one discount per cart" candidates, so it is shown
 * with that rule and the licence number, never as a price already paid.
 */

/** The Ministry of Commerce licence line, beside any discount it covers. */
export function DiscountLicence({ number }: { number: string }) {
  const t = useTranslations('offers');
  if (!number) return null;
  return (
    <p className="offer-licence">
      {t.rich('licence', {
        number,
        ltr: (chunks) => <span dir="ltr">{chunks}</span>,
      })}
    </p>
  );
}

function SuggestionCard({
  item,
  locale,
  licenceNumber,
  onAdded,
}: {
  item: OfferSuggestion;
  locale: string;
  licenceNumber: string;
  onAdded?: ((cart: Cart) => void) | undefined;
}) {
  const t = useTranslations('offers');
  const [state, setState] = useState<'idle' | 'busy' | 'added'>('idle');
  const [error, setError] = useState<string | null>(null);
  const prefix = isArabic(locale) ? '' : `/${locale}`;
  const href = `${prefix}${ROUTES.product(item.card.slug)}`;
  const variantId = item.card.buyableVariantId;

  async function add(id: string): Promise<void> {
    setState('busy');
    setError(null);
    try {
      const cart = await cartApi.addSuggestion(id, { locale, currency: item.card.price.currency });
      setState('added');
      onAdded?.(cart);
    } catch (caught) {
      setState('idle');
      setError(caught instanceof CartError ? caught.message : t('addFailed'));
    }
  }

  return (
    <li className="offer-card">
      <div className="offer-card-media">
        {item.card.image ? (
          <Image src={item.card.image.url} alt={item.card.image.alt} fill sizes="72px" />
        ) : null}
      </div>
      <div className="offer-card-body">
        <Link href={href} className="offer-card-name">
          {item.card.name}
        </Link>
        <p className="offer-card-for">{t('goesWith', { name: item.forProduct.name })}</p>
        <p className="offer-card-price">
          <strong>{formatPrice(item.card.price)}</strong>
          {item.card.price.compareAt ? (
            <s>
              {formatPrice({
                amount: item.card.price.compareAt,
                currency: item.card.price.currency,
              })}
            </s>
          ) : null}
        </p>
        {item.card.sale ? <DiscountLicence number={item.card.sale.licenceNumber} /> : null}
        {item.pairPercent > 0 ? (
          <>
            <p className="offer-card-pair">
              {t('pairSave', { percent: item.pairPercent, name: item.forProduct.name })}
            </p>
            <DiscountLicence number={licenceNumber} />
          </>
        ) : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="offer-card-action">
        {variantId ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={state !== 'idle'}
            onClick={() => void add(variantId)}
          >
            {state === 'added' ? t('addedOne') : state === 'busy' ? t('adding') : t('add')}
          </button>
        ) : (
          <Link href={href} className="btn btn-ghost">
            {t('choose')}
          </Link>
        )}
      </div>
    </li>
  );
}

export function SuggestionList({
  items,
  locale,
  licenceNumber,
  onAdded,
}: {
  items: OfferSuggestion[];
  locale: string;
  licenceNumber: string;
  onAdded?: (cart: Cart) => void;
}) {
  const t = useTranslations('offers');
  const anyPair = items.some((item) => item.pairPercent > 0);
  return (
    <>
      <ul className="offer-list">
        {items.map((item) => (
          <SuggestionCard
            key={item.card.slug}
            item={item}
            locale={locale}
            licenceNumber={licenceNumber}
            onAdded={onAdded}
          />
        ))}
      </ul>
      {anyPair ? <p className="offer-note">{t('oneDiscount')}</p> : null}
    </>
  );
}
