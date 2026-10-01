import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../prisma/prisma.service.js';

import { PRUNE_AFTER_DAYS, SessionPruneService } from './session-prune.service.js';

describe('SessionPruneService', () => {
  it('prunes sessions that expired or were revoked before cutoff, leaving active ones', async () => {
    let deletedSessionsWhere: Record<string, unknown> | null = null;
    let deletedTokensWhere: Record<string, unknown> | null = null;

    const mockPrisma = {
      client: {
        staffSession: {
          deleteMany: vi
            .fn()
            .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
              deletedSessionsWhere = where;
              return Promise.resolve({ count: 5 });
            }),
        },
        staffRetiredToken: {
          deleteMany: vi
            .fn()
            .mockImplementation(({ where }: { where: Record<string, unknown> }) => {
              deletedTokensWhere = where;
              return Promise.resolve({ count: 12 });
            }),
        },
      },
    } as unknown as PrismaService;

    const service = new SessionPruneService(mockPrisma);
    const now = new Date('2026-10-15T12:00:00Z');
    const expectedCutoff = new Date(now.getTime() - PRUNE_AFTER_DAYS * 24 * 60 * 60 * 1000);

    const result = await service.run(now);

    expect(result.prunedSessions).toBe(5);
    expect(result.prunedTokens).toBe(12);

    expect(deletedSessionsWhere).toEqual({
      OR: [
        { expiresAt: { lte: expectedCutoff } },
        { revokedAt: { not: null, lte: expectedCutoff } },
      ],
    });

    expect(deletedTokensWhere).toEqual({
      retiredAt: { lte: expectedCutoff },
    });
  });

  it('reports zero pruned when database has no expired sessions or tokens', async () => {
    const mockPrisma = {
      client: {
        staffSession: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        staffRetiredToken: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      },
    } as unknown as PrismaService;

    const service = new SessionPruneService(mockPrisma);
    const result = await service.run();

    expect(result.prunedSessions).toBe(0);
    expect(result.prunedTokens).toBe(0);
  });
});
