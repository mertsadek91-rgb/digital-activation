import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { alternates } from '@da/seo';

import { robotsMeta } from '../../lib/seo';
import { DIRECTION } from '@da/ui';

import { SiteFooter } from '../../components/site-footer';
import { SiteHeader } from '../../components/site-header';
import { WhatsAppButton } from '../../components/whatsapp-button';
import { getCollections } from '../../lib/api';
import { routing } from '../../i18n/routing';

import '../globals.css';

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
  const links = alternates(SITE_URL, '/');

  return {
    metadataBase: new URL(SITE_URL),
    // Derived, not configured: noindex on anything that is not the production
    // apex. While the rebuild sits on new.digital-activation.com and the legacy
    // site holds the apex, letting both into the index would set them competing
    // over the same content.
    robots: robotsMeta(process.env.NEXT_PUBLIC_SITE_URL),
    // Reciprocal hreflang on every page, including x-default -> Arabic.
    // The legacy site emitted none at all while English demand went unanswered.
    alternates: {
      canonical: links.find((link) => link.hrefLang === locale)?.href,
      languages: Object.fromEntries(links.map((link) => [link.hrefLang, link.href])),
    },
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

  // Fetched once here and handed to both the menu and the footer. Two fetches
  // for the same list on every page would be two cache entries that can
  // disagree about which categories exist.
  const collections = (await getCollections({ locale, revalidate: 900 })) ?? [];

  return (
    <html lang={locale} dir={DIRECTION[locale]}>
      <body>
        <NextIntlClientProvider>
          <SiteHeader locale={locale} collections={collections} />
          {children}
          <SiteFooter locale={locale} collections={collections} />
          <WhatsAppButton locale={locale} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
