'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { CartError, cartApi } from '../lib/cart-client';

import { CartIcon } from './icons';

/**
 * The buy button on a grid card.
 *
 * The store this replaces puts one on every card, and it is the right call for
 * this catalog: an activation key has nothing to configure, so for most
 * products the product page exists to be read rather than to be filled in.
 * Making somebody open it to press a second button costs a step for nothing.
 *
 * Only where there is nothing to choose, though. The card is given a variant
 * id only when exactly one variant is sellable — with two, a one-year against
 * a three-year licence is a decision, and a button that made it silently would
 * put the wrong licence in the cart and reveal it at the confirmation page.
 * Elsewhere the card links to the product.
 *
 * It reports what happened in place rather than through a toast. A confirmation
 * that appears in a corner and leaves is a confirmation somebody misses while
 * looking at the card they clicked.
 */
export function AddToCart({
  variantId,
  locale,
  currency,
}: {
  variantId: string;
  locale: string;
  currency: string;
}) {
  const t = useTranslations('productCard');
  const tc = useTranslations('common');
  const [state, setState] = useState<'idle' | 'busy' | 'added'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function add(): Promise<void> {
    setState('busy');
    setError(null);
    try {
      await cartApi.add(variantId, 1, { locale, currency });
      setState('added');
      // Back to a button after a moment: the card stays usable, and somebody
      // buying two of something should not have to reload to do it.
      setTimeout(() => {
        setState('idle');
      }, 2200);
    } catch (caught) {
      setState('idle');
      setError(caught instanceof CartError ? caught.message : t('addFailed'));
    }
  }

  return (
    <>
      <button
        type="button"
        className={`card-buy${state === 'added' ? ' is-added' : ''}`}
        disabled={state === 'busy'}
        onClick={() => void add()}
      >
        {state === 'added' ? null : <CartIcon />}
        <span>
          {state === 'added' ? t('added') : state === 'busy' ? t('adding') : tc('addToCart')}
        </span>
      </button>
      {error ? <p className="card-buy-error">{error}</p> : null}
    </>
  );
}
