import { Module } from '@nestjs/common';

import { AccountModule } from '../account/account.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MailModule } from '../mail/mail.module.js';
import { MarketingModule } from '../marketing/marketing.module.js';

import { BusinessQuoteService } from './business.service.js';
import { GrowthAdminController, GrowthController } from './growth.controller.js';
import { ReferralService } from './referral.service.js';
import { WelcomeService } from './welcome.service.js';

/**
 * Marketing set D: business quotes, the welcome capture and referrals.
 *
 * Exports the welcome service to the newsletter (which owns consent) and the
 * referral service to the cart (which owns the one discount a cart carries).
 */
@Module({
  imports: [MarketingModule, MailModule, AuthModule, AccountModule],
  controllers: [GrowthController, GrowthAdminController],
  providers: [BusinessQuoteService, WelcomeService, ReferralService],
  exports: [WelcomeService, ReferralService],
})
export class GrowthModule {}
