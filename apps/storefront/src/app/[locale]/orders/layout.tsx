import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

/**
 * Never indexed. An order page holds somebody's email and what they bought;
 * `noindex, nofollow` here is about the customer, not about ranking.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'order' });
  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
