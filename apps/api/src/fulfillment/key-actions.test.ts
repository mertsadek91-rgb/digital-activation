import { KeyAccessAction, LicenseKeyState } from '@da/db';
import { describe, expect, it } from 'vitest';

import type { AuditService } from '../auth/audit.service.js';
import type { MailService } from '../mail/mail.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { Actor, VaultService } from '../vault/vault.service.js';

import { FulfillmentService } from './fulfillment.service.js';

/**
 * A person reading, revoking or replacing one key (owner request
 * 2026-10-10): the reason is stored, a revoke recounts the stock, and a
 * replacement never takes a key that is not plain unsold stock.
 *
 * The vault, the audit log and the database are fakes that record what was
 * asked of them, in order.
 */
function build(options?: {
  keyState?: LicenseKeyState;
  importResult?: { imported: number; duplicatesSkipped: number; invalidSkipped: number };
}) {
  const calls: string[] = [];
  const audits: { action: string; after?: unknown; before?: unknown }[] = [];
  const meta = { variantId: 'variant-1', state: options?.keyState ?? LicenseKeyState.AVAILABLE };
  let onHand = 3;

  const vault = {
    reveal: () => {
      calls.push('vault.reveal');
      return Promise.resolve({
        kind: 'ACTIVATION_KEY',
        key: 'AAAAA-BBBBB',
        username: null,
        password: null,
      });
    },
    revoke: (input: { onlyIfAvailable?: boolean }) => {
      calls.push(`vault.revoke${input.onlyIfAvailable ? ' (only if available)' : ''}`);
      return Promise.resolve({
        state: LicenseKeyState.REVOKED,
        variantId: 'variant-1',
        previous: meta.state,
      });
    },
    keyMeta: () => Promise.resolve(meta),
    importKeys: () => {
      calls.push('vault.import');
      return Promise.resolve(
        options?.importResult ?? { imported: 1, duplicatesSkipped: 0, invalidSkipped: 0 },
      );
    },
    availability: () => Promise.resolve({ 'variant-1': 2 }),
    history: () =>
      Promise.resolve([
        {
          action: KeyAccessAction.REVEAL,
          actorId: 'staff-1',
          ip: null,
          createdAt: new Date('2026-10-10T10:00:00Z'),
        },
        {
          action: KeyAccessAction.IMPORT,
          actorId: 'staff-1',
          ip: null,
          createdAt: new Date('2026-10-09T10:00:00Z'),
        },
      ]),
  } as unknown as VaultService;

  const prisma = {
    client: {
      variant: { findUnique: () => Promise.resolve({ credentialKind: 'ACTIVATION_KEY' }) },
      inventoryLevel: {
        findUnique: () => Promise.resolve({ onHand, reserved: 0 }),
        upsert: ({ update }: { update: { onHand: number } }) => {
          calls.push(`onHand ${String(update.onHand)}`);
          onHand = update.onHand;
          return Promise.resolve({});
        },
      },
      stockMovement: { create: () => Promise.resolve({}) },
      auditLog: {
        findMany: () =>
          Promise.resolve([
            {
              actorId: 'staff-1',
              action: 'vault.reveal',
              after: { reason: 'customer says the key is wrong' },
              createdAt: new Date('2026-10-10T10:00:01Z'),
            },
          ]),
      },
    },
  } as unknown as PrismaService;

  const audit = {
    record: (input: { action: string; after?: unknown; before?: unknown }) => {
      calls.push(`audit ${input.action}`);
      audits.push(input);
      return Promise.resolve();
    },
  } as unknown as AuditService;

  const service = new FulfillmentService(prisma, vault, audit, {} as MailService);
  return { service, calls, audits };
}

const actor: Actor = { staffId: 'staff-1', totpAt: Date.now() };

describe('one key, by a person', () => {
  it('reveals, then stores the reason before the key is returned', async () => {
    const world = build();
    const secret = await world.service.revealKey({
      licenseKeyId: 'k1',
      reason: 'support ticket 42',
      actor,
    });

    expect(secret).toMatchObject({ key: 'AAAAA-BBBBB' });
    expect(world.calls).toEqual(['vault.reveal', 'audit vault.reveal']);
    expect(world.audits[0]?.after).toEqual({ reason: 'support ticket 42' });
  });

  it('revokes, recounts the stock from the vault, and records why', async () => {
    const world = build();
    await world.service.revokeKey({ licenseKeyId: 'k1', reason: 'leaked', actor });

    expect(world.calls).toEqual(['vault.revoke', 'onHand 2', 'audit vault.revoke']);
    expect(world.audits[0]?.after).toEqual({ state: LicenseKeyState.REVOKED, reason: 'leaked' });
  });

  it('replaces an unsold key: the new one in first, then the old one revoked only if still unsold', async () => {
    const world = build();
    const result = await world.service.replaceKey({
      licenseKeyId: 'k1',
      code: 'NEW-KEY-0001',
      reason: 'pasted wrong',
      actor,
    });

    expect(result).toEqual({ imported: 1, revoked: true });
    expect(world.calls.indexOf('vault.import')).toBeLessThan(
      world.calls.indexOf('vault.revoke (only if available)'),
    );
    expect(world.audits.find((a) => a.action === 'vault.revoke')?.after).toEqual({
      state: LicenseKeyState.REVOKED,
      reason: 'replaced: pasted wrong',
    });
  });

  it('refuses to replace a key that is on an order, and changes nothing', async () => {
    const world = build({ keyState: LicenseKeyState.DELIVERED });
    await expect(
      world.service.replaceKey({
        licenseKeyId: 'k1',
        code: 'NEW-KEY-0001',
        reason: 'pasted wrong',
        actor,
      }),
    ).rejects.toThrow(/المتاح في المخزون فقط/);
    expect(world.calls).toEqual([]);
  });

  it('leaves the old key alone when the new one is refused as a duplicate', async () => {
    const world = build({ importResult: { imported: 0, duplicatesSkipped: 1, invalidSkipped: 0 } });
    await expect(
      world.service.replaceKey({
        licenseKeyId: 'k1',
        code: 'SAME-KEY',
        reason: 'pasted wrong',
        actor,
      }),
    ).rejects.toThrow(/موجود في الخزنة من قبل/);
    expect(world.calls).toEqual(['vault.import']);
  });

  it('shows the reason beside the access it belongs to', async () => {
    const world = build();
    const rows = await world.service.keyHistory('k1');
    expect(rows.map((row) => [row.action, row.reason])).toEqual([
      [KeyAccessAction.REVEAL, 'customer says the key is wrong'],
      [KeyAccessAction.IMPORT, null],
    ]);
  });
});
