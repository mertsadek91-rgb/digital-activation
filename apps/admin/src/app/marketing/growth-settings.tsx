'use client';

import type { MarketingSettings } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api, ApiError } from '../../lib/api';
import { messageOf } from '../content/shared';

type GrowthFeature = 'business' | 'welcome' | 'referral';

/** Same list as the overview; kept here so a page module exports only its page. */
export const GROWTH_ROLES = ['OWNER', 'ADMIN', 'MARKETING'];

/**
 * One feature's settings document: load it, edit a copy, save the whole thing.
 *
 * The API validates against the feature's schema and answers with the stored
 * value, which replaces the draft — so what the screen shows after a save is
 * what the store will use, defaults filled in, not what was typed.
 */
export function useFeatureSettings<F extends GrowthFeature>(feature: F, enabled: boolean) {
  const router = useRouter();
  const c = useT('common');
  const [draft, setDraft] = useState<MarketingSettings[F] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const all = await api.marketingSettings();
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

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  function patch(change: Partial<MarketingSettings[F]>): void {
    setSaved(false);
    setDraft((current) => (current ? { ...current, ...change } : current));
  }

  async function save(): Promise<void> {
    if (!draft) return;
    setSaving(true);
    setSaved(false);
    try {
      setDraft(await api.setMarketingSettings(feature, draft));
      setSaved(true);
      setError(null);
    } catch (caught) {
      setError(messageOf(caught, c('actionFailed')));
    } finally {
      setSaving(false);
    }
  }

  return { draft, patch, save, saving, saved, error };
}

/** A number input that keeps the draft numeric; an empty box reads as 0. */
export function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        dir="ltr"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}
