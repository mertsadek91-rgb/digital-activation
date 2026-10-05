'use client';

import { offeredCurrenciesSchema } from '@da/contracts';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { browserCurrency, setBrowserCurrency } from '../lib/currency';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

let offered: Promise<string[]> | null = null;

/**
 * The currencies the API can price in, asked for once per page load. The
 * header's top bar and the drawer each hold a switcher, and each used to ask
 * on its own: the same answer twice, on every page.
 */
function offeredCurrencies(): Promise<string[]> {
  offered ??= fetch(new URL('/v1/catalog/currencies', API))
    .then((response) => (response.ok ? response.json() : null))
    .then((body: unknown) => {
      const parsed = offeredCurrenciesSchema.safeParse(body);
      return parsed.success ? parsed.data.currencies.map((entry) => entry.code) : [];
    })
    .catch(() => []);
  return offered;
}

/**
 * The currency picker.
 *
 * It lists only what the API says it can convert — USD and every currency
 * with a rate loaded — so it never offers a choice that would quietly render
 * in dollars. With nothing but USD it renders nothing: a picker with one
 * option is a control that does nothing.
 *
 * Changing it sets the cookie and reloads. Prices come from both sides here —
 * server components read the cookie, the cart and checkout fetch from the
 * browser — and a reload is the one step that brings every one of them into
 * the new currency at once. It is a rare action; being thorough beats being
 * clever.
 */
export function CurrencySwitcher({ className }: { className?: string }) {
  const t = useTranslations('header');
  const [codes, setCodes] = useState<string[]>([]);
  const [current, setCurrent] = useState('USD');

  useEffect(() => {
    setCurrent(browserCurrency());
    let cancelled = false;
    void offeredCurrencies().then((list) => {
      if (!cancelled) setCodes(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (codes.length < 2) return null;

  return (
    <label className={className}>
      <select
        value={codes.includes(current) ? current : 'USD'}
        onChange={(event) => {
          setBrowserCurrency(event.target.value);
          setCurrent(event.target.value);
          window.location.reload();
        }}
        aria-label={t('currencyLabel')}
        dir="ltr"
      >
        {codes.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
    </label>
  );
}
