import { templateParam } from './rules.js';

/**
 * The variables each approved template takes, in order.
 *
 * The template text lives in WhatsApp Manager, not here (docs/deployment.md
 * has the exact wording to submit). What lives here is the promise the code
 * makes to that text: how many `{{n}}` there are and what goes in each. A
 * template approved with a different number of variables is refused by Meta
 * at send time (132000), so the sweeps and the admin test build their
 * parameters through these functions and nowhere else.
 */

function greeting(firstName: string | null, locale: 'ar' | 'en'): string {
  // Meta refuses an empty parameter, so "Hi {{1}}" needs somebody to greet.
  return templateParam(firstName ?? '', locale === 'ar' ? 'عميلنا' : 'there', 60);
}

/**
 * Cart recovery (Marketing): {{1}} first name, {{2}} what is in the cart.
 * The URL button carries the signed restore link.
 */
export function cartRecoveryParams(input: {
  locale: 'ar' | 'en';
  firstName: string | null;
  productNames: string[];
  total: string;
  offer: { percent: number; licenceNumber: string } | null;
}): string[] {
  const [first, ...rest] = input.productNames;
  const more =
    rest.length === 0
      ? ''
      : input.locale === 'ar'
        ? ` و${String(rest.length)} ${rest.length === 1 ? 'منتج آخر' : 'منتجات أخرى'}`
        : ` and ${String(rest.length)} more`;
  let summary = `${first ?? ''}${more} (${input.total})`;
  if (input.offer) {
    // The discount is applied by the restore link itself; the message says so,
    // with the Ministry of Commerce licence number beside it as the law wants.
    const licence = input.offer.licenceNumber
      ? input.locale === 'ar'
        ? ` — ترخيص التخفيض ${input.offer.licenceNumber}`
        : ` — discount licence ${input.offer.licenceNumber}`
      : '';
    summary +=
      input.locale === 'ar'
        ? `، مع خصم ${String(input.offer.percent)}٪ يُطبَّق عند فتح الرابط${licence}`
        : `, with ${String(input.offer.percent)}% off applied when you open the link${licence}`;
  }
  return [greeting(input.firstName, input.locale), templateParam(summary, '—', 500)];
}

/**
 * Renewal reminder (Utility): {{1}} first name, {{2}} the product, {{3}} when
 * it ends (or ended). No discount, ever: a Utility template carrying a promotion
 * is re-categorised as Marketing by Meta, and the renewal code stays an email
 * thing for customers with email marketing consent.
 */
export function renewalParams(input: {
  locale: 'ar' | 'en';
  firstName: string | null;
  productName: string;
  expiresOn: string;
  offsetDays: number;
}): string[] {
  const ended = input.offsetDays < 0;
  const when =
    input.locale === 'ar'
      ? `${ended ? 'انتهى في' : 'ينتهي في'} ${input.expiresOn}`
      : `${ended ? 'ended on' : 'ends on'} ${input.expiresOn}`;
  return [
    greeting(input.firstName, input.locale),
    templateParam(input.productName, '—', 200),
    templateParam(when, '—', 100),
  ];
}
