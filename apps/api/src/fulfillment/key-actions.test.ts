import { BadRequestException, ConflictException } from '@nestjs/common';
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
  /** The old key sells between the check and the revoke. */
  revokeConflict?: boolean;
  /** Somebody else revokes it first, or the revoke fails for another reason. */
  revokeError?: 'already' | 'boom';
  /** The audit write fails. */
  auditFails?: boolean;
  /** Two reveals by one person, three seconds apart, with two reasons. */
  twoReveals?: boolean;
}) {
  const calls: string[] = [];
  const audits: { action: string; after?: unknown; before?: unknown }[] = [];
  const meta = {
    variantId: 'variant-1',
    state: options?.keyState ?? LicenseKeyState.AVAILABLE,
    expiresAt: new Date('2027-01-01T00:00:00Z'),
    supplierId: 'supplier-1',
    costUsd: '4.50',
  };
  const imports: Record<string, unknown>[] = [];
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
      if (options?.revokeConflict) return Promise.reject(new ConflictException('sold meanwhile'));
      if (options?.revokeError === 'already') {
        return Promise.reject(new BadRequestException('already revoked'));
      }
      if (options?.revokeError === 'boom') return Promise.reject(new Error('vault unreachable'));
      return Promise.resolve({
        state: LicenseKeyState.REVOKED,
        variantId: 'variant-1',
        previous: meta.state,
      });
    },
    keyMeta: () => Promise.resolve(meta),
    importKeys: (input: Record<string, unknown>) => {
      calls.push('vault.import');
      imports.push(input);
      return Promise.resolve(
        options?.importResult ?? { imported: 1, duplicatesSkipped: 0, invalidSkipped: 0 },
      );
    },
    availability: () => Promise.resolve({ 'variant-1': 2 }),
    history: () =>
      Promise.resolve([
        ...(options?.twoReveals
          ? [
              {
                action: KeyAccessAction.REVEAL,
                actorId: 'staff-1',
                ip: null,
                createdAt: new Date('2026-10-10T10:00:03Z'),
              },
            ]
          : []),
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
        // Newest first, as the service asks for them.
        findMany: () =>
          Promise.resolve([
            ...(options?.twoReveals
              ? [
                  {
                    actorId: 'staff-1',
                    action: 'vault.reveal',
                    after: { reason: 'second look' },
                    createdAt: new Date('2026-10-10T10:00:04Z'),
                  },
                ]
              : []),
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
      if (options?.auditFails) return Promise.reject(new Error('audit down'));
      calls.push(`audit ${input.action}`);
      audits.push(input);
      return Promise.resolve();
    },
  } as unknown as AuditService;

  const service = new FulfillmentService(prisma, vault, audit, {} as MailService);
  return { service, calls, audits, imports };
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

  it('withholds the key when its reason cannot be stored', async () => {
    const world = build({ auditFails: true });
    await expect(
      world.service.revealKey({ licenseKeyId: 'k1', reason: 'support ticket 42', actor }),
    ).rejects.toThrow(/audit down/);
  });

  it('revokes, records why, then recounts the stock from the vault', async () => {
    const world = build();
    await world.service.revokeKey({ licenseKeyId: 'k1', reason: 'leaked', actor });

    // The reason is on record before the recount can fail.
    expect(world.calls).toEqual(['vault.revoke', 'audit vault.revoke', 'onHand 2']);
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

    expect(result).toMatchObject({ imported: 1, revoked: true });
    // The new key inherits the old one's deadline, supplier and cost.
    expect(world.imports[0]).toMatchObject({
      supplierId: 'supplier-1',
      costUsd: '4.50',
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    });
    expect(world.audits.find((a) => a.action === 'vault.replace')?.after).toEqual({
      reason: 'pasted wrong',
      imported: 1,
      oldKeyRevoked: true,
    });
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

  it('says so when the old key sold meanwhile: the new key stays, nothing is hidden', async () => {
    const world = build({ revokeConflict: true });
    const result = await world.service.replaceKey({
      licenseKeyId: 'k1',
      code: 'NEW-KEY-0001',
      reason: 'pasted wrong',
      actor,
    });

    expect(result).toMatchObject({ imported: 1, revoked: false });
    expect(result.message).toMatch(/تغيّرت للتو/);
    expect(world.audits.find((a) => a.action === 'vault.replace')?.after).toMatchObject({
      oldKeyRevoked: false,
    });
  });

  it('records the replacement even when the old key was revoked by somebody else, or the revoke broke', async () => {
    const already = build({ revokeError: 'already' });
    const result = await already.service.replaceKey({
      licenseKeyId: 'k1',
      code: 'NEW-KEY-0001',
      reason: 'pasted wrong',
      actor,
    });
    expect(result).toMatchObject({ imported: 1, revoked: false });
    expect(already.audits.find((a) => a.action === 'vault.replace')).toBeDefined();

    const broken = build({ revokeError: 'boom' });
    await expect(
      broken.service.replaceKey({
        licenseKeyId: 'k1',
        code: 'NEW-KEY-0001',
        reason: 'pasted wrong',
        actor,
      }),
    ).rejects.toThrow(/vault unreachable/);
    // Written before the failure is passed on: the new key is stock already.
    expect(broken.audits.find((a) => a.action === 'vault.replace')?.after).toMatchObject({
      oldKeyRevoked: false,
    });
  });

  it('keeps each reason with its own reveal when two are seconds apart', async () => {
    const world = build({ twoReveals: true });
    const rows = await world.service.keyHistory('k1');
    expect(rows.map((row) => row.reason)).toEqual([
      'second look',
      'customer says the key is wrong',
      null,
    ]);
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
