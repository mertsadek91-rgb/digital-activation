'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useSyncExternalStore } from 'react';

import { resolveLocale } from '../i18n/locale';

/**
 * Where most buyers are, first; then the rest of the list.
 *
 * The field used to be a free-text box with `maxLength={2}` and "AE" as its
 * placeholder, which asked a shopper to know their ISO code. A list names the
 * country in the page's language — `Intl.DisplayNames`, so there is no table
 * of translations to keep — and can only produce a valid code.
 */
const FIRST = ['SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'EG', 'JO', 'IQ', 'LB', 'MA', 'DZ', 'TN'];
const REST = [
  'AF',
  'AL',
  'AR',
  'AT',
  'AU',
  'AZ',
  'BD',
  'BE',
  'BR',
  'CA',
  'CH',
  'CN',
  'CY',
  'CZ',
  'DE',
  'DK',
  'ES',
  'FI',
  'FR',
  'GB',
  'GR',
  'HU',
  'ID',
  'IE',
  'IN',
  'IR',
  'IT',
  'JP',
  'KR',
  'KZ',
  'LY',
  'MR',
  'MY',
  'NG',
  'NL',
  'NO',
  'NZ',
  'PK',
  'PL',
  'PS',
  'PT',
  'RO',
  'RU',
  'SD',
  'SE',
  'SG',
  'SO',
  'SY',
  'TR',
  'UA',
  'US',
  'UZ',
  'YE',
  'ZA',
];

/**
 * Whether this render runs in a browser that has finished hydrating.
 *
 * The names and their order come from `Intl`, and `Intl` is not the same on
 * both sides: the server has Node's ICU, the browser its own, and the two
 * carry different CLDR releases. They collate Arabic differently, so option
 * *n* named one country on the server and another on the client, and they
 * name a few regions differently (Node calls PS the Palestinian Territories,
 * current browsers call it Palestine) — a hydration mismatch on every
 * /checkout load in dev (BUG-0022). So the server and the first client render
 * show the ISO codes in ISO-code order, which is the same everywhere, and the
 * browser's names and collation are applied once hydration is over. The
 * `<select>` is closed at that moment with the placeholder showing, so nobody
 * sees the swap, and without JavaScript the list is still a usable one.
 *
 * `useSyncExternalStore` with a server snapshot of `false` is React's own way
 * to ask this without an effect and a state flag.
 */
const noopSubscribe = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function CountrySelect({
  locale,
  value,
  onChange,
}: {
  locale: string;
  value: string;
  onChange: (code: string) => void;
}) {
  const t = useTranslations('countrySelect');
  const lang = resolveLocale(locale);
  const hydrated = useHydrated();
  const names = useMemo(
    () => (hydrated ? new Intl.DisplayNames([lang], { type: 'region' }) : null),
    [hydrated, lang],
  );
  const label = (code: string) => names?.of(code) ?? code;
  const rest = useMemo(() => {
    if (!names) return REST;
    const name = (code: string) => names.of(code) ?? code;
    return [...REST].sort((a, b) => name(a).localeCompare(name(b), lang));
  }, [names, lang]);

  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} autoComplete="country">
      <option value="">{t('choose')}</option>
      <optgroup label={t('common')}>
        {FIRST.map((code) => (
          <option key={code} value={code}>
            {label(code)}
          </option>
        ))}
      </optgroup>
      <optgroup label={t('other')}>
        {rest.map((code) => (
          <option key={code} value={code}>
            {label(code)}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
