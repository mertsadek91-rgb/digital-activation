import { Module } from '@nestjs/common';

import { CartModule } from '../cart/cart.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';

import { CheckoutController } from './checkout.controller.js';
import { CheckoutService } from './checkout.service.js';
import { StripeService } from './stripe.service.js';

@Module({
  // The cart owns the totals and the currency conversion; checkout reads them
  // rather than computing a second, slightly different answer.
  // FulfillmentModule because a succeeded payment has to reach the vault and
  // the supplier queue in the same request — an order that is paid and not
  // queued is a customer nobody is working for.
  imports: [CartModule, FulfillmentModule],
  controllers: [CheckoutController],
  providers: [CheckoutService, StripeService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
