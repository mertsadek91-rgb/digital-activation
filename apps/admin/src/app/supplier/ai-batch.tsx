'use client';

import type { AiBatch, AiBatchLineStatus } from '@da/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '../../i18n/provider';
import { supplierAiApi } from '../../lib/supplier-api';

const POLL_MS = 3000;
/**
 * How long polling carries on after Stop: the line in progress finishes its
 * call first, and the product it made should show without a reload.
 */
const SETTLE_MS = 3 * 60 * 1000;
const FINISHED: ReadonlySet<AiBatchLineStatus> = new Set([
  'DONE',
  'SKIPPED',
  'FAILED',
  'CANCELLED',
]);

const PILL: Record<AiBatchLineStatus, string> = {
  QUEUED: 'pill-neutral',
  DRAFTING: 'pill-info',
  CREATING: 'pill-info',
  WRITING: 'pill-info',
  DONE: 'pill-success',
  SKIPPED: 'pill-warning',
  FAILED: 'pill-danger',
  CANCELLED: 'pill-neutral',
};

export interface AiBatchControl {
  batch: AiBatch | null;
  /** Whether a model is chosen and the key set, so lines can be queued. */
  ready: boolean;
  busy: boolean;
  error: string | null;
  /** Lines the batch has not finished with, which their rows show as busy. */
  pending: ReadonlySet<string>;
  start: (itemIds: string[]) => Promise<boolean>;
  cancel: () => Promise<void>;
  retry: () => Promise<void>;
  dismiss: () => Promise<void>;
}

/**
 * The one-click AI batch (TASK-0150), from the panel's side: the server's
 * current batch, polled every few seconds while it runs. The work happens on
 * the server, so a reload finds the batch where it is.
 *
 * `onProgress` runs each time a line finishes, so the table reloads and the
 * new link shows on its row.
 */
export function useAiBatch(onProgress: () => void): AiBatchControl {
  const t = useT('supplier');
  const [batch, setBatch] = useState<AiBatch | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settleUntil, setSettleUntil] = useState(0);
  const finished = useRef<number | null>(null);
  const progress = useRef(onProgress);
  progress.current = onProgress;

  const show = useCallback((next: AiBatch | null) => {
    setBatch(next);
    const count = next?.lines.filter((line) => FINISHED.has(line.status)).length ?? 0;
    // The first load only records where the batch is; later changes reload the table.
    if (finished.current !== null && count !== finished.current) progress.current();
    finished.current = count;
  }, []);

  const load = useCallback(async () => {
    try {
      show((await supplierAiApi.batch()).batch);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    }
  }, [show, t]);

  useEffect(() => {
    void load();
    supplierAiApi
      .status()
      .then((status) => setReady(status.configured && Boolean(status.model)))
      .catch(() => setReady(false));
  }, [load]);

  const running = batch?.status === 'RUNNING';
  const watching = running || settleUntil > 0;
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => {
      void load();
      if (settleUntil > 0 && Date.now() > settleUntil) setSettleUntil(0);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [watching, settleUntil, load]);

  async function act(work: () => Promise<{ batch: AiBatch | null }>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      show((await work()).batch);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const pending = new Set(
    running
      ? (batch?.lines ?? []).filter((line) => !FINISHED.has(line.status)).map((line) => line.itemId)
      : [],
  );

  return {
    batch,
    ready,
    busy,
    error,
    pending,
    start: (itemIds) => act(() => supplierAiApi.startBatch({ itemIds })),
    cancel: async () => {
      if (await act(() => supplierAiApi.cancelBatch())) setSettleUntil(Date.now() + SETTLE_MS);
    },
    retry: async () => {
      await act(() => supplierAiApi.retryBatch());
    },
    dismiss: async () => {
      await act(() => supplierAiApi.dismissBatch());
    },
  };
}

/** Where each queued line is, with a link to every product made. */
export function AiBatchPanel({
  control,
  onCard,
}: {
  control: AiBatchControl;
  /** Opens the card designer for a product, on the AI tab. */
  onCard: (slug: string) => void;
}) {
  const t = useT('supplier');
  const { batch, busy } = control;
  if (!batch) return null;
  const done = batch.lines.filter((line) => FINISHED.has(line.status)).length;
  const failed = batch.lines.some(
    (line) => line.status === 'FAILED' || line.status === 'CANCELLED',
  );

  return (
    <section className="card ai-batch" aria-labelledby="ai-batch-heading">
      <div className="supplier-sync">
        <h2 id="ai-batch-heading">{t('batchHeading')}</h2>
        <span className={`pill ${batch.status === 'RUNNING' ? 'pill-info' : 'pill-neutral'}`}>
          {t(`batchState_${batch.status}`)}
        </span>
      </div>
      <p className="lede-sm">{t('batchLede')}</p>
      <p className="meta" role="status">
        <progress value={done} max={batch.lines.length} aria-hidden="true" />{' '}
        {t('batchProgress', { done, total: batch.lines.length })}
      </p>

      <ol className="ai-batch-lines">
        {batch.lines.map((line) => (
          <li key={line.itemId} className="ai-batch-line">
            <div className="ai-batch-head">
              <span className={`pill ${PILL[line.status]}`}>{t(`batchLine_${line.status}`)}</span>
              <span className="ai-batch-name" dir="ltr">
                {line.itemName}
              </span>
            </div>
            {line.draft ? (
              // One name per line: mixed-direction names on one line reorder unreadably.
              <div className="ai-batch-product">
                <span lang="ar" dir="rtl">
                  {line.draft.nameAr}
                </span>
                <span dir="ltr">
                  {line.draft.nameEn}
                  {line.draft.priceUsd !== '0.00' ? ` · $${line.draft.priceUsd}` : null}
                </span>
              </div>
            ) : null}
            {line.error ? (
              // Why a line was skipped is information, not a failure.
              // <bdi>: the text keeps its own direction, the paragraph the page's alignment.
              <p className={line.status === 'SKIPPED' ? 'meta' : 'error'}>
                <bdi>{line.error}</bdi>
              </p>
            ) : null}
            {line.notes.length > 0 && FINISHED.has(line.status) ? (
              <ul className="meta ai-batch-notes">
                {line.notes.map((note) => (
                  <li key={note}>
                    <bdi>{note}</bdi>
                  </li>
                ))}
              </ul>
            ) : null}
            {line.productSlug ? (
              <div className="supplier-actions">
                <Link
                  className="as-button ghost btn-sm"
                  href={`/products/${encodeURIComponent(line.productSlug)}`}
                >
                  {t('batchOpen')}
                </Link>
                {line.status === 'DONE' ? (
                  <button
                    type="button"
                    className="ghost btn-sm"
                    onClick={() => onCard(line.productSlug ?? '')}
                  >
                    {t('batchCard')}
                  </button>
                ) : null}
                <bdi className="meta" dir="ltr">
                  {line.sku}
                </bdi>
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      {batch.status === 'CANCELLED' && batch.lines.some((line) => line.status === 'CANCELLED') ? (
        <p className="meta">{t('batchStopping')}</p>
      ) : null}
      {control.error ? (
        <p className="error" role="alert" dir="auto">
          {control.error}
        </p>
      ) : null}
      <div className="supplier-actions">
        {batch.status === 'RUNNING' ? (
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => void control.cancel()}
          >
            {t('batchStop')}
          </button>
        ) : null}
        {failed ? (
          <button type="button" disabled={busy} onClick={() => void control.retry()}>
            {t('batchRetry')}
          </button>
        ) : null}
        {batch.status !== 'RUNNING' ? (
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => void control.dismiss()}
          >
            {t('batchDismiss')}
          </button>
        ) : null}
      </div>
    </section>
  );
}
