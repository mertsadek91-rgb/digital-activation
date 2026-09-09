import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'لوحة إدارة التفعيل الرقمي',
  // The admin must never be indexed, and must never leak a referrer to a
  // third party — an admin URL can carry an order or customer id.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/** RTL Arabic first: this panel is used daily by an Arabic-speaking team. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
