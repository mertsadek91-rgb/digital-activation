import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { CartModule } from '../cart/cart.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';

import { CheckoutController } from './checkout.controller.js';
import { CheckoutService } from './checkout.service.js';
import { PaymentSettingsController } from './payment-settings.controller.js';
import { PaymentSettingsService } from './payment-settings.service.js';
import { StripeService } from './stripe.service.js';

@Module({
  // The cart owns the totals and the currency conversion; checkout reads them
  // rather than computing a second, slightly different answer.
  // FulfillmentModule because a succeeded payment has to reach the vault and
  // the supplier queue in the same request — an order that is paid and not
  // queued is a customer nobody is working for.
  // AuthModule for the one staff-guarded screen that belongs here: the bank and
  // wallet details the payment step reads are edited beside the code that
  // decides whether they are complete enough to offer.
  imports: [AuthModule, CartModule, FulfillmentModule],
  controllers: [CheckoutController, PaymentSettingsController],
  providers: [CheckoutService, PaymentSettingsService, StripeService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
