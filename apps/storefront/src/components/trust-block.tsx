import type { PublicMarketing } from '@da/contracts';
import { useTranslations } from 'next-intl';

import { localText, safeMaroofUrl } from '../lib/trust';

import { BoltIcon, ShieldCheckIcon } from './icons';

type Trust = NonNullable<PublicMarketing['trust']>;

/**
 * The store's own guarantee, delivery promise and registration, as configured
 * on the marketing panel.
 *
 * Every line here is text somebody at the store wrote and is answerable for.
 * Nothing has a default: an empty field is an absent line, never a stock
 * phrase like "official partner" that the store has not earned. No directive,
 * so the product page renders it on the server and the checkout (a client
 * page) can render the same component.
 */
export function TrustBlock({
  trust,
  locale,
  delivery,
  compact = false,
}: {
  trust: Trust;
  locale: string;
  /** Already worked out from the variants; see `deliveryPromise`. */
  delivery?: string | null;
  /** The checkout's version: the guarantee and the registration, no delivery. */
  compact?: boolean;
}) {
  const t = useTranslations('trustSignals');
  const guarantee = localText(trust.guarantee, locale);
  const showDelivery = !compact && Boolean(delivery);
  const registration = hasRegistration(trust);

  if (!guarantee && !showDelivery && !registration) return null;

  return (
    <section className={`trust-block${compact ? ' is-compact' : ''}`} aria-label={t('label')}>
      {guarantee ? (
        <div className="trust-block-row">
          <span className="trust-block-icon" aria-hidden="true">
            <ShieldCheckIcon size={18} />
          </span>
          <div>
            <strong>{t('guarantee')}</strong>
            <p>{guarantee}</p>
          </div>
        </div>
      ) : null}

      {showDelivery ? (
        <div className="trust-block-row">
          <span className="trust-block-icon" aria-hidden="true">
            <BoltIcon size={18} />
          </span>
          <div>
            <strong>{t('delivery')}</strong>
            <p>{delivery}</p>
          </div>
        </div>
      ) : null}

      {registration ? (
        <RegistrationDetails trust={trust} className="trust-block-registration" />
      ) : null}
    </section>
  );
}

export function hasRegistration(trust: Trust): boolean {
  return Boolean(trust.commercialRegistration || trust.vatNumber || safeMaroofUrl(trust.maroofUrl));
}

/**
 * CR and VAT numbers and the Maroof link, on one line. Shared by the trust
 * block, the checkout and the footer so the three cannot disagree.
 *
 * The numbers are set left-to-right: a registration number reordered by an
 * Arabic paragraph is a number nobody can look up.
 */
export function RegistrationDetails({ trust, className }: { trust: Trust; className?: string }) {
  const t = useTranslations('trustSignals');
  const maroof = safeMaroofUrl(trust.maroofUrl);

  return (
    <p className={className} aria-label={t('registration')}>
      {trust.commercialRegistration ? (
        <span>
          {t('commercialRegistration')}: <bdi dir="ltr">{trust.commercialRegistration}</bdi>
        </span>
      ) : null}
      {trust.vatNumber ? (
        <span>
          {t('vatNumber')}: <bdi dir="ltr">{trust.vatNumber}</bdi>
        </span>
      ) : null}
      {maroof ? (
        <a href={maroof} target="_blank" rel="noopener noreferrer">
          {t('maroof')}
        </a>
      ) : null}
    </p>
  );
}
