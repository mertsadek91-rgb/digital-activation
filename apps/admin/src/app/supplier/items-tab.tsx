'use client';

import {
  AI_BATCH_MAX_LINES,
  SUPPLIER_ITEM_FILTERS,
  type SupplierItemFilter,
  type SupplierItems,
  type SupplierItemView,
} from '@da/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useAdminLocale, useT } from '../../i18n/provider';
import { supplierApi } from '../../lib/supplier-api';

import { AiBatchPanel, useAiBatch } from './ai-batch';
import { CreateFromLine } from './create-from-line';
import { formatDay, usd } from './format';

/**
 * Every line read from the sheet, with what state it is in.
 *
 * "Create product" opens its panel above the table, not inside a row: a row
 * lives in the table's horizontal scroller, and a form there was cut off on
 * every width below the table's own (REV-0150).
 *
 * "Create with AI" does all of it in one press, for one line or for the
 * ticked ones (TASK-0150): the server works through them in turn and the
 * panel above the table shows where each is.
 */
export function ItemsTab({
  canCreate,
  onCreated,
}: {
  canCreate: boolean;
  onCreated: (slug: string) => void;
}) {
  const t = useT('supplier');
  const c = useT('common');
  const locale = useAdminLocale();
  const [filter, setFilter] = useState<SupplierItemFilter>('all');
  const [q, setQ] = useState('');
  const [data, setData] = useState<SupplierItems | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<SupplierItemView | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setData(await supplierApi.items(filter, q.trim() || undefined));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    }
  }, [filter, q, t]);

  const ai = useAiBatch(() => void load());

  useEffect(() => {
    const timer = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  /** A line the AI can make a product from: no product yet, still in the sheet, not queued. */
  const eligible = (item: SupplierItemView) =>
    canCreate && item.links.length === 0 && !item.missingSince && !ai.pending.has(item.id);
  const choosable = (data?.items ?? []).filter(eligible);
  const chosen = choosable.filter((item) => selected.has(item.id)).map((item) => item.id);

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on && next.size < AI_BATCH_MAX_LINES) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function createWithAi(ids: string[]) {
    if (await ai.start(ids)) {
      setSelected(new Set());
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function closeCreate() {
    const id = creating?.id;
    setCreating(null);
    // Back to the button that opened it.
    if (id) requestAnimationFrame(() => document.getElementById(`create-${id}`)?.focus());
  }

  return (
    <section>
      <div className="supplier-toolbar">
        <div className="supplier-filters" role="group" aria-label={t('tabItems')}>
          {SUPPLIER_ITEM_FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              className={`chip${filter === key ? ' is-active' : ''}`}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {t(`filter_${key}`)}
              {data ? <span className="tab-count">{data.counts[key]}</span> : null}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="search"
          aria-label={t('search')}
          placeholder={t('search')}
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>

      {canCreate ? (
        <div className="supplier-toolbar ai-batch-bar">
          <span className="meta">
            {ai.ready ? t('batchCost', { max: AI_BATCH_MAX_LINES }) : t('batchNotReady')}
          </span>
          <div className="supplier-actions">
            {chosen.length > 0 ? (
              <button type="button" className="ghost" onClick={() => setSelected(new Set())}>
                {t('batchClear')}
              </button>
            ) : null}
            <button
              type="button"
              disabled={!ai.ready || ai.busy || chosen.length === 0}
              onClick={() => void createWithAi(chosen)}
            >
              {t('batchCreateSelected', { count: chosen.length })}
            </button>
          </div>
        </div>
      ) : null}

      <AiBatchPanel control={ai} onCard={onCreated} />
      {ai.error && !ai.batch ? (
        <p className="error" role="alert" dir="auto">
          {ai.error}
        </p>
      ) : null}

      {creating ? (
        <div className="card supplier-create-card">
          <CreateFromLine item={creating} onCancel={closeCreate} onDone={onCreated} />
        </div>
      ) : null}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {!data ? (
        <p className="meta">{c('loading')}</p>
      ) : (
        <div className="table-scroll">
          <table className="admin-table supplier-table">
            <thead>
              <tr>
                {canCreate ? (
                  <th className="supplier-pick">
                    <label className="supplier-tick">
                      <input
                        type="checkbox"
                        aria-label={t('batchSelectAll', { max: AI_BATCH_MAX_LINES })}
                        title={t('batchSelectAll', { max: AI_BATCH_MAX_LINES })}
                        disabled={choosable.length === 0}
                        checked={
                          chosen.length > 0 &&
                          chosen.length === Math.min(choosable.length, AI_BATCH_MAX_LINES)
                        }
                        onChange={(event) =>
                          setSelected(
                            new Set(
                              event.target.checked
                                ? choosable.slice(0, AI_BATCH_MAX_LINES).map((item) => item.id)
                                : [],
                            ),
                          )
                        }
                      />
                    </label>
                  </th>
                ) : null}
                <th className="num">{t('colRow')}</th>
                <th>{t('colName')}</th>
                <th>{t('colCategory')}</th>
                <th className="num">{t('colCost')}</th>
                <th>{t('colWarranty')}</th>
                <th>{t('colRemarks')}</th>
                <th>{t('colState')}</th>
                <th>{t('colLinks')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  locale={locale}
                  active={creating?.id === item.id}
                  queued={ai.pending.has(item.id)}
                  pick={
                    canCreate
                      ? {
                          enabled: eligible(item),
                          checked: selected.has(item.id) && eligible(item),
                          onChange: (on) => toggle(item.id, on),
                        }
                      : null
                  }
                  onAi={
                    eligible(item) && ai.ready && !ai.busy
                      ? () => void createWithAi([item.id])
                      : null
                  }
                  onCreate={
                    canCreate && item.links.length === 0 && !item.missingSince
                      ? () => {
                          setCreating(item);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                      : null
                  }
                />
              ))}
              {data.items.length === 0 ? (
                <tr>
                  <td colSpan={canCreate ? 9 : 8} className="meta">
                    {t('itemsEmpty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ItemRow({
  item,
  locale,
  active,
  queued,
  pick,
  onAi,
  onCreate,
}: {
  item: SupplierItemView;
  locale: 'ar' | 'en';
  active: boolean;
  /** In the AI batch and not finished yet. */
  queued: boolean;
  pick: { enabled: boolean; checked: boolean; onChange: (on: boolean) => void } | null;
  onAi: (() => void) | null;
  onCreate: (() => void) | null;
}) {
  const t = useT('supplier');
  const classes = [item.missingSince ? 'is-muted' : '', active ? 'is-selected' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <tr className={classes || undefined}>
      {pick ? (
        <td className="supplier-pick">
          {pick.enabled ? (
            <label className="supplier-tick">
              <input
                type="checkbox"
                aria-label={t('batchSelectLine', { name: item.name })}
                checked={pick.checked}
                onChange={(event) => pick.onChange(event.target.checked)}
              />
            </label>
          ) : null}
        </td>
      ) : null}
      <td className="num">{item.rowNumber ?? '—'}</td>
      <td dir="ltr" className={item.outOfStock ? 'supplier-struck' : undefined}>
        {item.name}
      </td>
      <td dir="ltr">{item.category ?? '—'}</td>
      <td className="num" dir="ltr">
        {item.costUsd ? usd(item.costUsd) : <span className="meta">{t('noCost')}</span>}
      </td>
      <td dir="ltr">{item.warranty ?? '—'}</td>
      <td dir="ltr">{item.remarks ?? ''}</td>
      <td>
        <span className="supplier-states">
          {item.missingSince ? (
            <span className="pill pill-neutral">
              {t('stateMissing', { date: formatDay(item.missingSince, locale) })}
            </span>
          ) : item.outOfStock ? (
            <span className="pill pill-danger">{t('stateOut')}</span>
          ) : (
            <span className="pill pill-success">{t('stateOk')}</span>
          )}
          {item.partialStrike ? (
            <span className="pill pill-warning">{t('statePartial')}</span>
          ) : null}
          {item.wholesaleOnly ? (
            <span className="pill pill-info">{t('stateWholesale')}</span>
          ) : null}
          {item.changedAt ? (
            <span className="pill pill-info">
              {t('stateChanged', { date: formatDay(item.changedAt, locale) })}
            </span>
          ) : null}
        </span>
      </td>
      <td>
        {/* Wraps in a narrow column: the two create buttons side by side
            pushed the table past its scroller at 1024–1440 (REV-0209). */}
        <div className="supplier-row-actions">
          {item.links.map((link) => (
            <Link
              key={link.variantId}
              href={`/products/${encodeURIComponent(link.productSlug)}`}
              dir="ltr"
              className="supplier-sku"
            >
              {link.sku}
            </Link>
          ))}
          {queued ? <span className="pill pill-info">{t('batchState_RUNNING')}</span> : null}
          {onAi ? (
            <button type="button" className="btn-sm" onClick={onAi}>
              {t('batchCreateOne')}
            </button>
          ) : null}
          {onCreate && !queued ? (
            <button
              id={`create-${item.id}`}
              type="button"
              className="ghost btn-sm"
              aria-pressed={active}
              onClick={onCreate}
            >
              {t('createFromLine')}
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
