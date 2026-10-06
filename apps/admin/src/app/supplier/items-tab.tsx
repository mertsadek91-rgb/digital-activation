'use client';

import {
  SUPPLIER_ITEM_FILTERS,
  type SupplierItemFilter,
  type SupplierItems,
  type SupplierItemView,
} from '@da/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useAdminLocale, useT } from '../../i18n/provider';
import { supplierApi } from '../../lib/supplier-api';

import { CreateFromLine } from './create-from-line';
import { formatDay, usd } from './format';

/** Every line read from the sheet, with what state it is in. */
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
  const [creating, setCreating] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await supplierApi.items(filter, q.trim() || undefined));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    }
  }, [filter, q, t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  return (
    <section>
      <div className="supplier-toolbar">
        <div className="supplier-filters" role="group">
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
          placeholder={t('search')}
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>

      {error ? <p className="error">{error}</p> : null}
      {!data ? (
        <p className="meta">{c('loading')}</p>
      ) : (
        <div className="table-scroll">
          <table className="admin-table supplier-table">
            <thead>
              <tr>
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
                  creating={creating === item.id}
                  onCreate={
                    canCreate && item.links.length === 0 && !item.missingSince
                      ? () => setCreating(item.id)
                      : null
                  }
                  onCancel={() => setCreating(null)}
                  onCreated={onCreated}
                />
              ))}
              {data.items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="meta">
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
  creating,
  onCreate,
  onCancel,
  onCreated,
}: {
  item: SupplierItemView;
  locale: 'ar' | 'en';
  creating: boolean;
  onCreate: (() => void) | null;
  onCancel: () => void;
  onCreated: (slug: string) => void;
}) {
  const t = useT('supplier');
  if (creating) {
    return (
      <tr>
        <td colSpan={8}>
          <CreateFromLine item={item} onCancel={onCancel} onDone={onCreated} />
        </td>
      </tr>
    );
  }
  return (
    <tr className={item.missingSince ? 'is-muted' : undefined}>
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
        {item.links.map((link) => (
          <Link
            key={link.variantId}
            href={`/products/${encodeURIComponent(link.productSlug)}`}
            dir="ltr"
          >
            {link.sku}
          </Link>
        ))}
        {onCreate ? (
          <button type="button" className="ghost btn-sm" onClick={onCreate}>
            {t('createFromLine')}
          </button>
        ) : null}
      </td>
    </tr>
  );
}
