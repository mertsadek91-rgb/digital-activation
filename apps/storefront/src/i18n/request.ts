import { getRequestConfig } from 'next-intl/server';

import type ar from '../../messages/ar.json';
import type en from '../../messages/en.json';

import { formats } from './formats';
import { resolveLocale } from './locale';
import type { routing } from './routing';

/**
 * `messages/ar.json` is the source of truth for the message shape and `en.json`
 * is checked against it, so a missing English key is a type error rather than a
 * string that silently renders in Arabic on the English site.
 *
 * The check runs both ways. A key only English has is a string the Arabic
 * site — the default, and most of the traffic — would render as its key path.
 * When the two drift, the error names the keys: hover `parity`.
 */
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

type Parity =
  [Exclude<Leaves<typeof ar>, Leaves<typeof en>>, Exclude<Leaves<typeof en>, Leaves<typeof ar>>] extends [
    never,
    never,
  ]
    ? true
    : {
        missingInEn: Exclude<Leaves<typeof ar>, Leaves<typeof en>>;
        missingInAr: Exclude<Leaves<typeof en>, Leaves<typeof ar>>;
      };

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- a compile-time assertion
const parity: Parity = true;

const loaders = {
  ar: () => import('../../messages/ar.json'),
  en: () => import('../../messages/en.json'),
} satisfies Record<(typeof routing.locales)[number], () => Promise<{ default: typeof ar }>>;

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = resolveLocale(await requestLocale);

  const { default: messages } = await loaders[locale]();

  return { locale, messages, formats };
});

declare module 'next-intl' {
  interface AppConfig {
    Messages: typeof ar;
    Formats: typeof formats;
  }
}
