import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { ReviewsModule } from '../reviews/reviews.module.js';
import { VaultModule } from '../vault/vault.module.js';

import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { PromotionsController } from './promotions.controller.js';
import { PromotionsService } from './promotions.service.js';
import { ReviewsAdminController } from './reviews.controller.js';

@Module({
  imports: [AuthModule, VaultModule, CheckoutModule, FulfillmentModule, ReviewsModule],
  controllers: [AdminController, OrdersController, ReviewsAdminController, PromotionsController],
  providers: [AdminService, OrdersService, PromotionsService],
})
export class AdminModule {}
