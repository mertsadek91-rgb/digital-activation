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

  /**
   * Walks the chain and reports every row whose link does not hold.
   *
   * The two failures it separates are not the same event. A `mismatch` is a
   * row whose predecessor exists but is not the row before it — two writers
   * read the same head and chained onto it, which reorders history without
   * removing any of it. A `missing` parent is a row pointing at a hash no
   * surviving row carries, and a successor can only have read a hash that was
   * committed when it read: that row existed, and does not now.
   *
   * Reported in full rather than stopping at the first, because the count is
   * the thing somebody needs — one break is an incident, a scatter of them is
   * a pattern — and the whole table is walked, since a cap that silently hides
   * the end of the chain is worse than a slow query on a table this size.
   */
  async verifyChain(): Promise<{
    ok: boolean;
    rows: number;
    missing: string[];
    mismatched: string[];
  }> {
    const rows = await this.prisma.client.auditLog.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, hash: true, hashPrev: true },
    });

    const known = new Set(rows.map((row) => row.hash));
    const missing: string[] = [];
    const mismatched: string[] = [];

    for (let index = 1; index < rows.length; index += 1) {
      const row = rows[index];
      if (row === undefined) continue;
      if (row.hashPrev === rows[index - 1]?.hash) continue;
      if (row.hashPrev === null || !known.has(row.hashPrev)) missing.push(row.id);
      else mismatched.push(row.id);
    }

    return {
      ok: missing.length === 0 && mismatched.length === 0,
      rows: rows.length,
      missing,
      mismatched,
    };
  }
}
