'use client';

import type {
  AiCopyJob,
  LogoColor,
  ApplySupplierPrices,
  CardDefaults,
  CardPreview,
  CardSpecInput,
  ProductImages,
  SaveCard,
  DraftProduct,
  GenerateCopy,
  SupplierAiModels,
  SupplierAiSettings,
  SupplierAiStatus,
  SupplierAiTest,
  ApplySupplierPricesResult,
  SetSupplierLink,
  SetSupplierSource,
  SupplierItemFilter,
  SupplierItems,
  SupplierLog,
  SupplierMapping,
  SupplierMappingRow,
  SupplierPrices,
  SupplierSourceView,
  SupplierSyncResult,
} from '@da/contracts';

import { request } from './api';

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** The supplier price sheet screens (CR-0004). */
export const supplierApi = {
  source: () => request<SupplierSourceView | null>('/admin/supplier/source'),
  setSource: (input: SetSupplierSource) =>
    request<SupplierSourceView>('/admin/supplier/source', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  sync: (force = false) =>
    request<SupplierSyncResult>('/admin/supplier/sync', {
      method: 'POST',
      body: JSON.stringify({ force }),
    }),
  items: (filter: SupplierItemFilter, q?: string) =>
    request<SupplierItems>(`/admin/supplier/items${query({ filter, q })}`),
  log: (itemId?: string) => request<SupplierLog>(`/admin/supplier/log${query({ itemId })}`),
  mapping: (filter: string, q?: string) =>
    request<SupplierMapping>(`/admin/supplier/mapping${query({ filter, q })}`),
  setLink: (variantId: string, input: SetSupplierLink) =>
    request<SupplierMappingRow>(`/admin/supplier/links/${encodeURIComponent(variantId)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  removeLink: (variantId: string) =>
    request<SupplierMappingRow>(`/admin/supplier/links/${encodeURIComponent(variantId)}`, {
      method: 'DELETE',
    }),
  prices: () => request<SupplierPrices>('/admin/supplier/prices'),
  applyPrices: (input: ApplySupplierPrices) =>
    request<ApplySupplierPricesResult>('/admin/supplier/prices/apply', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};

/** AI copy through OpenCode (CR-0004). Model calls are POSTs. */
export const supplierAiApi = {
  status: () => request<SupplierAiStatus>('/admin/supplier/ai'),
  setSettings: (input: SupplierAiSettings) =>
    request<SupplierAiStatus>('/admin/supplier/ai', { method: 'PUT', body: JSON.stringify(input) }),
  models: () => request<SupplierAiModels>('/admin/supplier/ai/models'),
  test: () => request<SupplierAiTest>('/admin/supplier/ai/test', { method: 'POST', body: '{}' }),
  /** Starts copy generation in the background; poll `copyJob` for the result. */
  copy: (input: GenerateCopy) =>
    request<AiCopyJob>('/admin/supplier/ai/copy', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  copyJob: (id: string) => request<AiCopyJob>(`/admin/supplier/ai/copy/${encodeURIComponent(id)}`),
  draft: (itemId: string) =>
    request<DraftProduct>(`/admin/supplier/ai/draft/${encodeURIComponent(itemId)}`, {
      method: 'POST',
      body: '{}',
    }),
  linkBySku: (itemId: string, sku: string) =>
    request<SupplierMappingRow>(`/admin/supplier/items/${encodeURIComponent(itemId)}/link-sku`, {
      method: 'PUT',
      body: JSON.stringify({ sku }),
    }),
};

/** The product card picture (CR-0004). */
export const supplierCardApi = {
  logoColor: (dataUrl: string) =>
    request<LogoColor>('/admin/supplier/card/logo-color', {
      method: 'POST',
      body: JSON.stringify({ dataUrl }),
    }),
  defaults: (slug: string) =>
    request<CardDefaults>(`/admin/supplier/card/${encodeURIComponent(slug)}`),
  suggest: (slug: string, spec: CardSpecInput) =>
    request<CardSpecInput>(`/admin/supplier/card/${encodeURIComponent(slug)}/suggest`, {
      method: 'POST',
      body: JSON.stringify(spec),
    }),
  preview: (slug: string, spec: CardSpecInput) =>
    request<CardPreview>(`/admin/supplier/card/${encodeURIComponent(slug)}/preview`, {
      method: 'POST',
      body: JSON.stringify(spec),
    }),
  save: (slug: string, input: SaveCard) =>
    request<ProductImages>(`/admin/supplier/card/${encodeURIComponent(slug)}`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
