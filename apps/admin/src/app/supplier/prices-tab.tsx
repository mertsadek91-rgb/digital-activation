'use client';

import type { ApplySupplierPricesResult, SupplierPrices } from '@da/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { supplierApi } from '../../lib/supplier-api';

import { percent, usd } from './format';

/**
 * Price proposals: cost × (1 + markup) for every linked variant. Nothing
 * changes until a person presses apply — on one row, on the rows ticked, or
 * on all of them. The API recomputes every price from the stored cost; the
 * request only names variants.
 */
export function PricesTab({ isAdmin }: { isAdmin: boolean }) {
  const t = useT('supplier');
  const c = useT('common');
  const [data, setData] = useState<SupplierPrices | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplySupplierPricesResult | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await supplierApi.prices());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply(
    input: { variantIds?: string[]; all?: boolean },
    count: number,
    fromRowButton = false,
  ) {
    if (count > 1 && !window.confirm(t('confirmAll', { count }))) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // A row applied by its own button has been looked at; a large change
      // there needs no second confirmation. Ticked rows still do.
      const outcome = await supplierApi.applyPrices({
        ...input,
        confirmLarge: fromRowButton || confirmLarge,
      });
      setResult(outcome);
      setSelected(new Set());
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!data)
    return error ? (
      <p className="error" role="alert" dir="auto">
        {error}
      </p>
    ) : (
      <p className="meta">{c('loading')}</p>
    );
  if (data.rows.length === 0) return <p className="notice">{t('pricesEmpty')}</p>;

  const pending = data.rows.filter((row) => row.state === 'PENDING');
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section>
      <p className="lede-sm">{t('pricesLede')}</p>
      <div className="supplier-toolbar">
        <strong>{t('pendingCount', { count: data.pending })}</strong>
        {isAdmin ? (
          <div className="supplier-actions">
            <label className="check">
              <input
                type="checkbox"
                checked={confirmLarge}
                onChange={(event) => setConfirmLarge(event.target.checked)}
              />
              <span>{t('confirmLarge')}</span>
            </label>
            <button
              type="button"
              className="ghost"
              disabled={busy || selected.size === 0}
              onClick={() => void apply({ variantIds: [...selected] }, selected.size)}
            >
              {t('applySelected', { count: selected.size })}
            </button>
            <button
              type="button"
              disabled={busy || pending.length === 0}
              onClick={() => void apply({ all: true }, pending.length)}
            >
              {t('applyAll')}
            </button>
          </div>
        ) : (
          <p className="notice">{t('adminOnly')}</p>
        )}
      </div>

      {error ? (
        <p className="error" role="alert" dir="auto">
          {error}
        </p>
      ) : null}
      {result ? (
        <div className="ok-note" role="status">
          <p>{t('applied', { applied: result.applied.length, skipped: result.skipped.length })}</p>
          {result.skipped.length > 0 ? (
            <ul className="supplier-skips">
              {result.skipped.map((skip) => (
                <li key={skip.variantId}>
                  <span dir="ltr">{skip.sku || skip.variantId}</span>:{' '}
                  {t(`skipReason_${skip.reason}`)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="table-scroll">
        <table className="admin-table supplier-table">
          <thead>
            <tr>
              {isAdmin ? <th aria-label="select" /> : null}
              <th>{t('colProduct')}</th>
              <th>{t('colItem')}</th>
              <th className="num">{t('colCost')}</th>
              <th className="num">{t('colMarkup')}</th>
              <th className="num">{t('colCurrent')}</th>
              <th className="num">{t('colProposed')}</th>
              <th className="num">{t('colChange')}</th>
              <th>{t('colState')}</th>
              {isAdmin ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.variantId} className={row.state === 'PENDING' ? undefined : 'is-muted'}>
                {isAdmin ? (
                  <td>
                    {/* A padded label: an 18 px box alone is too small a target on a phone. */}
                    <label className="supplier-tick">
                      <input
                        type="checkbox"
                        aria-label={row.sku}
                        disabled={row.state !== 'PENDING'}
                        checked={selected.has(row.variantId)}
                        onChange={() => toggle(row.variantId)}
                      />
                    </label>
                  </td>
                ) : null}
                <td>
                  <Link href={`/products/${encodeURIComponent(row.productSlug)}`}>
                    <bdi>{row.productName}</bdi>
                  </Link>
                  <div className="meta">
                    <span dir="ltr" className="supplier-sku">
                      {row.sku}
                    </span>{' '}
                    · {row.terms}
                  </div>
                </td>
                <td dir="ltr">{row.itemName}</td>
                <td className="num" dir="ltr">
                  {usd(row.costUsd)}
                  {row.lastAppliedCostUsd && row.lastAppliedCostUsd !== row.costUsd ? (
                    <div className="meta" title={t('colLastCost')}>
                      <s>{usd(row.lastAppliedCostUsd)}</s>
                    </div>
                  ) : null}
                </td>
                <td className="num" dir="ltr">
                  {String(Number(row.markupPercent))}%{row.markupFromLink ? ' *' : ''}
                </td>
                <td className="num" dir="ltr">
                  {usd(row.currentPriceUsd)}
                </td>
                <td className="num" dir="ltr">
                  <strong>{usd(row.proposedPriceUsd)}</strong>
                </td>
                <td className={`num${row.large ? ' supplier-large' : ''}`} dir="ltr">
                  {percent(row.change)}
                </td>
                <td>
                  <span
                    className={`pill ${row.state === 'PENDING' ? 'pill-warning' : row.state === 'CURRENT' ? 'pill-success' : 'pill-neutral'}`}
                  >
                    {t(`state${row.state}`)}
                  </span>
                  {row.large ? <span className="pill pill-danger">{t('large')}</span> : null}
                </td>
                {isAdmin ? (
                  <td className="actions">
                    {row.state === 'PENDING' ? (
                      <button
                        type="button"
                        className="btn-sm"
                        disabled={busy}
                        onClick={() => void apply({ variantIds: [row.variantId] }, 1, true)}
                      >
                        {t('applyOne')}
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
