'use client';

import {
  type AiSection,
  type SectionResult,
  type SupplierAiStatus,
  generateSectionSchema,
} from '@da/contracts';
import { useEffect, useRef, useState } from 'react';

import { useT } from '../../i18n/provider';
import { supplierAiApi } from '../../lib/supplier-api';
import '../supplier/supplier.css';

/** One status request per page, shared by every section's button. */
let statusRequest: Promise<SupplierAiStatus> | null = null;
function aiStatus(): Promise<SupplierAiStatus> {
  statusRequest ??= supplierAiApi.status().catch((error: unknown) => {
    statusRequest = null;
    throw error;
  });
  return statusRequest;
}

const POLL_MS = 3000;
const GIVE_UP_MS = 12 * 60 * 1000;

/**
 * "Write / improve with AI" for one section of the product editor (CR-0005):
 * the SEO fields, the activation how-to, or the FAQ, steps or specification
 * table of the body. The model reads the product's facts, the saved page for
 * context and this section as it is on screen; the result is handed to the
 * form, which keeps it unsaved until the person presses Save.
 *
 * The label says "improve" when the section already has content and "write"
 * when it is empty — the same request either way, the server decides from
 * what it is sent.
 */
export function AiSectionButton({
  slug,
  locale,
  section,
  current,
  hasContent,
  onResult,
}: {
  slug: string;
  locale: 'ar' | 'en';
  section: AiSection;
  /** The section on screen now, read when the button is pressed. */
  current: () => unknown;
  hasContent: boolean;
  onResult: (result: SectionResult) => void;
}) {
  const t = useT('supplier');
  const c = useT('common');
  const [ready, setReady] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    aiStatus()
      .then((status) => {
        if (mounted.current) setReady(status.configured && Boolean(status.model));
      })
      .catch(() => {
        if (mounted.current) setReady(false);
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  // Another product or language: old notes do not apply.
  useEffect(() => {
    setNote(null);
    setError(null);
  }, [slug, locale]);

  if (ready === false) return null;

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const job = await supplierAiApi.section(
        generateSectionSchema.parse({
          productSlug: slug,
          locale,
          section,
          current: current(),
          instructions,
        }),
      );
      const started = Date.now();
      setElapsed(0);
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (!mounted.current) return;
        setElapsed(Math.round((Date.now() - started) / 1000));
        const state = await supplierAiApi.sectionJob(job.id);
        if (state.status === 'DONE' && state.result) {
          onResult(state.result);
          setNote(t('sectionApplied'));
          setAsking(false);
          return;
        }
        if (state.status === 'FAILED') throw new Error(state.error ?? c('actionFailed'));
        if (Date.now() - started > GIVE_UP_MS) throw new Error(t('aiTimedOut'));
      }
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const label = hasContent ? t('sectionImprove') : t('sectionWrite');
  return (
    <div className="ai-section">
      <div className="supplier-actions">
        <button
          type="button"
          className="ghost btn-sm"
          disabled={busy || ready === null}
          onClick={() => (asking ? void run() : setAsking(true))}
        >
          {busy ? t('aiGeneratingFor', { seconds: elapsed }) : asking ? t('sectionGo') : label}
        </button>
        {asking && !busy ? (
          <>
            <input
              dir="auto"
              className="ai-section-ask"
              aria-label={t('improveInstructions')}
              placeholder={t('sectionAskHint')}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void run();
                }
              }}
            />
            <button
              type="button"
              className="ghost btn-sm"
              aria-label={c('cancel')}
              onClick={() => setAsking(false)}
            >
              ✕
            </button>
          </>
        ) : null}
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
    </div>
  );
}
