import { randomBytes } from 'node:crypto';

import { marketingSettingKey } from '@da/contracts';
import { CartStage } from '@da/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CartRecoveryService } from '../retention/cart-recovery.service.js';

import { type Catalogue, type Harness, HAS_DATABASE, bootApp, seedCatalogue } from './harness.js';

/**
 * The abandoned-cart ladder writes only to people who agreed to marketing.
 *
 * A cart reminder is marketing, not a service message, so a guest who never
 * opted in — or a customer who opted out afterwards — must get nothing, even
 * with an email on the cart and every other condition met.
 */
describe.skipIf(!HAS_DATABASE)('cart recovery sweep', () => {
  let harness: Harness;
  let catalogue: Catalogue;

  beforeAll(async () => {
    harness = await bootApp();
    catalogue = await seedCatalogue(harness);

    // Written before the first sweep reads it (the settings are cached per
    // process). One rung after an hour, no discount, no holdout, and no quiet
    // hours so the test does not depend on the time of day it runs at.
    const value = {
      enabled: true,
      steps: [{ afterHours: 1, discountPercent: 0 }],
      quietFromHour: 0,
      quietToHour: 0,
      holdoutPercent: 0,
    };
    await harness.db.setting.upsert({
      where: { key: marketingSettingKey('cartRecovery') },
      update: { value },
      create: { key: marketingSettingKey('cartRecovery'), value },
    });
  });

  afterAll(async () => {
    await harness?.close();
  });

  /** A cart left two hours ago by a customer with this consent history. */
  async function abandonedCart(
    label: string,
    consent: { optInAt: Date | null; optOutAt: Date | null },
  ): Promise<{ email: string; cartId: string }> {
    const email = `${label}-${catalogue.run}@example.test`;
    const customer = await harness.db.customer.create({
      data: {
        email,
        marketingOptInAt: consent.optInAt,
        marketingOptOutAt: consent.optOutAt,
      },
    });
    const cart = await harness.db.cart.create({
      data: {
        token: randomBytes(24).toString('base64url'),
        email,
        customerId: customer.id,
        lastActivityAt: new Date(Date.now() - 2 * 3_600_000),
        items: {
          create: {
            variantId: catalogue.madeToOrder.variantId,
            qty: 1,
            unitPriceUsd: catalogue.madeToOrder.priceUsd,
          },
        },
      },
    });
    return { email, cartId: cart.id };
  }

  it('(f) emails the consenting customer and nobody else', async () => {
    const day = 86_400_000;
    const consenting = await abandonedCart('opted-in', {
      optInAt: new Date(Date.now() - day),
      optOutAt: null,
    });
    const guest = await abandonedCart('never-asked', { optInAt: null, optOutAt: null });
    const withdrew = await abandonedCart('opted-out', {
      optInAt: null,
      optOutAt: new Date(Date.now() - day),
    });

    await harness.get(CartRecoveryService).sweep();

    const sentTo = async (email: string) =>
      harness.db.notificationLog.count({
        where: { toAddress: email, template: { startsWith: 'cart.recovery.' } },
      });
    expect(await sentTo(consenting.email)).toBe(1);
    expect(await sentTo(guest.email)).toBe(0);
    expect(await sentTo(withdrew.email)).toBe(0);

    // The consenting cart moved one rung up the ladder; the others did not.
    const stage = async (id: string) =>
      (await harness.db.cart.findUniqueOrThrow({ where: { id } })).stage;
    expect(await stage(consenting.cartId)).not.toBe(CartStage.ACTIVE);
    expect(await stage(guest.cartId)).toBe(CartStage.ACTIVE);
    expect(await stage(withdrew.cartId)).toBe(CartStage.ACTIVE);

    // A second pass inside the same hour sends nothing new.
    await harness.get(CartRecoveryService).sweep();
    expect(await sentTo(consenting.email)).toBe(1);
  });
});
