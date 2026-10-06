import { randomBytes } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { SheetCell, SheetGrid } from '../supplier/sheet-parse.js';
import { SupplierSyncService } from '../supplier/supplier-sync.service.js';

import { type Catalogue, type Harness, HAS_DATABASE, bootApp, seedCatalogue } from './harness.js';

/**
 * The sync run end to end (CR-0004, REV-0145/REV-0157): a fake Google Sheets
 * answer goes in through `fetch`, and the rows, the change log, the snapshot
 * and the linked variant's availability come out in the database.
 *
 * Only the network is replaced. Parsing, the diff, the guards, the advisory
 * lock and every write are the real ones.
 */
describe.skipIf(!HAS_DATABASE)('supplier sheet sync run', () => {
  let harness: Harness;
  let catalogue: Catalogue;
  let sourceId: string;
  let sync: SupplierSyncService;
  /** The sheet the fake Google answers with, changed by each test. */
  let sheet: { name: string; price: string; struck: boolean }[] = [];
  let broken = false;

  const cell = (formattedValue: string, strike = false): SheetCell => ({
    formattedValue,
    effectiveFormat: { textFormat: { strikethrough: strike } },
  });

  function grid(): SheetGrid {
    return {
      sheets: [
        {
          properties: { sheetId: 0, title: 'List' },
          merges: [],
          data: [
            {
              rowData: [
                { values: [cell('Price list'), cell('Update Date: 2026-10-06')] },
                {
                  values: [
                    cell('Product category'),
                    cell('Product name'),
                    cell('Unit price'),
                    cell('Warranty'),
                    cell('Remarks'),
                  ],
                },
                ...sheet.map((line) => ({
                  values: [
                    cell('Test'),
                    cell(line.name, line.struck),
                    cell(line.price),
                    cell('7 days'),
                    cell(''),
                  ],
                })),
              ],
            },
          ],
        },
      ],
    };
  }

  const names = Array.from({ length: 24 }, (_, i) => `Sync Line ${String(i + 1)}`);

  beforeAll(async () => {
    harness = await bootApp();
    catalogue = await seedCatalogue(harness);
    sync = harness.get(SupplierSyncService);
    process.env.GOOGLE_SHEETS_API_KEY = 'test-key';

    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith('https://sheets.googleapis.com/')) return realFetch(input, init);
      if (broken) return new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 });
      return new Response(JSON.stringify(grid()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const source = await harness.db.supplierSource.create({
      data: { name: 'Sync test', spreadsheetId: `sync-${randomBytes(12).toString('hex')}` },
    });
    sourceId = source.id;
  });

  afterEach(() => {
    broken = false;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    delete process.env.GOOGLE_SHEETS_API_KEY;
    await harness?.close();
  });

  const item = (name: string) =>
    harness.db.supplierItem.findUniqueOrThrow({
      where: { sourceId_nameKey: { sourceId, nameKey: name.toLowerCase() } },
    });

  it('adds every line on the first read and logs each one', async () => {
    sheet = names.map((name, i) => ({ name, price: `$${String(i + 1)}.00`, struck: false }));
    const result = await sync.sync(sourceId, null);
    expect(result).toMatchObject({ status: 'OK', rowCount: 24, added: 24, changed: 0, removed: 0 });

    const first = await item('Sync Line 1');
    expect(first.costUsd?.toFixed(2)).toBe('1.00');
    expect(first.rowNumber).toBe(3);
    expect(
      await harness.db.supplierItemChange.count({ where: { itemId: first.id, kind: 'ADDED' } }),
    ).toBe(1);

    const source = await harness.db.supplierSource.findUniqueOrThrow({ where: { id: sourceId } });
    expect(source).toMatchObject({ lastSyncStatus: 'OK', sheetUpdatedLabel: '2026-10-06' });
  });

  it('reports an unchanged sheet as UNCHANGED but keeps row numbers current', async () => {
    // Same content, rows moved: one line inserted at the top would shift all;
    // here the order is reversed, which changes only row numbers.
    sheet = [...sheet].reverse();
    const result = await sync.sync(sourceId, null);
    expect(result.status).toBe('UNCHANGED');
    expect((await item('Sync Line 1')).rowNumber).toBe(26);
  });

  it('logs a cost change and a strikethrough, and makes the linked variant unbuyable', async () => {
    const line1 = await item('Sync Line 1');
    await harness.db.variantSupplierLink.create({
      data: { variantId: catalogue.madeToOrder.variantId, itemId: line1.id },
    });

    sheet = sheet.map((line) =>
      line.name === 'Sync Line 1' ? { ...line, price: '$1.50', struck: true } : line,
    );
    const result = await sync.sync(sourceId, null);
    expect(result).toMatchObject({ status: 'OK', changed: 1, stockSwitched: 1 });

    const kinds = (
      await harness.db.supplierItemChange.findMany({ where: { itemId: line1.id } })
    ).map((change) => change.kind);
    expect(kinds).toEqual(expect.arrayContaining(['ADDED', 'COST', 'STOCK']));
    const variant = await harness.db.variant.findUniqueOrThrow({
      where: { id: catalogue.madeToOrder.variantId },
    });
    expect(variant.supplierOutOfStock).toBe(true);
  });

  it('marks a vanished line missing and a returning one back, clearing the variant', async () => {
    sheet = sheet.map((line) => (line.name === 'Sync Line 1' ? { ...line, struck: false } : line));
    await sync.sync(sourceId, null);
    expect(
      (
        await harness.db.variant.findUniqueOrThrow({
          where: { id: catalogue.madeToOrder.variantId },
        })
      ).supplierOutOfStock,
    ).toBe(false);

    const saved = sheet;
    sheet = sheet.filter((line) => line.name !== 'Sync Line 1');
    const gone = await sync.sync(sourceId, null);
    expect(gone.removed).toBe(1);
    expect((await item('Sync Line 1')).missingSince).not.toBeNull();
    expect(
      (
        await harness.db.variant.findUniqueOrThrow({
          where: { id: catalogue.madeToOrder.variantId },
        })
      ).supplierOutOfStock,
    ).toBe(true);

    sheet = saved;
    await sync.sync(sourceId, null);
    const back = await item('Sync Line 1');
    expect(back.missingSince).toBeNull();
    expect(
      await harness.db.supplierItemChange.count({ where: { itemId: back.id, kind: 'RETURNED' } }),
    ).toBe(1);
    expect(
      (
        await harness.db.variant.findUniqueOrThrow({
          where: { id: catalogue.madeToOrder.variantId },
        })
      ).supplierOutOfStock,
    ).toBe(false);
  });

  it('refuses a read that lost more than half the rows, unless forced by a person', async () => {
    const full = sheet;
    sheet = sheet.slice(0, 5);
    const refused = await sync.sync(sourceId, null);
    expect(refused.status).toBe('REFUSED');
    expect(
      await harness.db.supplierItem.count({ where: { sourceId, missingSince: { not: null } } }),
    ).toBe(0);

    // `force` needs a person; the schedule (null) cannot force.
    expect((await sync.sync(sourceId, null, { force: true })).status).toBe('REFUSED');

    const staff = await harness.db.staffUser.create({
      data: {
        email: `sync-${catalogue.run}@example.test`,
        name: 'Sync test',
        passwordHash: 'not-a-real-hash',
        role: 'ADMIN',
      },
    });
    const forced = await sync.sync(sourceId, staff.id, { force: true });
    expect(forced).toMatchObject({ status: 'OK', removed: 19 });

    sheet = full;
    await sync.sync(sourceId, staff.id);
  });

  it('records a fetch failure as FAILED, never RUNNING', async () => {
    broken = true;
    const result = await sync.sync(sourceId, null);
    expect(result.status).toBe('FAILED');
    expect(
      await harness.db.supplierSnapshot.count({ where: { sourceId, status: 'RUNNING' } }),
    ).toBe(0);
    const source = await harness.db.supplierSource.findUniqueOrThrow({ where: { id: sourceId } });
    expect(source.lastSyncStatus).toBe('FAILED');
  });
});
