'use client';

import type { AdminOrderDetail } from '@da/contracts';
import Link from 'next/link';

import { useT } from '../../../i18n/provider';
import { Icon } from '../../icons';
import { STATUS_KEYS, initialsOf, stamp } from '../order-shared';
import type { Notice } from './page';

/**
 * The two cards that stay put while the tabs change: who the customer is,
 * and what the order says about itself.
 */

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function CustomerCard({
  detail,
  onNotice,
}: {
  detail: AdminOrderDetail;
  onNotice: (notice: Notice | null) => void;
}) {
  const t = useT('order');
  const customer = detail.customer;
  const name = customer?.name ?? detail.customerName ?? detail.billing.name;
  const phone = customer?.whatsappPhone ?? customer?.phone ?? null;
  const waDigits = phone ? phone.replace(/\D/g, '') : '';

  async function copy(value: string, label: string): Promise<void> {
    onNotice((await copyText(value)) ? { kind: 'ok', text: t('copied', { label }) } : null);
  }

  return (
    <section className="card profile-card">
      <div className="profile-card__head">
        <span className="avatar avatar--lg" aria-hidden="true">
          {initialsOf(name, detail.email)}
        </span>
        <h2 className="profile-card__name">{name ?? t('guestCustomer')}</h2>
        <button
          type="button"
          className="linky profile-card__email"
          dir="ltr"
          title={t('copy')}
          onClick={() => void copy(detail.email, t('factActivationEmail'))}
        >
          {detail.email}
        </button>
        <div className="profile-card__pills">
          {customer ? (
            <span className="pill pill-info">
              {customer.locale === 'en' ? t('localeEn') : t('localeAr')}
            </span>
          ) : (
            <span className="pill pill-draft">{t('guestCustomer')}</span>
          )}
          <span
            className={`pill ${
              detail.riskLevel === 'LOW'
                ? 'pill-published'
                : detail.riskLevel === 'MEDIUM'
                  ? 'pill-warning'
                  : 'pill-blocked'
            }`}
          >
            {t('riskLabel')} · {t(`risk${detail.riskLevel}`)}
          </span>
        </div>
      </div>

      <ul className="facts">
        {phone ? (
          <li>
            <Icon name="user" />
            <span className="facts__label">{t('phone')}</span>
            <span dir="ltr">{phone}</span>
          </li>
        ) : null}
        {customer?.company || detail.billing.company ? (
          <li>
            <Icon name="brands" />
            <span className="facts__label">{t('company')}</span>
            <span>{customer?.company ?? detail.billing.company}</span>
          </li>
        ) : null}
        {detail.billing.country ? (
          <li>
            <Icon name="redirects" />
            <span className="facts__label">{t('country')}</span>
            <span dir="ltr">{detail.billing.country}</span>
          </li>
        ) : null}
        {customer ? (
          <>
            <li>
              <Icon name="orders" />
              <span className="facts__label">{t.tp('paidOrders', customer.paidOrders)}</span>
              <span dir="ltr">${customer.totalSpentUsd}</span>
            </li>
            <li>
              <Icon name="calendar" />
              <span className="facts__label">
                {t('customerSince', { date: customer.createdAt.slice(0, 10) })}
              </span>
            </li>
          </>
        ) : null}
      </ul>

      {customer ? (
        <div className="profile-card__consent">
          <span
            className={`pill ${
              customer.marketingEmail === 'OPTED_IN'
                ? 'pill-published'
                : customer.marketingEmail === 'OPTED_OUT'
                  ? 'pill-blocked'
                  : 'pill-draft'
            }`}
          >
            {customer.marketingEmail === 'OPTED_IN'
              ? t('marketingOptedIn')
              : customer.marketingEmail === 'OPTED_OUT'
                ? t('marketingOptedOut')
                : t('marketingNone')}
          </span>
          {customer.whatsappOptIn ? (
            <span className="pill pill-published">{t('whatsappOptedIn')}</span>
          ) : null}
        </div>
      ) : null}

      <div className="profile-card__actions">
        {waDigits ? (
          <a
            className="as-button ghost"
            href={`https://wa.me/${waDigits}?text=${encodeURIComponent(detail.number)}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            <Icon name="messages" />
            {t('openWhatsapp')}
          </a>
        ) : null}
        <Link className="as-button ghost" href={`/customers?q=${encodeURIComponent(detail.email)}`}>
          <Icon name="customers" />
          {t('allCustomerOrders')}
        </Link>
      </div>
    </section>
  );
}

export function FactsCard({
  detail,
  onNotice,
}: {
  detail: AdminOrderDetail;
  onNotice: (notice: Notice | null) => void;
}) {
  const t = useT('order');
  const o = useT('orders');
  const { amounts, billing, client } = detail;
  const hasBilling = Boolean(billing.name || billing.company || billing.vat || billing.country);

  async function copy(value: string, label: string): Promise<void> {
    onNotice((await copyText(value)) ? { kind: 'ok', text: t('copied', { label }) } : null);
  }

  return (
    <section className="card facts-card">
      <h2 className="card__title">{t('factsHeading')}</h2>
      <dl className="kv">
        <dt>{t('factNumber')}</dt>
        <dd>
          <code dir="ltr">{detail.number}</code>
        </dd>
        <dt>{t('factStatus')}</dt>
        <dd>{o(STATUS_KEYS[detail.status])}</dd>
        <dt>{t('factPlaced')}</dt>
        <dd dir="ltr">{stamp(detail.placedAt)}</dd>
        <dt>{t('factPaid')}</dt>
        <dd dir="ltr">{detail.paidAt ? stamp(detail.paidAt) : '—'}</dd>
        <dt>{t('factCurrency')}</dt>
        <dd dir="ltr">
          {amounts.currency}
          {amounts.currency !== 'USD' ? (
            <span className="meta">
              {' '}
              · {t('factFx')} {amounts.fxRate}
            </span>
          ) : null}
        </dd>
        <dt>{t('factCoupon')}</dt>
        <dd>
          {detail.couponCode ? (
            <code dir="ltr">{detail.couponCode}</code>
          ) : (
            <span className="meta">{t('noCoupon')}</span>
          )}
        </dd>
        {detail.activationEmail ? (
          <>
            <dt>{t('factActivationEmail')}</dt>
            <dd>
              <button
                type="button"
                className="linky"
                dir="ltr"
                title={t('copy')}
                onClick={() => void copy(detail.activationEmail ?? '', t('factActivationEmail'))}
              >
                {detail.activationEmail}
              </button>
            </dd>
          </>
        ) : null}
      </dl>

      <h3 className="card__subtitle">{t('amountsHeading')}</h3>
      <dl className="kv kv--money">
        <dt>{t('subtotal')}</dt>
        <dd dir="ltr">${amounts.subtotalUsd}</dd>
        {Number(amounts.discountUsd) > 0 ? (
          <>
            <dt>{t('discount')}</dt>
            <dd dir="ltr">−${amounts.discountUsd}</dd>
          </>
        ) : null}
        {Number(amounts.taxUsd) > 0 ? (
          <>
            <dt>{t('tax')}</dt>
            <dd dir="ltr">${amounts.taxUsd}</dd>
          </>
        ) : null}
        <dt className="kv__total">{t('total')}</dt>
        <dd className="kv__total" dir="ltr">
          ${amounts.totalUsd}
        </dd>
        {amounts.charged ? (
          <>
            <dt>{t('charged', { currency: amounts.charged.currency })}</dt>
            <dd dir="ltr">{amounts.charged.amount}</dd>
          </>
        ) : null}
      </dl>

      <h3 className="card__subtitle">{t('billingHeading')}</h3>
      {hasBilling ? (
        <dl className="kv">
          {billing.name ? (
            <>
              <dt>{t('billingName')}</dt>
              <dd>{billing.name}</dd>
            </>
          ) : null}
          {billing.company ? (
            <>
              <dt>{t('company')}</dt>
              <dd>{billing.company}</dd>
            </>
          ) : null}
          {billing.vat ? (
            <>
              <dt>{t('billingVat')}</dt>
              <dd dir="ltr">{billing.vat}</dd>
            </>
          ) : null}
          {billing.country ? (
            <>
              <dt>{t('country')}</dt>
              <dd dir="ltr">{billing.country}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className="meta">{t('noBilling')}</p>
      )}

      {client.ip || client.userAgent ? (
        <dl className="kv kv--quiet">
          {client.ip ? (
            <>
              <dt>{t('factIp')}</dt>
              <dd dir="ltr">{client.ip}</dd>
            </>
          ) : null}
          {client.userAgent ? (
            <>
              <dt>{t('factDevice')}</dt>
              <dd dir="ltr" className="kv__clamp" title={client.userAgent}>
                {client.userAgent}
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}
