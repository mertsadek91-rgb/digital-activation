'use client';

import { ROUTES } from '@da/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { BRAND } from '@da/ui';

import { isArabic } from '../i18n/locale';
import { Link as LocaleLink, usePathname as useLocalePathname } from '../i18n/navigation';
import { CART_EVENT, type CartEventDetail, cartApi } from '../lib/cart-client';
import { SUPPORT_EMAIL, WHATSAPP_SHOWN, whatsappLink } from '../lib/contact';

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
import { BrandLogo } from './brand-logo';
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

const DRAWER_ID = 'site-drawer';

export function SiteHeader({
  locale,
  collections = [],
}: {
  locale: string;
  collections?: HeaderCollection[];
}) {
  const t = useTranslations('header');
  const tc = useTranslations('common');
  const tk = useTranslations('catalog');
  const ar = isArabic(locale);
  const prefix = ar ? '' : `/${locale}`;
  const pathname = usePathname();
  // The same page without its locale prefix, for the language switch.
  const localePath = useLocalePathname();
  const [count, setCount] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  /**
   * The badge, fetched once and then kept current by the cart's own event.
   *
   * It used to refetch on every navigation, which is a request to the API per
   * page view to learn something nothing on the page had changed — every add,
   * remove and coupon already announces the new cart through `CART_EVENT`.
   */
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
  }, [locale]);

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

  /**
   * Focus follows the drawer: into its first link when it opens, back to the
   * button that opened it when it closes. Without this a keyboard or
   * screen-reader user opened a dialog and stayed on the button behind it.
   */
  useEffect(() => {
    if (drawerOpen) {
      wasOpen.current = true;
      drawerRef.current?.querySelector<HTMLElement>('.drawer-body a')?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      drawerButtonRef.current?.focus();
    }
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

  /**
   * The other language, on the same page.
   *
   * It linked to the other language's home page, so somebody reading a
   * product in Arabic who switched to English had to find the product again.
   * Every route here exists in both languages under the same path, so the
   * path is kept and only the prefix changes.
   *
   * Its label (`header.otherLanguage`, `header.switchLanguage`) is written in
   * the language it switches to, because that is the language of the reader
   * looking for it.
   */
  const otherLocale = ar ? 'en' : 'ar';

  return (
    <header className="site-header">
      {/* Tier one: how to reach a person, and who you are. Quiet by design —
          it is reference, not navigation. */}
      <div className="header-utility">
        <div className="header-utility-inner">
          <div className="utility-group">
            <Link href={`${prefix}${ROUTES.licenses}`} className="utility-link">
              <UserIcon />
              <span>{t('myLicences')}</span>
            </Link>
            <LocaleLink
              href={localePath}
              locale={otherLocale}
              className="utility-link"
              hrefLang={otherLocale}
              lang={otherLocale}
            >
              {t('otherLanguage')}
            </LocaleLink>
          </div>

          <div className="utility-group">
            <a className="utility-link" href={`mailto:${SUPPORT_EMAIL}`}>
              <MailIcon />
              <span dir="ltr">{SUPPORT_EMAIL}</span>
            </a>
            <a className="utility-link" href={whatsappLink()} rel="noopener noreferrer">
              <SupportIcon />
              <span dir="ltr">{WHATSAPP_SHOWN}</span>
            </a>
          </div>
        </div>
      </div>

      {/* Tier two: the shop itself. */}
      <div className="site-header-inner">
        <button
          ref={drawerButtonRef}
          type="button"
          className="mobile-menu-btn"
          aria-label={t('openMenu')}
          aria-expanded={drawerOpen}
          aria-controls={DRAWER_ID}
          onClick={() => setDrawerOpen(true)}
        >
          <MenuIcon />
        </button>

        <Link
          href={`${prefix}${ROUTES.home}`}
          className="logo"
          aria-label={ar ? BRAND.nameAr : BRAND.nameEn}
        >
          <BrandLogo locale={locale} width={100} priority />
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
              <span>{t('allProducts')}</span>
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
                  {t('browseAll')}
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}

        <nav className="site-nav">
          <Link href={`${prefix}${ROUTES.store}`}>{t('store')}</Link>
          <Link href={`${prefix}${ROUTES.goldenWarranty}`}>
            {tc('goldenWarranty')}
          </Link>
          <Link href={`${prefix}${ROUTES.contact}`}>{t('contact')}</Link>
        </nav>

        <div className="header-search-wrap">
          <SearchBox locale={locale} />
        </div>

        <Link
          href={`${prefix}${ROUTES.cart}`}
          className="cart-link"
          aria-label={t('cart')}
        >
          <CartIcon />
          <span className="cart-label">{t('cart')}</span>
          {count !== null && count > 0 ? <span className="cart-count">{count}</span> : null}
        </Link>
      </div>

      {/* The mobile drawer and its backdrop.
          Always in the document and moved by CSS transitions on `is-open`,
          rather than mounted and animated by a script: the slide is the same,
          and there is no animation library in the header's bundle for it.
          `inert` while closed keeps its links out of the tab order and away
          from assistive technology, which an off-screen transform alone does
          not. */}
      <div
        className={`drawer-overlay${drawerOpen ? ' is-open' : ''}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <aside
        ref={drawerRef}
        id={DRAWER_ID}
        className={`drawer-panel${drawerOpen ? ' is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('drawer')}
        inert={!drawerOpen}
      >
        <div className="drawer-head">
          <Link
            href={`${prefix}${ROUTES.home}`}
            className="logo"
            aria-label={ar ? BRAND.nameAr : BRAND.nameEn}
            onClick={() => setDrawerOpen(false)}
          >
            <BrandLogo locale={locale} width={100} />
          </Link>
          <button
            type="button"
            className="drawer-close"
            aria-label={t('closeMenu')}
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
            <span className="drawer-section-title">{t('quickNav')}</span>
            <Link
              href={`${prefix}${ROUTES.home}`}
              className="drawer-link"
              onClick={() => setDrawerOpen(false)}
            >
              {tc('home')}
            </Link>
            <Link
              href={`${prefix}${ROUTES.store}`}
              className="drawer-link"
              onClick={() => setDrawerOpen(false)}
            >
              {t('storeCatalog')}
            </Link>
            <Link
              href={`${prefix}${ROUTES.goldenWarranty}`}
              className="drawer-link drawer-link-gold"
              onClick={() => setDrawerOpen(false)}
            >
              <span>{tc('goldenWarranty')}</span>
              <span className="gold-pill">100%</span>
            </Link>
            <Link
              href={`${prefix}${ROUTES.blog}`}
              className="drawer-link"
              onClick={() => setDrawerOpen(false)}
            >
              {t('blog')}
            </Link>
            <Link
              href={`${prefix}${ROUTES.contact}`}
              className="drawer-link"
              onClick={() => setDrawerOpen(false)}
            >
              {t('contactUs')}
            </Link>
          </nav>

          {collections.length > 0 ? (
            <div className="drawer-section">
              <span className="drawer-section-title">{tk('categories')}</span>
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
            <span className="drawer-section-title">{t('accountHelp')}</span>
            <Link
              href={`${prefix}${ROUTES.licenses}`}
              className="drawer-link"
              onClick={() => setDrawerOpen(false)}
            >
              <UserIcon />
              <span>{t('licencesOrders')}</span>
            </Link>
            <a
              href={whatsappLink()}
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
            <LocaleLink
              href={localePath}
              locale={otherLocale}
              className="drawer-link drawer-lang"
              hrefLang={otherLocale}
              lang={otherLocale}
              onClick={() => setDrawerOpen(false)}
            >
              🌐 {t('switchLanguage')}
            </LocaleLink>
          </div>
        </div>
      </aside>
    </header>
  );
}
