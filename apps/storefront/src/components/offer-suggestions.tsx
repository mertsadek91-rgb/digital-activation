'use client';

import type { Cart, OfferSuggestion } from '@da/contracts';
import { ROUTES } from '@da/contracts/constants';
import Image from 'next/image';
import { Link } from './link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { isArabic } from '../i18n/locale';
import { cartErrorMessage, loadCartApi } from '../lib/lazy-clients';
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
  unlockPercent,
  onAdded,
}: {
  item: OfferSuggestion;
  locale: string;
  licenceNumber: string;
  /** The whole-cart tier adding this card reaches, when it is the next one. */
  unlockPercent?: number | null | undefined;
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
      const cartApi = await loadCartApi();
      const cart = await cartApi.addSuggestion(id, { locale, currency: item.card.price.currency });
      setState('added');
      onAdded?.(cart);
    } catch (caught) {
      setState('idle');
      setError(await cartErrorMessage(caught, t('addFailed')));
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
        {unlockPercent ? (
          <p className="offer-card-unlock">{t('unlockWholeCart', { percent: unlockPercent })}</p>
        ) : null}
        <p className="offer-card-for">{t('goesWith', { name: item.forProduct.name })}</p>
        {/* The price and the button on one row, the button at the end (owner,
            2026-10-07; TASK-0127): the card is one block, not a block and a
            button under it. */}
        <div className="offer-card-foot">
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
        </div>
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
    </li>
  );
}

export function SuggestionList({
  items,
  locale,
  licenceNumber,
  unlockPercent,
  onAdded,
}: {
  items: OfferSuggestion[];
  locale: string;
  licenceNumber: string;
  /**
   * Set on the cart page when one more item reaches the next volume tier: each
   * card then says that adding it takes that percent off the whole cart
   * (TASK-0123). The number is the API's tier, not recomputed here.
   */
  unlockPercent?: number | null;
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
            unlockPercent={unlockPercent}
            onAdded={onAdded}
          />
        ))}
      </ul>
      {anyPair ? <p className="offer-note">{t('oneDiscount')}</p> : null}
    </>
  );
}
