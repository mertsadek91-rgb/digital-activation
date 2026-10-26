'use client';

import type {
  AgentBatchDetail,
  AgentCandidates,
  AgentOverview,
  StartAgentBatch,
} from '@da/contracts';

import { request } from './api';

/** The product agent (CR-0007). Starting a batch is the only call that spends AI. */
export const agentApi = {
  overview: () => request<AgentOverview>('/admin/agent'),
  candidates: () => request<AgentCandidates>('/admin/agent/candidates'),
  start: (input: StartAgentBatch) =>
    request<AgentBatchDetail>('/admin/agent/batches', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  batch: (id: string) =>
    request<AgentBatchDetail>(`/admin/agent/batches/${encodeURIComponent(id)}`),
  setStatus: (id: string, action: 'pause' | 'resume' | 'cancel') =>
    request<AgentBatchDetail>(`/admin/agent/batches/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  retry: (itemId: string) =>
    request<AgentBatchDetail>(`/admin/agent/items/${encodeURIComponent(itemId)}/retry`, {
      method: 'POST',
      body: '{}',
    }),
  revert: (itemId: string) =>
    request<AgentBatchDetail>(`/admin/agent/items/${encodeURIComponent(itemId)}/revert`, {
      method: 'POST',
      body: '{}',
    }),
};
