import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type { CredentialKind, SecretInput } from '@da/contracts';
import { ActorType, KeyAccessAction, LicenseKeyState, Prisma } from '@da/db';

import { say } from '../common/panel-locale.js';

import { type ParsedSecret, canonical, fieldCount, parse } from './credential.js';
import { KekService, fingerprint, open, seal } from './kek.js';
import { VaultPrismaService } from './vault-prisma.service.js';

/**
 * How long a TOTP challenge counts as fresh for a step-up action.
 *
 * Fifteen minutes. Long enough that a staff member working through a queue of
 * orders is not re-challenged every minute; short enough that a session left
 * open on an unlocked laptop cannot be used to walk the vault an hour later.
 */
export const STEP_UP_WINDOW_SECONDS = 15 * 60;

export interface Actor {
  /** The staff id, or the customer id when `kind` says CUSTOMER. */
  staffId: string;
  /** Unix seconds of the session's last TOTP challenge. */
  totpAt: number;
  /**
   * Who is asking.
   *
   * Defaults to staff, which is every caller but one. A customer reading their
   * own licence writes the same REVEAL row as a member of staff reading it —
   * the difference belongs in the log rather than in a second log, because
   * "who has seen this key" has to be answerable from one place.
   */
  kind?: ActorType | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * The licence vault.
 *
 * Every rule here exists because a licence key is the product itself and a
 * leaked one cannot be recalled — there is no rotating it, no revoking it from
 * the customer's side, and no getting the money back from the supplier.
 *
 * So: nothing in this file logs plaintext, no method returns plaintext for a
 * list, revealing a single key needs a TOTP challenge from the last quarter of
 * an hour, and every reveal writes an append-only access row before the
 * plaintext is returned rather than after. That ordering matters — a crash
 * between the two must leave evidence of the attempt, not a silent read.
 */
@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);

  constructor(
    private readonly vault: VaultPrismaService,
    private readonly kek: KekService,
  ) {}

  /**
   * Refuses an action whose session has not cleared TOTP recently.
   *
   * The session itself is already authenticated; this is about the difference
   * between "is signed in" and "is at the keyboard right now", which is the
   * only question worth asking before handing over a key.
   */
  private requireFreshTotp(actor: Actor): void {
    const age = Math.floor(Date.now() / 1000) - actor.totpAt;
    if (age > STEP_UP_WINDOW_SECONDS) {
      throw new ForbiddenException(
        say(
          'يتطلّب هذا الإجراء إعادة إدخال رمز المصادقة الثنائية.',
          'This action needs your two-factor code again.',
        ),
      );
    }
  }

  // --- stocking -------------------------------------------------------------

  /**
   * Takes in a batch of licences for one variant.
   *
   * Duplicates are detected by fingerprint without decrypting anything, and
   * skipped rather than stored twice — a supplier resending a block is normal,
   * and storing the same licence twice means selling it twice.
   */
  async importKeys(input: {
    variantId: string;
    kind: CredentialKind;
    secrets: SecretInput[];
    /** Lines the caller could not read at all, reported straight through. */
    invalidSkipped?: number;
    supplierId?: string | undefined;
    costUsd?: string | undefined;
    expiresAt?: Date | undefined;
    actor: Actor;
    note?: string | undefined;
  }): Promise<{ imported: number; duplicatesSkipped: number; invalidSkipped: number }> {
    this.requireFreshTotp(input.actor);

    let invalid = input.invalidSkipped ?? 0;
    const candidates: string[] = [];
    for (const secret of input.secrets) {
      // A secret this module cannot lay out is counted, not stored. The
      // alternative is a row whose payload does not match its own `kind`.
      try {
        candidates.push(canonical(secret));
      } catch {
        invalid += 1;
      }
    }

    // Within the batch as well as against the vault: a pasted list often
    // repeats a line, and the unique index would abort the whole import.
    const seen = new Set<string>();
    const unique: string[] = [];
    let duplicatesSkipped = 0;
    for (const value of candidates) {
      const print = fingerprint(value);
      if (seen.has(print)) {
        duplicatesSkipped += 1;
        continue;
      }
      seen.add(print);
      unique.push(value);
    }

    const existing = await this.vault.client.licenseKey.findMany({
      where: { fingerprint: { in: [...seen] } },
      select: { fingerprint: true },
    });
    const known = new Set(existing.map((row) => row.fingerprint));

    let imported = 0;
    for (const value of unique) {
      if (known.has(fingerprint(value))) {
        duplicatesSkipped += 1;
        continue;
      }

      const sealed = await seal(value, this.kek);
      const row = await this.vault.client.licenseKey.create({
        data: {
          variantId: input.variantId,
          state: LicenseKeyState.AVAILABLE,
          ciphertext: sealed.ciphertext,
          iv: sealed.iv,
          authTag: sealed.authTag,
          wrappedDek: sealed.wrappedDek,
          kekVersion: sealed.kekVersion,
          fingerprint: sealed.fingerprint,
          kind: input.kind,
          fieldCount: fieldCount(input.kind),
          supplierId: input.supplierId ?? null,
          costUsd: input.costUsd ?? null,
          expiresAt: input.expiresAt ?? null,
        },
      });

      await this.log(row.id, KeyAccessAction.IMPORT, input.actor);
      imported += 1;
    }

    // Counts only. The one thing this must never do is name what it stored.
    this.logger.log(
      `Imported ${String(imported)} keys for variant ${input.variantId}; skipped ${String(duplicatesSkipped)} duplicate, ${String(invalid)} invalid.`,
    );

    return { imported, duplicatesSkipped, invalidSkipped: invalid };
  }

  /** How many sellable keys the vault holds, per variant. */
  async availability(variantIds: string[]): Promise<Record<string, number>> {
    if (variantIds.length === 0) return {};
    const grouped = await this.vault.client.licenseKey.groupBy({
      by: ['variantId'],
      where: {
        variantId: { in: variantIds },
        state: LicenseKeyState.AVAILABLE,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      _count: true,
    });
    return Object.fromEntries(grouped.map((row) => [row.variantId, row._count]));
  }

  // --- assignment -----------------------------------------------------------

  /**
   * Binds available keys to a paid order line.
   *
   * Runs on payment, for stocked lines only. Two properties it must have:
   *
   *  - Idempotent. A webhook arrives at least once, so a line that already has
   *    keys bound to it is left alone rather than given a second set.
   *  - All or nothing per line. Assigning two of three keys and reporting
   *    success would send a customer a partial order with no record of what is
   *    missing, so a short vault leaves the line in the manual queue where a
   *    person will see it.
   *
   * The keys are not revealed here. Assignment is a state change and an id;
   * plaintext comes out only in `deliver`, and only into an email.
   */
  async assign(input: {
    orderItemId: string;
    variantId: string;
    qty: number;
  }): Promise<{ assigned: string[]; short: number }> {
    const already = await this.vault.client.licenseKey.findMany({
      where: { orderItemId: input.orderItemId },
      select: { id: true },
    });
    if (already.length > 0) {
      return { assigned: already.map((row) => row.id), short: 0 };
    }

    // `orderItemId` is unique, so one key per line for now. A quantity above
    // one needs the column relaxed; reporting the shortfall is honest until
    // then and lands the line in the manual queue.
    const wanted = Math.min(input.qty, 1);

    const available = await this.vault.client.licenseKey.findMany({
      where: {
        variantId: input.variantId,
        state: LicenseKeyState.AVAILABLE,
        orderItemId: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      // Oldest first: a licence with a shelf life should leave before it dies.
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
      take: wanted,
      select: { id: true },
    });

    if (available.length < wanted) {
      return { assigned: [], short: input.qty - available.length };
    }

    const assigned: string[] = [];
    for (const row of available) {
      // Conditional on still being AVAILABLE: two concurrent assignments must
      // not both claim the same key, and `updateMany` returning 0 is how this
      // finds out it lost the race.
      const { count } = await this.vault.client.licenseKey.updateMany({
        where: { id: row.id, state: LicenseKeyState.AVAILABLE, orderItemId: null },
        data: {
          state: LicenseKeyState.ASSIGNED,
          orderItemId: input.orderItemId,
          assignedAt: new Date(),
        },
      });
      if (count === 1) assigned.push(row.id);
    }

    if (assigned.length < wanted) {
      // Lost a race. Release what was taken rather than delivering a partial
      // line, and let the manual queue pick it up.
      await this.vault.client.licenseKey.updateMany({
        where: { id: { in: assigned } },
        data: { state: LicenseKeyState.AVAILABLE, orderItemId: null, assignedAt: null },
      });
      return { assigned: [], short: input.qty };
    }

    return { assigned, short: input.qty - assigned.length };
  }

  /**
   * Stores a licence the owner has just bought from a supplier, bound to the
   * line that needed it.
   *
   * This is the made-to-order path, and it is most of the catalog: the code
   * does not exist until somebody places the order, so it arrives by hand and
   * is sealed on the way in. The plaintext lives in this call and nowhere else
   * — not in a log line, not in an order note, which is exactly where the
   * legacy store kept it.
   */
  async fulfilManually(input: {
    orderItemId: string;
    variantId: string;
    secret: SecretInput;
    supplierId?: string | undefined;
    costUsd?: string | undefined;
    actor: Actor;
  }): Promise<{ licenseKeyId: string }> {
    this.requireFreshTotp(input.actor);

    const value = canonical(input.secret);

    const taken = await this.vault.client.licenseKey.findUnique({
      where: { orderItemId: input.orderItemId },
      select: { id: true },
    });
    if (taken) {
      throw new BadRequestException(
        say('هذا السطر مرتبط بمفتاح بالفعل.', 'This line already has a key bound to it.'),
      );
    }

    const print = fingerprint(value);
    const duplicate = await this.vault.client.licenseKey.findUnique({
      where: { fingerprint: print },
      select: { id: true, orderItemId: true },
    });
    if (duplicate) {
      // A licence already in the vault is either already sold or already in
      // stock. Either way, pasting it onto a second order sells it twice.
      throw new BadRequestException(
        duplicate.orderItemId
          ? say(
              'هذا الكود مُسلّم لطلب آخر بالفعل.',
              'This code has already been delivered to another order.',
            )
          : say('هذا الكود موجود في الخزنة بالفعل.', 'This code is already in the vault.'),
      );
    }

    const sealed = await seal(value, this.kek);
    const row = await this.vault.client.licenseKey.create({
      data: {
        variantId: input.variantId,
        state: LicenseKeyState.ASSIGNED,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        wrappedDek: sealed.wrappedDek,
        kekVersion: sealed.kekVersion,
        fingerprint: sealed.fingerprint,
        kind: input.secret.kind,
        fieldCount: fieldCount(input.secret.kind),
        supplierId: input.supplierId ?? null,
        costUsd: input.costUsd ?? null,
        orderItemId: input.orderItemId,
        assignedAt: new Date(),
      },
    });

    await this.log(row.id, KeyAccessAction.IMPORT, input.actor);
    return { licenseKeyId: row.id };
  }

  // --- delivery -------------------------------------------------------------

  /**
   * Opens the keys bound to an order line so they can be sent.
   *
   * The access row is written before the plaintext is produced, not after: a
   * crash in between must leave a record of the attempt rather than an
   * unrecorded read. Marking DELIVERED is the caller's job, once the message
   * has actually gone — a key marked delivered that never left is a customer
   * waiting for something nobody will send again.
   */
  async openForDelivery(input: {
    orderItemId: string;
    actor: Actor;
  }): Promise<{ licenseKeyId: string; secret: ParsedSecret }[]> {
    const rows = await this.vault.client.licenseKey.findMany({
      where: { orderItemId: input.orderItemId },
    });
    if (rows.length === 0) {
      throw new NotFoundException(
        say('لا يوجد مفتاح مرتبط بهذا السطر.', 'No key is bound to this line.'),
      );
    }

    const opened: { licenseKeyId: string; secret: ParsedSecret }[] = [];
    for (const row of rows) {
      await this.log(row.id, KeyAccessAction.RESEND, input.actor);
      // Split here rather than in the mail module: the row's own `kind` is the
      // only trustworthy answer to what it holds, and it is readable only
      // from inside the vault.
      opened.push({ licenseKeyId: row.id, secret: parse(row.kind, await open(row, this.kek)) });
    }
    return opened;
  }

  /**
   * The keys on one order line — ids and states, never plaintext.
   *
   * This is what a complaint is answered from: it says a key exists, when it
   * went, and gives the id that a deliberate reveal needs. Opening it is a
   * separate call with its own challenge and its own audit row.
   */
  async keysForOrderItem(
    orderItemId: string,
  ): Promise<{ licenseKeyId: string; state: string; deliveredAt: Date | null }[]> {
    const rows = await this.vault.client.licenseKey.findMany({
      where: { orderItemId },
      select: { id: true, state: true, deliveredAt: true },
    });
    return rows.map((row) => ({
      licenseKeyId: row.id,
      state: row.state,
      deliveredAt: row.deliveredAt,
    }));
  }

  /** Whether a line already has a key bound to it, without opening anything. */
  async isBound(orderItemId: string): Promise<boolean> {
    const found = await this.vault.client.licenseKey.findUnique({
      where: { orderItemId },
      select: { id: true },
    });
    return found !== null;
  }

  /** Records that the keys on a line actually went out. */
  async markDelivered(orderItemId: string): Promise<number> {
    const { count } = await this.vault.client.licenseKey.updateMany({
      where: { orderItemId, deliveredAt: null },
      data: { state: LicenseKeyState.DELIVERED, deliveredAt: new Date() },
    });
    return count;
  }

  /**
   * Shows one key to a member of staff who asked for it.
   *
   * Separate from delivery on purpose. Delivery is the system sending a key to
   * the person who paid for it; this is a human looking at one, which is the
   * riskier act and therefore the one that needs a fresh TOTP challenge and a
   * REVEAL row with a name attached to it.
   */
  async reveal(input: { licenseKeyId: string; actor: Actor }): Promise<ParsedSecret> {
    this.requireFreshTotp(input.actor);

    const row = await this.vault.client.licenseKey.findUnique({
      where: { id: input.licenseKeyId },
    });
    if (!row)
      throw new NotFoundException(say('لا يوجد مفتاح بهذا المعرّف.', 'No key with that id.'));

    await this.log(row.id, KeyAccessAction.REVEAL, input.actor);
    return parse(row.kind, await open(row, this.kek));
  }

  /**
   * Opens the licences on one line for the customer who bought it.
   *
   * Separate from `reveal` because the guard is different, not because the act
   * is: there is no TOTP challenge to be fresh here, and the thing standing in
   * front of it is the caller's own ownership check — this method trusts that
   * the line belongs to the actor and must never be reachable from a route
   * that has not proved it.
   *
   * What it does keep is the ordering: the access row is written before the
   * plaintext exists. And it refuses a key that is not delivered yet; a
   * customer reading a key still sitting in stock would be reading somebody
   * else's inventory.
   */
  async revealForCustomer(input: { orderItemId: string; actor: Actor }): Promise<ParsedSecret[]> {
    const rows = await this.vault.client.licenseKey.findMany({
      where: {
        orderItemId: input.orderItemId,
        state: { in: [LicenseKeyState.DELIVERED, LicenseKeyState.ASSIGNED] },
      },
    });
    if (rows.length === 0) {
      throw new NotFoundException(
        say('لا يوجد مفتاح جاهز على هذا البند بعد.', 'No key is ready on this line yet.'),
      );
    }

    const opened: ParsedSecret[] = [];
    for (const row of rows) {
      await this.log(row.id, KeyAccessAction.REVEAL, input.actor);
      opened.push(parse(row.kind, await open(row, this.kek)));
    }
    return opened;
  }

  /** Whether a line has anything readable, without opening it. */
  async hasReadableSecret(orderItemIds: string[]): Promise<Set<string>> {
    if (orderItemIds.length === 0) return new Set();
    const rows = await this.vault.client.licenseKey.findMany({
      where: {
        orderItemId: { in: orderItemIds },
        state: { in: [LicenseKeyState.DELIVERED, LicenseKeyState.ASSIGNED] },
      },
      select: { orderItemId: true, expiresAt: true },
    });
    return new Set(rows.map((row) => row.orderItemId).filter((id): id is string => id !== null));
  }

  /**
   * The activation deadline on a line's keys, if any.
   *
   * Read separately from the key itself because it is not a secret: a customer
   * has to know a licence must be activated before a date whether or not they
   * ever click to read it.
   */
  async deadlines(orderItemIds: string[]): Promise<Map<string, Date>> {
    if (orderItemIds.length === 0) return new Map();
    const rows = await this.vault.client.licenseKey.findMany({
      where: { orderItemId: { in: orderItemIds }, expiresAt: { not: null } },
      select: { orderItemId: true, expiresAt: true },
    });
    const out = new Map<string, Date>();
    for (const row of rows) {
      if (row.orderItemId && row.expiresAt) out.set(row.orderItemId, row.expiresAt);
    }
    return out;
  }

  /**
   * Takes a key out of circulation.
   *
   * A revoked key is never deleted. The row is the only evidence that it
   * existed, was sold, and was withdrawn — and a refund argument six months
   * later is decided on exactly that.
   */
  async revoke(input: {
    licenseKeyId: string;
    reason: string;
    actor: Actor;
  }): Promise<{ state: LicenseKeyState }> {
    this.requireFreshTotp(input.actor);

    const row = await this.vault.client.licenseKey.update({
      where: { id: input.licenseKeyId },
      data: {
        state: LicenseKeyState.REVOKED,
        revokedAt: new Date(),
        revokedReason: input.reason,
      },
      select: { id: true, state: true },
    });
    await this.log(row.id, KeyAccessAction.REVOKE, input.actor);
    return { state: row.state };
  }

  /** Sweeps keys whose activation window has closed. */
  async expireStale(): Promise<number> {
    const { count } = await this.vault.client.licenseKey.updateMany({
      where: {
        state: LicenseKeyState.AVAILABLE,
        expiresAt: { lte: new Date() },
      },
      data: { state: LicenseKeyState.EXPIRED },
    });
    return count;
  }

  // --- audit ----------------------------------------------------------------

  private async log(
    licenseKeyId: string,
    action: KeyAccessAction,
    actor: Actor,
    approvedById?: string,
  ): Promise<void> {
    await this.vault.client.keyAccessLog.create({
      data: {
        licenseKeyId,
        action,
        actorId: actor.staffId,
        actorType: actor.kind ?? ActorType.STAFF,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
        approvedById: approvedById ?? null,
      },
    });
  }

  /** Who touched a key, and when. Never what the key says. */
  async history(licenseKeyId: string): Promise<
    {
      action: KeyAccessAction;
      actorId: string | null;
      ip: string | null;
      createdAt: Date;
    }[]
  > {
    return this.vault.client.keyAccessLog.findMany({
      where: { licenseKeyId },
      orderBy: { createdAt: 'desc' },
      select: { action: true, actorId: true, ip: true, createdAt: true },
    });
  }

  /**
   * Vault stock per variant, for the admin.
   *
   * States and counts only. There is no method on this service that returns
   * plaintext for more than one key at a time, and that is deliberate: a bulk
   * export needs two staff approvals and does not exist yet.
   */
  async stockReport(
    variantIds: string[],
  ): Promise<{ variantId: string; state: LicenseKeyState; count: number }[]> {
    if (variantIds.length === 0) return [];
    const grouped = await this.vault.client.licenseKey.groupBy({
      by: ['variantId', 'state'],
      where: { variantId: { in: variantIds } },
      _count: true,
    });
    return grouped.map((row) => ({
      variantId: row.variantId,
      state: row.state,
      count: row._count,
    }));
  }

  /** Exposed so the doctor script can prove the isolation still holds. */
  async selfTest(): Promise<{ reachable: boolean }> {
    await this.vault.client.$queryRaw`SELECT 1`;
    return { reachable: true };
  }

  /** Prisma's Decimal, re-exported so callers need not import from @da/db. */
  static decimal(value: string): Prisma.Decimal {
    return new Prisma.Decimal(value);
  }
}
