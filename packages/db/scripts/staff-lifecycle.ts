/**
 * Deactivating a staff account (TASK-0088).
 *
 * `StaffGuard` already refuses an inactive account on every request, so
 * flipping `isActive` alone stops access at once — but it leaves the account's
 * sessions alive underneath. Reactivating the account would then revive every
 * one of them, for up to the 30 days a refresh token lives. So deactivation
 * revokes every session in the same transaction, and writes the audit entry
 * there too: there is no committed state in which the account is off but its
 * sessions are not, or in which either happened without a record.
 *
 * Kept free of side effects on import so the CLI (`deactivate-staff.ts`) and
 * the tests share one implementation.
 */
import crypto from 'node:crypto';

import { ActorType, type Prisma, type PrismaClient, StaffRole } from '../src/index.js';

export interface DeactivateInput {
  /** The account to deactivate. */
  email: string;
  /** The operator running it: must be an active OWNER. Recorded as the actor. */
  by: string;
}

export interface DeactivationPlan {
  target: { id: string; email: string; role: StaffRole; isActive: boolean };
  actor: { id: string; email: string };
  /** Sessions not yet revoked, expired or not: all of them get `revokedAt`. */
  liveSessions: number;
  /** Already inactive with nothing left to revoke. */
  noop: boolean;
}

export interface DeactivationResult {
  staffId: string;
  wasActive: boolean;
  sessionsRevoked: number;
}

type Db = Pick<PrismaClient, 'staffUser' | 'staffSession' | 'auditLog'>;

const normalise = (email: string) => email.trim().toLowerCase();

/**
 * Checks the request and reports what `deactivateStaff` would do. Throws with
 * an operator-facing message when it must not go ahead.
 */
export async function planDeactivation(db: Db, input: DeactivateInput): Promise<DeactivationPlan> {
  const email = normalise(input.email);
  const by = normalise(input.by);

  const actor = await db.staffUser.findUnique({
    where: { email: by },
    select: { id: true, email: true, role: true, isActive: true },
  });
  if (!actor?.isActive || actor.role !== StaffRole.OWNER) {
    throw new Error(`--by ${by} is not an active OWNER account.`);
  }

  const target = await db.staffUser.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, isActive: true },
  });
  if (!target) throw new Error(`No staff account for ${email}.`);

  if (target.isActive && target.role === StaffRole.OWNER) {
    const otherOwners = await db.staffUser.count({
      where: { role: StaffRole.OWNER, isActive: true, NOT: { id: target.id } },
    });
    if (otherOwners === 0) {
      throw new Error(`${email} is the only active OWNER; deactivating it would lock the panel.`);
    }
  }

  const liveSessions = await db.staffSession.count({
    where: { staffId: target.id, revokedAt: null },
  });

  return {
    target,
    actor: { id: actor.id, email: actor.email },
    liveSessions,
    noop: !target.isActive && liveSessions === 0,
  };
}

/**
 * Deactivates the account, revokes all of its sessions and writes
 * `staff.deactivated`, in one transaction.
 *
 * Also the repair for an account switched off some other way (by hand in SQL)
 * whose sessions were left alive: it is already inactive, but its sessions are
 * still revoked and the act recorded. Already inactive with nothing live is a
 * no-op and writes nothing.
 */
export async function deactivateStaff(
  db: PrismaClient,
  input: DeactivateInput,
  now: Date = new Date(),
): Promise<DeactivationResult> {
  // Serializable, not the default READ COMMITTED: the last-owner check is a
  // count, and two runs deactivating the only two OWNERs at once would each
  // see "one other owner" and both commit. Under Serializable one of them fails
  // instead (P2034) and can simply be run again — it then sees the truth. The
  // same holds for two runs on one account writing two audit rows.
  return db
    .$transaction((tx) => deactivateIn(tx, input, now), { isolationLevel: 'Serializable' })
    .catch((error: unknown) => {
      if ((error as { code?: string }).code === 'P2034') {
        throw new Error(
          'Another staff change ran at the same moment; nothing was written. Run the command again.',
          { cause: error },
        );
      }
      throw error;
    });
}

async function deactivateIn(
  tx: Db,
  input: DeactivateInput,
  now: Date,
): Promise<DeactivationResult> {
  // Re-checked inside the transaction, so the last-owner and actor checks
  // hold for the state this transaction writes over.
  const plan = await planDeactivation(tx, input);
  const { target, actor } = plan;
  const wasActive = target.isActive;
  if (plan.noop) return { staffId: target.id, wasActive: false, sessionsRevoked: 0 };

  await tx.staffUser.update({ where: { id: target.id }, data: { isActive: false } });

  // Every row not yet revoked, including expired ones: an expired session
  // cannot be refreshed, but there is no reason to leave it ambiguous.
  const revoked = await tx.staffSession.updateMany({
    where: { staffId: target.id, revokedAt: null },
    data: { revokedAt: now },
  });

  await recordAudit(tx, {
    actorId: actor.id,
    entity: 'StaffUser',
    entityId: target.id,
    action: 'staff.deactivated',
    before: { isActive: wasActive, role: target.role },
    after: { isActive: false, sessionsRevoked: revoked.count, via: 'cli' },
    at: now,
  });

  return { staffId: target.id, wasActive, sessionsRevoked: revoked.count };
}

/**
 * Appends to the hash-chained audit log, in the caller's transaction.
 *
 * The same chain `AuditService.record` (apps/api/src/auth/audit.service.ts)
 * writes: the hash covers the predecessor's hash plus this row's payload, with
 * a nonce so two identical rows cannot collide. Kept in step with that by
 * hand, since a script cannot import the API.
 */
async function recordAudit(
  tx: Pick<PrismaClient, 'auditLog'>,
  input: {
    actorId: string;
    entity: string;
    entityId: string;
    action: string;
    before: Prisma.InputJsonValue;
    after: Prisma.InputJsonValue;
    at: Date;
  },
): Promise<void> {
  const previous = await tx.auditLog.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { hash: true },
  });

  const payload = JSON.stringify({
    actorId: input.actorId,
    entity: input.entity,
    entityId: input.entityId,
    action: input.action,
    before: input.before,
    after: input.after,
    at: input.at.toISOString(),
    nonce: crypto.randomBytes(8).toString('hex'),
  });
  const hash = crypto
    .createHash('sha256')
    .update(`${previous?.hash ?? ''}${payload}`)
    .digest('hex');

  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      actorType: ActorType.STAFF,
      entity: input.entity,
      entityId: input.entityId,
      action: input.action,
      before: input.before,
      after: input.after,
      hashPrev: previous?.hash ?? null,
      hash,
    },
  });
}
