'use client';

import { ROUTES } from '@da/contracts/constants';
import { Link } from '../../../../../components/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ClientBreadcrumbs } from '../../../../../components/breadcrumbs-client';
import { ArrowIcon, CheckIcon, CreditCardIcon, LockIcon } from '../../../../../components/icons';
import { isArabic } from '../../../../../i18n/locale';
import { cartApi } from '../../../../../lib/cart-client';

/**
 * Where Final Processor sends the shopper back after paying (or while the
 * payment is still pending). Drawn after the kit's success and payment-failed
 * pages (TASK-0105): a round mark, the outcome as a heading, one line, the
 * way on, and the order number in a card under it.
 *
 * The answer comes from one place: the API's status endpoint, which confirms
 * an unpaid order with the processor itself (A.2.5). The `fp_result` and
 * `fp_payment` parameters the processor appends are never read — a URL anyone
 * can type is not a receipt (A.2.6).
 *
 * "Pending" is normal for a few seconds: the webhook may land just after the
 * browser does. The page re-checks on its own for about a minute, then stops
 * and says so plainly rather than spinning forever.
 */
type View = 'checking' | 'paid' | 'pending' | 'stalled' | 'failed';

/** Every four seconds, for about a minute. */
const RECHECK_MS = 4_000;
const MAX_CHECKS = 15;

export default function CheckoutReturnPage() {
  const params = useParams<{ locale: string; number: string }>();
  const locale = params.locale ?? 'ar';
  const number = params.number ?? '';
  const prefix = isArabic(locale) ? '' : `/${locale}`;
  const t = useTranslations('checkoutReturn');
  const tc = useTranslations('common');

  const [view, setView] = useState<View>('checking');
  const [round, setRound] = useState(0);
  const checks = useRef(0);

  const check = useCallback(async (): Promise<View> => {
    try {
      const { status } = await cartApi.finalProcessorStatus(number, { locale });
      return status;
    } catch {
      // Unreachable or refused: not an answer either way, so it counts as
      // one more "not yet" and the loop decides when to stop.
      return 'pending';
    }
  }, [number, locale]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    checks.current = 0;

    const run = async (): Promise<void> => {
      checks.current += 1;
      const next = await check();
      if (cancelled) return;
      if (next !== 'pending') {
        setView(next);
        return;
      }
      if (checks.current >= MAX_CHECKS) {
        setView('stalled');
        return;
      }
      setView('pending');
      timer = setTimeout(() => void run(), RECHECK_MS);
    };

    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // `round` restarts the loop when the shopper asks to check again.
  }, [check, round]);

  const orderHref = `${prefix}${ROUTES.order(encodeURIComponent(number))}`;
  const failed = view === 'failed';

  return (
    <>
      <div className="page-band">
        <div className="shell">
          <ClientBreadcrumbs
            items={[
              { name: tc('home'), href: `${prefix}/` },
              { name: t('title'), href: `${prefix}${ROUTES.checkout}` },
            ]}
          />
          <header className="page-head">
            <h1>{t('title')}</h1>
          </header>
        </div>
      </div>

      <main className="shell checkout-return">
        {/* One live region, so a screen reader hears the status change. */}
        <section
          className={`status-hero${failed ? ' is-failed' : ''}`}
          aria-live="polite"
          aria-busy={view === 'checking'}
        >
          <span className="iconbox status-icon" aria-hidden="true">
            {failed ? (
              <CreditCardIcon />
            ) : view === 'paid' ? (
              <CheckIcon size={32} />
            ) : (
              <LockIcon size={30} />
            )}
          </span>

          {view === 'checking' ? (
            <>
              <h2>{t('checking')}</h2>
            </>
          ) : null}

          {view === 'paid' ? (
            <>
              <h2>{t('paidTitle')}</h2>
              <p>{t('paidBody')}</p>
              <div className="checkout-return-actions">
                <Link href={orderHref} className="btn btn-primary">
                  {t('viewOrder')}
                  <ArrowIcon size={18} />
                </Link>
                <Link href={`${prefix}${ROUTES.licenses}`} className="btn btn-outline">
                  {t('account')}
                </Link>
              </div>
            </>
          ) : null}

          {view === 'pending' ? (
            <>
              <h2>{t('pendingTitle')}</h2>
              <p>{t('pendingBody')}</p>
            </>
          ) : null}

          {view === 'stalled' ? (
            <>
              <h2>{t('stillTitle')}</h2>
              <p>{t('stillBody')}</p>
              <div className="checkout-return-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setView('checking');
                    setRound((value) => value + 1);
                  }}
                >
                  {t('checkAgain')}
                </button>
                <Link href={orderHref} className="btn btn-outline">
                  {t('viewOrder')}
                </Link>
              </div>
            </>
          ) : null}

          {view === 'failed' ? (
            <>
              <h2>{t('failedTitle')}</h2>
              <p>{t('failedBody')}</p>
              <div className="checkout-return-actions">
                <Link href={`${prefix}${ROUTES.checkout}`} className="btn btn-primary">
                  {t('tryAgain')}
                  <ArrowIcon size={18} />
                </Link>
              </div>
            </>
          ) : null}
        </section>

        <dl className="kv-card">
          <div>
            <dt>{t('orderNumberLabel')}</dt>
            <dd dir="ltr">{number}</dd>
          </div>
        </dl>
      </main>
    </>
  );
}
