import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Never indexed. The account area is licence keys and order history, and
 * robots.txt keeping crawlers out is not enough on its own: a disallowed URL
 * that is linked from elsewhere can still be listed, and only a `noindex` the
 * crawler can read prevents that.
 *
 * The pages below are client components, so the title is set here — one for
 * the whole area, which is also what shows in the tab.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === 'ar' ? 'حسابي' : 'My account',
    robots: { index: false, follow: false },
  };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
