import { createTranslator, type Messages, type NamespaceKeys, type NestedKeyOf } from 'next-intl';

import ar from '../../messages/ar.json';
import en from '../../messages/en.json';

import { formats } from './formats';
import { resolveLocale } from './locale';

const MESSAGES = { ar, en } as const;

/**
 * A translator that needs no request: for the synchronous helpers in
 * `lib/seo.ts`, which build metadata strings in the middle of a template
 * literal and cannot await `getTranslations`.
 *
 * Server code only. It imports both message files whole, which costs nothing
 * on the server and would be the entire catalogue of copy in a client bundle.
 */
export function translatorFor<N extends NamespaceKeys<Messages, NestedKeyOf<Messages>>>(
  locale: string,
  namespace: N,
) {
  const resolved = resolveLocale(locale);
  return createTranslator({ locale: resolved, messages: MESSAGES[resolved], namespace, formats });
}
