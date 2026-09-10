import { Module } from '@nestjs/common';

import { CartModule } from '../cart/cart.module.js';

import { CheckoutController } from './checkout.controller.js';
import { CheckoutService } from './checkout.service.js';
import { StripeService } from './stripe.service.js';

@Module({
  // The cart owns the totals and the currency conversion; checkout reads them
  // rather than computing a second, slightly different answer.
  imports: [CartModule],
  controllers: [CheckoutController],
  providers: [CheckoutService, StripeService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
