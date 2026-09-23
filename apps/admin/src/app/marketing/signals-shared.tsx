'use client';

import type { LocalizedText, MarketingFeature, MarketingSettings, StaffMe } from '@da/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api, ApiError } from '../../lib/api';
import { messageOf, useStaff } from '../content/shared';
import { Nav } from '../nav';

import { MARKETING_ROLES } from './page';

import './signals.css';

/**
 * Loading, editing and saving one marketing feature's document, for the
 * trust, review-request and purchase-notice screens.
 *
 * The whole document is saved, never a field, because that is what the API
 * validates and audits: a before and after of the feature as a unit.
 */
export function useFeatureSettings<F extends MarketingFeature>(feature: F) {
  const router = useRouter();
  const me = useStaff();
  const c = useT('common');
  const t = useT('marketingSignals');
  const [saved, setSaved] = useState<MarketingSettings[F] | null>(null);
  const [draft, setDraft] = useState<MarketingSettings[F] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const all = await api.marketingSettings();
      setSaved(all[feature]);
      setDraft(all[feature]);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(messageOf(caught, c('actionFailed')));
    }
  }, [feature, router, c]);

  const allowed = me ? MARKETING_ROLES.includes(me.role) : false;

  useEffect(() => {
    if (me && allowed) void load();
  }, [me, allowed, load]);

  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);

  async function save(): Promise<boolean> {
    if (!draft) return false;
    setSaving(true);
    setNote(null);
    try {
      const next = await api.setMarketingSettings(feature, draft);
      setSaved(next);
      setDraft(next);
      setError(null);
      setNote(t('savedNote'));
      return true;
    } catch (caught) {
      setError(messageOf(caught, c('actionFailed')));
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { me, allowed, draft, setDraft, saved, dirty, save, saving, error, note };
}

/** The frame every trust-signal screen shares: title, back link, save bar. */
export function SignalsFrame({
  me,
  allowed,
  title,
  lede,
  error,
  note,
  children,
  saveBar,
}: {
  me: StaffMe | null;
  allowed: boolean;
  title: string;
  lede: string;
  error: string | null;
  note: string | null;
  children: ReactNode;
  saveBar: ReactNode;
}) {
  const c = useT('common');
  const t = useT('marketingSignals');
  if (!me) return <div className="admin-layout">{c('loading')}</div>;

  return (
    <Nav me={me} current="marketing">
      <div className="queue-head">
        <p className="signals-back">
          <Link href="/marketing">{t('back')}</Link>
        </p>
        <h1>{title}</h1>
        <p className="who">{lede}</p>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="ok-note">{note}</p> : null}
      {!allowed ? <p className="notice">{t('noAccess')}</p> : null}
      {allowed ? (
        <>
          {children}
          {saveBar}
        </>
      ) : null}
    </Nav>
  );
}

export function SaveBar({
  dirty,
  saving,
  invalid,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  /** A reason the form cannot be saved yet, shown instead of the audit note. */
  invalid: string | null;
  onSave: () => void;
}) {
  const c = useT('common');
  const t = useT('marketingSignals');
  return (
    <div className={`pay-save${dirty ? ' is-dirty' : ''}`}>
      <button type="button" onClick={onSave} disabled={saving || !dirty || invalid !== null}>
        {saving ? c('busy') : c('save')}
      </button>
      <span className={invalid ? 'meta meta-warn' : 'meta'}>
        {invalid ?? (dirty ? t('unsaved') : t('auditNote'))}
      </span>
    </div>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="signals-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        {hint ? <span className="meta">{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * A whole-number field. Held as text while typing so a cleared box is not
 * snapped back to 0 under the cursor; the parent sees a number or NaN.
 */
export function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : '');
  useEffect(() => {
    // Follow outside changes (a load, a save) without fighting the keyboard.
    setText((current) => (Number(current) === value ? current : String(value)));
  }, [value]);

  return (
    <label className="signals-number">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={text}
        dir="ltr"
        onChange={(event) => {
          setText(event.target.value);
          onChange(event.target.value === '' ? Number.NaN : Number(event.target.value));
        }}
      />
      {hint ? <span className="meta">{hint}</span> : null}
    </label>
  );
}

/** True when `value` is a whole number in [min, max]. */
export function inRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** Arabic and English boxes for one piece of storefront copy. */
export function LocalizedField({
  title,
  hint,
  value,
  onChange,
}: {
  title: string;
  hint: string;
  value: LocalizedText;
  onChange: (next: LocalizedText) => void;
}) {
  const t = useT('marketingSignals');
  return (
    <div className="pay-localised">
      <p className="pay-localised-head">
        {title} <span className="meta">{hint}</span>
      </p>
      <label>
        {t('arabic')}
        <textarea
          rows={2}
          maxLength={500}
          value={value.ar}
          dir="rtl"
          onChange={(event) => onChange({ ...value, ar: event.target.value })}
        />
      </label>
      <label>
        {t('english')}
        <textarea
          rows={2}
          maxLength={500}
          value={value.en}
          dir="ltr"
          onChange={(event) => onChange({ ...value, en: event.target.value })}
        />
      </label>
    </div>
  );
}
