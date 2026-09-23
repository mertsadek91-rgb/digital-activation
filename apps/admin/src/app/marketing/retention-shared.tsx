'use client';

import type { Lift, MarketingFeature, MarketingSettings, StaffMe } from '@da/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api, ApiError } from '../../lib/api';
import { messageOf } from '../content/shared';

import './retention.css';

/**
 * What the renewal and cart-recovery screens share: loading and saving one
 * feature's settings document, the number fields, and the treated-against-
 * held-out panel.
 */

export type FieldErrors = Record<string, string | undefined>;

/** Loads and saves one feature's settings. The stored copy is kept to know when the form is dirty. */
export function useFeatureSettings<F extends MarketingFeature>(feature: F, me: StaffMe | null) {
  const router = useRouter();
  const c = useT('common');
  const t = useT('marketingRetention');
  const [stored, setStored] = useState<MarketingSettings[F] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const all = await api.marketingSettings();
      setStored(all[feature]);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(messageOf(caught, t('loadFailed')));
    }
  }, [feature, router, t]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  async function save(value: MarketingSettings[F]): Promise<boolean> {
    setSaving(true);
    setError(null);
    setNote(null);
    try {
      setStored(await api.setMarketingSettings(feature, value));
      setNote(t('saved'));
      return true;
    } catch (caught) {
      setError(messageOf(caught, c('actionFailed')));
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { stored, error, setError, note, setNote, saving, save };
}

/** A whole number in range, or the reason it is not. */
export function wholeError(
  raw: string,
  min: number,
  max: number,
  t: ReturnType<typeof useT<'marketingRetention'>>,
): string | undefined {
  const value = Number(raw.trim());
  if (raw.trim() === '' || !Number.isFinite(value)) return t('errNumber');
  if (!Number.isInteger(value)) return t('errWhole');
  if (value < min || value > max) return t('errRange', { min, max });
  return undefined;
}

export function numberError(
  raw: string,
  min: number,
  max: number,
  t: ReturnType<typeof useT<'marketingRetention'>>,
): string | undefined {
  const value = Number(raw.trim());
  if (raw.trim() === '' || !Number.isFinite(value)) return t('errNumber');
  if (value < min || value > max) return t('errRange', { min, max });
  return undefined;
}

export function NumberField({
  id,
  label,
  hint,
  value,
  error,
  disabled,
  step,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  error?: string | undefined;
  disabled: boolean;
  step?: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className={`retention-field${error ? ' has-error' : ''}`} htmlFor={id}>
      <span className="retention-label">{label}</span>
      <input
        id={id}
        type="text"
        inputMode={step === 'any' ? 'decimal' : 'numeric'}
        dir="ltr"
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <span id={`${id}-hint`} className="retention-error">
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-hint`} className="meta">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function TextField({
  id,
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <label className="retention-field" htmlFor={id}>
      <span className="retention-label">{label}</span>
      <input
        id={id}
        type="text"
        dir="ltr"
        maxLength={100}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? <span className="meta">{hint}</span> : null}
    </label>
  );
}

export function BackLink() {
  const t = useT('marketingRetention');
  return (
    <Link href="/marketing" className="retention-back">
      {t('back')}
    </Link>
  );
}

/** Below this in either group, a difference in rates is noise. */
const MIN_GROUP = 30;

/**
 * Treated against held out, as counts.
 *
 * Rates are shown only when both groups are big enough to mean something;
 * below that the screen says so, rather than printing "50% vs 0%" off two
 * carts and one sale.
 */
export function LiftPanel({ lift, holdoutPercent }: { lift: Lift; holdoutPercent: number }) {
  const t = useT('marketingRetention');
  const rate = (converted: number, total: number): string =>
    total > 0 ? ` (${((converted / total) * 100).toFixed(1)}%)` : '';
  const enough = lift.treated >= MIN_GROUP && lift.heldOut >= MIN_GROUP;

  return (
    <div className="retention-lift">
      <h3>{t('liftTitle')}</h3>
      <dl>
        <div>
          <dt>{t('liftTreated')}</dt>
          <dd>
            {t('liftRow', { converted: lift.treatedConverted, total: lift.treated })}
            {enough ? rate(lift.treatedConverted, lift.treated) : ''}
          </dd>
        </div>
        <div>
          <dt>{t('liftHeldOut')}</dt>
          <dd>
            {t('liftRow', { converted: lift.heldOutConverted, total: lift.heldOut })}
            {enough ? rate(lift.heldOutConverted, lift.heldOut) : ''}
          </dd>
        </div>
      </dl>
      {holdoutPercent === 0 && lift.heldOut === 0 ? (
        <p className="meta">{t('liftNoHoldout')}</p>
      ) : !enough ? (
        <p className="meta">{t('liftTooFew')}</p>
      ) : null}
    </div>
  );
}

export function SaveBar({
  dirty,
  saving,
  canSave,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
}) {
  const t = useT('marketingRetention');
  return (
    <div className={`pay-save${dirty ? ' is-dirty' : ''}`}>
      <button type="button" onClick={onSave} disabled={saving || !dirty || !canSave}>
        {saving ? t('saving') : t('save')}
      </button>
      <span className="meta">{dirty ? t('unsaved') : t('auditNote')}</span>
    </div>
  );
}

export function usd(amount: string, locale: string): string {
  const value = Number(amount);
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-u-nu-latn' : 'en', {
    style: 'currency',
    currency: 'USD',
  }).format(Number.isFinite(value) ? value : 0);
}
