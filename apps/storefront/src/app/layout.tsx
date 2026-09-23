import { connection } from 'next/server';
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
 *
 * `connection()` is the one thing it adds: every page renders per request. The
 * CSP in `src/proxy.ts` admits only scripts carrying that request's nonce, and
 * Next can only stamp a nonce on a page it is rendering now — a page prerendered
 * at build time has none, and its scripts would be refused. Most pages already
 * rendered per request because they read the currency cookie; this makes it
 * true of the rest (the 404s among them) rather than true by accident.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return children;
}
