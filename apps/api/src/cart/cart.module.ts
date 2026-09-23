import { Module } from '@nestjs/common';

import { MarketingModule } from '../marketing/marketing.module.js';
import { SalesModule } from '../offers/sales.module.js';

import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';

@Module({
  // The cart prices lines through the seasonal sales, and reads the offer
  // settings for volume tiers and pair discounts on every render.
  imports: [MarketingModule, SalesModule],
  controllers: [CartController],
  providers: [CartService],
  // The checkout module turns a cart into an order, so it needs the same
  // totals and the same conversion rather than a second implementation.
  exports: [CartService],
})
export class CartModule {}
