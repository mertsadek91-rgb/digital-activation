'use client';

import { useMemo } from 'react';

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

export function CountrySelect({
  locale,
  value,
  onChange,
}: {
  locale: string;
  value: string;
  onChange: (code: string) => void;
}) {
  const ar = locale !== 'en';
  const names = useMemo(() => new Intl.DisplayNames([ar ? 'ar' : 'en'], { type: 'region' }), [ar]);
  const label = (code: string) => names.of(code) ?? code;
  const rest = useMemo(
    () =>
      [...REST].sort((a, b) =>
        (names.of(a) ?? a).localeCompare(names.of(b) ?? b, ar ? 'ar' : 'en'),
      ),
    [names, ar],
  );

  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} autoComplete="country">
      <option value="">{ar ? '— اختر —' : '— Choose —'}</option>
      <optgroup label={ar ? 'الأكثر طلباً' : 'Most common'}>
        {FIRST.map((code) => (
          <option key={code} value={code}>
            {label(code)}
          </option>
        ))}
      </optgroup>
      <optgroup label={ar ? 'دول أخرى' : 'Other countries'}>
        {rest.map((code) => (
          <option key={code} value={code}>
            {label(code)}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
