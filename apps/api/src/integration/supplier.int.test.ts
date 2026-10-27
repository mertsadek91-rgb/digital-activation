import { createHash, randomBytes } from 'node:crypto';

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { StaffRequest } from '../auth/staff.guard.js';
import { SupplierSyncService } from '../supplier/supplier-sync.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { SupplierController } from '../supplier/supplier.controller.js';
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

  // TASK-0135: the owner types a price on the prices tab; the markup it
  // implies is pinned to the variant, and applied only when asked.
  it('pins the markup a typed price implies, and applies it only when asked', async () => {
    const supplier = harness.get(SupplierService);
    const id = catalogue.madeToOrder.variantId;
    const source = await harness.db.supplierSource.findFirstOrThrow({
      orderBy: { createdAt: 'asc' },
    });
    const before = await harness.db.variant.findUniqueOrThrow({ where: { id } });

    const pinned = await supplier.setMarkup(id, { targetPriceUsd: 13.37, apply: false }, actor);
    expect(pinned.applied).toBeNull();
    expect(pinned.row.markupFromLink).toBe(true);
    if (source.rounding === 'CENTS') {
      expect(pinned.row.markupPercent).toBe('33.70');
      expect(pinned.row.proposedPriceUsd).toBe('13.37');
    }
    // Pinned, not applied: the store price has not moved.
    const untouched = await harness.db.variant.findUniqueOrThrow({ where: { id } });
    expect(untouched.priceUsd.toFixed(2)).toBe(before.priceUsd.toFixed(2));
    const audit = await harness.db.auditLog.findFirst({
      where: { entityId: id, action: 'supplier.markup_set' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.after).toMatchObject({ targetPriceUsd: '13.37', costUsd: '10.00' });

    const applied = await supplier.setMarkup(id, { markupPercent: 20, apply: true }, actor);
    expect(applied.row.markupPercent).toBe('20.00');
    expect(applied.applied?.applied[0]?.to).toBe(applied.row.proposedPriceUsd);
    const after = await harness.db.variant.findUniqueOrThrow({ where: { id } });
    expect(after.priceUsd.toFixed(2)).toBe(applied.row.proposedPriceUsd);
    expect(applied.row.costStanding).toBe('ABOVE');

    // Pinning the markup it already has and applying: nothing to apply, and it says so.
    const again = await supplier.setMarkup(id, { markupPercent: 20, apply: true }, actor);
    expect(again.applied?.applied).toHaveLength(0);
    expect(again.applied?.skipped[0]?.reason).toBe('CURRENT');

    const reset = await supplier.setMarkup(id, { markupPercent: null, apply: false }, actor);
    expect(reset.row.markupFromLink).toBe(false);
    expect(reset.row.markupPercent).toBe(source.markupPercent.toFixed(2));
  });

  it('refuses a typed price at or under cost, and says where today’s price stands', async () => {
    const supplier = harness.get(SupplierService);
    const id = catalogue.madeToOrder.variantId;
    await expect(
      supplier.setMarkup(id, { targetPriceUsd: 10, apply: false }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Only a markup over 1000% would make it.
    await expect(
      supplier.setMarkup(id, { targetPriceUsd: 500, apply: false }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      supplier.setMarkup(catalogue.stocked.variantId, { markupPercent: 10, apply: false }, actor),
    ).rejects.toBeInstanceOf(NotFoundException);

    const standing = async (price: string) => {
      await harness.db.variant.update({ where: { id }, data: { priceUsd: price } });
      const prices = await supplier.prices();
      return prices.rows.find((entry) => entry.variantId === id)?.costStanding;
    };
    const original = await harness.db.variant.findUniqueOrThrow({ where: { id } });
    expect(await standing('9.50')).toBe('BELOW');
    expect(await standing('10.00')).toBe('AT');
    expect(await standing('10.01')).toBe('ABOVE');
    await harness.db.variant.update({ where: { id }, data: { priceUsd: original.priceUsd } });
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

    await supplier.removeLink(catalogue.madeToOrder.variantId, actor, { mayChangeMarkup: true });
    expect(
      (
        await harness.db.variant.findUniqueOrThrow({
          where: { id: catalogue.madeToOrder.variantId },
        })
      ).supplierOutOfStock,
    ).toBe(false);
  });

  it('skips a variant out of every list but its own, and puts it back', async () => {
    const supplier = harness.get(SupplierService);
    const id = catalogue.stocked.variantId;
    const before = await supplier.mapping({ filter: 'unlinked' });
    expect(before.rows.some((row) => row.variantId === id)).toBe(true);

    const skipped = await supplier.setSkipped(id, true, actor);
    expect(skipped.skipped).toBe(true);
    const after = await supplier.mapping({ filter: 'all' });
    expect(after.rows.some((row) => row.variantId === id)).toBe(false);
    expect(after.counts.skipped).toBeGreaterThanOrEqual(1);
    const list = await supplier.mapping({ filter: 'skipped' });
    expect(list.rows.map((row) => row.variantId)).toContain(id);

    await supplier.setSkipped(id, false, actor);
    const back = await supplier.mapping({ filter: 'unlinked' });
    expect(back.rows.some((row) => row.variantId === id)).toBe(true);
  });

  it('audits every uploaded file with its name, size and hash, even one it cannot read', async () => {
    const supplier = harness.get(SupplierService);
    const bytes = Buffer.from(`not a workbook ${catalogue.run}`);
    const result = await supplier.uploadNow(actor, {
      fileName: `list-${catalogue.run}.xlsx`,
      data: bytes.toString('base64'),
      force: false,
    });
    expect(result.status).toBe('FAILED');

    const audit = await harness.db.auditLog.findFirst({
      where: { action: 'supplier.file_uploaded', actorId: actor.staffId },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.after).toMatchObject({
      fileName: `list-${catalogue.run}.xlsx`,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      status: 'FAILED',
    });
  });

  it('marks a variant out of stock by hand, keeps it out through a sync, and clears it only by hand', async () => {
    const supplier = harness.get(SupplierService);
    const id = catalogue.madeToOrder.variantId;
    const row = await supplier.setManualStock(id, true, actor);
    expect(row).toMatchObject({ manualOutOfStock: true, supplierOutOfStock: true });
    expect(
      (await harness.db.variant.findUniqueOrThrow({ where: { id } })).manualOutOfStockAt,
    ).not.toBeNull();

    const cart = shopper(harness);
    expect((await cart.request('POST', '/v1/cart/items', { variantId: id, qty: 1 })).status).toBe(
      400,
    );

    // Linked to a line the sheet has in stock: the sheet does not undo a person.
    await harness.db.supplierItem.update({
      where: { id: itemId },
      data: { missingSince: null, outOfStock: false },
    });
    await supplier.setLink(id, { itemId, followStock: true }, actor);
    await harness.get(SupplierSyncService).reconcileStock({ variantIds: [id] }, actor.staffId);
    expect((await harness.db.variant.findUniqueOrThrow({ where: { id } })).supplierOutOfStock).toBe(
      true,
    );

    const back = await supplier.setManualStock(id, false, actor);
    expect(back).toMatchObject({ manualOutOfStock: false, supplierOutOfStock: false });
    expect(
      await harness.db.auditLog.count({
        where: { entityId: id, action: 'variant.marked_out_of_stock' },
      }),
    ).toBe(1);
    await supplier.removeLink(id, actor, { mayChangeMarkup: true });
  });

  it('emails the people who asked while it was marked out, once it is back', async () => {
    const supplier = harness.get(SupplierService);
    const alerts = harness.get(SubscriptionsService);
    const id = catalogue.madeToOrder.variantId;
    await supplier.setManualStock(id, true, actor);
    const email = `waiting-${catalogue.run}@example.test`;
    await alerts.requestStockAlert({ email, variantId: id, locale: 'ar' });
    const stored = await harness.db.stockAlert.findFirstOrThrow({
      where: { email, variantId: id },
    });
    expect(stored.notifiedAt).toBeNull();

    await supplier.setManualStock(id, false, actor);
    await alerts.sweep();
    expect(
      (await harness.db.stockAlert.findUniqueOrThrow({ where: { id: stored.id } })).notifiedAt,
    ).not.toBeNull();
  });

  it('puts the line with the same years and devices first among the suggestions', async () => {
    const supplier = harness.get(SupplierService);
    const id = catalogue.madeToOrder.variantId;
    const variant = await harness.db.variant.update({
      where: { id },
      data: { deviceCount: 2, licensePeriodUnit: 'YEAR', licensePeriodValue: 3 },
      include: { product: { include: { translations: true } } },
    });
    const name =
      variant.product.translations.find((t) => t.locale === 'EN')?.name ?? variant.product.slug;
    const sourceId = (await harness.db.supplierItem.findUniqueOrThrow({ where: { id: itemId } }))
      .sourceId;
    // The wrong sibling first, with the closer-looking name.
    for (const terms of ['Key 3 Device 2 Year', 'Key 2 Device 3 Year']) {
      await harness.db.supplierItem.create({
        data: { sourceId, nameKey: `${name} ${terms}`.toLowerCase(), name: `${name} ${terms}` },
      });
    }

    const mapping = await supplier.mapping({ filter: 'all' });
    const row = mapping.rows.find((entry) => entry.variantId === id);
    expect(row?.suggestions[0]?.name).toBe(`${name} Key 2 Device 3 Year`);
    expect(row?.suggestions[0]?.terms).toMatchObject({
      devices: 2,
      devicesMatch: 'MATCH',
      periodMatch: 'MATCH',
    });
    const wrong = row?.suggestions.find((entry) => entry.name.endsWith('Key 3 Device 2 Year'));
    expect(wrong?.terms).toMatchObject({ devicesMatch: 'DIFFERENT', periodMatch: 'DIFFERENT' });
  });

  it('refuses to skip a linked variant', async () => {
    const supplier = harness.get(SupplierService);
    await supplier.setLink(
      catalogue.stocked.variantId,
      { itemId, markupPercent: null, followStock: false },
      actor,
    );
    await expect(supplier.setSkipped(catalogue.stocked.variantId, true, actor)).rejects.toThrow();
    await supplier.removeLink(catalogue.stocked.variantId, actor, { mayChangeMarkup: true });
  });

  // A variant's own markup is money (TASK-0137): catalogue staff link and
  // re-link, but neither set nor clear the markup an admin pinned.
  it('keeps an admin-set markup when catalogue staff re-link, and refuses them clearing it', async () => {
    const supplier = harness.get(SupplierService);
    const controller = harness.get(SupplierController);
    const catalogStaff = await harness.db.staffUser.create({
      data: {
        email: `supplier-catalog-${catalogue.run}@example.test`,
        name: 'Supplier catalogue test',
        passwordHash: 'not-a-real-hash',
        role: 'CATALOG',
      },
    });
    const as = (role: 'ADMIN' | 'CATALOG', sub: string) =>
      ({ staff: { sub, role }, ip: undefined, headers: {} }) as unknown as StaffRequest;
    const variantId = catalogue.stocked.variantId;
    const markupOf = async () =>
      (
        await harness.db.variantSupplierLink.findUniqueOrThrow({ where: { variantId } })
      ).markupPercent?.toFixed(2) ?? null;

    await controller.setLink(
      variantId,
      { itemId, markupPercent: 35, followStock: true },
      as('ADMIN', actor.staffId),
    );
    expect(await markupOf()).toBe('35.00');

    // Re-link without a markup: the admin's stays.
    const relinked = await controller.setLink(
      variantId,
      { itemId, followStock: false },
      as('CATALOG', catalogStaff.id),
    );
    expect(relinked.link?.markupPercent).toBe('35.00');
    expect(relinked.link?.followStock).toBe(false);
    expect(await markupOf()).toBe('35.00');

    // Clearing (null or blank) and setting are all markup changes: refused.
    // The controller throws before it returns a promise, hence the async wrapper.
    for (const markupPercent of [null, '', 20] as const) {
      await expect(
        (async () =>
          controller.setLink(
            variantId,
            { itemId, markupPercent, followStock: true },
            as('CATALOG', catalogStaff.id),
          ))(),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(await markupOf()).toBe('35.00');

    // An admin may still clear it back to the source's markup.
    const cleared = await controller.setLink(
      variantId,
      { itemId, markupPercent: null, followStock: true },
      as('ADMIN', actor.staffId),
    );
    expect(cleared.link?.markupPercent).toBeNull();
    await supplier.removeLink(variantId, actor, { mayChangeMarkup: true });
  });

  // Unlinking drops the link's own markup, and a re-link starts from the
  // source's, so catalogue staff cannot unlink one an admin pinned (TASK-0138).
  it('refuses catalogue staff unlinking a variant with its own markup, and audits what an unlink drops', async () => {
    const controller = harness.get(SupplierController);
    const catalogStaff = await harness.db.staffUser.create({
      data: {
        email: `supplier-unlink-${catalogue.run}@example.test`,
        name: 'Supplier unlink test',
        passwordHash: 'not-a-real-hash',
        role: 'CATALOG',
      },
    });
    const as = (role: 'ADMIN' | 'CATALOG', sub: string) =>
      ({ staff: { sub, role }, ip: undefined, headers: {} }) as unknown as StaffRequest;
    const variantId = catalogue.stocked.variantId;
    const linkOf = () => harness.db.variantSupplierLink.findUnique({ where: { variantId } });
    const lastUnlinkAudit = () =>
      harness.db.auditLog.findFirst({
        where: { entityId: variantId, action: 'supplier.link_removed' },
        orderBy: { createdAt: 'desc' },
      });

    await controller.setLink(
      variantId,
      { itemId, markupPercent: 35, followStock: false },
      as('ADMIN', actor.staffId),
    );
    await expect(
      (async () => controller.removeLink(variantId, as('CATALOG', catalogStaff.id)))(),
    ).rejects.toMatchObject({ status: 403 });
    expect((await linkOf())?.markupPercent?.toFixed(2)).toBe('35.00');

    // An admin may unlink it, and the audit keeps what the unlink dropped.
    const unlinked = await controller.removeLink(variantId, as('ADMIN', actor.staffId));
    expect(unlinked.link).toBeNull();
    expect(await linkOf()).toBeNull();
    expect((await lastUnlinkAudit())?.before).toMatchObject({
      itemId,
      markupPercent: '35.00',
      followStock: false,
    });

    // Without its own markup, unlinking stays catalogue work.
    await controller.setLink(
      variantId,
      { itemId, followStock: true },
      as('CATALOG', catalogStaff.id),
    );
    await controller.removeLink(variantId, as('CATALOG', catalogStaff.id));
    expect(await linkOf()).toBeNull();
    expect((await lastUnlinkAudit())?.before).toMatchObject({
      itemId,
      markupPercent: null,
      followStock: true,
    });
  });
});
