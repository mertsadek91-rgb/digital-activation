'use client';

import type { AdminReferralList, BusinessQuoteList, WelcomeStats } from '@da/contracts';

import { request } from './api';

/**
 * The growth screens' reads (business quotes, welcome window, referrals).
 * Settings themselves go through `api.marketingSettings` like every feature.
 */
export const growthApi = {
  businessQuotes: () => request<BusinessQuoteList>('/admin/marketing/business/quotes'),
  welcomeStats: () => request<WelcomeStats>('/admin/marketing/welcome/stats'),
  referrals: () => request<AdminReferralList>('/admin/marketing/referrals'),
  approveReferral: (id: string) =>
    request<{ id: string; status: string }>(
      `/admin/marketing/referrals/${encodeURIComponent(id)}/approve`,
      { method: 'POST', body: '{}' },
    ),
  rejectReferral: (id: string) =>
    request<{ id: string; status: string }>(
      `/admin/marketing/referrals/${encodeURIComponent(id)}/reject`,
      { method: 'POST', body: '{}' },
    ),
};
