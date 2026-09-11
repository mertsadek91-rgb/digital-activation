import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { VaultModule } from '../vault/vault.module.js';

import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [AuthModule, VaultModule, CheckoutModule, FulfillmentModule],
  controllers: [AdminController, OrdersController],
  providers: [AdminService, OrdersService],
})
export class AdminModule {}
