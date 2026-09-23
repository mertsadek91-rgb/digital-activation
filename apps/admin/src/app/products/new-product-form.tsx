'use client';

import type { CreateProduct, CreateVariant, ProductIdentity } from '@da/contracts';
import { useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api } from '../../lib/api';

/**
 * A new product, and the one variant that makes it a product.
 *
 * Every product in this catalog arrived from a migration script; there was no
 * way to sell something the old WordPress store had not sold, which is a
 * strange limit for a shop.
 *
 * The form asks for six things and no more. A product needs a name, an
 * address, a price and a licence term to exist; the description, the images,
 * the SEO copy and the rest are what the other drawers are for, and asking for
 * all of it at once would make adding a product a twenty-minute job that gets
 * postponed.
 */

const KINDS = ['KEY', 'ACCOUNT', 'PANEL', 'BUNDLE', 'SERVICE'] as const;
const PERIOD_UNITS = ['LIFETIME', 'YEAR', 'MONTH', 'DAY'] as const;
const SUPPLY = ['ON_DEMAND', 'FROM_STOCK', 'MANUAL_SETUP'] as const;

/**
 * A URL suggestion from the English name.
 *
 * English only: the slug is the product's public address and this catalog's
 * addresses are Latin — `windows-11-pro`, not a percent-encoded Arabic phrase
 * a hundred and forty characters long. An Arabic-only name leaves the field
 * empty and the person types it, which is the honest outcome.
 */
function suggestSlug(nameEn: string): string {
  return nameEn
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function NewProductForm({
  onCreated,
  onError,
  onCancel,
}: {
  onCreated: (slug: string) => void;
  onError: (message: string) => void;
  onCancel: () => void;
}) {
  const t = useT('products');
  const c = useT('common');

  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [kind, setKind] = useState<CreateProduct['kind']>('KEY');
  const [brandId, setBrandId] = useState('');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);

  const [sku, setSku] = useState('');
  const [priceUsd, setPriceUsd] = useState('');
  const [unit, setUnit] = useState<CreateVariant['licensePeriodUnit']>('LIFETIME');
  const [periodValue, setPeriodValue] = useState(1);
  const [supply, setSupply] = useState<CreateVariant['fulfillmentMode']>('ON_DEMAND');

  const [lists, setLists] = useState<Pick<ProductIdentity, 'brands' | 'categories'> | null>(null);
  const [saving, setSaving] = useState(false);

  // The brand and category lists come from any product's identity — they are
  // the same two lists whichever product is asked, and there is no product yet.
  useEffect(() => {
    void (async () => {
      try {
        const products = await api.products({ perPage: 1 });
        const first = products.rows[0];
        if (!first) return;
        const identity = await api.productIdentity(first.slug);
        setLists({ brands: identity.brands, categories: identity.categories });
      } catch {
        // A missing picker is not worth an error banner: brand and section are
        // both optional here and both editable afterwards.
      }
    })();
  }, []);

  const effectiveSlug = slugTouched ? slug : suggestSlug(nameEn);
  const ready =
    nameAr.trim().length >= 2 &&
    effectiveSlug.length >= 2 &&
    sku.trim().length >= 3 &&
    priceUsd.trim() !== '';

  async function create(): Promise<void> {
    setSaving(true);
    try {
      const created = await api.createProduct({
        slug: effectiveSlug,
        kind,
        nameAr: nameAr.trim(),
        ...(nameEn.trim() ? { nameEn: nameEn.trim() } : {}),
        ...(brandId ? { brandId } : {}),
        categoryIds,
        variant: {
          sku: sku.trim().toUpperCase(),
          priceUsd: priceUsd.trim(),
          licensePeriodUnit: unit,
          licensePeriodValue: unit === 'LIFETIME' ? null : periodValue,
          deviceCount: 1,
          platform: 'WINDOWS',
          activationMethod: 'RETAIL_ONLINE',
          fulfillmentMode: supply,
        },
      });
      onCreated(created.slug);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : c('actionFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="new-product">
      <h2>{t('newProductHeading')}</h2>
      <p className="lede-sm">{t('newProductLede')}</p>

      <div className="terms-grid">
        <label>
          <span>{t('nameAr')} *</span>
          <input
            id="new-name-ar"
            type="text"
            dir="rtl"
            value={nameAr}
            onChange={(event) => setNameAr(event.target.value)}
          />
        </label>
        <label>
          <span>{t('nameEn')}</span>
          <input
            id="new-name-en"
            type="text"
            dir="ltr"
            value={nameEn}
            onChange={(event) => setNameEn(event.target.value)}
          />
        </label>

        <label>
          <span>{t('slugLabel')} *</span>
          <input
            id="new-slug"
            type="text"
            dir="ltr"
            value={effectiveSlug}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.target.value);
            }}
          />
          <small>{t('newSlugHint')}</small>
        </label>

        <label>
          <span>{t('kind')}</span>
          <select
            id="new-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as CreateProduct['kind'])}
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
            id="new-brand"
            value={brandId}
            onChange={(event) => setBrandId(event.target.value)}
          >
            <option value="">{t('noBrand')}</option>
            {(lists?.brands ?? []).map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {lists && lists.categories.length > 0 ? (
        <fieldset className="category-picker">
          <legend>{t('categories')}</legend>
          <div className="category-chips">
            {lists.categories.map((category) => {
              const on = categoryIds.includes(category.id);
              return (
                <button
                  key={category.id}
                  type="button"
                  className={`chip${on ? ' is-active' : ''}`}
                  aria-pressed={on}
                  onClick={() =>
                    setCategoryIds(
                      on
                        ? categoryIds.filter((id) => id !== category.id)
                        : [...categoryIds, category.id],
                    )
                  }
                >
                  {category.name}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <h3>{t('firstVariantHeading')}</h3>
      <p className="lede-sm">{t('firstVariantLede')}</p>

      <div className="terms-grid">
        <label>
          <span>SKU *</span>
          <input
            id="new-sku"
            type="text"
            dir="ltr"
            value={sku}
            onChange={(event) => setSku(event.target.value.toUpperCase())}
          />
          <small>{t('skuHint')}</small>
        </label>

        <label>
          <span>{t('price')} *</span>
          <input
            id="new-price"
            type="text"
            inputMode="decimal"
            dir="ltr"
            value={priceUsd}
            onChange={(event) => setPriceUsd(event.target.value)}
          />
        </label>

        <label>
          <span>{t('periodUnit')}</span>
          <select
            id="new-unit"
            value={unit}
            onChange={(event) => setUnit(event.target.value as CreateVariant['licensePeriodUnit'])}
          >
            {PERIOD_UNITS.map((value) => (
              <option key={value} value={value}>
                {t(`unit_${value}`)}
              </option>
            ))}
          </select>
        </label>

        {unit === 'LIFETIME' ? null : (
          <label>
            <span>{t('periodValue')}</span>
            <input
              id="new-period"
              type="number"
              min={1}
              max={120}
              dir="ltr"
              value={periodValue}
              onChange={(event) => setPeriodValue(Number(event.target.value))}
            />
          </label>
        )}

        <label>
          <span>{t('supplyMode')}</span>
          <select
            id="new-supply"
            value={supply}
            onChange={(event) => setSupply(event.target.value as CreateVariant['fulfillmentMode'])}
          >
            {SUPPLY.map((value) => (
              <option key={value} value={value}>
                {t(`supply_${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="notice">{t('newProductDraftNote')}</p>

      <div className="terms-save">
        <button type="button" onClick={() => void create()} disabled={!ready || saving}>
          {saving ? c('loading') : t('createProduct')}
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          {c('cancel')}
        </button>
      </div>
    </section>
  );
}
