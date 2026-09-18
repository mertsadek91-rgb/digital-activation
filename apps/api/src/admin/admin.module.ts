import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { MailModule } from '../mail/mail.module.js';
import { ReviewsModule } from '../reviews/reviews.module.js';
import { VaultModule } from '../vault/vault.module.js';

import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { CatalogEditController } from './catalog-edit.controller.js';
import { CatalogEditService } from './catalog-edit.service.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { LaunchController } from './launch.controller.js';
import { LaunchService } from './launch.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { ProductContentController } from './product-content.controller.js';
import { ProductContentService } from './product-content.service.js';
import { PromotionsController } from './promotions.controller.js';
import { PromotionsService } from './promotions.service.js';
import { ReviewsAdminController } from './reviews.controller.js';

@Module({
  imports: [AuthModule, VaultModule, CheckoutModule, FulfillmentModule, ReviewsModule, MailModule],
  controllers: [
    AdminController,
    CatalogEditController,
    ProductContentController,
    OrdersController,
    ReviewsAdminController,
    PromotionsController,
    LaunchController,
    DashboardController,
  ],
  providers: [AdminService, CatalogEditService, ProductContentService, OrdersService, PromotionsService, LaunchService, DashboardService],
})
export class AdminModule {}
