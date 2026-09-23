import type { Metadata } from 'next';
import type { ReactNode } from 'react';

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
  return {
    title: locale === 'ar' ? 'إتمام الشراء' : 'Checkout',
    robots: { index: false, follow: false },
  };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
