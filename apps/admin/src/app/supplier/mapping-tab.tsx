'use client';

import type {
  LineTerms,
  SupplierItemView,
  SupplierMapping,
  SupplierMappingRow,
} from '@da/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useT } from '../../i18n/provider';
import { supplierApi } from '../../lib/supplier-api';

import { usd } from './format';

const FILTERS = ['all', 'unlinked', 'broken', 'linked', 'skipped'] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Our variants on one side, the sheet's lines on the other. A person picks
 * the line once; the link is saved and every later sync uses it. The API
 * offers the three nearest lines as suggestions, those with the same years and
 * devices first, and never links on its own. A variant the supplier no longer
 * has can be marked out of stock here by hand (TASK-0134).
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
      {/* Said on the page, not only in a tooltip that touch and keyboard users never see. */}
      <p className="meta">{t('stockOutHint')}</p>
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
          aria-label={c('search')}
          placeholder={c('search')}
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>

      {error ? (
        <p className="error" role="alert" dir="auto">
          {error}
        </p>
      ) : null}
      {note ? (
        <p className="ok-note" role="status">
          {note}
        </p>
      ) : null}

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
                  onStock={(out) =>
                    void act(
                      () => supplierApi.setStock(row.variantId, out),
                      (saved) =>
                        out
                          ? t('markedOut', { sku: saved.sku })
                          : // The hand mark is off, but a followed sheet line can still hold it out.
                            saved.supplierOutOfStock
                            ? t('markedInStillOut', { sku: saved.sku })
                            : t('markedIn', { sku: saved.sku }),
                    )
                  }
                  onSkip={(skip) =>
                    void act(
                      () => supplierApi.setSkipped(row.variantId, skip),
                      (saved) =>
                        skip
                          ? t('skippedNote', { sku: saved.sku })
                          : t('unskippedNote', { sku: saved.sku }),
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
  onStock,
  onSkip,
}: {
  row: SupplierMappingRow;
  lines: SupplierItemView[];
  onLink: (itemId: string, markup: string, followStock: boolean) => void;
  onUnlink: () => void;
  /** true marks it out of stock by hand, false puts it back. */
  onStock: (out: boolean) => void;
  /** true skips (not sold by this supplier), false puts it back. */
  onSkip: (skip: boolean) => void;
}) {
  const t = useT('supplier');
  const c = useT('common');
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
        <Link href={`/products/${encodeURIComponent(row.productSlug)}`}>
          <bdi>{row.productName}</bdi>
        </Link>
        <div className="meta" dir="ltr">
          {row.sku}
        </div>
        {row.manualOutOfStock ? (
          <span className="pill pill-danger">{t('manualOutBadge')}</span>
        ) : row.supplierOutOfStock ? (
          <span className="pill pill-danger">{t('outBadge')}</span>
        ) : null}
        <div className="supplier-actions">
          <button
            type="button"
            className="ghost btn-sm"
            title={t('stockOutHint')}
            onClick={() => onStock(!row.manualOutOfStock)}
          >
            {row.manualOutOfStock ? t('stockBack') : t('stockOut')}
          </button>
        </div>
      </td>
      <td>{row.terms}</td>
      <td className="num" dir="ltr">
        {usd(row.priceUsd)}
      </td>
      <td className="mapping-cell">
        {row.skipped ? (
          <div className="mapping-linked">
            <p className="meta">{t('skippedRow')}</p>
            <div className="supplier-actions">
              <button type="button" className="ghost btn-sm" onClick={() => onSkip(false)}>
                {t('unskip')}
              </button>
            </div>
          </div>
        ) : row.link && !picking ? (
          <div className="mapping-linked">
            <div dir="ltr" className={row.link.item.outOfStock ? 'supplier-struck' : undefined}>
              {row.link.item.name}
            </div>
            <TermsCheck terms={row.link.item.terms} />
            {row.link.item.terms.devicesMatch === 'DIFFERENT' ||
            row.link.item.terms.periodMatch === 'DIFFERENT' ? (
              <p className="notice">{t('linkedDiffers')}</p>
            ) : null}
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
            {row.suggestions.length > 0 &&
            row.suggestions.every((entry) => differs(entry.terms)) ? (
              <p className="notice">{t('noExactLine')}</p>
            ) : null}
            {row.suggestions.length > 0 ? (
              <div className="mapping-suggestions">
                <span className="meta">{t('suggestions')}</span>
                {row.suggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    className={`chip${itemId === suggestion.id ? ' is-active' : ''}`}
                    onClick={() => setItemId(suggestion.id)}
                    title={`${String(Math.round(suggestion.score * 100))}%`}
                  >
                    <span dir="ltr">
                      {suggestion.name} · {usd(suggestion.costUsd)}
                    </span>
                    <TermsCheck terms={suggestion.terms} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="meta">{t('noSuggestions')}</p>
            )}
            <input
              type="search"
              dir="ltr"
              aria-label={t('searchLine')}
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
                <button
                  type="button"
                  className="ghost btn-sm"
                  aria-label={c('cancel')}
                  onClick={() => setPicking(false)}
                >
                  ✕
                </button>
              ) : (
                // Not sold by this supplier: out of the linking lists for good.
                <button
                  type="button"
                  className="ghost btn-sm"
                  title={t('skipHint')}
                  onClick={() => onSkip(true)}
                >
                  {t('skip')}
                </button>
              )}
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}

/** Both the years and the devices agree with this variant. */
function exact(terms: LineTerms | undefined): boolean {
  return terms?.devicesMatch === 'MATCH' && terms.periodMatch === 'MATCH';
}

/**
 * What a line's name states, part by part, against the variant: ✓ where it
 * agrees, ≠ where it differs, nothing where the name states nothing.
 */
function TermsCheck({ terms }: { terms: LineTerms }) {
  const t = useT('supplier');
  const parts: { key: string; text: string; ok: boolean }[] = [];
  if (terms.devices !== null && terms.devicesMatch !== 'UNKNOWN') {
    parts.push({
      key: 'devices',
      text: terms.devices === 0 ? t('lineUnlimited') : t('lineDevices', { count: terms.devices }),
      ok: terms.devicesMatch === 'MATCH',
    });
  }
  if (terms.period !== null && terms.periodMatch !== 'UNKNOWN') {
    parts.push({
      key: 'period',
      text:
        terms.period.unit === 'LIFETIME'
          ? t('line_LIFETIME')
          : t(`line_${terms.period.unit}`, { count: terms.period.value ?? 1 }),
      ok: terms.periodMatch === 'MATCH',
    });
  }
  if (parts.length === 0) return null;
  return (
    <span className="terms-check">
      {exact(terms) ? <span className="term-ok">✓ {t('termMatch')}</span> : null}
      {parts.map((part) => (
        <span key={part.key} className={part.ok ? 'term-ok' : 'term-diff'}>
          {part.ok ? '✓' : '≠'} {part.text}
        </span>
      ))}
    </span>
  );
}

/** The years or the devices disagree with this variant. */
function differs(terms: LineTerms): boolean {
  return terms.devicesMatch === 'DIFFERENT' || terms.periodMatch === 'DIFFERENT';
}
