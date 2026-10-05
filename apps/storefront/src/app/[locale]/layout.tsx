import type { Metadata } from 'next';
import { Inter, Tajawal } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { buildGraph, jsonld } from '@da/seo';
import { BRAND, DIRECTION } from '@da/ui';

import { SUPPORT_EMAIL, SUPPORT_PHONE } from '../../lib/contact';
import { openGraphDefaults, robotsMeta } from '../../lib/seo';

import { GrowthLayer } from '../../components/growth-layer';
import { AddedDialog } from '../../components/added-dialog';
import { SiteFooter } from '../../components/site-footer';
import { SiteHeader } from '../../components/site-header';
import { WhatsAppButton } from '../../components/whatsapp-button';
import { getCollections } from '../../lib/api';
import { isArabic } from '../../i18n/locale';
import { routing } from '../../i18n/routing';

import '../globals.css';

/**
 * The store's typefaces, self-hosted by next/font at build time.
 *
 * Tajawal for Arabic (400 body, 500 labels, 700 headings, as the UI Kit
 * specifies, and nothing heavier: the 800 that a few headings asked for was
 * two more font files on every page, for a weight the kit never set). Inter
 * for English, and for prices, codes and addresses in both languages. The
 * CSS binds them in globals.css: `--font-sans` is Tajawal under
 * `html[lang=ar]` and Inter under `html[lang=en]`; `--font-latin` is always
 * Inter.
 */
const tajawal = Tajawal({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-tajawal',
});
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-inter',
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://digital-activation.com';

export function generateStaticParams(): { locale: string }[] {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  // `/wp-login.php` arrives here as the "locale" `wp-login.php`. It is about
  // to be a 404 from the root not-found, which carries its own head; claiming
  // an English share card for it first would be wrong.
  if (!hasLocale(routing.locales, locale)) return {};
  const brand = isArabic(locale) ? BRAND.nameAr : BRAND.nameEn;

  return {
    metadataBase: new URL(SITE_URL),
    // Every page names itself and the brand follows, so a tab, a share card
    // and a result all read "<page> | <store>" without each page spelling it.
    title: { default: brand, template: `%s | ${brand}` },
    // Derived, not configured: noindex on anything that is not the production
    // apex. While the rebuild sits on new.digital-activation.com and the legacy
    // site holds the apex, letting both into the index would set them competing
    // over the same content.
    robots: robotsMeta(process.env.NEXT_PUBLIC_SITE_URL),
    // No canonical or hreflang here. Set on the layout they were inherited by
    // every page that did not override them — the cart, the account, a 404 —
    // each of which then declared itself a duplicate of the home page. Each
    // page states its own, and a page that states none has none.
    //
    // Share-card defaults for the pages that set no card of their own.
    openGraph: openGraphDefaults(locale),
    twitter: { card: 'summary_large_image' },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Required for static rendering of a localised route.
  setRequestLocale(locale);

  // The shelves, handed to the menu and the footer from one fetch so the two
  // cannot disagree about which categories exist.
  const collectionList = await getCollections({ locale, revalidate: 900 });
  const collections = collectionList ?? [];

  // The store itself, on every page rather than only the home page. A product
  // names its seller as `#organization`, and that reference resolved to
  // nothing on the 68 product pages that are where it matters. A separate
  // script from the page's own graph: it holds no Product, ItemList or
  // Article, so the one-per-page rule `buildGraph` enforces is untouched.
  const brand = isArabic(locale) ? BRAND.nameAr : BRAND.nameEn;
  const siteGraph = buildGraph([
    jsonld.organization({
      name: brand,
      url: SITE_URL,
      logoUrl: new URL('/brand/logo.webp', SITE_URL).toString(),
      sameAs: [],
      email: SUPPORT_EMAIL,
      phone: SUPPORT_PHONE,
    }),
    jsonld.website({ url: SITE_URL, name: brand, locale }),
  ]);

  return (
    <html lang={locale} dir={DIRECTION[locale]} className={`${tajawal.variable} ${inter.variable}`}>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: siteGraph }} />
        <NextIntlClientProvider>
          <SiteHeader locale={locale} collections={collections} />
          {children}
          <SiteFooter locale={locale} collections={collections} />
          <WhatsAppButton />
          <GrowthLayer locale={locale} />
          <AddedDialog locale={locale} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
