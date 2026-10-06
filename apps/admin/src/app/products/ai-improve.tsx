'use client';

import {
  type ContentBlock,
  type GeneratedCopy,
  type SupplierAiStatus,
  generateCopySchema,
} from '@da/contracts';
import { useEffect, useRef, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api } from '../../lib/api';
import { supplierAiApi } from '../../lib/supplier-api';
import { runCopyJob } from '../supplier/copy-job';
import { CopyPreview } from '../supplier/copy-preview';
import '../supplier/supplier.css';

/**
 * "Improve with AI" beside a product's content editor (CR-0005).
 *
 * The model reads the page as it is on screen — the editor's blocks, unsaved
 * edits included, and the saved SEO fields — together with the product's
 * facts, and rewrites it to the store's writing rules. Nothing is saved by
 * this panel's main action: the new body goes into the editor, where the
 * person reviews it and presses Save as for any edit. The SEO fields have
 * their own button, since they live in the form above.
 */
export function AiImprove({
  slug,
  locale,
  blocks,
  onApplyBlocks,
  onCopySaved,
}: {
  slug: string;
  locale: 'ar' | 'en';
  /** The editor's blocks right now, saved or not. */
  blocks: ContentBlock[];
  onApplyBlocks: (blocks: ContentBlock[]) => void;
  /** The SEO fields were saved; the form above should reload. */
  onCopySaved: () => void;
}) {
  const t = useT('supplier');
  const c = useT('common');
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SupplierAiStatus | null>(null);
  const [instructions, setInstructions] = useState('');
  const [keywords, setKeywords] = useState('');
  const [busy, setBusy] = useState<'improve' | 'seo' | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<GeneratedCopy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open || status) return;
    supplierAiApi
      .status()
      .then(setStatus)
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : String(caught)),
      );
  }, [open, status]);

  // A new language on the page is a different page.
  useEffect(() => {
    setResult(null);
    setNote(null);
  }, [locale, slug]);

  const ready = Boolean(status?.configured && status.model);
  const draft = result?.[locale] ?? null;

  async function improve(): Promise<void> {
    setBusy('improve');
    setError(null);
    setNote(null);
    setResult(null);
    try {
      const saved = await api.productCopy(slug, locale);
      const input = generateCopySchema.parse({
        productSlug: slug,
        locales: [locale],
        mode: 'improve',
        instructions,
        focusKeywords: keywords,
        current: {
          [locale]: {
            seoTitle: saved.seoTitle,
            seoDescription: saved.seoDescription,
            shortDesc: saved.shortDesc,
            blocks,
          },
        },
      });
      setResult(
        await runCopyJob(input, {
          onPartial: setResult,
          onElapsed: setElapsed,
          isActive: () => mounted.current,
          messages: {
            cancelled: t('aiCancelled'),
            timedOut: t('aiTimedOut'),
            failed: c('actionFailed'),
          },
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  async function saveSeo(): Promise<void> {
    if (!draft) return;
    setBusy('seo');
    setError(null);
    try {
      await api.setProductCopy(slug, {
        locale,
        seoTitle: draft.seoTitle,
        seoDescription: draft.seoDescription,
        shortDesc: draft.shortDesc,
      });
      setNote(t('improveSeoSaved'));
      onCopySaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <button type="button" className="ghost ai-improve-toggle" onClick={() => setOpen(true)}>
        {t('improveOpen')}
      </button>
    );
  }

  return (
    <section className="card ai-improve" aria-label={t('improveHeading')}>
      <div className="supplier-sync">
        <h4>{t('improveHeading')}</h4>
        <button
          type="button"
          className="ghost btn-sm"
          aria-label={c('cancel')}
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </div>
      <p className="lede-sm">{t('improveLede')}</p>
      {status && !ready ? <p className="notice">{t('improveNotReady')}</p> : null}

      <div className="supplier-form">
        <label className="field">
          <span>{t('improveInstructions')}</span>
          <textarea
            rows={2}
            dir="auto"
            value={instructions}
            placeholder={t('improveInstructionsHint')}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </label>
        <label className="field">
          <span>{t('aiKeywords')}</span>
          <input
            dir="auto"
            value={keywords}
            placeholder={t('aiKeywordsHint')}
            onChange={(event) => setKeywords(event.target.value)}
          />
        </label>
        <div className="supplier-actions">
          <button type="button" disabled={busy !== null || !ready} onClick={() => void improve()}>
            {busy === 'improve' ? t('aiGeneratingFor', { seconds: elapsed }) : t('improveRun')}
          </button>
        </div>
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

      {draft ? (
        <CopyPreview
          locale={locale}
          copy={draft}
          actions={
            <>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  onApplyBlocks(draft.blocks);
                  setNote(t('improveApplied'));
                }}
              >
                {t('improveApply')}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy !== null}
                onClick={() => void saveSeo()}
              >
                {t('improveSaveSeo')}
              </button>
            </>
          }
        />
      ) : null}
    </section>
  );
}
