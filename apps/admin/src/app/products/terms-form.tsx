'use client';

import type { ProductTerms, SetVariantTerms, VariantTerms } from '@da/contracts';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api } from '../../lib/api';

/**
 * Price and licence terms, per variant.
 *
 * Every field here arrived from a migration script and none of them could be
 * changed from any screen, which is why one product sat as a draft for weeks
 * with a price of zero: the publish gate refused it, correctly, and there was
 * no box anywhere that took a number.
 *
 * The form is per variant and saves per variant. A product with four editions
 * has four prices, four licence lengths and four delivery promises, and a
 * single save button over all of them would make one typo a four-product
 * mistake.
 */

const PERIOD_UNITS = ['LIFETIME', 'YEAR', 'MONTH', 'DAY'] as const;
const PLATFORMS = ['WINDOWS', 'MAC', 'LINUX', 'CROSS_PLATFORM'] as const;
const ACTIVATION = [
  'RETAIL_ONLINE',
  'RETAIL_PHONE',
  'VOLUME_MAK',
  'KMS',
  'BIND_MICROSOFT_ACCOUNT',
  'REDEEM_CODE',
  'ACCOUNT_CREDENTIALS',
  'PANEL_INVITE',
  'CAL_KEY',
  'NOT_APPLICABLE',
] as const;
const SUPPLY = ['FROM_STOCK', 'ON_DEMAND', 'MANUAL_SETUP'] as const;
const STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;

const isSettable = (status: VariantTerms['status']): status is (typeof STATUSES)[number] =>
  (STATUSES as readonly string[]).includes(status);

/** The delivery windows a shop actually promises, rather than a seconds box. */
const SLA_CHOICES = [60, 300, 1800, 3600, 21_600, 43_200, 86_400, 172_800] as const;

export function TermsForm({
  slug,
  canWrite,
  onSaved,
  onError,
}: {
  slug: string;
  canWrite: boolean;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const t = useT('products');
  const c = useT('common');
  const [data, setData] = useState<ProductTerms | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.productTerms(slug));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : c('actionFailed'));
    }
  }, [slug, onError, c]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return <p className="meta">{c('loading')}</p>;

  return (
    <div className="terms-form">
      <h3>{t('termsHeading')}</h3>
      <p className="lede-sm">{t('termsLede')}</p>
      {data.variants.map((variant) => (
        <VariantCard
          key={variant.id}
          variant={variant}
          canWrite={canWrite}
          onSaved={(next) => {
            setData(next);
            onSaved();
          }}
          onError={onError}
        />
      ))}
    </div>
  );
}

function VariantCard({
  variant,
  canWrite,
  onSaved,
  onError,
}: {
  variant: VariantTerms;
  canWrite: boolean;
  onSaved: (next: ProductTerms) => void;
  onError: (message: string) => void;
}) {
  const t = useT('products');
  const c = useT('common');

  // One draft object rather than a state per field: eighteen `useState` calls
  // and eighteen dirty comparisons is where a form starts losing edits.
  const [draft, setDraft] = useState(variant);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(variant);
  }, [variant]);

  const set = <K extends keyof VariantTerms>(key: K, value: VariantTerms[K]): void =>
    setDraft((current) => ({ ...current, [key]: value }));

  /** Only what actually changed, so an untouched field is never rewritten. */
  function patch(): SetVariantTerms {
    const body: SetVariantTerms = {};
    if (draft.priceUsd !== variant.priceUsd) body.priceUsd = draft.priceUsd;
    if (draft.compareAtUsd !== variant.compareAtUsd) body.compareAtUsd = draft.compareAtUsd ?? '';
    if (draft.costUsd !== variant.costUsd) body.costUsd = draft.costUsd ?? '';
    if (draft.licensePeriodValue !== variant.licensePeriodValue)
      body.licensePeriodValue = draft.licensePeriodValue;
    if (draft.licensePeriodUnit !== variant.licensePeriodUnit)
      body.licensePeriodUnit = draft.licensePeriodUnit;
    if (draft.deviceCount !== variant.deviceCount) body.deviceCount = draft.deviceCount;
    if (draft.platform !== variant.platform) body.platform = draft.platform;
    if (draft.activationMethod !== variant.activationMethod)
      body.activationMethod = draft.activationMethod;
    if (draft.fulfillmentMode !== variant.fulfillmentMode)
      body.fulfillmentMode = draft.fulfillmentMode;
    if (draft.deliverySlaSeconds !== variant.deliverySlaSeconds)
      body.deliverySlaSeconds = draft.deliverySlaSeconds;
    if (draft.requiresActivationEmail !== variant.requiresActivationEmail)
      body.requiresActivationEmail = draft.requiresActivationEmail;
    if (draft.warrantyDays !== variant.warrantyDays) body.warrantyDays = draft.warrantyDays;
    // The column holds five states; three of them have a workflow behind
    // them and this screen offers only those. A variant imported as
    // IN_REVIEW keeps that state until somebody chooses another, rather than
    // being quietly rewritten by a form that cannot express it.
    if (draft.status !== variant.status && isSettable(draft.status)) body.status = draft.status;
    if (draft.isDefault !== variant.isDefault) body.isDefault = draft.isDefault;
    return body;
  }

  const dirty = Object.keys(patch()).length > 0;
  const lifetime = draft.licensePeriodUnit === 'LIFETIME';

  async function save(): Promise<void> {
    setSaving(true);
    try {
      onSaved(await api.setVariantTerms(variant.sku, patch()));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : c('actionFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`variant-card${dirty ? ' is-dirty' : ''}`}>
      <header>
        <strong dir="ltr">{variant.sku}</strong>
        {variant.isDefault ? <span className="pill pill-ready">{t('variantDefault')}</span> : null}
        <span className={`pill ${variant.status === 'PUBLISHED' ? 'pill-published' : 'pill-draft'}`}>
          {variant.status}
        </span>
        {/* Sold before. Not a warning against editing — prices change — but
            the one fact that decides how carefully to do it. */}
        {variant.orderCount > 0 ? (
          <span className="meta">{t('variantSold', { count: variant.orderCount })}</span>
        ) : (
          <span className="meta">{t('variantNeverSold')}</span>
        )}
      </header>

      <div className="terms-grid">
        <label>
          <span>{t('price')}</span>
          <input
            id={`price-${variant.id}`}
            type="text"
            inputMode="decimal"
            dir="ltr"
            value={draft.priceUsd}
            disabled={!canWrite}
            onChange={(event) => set('priceUsd', event.target.value)}
          />
        </label>

        <label>
          <span>{t('compareAt')}</span>
          <input
            id={`compare-${variant.id}`}
            type="text"
            inputMode="decimal"
            dir="ltr"
            value={draft.compareAtUsd ?? ''}
            placeholder={t('noDiscount')}
            disabled={!canWrite}
            onChange={(event) => set('compareAtUsd', event.target.value || null)}
          />
          <small>{t('compareAtHint')}</small>
        </label>

        <label>
          <span>{t('cost')}</span>
          <input
            id={`cost-${variant.id}`}
            type="text"
            inputMode="decimal"
            dir="ltr"
            value={draft.costUsd ?? ''}
            disabled={!canWrite}
            onChange={(event) => set('costUsd', event.target.value || null)}
          />
          <small>{t('costHint')}</small>
        </label>

        <label>
          <span>{t('periodUnit')}</span>
          <select
            id={`unit-${variant.id}`}
            value={draft.licensePeriodUnit}
            disabled={!canWrite}
            onChange={(event) =>
              set('licensePeriodUnit', event.target.value as VariantTerms['licensePeriodUnit'])
            }
          >
            {PERIOD_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {t(`unit_${unit}`)}
              </option>
            ))}
          </select>
        </label>

        {/* Hidden for a lifetime licence rather than disabled: "3" beside
            "lifetime" is three of nothing, and the server normalises it away
            anyway, so showing the box would be showing a value that is about
            to be discarded. */}
        {lifetime ? null : (
          <label>
            <span>{t('periodValue')}</span>
            <input
              id={`period-${variant.id}`}
              type="number"
              min={1}
              max={120}
              dir="ltr"
              value={draft.licensePeriodValue ?? 1}
              disabled={!canWrite}
              onChange={(event) => set('licensePeriodValue', Number(event.target.value))}
            />
          </label>
        )}

        <label>
          <span>{t('deviceCount')}</span>
          <input
            id={`devices-${variant.id}`}
            type="number"
            min={1}
            dir="ltr"
            value={draft.deviceCount}
            disabled={!canWrite}
            onChange={(event) => set('deviceCount', Number(event.target.value))}
          />
        </label>

        <label>
          <span>{t('platform')}</span>
          <select
            id={`platform-${variant.id}`}
            value={draft.platform}
            disabled={!canWrite}
            onChange={(event) => set('platform', event.target.value as VariantTerms['platform'])}
          >
            {PLATFORMS.map((value) => (
              <option key={value} value={value}>
                {t(`platform_${value}`)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{t('activationMethod')}</span>
          <select
            id={`activation-${variant.id}`}
            value={draft.activationMethod}
            disabled={!canWrite}
            onChange={(event) =>
              set('activationMethod', event.target.value as VariantTerms['activationMethod'])
            }
          >
            {ACTIVATION.map((value) => (
              <option key={value} value={value}>
                {t(`activation_${value}`)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{t('supplyMode')}</span>
          <select
            id={`supply-${variant.id}`}
            value={draft.fulfillmentMode}
            disabled={!canWrite}
            onChange={(event) =>
              set('fulfillmentMode', event.target.value as VariantTerms['fulfillmentMode'])
            }
          >
            {SUPPLY.map((value) => (
              <option key={value} value={value}>
                {t(`supply_${value}`)}
              </option>
            ))}
          </select>
          {/* The one place this choice bites: stock-backed with an empty shelf
              is a published page whose buy button refuses. */}
          {draft.fulfillmentMode === 'FROM_STOCK' && variant.onHand === 0 ? (
            <small className="warn">{t('supplyStockEmpty')}</small>
          ) : null}
        </label>

        <label>
          <span>{t('deliverySla')}</span>
          <select
            id={`sla-${variant.id}`}
            value={draft.deliverySlaSeconds}
            disabled={!canWrite}
            onChange={(event) => set('deliverySlaSeconds', Number(event.target.value))}
          >
            {/* The stored value, when it is not one of the offered ones: a
                migrated variant must not have its promise silently rounded to
                the nearest option in the list. */}
            {(SLA_CHOICES as readonly number[]).includes(draft.deliverySlaSeconds) ? null : (
              <option value={draft.deliverySlaSeconds}>
                {t('slaSeconds', { count: draft.deliverySlaSeconds })}
              </option>
            )}
            {SLA_CHOICES.map((seconds) => (
              <option key={seconds} value={seconds}>
                {t('slaSeconds', { count: seconds })}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{t('warrantyDays')}</span>
          <input
            id={`warranty-${variant.id}`}
            type="number"
            min={0}
            max={3650}
            dir="ltr"
            value={draft.warrantyDays ?? ''}
            placeholder={t('warrantyWholeTerm')}
            disabled={!canWrite}
            onChange={(event) =>
              set('warrantyDays', event.target.value === '' ? null : Number(event.target.value))
            }
          />
          <small>{t('warrantyHint')}</small>
        </label>

        <label>
          <span>{t('variantStatus')}</span>
          <select
            id={`status-${variant.id}`}
            value={draft.status}
            disabled={!canWrite}
            onChange={(event) => set('status', event.target.value as VariantTerms['status'])}
          >
            {/* The stored state, when the workflow has no screen for it. */}
            {(STATUSES as readonly string[]).includes(draft.status) ? null : (
              <option value={draft.status}>{draft.status}</option>
            )}
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`status_${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="terms-checks">
        <label className="check">
          <input
            id={`needs-email-${variant.id}`}
            type="checkbox"
            checked={draft.requiresActivationEmail}
            disabled={!canWrite}
            onChange={(event) => set('requiresActivationEmail', event.target.checked)}
          />
          <span>{t('requiresActivationEmail')}</span>
        </label>
        <label className="check">
          <input
            id={`default-${variant.id}`}
            type="checkbox"
            checked={draft.isDefault}
            disabled={!canWrite || variant.isDefault}
            onChange={(event) => set('isDefault', event.target.checked)}
          />
          <span>{t('makeDefault')}</span>
        </label>
      </div>

      {canWrite ? (
        <div className="terms-save">
          <button type="button" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? c('loading') : c('save')}
          </button>
          {dirty ? (
            <>
              <button type="button" className="ghost" onClick={() => setDraft(variant)}>
                {c('cancel')}
              </button>
              <span className="meta-warn">{t('termsUnsaved')}</span>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
