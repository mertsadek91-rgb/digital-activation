import { Injectable } from '@nestjs/common';

import type { SaleBadge } from '@da/contracts';
import type { Prisma } from '@da/db';

import { applySale } from '../catalog/pricing.js';
import { MarketingSettingsService } from '../marketing/marketing-settings.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { type LiveSale, liveSales, saleFor } from './offer-rules.js';

/** The category tree changes rarely and every priced page asks for it. */
const CATEGORY_CACHE_MS = 60_000;

/**
 * Seasonal sales, as the pricing path consumes them.
 *
 * The catalog, the cart and the checkout all ask this one service which sale
 * prices a product, and apply it through `applySale` in catalog/pricing.ts —
 * so a card, the product page, its JSON-LD and the charge cannot disagree.
 *
 * The settings are cached by MarketingSettingsService (30s), so a sale starts
 * and ends within that of its scheduled minute on every replica. Catalog pages
 * are also cached by the storefront (revalidate 300s); the cart and checkout
 * are not, and they are what is charged.
 */
@Injectable()
export class SalesService {
  private categories: { at: number; value: { id: string; parentId: string | null }[] } | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: MarketingSettingsService,
  ) {}

  private async categoryTree(): Promise<{ id: string; parentId: string | null }[]> {
    if (this.categories && Date.now() - this.categories.at < CATEGORY_CACHE_MS) {
      return this.categories.value;
    }
    const value = await this.prisma.client.category.findMany({
      select: { id: true, parentId: true },
    });
    this.categories = { at: Date.now(), value };
    return value;
  }

  /** Sales in force now, with category scopes widened to their subtrees. */
  async live(now: Date = new Date()): Promise<LiveSale[]> {
    const seasonal = await this.settings.get('seasonal');
    if (!seasonal.enabled || seasonal.sales.length === 0) return [];
    return liveSales(seasonal, now, await this.categoryTree());
  }

  /** A scope as a sale sees it, widened the same way — for the panel's preview count. */
  async scopeOf(input: { productIds: string[]; categoryIds: string[] }): Promise<LiveSale> {
    const [sale] = liveSales(
      {
        enabled: true,
        sales: [
          {
            id: 'preview',
            name: { ar: '', en: '' },
            startsAt: new Date(0).toISOString(),
            endsAt: new Date(8.64e15).toISOString(),
            percent: 1,
            productIds: input.productIds,
            categoryIds: input.categoryIds,
            licenceNumber: '',
            showCountdown: false,
          },
        ],
      },
      new Date(),
      await this.categoryTree(),
    );
    return sale!;
  }
}

/** The product-side facts a sale is matched on. */
export interface SaleTarget {
  id: string;
  categoryIds: readonly string[];
}

/** What the storefront badge needs, in the page's locale. */
export function saleBadge(sale: LiveSale, locale: 'ar' | 'en'): SaleBadge {
  const name = (locale === 'en' ? sale.name.en : sale.name.ar) || sale.name.ar || sale.name.en;
  return {
    id: sale.id,
    name,
    percent: sale.percent,
    endsAt: sale.endsAt.toISOString(),
    licenceNumber: sale.licenceNumber,
    showCountdown: sale.showCountdown,
  };
}

/**
 * A variant's price after the sale on its product, if any. The one call every
 * priced surface makes; `applySale` is the arithmetic.
 */
export function salePriced(
  variant: { priceUsd: Prisma.Decimal; compareAtUsd: Prisma.Decimal | null },
  sale: LiveSale | null,
): { priceUsd: Prisma.Decimal; compareAtUsd: Prisma.Decimal | null } {
  return applySale(variant.priceUsd, variant.compareAtUsd, sale?.percent ?? null);
}

export { saleFor };
