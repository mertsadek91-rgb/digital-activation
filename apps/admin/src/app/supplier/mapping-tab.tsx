'use client';

import type { SupplierItemView, SupplierMapping, SupplierMappingRow } from '@da/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useT } from '../../i18n/provider';
import { supplierApi } from '../../lib/supplier-api';

import { usd } from './format';

const FILTERS = ['all', 'unlinked', 'broken', 'linked'] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Our variants on one side, the sheet's lines on the other. A person picks
 * the line once; the link is saved and every later sync uses it. The API
 * offers the three nearest names as suggestions and never links on its own.
 */
export function MappingTab() {
  const t = useT('supplier');
  const c = useT('common');
  const [filter, setFilter] = useState<Filter>('unlinked');
  const [q, setQ] = useState('');
  const [data, setData] = useState<SupplierMapping | null>(null);
  const [lines, setLines] = useState<SupplierItemView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await supplierApi.mapping(filter, q.trim() || undefined));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    }
  }, [filter, q, t]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  useEffect(() => {
    supplierApi
      .items('all')
      .then((result) => setLines(result.items.filter((item) => !item.missingSince)))
      .catch(() => setLines([]));
  }, []);

  async function act(
    run: () => Promise<SupplierMappingRow>,
    message: (row: SupplierMappingRow) => string,
  ) {
    setError(null);
    setNote(null);
    try {
      const row = await run();
      setNote(message(row));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <section>
      <p className="lede-sm">{t('mappingLede')}</p>
      <div className="supplier-toolbar">
        <div className="supplier-filters" role="group">
          {FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              className={`chip${filter === key ? ' is-active' : ''}`}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {t(`mfilter_${key}`)}
              {data ? <span className="tab-count">{data.counts[key]}</span> : null}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="search"
          placeholder={c('search')}
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="ok-note">{note}</p> : null}

      {!data ? (
        <p className="meta">{c('loading')}</p>
      ) : (
        <div className="table-scroll">
          <table className="admin-table supplier-table mapping-table">
            <thead>
              <tr>
                <th>{t('colProduct')}</th>
                <th>{t('colTerms')}</th>
                <th className="num">{t('colPrice')}</th>
                <th>{t('colSheetLine')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <MappingRowView
                  key={row.variantId}
                  row={row}
                  lines={lines}
                  onLink={(itemId, markup, followStock) =>
                    void act(
                      () =>
                        supplierApi.setLink(row.variantId, {
                          itemId,
                          markupPercent: markup === '' ? null : Number(markup),
                          followStock,
                        }),
                      (saved) => t('linked', { sku: saved.sku }),
                    )
                  }
                  onUnlink={() =>
                    void act(
                      () => supplierApi.removeLink(row.variantId),
                      (saved) => t('unlinked', { sku: saved.sku }),
                    )
                  }
                />
              ))}
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="meta">
                    {t('mappingEmpty')}
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

function MappingRowView({
  row,
  lines,
  onLink,
  onUnlink,
}: {
  row: SupplierMappingRow;
  lines: SupplierItemView[];
  onLink: (itemId: string, markup: string, followStock: boolean) => void;
  onUnlink: () => void;
}) {
  const t = useT('supplier');
  const broken = row.link?.item.missingSince != null;
  const [picking, setPicking] = useState(!row.link || broken);
  const [search, setSearch] = useState('');
  const [itemId, setItemId] = useState(row.link && !broken ? row.link.item.id : '');
  const [markup, setMarkup] = useState(
    row.link?.markupPercent ? String(Number(row.link.markupPercent)) : '',
  );
  const [followStock, setFollowStock] = useState(row.link?.followStock ?? true);

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return lines.filter((line) => line.name.toLowerCase().includes(needle)).slice(0, 8);
  }, [lines, search]);
  const chosen = lines.find((line) => line.id === itemId) ?? null;

  return (
    <tr className={broken ? 'is-warning' : undefined}>
      <td>
        <Link href={`/products/${encodeURIComponent(row.productSlug)}`}>{row.productName}</Link>
        <div className="meta" dir="ltr">
          {row.sku}
        </div>
        {row.supplierOutOfStock ? <span className="pill pill-danger">{t('outBadge')}</span> : null}
      </td>
      <td>{row.terms}</td>
      <td className="num" dir="ltr">
        {usd(row.priceUsd)}
      </td>
      <td className="mapping-cell">
        {row.link && !picking ? (
          <div className="mapping-linked">
            <div dir="ltr" className={row.link.item.outOfStock ? 'supplier-struck' : undefined}>
              {row.link.item.name}
            </div>
            <div className="meta" dir="ltr">
              {usd(row.link.item.costUsd)}
              {row.link.markupPercent ? ` · ${String(Number(row.link.markupPercent))}%` : ''}
              {row.link.followStock ? '' : ` · ${t('followStock')}: ✕`}
            </div>
            <div className="supplier-actions">
              <button type="button" className="ghost btn-sm" onClick={() => setPicking(true)}>
                {t('relink')}
              </button>
              <button type="button" className="ghost btn-sm" onClick={onUnlink}>
                {t('unlink')}
              </button>
            </div>
          </div>
        ) : (
          <div className="mapping-picker">
            {broken ? <p className="notice">{t('broken')}</p> : null}
            {row.suggestions.length > 0 ? (
              <div className="mapping-suggestions">
                <span className="meta">{t('suggestions')}</span>
                {row.suggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    className={`chip${itemId === suggestion.id ? ' is-active' : ''}`}
                    onClick={() => setItemId(suggestion.id)}
                    dir="ltr"
                    title={`${String(Math.round(suggestion.score * 100))}%`}
                  >
                    {suggestion.name} · {usd(suggestion.costUsd)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="meta">{t('noSuggestions')}</p>
            )}
            <input
              type="search"
              dir="ltr"
              placeholder={t('searchLine')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {matches.length > 0 ? (
              <ul className="mapping-matches">
                {matches.map((line) => (
                  <li key={line.id}>
                    <button
                      type="button"
                      className={`linky${itemId === line.id ? ' is-active' : ''}`}
                      dir="ltr"
                      onClick={() => {
                        setItemId(line.id);
                        setSearch('');
                      }}
                    >
                      {line.name} · {usd(line.costUsd)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {chosen ? (
              <p className="mapping-chosen" dir="ltr">
                ✓ {chosen.name}
              </p>
            ) : null}
            <div className="mapping-options">
              <label className="field">
                <span>{t('markupOverride')}</span>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step="0.01"
                  dir="ltr"
                  placeholder={t('markupDefault')}
                  value={markup}
                  onChange={(event) => setMarkup(event.target.value)}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={followStock}
                  onChange={(event) => setFollowStock(event.target.checked)}
                />
                <span>{t('followStock')}</span>
              </label>
            </div>
            <div className="supplier-actions">
              <button
                type="button"
                className="btn-sm"
                disabled={!itemId}
                onClick={() => {
                  onLink(itemId, markup, followStock);
                  setPicking(false);
                }}
              >
                {t('link')}
              </button>
              {row.link ? (
                <button type="button" className="ghost btn-sm" onClick={() => setPicking(false)}>
                  ✕
                </button>
              ) : null}
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}
