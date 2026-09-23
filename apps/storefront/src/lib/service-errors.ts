import { resolveLocale } from '../i18n/locale';
import type { AppRoutingLocale } from '../i18n/routing';

/**
 * The two things the browser clients say when the API gives them nothing to
 * say: it did not answer usefully, or it answered in a shape we do not know.
 *
 * Every caller shows `error.message` as it is, so this is the last place the
 * language can be chosen — and it used to be Arabic, on the English site too.
 *
 * A map here rather than keys in `messages/*.json`: these modules are not
 * React and cannot call `useTranslations`, and importing a message file into
 * browser code ships every string on the site to every visitor. The `Record`
 * over the routing locales makes a missing language a type error, which is the
 * guarantee `request.ts` gives the message files.
 */
const MESSAGES: Record<AppRoutingLocale, Record<ServiceErrorKind, string>> = {
  ar: {
    unreachable: 'تعذّر الاتصال بالخدمة.',
    unexpected: 'استجابة غير متوقّعة من الخدمة.',
  },
  en: {
    unreachable: 'We could not reach the service.',
    unexpected: 'The service sent a response we did not expect.',
  },
};

export type ServiceErrorKind = 'unreachable' | 'unexpected';

/**
 * The fallback message in the page's language.
 *
 * Without a locale it reads `<html lang>`, which the locale layout sets on the
 * server — the account client's calls carry no locale of their own, and the
 * document already knows which language it is in.
 */
export function serviceErrorMessage(kind: ServiceErrorKind, locale?: string): string {
  const lang =
    locale ?? (typeof document === 'undefined' ? undefined : document.documentElement.lang);
  return MESSAGES[resolveLocale(lang)][kind];
}
