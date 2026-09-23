import { randomBytes } from 'node:crypto';

import fastifyCookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  CredentialKind,
  FulfillmentMode,
  Locale,
  PromotionType,
  PublishStatus,
  type PrismaClient,
} from '@da/db';
import type Stripe from 'stripe';
import { vi } from 'vitest';

import { AppModule } from '../app.module.js';
import { toMinorUnits, StripeService } from '../checkout/stripe.service.js';
import { registerPanelLocale } from '../common/panel-locale.js';
import { PrismaErrorFilter } from '../common/prisma-error.filter.js';
import { FulfillmentService } from '../fulfillment/fulfillment.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { testDatabaseUrl } from './guard.js';

/** Whether this run has a database to test against. Suites skip without one. */
export const HAS_DATABASE = testDatabaseUrl() !== null;

export interface Harness {
  app: NestFastifyApplication;
  db: PrismaClient;
  /** Nest's own instance, so tests can reach any provider by class. */
  get<T>(token: new (...args: never[]) => T): T;
  close(): Promise<void>;
}

/**
 * The real AppModule, wired the way main.ts wires it.
 *
 * Not a hand-picked testing module: the point is the checkout, the webhook
 * and fulfilment running through the same providers, pipes, guards and
 * filters production does. The bootstrap lines below mirror main.ts — the
 * cookie plugin, the global prefix and the Prisma error filter all change what
 * a request sees — minus listening on a port; requests go through Fastify's
 * `inject`.
 *
 * Stripe is the one thing replaced. Signature verification is swapped for a
 * parse of the body, so a test can post an event it built, and the Radar
 * lookup returns "no verdict". Nothing reaches Stripe: STRIPE_SECRET_KEY is
 * blank (see env.ts), and every other Stripe path refuses without it.
 */
export async function bootApp(): Promise<Harness> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    rawBody: true,
    logger: ['error', 'warn'],
  });
  await app.register(fastifyCookie);
  registerPanelLocale(app.getHttpAdapter().getInstance());
  app.setGlobalPrefix('v1', { exclude: ['health', 'health/ready'] });
  app.useGlobalFilters(new PrismaErrorFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  // The sweeps are called by the tests that are about them, at a moment the
  // test chooses. A cron firing mid-suite would move carts and orders under
  // the assertions.
  for (const job of app.get(SchedulerRegistry).getCronJobs().values()) void job.stop();

  const stripe = app.get(StripeService, { strict: false });
  vi.spyOn(stripe, 'constructEvent').mockImplementation(
    (raw: Buffer | string) => JSON.parse(raw.toString()) as Stripe.Event,
  );
  vi.spyOn(stripe, 'riskLevelOf').mockResolvedValue(null);

  return {
    app,
    db: app.get(PrismaService, { strict: false }).client,
    get: (token) => app.get(token, { strict: false }),
    close: () => app.close(),
  };
}

// --- HTTP -------------------------------------------------------------------

export interface Shopper {
  /** The cart cookie, once the API has set one. */
  cart: string | undefined;
  request<T = unknown>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }>;
}

/** One browser: carries the cart cookie from response to request. */
export function shopper(harness: Harness): Shopper {
  const self: Shopper = {
    cart: undefined,
    async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
      const response = await harness.app.inject({
        method,
        url,
        headers: {
          ...(self.cart ? { cookie: `da_cart=${self.cart}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
      });
      const set = response.cookies.find((cookie) => cookie.name === 'da_cart');
      if (set) self.cart = set.value;
      return { status: response.statusCode, body: response.json<T>() };
    },
  };
  return self;
}

// --- catalogue --------------------------------------------------------------

export interface Catalogue {
  run: string;
  stocked: { productId: string; variantId: string; priceUsd: string };
  madeToOrder: { productId: string; variantId: string; priceUsd: string };
  /** 10% off, one redemption in total across all customers. */
  coupon: { id: string; code: string };
  /** 15% off whenever both variants are in one cart. */
  bundle: { id: string; code: string };
}

/**
 * The smallest catalogue the scenarios need, under names unique to this run.
 *
 * Unique rather than truncated between runs: the CI database is also seeded,
 * and a suite that wiped it would test an empty store rather than a real one.
 * The stocked variant's three keys go through FulfillmentService.importKeys —
 * the vault's own import path — which is also what sets the shelf count the
 * cart holds stock against.
 */
export async function seedCatalogue(harness: Harness): Promise<Catalogue> {
  const run = randomBytes(4).toString('hex');
  const { db } = harness;

  const product = async (slug: string, sku: string, priceUsd: string, mode: FulfillmentMode) =>
    db.product.create({
      data: {
        slug,
        status: PublishStatus.PUBLISHED,
        publishedAt: new Date(),
        translations: { create: { locale: Locale.AR, name: `Integration ${slug}` } },
        variants: {
          create: {
            sku,
            priceUsd,
            status: PublishStatus.PUBLISHED,
            isDefault: true,
            fulfillmentMode: mode,
            credentialKind: CredentialKind.ACTIVATION_KEY,
          },
        },
      },
      include: { variants: true },
    });

  const stocked = await product(
    `it-stocked-${run}`,
    `IT-STOCK-${run}`,
    '20.00',
    FulfillmentMode.FROM_STOCK,
  );
  const madeToOrder = await product(
    `it-mto-${run}`,
    `IT-MTO-${run}`,
    '35.00',
    FulfillmentMode.ON_DEMAND,
  );
  const stockedVariant = stocked.variants[0];
  const madeVariant = madeToOrder.variants[0];
  if (!stockedVariant || !madeVariant) throw new Error('Seed variants were not created.');

  await harness.get(FulfillmentService).importKeys({
    variantId: stockedVariant.id,
    block: [1, 2, 3]
      .map((n) => `IT-${run}-KEY-${String(n)}-${randomBytes(6).toString('hex')}`)
      .join('\n'),
    // A fresh TOTP timestamp: the vault refuses an import from a session that
    // has not stepped up recently, and this is the one place a test is staff.
    actor: { staffId: `integration-${run}`, totpAt: Math.floor(Date.now() / 1000) },
  });

  const coupon = await db.promotion.create({
    data: {
      code: `IT${run.toUpperCase()}`,
      type: PromotionType.PERCENT,
      value: 10,
      name: `Integration coupon ${run}`,
      usageLimit: 1,
      // Explicitly no per-customer cap (the column defaults to one), so the
      // test exercises the total limit across two different buyers.
      perCustomerLimit: null,
    },
  });
  const bundle = await db.promotion.create({
    data: {
      code: `ITB${run.toUpperCase()}`,
      type: PromotionType.BUNDLE_DISCOUNT,
      value: 15,
      name: `Integration bundle ${run}`,
      perCustomerLimit: null,
      rules: { requiresAllVariantIds: [stockedVariant.id, madeVariant.id] },
    },
  });

  return {
    run,
    stocked: { productId: stocked.id, variantId: stockedVariant.id, priceUsd: '20.00' },
    madeToOrder: { productId: madeToOrder.id, variantId: madeVariant.id, priceUsd: '35.00' },
    coupon: { id: coupon.id, code: coupon.code ?? '' },
    bundle: { id: bundle.id, code: bundle.code ?? '' },
  };
}

// --- Stripe events ------------------------------------------------------------

let sequence = 0;
const nextId = (prefix: string): string =>
  `${prefix}_it_${Date.now().toString(36)}${String((sequence += 1))}`;

/** What Stripe would send once a card payment for this order clears. */
export function paymentSucceeded(input: {
  orderNumber: string;
  amount: string;
  currency: string;
  intentId?: string;
}): Stripe.Event {
  return {
    id: nextId('evt'),
    object: 'event',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: input.intentId ?? nextId('pi'),
        object: 'payment_intent',
        amount_received: toMinorUnits(input.amount, input.currency),
        currency: input.currency.toLowerCase(),
        metadata: { orderNumber: input.orderNumber },
        latest_charge: null,
      },
    },
  } as unknown as Stripe.Event;
}

/** A full refund of the charge behind an intent. */
export function chargeRefunded(input: {
  intentId: string;
  amount: string;
  currency: string;
}): Stripe.Event {
  const minor = toMinorUnits(input.amount, input.currency);
  return {
    id: nextId('evt'),
    object: 'event',
    type: 'charge.refunded',
    data: {
      object: {
        id: nextId('ch'),
        object: 'charge',
        payment_intent: input.intentId,
        amount: minor,
        amount_refunded: minor,
        refunded: true,
      },
    },
  } as unknown as Stripe.Event;
}

/** Delivers an event to the webhook route, the way Stripe would. */
export async function deliver(
  harness: Harness,
  event: Stripe.Event,
): Promise<{ status: number; body: unknown }> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/v1/webhooks/stripe',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=0,v1=integration' },
    payload: JSON.stringify(event),
  });
  return { status: response.statusCode, body: response.json() };
}
