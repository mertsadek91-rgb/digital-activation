import { randomBytes } from 'node:crypto';

import type { AdminProductList, Cart, ProductDeletion } from '@da/contracts';
import { Locale, PublishStatus, StaffRole, type StaffUser } from '@da/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthService, type SessionResult } from '../auth/auth.service.js';

import {
  type Catalogue,
  type Harness,
  HAS_DATABASE,
  bootApp,
  seedCatalogue,
  shopper,
} from './harness.js';

/**
 * Taking a product off the shop, archiving it and deleting it (TASK-0151),
 * against a real database and through HTTP, so the roles, the typed
 * confirmation and the foreign keys are the ones production has.
 *
 * A product with no history is deleted with everything hanging off it — a
 * cart line included, which `CartItem` would otherwise refuse. One with an
 * order line or keys in the vault is refused and archived instead, and the
 * archive leaves the default list. An unpublished product stays in a cart,
 * flagged, and the flag clears when it is published again.
 */
describe.skipIf(!HAS_DATABASE)('admin product lifecycle', () => {
  let harness: Harness;
  let catalogue: Catalogue;
  let admin: SessionResult;
  let catalogRole: SessionResult;
  const run = randomBytes(4).toString('hex');

  beforeAll(async () => {
    harness = await bootApp();
    catalogue = await seedCatalogue(harness);
    const auth = harness.get(AuthService) as unknown as {
      issueSession: (staff: StaffUser, context: object) => Promise<SessionResult>;
    };
    const staff = async (role: StaffRole) =>
      auth.issueSession(
        await harness.db.staffUser.create({
          data: {
            email: `lifecycle-${role.toLowerCase()}-${run}@example.test`,
            name: `Lifecycle ${role}`,
            passwordHash: 'not-a-real-hash',
            role,
          },
        }),
        {},
      );
    admin = await staff(StaffRole.ADMIN);
    catalogRole = await staff(StaffRole.CATALOG);
  });

  afterAll(async () => {
    await harness?.close();
  });

  async function call<T>(
    session: SessionResult,
    method: 'GET' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ): Promise<{ status: number; body: T }> {
    const response = await harness.app.inject({
      method,
      url: `/v1/admin${url}`,
      cookies: { da_access: session.accessToken },
      ...(payload ? { payload } : {}),
    });
    return { status: response.statusCode, body: response.json<T>() };
  }

  async function product(name: string, status: PublishStatus = PublishStatus.DRAFT) {
    const slug = `it-life-${name}-${run}`;
    const created = await harness.db.product.create({
      data: {
        slug,
        status,
        translations: { create: { locale: Locale.AR, name: `دورة ${name}` } },
        variants: {
          create: { sku: `IT-LIFE-${name}-${run}`.toUpperCase(), priceUsd: '9.00', status },
        },
      },
      include: { variants: true },
    });
    const variant = created.variants[0];
    if (!variant) throw new Error('no variant');
    return { slug, productId: created.id, variantId: variant.id };
  }

  it('deletes a product with no history, with its cart lines, alerts and supplier link', async () => {
    const draft = await product('mistake', PublishStatus.PUBLISHED);
    const browser = shopper(harness);
    expect(
      (await browser.request('POST', '/v1/cart/items', { variantId: draft.variantId, qty: 1 }))
        .status,
    ).toBeLessThan(300);
    await harness.db.stockAlert.create({
      data: {
        email: `alert-${run}@example.test`,
        productId: draft.productId,
        variantId: draft.variantId,
      },
    });
    const source =
      (await harness.db.supplierSource.findFirst()) ??
      (await harness.db.supplierSource.create({
        data: { name: 'Lifecycle supplier', spreadsheetId: `life-${run}` },
      }));
    const item = await harness.db.supplierItem.create({
      data: { sourceId: source.id, nameKey: `life ${run}`, name: `Life ${run}`, costUsd: '3.00' },
    });
    await harness.db.variantSupplierLink.create({
      data: { variantId: draft.variantId, itemId: item.id },
    });

    const check = await call<ProductDeletion>(admin, 'GET', `/products/${draft.slug}/deletion`);
    expect(check.status).toBe(200);
    expect(check.body.deletable).toBe(true);
    expect(check.body.removes).toEqual({
      variants: 1,
      cartLines: 1,
      stockAlerts: 1,
      supplierLinks: 1,
    });

    // The typed slug must match exactly.
    const wrong = await call(admin, 'DELETE', `/products/${draft.slug}`, {
      confirmSlug: `${draft.slug}-x`,
    });
    expect(wrong.status).toBe(400);
    expect(await harness.db.product.count({ where: { id: draft.productId } })).toBe(1);

    const done = await call(admin, 'DELETE', `/products/${draft.slug}`, {
      confirmSlug: draft.slug,
    });
    expect(done.status).toBe(200);
    expect(await harness.db.product.count({ where: { id: draft.productId } })).toBe(0);
    expect(await harness.db.cartItem.count({ where: { variantId: draft.variantId } })).toBe(0);
    expect(await harness.db.stockAlert.count({ where: { productId: draft.productId } })).toBe(0);
    expect(await harness.db.variantSupplierLink.count({ where: { itemId: item.id } })).toBe(0);
    // The supplier's line survives; only the link to the deleted variant went.
    expect(await harness.db.supplierItem.count({ where: { id: item.id } })).toBe(1);

    const audit = await harness.db.auditLog.findFirst({
      where: { entity: 'Product', entityId: draft.productId, action: 'product.deleted' },
    });
    expect(audit).not.toBeNull();

    // The cart still renders, now without the line.
    const cart = await browser.request<Cart>('GET', '/v1/cart');
    expect(cart.status).toBe(200);
    expect(cart.body.lines).toHaveLength(0);
  });

  it('refuses CATALOG the delete, but lets it unpublish and archive', async () => {
    const draft = await product('catalog');
    expect((await call(catalogRole, 'GET', `/products/${draft.slug}/deletion`)).status).toBe(403);
    expect(
      (await call(catalogRole, 'DELETE', `/products/${draft.slug}`, { confirmSlug: draft.slug }))
        .status,
    ).toBe(403);
    expect(
      (await call(catalogRole, 'PATCH', `/products/${draft.slug}/status`, { status: 'ARCHIVED' }))
        .status,
    ).toBeLessThan(300);
    expect(await harness.db.product.count({ where: { id: draft.productId } })).toBe(1);
  });

  it('refuses to delete a product that sold, and archives it out of the default list', async () => {
    const sold = await product('sold', PublishStatus.PUBLISHED);
    await harness.db.order.create({
      data: {
        number: `IT-LIFE-${run}`,
        email: `buyer-${run}@example.test`,
        subtotalUsd: '9.00',
        totalUsd: '9.00',
        items: {
          create: {
            variantId: sold.variantId,
            productNameSnapshot: 'دورة sold',
            skuSnapshot: `IT-LIFE-SOLD-${run}`,
            qty: 1,
            unitPriceUsd: '9.00',
            lineTotalUsd: '9.00',
          },
        },
      },
    });

    const check = await call<ProductDeletion>(admin, 'GET', `/products/${sold.slug}/deletion`);
    expect(check.body.deletable).toBe(false);
    expect(check.body.history.orderLines).toBe(1);

    const refused = await call(admin, 'DELETE', `/products/${sold.slug}`, {
      confirmSlug: sold.slug,
    });
    expect(refused.status).toBe(409);
    expect(await harness.db.product.count({ where: { id: sold.productId } })).toBe(1);

    expect(
      (await call(admin, 'PATCH', `/products/${sold.slug}/status`, { status: 'ARCHIVED' })).status,
    ).toBeLessThan(300);

    const all = await call<AdminProductList>(admin, 'GET', `/products?q=${sold.slug}`);
    expect(all.body.rows.map((row) => row.slug)).not.toContain(sold.slug);
    expect(all.body.counts.archived).toBe(1);
    const archived = await call<AdminProductList>(
      admin,
      'GET',
      `/products?status=archived&q=${sold.slug}`,
    );
    expect(archived.body.rows.map((row) => row.slug)).toEqual([sold.slug]);
    expect(archived.body.rows[0]?.status).toBe('ARCHIVED');

    // Off the shop.
    const page = await harness.app.inject({
      method: 'GET',
      url: `/v1/catalog/products/${sold.slug}`,
    });
    expect(page.statusCode).toBe(404);
  });

  it('refuses to delete a product whose variant holds keys in the vault', async () => {
    const stocked = await harness.db.product.findUniqueOrThrow({
      where: { id: catalogue.stocked.productId },
    });
    const check = await call<ProductDeletion>(admin, 'GET', `/products/${stocked.slug}/deletion`);
    expect(check.body.deletable).toBe(false);
    expect(check.body.history.licenseKeys).toBeGreaterThan(0);
    expect(
      (await call(admin, 'DELETE', `/products/${stocked.slug}`, { confirmSlug: stocked.slug }))
        .status,
    ).toBe(409);
  });

  it('flags an unpublished product in a cart, and clears the flag when it is back', async () => {
    const live = await product('cart', PublishStatus.PUBLISHED);
    const browser = shopper(harness);
    await browser.request('POST', '/v1/cart/items', { variantId: live.variantId, qty: 1 });

    const before = await browser.request<Cart>('GET', '/v1/cart');
    expect(before.body.lines[0]?.unavailable).toBe(false);

    expect(
      (await call(admin, 'PATCH', `/products/${live.slug}/status`, { status: 'DRAFT' })).status,
    ).toBeLessThan(300);
    const hidden = await browser.request<Cart>('GET', '/v1/cart');
    expect(hidden.body.lines).toHaveLength(1);
    expect(hidden.body.lines[0]?.unavailable).toBe(true);
    const page = await harness.app.inject({
      method: 'GET',
      url: `/v1/catalog/products/${live.slug}`,
    });
    expect(page.statusCode).toBe(404);

    // Published again (the bare test product cannot pass the publish gate, so
    // the row is restored directly; the gate is not what is under test here).
    await harness.db.product.update({
      where: { id: live.productId },
      data: { status: PublishStatus.PUBLISHED },
    });
    await harness.db.variant.update({
      where: { id: live.variantId },
      data: { status: PublishStatus.PUBLISHED },
    });
    const back = await browser.request<Cart>('GET', '/v1/cart');
    expect(back.body.lines[0]?.unavailable).toBe(false);
  });
});
