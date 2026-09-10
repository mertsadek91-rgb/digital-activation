'use client';

/**
 * Admin API client.
 *
 * `credentials: 'include'` because the session lives in httpOnly cookies rather
 * than in a token this code could hold. That costs a little convenience and
 * removes an entire class of attack: an injected script here cannot read the
 * session, only ride it, and SameSite=strict stops it doing that from anywhere
 * else.
 */
import type { AdminProductList, Readiness, StaffLoginResult, StaffMe } from '@da/contracts';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Publish blockers, when the failure was the readiness gate. */
    readonly blockers: string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const record = (payload ?? {}) as Record<string, unknown>;
    const message =
      typeof record.message === 'string'
        ? record.message
        : `Request failed (${String(response.status)})`;
    const blockers = Array.isArray(record.blockers)
      ? record.blockers.filter((item): item is string => typeof item === 'string')
      : [];
    throw new ApiError(message, response.status, blockers);
  }

  return payload as T;
}

export const api = {
  login: (email: string, password: string, totp?: string) =>
    request<StaffLoginResult>('/auth/staff/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, ...(totp ? { totp } : {}) }),
    }),

  enroll: (email: string, password: string, totp: string) =>
    request<{ outcome: 'ok'; staff: StaffMe }>('/auth/staff/enroll', {
      method: 'POST',
      body: JSON.stringify({ email, password, totp }),
    }),

  me: () => request<StaffMe>('/auth/staff/me'),

  logout: () => request<{ ok: true }>('/auth/staff/logout', { method: 'POST' }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ staff: StaffMe }>('/auth/staff/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  products: (params: { status?: string; q?: string; page?: number; perPage?: number }) => {
    const search = new URLSearchParams();
    if (params.status && params.status !== 'all') search.set('status', params.status);
    if (params.q) search.set('q', params.q);
    search.set('page', String(params.page ?? 1));
    search.set('perPage', String(params.perPage ?? 50));
    return request<AdminProductList>(`/admin/products?${search.toString()}`);
  },

  readiness: (slug: string) => request<Readiness>(`/admin/products/${slug}/readiness?locale=ar`),

  setStatus: (slug: string, status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED') =>
    request<{ status: string; readiness: Readiness }>(`/admin/products/${slug}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, locale: 'ar' }),
    }),

  setInventory: (sku: string, onHand: number, reason: string, note?: string) =>
    request<{ sku: string; onHand: number; reserved: number }>(`/admin/variants/${sku}/inventory`, {
      method: 'PATCH',
      body: JSON.stringify({ onHand, reason, ...(note ? { note } : {}) }),
    }),
};
