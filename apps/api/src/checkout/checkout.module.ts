import { Module } from '@nestjs/common';

import { AccountModule } from '../account/account.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CartModule } from '../cart/cart.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { MailModule } from '../mail/mail.module.js';

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
  // MailModule for the transfer-instruction email. A manual payment is the one
  // method where the details a customer needs are not on the screen they end up
  // on — they are in a banking app, later — so the message is part of taking
  // the order rather than part of fulfilling it.
  // AccountModule so the order page can accept a signed-in customer.
  imports: [AccountModule, AuthModule, CartModule, FulfillmentModule, MailModule],
  controllers: [CheckoutController, PaymentSettingsController],
  providers: [CheckoutService, PaymentSettingsService, StripeService],
  // PaymentSettingsService too, because the launch checklist asks it the one
  // question that decides whether this store can take money at all — and the
  // methods already know their own reasons for being off.
  exports: [CheckoutService, PaymentSettingsService],
})
export class CheckoutModule {}
