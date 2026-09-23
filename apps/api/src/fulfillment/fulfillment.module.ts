import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { MailModule } from '../mail/mail.module.js';
import { VaultModule } from '../vault/vault.module.js';

import { FulfillmentController } from './fulfillment.controller.js';
import { FulfillmentService } from './fulfillment.service.js';
import { StrandedSweepService } from './stranded-sweep.service.js';

@Module({
  // AuthModule for the staff guard and the audit log; VaultModule for the one
  // service that can open a licence.
  imports: [AuthModule, MailModule, VaultModule],
  controllers: [FulfillmentController],
  // StrandedSweepService picks up paid orders whose fulfilment failed after
  // the payment was recorded.
  providers: [FulfillmentService, StrandedSweepService],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}
