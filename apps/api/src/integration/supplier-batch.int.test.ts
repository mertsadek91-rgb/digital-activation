import { randomBytes } from 'node:crypto';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  AI_BATCH_CURRENT_KEY,
  type AiBatch,
  SUPPLIER_AI_SETTING_KEY,
  aiBatchKey,
} from '@da/contracts';
import { Locale, PublishStatus, StaffRole, type StaffUser } from '@da/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService, type SessionResult } from '../auth/auth.service.js';
import { withAdvisoryLock } from '../common/advisory-lock.js';
import { SupplierService } from '../supplier/supplier.service.js';
import { BATCH_RUN_LOCK, SupplierBatchService } from '../supplier/batch/supplier-batch.service.js';

import { type Harness, HAS_DATABASE, bootApp } from './harness.js';

/**
 * One-click AI products from sheet lines (TASK-0150), against a real
 * database, with OpenCode replaced by a local server that answers like a
 * chat-completions model. Every line is drafted, created as a DRAFT, linked
 * and written in Arabic and English; a line already linked is skipped; a
 * failure keeps the product and a retry only writes the copy; a stop lands
 * between calls; a line left mid-way by a dead process is resumed without a
 * second product; and a run lock held elsewhere keeps this process out.
 */
describe.skipIf(!HAS_DATABASE)('supplier AI batch', () => {
  let harness: Harness;
  let batch: SupplierBatchService;
  let server: Server;
  let staffId: string;
  let sourceId: string;
  const run = randomBytes(4).toString('hex');

  // What the fake model does next.
  let failCopy = false;
  let holdDraft: Promise<void> | null = null;
  const calls: string[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      let raw = '';
      request.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      request.on('end', () => {
        void (async () => {
          const body = JSON.parse(raw) as { messages: { role: string; content: string }[] };
          const system = body.messages[0]?.content ?? '';
          const user = body.messages[1]?.content ?? '';
          const draft = system.includes('identity of a new store product');
          calls.push(draft ? 'draft' : 'copy');
          if (draft && holdDraft) await holdDraft;
          if (!draft && failCopy) {
            response.writeHead(500, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: { message: 'provider down' } }));
            return;
          }
          const line = /Supplier line: (.*)/.exec(user)?.[1] ?? 'Product';
          const answer = draft ? draftAnswer(line) : copyAnswer(user.includes('Arabic'));
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: 'stop' }],
            }),
          );
        })();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.OPENCODE_API_KEY = 'integration-test-key';
    process.env.OPENCODE_BASE_URL = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

    harness = await bootApp();
    batch = harness.get(SupplierBatchService);
    await harness.db.setting.upsert({
      where: { key: SUPPLIER_AI_SETTING_KEY },
      update: {
        value: { model: 'test-model', protocol: 'chat', temperature: 0, instructions: '' },
      },
      create: {
        key: SUPPLIER_AI_SETTING_KEY,
        value: { model: 'test-model', protocol: 'chat', temperature: 0, instructions: '' },
      },
    });
    const staff = await harness.db.staffUser.create({
      data: {
        email: `batch-${run}@example.test`,
        name: 'Batch test',
        passwordHash: 'not-a-real-hash',
        role: 'ADMIN',
      },
    });
    staffId = staff.id;
    const source =
      (await harness.db.supplierSource.findFirst({ orderBy: { createdAt: 'asc' } })) ??
      (await harness.db.supplierSource.create({
        data: { name: 'Test supplier', spreadsheetId: `test-${randomBytes(12).toString('hex')}` },
      }));
    sourceId = source.id;
  });

  beforeEach(async () => {
    failCopy = false;
    holdDraft = null;
    calls.length = 0;
    await batch.idle();
    await harness.db.setting.deleteMany({ where: { key: AI_BATCH_CURRENT_KEY } });
  });

  afterAll(async () => {
    await harness?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  async function line(name: string, costUsd: string | null = '10.00') {
    return harness.db.supplierItem.create({
      data: { sourceId, nameKey: `${name} ${run}`.toLowerCase(), name: `${name} ${run}`, costUsd },
    });
  }

  async function finished(): Promise<AiBatch> {
    await batch.idle();
    const { batch: current } = await batch.current();
    if (!current) throw new Error('no batch');
    return current;
  }

  it('drafts, creates, links and writes each line in turn, and skips a linked one', async () => {
    const a = await line('Acme Office 2024 Pro Plus 1PC');
    const b = await line('Acme Antivirus 1 Year 3PC', '4.00');
    const linked = await line('Acme Already Linked');
    const existing = await harness.db.product.create({
      data: {
        slug: `it-batch-existing-${run}`,
        translations: { create: { locale: Locale.AR, name: 'موجود' } },
        variants: { create: { sku: `IT-BATCH-EXISTING-${run}`.toUpperCase(), priceUsd: '5.00' } },
      },
      include: { variants: true },
    });
    await harness.db.variantSupplierLink.create({
      data: { variantId: existing.variants[0]?.id ?? '', itemId: linked.id, linkedById: staffId },
    });

    const started = await batch.start({ itemIds: [a.id, b.id, linked.id, a.id] }, { staffId });
    expect(started.batch?.lines.map((entry) => entry.itemId)).toEqual([a.id, b.id, linked.id]);

    const done = await finished();
    expect(done.status).toBe('DONE');
    const [lineA, lineB, lineLinked] = done.lines;
    expect(lineA?.status).toBe('DONE');
    expect(lineB?.status).toBe('DONE');
    expect(lineLinked?.status).toBe('SKIPPED');
    expect(lineLinked?.productSlug).toBe(existing.slug);
    // One draft and two languages per created line; nothing for the skipped one.
    expect(calls.filter((call) => call === 'draft')).toHaveLength(2);
    expect(calls.filter((call) => call === 'copy')).toHaveLength(4);

    for (const [entry, item, cost] of [
      [lineA, a, 10],
      [lineB, b, 4],
    ] as const) {
      const product = await harness.db.product.findUniqueOrThrow({
        where: { slug: entry?.productSlug ?? '' },
        include: { translations: true, variants: { include: { supplierLink: true } } },
      });
      expect(product.status).toBe(PublishStatus.DRAFT);
      expect(product.variants).toHaveLength(1);
      const variant = product.variants[0];
      expect(variant?.supplierLink?.itemId).toBe(item.id);
      expect(variant?.priceUsd.toNumber()).toBeCloseTo(cost * 1.5, 2);
      for (const locale of [Locale.AR, Locale.EN]) {
        const translation = product.translations.find((t) => t.locale === locale);
        expect(translation?.seoTitle).toBeTruthy();
        expect(translation?.seoDescription).toBeTruthy();
        expect(translation?.shortDesc).toBeTruthy();
        expect(JSON.stringify(translation?.body)).toContain('answerFirst');
      }
      const audit = await harness.db.auditLog.findFirst({
        where: { entityId: product.id, action: 'product.created' },
      });
      expect(audit?.actorId).toBe(staffId);
    }

    // Pressing it again on a line that now has its product creates nothing.
    const before = await harness.db.product.count();
    await batch.start({ itemIds: [a.id] }, { staffId });
    const again = await finished();
    expect(again.id).not.toBe(done.id);
    expect(again.lines[0]?.status).toBe('SKIPPED');
    expect(again.lines[0]?.productSlug).toBe(lineA?.productSlug);
    expect(await harness.db.product.count()).toBe(before);
  });

  it('keeps the product when the copy fails, and a retry only writes the copy', async () => {
    const item = await line('Acme Retry Line 2PC');
    failCopy = true;
    await batch.start({ itemIds: [item.id] }, { staffId });
    const failed = await finished();
    const entry = failed.lines[0];
    expect(entry?.status).toBe('FAILED');
    expect(entry?.error).toContain('provider down');
    expect(entry?.productSlug).toBeTruthy();
    const products = await harness.db.product.count();

    // Retried by someone else: the copy is audited as the person who pressed.
    const other = await harness.db.staffUser.create({
      data: {
        email: `batch-retry-${run}@example.test`,
        name: 'Batch retry',
        passwordHash: 'not-a-real-hash',
        role: 'ADMIN',
      },
    });
    failCopy = false;
    calls.length = 0;
    await batch.retry({ staffId: other.id });
    const retried = await finished();
    expect(retried.lines[0]?.status).toBe('DONE');
    expect(retried.lines[0]?.requestedById).toBe(other.id);
    expect(calls).toEqual(['copy', 'copy']);
    expect(await harness.db.product.count()).toBe(products);
    const copyAudit = await harness.db.auditLog.findFirst({
      where: { action: 'productCopy.set', actorId: other.id },
    });
    expect(copyAudit).not.toBeNull();
  });

  it('keeps the product when linking fails, and a retry links it without a second one', async () => {
    const item = await line('Acme Link Fails Line');
    const supplier = harness.get(SupplierService);
    const spy = vi
      .spyOn(supplier, 'linkBySku')
      .mockRejectedValueOnce(new Error('database away for a moment'));
    const products = await harness.db.product.count();
    await batch.start({ itemIds: [item.id] }, { staffId });
    const failed = await finished();
    expect(failed.lines[0]?.status).toBe('FAILED');
    expect(failed.lines[0]?.productSlug).toBeTruthy();
    expect(await harness.db.product.count()).toBe(products + 1);

    calls.length = 0;
    await batch.retry({ staffId });
    const retried = await finished();
    spy.mockRestore();
    expect(retried.lines[0]?.status).toBe('DONE');
    expect(calls).toEqual(['copy', 'copy']);
    expect(await harness.db.product.count()).toBe(products + 1);
    const link = await harness.db.variantSupplierLink.findFirst({ where: { itemId: item.id } });
    expect(link).not.toBeNull();
  });

  it('lets CATALOG watch a batch over HTTP but not start, stop, retry or clear one', async () => {
    const catalog: StaffUser = await harness.db.staffUser.create({
      data: {
        email: `batch-catalog-${run}@example.test`,
        name: 'Batch catalog',
        passwordHash: 'not-a-real-hash',
        role: StaffRole.CATALOG,
      },
    });
    const auth = harness.get(AuthService) as unknown as {
      issueSession: (staff: StaffUser, context: object) => Promise<SessionResult>;
    };
    const session = await auth.issueSession(catalog, {});
    const call = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
      harness.app.inject({
        method,
        url: `/v1/admin/supplier/ai/batch${url}`,
        cookies: { da_access: session.accessToken },
        ...(payload ? { payload } : {}),
      });

    expect((await call('GET', '')).statusCode).toBe(200);
    expect((await call('POST', '', { itemIds: ['x'] })).statusCode).toBe(403);
    expect((await call('POST', '/cancel', {})).statusCode).toBe(403);
    expect((await call('POST', '/retry', {})).statusCode).toBe(403);
    expect((await call('DELETE', '')).statusCode).toBe(403);
  });

  it('stops between calls when cancelled', async () => {
    const first = await line('Acme Cancel One');
    const second = await line('Acme Cancel Two');
    let release = () => {};
    holdDraft = new Promise<void>((resolve) => (release = resolve));
    const products = await harness.db.product.count();

    await batch.start({ itemIds: [first.id, second.id] }, { staffId });
    // Wait for the first draft to reach the model, then stop.
    for (let i = 0; i < 100 && calls.length === 0; i += 1)
      await new Promise((resolve) => setTimeout(resolve, 50));
    const cancelled = await batch.cancel();
    expect(cancelled.batch?.status).toBe('CANCELLED');
    release();

    const after = await finished();
    expect(after.lines.map((entry) => entry.status)).toEqual(['CANCELLED', 'CANCELLED']);
    // The draft came back after the stop; nothing was created from it.
    expect(after.lines[0]?.draft).not.toBeNull();
    expect(await harness.db.product.count()).toBe(products);
    expect(calls).toEqual(['draft']);
  });

  it('resumes a line a dead process left mid-way without a second product', async () => {
    const item = await line('Acme Resume Line');
    // As a process would leave it: drafted, product created, link and
    // progress not yet recorded.
    const slug = `it-batch-resume-${run}`;
    const sku = `IT-BATCH-RESUME-${run}`.toUpperCase();
    await harness.db.product.create({
      data: {
        slug,
        translations: {
          create: [
            { locale: Locale.AR, name: 'استئناف' },
            { locale: Locale.EN, name: 'Resume' },
          ],
        },
        variants: { create: { sku, priceUsd: '15.00', isDefault: true } },
      },
    });
    const id = `resume-${run}`;
    const stale: AiBatch = {
      id,
      status: 'RUNNING',
      startedById: staffId,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      lines: [
        {
          itemId: item.id,
          itemName: item.name,
          status: 'CREATING',
          requestedById: staffId,
          draft: {
            model: 'test-model',
            slug,
            nameAr: 'استئناف',
            nameEn: 'Resume',
            kind: 'KEY',
            sku,
            licensePeriodUnit: 'LIFETIME',
            licensePeriodValue: null,
            deviceCount: 1,
            platform: 'WINDOWS',
            activationMethod: 'RETAIL_ONLINE',
            priceUsd: '15.00',
            brandId: null,
            categoryIds: [],
            notes: [],
          },
          productSlug: null,
          sku: null,
          error: null,
          notes: [],
          startedAt: new Date().toISOString(),
          finishedAt: null,
        },
      ],
    };
    await harness.db.setting.create({ data: { key: aiBatchKey(id), value: stale } });
    await harness.db.setting.create({ data: { key: AI_BATCH_CURRENT_KEY, value: { id } } });
    const products = await harness.db.product.count();

    batch.kick();
    const resumed = await finished();
    expect(resumed.lines[0]?.status).toBe('DONE');
    expect(resumed.lines[0]?.productSlug).toBe(slug);
    expect(calls).toEqual(['copy', 'copy']);
    expect(await harness.db.product.count()).toBe(products);
    const link = await harness.db.variantSupplierLink.findFirst({ where: { itemId: item.id } });
    expect(link).not.toBeNull();
  });

  it('leaves the batch alone while another process holds the run lock', async () => {
    const item = await line('Acme Locked Line');
    let inside = () => {};
    let leave = () => {};
    const held = new Promise<void>((resolve) => (inside = resolve));
    const lock = withAdvisoryLock(harness.db, BATCH_RUN_LOCK, async () => {
      inside();
      await new Promise<void>((resolve) => (leave = resolve));
    });
    await held;

    await batch.start({ itemIds: [item.id] }, { staffId });
    await batch.idle();
    const waiting = (await batch.current()).batch;
    expect(waiting?.status).toBe('RUNNING');
    expect(waiting?.lines[0]?.status).toBe('QUEUED');
    expect(calls).toEqual([]);

    leave();
    await lock;
    batch.kick();
    expect((await finished()).lines[0]?.status).toBe('DONE');
  });

  it('refuses more lines than a batch holds', async () => {
    const ids = await Promise.all(
      Array.from({ length: 21 }, (_, n) => line(`Acme Many ${String(n)}`).then((i) => i.id)),
    );
    await expect(batch.start({ itemIds: ids }, { staffId })).rejects.toThrow();
  });
});

function draftAnswer(line: string) {
  const clean = line.replace(/[^A-Za-z0-9 ]/g, '').trim();
  return {
    nameEn: clean,
    nameAr: `${clean} عربي`,
    slug: clean.toLowerCase().replace(/\s+/g, '-'),
    kind: 'KEY',
    licensePeriodUnit: 'LIFETIME',
    licensePeriodValue: null,
    deviceCount: 1,
    platform: 'WINDOWS',
    activationMethod: 'RETAIL_ONLINE',
    brand: null,
  };
}

function copyAnswer(arabic: boolean) {
  const text = arabic
    ? 'مفتاح ترخيص أصلي يُسلَّم فوراً عبر البريد بعد الدفع، مع خطوات تفعيل واضحة ودعم فني.'
    : 'A genuine licence key delivered instantly by email after payment, with clear activation steps and support.';
  return {
    shortDesc: arabic ? 'مفتاح أصلي بتسليم فوري' : 'Genuine key, instant delivery',
    seoTitle: arabic ? 'مفتاح أصلي | تسليم فوري' : 'Genuine key | Instant delivery',
    seoDescription: text,
    keywords: [arabic ? 'مفتاح' : 'key'],
    blocks: [
      { type: 'answerFirst', text },
      { type: 'heading', level: 2, text: arabic ? 'المزايا' : 'Features' },
      { type: 'richText', html: `<p>${text}</p>` },
    ],
  };
}
