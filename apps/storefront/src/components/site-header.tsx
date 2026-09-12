'use client';

import { ROUTES } from '@da/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { BRAND } from '@da/ui';

import { CART_EVENT, type CartEventDetail, cartApi } from '../lib/cart-client';

import { SearchBox } from './search-box';

/**
 * Site header.
 *
 * The cart count is fetched in the browser rather than rendered on the server,
 * because the cart lives behind an httpOnly cookie the API holds — server
 * rendering it would either need the cookie forwarded on every page or make
 * every page uncacheable. This way the header is static and the one number
 * that differs per visitor arrives on its own.
 *
 * It refetches on navigation so adding to the cart on a product page is
 * reflected without a full reload.
 */
export function SiteHeader({ locale }: { locale: string }) {
  const ar = locale === 'ar';
  const prefix = ar ? '' : `/${locale}`;
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cart = await cartApi.get({ locale });
        if (!cancelled) setCount(cart.itemCount);
      } catch {
        // A header that cannot reach the cart shows no badge. It must not show
        // an error: nothing on the page depends on the number.
        if (!cancelled) setCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale, pathname]);

  // Any cart mutation announces itself, because this component is a sibling of
  // the page rather than an ancestor: props cannot reach it and refreshing the
  // server components does not re-run this effect.
  useEffect(() => {
    const onChange = (event: Event): void => {
      const detail = (event as CustomEvent<CartEventDetail>).detail;
      setCount(detail.cart.itemCount);
    };
    window.addEventListener(CART_EVENT, onChange);
    return () => window.removeEventListener(CART_EVENT, onChange);
  }, []);

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href={`${prefix}${ROUTES.home}`} className="logo">
          {ar ? BRAND.nameAr : BRAND.nameEn}
        </Link>

        {/* Between the name and the navigation, which is where a shopper
            looks for it. Until this existed the only way to find a product was
            to page through the store or to already know a category name. */}
        <SearchBox locale={locale} />

        <nav className="site-nav">
          <Link href={`${prefix}${ROUTES.store}`}>{ar ? 'المتجر' : 'Store'}</Link>
          <Link href={`${prefix}${ROUTES.goldenWarranty}`}>
            {ar ? 'الضمان الذهبي' : 'Golden Warranty'}
          </Link>
          {/* Named for what it holds, not for an account system: there is no
              account to manage, only the licences somebody already bought. */}
          <Link href={`${prefix}${ROUTES.licenses}`}>{ar ? 'تراخيصي' : 'My licences'}</Link>
          <Link href={`${prefix}${ROUTES.contact}`}>{ar ? 'تواصل معنا' : 'Contact'}</Link>
          <Link href={ar ? '/en' : '/'} className="lang" hrefLang={ar ? 'en' : 'ar'}>
            {ar ? 'English' : 'العربية'}
          </Link>
          <Link href={`${prefix}${ROUTES.cart}`} className="cart-link">
            {ar ? 'السلة' : 'Cart'}
            {count !== null && count > 0 ? <span className="cart-count">{count}</span> : null}
          </Link>
        </nav>
      </div>
    </header>
  );
}
