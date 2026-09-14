'use client';

import { ROUTES } from '@da/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { BRAND } from '@da/ui';

import { CART_EVENT, type CartEventDetail, cartApi } from '../lib/cart-client';

import {
  CartIcon,
  CategoryMark,
  ChevronIcon,
  MailIcon,
  MenuIcon,
  SupportIcon,
  UserIcon,
} from './icons';
import { SearchBox } from './search-box';

/**
 * Site header, in two tiers.
 *
 * Shaped after the store this replaces, deliberately: 69.6% of the old site's
 * impressions land on its home page, and the people arriving are the same
 * people. A returning customer should recognise where things are — the contact
 * details along the top, the product menu opening from a button beside the
 * name, search in the middle, the cart on the far side.
 *
 * What is *not* carried over is the weight. The old header needed a theme, a
 * mega-menu plugin and a pile of icon images; this one is markup, one inline
 * SVG set and a single boolean of state.
 *
 * The cart count is still fetched in the browser rather than rendered on the
 * server, because the cart lives behind an httpOnly cookie the API holds —
 * server rendering it would either need that cookie forwarded on every request
 * or make every page uncacheable.
 */
export interface HeaderCollection {
  slug: string;
  name: string;
  productCount: number;
}

const WHATSAPP_DIAL = '966534255367';
const WHATSAPP_SHOWN = '+966 53 425 5367';
const SUPPORT_EMAIL = 'help@digital-activation.com';

export function SiteHeader({
  locale,
  collections = [],
}: {
  locale: string;
  collections?: HeaderCollection[];
}) {
  const ar = locale === 'ar';
  const prefix = ar ? '' : `/${locale}`;
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Navigating closes the menu. Without this it stays open over the page it
  // just took you to, which reads as a broken link.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Escape and a click outside, because a panel that can only be closed by the
  // control that opened it is a trap for anybody who opened it by accident.
  useEffect(() => {
    if (!menuOpen) return;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const onClick = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [menuOpen]);

  return (
    <header className="site-header">
      {/* Tier one: how to reach a person, and who you are. Quiet by design —
          it is reference, not navigation. */}
      <div className="header-utility">
        <div className="header-utility-inner">
          <div className="utility-group">
            <Link href={`${prefix}${ROUTES.licenses}`} className="utility-link">
              <UserIcon />
              <span>{ar ? 'تراخيصي' : 'My licences'}</span>
            </Link>
            <Link
              href={ar ? '/en' : '/'}
              className="utility-link"
              hrefLang={ar ? 'en' : 'ar'}
              lang={ar ? 'en' : 'ar'}
            >
              {ar ? 'English' : 'العربية'}
            </Link>
          </div>

          <div className="utility-group">
            <a className="utility-link" href={`mailto:${SUPPORT_EMAIL}`}>
              <MailIcon />
              <span dir="ltr">{SUPPORT_EMAIL}</span>
            </a>
            <a
              className="utility-link"
              href={`https://wa.me/${WHATSAPP_DIAL}`}
              rel="noopener noreferrer"
            >
              <SupportIcon />
              <span dir="ltr">{WHATSAPP_SHOWN}</span>
            </a>
          </div>
        </div>
      </div>

      {/* Tier two: the shop itself. */}
      <div className="site-header-inner">
        <Link href={`${prefix}${ROUTES.home}`} className="logo">
          {ar ? BRAND.nameAr : BRAND.nameEn}
        </Link>

        {collections.length > 0 ? (
          <div className="mega" ref={menuRef}>
            <button
              type="button"
              className={`mega-button${menuOpen ? ' is-open' : ''}`}
              aria-expanded={menuOpen}
              aria-controls="mega-panel"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <MenuIcon />
              <span>{ar ? 'جميع المنتجات' : 'All products'}</span>
              <ChevronIcon />
            </button>

            {/* Rendered only when open rather than hidden with CSS: it holds
                sixteen links, and sixteen links a keyboard can reach on every
                page is sixteen stops before the page's own content. */}
            {menuOpen ? (
              <div className="mega-panel" id="mega-panel">
                <ul>
                  {collections.map((collection) => (
                    <li key={collection.slug}>
                      <Link href={`${prefix}${ROUTES.collection(collection.slug)}`}>
                        <CategoryMark slug={collection.slug} />
                        <span className="mega-name">{collection.name}</span>
                        {collection.productCount > 0 ? (
                          <span className="mega-count">{collection.productCount}</span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link className="mega-all" href={`${prefix}${ROUTES.store}`}>
                  {ar ? 'تصفّح المتجر كاملاً' : 'Browse the whole store'}
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}

        <nav className="site-nav">
          <Link href={`${prefix}${ROUTES.store}`}>{ar ? 'المتجر' : 'Store'}</Link>
          <Link href={`${prefix}${ROUTES.goldenWarranty}`}>
            {ar ? 'الضمان الذهبي' : 'Golden Warranty'}
          </Link>
          <Link href={`${prefix}${ROUTES.contact}`}>{ar ? 'تواصل معنا' : 'Contact'}</Link>
        </nav>

        <SearchBox locale={locale} />

        <Link href={`${prefix}${ROUTES.cart}`} className="cart-link">
          <CartIcon />
          <span>{ar ? 'السلة' : 'Cart'}</span>
          {count !== null && count > 0 ? <span className="cart-count">{count}</span> : null}
        </Link>
      </div>
    </header>
  );
}
