import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Never indexed, and not because it is secret.
 *
 * A cart page is different for every visitor and identical in structure, so it
 * has nothing to rank with and would only dilute the pages that do. The legacy
 * store left its cart and checkout crawlable and had 41 of them in the index.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
