'use client';

import type { ProductIdentity, SetProductIdentity } from '@da/contracts';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api } from '../../lib/api';

/** The five things a product can be. */
const KINDS = ['KEY', 'ACCOUNT', 'PANEL', 'BUNDLE', 'SERVICE'] as const;

/**
 * What a product is: its name, its URL, its brand and the sections it sits in.
 *
 * The slug is the dangerous one and it is treated as such. It is the product's
 * public address — in Google, in a customer's email, in whatever the old store
 * linked from — so the field is locked until somebody asks for it, and saving
 * it writes the 301 in the same transaction as the rename. A renamed product
 * is a redirect, never a dead end.
 */
export function IdentityForm({
  slug,
  canWrite,
  onSaved,
  onError,
}: {
  slug: string;
  canWrite: boolean;
  /** Called with the new slug when it changed, so the list can follow it. */
  onSaved: (nextSlug: string) => void;
  onError: (message: string) => void;
}) {
  const t = useT('products');
  const c = useT('common');
  const [data, setData] = useState<ProductIdentity | null>(null);
  const [draft, setDraft] = useState<ProductIdentity | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const loaded = await api.productIdentity(slug);
      setData(loaded);
      setDraft(loaded);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : c('actionFailed'));
    }
  }, [slug, onError, c]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data || !draft) return <p className="meta">{c('loading')}</p>;

  const set = <K extends keyof ProductIdentity>(key: K, value: ProductIdentity[K]): void =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  function patch(): SetProductIdentity {
    if (!data || !draft) return {};
    const body: SetProductIdentity = {};
    if (renaming && draft.slug !== data.slug) body.slug = draft.slug;
    if (draft.kind !== data.kind) body.kind = draft.kind;
    if (draft.brandId !== data.brandId) body.brandId = draft.brandId;
    if (draft.primaryCategoryId !== data.primaryCategoryId)
      body.primaryCategoryId = draft.primaryCategoryId;
    if (draft.hasGoldenWarranty !== data.hasGoldenWarranty)
      body.hasGoldenWarranty = draft.hasGoldenWarranty;
    if (draft.nameAr !== data.nameAr) body.nameAr = draft.nameAr;
    if (draft.nameEn !== data.nameEn) body.nameEn = draft.nameEn;
    const sameCategories =
      draft.categoryIds.length === data.categoryIds.length &&
      draft.categoryIds.every((id) => data.categoryIds.includes(id));
    if (!sameCategories) body.categoryIds = draft.categoryIds;
    return body;
  }

  const body = patch();
  const dirty = Object.keys(body).length > 0;

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const next = await api.setProductIdentity(slug, body);
      setData(next);
      setDraft(next);
      setRenaming(false);
      onSaved(next.slug);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : c('actionFailed'));
    } finally {
      setSaving(false);
    }
  }

  function toggleCategory(id: string): void {
    const has = draft?.categoryIds.includes(id) ?? false;
    const next = has
      ? (draft?.categoryIds ?? []).filter((value) => value !== id)
      : [...(draft?.categoryIds ?? []), id];
    set('categoryIds', next);
    // A primary category the product is no longer in would be refused by the
    // server; clearing it here means the refusal never has to happen.
    if (has && draft?.primaryCategoryId === id) set('primaryCategoryId', null);
  }

  return (
    <div className="identity-form">
      <h3>{t('identityHeading')}</h3>
      <p className="lede-sm">{t('identityLede')}</p>

      <div className="terms-grid">
        <label>
          <span>{t('nameAr')}</span>
          <input
            id={`name-ar-${data.slug}`}
            type="text"
            dir="rtl"
            value={draft.nameAr}
            disabled={!canWrite}
            onChange={(event) => set('nameAr', event.target.value)}
          />
        </label>
        <label>
          <span>{t('nameEn')}</span>
          <input
            id={`name-en-${data.slug}`}
            type="text"
            dir="ltr"
            value={draft.nameEn}
            disabled={!canWrite}
            onChange={(event) => set('nameEn', event.target.value)}
          />
        </label>

        <label>
          <span>{t('kind')}</span>
          <select
            id={`kind-${data.slug}`}
            value={draft.kind}
            disabled={!canWrite}
            onChange={(event) => set('kind', event.target.value as ProductIdentity['kind'])}
          >
            {KINDS.map((value) => (
              <option key={value} value={value}>
                {t(`kind_${value}`)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{t('brand')}</span>
          <select
            id={`brand-${data.slug}`}
            value={draft.brandId ?? ''}
            disabled={!canWrite}
            onChange={(event) => set('brandId', event.target.value || null)}
          >
            <option value="">{t('noBrand')}</option>
            {data.brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{t('primaryCategory')}</span>
          <select
            id={`primary-${data.slug}`}
            value={draft.primaryCategoryId ?? ''}
            disabled={!canWrite}
            onChange={(event) => set('primaryCategoryId', event.target.value || null)}
          >
            <option value="">{t('noPrimaryCategory')}</option>
            {data.categories
              .filter((category) => draft.categoryIds.includes(category.id))
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </select>
          <small>{t('primaryCategoryHint')}</small>
        </label>
      </div>

      <fieldset className="category-picker">
        <legend>{t('categories')}</legend>
        <div className="category-chips">
          {data.categories.map((category) => {
            const on = draft.categoryIds.includes(category.id);
            return (
              <button
                key={category.id}
                type="button"
                className={`chip${on ? ' is-active' : ''}`}
                disabled={!canWrite}
                aria-pressed={on}
                onClick={() => toggleCategory(category.id)}
              >
                {category.name}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="check">
        <input
          id={`warranty-${data.slug}`}
          type="checkbox"
          checked={draft.hasGoldenWarranty}
          disabled={!canWrite}
          onChange={(event) => set('hasGoldenWarranty', event.target.checked)}
        />
        <span>{t('goldenWarranty')}</span>
      </label>

      {/* The address, behind a deliberate second step. */}
      <div className="slug-field">
        <span className="meta">{t('slugLabel')}</span>
        {renaming ? (
          <>
            <input
              id={`slug-${data.slug}`}
              type="text"
              dir="ltr"
              value={draft.slug}
              disabled={!canWrite}
              onChange={(event) => set('slug', event.target.value)}
            />
            <p className="meta-warn">
              {data.hasOrders ? t('slugWarnSold') : t('slugWarn')} {t('slugRedirectNote')}
            </p>
          </>
        ) : (
          <>
            <code dir="ltr">/store/{data.slug}</code>
            {canWrite ? (
              <button type="button" className="linky" onClick={() => setRenaming(true)}>
                {t('slugChange')}
              </button>
            ) : null}
          </>
        )}
      </div>

      {canWrite ? (
        <div className="terms-save">
          <button type="button" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? c('loading') : c('save')}
          </button>
          {dirty ? (
            <>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setDraft(data);
                  setRenaming(false);
                }}
              >
                {c('cancel')}
              </button>
              <span className="meta-warn">{t('termsUnsaved')}</span>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
