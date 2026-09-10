import { Module } from '@nestjs/common';

import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';

@Module({
  controllers: [CartController],
  providers: [CartService],
  // The checkout module turns a cart into an order, so it needs the same
  // totals and the same conversion rather than a second implementation.
  exports: [CartService],
})
export class CartModule {}
