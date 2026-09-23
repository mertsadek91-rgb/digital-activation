'use client';

import type { SaleBadge } from '@da/contracts';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';

import { DiscountLicence } from './offer-suggestions';

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * A seasonal sale on the product page: its name and percent, the discount
 * licence number, and — only when the sale asks for one — a countdown.
 *
 * The countdown is to the sale's real `endsAt`, the moment the API stops
 * applying the sale and the price comes back (the cart reprices lines then
 * too). It does not reset, loop or restart per visitor. Rendered after
 * mount only, because the server's clock and the reader's would otherwise
 * disagree by the time the page hydrates.
 */
export function SaleNotice({ sale }: { sale: SaleBadge }) {
  const t = useTranslations('offers');
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!sale.showCountdown) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sale.showCountdown]);

  const endsAt = new Date(sale.endsAt).getTime();
  let countdown: ReactNode = null;
  if (sale.showCountdown && now !== null) {
    const left = Math.max(0, Math.floor((endsAt - now) / 1000));
    if (left === 0) {
      countdown = <p className="sale-countdown is-over">{t('countdownOver')}</p>;
    } else {
      const days = Math.floor(left / 86_400);
      const clock = `${pad(Math.floor((left % 86_400) / 3600))}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`;
      countdown = (
        <p className="sale-countdown" aria-live="off">
          {t.rich('countdown', {
            // The days in words, outside the left-to-right clock beside them.
            days: days > 0 ? t('countdownDays', { days }) : '',
            time: clock,
            ltr: (chunks) => <span dir="ltr">{chunks}</span>,
          })}
        </p>
      );
    }
  }

  return (
    <div className="sale-notice">
      <span className="badge badge-accent">
        {sale.name
          ? t('saleBadge', { name: sale.name, percent: sale.percent })
          : t('saleBadgeNoName', { percent: sale.percent })}
      </span>
      <DiscountLicence number={sale.licenceNumber} />
      {countdown}
    </div>
  );
}
