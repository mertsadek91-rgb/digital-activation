import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import { AdminI18nProvider } from '../i18n/provider';
import { ADMIN_LOCALE_COOKIE, ADMIN_LOCALE_DIR, toAdminLocale } from '../i18n/locale';
import { messages } from '../i18n/messages';

import './globals.css';

/**
 * The locale for this request, from the cookie the switcher writes.
 *
 * Read here rather than in the client so `lang` and `dir` are correct in the
 * HTML that is served. Setting them from an effect after hydration means the
 * first paint of an English session is laid out right-to-left and then flips,
 * which is the kind of thing that looks like a broken panel rather than a
 * loading one.
 */
async function currentLocale() {
  const store = await cookies();
  return toAdminLocale(store.get(ADMIN_LOCALE_COOKIE)?.value);
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await currentLocale();

  return {
    title: messages[locale].nav.panelTitle,
    // The admin must never be indexed, and must never leak a referrer to a
    // third party — an admin URL can carry an order or customer id.
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

/**
 * Arabic first, English on request.
 *
 * The team that runs this shop daily reads Arabic and the default has not
 * moved: a staff member who never touches the switcher sees exactly the panel
 * they saw before. English is for the people who cannot use that one at all.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const locale = await currentLocale();

  return (
    <html lang={locale} dir={ADMIN_LOCALE_DIR[locale]}>
      <body>
        <AdminI18nProvider locale={locale}>{children}</AdminI18nProvider>
      </body>
    </html>
  );
}
