'use client';

import type { OfferSuggestions } from '@da/contracts';
import { ROUTES } from '@da/contracts';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { isArabic } from '../i18n/locale';
import { CART_ADDED_EVENT, type CartAddedDetail, cartApi } from '../lib/cart-client';

import { CloseIcon } from './icons';
import { SuggestionList } from './offer-suggestions';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * "Added — goes well with", after a shopper's own add-to-cart.
 *
 * Mounted once in the layout and opened by `CART_ADDED_EVENT`, so the buy box
 * and every grid card get it without each carrying a dialog. It opens only
 * when there is something curated to show; an add with no pairs configured,
 * the feature off, or the request failing leaves the page exactly as it was —
 * the add itself already succeeded and said so in place.
 *
 * A real modal: `role="dialog"` with `aria-modal`, focus moved in on open and
 * kept in by Tab, Escape and the backdrop close it, and focus goes back to the
 * button that was pressed. Nothing inside is pre-selected.
 */
export function AddedDialog({ locale }: { locale: string }) {
  const t = useTranslations('offers');
  const titleId = useId();
  const [data, setData] = useState<OfferSuggestions | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const latest = useRef(0);
  const prefix = isArabic(locale) ? '' : `/${locale}`;

  const close = useCallback(() => {
    setData(null);
    restoreRef.current?.focus();
    restoreRef.current = null;
  }, []);

  useEffect(() => {
    const onAdded = (event: Event): void => {
      const { cart, variantId } = (event as CustomEvent<CartAddedDetail>).detail;
      const line = cart.lines.find((entry) => entry.variantId === variantId);
      if (!line) return;
      // Only the answer to the latest add may open the dialog.
      const ticket = ++latest.current;
      void cartApi
        .suggestions([line.productSlug], 'added', { locale, currency: cart.currency })
        .then((result) => {
          if (ticket !== latest.current || result.items.length === 0) return;
          restoreRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setData(result);
        })
        // Suggestions are a nicety; failing to fetch them is not worth a message.
        .catch(() => undefined);
    };
    window.addEventListener(CART_ADDED_EVENT, onAdded);
    return () => window.removeEventListener(CART_ADDED_EVENT, onAdded);
  }, [locale]);

  const open = data !== null;

  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    node?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    document.body.style.overflow = 'hidden';

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      // The trap: Tab past the last control comes back to the first, and
      // Shift+Tab before the first goes to the last.
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!node.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, close]);

  if (!data) return null;

  return (
    <>
      <div className="offer-overlay" onClick={close} aria-hidden="true" />
      <div
        ref={dialogRef}
        className="offer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="offer-dialog-head">
          <h2 id={titleId}>{t('addedTitle')}</h2>
          <button
            type="button"
            className="offer-dialog-close"
            aria-label={t('close')}
            onClick={close}
          >
            <CloseIcon />
          </button>
        </header>
        <p className="offer-dialog-lede">{t('addedLede')}</p>
        <SuggestionList items={data.items} locale={locale} licenceNumber={data.licenceNumber} />
        <footer className="offer-dialog-foot">
          <button type="button" className="btn btn-ghost" onClick={close}>
            {t('keepShopping')}
          </button>
          <Link href={`${prefix}${ROUTES.cart}`} className="btn btn-primary" onClick={close}>
            {t('viewCart')}
          </Link>
        </footer>
      </div>
    </>
  );
}
