'use client';

import type { CustomerMe, ForYou, Renewal } from '@da/contracts';
import { ROUTES } from '@da/contracts';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { AccountNav } from '../../../../components/account-nav';
import { ProductCard } from '../../../../components/product-card';
import { isArabic, resolveLocale } from '../../../../i18n/locale';
import { accountApi, AccountError } from '../../../../lib/account-client';

/**
 * مختارة لك — suggestions built from what this customer already owns.
 *
 * The shop already had a cross-sell: it reads the cart, offers a bundle, and
 * knows nothing about the person holding it. This reads the purchase history,
 * which is why it lives behind the session and nowhere else.
 *
 * Two sections, and the order between them is the argument. A renewal is
 * arithmetic — a one-year licence delivered on a known date runs out on a
 * known date — and it is the single most useful thing this shop can say to a
 * returning customer. Everything below it is inference, and says so: every
 * tile carries the reason it is there, because a shelf of products with no
 * stated reason is an advertisement.
 *
 * A customer with no delivered purchase gets neither. The page says that
 * plainly rather than filling itself with best-sellers and calling them
 * chosen.
 */
export default function ForYouPage() {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = resolveLocale(params.locale);
  const prefix = isArabic(locale) ? '' : `/${locale}`;
  const t = useTranslations('account');
  const tf = useTranslations('forYou');

  const [me, setMe] = useState<CustomerMe | null>(null);
  const [data, setData] = useState<ForYou | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await accountApi.forYou(locale));
    } catch (caught) {
      if (caught instanceof AccountError && caught.status === 401) {
        router.replace(`${prefix}${ROUTES.account}`);
        return;
      }
      setError(caught instanceof Error ? caught.message : null);
    }
  }, [locale, prefix, router]);

  useEffect(() => {
    void (async () => {
      try {
        setMe(await accountApi.me());
      } catch {
        router.replace(`${prefix}${ROUTES.account}`);
        return;
      }
      await load();
    })();
  }, [load, prefix, router]);

  if (!me) return <main className="shell">…</main>;

  return (
    <main className="shell account-page">
      <header className="page-head">
        <h1>{t('forYou')}</h1>
        <p className="lede">{tf('lede')}</p>
      </header>

      <AccountNav prefix={prefix} />

      {error ? <p className="error">{error}</p> : null}
      {!data ? <p className="meta">…</p> : null}

      {data && data.purchases === 0 ? <p className="notice">{tf('nothing')}</p> : null}

      {data && data.renewals.length > 0 ? (
        <section className="for-you-section">
          <h2>{tf('endingTitle')}</h2>
          <ul className="renewal-list">
            {data.renewals.map((renewal) => (
              <RenewalRow
                key={renewal.orderNumber + renewal.product.slug}
                renewal={renewal}
                locale={locale}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {data && data.suggestions.length > 0 ? (
        <section className="for-you-section">
          <h2>{tf('alsoTitle')}</h2>
          <div className="product-grid">
            {data.suggestions.map((item) => (
              <div key={item.product.slug} className="for-you-tile">
                <ProductCard card={item.product} locale={locale} />
                <p className="for-you-reason">
                  {/* The reason, written as a sentence rather than shown as a tag. */}
                  {tf(`reason.${item.reason}`, { name: item.becauseOf })}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {data && data.purchases > 0 && data.renewals.length === 0 && data.suggestions.length === 0 ? (
        <p className="notice">{tf('allLifetime')}</p>
      ) : null}
    </main>
  );
}

/**
 * One licence and its date.
 *
 * The number of days is said as a number, not as "soon": a customer deciding
 * whether to renew now or next month needs the figure, and a word that means
 * three days to one reader and three weeks to another means nothing.
 */
function RenewalRow({ renewal, locale }: { renewal: Renewal; locale: string }) {
  const tf = useTranslations('forYou');
  const lapsed = renewal.daysLeft < 0;
  const days = Math.abs(renewal.daysLeft);

  return (
    <li className={`renewal-row${lapsed ? ' is-lapsed' : ''}`}>
      <div className="renewal-when">
        <strong>{lapsed ? tf('ended') : tf('left')}</strong>
        <span className="renewal-days">{days}</span>
        <span className="meta">{tf('daysUnit', { count: days })}</span>
      </div>
      <div className="renewal-what">
        <ProductCard card={renewal.product} locale={locale} />
        <p className="meta">
          {tf('boughtOn', {
            order: renewal.orderNumber,
            date: renewal.expiresAt.slice(0, 10),
          })}
        </p>
      </div>
    </li>
  );
}
