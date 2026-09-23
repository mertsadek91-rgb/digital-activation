import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { MarketingProvider } from '../../../components/marketing-context';
import { getMarketingPublic } from '../../../lib/api';

/**
 * Never indexed, and not because it is secret.
 *
 * A checkout is different for every visitor and identical in structure, so it
 * has nothing to rank with and would only dilute the pages that do. The legacy
 * store left its cart and checkout crawlable and had 41 of them in the index.
 *
 * The title lives here because the page is a client component and cannot
 * export metadata of its own.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'checkout' });
  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

/**
 * The page is a client component, so the trust settings it shows beside the
 * pay buttons are read here, on the server, and handed down.
 */
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const marketing = await getMarketingPublic({ locale });
  return <MarketingProvider value={marketing}>{children}</MarketingProvider>;
}
