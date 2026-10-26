'use client';

import type { AgentBatchDetail, AgentBatchSummary, AgentItemView } from '@da/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useAdminLocale, useT } from '../../i18n/provider';
import { agentApi } from '../../lib/agent-api';

import { itemPill } from './run-pill';

const POLL_MS = 4000;

/** Where a value goes in a translated sentence, so it can be bidi-isolated. */
const SLOT = '\u0001';

/**
 * A sentence with its value isolated: an Arabic section name or reason inside
 * an English sentence (or the reverse) would otherwise drag the punctuation
 * around it to the wrong side.
 */
function isolated(sentence: string, value: string) {
  const [before = '', after = ''] = sentence.split(SLOT);
  return (
    <>
      {before}
      <bdi>{value}</bdi>
      {after}
    </>
  );
}

function batchPill(status: AgentBatchSummary['status']): string {
  if (status === 'RUNNING') return 'pill-info';
  if (status === 'PAUSED') return 'pill-warning';
  if (status === 'DONE') return 'pill-success';
  return 'pill-neutral';
}

/**
 * The batches the agent is running or has run: progress, the wait before the
 * next product, pause / resume / cancel, and per product its outcome, its log,
 * and retry or undo.
 */
export function Batches({
  batches,
  open,
  onOpen,
  onChanged,
  isAdmin,
}: {
  batches: AgentBatchSummary[];
  open: string | null;
  onOpen: (id: string | null) => void;
  onChanged: () => void;
  isAdmin: boolean;
}) {
  const t = useT('agent');
  const locale = useAdminLocale();
  const [detail, setDetail] = useState<AgentBatchDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (id: string) => {
    try {
      setDetail(await agentApi.batch(id));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    if (open) void load(open);
    else setDetail(null);
  }, [open, load]);

  const live = batches.some((batch) => batch.status === 'RUNNING');
  const openRunning =
    detail?.status === 'RUNNING' || detail?.items.some((i) => i.status === 'RUNNING');

  // The countdown to the next product.
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);

  useEffect(() => {
    if (!open || !openRunning) return;
    const timer = window.setInterval(() => void load(open), POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, openRunning, load]);

  async function act(key: string, run: () => Promise<AgentBatchDetail>, confirm?: string) {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(key);
    setError(null);
    try {
      setDetail(await run());
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  const date = (iso: string) =>
    new Date(iso).toLocaleString(locale === 'en' ? 'en-GB' : 'ar-EG', {
      // Latin digits, like every other number on this screen.
      numberingSystem: 'latn',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  if (batches.length === 0) return <p className="notice">{t('batchesEmpty')}</p>;

  return (
    <div className="agent-batches">
      {error ? (
        <p className="error" role="alert" dir="auto">
          {error}
        </p>
      ) : null}
      {batches.map((summary) => {
        const batch = detail && detail.id === summary.id ? detail : summary;
        const { counts } = batch;
        const finished =
          counts.done + counts.failed + counts.skipped + counts.cancelled + counts.reverted;
        const percent = counts.total > 0 ? Math.round((finished / counts.total) * 100) : 0;
        const wait =
          batch.status === 'RUNNING' && batch.nextRunAt
            ? Math.max(0, Math.ceil((Date.parse(batch.nextRunAt) - now) / 1000))
            : null;
        const isOpen = open === summary.id;
        const canControl = batch.status === 'RUNNING' || batch.status === 'PAUSED';
        return (
          <section
            key={summary.id}
            className="agent-batch card"
            aria-labelledby={`batch-${summary.id}`}
          >
            <header className="agent-batch-head">
              <div>
                <h2 id={`batch-${summary.id}`}>
                  {t(`kind${batch.kind}`)} · {counts.total}
                </h2>
                {/* Each part isolated: a name in the other script would otherwise
                    reorder the whole line around it. */}
                <p className="meta">
                  <bdi>{date(batch.createdAt)}</bdi>
                  {batch.createdBy ? (
                    <>
                      {' · '}
                      <bdi>{t('startedBy', { name: batch.createdBy })}</bdi>
                    </>
                  ) : null}
                  {' · '}
                  <bdi>{t('cooldownLine', { seconds: batch.cooldownSeconds })}</bdi>
                </p>
              </div>
              <span className={`pill ${batchPill(batch.status)}`}>{t(`batch${batch.status}`)}</span>
            </header>

            <div
              className="agent-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label={t('progress', { done: finished, total: counts.total })}
            >
              <span style={{ inlineSize: `${String(percent)}%` }} />
            </div>
            <p className="agent-counts">
              <strong>{t('progress', { done: finished, total: counts.total })}</strong>{' '}
              <span className="meta">
                {t('countsLine', {
                  done: counts.done,
                  failed: counts.failed,
                  skipped: counts.skipped,
                  queued: counts.queued,
                })}
              </span>
              {wait !== null && counts.queued > 0 && counts.running === 0 ? (
                <span className="meta" aria-live="polite">
                  {' · '}
                  {wait > 0 ? t('nextIn', { seconds: wait }) : t('nextNow')}
                </span>
              ) : null}
            </p>

            <div className="agent-batch-actions">
              <button
                type="button"
                className="ghost btn-sm"
                aria-expanded={isOpen}
                onClick={() => onOpen(isOpen ? null : summary.id)}
              >
                {isOpen ? t('hideItems') : t('showItems')}
              </button>
              {batch.status === 'RUNNING' ? (
                <button
                  type="button"
                  className="ghost btn-sm"
                  disabled={busy !== null}
                  onClick={() =>
                    void act(`pause-${summary.id}`, () => agentApi.setStatus(summary.id, 'pause'))
                  }
                >
                  {t('pause')}
                </button>
              ) : null}
              {batch.status === 'PAUSED' && isAdmin ? (
                <button
                  type="button"
                  className="ghost btn-sm"
                  disabled={busy !== null}
                  onClick={() =>
                    void act(`resume-${summary.id}`, () => agentApi.setStatus(summary.id, 'resume'))
                  }
                >
                  {t('resume')}
                </button>
              ) : null}
              {canControl ? (
                <button
                  type="button"
                  className="ghost btn-sm btn-danger-soft"
                  disabled={busy !== null}
                  onClick={() =>
                    void act(
                      `cancel-${summary.id}`,
                      () => agentApi.setStatus(summary.id, 'cancel'),
                      t('confirmCancel'),
                    )
                  }
                >
                  {t('cancel')}
                </button>
              ) : null}
            </div>

            {isOpen && detail && detail.id === summary.id ? (
              <ol className="agent-items">
                {detail.items.map((item) => (
                  <Item
                    key={item.id}
                    item={item}
                    busy={busy}
                    isAdmin={isAdmin}
                    onRetry={() => void act(`retry-${item.id}`, () => agentApi.retry(item.id))}
                    onUndo={() =>
                      void act(`undo-${item.id}`, () => agentApi.revert(item.id), t('confirmUndo'))
                    }
                    date={date}
                  />
                ))}
              </ol>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function Item({
  item,
  busy,
  isAdmin,
  onRetry,
  onUndo,
  date,
}: {
  item: AgentItemView;
  busy: string | null;
  isAdmin: boolean;
  onRetry: () => void;
  onUndo: () => void;
  date: (iso: string) => string;
}) {
  const t = useT('agent');
  const { result } = item;
  const locales = (result?.copyLocales ?? []).map((l) =>
    l === 'ar' ? t('localeAr') : t('localeEn'),
  );
  const retryable =
    item.status === 'FAILED' || item.status === 'SKIPPED' || item.status === 'CANCELLED';

  return (
    <li className={`agent-item is-${item.status.toLowerCase()}`}>
      <div className="agent-item-head">
        <span className="agent-item-no" dir="ltr">
          {item.position + 1}
        </span>
        <div className="agent-item-name">
          {item.productSlug ? (
            <Link
              href={`/products/${encodeURIComponent(item.productSlug)}`}
              title={t('openProduct')}
            >
              <bdi>{item.label}</bdi>
            </Link>
          ) : (
            <bdi>{item.label}</bdi>
          )}
          {item.status === 'RUNNING' && item.step ? (
            <span className="meta agent-step">
              {' · '}
              {t(`step${item.step}` as 'stepstart')}
            </span>
          ) : null}
        </div>
        <span className={`pill ${itemPill(item.status)}`}>{t(`item${item.status}`)}</span>
      </div>

      {result ? (
        <ul className="agent-outcome">
          {result.created ? <li>{t('outCreated')}</li> : null}
          {result.category ? (
            <li>
              {isolated(
                t(`outCategory${result.category.action}`, { names: SLOT }),
                result.category.names.join('، ') || t('none'),
              )}
            </li>
          ) : null}
          {locales.length > 0 ? (
            <li>{isolated(t('outCopy', { locales: SLOT }), locales.join(' + '))}</li>
          ) : null}
          {result.card ? (
            <li className="agent-card-line">
              {t('outCard')}: {t(`logoSource${result.card.logoSource}`)}
              {result.card.palette.map((colour) => (
                <span
                  key={colour}
                  className="agent-swatch"
                  style={{ backgroundColor: colour }}
                  title={colour}
                  aria-label={colour}
                  role="img"
                />
              ))}
              {result.card.logoUrl ? (
                <a href={result.card.logoUrl} target="_blank" rel="noreferrer noopener" dir="ltr">
                  {new URL(result.card.logoUrl).hostname}
                </a>
              ) : null}
            </li>
          ) : null}
          {result.published === true ? <li className="agent-ok">{t('outPublished')}</li> : null}
          {result.published === false ? (
            <li className="agent-warn">
              {isolated(t('outBlocked', { reasons: SLOT }), result.blockers.join(' · '))}
            </li>
          ) : null}
        </ul>
      ) : null}
      {item.error ? (
        <p className="error agent-item-error" dir="auto">
          {item.error}
        </p>
      ) : null}

      <div className="agent-item-foot">
        {item.log.length > 0 ? (
          <details className="agent-log">
            <summary>
              {t('showLog')}
              {item.attempts > 1 ? ` · ${t('attempt', { count: item.attempts })}` : ''}
            </summary>
            <ol>
              {item.log.map((entry, index) => (
                <li key={`${entry.at}-${String(index)}`} className={`is-${entry.level}`}>
                  <time dateTime={entry.at}>{date(entry.at)}</time> {t(`log_${entry.code}`)}
                  {entry.detail ? (
                    <>
                      {': '}
                      <bdi>{entry.detail}</bdi>
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
        <div className="agent-item-actions">
          {retryable && isAdmin ? (
            <button
              type="button"
              className="ghost btn-sm"
              disabled={busy !== null}
              onClick={onRetry}
            >
              {t('retry')}
            </button>
          ) : null}
          {item.canRevert ? (
            <button
              type="button"
              className="ghost btn-sm btn-danger-soft"
              disabled={busy !== null}
              onClick={onUndo}
            >
              {t('undo')}
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
