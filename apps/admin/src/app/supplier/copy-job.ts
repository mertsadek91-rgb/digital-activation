'use client';

import type { GenerateCopy, GeneratedCopy } from '@da/contracts';

import { supplierAiApi } from '../../lib/supplier-api';

/** Past anything a model takes; the server marks a job this old dead anyway. */
const GIVE_UP_MS = 12 * 60 * 1000;
const POLL_MS = 3000;

/**
 * Starts a copy job and polls it until it finishes (BUG-0026): generation
 * outlives the 100 s Cloudflare holds a request open in front of the API.
 *
 * `onPartial` receives a language as soon as it is ready, while the other is
 * still being written; `onElapsed` the seconds so far, for the button.
 * `isActive` stops the polling when the screen that asked is gone.
 */
export async function runCopyJob(
  input: GenerateCopy,
  hooks: {
    onPartial: (partial: GeneratedCopy) => void;
    onElapsed: (seconds: number) => void;
    isActive: () => boolean;
    messages: { cancelled: string; timedOut: string; failed: string };
  },
): Promise<GeneratedCopy> {
  const job = await supplierAiApi.copy(input);
  const started = Date.now();
  hooks.onElapsed(0);
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if (!hooks.isActive()) throw new Error(hooks.messages.cancelled);
    hooks.onElapsed(Math.round((Date.now() - started) / 1000));
    const current = await supplierAiApi.copyJob(job.id);
    if (current.status === 'DONE' && current.result) return current.result;
    if (current.status === 'FAILED') throw new Error(current.error ?? hooks.messages.failed);
    if (current.result) hooks.onPartial(current.result);
    if (Date.now() - started > GIVE_UP_MS) throw new Error(hooks.messages.timedOut);
  }
}
