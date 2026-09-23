import { Module } from '@nestjs/common';

import { GrowthModule } from '../growth/growth.module.js';
import { MarketingModule } from '../marketing/marketing.module.js';
import { SalesModule } from '../offers/sales.module.js';

import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';

@Module({
  // GrowthModule for the referral friend code attached on add-to-cart;
  // MarketingModule and SalesModule because the cart prices lines through the
  // seasonal sales and reads the offer settings (tiers, pairs) on every render.
  imports: [GrowthModule, MarketingModule, SalesModule],
  controllers: [CartController],
  providers: [CartService],
  // The checkout module turns a cart into an order, so it needs the same
  // totals and the same conversion rather than a second implementation.
  exports: [CartService],
})
export class CartModule {}
