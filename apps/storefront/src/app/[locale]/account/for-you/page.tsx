'use client';

import type { CustomerMe, ForYou, ForYouItem, Renewal } from '@da/contracts';
import { ROUTES } from '@da/contracts';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { AccountNav } from '../../../../components/account-nav';
import { ProductCard } from '../../../../components/product-card';
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
  const locale = params.locale ?? 'ar';
  const ar = locale === 'ar';
  const prefix = ar ? '' : `/${locale}`;

  const [me, setMe] = useState<CustomerMe | null>(null);
  const [data, setData] = useState<ForYou | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await accountApi.forYou(ar ? 'ar' : 'en'));
    } catch (caught) {
      if (caught instanceof AccountError && caught.status === 401) {
        router.replace(`${prefix}${ROUTES.account}`);
        return;
      }
      setError(caught instanceof Error ? caught.message : null);
    }
  }, [ar, prefix, router]);

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
        <h1>{ar ? 'مختارة لك' : 'Chosen for you'}</h1>
        <p className="lede">
          {ar
            ? 'مبنية على ما اشتريته فعلاً — لا على ما نريد بيعه.'
            : 'Built from what you have actually bought — not from what we would like to sell.'}
        </p>
      </header>

      <AccountNav ar={ar} prefix={prefix} />

      {error ? <p className="error">{error}</p> : null}
      {!data ? <p className="meta">…</p> : null}

      {data && data.purchases === 0 ? (
        <p className="notice">
          {ar
            ? 'لا مشتريات مُسلَّمة بعد، فلا شيء نبني عليه اقتراحاً. حين يصلك أول ترخيص ستجد هنا موعد تجديده وما يناسبه.'
            : 'Nothing delivered yet, so there is nothing to build a suggestion on. Once your first licence arrives, its renewal date and what goes with it appear here.'}
        </p>
      ) : null}

      {data && data.renewals.length > 0 ? (
        <section className="for-you-section">
          <h2>{ar ? 'تراخيص تقترب من نهايتها' : 'Licences coming to an end'}</h2>
          <ul className="renewal-list">
            {data.renewals.map((renewal) => (
              <RenewalRow key={renewal.orderNumber + renewal.product.slug} renewal={renewal} ar={ar} />
            ))}
          </ul>
        </section>
      ) : null}

      {data && data.suggestions.length > 0 ? (
        <section className="for-you-section">
          <h2>{ar ? 'قد يناسبك أيضاً' : 'You might also want'}</h2>
          <div className="product-grid">
            {data.suggestions.map((item) => (
              <div key={item.product.slug} className="for-you-tile">
                <ProductCard card={item.product} locale={locale} />
                <p className="for-you-reason">{reasonText(item, ar)}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {data && data.purchases > 0 && data.renewals.length === 0 && data.suggestions.length === 0 ? (
        <p className="notice">
          {ar
            ? 'تراخيصك كلها مدى الحياة ولا شيء منها يحتاج تجديداً — وقد اشتريت بالفعل ما عندنا من علاماتها.'
            : 'Your licences are all lifetime and none needs renewing — and you already own what we carry from their brands.'}
        </p>
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
function RenewalRow({ renewal, ar }: { renewal: Renewal; ar: boolean }) {
  const lapsed = renewal.daysLeft < 0;
  const days = Math.abs(renewal.daysLeft);

  return (
    <li className={`renewal-row${lapsed ? ' is-lapsed' : ''}`}>
      <div className="renewal-when">
        <strong>{lapsed ? (ar ? 'انتهى' : 'Ended') : (ar ? 'يتبقّى' : 'Left')}</strong>
        <span className="renewal-days">{days}</span>
        <span className="meta">{ar ? 'يوماً' : days === 1 ? 'day' : 'days'}</span>
      </div>
      <div className="renewal-what">
        <ProductCard card={renewal.product} locale={ar ? 'ar' : 'en'} />
        <p className="meta">
          {ar
            ? `اشتريته في الطلب ${renewal.orderNumber} وينتهي في ${renewal.expiresAt.slice(0, 10)}`
            : `Bought on order ${renewal.orderNumber}, ends ${renewal.expiresAt.slice(0, 10)}`}
        </p>
      </div>
    </li>
  );
}

/** The reason, written as a sentence rather than shown as a tag. */
function reasonText(item: ForYouItem, ar: boolean): string {
  switch (item.reason) {
    case 'sameBrand':
      return ar ? `لأنك اشتريت من ${item.becauseOf}` : `Because you bought ${item.becauseOf}`;
    case 'sameCategory':
      return ar ? `من قسم ${item.becauseOf} الذي تشتري منه` : `From ${item.becauseOf}, which you buy from`;
    case 'relatedToOwned':
      return ar ? `يُستخدم مع ${item.becauseOf}` : `Used alongside ${item.becauseOf}`;
  }
}
