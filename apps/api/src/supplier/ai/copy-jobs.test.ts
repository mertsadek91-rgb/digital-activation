import {
  type AiCopyJob,
  type GeneratedCopy,
  aiCopyJobKey,
  generateCopySchema,
} from '@da/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../../auth/audit.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

import { SupplierAiService } from './supplier-ai.service.js';

/**
 * Background copy jobs (BUG-0026): the request returns at once with a job,
 * the generation finishes into it, and a job whose process died reads as
 * failed instead of running forever. The `Setting` table is an in-memory map.
 */
function harness() {
  const settings = new Map<string, { value: unknown; updatedAt: Date }>();
  settings.set('supplier.ai', {
    value: { model: 'kimi-k3', protocol: 'auto', temperature: 0.5, instructions: '' },
    updatedAt: new Date(),
  });
  const prisma = {
    client: {
      setting: {
        findUnique: vi.fn(({ where }: { where: { key: string } }) =>
          Promise.resolve(
            settings.has(where.key) ? { key: where.key, ...settings.get(where.key) } : null,
          ),
        ),
        upsert: vi.fn(
          ({ where, update }: { where: { key: string }; update: { value: unknown } }) => {
            settings.set(where.key, { value: update.value, updatedAt: new Date() });
            return Promise.resolve({});
          },
        ),
        deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
      },
      product: {
        count: vi.fn(({ where }: { where: { slug: string } }) =>
          Promise.resolve(where.slug === 'known' ? 1 : 0),
        ),
      },
    },
  } as unknown as PrismaService;
  const service = new SupplierAiService(prisma, {} as AuditService);
  return { service, settings };
}

const copy: GeneratedCopy = { model: 'kimi-k3', ar: null, en: null, notes: [] };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('copy jobs', () => {
  beforeEach(() => {
    process.env.OPENCODE_API_KEY = 'test-key';
  });
  afterEach(() => {
    delete process.env.OPENCODE_API_KEY;
    vi.restoreAllMocks();
  });

  it('returns a running job at once and stores the result when it finishes', async () => {
    const { service } = harness();
    let finish: (value: GeneratedCopy) => void = () => undefined;
    vi.spyOn(service, 'generateCopy').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    const job = await service.startCopyJob(
      generateCopySchema.parse({ productSlug: 'known', locales: ['ar'] }),
    );
    expect(job.status).toBe('RUNNING');
    expect((await service.copyJob(job.id)).status).toBe('RUNNING');

    finish(copy);
    await flush();
    const done = await service.copyJob(job.id);
    expect(done).toMatchObject({ status: 'DONE', result: copy, error: null });
    expect(done.finishedAt).not.toBeNull();
  });

  it('records a failure with its message', async () => {
    const { service } = harness();
    vi.spyOn(service, 'generateCopy').mockRejectedValue(new Error('OpenCode 402: no funds'));
    const job = await service.startCopyJob(
      generateCopySchema.parse({ productSlug: 'known', locales: ['ar'] }),
    );
    await flush();
    expect(await service.copyJob(job.id)).toMatchObject({
      status: 'FAILED',
      error: 'OpenCode 402: no funds',
    });
  });

  it('refuses an unknown product before starting anything', async () => {
    const { service } = harness();
    const spy = vi.spyOn(service, 'generateCopy');
    await expect(
      service.startCopyJob(generateCopySchema.parse({ productSlug: 'missing', locales: ['ar'] })),
    ).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('reads a job left running past 15 minutes as failed', async () => {
    const { service, settings } = harness();
    const stale: AiCopyJob = {
      id: 'old',
      status: 'RUNNING',
      productSlug: 'known',
      startedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
      finishedAt: null,
      result: null,
      error: null,
    };
    settings.set(aiCopyJobKey('old'), { value: stale, updatedAt: new Date() });
    const read = await service.copyJob('old');
    expect(read.status).toBe('FAILED');
    expect(read.error).toBeTruthy();
  });
});
