import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ActorType } from '@da/db';

import type { KekService } from './kek.js';
import type { VaultPrismaService } from './vault-prisma.service.js';
import { type Actor, VaultService } from './vault.service.js';

/**
 * BUG-0030: the vault's customer reveal opens DELIVERED keys only. An
 * ASSIGNED key is bound to a line but has not gone out — held by the
 * AUTO_DELIVERY switch, a failed send or a risk hold — and is staff's to
 * release.
 */

function build(rows: unknown[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const create = vi.fn().mockResolvedValue({});
  const service = new VaultService(
    {
      client: { licenseKey: { findMany }, keyAccessLog: { create } },
    } as unknown as VaultPrismaService,
    {} as KekService,
  );
  return { service, findMany, create };
}

const actor: Actor = { staffId: 'c1', kind: ActorType.CUSTOMER, totpAt: 0 };

function whereOf(fn: { mock: { calls: unknown[][] } }) {
  return (fn.mock.calls[0]?.[0] as { where: unknown }).where;
}

describe('VaultService customer reads (BUG-0030)', () => {
  it('asks for DELIVERED keys only, and logs and opens nothing when there are none', async () => {
    const { service, findMany, create } = build([]);
    await expect(service.revealForCustomer({ orderItemId: 'i1', actor })).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(whereOf(findMany)).toEqual({
      orderItemId: 'i1',
      state: 'DELIVERED',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('offers a reveal on the list only where a key was delivered', async () => {
    const { service, findMany } = build([{ orderItemId: 'i1', expiresAt: null }]);
    const readable = await service.hasReadableSecret(['i1', 'i2']);

    expect(whereOf(findMany)).toEqual({
      orderItemId: { in: ['i1', 'i2'] },
      state: 'DELIVERED',
    });
    expect([...readable]).toEqual(['i1']);
  });
});
