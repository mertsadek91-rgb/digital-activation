'use client';

import { ROUTES } from '@da/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { isArabic } from '../i18n/locale';
import { CART_EVENT, type CartEventDetail, cartApi } from '../lib/cart-client';

import { CartIcon, GridIcon, HomeIcon, SearchIcon, UserIcon } from './icons';

/**
 * The kit's `bottom-nav`: five destinations in a bar fixed to the bottom of
 * the phone screen, the current one in brand (TASK-0105). Hidden from 48rem
 * up, where the header's own rows do the job.
 *
 * The kit's fourth slot is "favourites"; this store has no favourites, so the
 * slot goes to the cart — the one page a phone shopper reaches for most —
 * with the same count badge the header carries.
 */
export function BottomNav({ locale }: { locale: string }) {
  const t = useTranslations('bottomNav');
  const pathname = usePathname();
  const prefix = isArabic(locale) ? '' : `/${locale}`;
  const home = `${prefix}/`;

  // The header counts the cart the same way; this is a second, cheap read
  // because the two live in different subtrees and share no state.
  const [count, setCount] = useState<number | null>(null);
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
    const onChange = (event: Event) => {
      const { detail } = event as CustomEvent<CartEventDetail>;
      setCount(detail.cart.itemCount);
    };
    window.addEventListener(CART_EVENT, onChange);
    return () => window.removeEventListener(CART_EVENT, onChange);
  }, []);

  const entries = [
    { href: home, label: t('home'), icon: <HomeIcon />, exact: true },
    { href: `${prefix}${ROUTES.store}`, label: t('categories'), icon: <GridIcon size={22} /> },
    { href: `${prefix}${ROUTES.search}`, label: t('search'), icon: <SearchIcon size={22} /> },
    { href: `${prefix}${ROUTES.cart}`, label: t('cart'), icon: <CartIcon />, badge: count },
    {
      href: `${prefix}${ROUTES.licenses}`,
      label: t('account'),
      icon: <UserIcon />,
      section: `${prefix}${ROUTES.account}`,
    },
  ];

  return (
    <nav className="bottom-nav" aria-label={t('label')}>
      {entries.map((entry) => {
        const section = entry.section ?? entry.href;
        const current = entry.exact
          ? pathname === entry.href || pathname === entry.href.replace(/\/$/, '')
          : pathname === section || pathname.startsWith(`${section}/`);
        return (
          <Link key={entry.href} href={entry.href} aria-current={current ? 'page' : undefined}>
            <span className="bottom-nav-icon" aria-hidden="true">
              {entry.icon}
              {entry.badge !== undefined && entry.badge !== null && entry.badge > 0 ? (
                <span className="bottom-nav-count">{entry.badge}</span>
              ) : null}
            </span>
            <span>{entry.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
