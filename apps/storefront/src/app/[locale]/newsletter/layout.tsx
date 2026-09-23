import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * The confirmation and unsubscribe pages. Reached only from an email, carrying
 * a token in the URL, so never indexed and never followed.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === 'ar' ? 'النشرة البريدية' : 'Newsletter',
    robots: { index: false, follow: false },
  };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
