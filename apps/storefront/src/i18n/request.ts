import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';

import { routing } from './routing';

/**
 * `messages/ar.json` is the source of truth for the message shape and `en.json`
 * is checked against it, so a missing English key is a type error rather than a
 * string that silently renders in Arabic on the English site.
 */
const loaders = {
  ar: () => import('../../messages/ar.json'),
  en: () => import('../../messages/en.json'),
} satisfies Record<(typeof routing.locales)[number], () => Promise<unknown>>;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  const { default: messages } = await loaders[locale]();

  return {
    locale,
    messages,
    // Prices and dates render with Latin digits in both locales: that is how
    // Gulf e-commerce writes them, and mixing digit systems on one page reads
    // as a rendering fault.
    formats: {
      number: {
        price: { style: 'currency', currency: 'USD', numberingSystem: 'latn' },
      },
    },
  };
});
