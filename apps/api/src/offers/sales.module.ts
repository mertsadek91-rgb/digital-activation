import { Module } from '@nestjs/common';

import { MarketingModule } from '../marketing/marketing.module.js';

import { SalesService } from './sales.service.js';

/**
 * Seasonal sale pricing, on its own so the catalog and the cart can import it
 * without importing the offers controllers — which themselves need the
 * catalog's cards, and would make the two modules import each other.
 */
@Module({
  imports: [MarketingModule],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
