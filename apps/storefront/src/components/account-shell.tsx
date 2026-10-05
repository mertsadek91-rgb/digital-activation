'use client';

import { ROUTES } from '@da/contracts/constants';
import { Link } from './link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';

import { isArabic } from '../i18n/locale';
import { accountApi } from '../lib/account-client';
import { publicMarketing } from '../lib/growth-client';

import { ClientBreadcrumbs } from './breadcrumbs-client';
import {
  CartIcon,
  GiftIcon,
  HeadsetIcon,
  HeartIcon,
  KeyIcon,
  LogoutIcon,
  StarIcon,
  UserIcon,
} from './icons';

/**
 * The customer's area, after the kit's account pages (TASK-0105): the page
 * band with the breadcrumb, then the menu as a card at the start side and
 * the page's own content beside it. On a phone the menu becomes a row of
 * chips above the content.
 *
 * The menu stays short rather than becoming a settings tree, because there is
 * no account to manage here: no password to change, and no saved address,
 * because every order in this store is a guest order identified by the
 * mailbox the licence was sent to.
 *
 * Licences and orders are separate entries because they answer different
 * questions. "Where is my key" is the licences page; "what did I buy, and
 * what did it cost" is the orders page, and an order never carries a key —
 * the key comes out one line at a time through the reveal that writes to the
 * vault's access log.
 */
export function AccountShell({
  locale,
  title,
  lede,
  email,
  children,
}: {
  locale: string;
  title: string;
  lede?: string;
  /** The signed-in address, when the page has it. */
  email?: string | null;
  children: ReactNode;
}) {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const prefix = isArabic(locale) ? '' : `/${locale}`;

  return (
    <>
      <div className="page-band">
        <div className="shell">
          <ClientBreadcrumbs
            items={[
              { name: tc('home'), href: `${prefix}/` },
              { name: t('metaTitle'), href: `${prefix}${ROUTES.licenses}` },
              { name: title, href: '#' },
            ]}
          />
          <header className="page-head">
            <h1>{title}</h1>
            {lede ? <p className="lede">{lede}</p> : null}
          </header>
        </div>
      </div>

      <main className="shell account-page">
        <div className="account-layout">
          <AccountMenu prefix={prefix} email={email ?? null} />
          <section className="account-content">{children}</section>
        </div>
      </main>
    </>
  );
}

function AccountMenu({ prefix, email }: { prefix: string; email: string | null }) {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();

  // Only while the programme runs: an entry that opens on "not available" is noise.
  const [referrals, setReferrals] = useState(false);
  useEffect(() => {
    void publicMarketing().then((value) => setReferrals(value?.referral != null));
  }, []);

  const entries = [
    { href: `${prefix}${ROUTES.licenses}`, label: t('myLicences'), icon: <KeyIcon size={20} /> },
    { href: `${prefix}${ROUTES.accountOrders}`, label: t('myOrders'), icon: <CartIcon /> },
    { href: `${prefix}${ROUTES.forYou}`, label: t('forYou'), icon: <HeartIcon size={20} /> },
    {
      href: `${prefix}${ROUTES.accountReviews}`,
      label: t('myReviews'),
      icon: <StarIcon size={20} />,
    },
    ...(referrals
      ? [{ href: `${prefix}/account/referral`, label: t('referral'), icon: <GiftIcon /> }]
      : []),
  ];

  return (
    <aside className="account-side">
      {email ? (
        <p className="account-who">
          <span className="iconbox" aria-hidden="true">
            <UserIcon />
          </span>
          <span>
            <span className="account-who-label">{t('signedInAs')}</span>
            <strong dir="ltr" title={email}>
              {email}
            </strong>
          </span>
        </p>
      ) : null}

      <nav className="account-menu" aria-label={t('menu')}>
        {entries.map((entry) => (
          <Link
            key={entry.href}
            href={entry.href}
            className="menuitem"
            aria-current={pathname === entry.href ? 'page' : undefined}
          >
            {entry.icon}
            <span>{entry.label}</span>
          </Link>
        ))}
        <Link href={`${prefix}${ROUTES.contact}`} className="menuitem">
          <HeadsetIcon size={20} />
          <span>{t('support')}</span>
        </Link>
        <button
          type="button"
          className="menuitem"
          onClick={() => {
            void accountApi.signOut().then(() => router.replace(`${prefix}${ROUTES.account}`));
          }}
        >
          <LogoutIcon />
          <span>{tc('signOut')}</span>
        </button>
      </nav>
    </aside>
  );
}
