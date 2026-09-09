import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { validateEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';

/**
 * Release 1 modules land here as they are built, in this order:
 *
 *   auth        customers + staff, JWT, mandatory TOTP for staff
 *   rbac        role and field-level guards
 *   catalog     products, variants, categories, brands, media
 *   inventory   stock levels, timed reservations, movements
 *   vault       encrypted licence keys — the only importer of vaultPrisma
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
    PrismaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
