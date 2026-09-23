import { Module } from '@nestjs/common';

import { GrowthModule } from '../growth/growth.module.js';

import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';

@Module({
  // For the referral friend code, attached on add-to-cart.
  imports: [GrowthModule],
  controllers: [CartController],
  providers: [CartService],
  // The checkout module turns a cart into an order, so it needs the same
  // totals and the same conversion rather than a second implementation.
  exports: [CartService],
})
export class CartModule {}
