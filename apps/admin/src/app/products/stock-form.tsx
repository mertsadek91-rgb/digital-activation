'use client';

import type { ProductTerms } from '@da/contracts';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api } from '../../lib/api';

const REASONS = [
  { key: 'IMPORT', label: 'reasonImport' },
  { key: 'MANUAL_ADJUSTMENT', label: 'reasonManualAdjustment' },
  { key: 'REFUND', label: 'reasonRefund' },
  { key: 'REVOKED', label: 'reasonRevoked' },
  { key: 'EXPIRED', label: 'reasonExpired' },
] as const;

/**
 * Stock, per variant that holds any.
 *
 * The list screen could only set stock on a single-variant product, and did
 * it by assuming the SKU was the slug — an import-era coincidence that a
 * product created from the panel does not share. Here the variants are read
 * from the terms endpoint, so the SKU is the real one, and a product with
 * three stocked editions gets three counters rather than a note saying it has
 * several.
 *
 * Only `FROM_STOCK` variants are offered. A made-to-order variant has no shelf
 * and a counter on it would be a number nothing reads.
 */
export function StockForm({
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

  const stocked = data.variants.filter((variant) => variant.fulfillmentMode === 'FROM_STOCK');

  if (stocked.length === 0) {
    return <p className="notice">{t('stockNoneStocked')}</p>;
  }

  return (
    <div className="stock-list">
      {stocked.map((variant) => (
        <VariantStock
          key={variant.id}
          sku={variant.sku}
          onHand={variant.onHand}
          canWrite={canWrite}
          onSaved={() => {
            void load();
            onSaved();
          }}
          onError={onError}
        />
      ))}
    </div>
  );
}

/**
 * Single-variant stock entry.
 *
 * A reason is required, not optional: the counter alone cannot answer "where
 * did that key go", and that is the only question that matters when a licence
 * is missing.
 */
function VariantStock({
  sku,
  onHand,
  canWrite,
  onSaved,
  onError,
}: {
  sku: string;
  onHand: number;
  canWrite: boolean;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const t = useT('products');
  const c = useT('common');
  const [next, setNext] = useState(String(onHand));
  const [reason, setReason] = useState<string>('IMPORT');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNext(String(onHand));
  }, [onHand]);

  const parsed = Number.parseInt(next, 10);
  const dirty = Number.isFinite(parsed) && parsed !== onHand;

  return (
    <form
      className="stock-card variant-card"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void api
          .setInventory(sku, parsed, reason, note || undefined)
          .then(() => {
            setNote('');
            onSaved();
          })
          .catch((caught: unknown) => {
            onError(caught instanceof Error ? caught.message : t('stockSaveFailed'));
          })
          .finally(() => setBusy(false));
      }}
    >
      <header>
        <strong dir="ltr">{sku}</strong>
        <span className={`meta${onHand === 0 ? ' warn' : ''}`}>
          {t('stockOnHand', { count: onHand })}
        </span>
      </header>
      <div className="stock-fields">
        <label>
          {t('stockLabel')}
          <input
            type="number"
            min={0}
            value={next}
            dir="ltr"
            disabled={!canWrite}
            onChange={(event) => setNext(event.target.value)}
            required
          />
        </label>
        <label>
          {t('stockReason')}
          <select
            value={reason}
            disabled={!canWrite}
            onChange={(event) => setReason(event.target.value)}
          >
            {REASONS.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {t(entry.label)}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          {t('stockNote')}
          <input
            type="text"
            value={note}
            disabled={!canWrite}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('stockNotePlaceholder')}
          />
        </label>
        {canWrite ? (
          <button type="submit" disabled={busy || !dirty}>
            {busy ? c('busy') : c('saveShort')}
          </button>
        ) : null}
      </div>
    </form>
  );
}
