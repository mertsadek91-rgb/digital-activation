import { type Cart, type Checkout, cartSchema, checkoutSchema } from '@da/contracts';
import { FulfillmentState, OrderStatus } from '@da/db';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CheckoutService } from '../checkout/checkout.service.js';

import {
  type Catalogue,
  type Harness,
  HAS_DATABASE,
  bootApp,
  chargeRefunded,
  deliver,
  paymentSucceeded,
  seedCatalogue,
  shopper,
} from './harness.js';

/**
 * Cart to paid order to delivered keys, and the ways a payment goes wrong.
 *
 * The scenarios share one catalogue and run in order: the refund at the end
 * refunds the order the first scenario paid for, so the sales counter it
 * checks has something to give back.
 */
describe.skipIf(!HAS_DATABASE)('checkout, payment webhook and fulfilment', () => {
  let harness: Harness;
  let catalogue: Catalogue;

  beforeAll(async () => {
    harness = await bootApp();
    catalogue = await seedCatalogue(harness);
  });

  afterAll(async () => {
    await harness?.close();
  });

  /** A new browser with these lines in its cart and a drafted order. */
  async function checkoutWith(
    lines: { variantId: string; qty: number }[],
    email: string,
    coupon?: string,
  ): Promise<{ checkout: Checkout; cart: Cart; browser: ReturnType<typeof shopper> }> {
    const browser = shopper(harness);
    for (const line of lines) {
      const added = await browser.request('POST', '/v1/cart/items', line);
      expect(added.status).toBe(201);
    }
    if (coupon) {
      const applied = await browser.request<Cart>('POST', '/v1/cart/coupon', { code: coupon });
      expect(applied.body.couponError).toBeNull();
    }
    const started = await browser.request<Checkout>('POST', '/v1/checkout', { email });
    expect(started.status).toBe(201);
    // The documented response shape is the real one.
    const checkout = checkoutSchema.parse(started.body);
    return { checkout, cart: cartSchema.parse(checkout.cart), browser };
  }

  /** What the order costs in the money it will be charged in. */
  const chargeOf = (orderNumber: string) =>
    harness.get(CheckoutService).chargeForNumber(orderNumber);

  const salesCount = async (productId: string) =>
    (await harness.db.product.findUniqueOrThrow({ where: { id: productId } })).salesCount;

  // Carried from the paid order to the duplicate delivery and the refund.
  let paidOrder: string;
  let paidEvent: Stripe.Event;
  let paidIntent: string;

  it('(a) pays a stocked order and assigns one key per licence', async () => {
    const before = await salesCount(catalogue.stocked.productId);
    const { checkout } = await checkoutWith(
      [{ variantId: catalogue.stocked.variantId, qty: 2 }],
      `a-${catalogue.run}@example.test`,
    );
    paidOrder = checkout.order.number;

    // Two licences are two order lines, not one line of quantity two.
    expect(checkout.order.lines).toHaveLength(2);

    const charge = await chargeOf(paidOrder);
    paidEvent = paymentSucceeded({ orderNumber: paidOrder, ...charge });
    paidIntent = (paidEvent.data.object as Stripe.PaymentIntent).id;
    const delivered = await deliver(harness, paidEvent);
    expect(delivered).toEqual({ status: 201, body: { received: true } });

    const order = await harness.db.order.findUniqueOrThrow({
      where: { number: paidOrder },
      include: { items: true },
    });
    expect(order.status).toBe(OrderStatus.PAID);
    expect(order.paidAt).not.toBeNull();

    expect(order.items).toHaveLength(2);
    for (const item of order.items) {
      expect(item.qty).toBe(1);
      expect(item.fulfillmentState).toBe(FulfillmentState.AUTO_ASSIGNED);
      expect(item.assignedKeyIds).toHaveLength(1);
    }
    const keys = order.items.flatMap((item) => item.assignedKeyIds);
    expect(new Set(keys).size).toBe(2);

    expect(await salesCount(catalogue.stocked.productId)).toBe(before + 2);

    // The hold became a sale: two of the three keys left the shelf.
    const level = await harness.db.inventoryLevel.findUniqueOrThrow({
      where: { variantId: catalogue.stocked.variantId },
    });
    expect(level.onHand).toBe(1);
  });

  it('(c) applies a redelivered webhook once', async () => {
    const before = await salesCount(catalogue.stocked.productId);

    const again = await deliver(harness, paidEvent);
    expect(again).toEqual({ status: 201, body: { received: true } });

    const logged = await harness.db.webhookEvent.findFirstOrThrow({
      where: { eventId: paidEvent.id },
    });
    expect(logged.attempts).toBe(2);
    expect(logged.processedAt).not.toBeNull();

    expect(await salesCount(catalogue.stocked.productId)).toBe(before);
    const items = await harness.db.orderItem.findMany({ where: { order: { number: paidOrder } } });
    expect(items.flatMap((item) => item.assignedKeyIds)).toHaveLength(2);
    const payments = await harness.db.payment.count({ where: { providerRef: paidIntent } });
    expect(payments).toBe(1);
  });

  it('(b) holds an order for review when the amount charged is not what it costs', async () => {
    const { checkout } = await checkoutWith(
      [{ variantId: catalogue.madeToOrder.variantId, qty: 1 }],
      `b-${catalogue.run}@example.test`,
    );
    const charge = await chargeOf(checkout.order.number);
    // One unit short: the intent of a cheaper draft, confirmed after the cart grew.
    const short = (Number(charge.amount) - 1).toFixed(2);

    await deliver(
      harness,
      paymentSucceeded({
        orderNumber: checkout.order.number,
        amount: short,
        currency: charge.currency,
      }),
    );

    const order = await harness.db.order.findUniqueOrThrow({
      where: { number: checkout.order.number },
      include: { notes: true, items: true },
    });
    expect(order.status).toBe(OrderStatus.PAYMENT_REVIEW);
    expect(order.notes.some((note) => note.body.startsWith('Held for review'))).toBe(true);
    // Review means the key is held back: fulfilment did not touch the line.
    expect(order.items.every((item) => item.assignedKeyIds.length === 0)).toBe(true);
  });

  it('(d) lets a single-use coupon be redeemed once across two orders', async () => {
    // Both carts take the code while it is still unused — two tabs, two buyers.
    const first = await checkoutWith(
      [{ variantId: catalogue.madeToOrder.variantId, qty: 1 }],
      `d1-${catalogue.run}@example.test`,
      catalogue.coupon.code,
    );
    const second = await checkoutWith(
      [{ variantId: catalogue.madeToOrder.variantId, qty: 1 }],
      `d2-${catalogue.run}@example.test`,
      catalogue.coupon.code,
    );
    expect(first.cart.coupon?.code).toBe(catalogue.coupon.code);
    expect(second.cart.coupon?.code).toBe(catalogue.coupon.code);

    for (const { checkout } of [first, second]) {
      const charge = await chargeOf(checkout.order.number);
      await deliver(harness, paymentSucceeded({ orderNumber: checkout.order.number, ...charge }));
    }

    const status = async (number: string) =>
      (await harness.db.order.findUniqueOrThrow({ where: { number } })).status;
    expect(await status(first.checkout.order.number)).toBe(OrderStatus.PAID);
    // The money is taken either way; the second order waits for a person.
    expect(await status(second.checkout.order.number)).toBe(OrderStatus.PAYMENT_REVIEW);

    const promotion = await harness.db.promotion.findUniqueOrThrow({
      where: { id: catalogue.coupon.id },
    });
    expect(promotion.usageCount).toBe(1);

    // And a third shopper is told at the cart, before any payment.
    const third = shopper(harness);
    await third.request('POST', '/v1/cart/items', {
      variantId: catalogue.madeToOrder.variantId,
      qty: 1,
    });
    const refused = await third.request<Cart>('POST', '/v1/cart/coupon', {
      code: catalogue.coupon.code,
    });
    expect(refused.body.coupon).toBeNull();
    expect(refused.body.couponError).toBeTruthy();
  });

  it('attaches an earned bundle without the code being typed', async () => {
    const browser = shopper(harness);
    await browser.request('POST', '/v1/cart/items', {
      variantId: catalogue.stocked.variantId,
      qty: 1,
    });
    const both = await browser.request<Cart>('POST', '/v1/cart/items', {
      variantId: catalogue.madeToOrder.variantId,
      qty: 1,
    });
    const cart = cartSchema.parse(both.body);
    expect(cart.coupon?.code).toBe(catalogue.bundle.code);
    // 15% of 20 + 35.
    expect(Number(cart.discount.amount)).toBeCloseTo(8.25, 2);

    // Release the hold so the last key is not kept off the shelf.
    await browser.request('DELETE', '/v1/cart');
  });

  it('(e) refunds the paid order and gives the sales back', async () => {
    const before = await salesCount(catalogue.stocked.productId);
    const charge = await chargeOf(paidOrder);

    const refund = chargeRefunded({ intentId: paidIntent, ...charge });
    expect(await deliver(harness, refund)).toEqual({ status: 201, body: { received: true } });
    // A replayed refund changes nothing further.
    await deliver(harness, refund);

    const order = await harness.db.order.findUniqueOrThrow({ where: { number: paidOrder } });
    expect(order.status).toBe(OrderStatus.REFUNDED);
    expect(await salesCount(catalogue.stocked.productId)).toBe(before - 2);

    const refunds = await harness.db.refund.findMany({
      where: { payment: { providerRef: paidIntent } },
    });
    expect(refunds).toHaveLength(1);
  });
});
