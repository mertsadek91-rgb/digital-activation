import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Never indexed, and not because it is secret.
 *
 * A cart page is different for every visitor and identical in structure, so it
 * has nothing to rank with and would only dilute the pages that do. The legacy
 * store left its cart and checkout crawlable and had 41 of them in the index.
 *
 * `nofollow` as well, matching the other private layouts: every link on this
 * page is one the crawler reaches from a page that is indexed anyway. The
 * title lives here because the page is a client component and cannot export
 * metadata of its own.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === 'ar' ? 'سلة الشراء' : 'Your cart',
    robots: { index: false, follow: false },
  };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
