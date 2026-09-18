import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { MailModule } from '../mail/mail.module.js';
import { ReviewsModule } from '../reviews/reviews.module.js';
import { VaultModule } from '../vault/vault.module.js';

import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { ForYouService } from './for-you.service.js';

/**
 * The customer's own area: sign in by emailed link, read your own licences.
 *
 * Reaches the vault, which almost nothing does. It is allowed to because the
 * ownership check in front of it is the same kind of check the order page
 * already makes — and because the alternative was a customer writing in and a
 * member of staff reading the key out by hand, which is strictly worse for
 * both of them.
 */
@Module({
  imports: [VaultModule, FulfillmentModule, MailModule, ReviewsModule, CatalogModule],
  controllers: [AccountController],
  providers: [AccountService, ForYouService],
})
export class AccountModule {}
