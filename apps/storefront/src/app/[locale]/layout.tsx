import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { alternates } from '@da/seo';
import { DIRECTION } from '@da/ui';

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

  return (
    <html lang={locale} dir={DIRECTION[locale]}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
