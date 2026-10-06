import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SupplierSyncService } from '../supplier/supplier-sync.service.js';
import { SupplierService } from '../supplier/supplier.service.js';

import {
  type Catalogue,
  type Harness,
  HAS_DATABASE,
  bootApp,
  seedCatalogue,
  shopper,
} from './harness.js';

/**
 * The supplier sheet's two effects on the store (CR-0004), against a real
 * database: a linked variant's price follows cost × (1 + markup) only when a
 * person applies it, and a struck-through line makes the variant unbuyable
 * until it clears.
 *
 * The sheet itself is not fetched here — its parsing is pinned by the unit
 * tests — so the lines are written as a sync would leave them.
 */
describe.skipIf(!HAS_DATABASE)('supplier sheet links, prices and availability', () => {
  let harness: Harness;
  let catalogue: Catalogue;
  let actor: { staffId: string };
  let itemId: string;

  beforeAll(async () => {
    harness = await bootApp();
    catalogue = await seedCatalogue(harness);
    const staff = await harness.db.staffUser.create({
      data: {
        email: `supplier-${catalogue.run}@example.test`,
        name: 'Supplier test',
        passwordHash: 'not-a-real-hash',
        role: 'ADMIN',
      },
    });
    actor = { staffId: staff.id };

    // One source; the service reads the oldest, so reuse one if the CI
    // database already has it.
    const source =
      (await harness.db.supplierSource.findFirst({ orderBy: { createdAt: 'asc' } })) ??
      (await harness.db.supplierSource.create({
        data: { name: 'Test supplier', spreadsheetId: `test-${randomBytes(12).toString('hex')}` },
      }));
    const item = await harness.db.supplierItem.create({
      data: {
        sourceId: source.id,
        nameKey: `integration line ${catalogue.run}`,
        name: `Integration Line ${catalogue.run}`,
        costUsd: '10.00',
      },
    });
    itemId = item.id;
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('links with a blank markup and proposes cost × 1.5 at the default 50%', async () => {
    const supplier = harness.get(SupplierService);
    const row = await supplier.setLink(
      catalogue.madeToOrder.variantId,
      { itemId, markupPercent: null, followStock: true },
      actor,
    );
    expect(row.link?.markupPercent).toBeNull();

    const source = await harness.db.supplierSource.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
    });
    const prices = await supplier.prices();
    const proposal = prices.rows.find(
      (entry) => entry.variantId === catalogue.madeToOrder.variantId,
    );
    const expected = (10 * (1 + Number(source.markupPercent) / 100)).toFixed(2);
    expect(proposal?.proposedPriceUsd).toBe(expected);
  });

  it('changes the price only when applied, and audits it', async () => {
    const supplier = harness.get(SupplierService);
    const before = await harness.db.variant.findUniqueOrThrow({
      where: { id: catalogue.madeToOrder.variantId },
    });
    expect(before.priceUsd.toFixed(2)).toBe(catalogue.madeToOrder.priceUsd);

    const result = await supplier.applyPrices(
      { variantIds: [catalogue.madeToOrder.variantId], confirmLarge: true },
      actor,
    );
    expect(result.applied).toHaveLength(1);

    const after = await harness.db.variant.findUniqueOrThrow({
      where: { id: catalogue.madeToOrder.variantId },
      include: { product: { select: { minPriceUsd: true } } },
    });
    expect(after.priceUsd.toFixed(2)).toBe(result.applied[0]?.to);
    expect(after.costUsd?.toFixed(2)).toBe('10.00');
    expect(after.product.minPriceUsd?.toFixed(2)).toBe(result.applied[0]?.to);

    const audit = await harness.db.auditLog.findFirst({
      where: {
        entityId: catalogue.madeToOrder.variantId,
        action: 'variant.supplier_price_applied',
      },
    });
    expect(audit).not.toBeNull();

    // Applying again is a no-op: the price is current.
    const again = await supplier.applyPrices(
      { variantIds: [catalogue.madeToOrder.variantId], confirmLarge: false },
      actor,
    );
    expect(again.skipped[0]?.reason).toBe('CURRENT');
  });

  it('makes a struck line unbuyable, refuses it in the cart, and clears when it returns', async () => {
    const sync = harness.get(SupplierSyncService);
    await harness.db.supplierItem.update({ where: { id: itemId }, data: { outOfStock: true } });
    expect(
      await sync.reconcileStock({ variantIds: [catalogue.madeToOrder.variantId] }, actor.staffId),
    ).toBe(1);

    const flagged = await harness.db.variant.findUniqueOrThrow({
      where: { id: catalogue.madeToOrder.variantId },
    });
    expect(flagged.supplierOutOfStock).toBe(true);

    const cart = shopper(harness);
    const added = await cart.request('POST', '/v1/cart/items', {
      variantId: catalogue.madeToOrder.variantId,
      qty: 1,
    });
    expect(added.status).toBe(400);

    await harness.db.supplierItem.update({ where: { id: itemId }, data: { outOfStock: false } });
    await sync.reconcileStock({ variantIds: [catalogue.madeToOrder.variantId] }, actor.staffId);
    const cleared = await harness.db.variant.findUniqueOrThrow({
      where: { id: catalogue.madeToOrder.variantId },
    });
    expect(cleared.supplierOutOfStock).toBe(false);
  });

  it('clears the flag when the variant is unlinked', async () => {
    const supplier = harness.get(SupplierService);
    await harness.db.supplierItem.update({
      where: { id: itemId },
      data: { missingSince: new Date() },
    });
    await harness
      .get(SupplierSyncService)
      .reconcileStock({ variantIds: [catalogue.madeToOrder.variantId] }, actor.staffId);
    expect(
      (
        await harness.db.variant.findUniqueOrThrow({
          where: { id: catalogue.madeToOrder.variantId },
        })
      ).supplierOutOfStock,
    ).toBe(true);

    await supplier.removeLink(catalogue.madeToOrder.variantId, actor);
    expect(
      (
        await harness.db.variant.findUniqueOrThrow({
          where: { id: catalogue.madeToOrder.variantId },
        })
      ).supplierOutOfStock,
    ).toBe(false);
  });
});
