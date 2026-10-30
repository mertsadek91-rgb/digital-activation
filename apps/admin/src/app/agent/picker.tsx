'use client';

import {
  AGENT_DEFAULT_COOLDOWN,
  AGENT_MAX_BATCH,
  AGENT_MAX_COOLDOWN,
  AGENT_MIN_COOLDOWN,
  type AgentBatchKind,
  type AgentCandidates,
  type AgentCardMode,
  type AgentOptions,
  type AgentProductCandidate,
  type AgentSupplierCandidate,
} from '@da/contracts';
import { useMemo, useState } from 'react';

import { useT } from '../../i18n/provider';
import { agentApi } from '../../lib/agent-api';

import { RunPill } from './run-pill';

type ProductFilter = 'all' | 'published' | 'drafts' | 'noImage' | 'thin' | 'neverRun';
type LineFilter = 'all' | 'inStock' | 'retail' | 'neverRun';

const PRODUCT_FILTERS: ProductFilter[] = [
  'all',
  'published',
  'drafts',
  'noImage',
  'thin',
  'neverRun',
];
const LINE_FILTERS: LineFilter[] = ['all', 'inStock', 'retail', 'neverRun'];
const FILTER_LABEL = {
  all: 'filterAll',
  published: 'filterPublished',
  drafts: 'filterDrafts',
  noImage: 'filterNoImage',
  thin: 'filterThin',
  neverRun: 'filterNeverRun',
  inStock: 'filterInStock',
  retail: 'filterRetail',
} as const;

/** Under this many Arabic words a page is "thin": the publish gate wants 120. */
const THIN_WORDS = 120;
/** A rough minute of model work per product, for the products-per-hour hint. */
const WORK_SECONDS = 60;

const matches = (needle: string, ...values: (string | null)[]) =>
  values.some((value) => value?.toLowerCase().includes(needle));

/**
 * Picks what a batch works on — catalogue products for a rewrite, unlinked
 * supplier lines for new products — and the options, then starts it.
 */
export function Picker({
  kind,
  candidates,
  canStart,
  isAdmin,
  onStarted,
}: {
  kind: AgentBatchKind;
  candidates: AgentCandidates;
  canStart: boolean;
  isAdmin: boolean;
  onStarted: (batchId: string) => void;
}) {
  const t = useT('agent');
  const [query, setQuery] = useState('');
  const [productFilter, setProductFilter] = useState<ProductFilter>('all');
  const [lineFilter, setLineFilter] = useState<LineFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [options, setOptions] = useState<AgentOptions>({
    copy: true,
    category: true,
    newCategories: true,
    card: 'missing',
    publish: true,
    instructions: '',
  });
  const [cooldown, setCooldown] = useState(AGENT_DEFAULT_COOLDOWN);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const products = useMemo(
    () =>
      candidates.products.filter((row: AgentProductCandidate) => {
        if (needle && !matches(needle, row.nameAr, row.nameEn, row.slug, row.brand)) return false;
        switch (productFilter) {
          case 'published':
            return row.status === 'PUBLISHED';
          case 'drafts':
            return row.status !== 'PUBLISHED';
          case 'noImage':
            return !row.hasImage;
          case 'thin':
            return row.words < THIN_WORDS;
          case 'neverRun':
            return row.lastRun === null;
          default:
            return true;
        }
      }),
    [candidates.products, needle, productFilter],
  );
  const lines = useMemo(
    () =>
      candidates.supplierLines.filter((row: AgentSupplierCandidate) => {
        if (needle && !matches(needle, row.name, row.category)) return false;
        switch (lineFilter) {
          case 'inStock':
            return !row.outOfStock;
          case 'retail':
            return !row.wholesaleOnly;
          case 'neverRun':
            return row.lastRun === null;
          default:
            return true;
        }
      }),
    [candidates.supplierLines, needle, lineFilter],
  );

  const shownIds = kind === 'REWRITE' ? products.map((p) => p.id) : lines.map((l) => l.id);
  const total = kind === 'REWRITE' ? candidates.products.length : candidates.supplierLines.length;
  const tooMany = selected.size > AGENT_MAX_BATCH;

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const set = <K extends keyof AgentOptions>(key: K, value: AgentOptions[K]) =>
    setOptions((current) => ({ ...current, [key]: value }));

  const perHour = Math.max(1, Math.round(3600 / (cooldown + WORK_SECONDS)));

  async function start() {
    const message = [
      t('confirmStart', { count: selected.size, seconds: cooldown }),
      options.publish ? t('confirmPublish') : t('confirmNoPublish'),
    ].join('\n\n');
    if (!window.confirm(message)) return;
    setBusy(true);
    setError(null);
    try {
      const batch = await agentApi.start({
        kind,
        // In the order shown, so the batch works down the list as it was seen.
        ids: shownIds
          .filter((id) => selected.has(id))
          .concat([...selected].filter((id) => !shownIds.includes(id))),
        options,
        cooldownSeconds: cooldown,
      });
      setSelected(new Set());
      onStarted(batch.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="agent-picker">
      <section
        className="agent-list"
        aria-label={kind === 'REWRITE' ? t('tabRewrite') : t('tabCreate')}
      >
        <div className="agent-toolbar">
          <input
            type="search"
            className="agent-search"
            placeholder={t('search')}
            aria-label={t('search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="agent-filters" role="group" aria-label={t('filterAll')}>
            {(kind === 'REWRITE' ? PRODUCT_FILTERS : LINE_FILTERS).map((filter) => {
              const active = kind === 'REWRITE' ? productFilter === filter : lineFilter === filter;
              return (
                <button
                  key={filter}
                  type="button"
                  className={`chip${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  onClick={() =>
                    kind === 'REWRITE'
                      ? setProductFilter(filter as ProductFilter)
                      : setLineFilter(filter as LineFilter)
                  }
                >
                  {t(FILTER_LABEL[filter])}
                </button>
              );
            })}
          </div>
        </div>

        <div className="agent-selectbar">
          <span className="meta">{t('shownCount', { shown: shownIds.length, total })}</span>
          <strong>{t('selectedCount', { count: selected.size })}</strong>
          <button
            type="button"
            className="ghost btn-sm"
            disabled={shownIds.length === 0}
            onClick={() => setSelected((current) => new Set([...current, ...shownIds]))}
          >
            {t('selectShown', { count: shownIds.length })}
          </button>
          <button
            type="button"
            className="ghost btn-sm"
            disabled={selected.size === 0}
            onClick={() => setSelected(new Set())}
          >
            {t('clearSelection')}
          </button>
        </div>

        {shownIds.length === 0 ? (
          <p className="notice">{kind === 'REWRITE' ? t('emptyProducts') : t('emptyLines')}</p>
        ) : (
          <div className="table-scroll agent-table-wrap">
            <table className="admin-table agent-table">
              <thead>
                {kind === 'REWRITE' ? (
                  <tr>
                    <th aria-label={t('selectedCount', { count: selected.size })} />
                    <th>{t('colName')}</th>
                    <th>{t('colStatus')}</th>
                    <th>{t('colSections')}</th>
                    <th className="num">{t('colWords')}</th>
                    <th>{t('colImage')}</th>
                    <th>{t('colLastRun')}</th>
                  </tr>
                ) : (
                  <tr>
                    <th aria-label={t('selectedCount', { count: selected.size })} />
                    <th>{t('colLine')}</th>
                    <th>{t('colSupplierSection')}</th>
                    <th className="num">{t('colCost')}</th>
                    <th>{t('colLastRun')}</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {kind === 'REWRITE'
                  ? products.map((row) => (
                      <tr key={row.id} className={selected.has(row.id) ? 'is-selected' : undefined}>
                        <td>
                          <label className="agent-tick">
                            <input
                              type="checkbox"
                              aria-label={row.nameAr}
                              checked={selected.has(row.id)}
                              onChange={() => toggle(row.id)}
                            />
                          </label>
                        </td>
                        <td>
                          <bdi>{row.nameAr}</bdi>
                          <div className="meta">
                            {row.nameEn ? (
                              <bdi>{row.nameEn}</bdi>
                            ) : (
                              <span dir="ltr">{row.slug}</span>
                            )}
                            {row.brand ? (
                              <>
                                {' '}
                                · <bdi>{row.brand}</bdi>
                              </>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`pill ${row.status === 'PUBLISHED' ? 'pill-published' : 'pill-draft'}`}
                          >
                            {t(`status${row.status}`)}
                          </span>
                        </td>
                        <td>
                          {row.categories.length > 0 ? (
                            row.categories.join('، ')
                          ) : (
                            <span className="agent-missing">{t('none')}</span>
                          )}
                        </td>
                        <td
                          className={`num${row.words < THIN_WORDS ? ' agent-missing' : ''}`}
                          dir="ltr"
                        >
                          {row.words}
                        </td>
                        <td>
                          {row.hasImage ? (
                            t('yes')
                          ) : (
                            <span className="agent-missing">{t('no')}</span>
                          )}
                        </td>
                        <td>
                          <RunPill run={row.lastRun} />
                        </td>
                      </tr>
                    ))
                  : lines.map((row) => (
                      <tr key={row.id} className={selected.has(row.id) ? 'is-selected' : undefined}>
                        <td>
                          <label className="agent-tick">
                            <input
                              type="checkbox"
                              aria-label={row.name}
                              checked={selected.has(row.id)}
                              onChange={() => toggle(row.id)}
                            />
                          </label>
                        </td>
                        <td>
                          <span dir="ltr">{row.name}</span>
                          {row.outOfStock ? (
                            <span className="pill pill-danger agent-flag">{t('flagOut')}</span>
                          ) : null}
                          {row.wholesaleOnly ? (
                            <span className="pill pill-warning agent-flag">
                              {t('flagWholesale')}
                            </span>
                          ) : null}
                        </td>
                        <td dir="auto">{row.category ?? t('none')}</td>
                        <td className="num" dir="ltr">
                          {row.costUsd ? `$${row.costUsd}` : t('none')}
                        </td>
                        <td>
                          <RunPill run={row.lastRun} />
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <aside className="agent-options card" aria-labelledby="agent-options-title">
        <h2 id="agent-options-title">{t('optionsTitle')}</h2>

        <label className="check agent-option">
          <input
            type="checkbox"
            checked={options.copy}
            onChange={(e) => set('copy', e.target.checked)}
          />
          <span>
            {t('optCopy')}
            <small>{t('optCopyHint')}</small>
          </span>
        </label>

        <label className="check agent-option">
          <input
            type="checkbox"
            checked={options.category}
            onChange={(e) => set('category', e.target.checked)}
          />
          <span>
            {t('optCategory')}
            <small>{t('optCategoryHint')}</small>
          </span>
        </label>
        <label className="check agent-option agent-sub">
          <input
            type="checkbox"
            disabled={!options.category}
            checked={options.category && options.newCategories}
            onChange={(e) => set('newCategories', e.target.checked)}
          />
          <span>{t('optNewCategories')}</span>
        </label>

        <label className="agent-field">
          <span>{t('optCard')}</span>
          <select
            value={options.card}
            onChange={(e) => set('card', e.target.value as AgentCardMode)}
          >
            <option value="missing">{t('optCardMissing')}</option>
            <option value="always">{t('optCardAlways')}</option>
            <option value="never">{t('optCardNever')}</option>
          </select>
          <small>{t('optCardHint')}</small>
        </label>

        <label className="check agent-option">
          <input
            type="checkbox"
            checked={options.publish}
            onChange={(e) => set('publish', e.target.checked)}
          />
          <span>
            {t('optPublish')}
            <small>{t('optPublishHint')}</small>
          </span>
        </label>

        <label className="agent-field">
          <span>{t('optInstructions')}</span>
          <textarea
            rows={3}
            maxLength={1000}
            dir="auto"
            placeholder={t('optInstructionsPlaceholder')}
            value={options.instructions}
            onChange={(e) => set('instructions', e.target.value)}
          />
        </label>

        <label className="agent-field">
          <span>{t('optCooldown')}</span>
          <input
            type="number"
            dir="ltr"
            inputMode="numeric"
            min={AGENT_MIN_COOLDOWN}
            max={AGENT_MAX_COOLDOWN}
            step={15}
            value={cooldown}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value)) setCooldown(value);
            }}
            onBlur={() =>
              setCooldown((value) =>
                Math.min(AGENT_MAX_COOLDOWN, Math.max(AGENT_MIN_COOLDOWN, Math.round(value))),
              )
            }
          />
          <small>{t('optCooldownHint', { perHour })}</small>
        </label>

        {tooMany ? (
          <p className="error" role="alert">
            {t('maxBatch', { max: AGENT_MAX_BATCH })}
          </p>
        ) : null}
        {error ? (
          <p className="error" role="alert" dir="auto">
            {error}
          </p>
        ) : null}
        {!isAdmin ? <p className="notice">{t('adminOnly')}</p> : null}

        <button
          type="button"
          className="agent-start"
          disabled={!canStart || busy || selected.size === 0 || tooMany}
          onClick={() => void start()}
        >
          {busy ? t('starting') : t('start', { count: selected.size })}
        </button>
      </aside>
    </div>
  );
}
