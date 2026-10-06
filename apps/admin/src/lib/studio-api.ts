'use client';

import type { StudioChat, StudioJob, StudioView, WriteArticle } from '@da/contracts';

import { request } from './api';

/** The article studio (CR-0006). Model calls start jobs polled with `job`. */
export const studioApi = {
  view: () => request<StudioView>('/admin/studio'),
  chat: (input: StudioChat) =>
    request<StudioJob>('/admin/studio/chat', { method: 'POST', body: JSON.stringify(input) }),
  clearChat: () => request<StudioView>('/admin/studio/chat', { method: 'DELETE' }),
  setIdea: (id: string, status: 'NEW' | 'DISMISSED') =>
    request<StudioView>(`/admin/studio/ideas/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  write: (input: WriteArticle) =>
    request<StudioJob>('/admin/studio/articles', { method: 'POST', body: JSON.stringify(input) }),
  job: (id: string) => request<StudioJob>(`/admin/studio/jobs/${encodeURIComponent(id)}`),
};

/** Polls a studio job every 3 s until it finishes; gives up after 15 minutes. */
export async function waitForStudioJob(
  id: string,
  hooks: { onElapsed: (seconds: number) => void; isActive: () => boolean; timedOut: string },
): Promise<StudioJob> {
  const started = Date.now();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (!hooks.isActive()) throw new Error('cancelled');
    hooks.onElapsed(Math.round((Date.now() - started) / 1000));
    const job = await studioApi.job(id);
    if (job.status !== 'RUNNING') return job;
    if (Date.now() - started > 15 * 60 * 1000) throw new Error(hooks.timedOut);
  }
}
