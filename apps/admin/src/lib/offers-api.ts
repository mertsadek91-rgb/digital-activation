import type { OfferCatalogOptions, OfferStats, SalePreview, SalePreviewInput } from '@da/contracts';

import { request } from './api';

/**
 * The offers and seasonal screens' own calls. Their settings are saved through
 * `api.setMarketingSettings`, like every marketing feature, so every change is
 * audited in one place; these are the helpers around that.
 */
export const offersApi = {
  /** Every product and category, for the pickers, and the store's time zone. */
  options: () => request<OfferCatalogOptions>('/admin/marketing/offers/options'),

  /** Paid orders in the last 30 days by volume tier, pair and sale. */
  stats: () => request<OfferStats>('/admin/marketing/offers/stats'),

  /** How many published products a sale's scope would price. */
  salePreview: (input: SalePreviewInput) =>
    request<SalePreview>('/admin/marketing/seasonal/preview', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
