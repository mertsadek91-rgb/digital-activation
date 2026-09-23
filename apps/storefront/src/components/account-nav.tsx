'use client';

import { ROUTES } from '@da/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { publicMarketing } from '../lib/growth-client';

/**
 * The two things a signed-in customer can look at.
 *
 * It stays two links rather than becoming a settings menu, because there is no
 * account to manage here: no password to change, and no saved address, because
 * every order in this store is a guest order identified by the mailbox the
 * licence was sent to.
 *
 * The two are separated because they answer different questions. "Where is my
 * key" is the licences page; "what did I buy, and what did it cost" is the
 * orders page, and an order never carries a key — the key comes out one line
 * at a time through the reveal that writes to the vault's access log.
 */
export function AccountNav({ prefix }: { prefix: string }) {
  const t = useTranslations('account');
  const pathname = usePathname();
  const licences = `${prefix}${ROUTES.licenses}`;
  const orders = `${prefix}${ROUTES.accountOrders}`;
  const forYou = `${prefix}${ROUTES.forYou}`;
  const referral = `${prefix}/account/referral`;
  // Only while the programme runs: a tab that opens on "not available" is noise.
  const [referrals, setReferrals] = useState(false);
  useEffect(() => {
    void publicMarketing().then((value) => setReferrals(value?.referral != null));
  }, []);

  return (
    <nav className="account-tabs">
      <Link href={licences} aria-current={pathname === licences ? 'page' : undefined}>
        {t('myLicences')}
      </Link>
      <Link href={orders} aria-current={pathname === orders ? 'page' : undefined}>
        {t('myOrders')}
      </Link>
      <Link href={forYou} aria-current={pathname === forYou ? 'page' : undefined}>
        {t('forYou')}
      </Link>
      {referrals ? (
        <Link href={referral} aria-current={pathname === referral ? 'page' : undefined}>
          {t('referral')}
        </Link>
      ) : null}
    </nav>
  );
}
