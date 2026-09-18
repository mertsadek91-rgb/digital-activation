'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import {
  ADMIN_LOCALES,
  ADMIN_LOCALE_COOKIE,
  ADMIN_LOCALE_COOKIE_MAX_AGE,
  ADMIN_LOCALE_LABEL,
  type AdminLocale,
} from './locale';
import { useAdminLocale, useT } from './provider';

/**
 * The language switch.
 *
 * Writes the cookie and asks the server for the tree again, rather than only
 * flipping a context value: `lang` and `dir` live on `<html>`, which this
 * component is not inside, and a panel whose text turns English while the
 * layout stays right-to-left is worse than one that stays Arabic.
 *
 * `router.refresh()` keeps the current path, so switching language does not
 * lose the screen somebody was working — and the session cookies, which are
 * on a different name entirely, are untouched.
 */
export function LocaleSwitcher() {
  const router = useRouter();
  const active = useAdminLocale();
  const t = useT('nav');
  const [pending, startTransition] = useTransition();

  function choose(locale: AdminLocale): void {
    if (locale === active) return;

    // `SameSite=Lax` rather than the session's `Strict`: nothing here is worth
    // protecting from a cross-site read, and Lax means arriving from an
    // external link still lands in the language the person chose.
    document.cookie = [
      `${ADMIN_LOCALE_COOKIE}=${locale}`,
      'path=/',
      `max-age=${String(ADMIN_LOCALE_COOKIE_MAX_AGE)}`,
      'SameSite=Lax',
    ].join('; ');

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="locale-switch admin-locale-switch" role="group" aria-label={t('languageLabel')}>
      {ADMIN_LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          className={`chip${active === locale ? ' is-active' : ''}`}
          aria-pressed={active === locale}
          disabled={pending}
          // Each language names itself, so somebody who cannot read the panel
          // they are looking at can still find the one they can.
          lang={locale}
          onClick={() => choose(locale)}
        >
          {ADMIN_LOCALE_LABEL[locale]}
        </button>
      ))}
    </div>
  );
}
