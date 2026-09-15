'use client';

import { ROUTES } from '@da/contracts';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { BRAND } from '@da/ui';

import { CART_EVENT, type CartEventDetail, cartApi } from '../lib/cart-client';

import {
  CartIcon,
  CategoryMark,
  ChevronIcon,
  CloseIcon,
  MailIcon,
  MenuIcon,
  SupportIcon,
  UserIcon,
} from './icons';
import { SearchBox } from './search-box';

/**
 * Site header, in two tiers with responsive drawer for mobile/tablet.
 *
 * Shaped after the store this replaces: 69.6% of impressions land on the home
 * page. A returning customer recognizes where things are.
 *
 * For mobile (< 1120px), an offcanvas drawer provides quick, thumb-friendly
 * access to categories, pages, customer license keys, WhatsApp support,
 * and language toggle, keeping the top header clean and uncluttered.
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cart = await cartApi.get({ locale });
        if (!cancelled) setCount(cart.itemCount);
      } catch {
        if (!cancelled) setCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale, pathname]);

  // Listen to cart events
  useEffect(() => {
    const onChange = (event: Event): void => {
      const detail = (event as CustomEvent<CartEventDetail>).detail;
      setCount(detail.cart.itemCount);
    };
    window.addEventListener(CART_EVENT, onChange);
    return () => window.removeEventListener(CART_EVENT, onChange);
  }, []);

  // Navigating closes menu and drawer
  useEffect(() => {
    setMenuOpen(false);
    setDrawerOpen(false);
  }, [pathname]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  // Escape key closes menus
  useEffect(() => {
    if (!menuOpen && !drawerOpen) return;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setDrawerOpen(false);
      }
    };
    const onClick = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [menuOpen, drawerOpen]);

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
        <button
          type="button"
          className="mobile-menu-btn"
          aria-label={ar ? 'فتح القائمة' : 'Open menu'}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <MenuIcon />
        </button>

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

        <div className="header-search-wrap">
          <SearchBox locale={locale} />
        </div>

        <Link href={`${prefix}${ROUTES.cart}`} className="cart-link" aria-label={ar ? 'السلة' : 'Cart'}>
          <CartIcon />
          <span className="cart-label">{ar ? 'السلة' : 'Cart'}</span>
          {count !== null && count > 0 ? <span className="cart-count">{count}</span> : null}
        </Link>
      </div>

      {/* Mobile Navigation Drawer & Backdrop with Framer Motion */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="drawer-overlay is-open"
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />
            <motion.aside
              initial={{ x: ar ? '100%' : '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: ar ? '100%' : '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="drawer-panel is-open motion-controlled"
              aria-label={ar ? 'قائمة التنقل' : 'Navigation Menu'}
            >
              <div className="drawer-head">
                <Link
                  href={`${prefix}${ROUTES.home}`}
                  className="logo"
                  onClick={() => setDrawerOpen(false)}
                >
                  {ar ? BRAND.nameAr : BRAND.nameEn}
                </Link>
                <button
                  type="button"
                  className="drawer-close"
                  aria-label={ar ? 'إغلاق القائمة' : 'Close menu'}
                  onClick={() => setDrawerOpen(false)}
                >
                  <CloseIcon />
                </button>
              </div>

              <div className="drawer-search">
                <SearchBox locale={locale} />
              </div>

              <div className="drawer-body">
                <nav className="drawer-section">
                  <span className="drawer-section-title">{ar ? 'التنقل السريع' : 'Navigation'}</span>
                  <Link
                    href={`${prefix}${ROUTES.home}`}
                    className="drawer-link"
                    onClick={() => setDrawerOpen(false)}
                  >
                    {ar ? 'الرئيسية' : 'Home'}
                  </Link>
                  <Link
                    href={`${prefix}${ROUTES.store}`}
                    className="drawer-link"
                    onClick={() => setDrawerOpen(false)}
                  >
                    {ar ? 'المتجر الإلكتروني' : 'Store Catalog'}
                  </Link>
                  <Link
                    href={`${prefix}${ROUTES.goldenWarranty}`}
                    className="drawer-link drawer-link-gold"
                    onClick={() => setDrawerOpen(false)}
                  >
                    <span>{ar ? 'الضمان الذهبي' : 'Golden Warranty'}</span>
                    <span className="gold-pill">100%</span>
                  </Link>
                  <Link
                    href={`${prefix}${ROUTES.blog}`}
                    className="drawer-link"
                    onClick={() => setDrawerOpen(false)}
                  >
                    {ar ? 'المدونة والشروحات' : 'Blog'}
                  </Link>
                  <Link
                    href={`${prefix}${ROUTES.contact}`}
                    className="drawer-link"
                    onClick={() => setDrawerOpen(false)}
                  >
                    {ar ? 'تواصل معنا' : 'Contact Us'}
                  </Link>
                </nav>

                {collections.length > 0 ? (
                  <div className="drawer-section">
                    <span className="drawer-section-title">{ar ? 'التصنيفات' : 'Categories'}</span>
                    <ul className="drawer-cat-list">
                      {collections.map((collection) => (
                        <li key={collection.slug}>
                          <Link
                            href={`${prefix}${ROUTES.collection(collection.slug)}`}
                            className="drawer-cat-link"
                            onClick={() => setDrawerOpen(false)}
                          >
                            <CategoryMark slug={collection.slug} />
                            <span className="drawer-cat-name">{collection.name}</span>
                            {collection.productCount > 0 ? (
                              <span className="drawer-cat-count">{collection.productCount}</span>
                            ) : null}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="drawer-section drawer-account">
                  <span className="drawer-section-title">{ar ? 'حسابك وتواصلك' : 'Account & Help'}</span>
                  <Link
                    href={`${prefix}${ROUTES.licenses}`}
                    className="drawer-link"
                    onClick={() => setDrawerOpen(false)}
                  >
                    <UserIcon />
                    <span>{ar ? 'تراخيصي ومشترياتي' : 'My Licences & Orders'}</span>
                  </Link>
                  <a
                    href={`https://wa.me/${WHATSAPP_DIAL}`}
                    className="drawer-link drawer-link-wa"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <SupportIcon />
                    <span dir="ltr">{WHATSAPP_SHOWN}</span>
                  </a>
                  <a href={`mailto:${SUPPORT_EMAIL}`} className="drawer-link">
                    <MailIcon />
                    <span dir="ltr">{SUPPORT_EMAIL}</span>
                  </a>
                  <Link
                    href={ar ? '/en' : '/'}
                    className="drawer-link drawer-lang"
                    hrefLang={ar ? 'en' : 'ar'}
                    lang={ar ? 'en' : 'ar'}
                    onClick={() => setDrawerOpen(false)}
                  >
                    🌐 {ar ? 'Switch to English' : 'التحويل إلى العربية'}
                  </Link>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </header>
  );
}
