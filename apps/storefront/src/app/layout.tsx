import type { ReactNode } from 'react';

/**
 * A pass-through, and deliberately nothing more.
 *
 * The real document — `<html lang dir>`, the header, the fonts — is built by
 * `[locale]/layout.tsx`, because the language decides all of it. This file
 * exists only so that `app/not-found.tsx` has a root layout to sit in: Next
 * refuses to build a custom root 404 without one, and that 404 is what answers
 * a URL whose first segment is not a locale at all (`/wp-login.php`,
 * `/xmlrpc.php`), which the locale layout rejects before it renders anything.
 *
 * This is the arrangement next-intl documents for a `[locale]` root.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
