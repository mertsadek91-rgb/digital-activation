'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { type AdminLocale, DEFAULT_ADMIN_LOCALE } from './locale';
import { messages, type AdminMessages } from './messages';

/**
 * The panel's translator.
 *
 * Deliberately not next-intl, which the storefront uses: that library is built
 * around the locale being in the URL, and this panel keeps its locale in a
 * cookie so a staff member's bookmarks and the links they paste to each other
 * stay the one set of paths everybody already knows. What is left after that
 * is a dictionary lookup and a placeholder substitution, which is this file.
 *
 * Messages are namespaced by screen. `useT('queue')` hands back a `t` bound to
 * that screen, so a key collision between two screens is impossible and the
 * call sites stay short enough to read inside JSX.
 */

const LocaleContext = createContext<AdminLocale>(DEFAULT_ADMIN_LOCALE);

export function AdminI18nProvider({
  locale,
  children,
}: {
  locale: AdminLocale;
  children: ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useAdminLocale(): AdminLocale {
  return useContext(LocaleContext);
}

type Namespace = keyof AdminMessages;

/** Values a message can interpolate. Numbers are formatted by the caller when it matters. */
export type MessageParams = Record<string, string | number>;

type PluralSuffix = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/**
 * The base names of the plural sets in a namespace.
 *
 * `waitHours_one` / `waitHours_other` in the dictionary become the single key
 * `waitHours` here, so a call site cannot pick a plural form by hand — which
 * is what the hand-written `hours === 1 ? 'ساعة' : 'ساعات'` checks on the queue
 * and inbox screens were doing. Arabic has six plural categories and that
 * check covers two of them, so "2 hours" read as "2 ساعات" where Arabic wants
 * the dual.
 */
type PluralBase<K> = K extends `${infer Base}_${PluralSuffix}` ? Base : never;

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

export function useT<N extends Namespace>(namespace: N) {
  const locale = useAdminLocale();

  return useMemo(() => {
    const dictionary = messages[locale][namespace] as Record<string, string>;
    // The fallback dictionary, consulted only when a key is missing from the
    // active one. That cannot happen while `en` is typed against `ar`, but a
    // blank label is a worse failure than a label in the wrong language.
    const fallback = messages[DEFAULT_ADMIN_LOCALE][namespace] as Record<string, string>;

    const t = (key: keyof AdminMessages[N], params?: MessageParams): string => {
      const name = key as string;
      return interpolate(dictionary[name] ?? fallback[name] ?? name, params);
    };

    /**
     * The plural-aware sibling. `count` is interpolated as `{count}` too, so a
     * message reads `'{count} سطراً في الانتظار'` without the call site
     * passing the number twice.
     */
    const tp = (
      key: PluralBase<keyof AdminMessages[N] & string>,
      count: number,
      params?: MessageParams,
    ): string => {
      const category = new Intl.PluralRules(locale).select(count);
      const base = key as string;
      const candidates = [`${base}_${category}`, `${base}_other`];
      const template =
        candidates.map((name) => dictionary[name] ?? fallback[name]).find(Boolean) ?? base;
      return interpolate(template, { count, ...params });
    };

    return Object.assign(t, { tp, locale });
  }, [locale, namespace]);
}
