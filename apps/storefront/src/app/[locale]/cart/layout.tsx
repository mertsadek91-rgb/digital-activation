import { ROUTES } from '@da/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { isArabic } from '../../../i18n/locale';
import { recordEvent } from '../../../lib/api';

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
  const t = await getTranslations({ locale, namespace: 'cart' });
  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

/**
 * The cart page is a client component, and the cart API it calls is also what
 * the header's badge calls on every page, so neither can tell a cart view from
 * a page load. This server layout renders once per visit to the cart, which is
 * where the view is recorded (TASK-0096), fire and forget.
 */
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  recordEvent({
    type: 'CART_VIEW',
    path: isArabic(locale) ? ROUTES.cart : `/${locale}${ROUTES.cart}`,
    locale,
  });
  return children;
}
