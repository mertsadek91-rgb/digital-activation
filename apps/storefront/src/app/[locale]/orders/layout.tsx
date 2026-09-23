import type { Metadata } from 'next';
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
  return {
    title: locale === 'ar' ? 'طلبك' : 'Your order',
    robots: { index: false, follow: false },
  };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
