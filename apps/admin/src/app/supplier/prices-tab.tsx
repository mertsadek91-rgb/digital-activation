'use client';

import {
  COST_STANDINGS,
  type ApplySupplierPricesResult,
  type CostStanding,
  LARGE_PRICE_CHANGE,
  type SupplierPriceRow,
  type SupplierPrices,
  type SupplierRounding,
} from '@da/contracts';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { supplierApi } from '../../lib/supplier-api';

import { percent, usd } from './format';

type Standing = 'all' | CostStanding;

/**
 * A left-to-right run (an amount, a SKU) inside a sentence that may be
 * Arabic: isolated, so "$130.00" does not read "130.00$" (REV-0200).
 */
const ltr = (text: string): string => `\u2066${text}\u2069`;
const STANDINGS: readonly Standing[] = ['all', ...COST_STANDINGS];

/**
 * Price proposals: cost × (1 + markup) for every linked variant. Nothing
 * changes until a person presses apply — on one row, on the rows ticked, or
 * on all of them. The API recomputes every price from the stored cost; the
 * request only names variants.
 *
 * The rows filter by where today's price stands against the cost, and a
 * row's own markup is set in place, from a percentage or from the price
 * wanted (TASK-0135).
 */
export function PricesTab({ isAdmin }: { isAdmin: boolean }) {
  const t = useT('supplier');
  const c = useT('common');
  const [data, setData] = useState<SupplierPrices | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [standing, setStanding] = useState<Standing>('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplySupplierPricesResult | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

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
    setSaved(null);
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
  const counts = Object.fromEntries(
    STANDINGS.map((key) => [
      key,
      key === 'all' ? data.rows.length : data.rows.filter((row) => row.costStanding === key).length,
    ]),
  ) as Record<Standing, number>;
  const rows =
    standing === 'all' ? data.rows : data.rows.filter((row) => row.costStanding === standing);
  const columns = isAdmin ? 10 : 8;
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

      <div
        className="supplier-filters price-standing"
        role="group"
        aria-label={t('standingFilter')}
      >
        {STANDINGS.map((key) => (
          <button
            key={key}
            type="button"
            className={`chip${standing === key ? ' is-active' : ''}${key === 'BELOW' && counts.BELOW > 0 ? ' is-danger' : ''}`}
            aria-pressed={standing === key}
            onClick={() => {
              // Ticked rows the filter hides would still be applied (REV-0199).
              setStanding(key);
              setSelected(new Set());
            }}
          >
            {t(`standing_${key}`)}
            <span className="tab-count">{counts[key]}</span>
          </button>
        ))}
      </div>

      {error ? (
        <p className="error" role="alert" dir="auto">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="ok-note" role="status">
          {saved}
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

      {rows.length === 0 ? (
        <p className="notice">{t('standingEmpty')}</p>
      ) : (
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
              {rows.map((row) => (
                <Fragment key={row.variantId}>
                  <tr className={row.state === 'PENDING' ? undefined : 'is-muted'}>
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
                        · <bdi>{row.terms}</bdi>
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
                    <td className="num">
                      {isAdmin ? (
                        <button
                          type="button"
                          className={`markup-edit${editing === row.variantId ? ' is-open' : ''}`}
                          aria-expanded={editing === row.variantId}
                          aria-label={t('editMarkup', { sku: row.sku })}
                          title={row.markupFromLink ? t('markupOwn') : undefined}
                          disabled={busy}
                          onClick={() =>
                            setEditing((open) => (open === row.variantId ? null : row.variantId))
                          }
                        >
                          <span dir="ltr">
                            {String(Number(row.markupPercent))}%{row.markupFromLink ? ' *' : ''}
                          </span>
                          <span aria-hidden="true" className="markup-edit-icon">
                            ✎
                          </span>
                        </button>
                      ) : (
                        <span dir="ltr">
                          {String(Number(row.markupPercent))}%{row.markupFromLink ? ' *' : ''}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      <span dir="ltr">{usd(row.currentPriceUsd)}</span>
                      <CostStandingNote row={row} />
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
                  {isAdmin && editing === row.variantId ? (
                    <tr className="markup-editor-row">
                      <td colSpan={columns}>
                        <MarkupEditor
                          row={row}
                          rounding={data.rounding}
                          onCancel={() => setEditing(null)}
                          onDone={async (message) => {
                            setEditing(null);
                            setResult(null);
                            setSaved(message);
                            await load();
                          }}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Under today's price: "below cost" with the loss per sale, or "at cost". */
function CostStandingNote({ row }: { row: SupplierPriceRow }) {
  const t = useT('supplier');
  if (row.costStanding === 'BELOW' && row.costUsd !== null) {
    const loss = (Number(row.costUsd) - Number(row.currentPriceUsd)).toFixed(2);
    return (
      <div className="cost-standing is-below">
        {t('standing_BELOW')} · {t('costBelowBy')} <bdi dir="ltr">{`$${loss}`}</bdi>
      </div>
    );
  }
  if (row.costStanding === 'AT') {
    return <div className="cost-standing is-at">{t('standing_AT')}</div>;
  }
  return null;
}

/**
 * A proposal as the API makes it (pricing.ts `proposePrice`), for the preview
 * only: the API recomputes every price itself. Whole cents, so a float pass
 * does not round 2.25 down to 2.24.
 */
function previewPrice(cost: number, markup: number, rounding: SupplierRounding): number {
  const raw = (Math.round(cost * 100) * (100 + markup)) / 100 / 100;
  switch (rounding) {
    case 'WHOLE':
      return Math.ceil(raw - 1e-9);
    case 'END_99': {
      const candidate = Math.floor(raw) + 0.99;
      return candidate < raw - 1e-9 ? candidate + 1 : candidate;
    }
    default:
      return Math.round(raw * 100 + 1e-6) / 100;
  }
}

/**
 * The markup and the price it gives, side by side: typing either fills the
 * other, and whichever was typed last is what is sent. Typing a markup shows
 * the price the rounding rule will make of it; typing a price shows its
 * percentage, and the API pins the two-decimal markup whose proposal lands
 * nearest it (REV-0199). Nothing is sent until something is typed, so
 * opening the editor never turns the sheet's markup into this row's own
 * (REV-0199); a change over LARGE_PRICE_CHANGE is flagged, and confirmed
 * before "pin and apply" (REV-0196).
 */
function MarkupEditor({
  row,
  rounding,
  onCancel,
  onDone,
}: {
  row: SupplierPriceRow;
  rounding: SupplierRounding;
  onCancel: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const t = useT('supplier');
  const c = useT('common');
  const cost = row.costUsd === null ? null : Number(row.costUsd);
  const current = Number(row.currentPriceUsd);
  const start = Number(row.markupPercent);
  const [markup, setMarkup] = useState(String(start));
  const [price, setPrice] = useState(
    cost === null ? '' : (row.proposedPriceUsd ?? previewPrice(cost, start, rounding).toFixed(2)),
  );
  const [last, setLast] = useState<'markup' | 'price'>('markup');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function typeMarkup(value: string) {
    setMarkup(value);
    setLast('markup');
    setTouched(true);
    // An earlier error is about an earlier value (REV-0202).
    setError(null);
    const number = Number(value);
    if (cost !== null && value.trim() !== '' && Number.isFinite(number) && number >= 0) {
      setPrice(previewPrice(cost, number, rounding).toFixed(2));
    }
  }

  function typePrice(value: string) {
    setPrice(value);
    setLast('price');
    setTouched(true);
    setError(null);
    const number = Number(value);
    if (cost !== null && cost > 0 && value.trim() !== '' && Number.isFinite(number)) {
      setMarkup(String(Math.round((number / cost - 1) * 10000) / 100));
    }
  }

  // The proposal this will make, as near as the panel can tell before the API answers.
  const markupNumber = Number(markup);
  const proposal =
    cost !== null && markup.trim() !== '' && Number.isFinite(markupNumber) && markupNumber >= 0
      ? previewPrice(cost, markupNumber, rounding)
      : null;
  const change = proposal !== null && current > 0 ? (proposal - current) / current : null;
  const large =
    proposal !== null &&
    (current <= 0 || (change !== null && Math.abs(change) > LARGE_PRICE_CHANGE));
  // At or under cost: apply would refuse it, so say so before it is pressed (REV-0200).
  const notAboveCost = proposal !== null && cost !== null && proposal <= cost;
  // A typed price at or under cost has no markup to preview: say so while typing (REV-0202).
  const typedNumber = Number(price);
  const typedNotAboveCost =
    last === 'price' &&
    cost !== null &&
    price.trim() !== '' &&
    Number.isFinite(typedNumber) &&
    typedNumber <= cost;

  function check(): string | null {
    if (last === 'price') {
      if (cost === null || cost <= 0) return t('priceNeedsCost');
      const number = Number(price);
      if (!Number.isFinite(number) || number <= cost) {
        return t('priceNotAboveCost', { cost: ltr(`$${cost.toFixed(2)}`) });
      }
      return null;
    }
    return markup.trim() === '' ||
      !Number.isFinite(markupNumber) ||
      markupNumber < 0 ||
      markupNumber > 1000
      ? t('markupInvalid')
      : null;
  }

  async function save(input: { apply: boolean } | { reset: true }) {
    const problem = 'reset' in input ? null : check();
    if (problem) {
      setError(problem);
      return;
    }
    if (
      'apply' in input &&
      input.apply &&
      large &&
      !window.confirm(t('confirmLargeOne', { sku: ltr(row.sku), change: ltr(percent(change)) }))
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const outcome = await supplierApi.setMarkup(
        row.variantId,
        'reset' in input
          ? { markupPercent: null }
          : last === 'price'
            ? { targetPriceUsd: Number(price), apply: input.apply }
            : { markupPercent: markupNumber, apply: input.apply },
      );
      const fresh = outcome.row;
      const values = {
        sku: ltr(fresh.sku),
        markup: ltr(String(Number(fresh.markupPercent))),
        proposed: ltr(usd(fresh.proposedPriceUsd)),
      };
      let message = 'reset' in input ? t('markupReset', values) : t('markupSaved', values);
      const done = outcome.applied?.applied[0];
      const skipped = outcome.applied?.skipped[0];
      if (done) message += ` ${t('markupAppliedTo', { price: ltr(`$${done.to}`) })}`;
      else if (skipped) {
        message += ` ${t('markupNotApplied', { reason: t(`skipReason_${skipped.reason}`) })}`;
      }
      await onDone(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  }

  return (
    <form
      className="markup-editor"
      // The panel's own, translated messages, not the browser's (REV-0200).
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save({ apply: false });
      }}
    >
      <div className="markup-editor-head">
        <strong>
          {t('markupEditorHeading')}
          <span dir="ltr">{row.sku}</span>
        </strong>
        <span className="meta">
          {t('markupEditorCost')}
          <span dir="ltr">{usd(row.costUsd)}</span>
        </span>
      </div>
      <p className="meta">{t('markupEditorHint')}</p>
      <div className="markup-editor-fields">
        <label className="field">
          <span>{t('markupField')}</span>
          <input
            type="number"
            inputMode="decimal"
            dir="ltr"
            min={0}
            max={1000}
            step="0.01"
            value={markup}
            onChange={(event) => typeMarkup(event.target.value)}
          />
        </label>
        <label className="field">
          <span>{t('priceField')}</span>
          <input
            type="number"
            inputMode="decimal"
            dir="ltr"
            min={0}
            step="0.01"
            value={price}
            disabled={cost === null}
            onChange={(event) => typePrice(event.target.value)}
          />
        </label>
      </div>
      {touched && typedNotAboveCost && cost !== null && !error ? (
        <p className="markup-preview is-large" role="status">
          {t('priceNotAboveCost', { cost: ltr(`$${cost.toFixed(2)}`) })}
        </p>
      ) : touched && proposal !== null ? (
        <p className={`markup-preview${large || notAboveCost ? ' is-large' : ''}`} role="status">
          {t(last === 'price' ? 'previewNear' : 'previewExact')}{' '}
          <bdi dir="ltr">{`$${proposal.toFixed(2)}`}</bdi>
          {change !== null ? (
            <>
              {' '}
              (<bdi dir="ltr">{percent(change)}</bdi> {t('previewAgainstCurrent')})
            </>
          ) : null}
          {notAboveCost ? ` · ${t('previewNotAboveCost')}` : large ? ` · ${t('large')}` : ''}
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert" dir="auto">
          {error}
        </p>
      ) : null}
      <div className="markup-editor-actions">
        <button type="submit" disabled={busy || !touched}>
          {t('pinMarkup')}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy || !touched}
          onClick={() => void save({ apply: true })}
        >
          {t('pinAndApply')}
        </button>
        {row.markupFromLink ? (
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => void save({ reset: true })}
          >
            {t('resetMarkup')}
          </button>
        ) : null}
        <button type="button" className="ghost" disabled={busy} onClick={onCancel}>
          {c('cancel')}
        </button>
      </div>
    </form>
  );
}
