'use client';

import type { DraftProduct, SupplierItemView } from '@da/contracts';
import { useState } from 'react';

import { useT } from '../../i18n/provider';
import { api } from '../../lib/api';
import { supplierAiApi } from '../../lib/supplier-api';

/**
 * A new draft product from one sheet line.
 *
 * The model proposes the identity (names, slug, terms) from the line's name;
 * the price is cost × markup from the source settings. A person checks every
 * field, and creating goes through the ordinary create endpoint as a DRAFT.
 * The new variant is then linked to the line, and the copy step opens.
 */
export function CreateFromLine({
  item,
  onDone,
  onCancel,
}: {
  item: SupplierItemView;
  onDone: (slug: string) => void;
  onCancel: () => void;
}) {
  const t = useT('supplier');
  const p = useT('products');
  const c = useT('common');
  const [draft, setDraft] = useState<DraftProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function propose() {
    setBusy(true);
    setError(null);
    try {
      setDraft(await supplierAiApi.draft(item.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createProduct({
        slug: draft.slug,
        kind: draft.kind,
        nameAr: draft.nameAr,
        nameEn: draft.nameEn,
        ...(draft.brandId ? { brandId: draft.brandId } : {}),
        categoryIds: draft.categoryIds,
        variant: {
          sku: draft.sku,
          priceUsd: draft.priceUsd,
          licensePeriodUnit: draft.licensePeriodUnit,
          licensePeriodValue: draft.licensePeriodValue,
          deviceCount: draft.deviceCount,
          platform: draft.platform,
          activationMethod: draft.activationMethod,
          fulfillmentMode: 'ON_DEMAND',
        },
      });
      await supplierAiApi.linkBySku(item.id, created.sku);
      onDone(created.slug);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof DraftProduct>(key: K, value: DraftProduct[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  return (
    <div className="create-from-line">
      <p className="meta" dir="ltr">
        {item.name}
      </p>
      {!draft ? (
        <div className="supplier-actions">
          <button type="button" autoFocus disabled={busy} onClick={() => void propose()}>
            {busy ? t('aiGenerating') : t('createPropose')}
          </button>
          <button type="button" className="ghost" aria-label={c('cancel')} onClick={onCancel}>
            ✕
          </button>
        </div>
      ) : (
        <div className="supplier-form">
          {draft.notes.length > 0 ? (
            <ul className="notice supplier-skips">
              {draft.notes.map((line) => (
                <li key={line} dir="auto">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="supplier-form-row">
            <label className="field">
              <span>{t('createNameAr')}</span>
              {/* Focus lands here once the proposal replaces the button. */}
              <input
                dir="rtl"
                autoFocus
                value={draft.nameAr}
                onChange={(event) => set('nameAr', event.target.value)}
              />
            </label>
            <label className="field">
              <span>{t('createNameEn')}</span>
              <input
                dir="ltr"
                value={draft.nameEn}
                onChange={(event) => set('nameEn', event.target.value)}
              />
            </label>
          </div>
          <div className="supplier-form-row">
            <label className="field">
              <span>{t('createSlug')}</span>
              <input
                dir="ltr"
                value={draft.slug}
                onChange={(event) => set('slug', event.target.value)}
              />
            </label>
            <label className="field">
              <span>{t('createSku')}</span>
              <input
                dir="ltr"
                value={draft.sku}
                onChange={(event) => set('sku', event.target.value.toUpperCase())}
              />
            </label>
            <label className="field">
              <span>{t('createPrice')}</span>
              <input
                dir="ltr"
                value={draft.priceUsd}
                onChange={(event) => set('priceUsd', event.target.value)}
              />
            </label>
          </div>
          <p className="meta">
            {p(`kind_${draft.kind}`)} ·{' '}
            {draft.licensePeriodUnit === 'LIFETIME'
              ? p('unit_LIFETIME')
              : `${String(draft.licensePeriodValue ?? 1)} ${p(`unit_${draft.licensePeriodUnit}`)}`}{' '}
            · {t('createDevices', { count: draft.deviceCount })} · {p(`platform_${draft.platform}`)}{' '}
            · {p(`activation_${draft.activationMethod}`)} · <bdi dir="ltr">{draft.model}</bdi>
          </p>
          <p className="meta">{t('createTermsHint')}</p>
          <div className="supplier-actions">
            <button type="button" disabled={busy} onClick={() => void create()}>
              {t('createSubmit')}
            </button>
            <button
              type="button"
              className="ghost"
              aria-label={c('cancel')}
              disabled={busy}
              onClick={onCancel}
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
