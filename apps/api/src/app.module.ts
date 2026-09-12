import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { AccountModule } from './account/account.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CartModule } from './cart/cart.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { CheckoutModule } from './checkout/checkout.module.js';
import { ContentModule } from './content/content.module.js';
import { FulfillmentModule } from './fulfillment/fulfillment.module.js';
import { MailModule } from './mail/mail.module.js';
import { validateEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { VaultModule } from './vault/vault.module.js';

/**
 * Release 1 modules land here as they are built, in this order:
 *
 *   auth        staff, JWT in httpOnly cookies, mandatory TOTP   [done]
 *   rbac        role guard                                    [done]
 *   catalog     products, variants, categories, brands, media   [done]
 *   inventory   stock levels, timed reservations, movements       [done]
 *   vault       encrypted licence keys — the only importer of vaultPrisma [done]
 *   fulfilment  assign a key on payment, deliver, retry, manual queue
 *   cart        server-side carts (prerequisite for recovery in Release 2)
 *   checkout    one-page checkout, idempotent order creation
 *   payments    Stripe, PayPal, manual transfer with proof upload
 *   orders      state machine, invoices, notes
 *   content     pages, articles, navigation, redirects
 *   seo         sitemaps, structured data, 404 monitor
 *   admin       staff-facing endpoints
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // One .env at the repo root, shared by every app.
      envFilePath: ['../../.env'],
      validate: validateEnv,
    }),
    // Protects login, coupon validation and checkout from brute force. Coupon
    // validation matters as much as login: guessable codes are money.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    // The one scheduled thing in this system so far: the review invitation
    // sweep. It guards itself with a Postgres advisory lock, so registering it
    // here is safe on more than one replica.
    ScheduleModule.forRoot(),
    PrismaModule,
    CatalogModule,
    CartModule,
    CheckoutModule,
    ContentModule,
    VaultModule,
    MailModule,
    FulfillmentModule,
    AuthModule,
    AdminModule,
    AccountModule,
    ReviewsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
