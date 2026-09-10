import crypto from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ActorType, type Prisma } from '@da/db';

import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Append-only audit log, hash-chained.
 *
 * Each row's hash covers its own contents and its predecessor's hash, so a row
 * deleted or edited in the middle of the chain breaks every hash after it. That
 * is the difference between a log and a record: without the chain, the same
 * account that can change a price can also tidy away the evidence.
 *
 * There is deliberately no update or delete path on this table.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    actorId?: string | undefined;
    actorType?: ActorType;
    entity: string;
    entityId: string;
    action: string;
    before?: Prisma.InputJsonValue | undefined;
    after?: Prisma.InputJsonValue | undefined;
    ip?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<void> {
    const previous = await this.prisma.client.auditLog.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });

    const payload = JSON.stringify({
      actorId: input.actorId ?? null,
      entity: input.entity,
      entityId: input.entityId,
      action: input.action,
      before: input.before ?? null,
      after: input.after ?? null,
      at: new Date().toISOString(),
      // A nonce, so two identical actions in the same millisecond cannot
      // collide on the unique hash column.
      nonce: crypto.randomBytes(8).toString('hex'),
    });

    const hash = crypto
      .createHash('sha256')
      .update(`${previous?.hash ?? ''}${payload}`)
      .digest('hex');

    await this.prisma.client.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        actorType: input.actorType ?? ActorType.STAFF,
        entity: input.entity,
        entityId: input.entityId,
        action: input.action,
        ...(input.before === undefined ? {} : { before: input.before }),
        ...(input.after === undefined ? {} : { after: input.after }),
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        hashPrev: previous?.hash ?? null,
        hash,
      },
    });
  }

  /** Walks the chain and reports the first row whose hash does not verify. */
  async verifyChain(limit = 1000): Promise<{ ok: boolean; brokenAt?: string }> {
    const rows = await this.prisma.client.auditLog.findMany({
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, hash: true, hashPrev: true },
    });

    let expectedPrev: string | null = null;
    for (const row of rows) {
      if (row.hashPrev !== expectedPrev) return { ok: false, brokenAt: row.id };
      expectedPrev = row.hash;
    }
    return { ok: true };
  }
}
