import type { Metadata } from 'next';
import { Inter, Tajawal } from 'next/font/google';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import { AdminI18nProvider } from '../i18n/provider';
import { ADMIN_LOCALE_COOKIE, ADMIN_LOCALE_DIR, toAdminLocale } from '../i18n/locale';
import { messages } from '../i18n/messages';
import { ADMIN_THEME_COOKIE, toAdminTheme } from './theme';
import { AdminThemeProvider } from './theme-provider';

import './globals.css';

/**
 * The panel's typefaces, both self-hosted by next/font at build time (the
 * admin CSP allows `font-src 'self'` and nothing else).
 *
 * Tajawal is the Arabic face the storefront uses; without it the token's
 * literal 'Tajawal' matched nothing and staff read Arabic in whatever system
 * font their machine had (BUG-0011). Inter is the template's face and serves
 * the English panel. The stylesheet picks the pair per `lang`.
 */
const tajawal = Tajawal({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '700', '800'],
  display: 'swap',
  variable: '--font-tajawal',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-inter',
});

/**
 * The locale and theme for this request, from the cookies the switchers write.
 *
 * Read here rather than in the client so `lang`, `dir` and `data-theme` are
 * correct in the HTML that is served. Setting them from an effect after
 * hydration means the first paint of an English session is laid out
 * right-to-left and then flips — or a dark panel flashes white — which is the
 * kind of thing that looks like a broken panel rather than a loading one.
 */
async function currentPreferences() {
  const store = await cookies();
  return {
    locale: toAdminLocale(store.get(ADMIN_LOCALE_COOKIE)?.value),
    theme: toAdminTheme(store.get(ADMIN_THEME_COOKIE)?.value),
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await currentPreferences();

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
  const { locale, theme } = await currentPreferences();

  return (
    <html
      lang={locale}
      dir={ADMIN_LOCALE_DIR[locale]}
      data-theme={theme}
      className={`${tajawal.variable} ${inter.variable}`}
    >
      <body>
        <AdminThemeProvider theme={theme}>
          <AdminI18nProvider locale={locale}>{children}</AdminI18nProvider>
        </AdminThemeProvider>
      </body>
    </html>
  );
}
