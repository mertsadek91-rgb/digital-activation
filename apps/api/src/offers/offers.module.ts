import { Module } from '@nestjs/common';

import { AccountModule } from '../account/account.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { MarketingModule } from '../marketing/marketing.module.js';

import { OffersAdminController, OffersPublicController } from './offers.controller.js';
import { OffersService } from './offers.service.js';
import { SalesModule } from './sales.module.js';

/**
 * Basket-size offers: suggestions, and the panel's offer and sale helpers.
 *
 * The money side — volume tiers, pair discounts and sale prices — lives in the
 * cart and the catalog, through SalesModule and the pure rules in
 * offer-rules.ts, because that is where totals and prices are decided.
 * CatalogModule for the cards, CheckoutModule for the order-ownership check,
 * AccountModule for a signed-in customer, AuthModule for the staff guard.
 */
@Module({
  imports: [AccountModule, AuthModule, CatalogModule, CheckoutModule, MarketingModule, SalesModule],
  controllers: [OffersPublicController, OffersAdminController],
  providers: [OffersService],
})
export class OffersModule {}
