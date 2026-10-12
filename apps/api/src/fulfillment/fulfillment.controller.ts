import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type ImportResult,
  type Queue,
  type RevealResult,
  fulfilManuallySchema,
  importKeysSchema,
  markFailedSchema,
  QUEUE_OVERDUE_GRACE_SECONDS,
  revealSchema,
  queueSchema,
  importResultSchema,
  revealResultSchema,
} from '@da/contracts';
import { z } from 'zod';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodResponse } from '../common/openapi.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { type Actor, VaultService } from '../vault/vault.service.js';

import { FulfillmentService } from './fulfillment.service.js';

/**
 * Replacing one stock key: the corrected licence, one line, and why. Kept
 * here rather than in @da/contracts until the panel's contract grows a form
 * of its own; the panel sends the same two fields.
 */
const replaceKeySchema = z.object({
  reason: z.string().trim().min(3).max(200),
  code: z
    .string()
    .trim()
    .min(4)
    .max(4000)
    .refine((value) => !/[\r\n]/.test(value), 'One key, on one line.'),
});

/**
 * The supplier queue and the vault, for staff.
 *
 * Behind StaffGuard, and every write behind a role. FULFILLMENT is the role
 * that works the queue; revealing or revoking a key is ADMIN, because those
 * are the two actions that put a licence in front of a person rather than in
 * front of the customer who paid for it.
 */
@ApiTags('fulfillment')
@Controller('admin/fulfillment')
@UseGuards(StaffGuard)
export class FulfillmentController {
  constructor(
    private readonly fulfillment: FulfillmentService,
    private readonly vault: VaultService,
  ) {}

  /**
   * The session, as the vault needs to see it.
   *
   * `totpAt` is the whole reason this exists: the vault refuses a step-up
   * action whose session has not cleared a TOTP challenge recently, and that
   * timestamp lives in the access token rather than in a database lookup.
   */
  private actor(request: StaffRequest): Actor {
    return {
      staffId: request.staff?.sub ?? '',
      totpAt: request.staff?.totpAt ?? 0,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };
  }

  // Customer emails and activation addresses on every row.
  @Roles('ADMIN', 'FULFILLMENT', 'SUPPORT')
  @Get('queue')
  @ZodResponse(queueSchema)
  @ApiOperation({ summary: 'Paid lines waiting for a supplier order' })
  async queue(
    @Query('includeDone') includeDone?: string,
    @Query('limit') limit?: string,
  ): Promise<Queue> {
    const rows = await this.fulfillment.queue({
      limit: Math.min(200, Math.max(1, Number.parseInt(limit ?? '50', 10) || 50)),
      includeDone: includeDone === 'true',
    });
    const summary = await this.fulfillment.queueSummary();
    const now = Date.now();

    return {
      rows: rows.map((row) => {
        const paid = row.paidAt?.getTime() ?? now;
        const waitingSeconds = Math.max(0, Math.floor((now - paid) / 1000));
        return {
          orderItemId: row.orderItemId,
          orderNumber: row.orderNumber,
          placedAt: row.placedAt.toISOString(),
          paidAt: row.paidAt?.toISOString() ?? null,
          email: row.email,
          activationEmail: row.activationEmail,
          sku: row.sku,
          productName: row.productName,
          qty: row.qty,
          state: row.state,
          mode: row.mode,
          credentialKind: row.credentialKind,
          deliverySlaSeconds: row.deliverySlaSeconds,
          requiresActivationEmail: row.requiresActivationEmail,
          hasKey: row.hasKey,
          waitingSeconds,
          // Against the promise the product page made, not a fixed number.
          // A six-hour line is not late at two hours; a fifteen-minute one is.
          overdue:
            (row.state === 'MANUAL_QUEUE' || row.state === 'AUTO_ASSIGNED') &&
            waitingSeconds > row.deliverySlaSeconds + QUEUE_OVERDUE_GRACE_SECONDS,
        };
      }),
      waiting: summary.waiting,
      oldestPaidAt: summary.oldestPaidAt?.toISOString() ?? null,
    };
  }

  // The code arrives by hand, one line at a time. A limit this low is also a
  // brake on a stolen session pasting a hundred keys into a hundred orders.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Roles('ADMIN', 'FULFILLMENT')
  @Post('queue/:orderItemId/fulfil')
  @ApiOperation({ summary: 'Store the supplier code and deliver the line' })
  fulfil(
    @Param('orderItemId') orderItemId: string,
    @Body(new ZodPipe(fulfilManuallySchema)) body: z.infer<typeof fulfilManuallySchema>,
    @Req() request: StaffRequest,
  ) {
    return this.fulfillment.fulfilManually({
      orderItemId,
      secret: body.secret,
      supplierId: body.supplierId,
      costUsd: body.costUsd,
      actor: this.actor(request),
    });
  }

  @Roles('ADMIN', 'FULFILLMENT')
  @Post('queue/:orderItemId/deliver')
  @ApiOperation({ summary: 'Send a line that already has a key from stock' })
  deliver(@Param('orderItemId') orderItemId: string, @Req() request: StaffRequest) {
    return this.fulfillment.deliverAssigned({
      orderItemId,
      actor: this.actor(request),
    });
  }

  @Roles('ADMIN', 'FULFILLMENT')
  @Post('queue/:orderItemId/fail')
  @ApiOperation({ summary: 'Mark a line as failed, with a reason' })
  fail(
    @Param('orderItemId') orderItemId: string,
    @Body(new ZodPipe(markFailedSchema)) body: z.infer<typeof markFailedSchema>,
    @Req() request: StaffRequest,
  ) {
    return this.fulfillment.markFailed({
      orderItemId,
      reason: body.reason,
      actor: this.actor(request),
    });
  }

  // --- vault ----------------------------------------------------------------

  @Roles('ADMIN', 'FULFILLMENT')
  @Post('vault/import')
  @ZodResponse(importResultSchema)
  @ApiOperation({ summary: 'Take in a batch of licences for one variant' })
  async importKeys(
    @Body(new ZodPipe(importKeysSchema)) body: z.infer<typeof importKeysSchema>,
    @Req() request: StaffRequest,
  ): Promise<ImportResult> {
    // Through the fulfilment module, not straight into the vault: what a line
    // in that block means depends on whether the variant is sold as a key or
    // as an account, and only this side can read that.
    return this.fulfillment.importKeys({
      variantId: body.variantId,
      block: body.codes,
      supplierId: body.supplierId,
      costUsd: body.costUsd,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      actor: this.actor(request),
    });
  }

  @Roles('ADMIN', 'FULFILLMENT', 'CATALOG')
  @Get('vault/stock')
  @ApiOperation({ summary: 'Every variant with what the vault holds. Never plaintext.' })
  stock() {
    return this.fulfillment.vaultStock();
  }

  /**
   * Where a complaint starts: an order number and nothing else.
   *
   * Returns ids and states so the person answering can see whether a key went
   * out and when. Opening one is the separate route below.
   */
  @Roles('ADMIN', 'FULFILLMENT', 'SUPPORT')
  @Get('orders/:number/keys')
  @ApiOperation({ summary: 'The keys behind one order — ids and states only' })
  async orderKeys(@Param('number') number: string) {
    const lines = await this.fulfillment.keysForOrder(number);
    return lines.map((line) => ({
      ...line,
      deliveredAt: line.deliveredAt?.toISOString() ?? null,
      keys: line.keys.map((key) => ({
        ...key,
        deliveredAt: key.deliveredAt?.toISOString() ?? null,
      })),
    }));
  }

  /**
   * The one endpoint that returns a licence in the clear.
   *
   * ADMIN only, throttled hard, a reason required, a fresh TOTP challenge
   * enforced inside the vault, and a KeyAccessLog row written before the
   * plaintext exists. A leaked key cannot be recalled, so the cost of every
   * one of those is worth paying.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Roles('ADMIN')
  @Post('vault/keys/:licenseKeyId/reveal')
  @ZodResponse(revealResultSchema)
  @ApiOperation({ summary: 'Show one licence to a named member of staff' })
  async reveal(
    @Param('licenseKeyId') licenseKeyId: string,
    @Body(new ZodPipe(revealSchema)) body: z.infer<typeof revealSchema>,
    @Req() request: StaffRequest,
  ): Promise<RevealResult> {
    // Through fulfilment so the reason is stored beside the vault's REVEAL row.
    const secret = await this.fulfillment.revealKey({
      licenseKeyId,
      reason: body.reason,
      actor: this.actor(request),
    });
    // Already split by the vault. Passed through field by field so the panel
    // can label each part rather than printing one run-together string.
    return {
      kind: secret.kind,
      key: secret.key,
      username: secret.username,
      password: secret.password,
    };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Roles('ADMIN')
  @Post('vault/keys/:licenseKeyId/revoke')
  @ApiOperation({ summary: 'Take a licence out of circulation, with a reason' })
  revoke(
    @Param('licenseKeyId') licenseKeyId: string,
    @Body(new ZodPipe(markFailedSchema)) body: z.infer<typeof markFailedSchema>,
    @Req() request: StaffRequest,
  ) {
    // Through fulfilment: a revoked stock key has to come off the count too.
    return this.fulfillment.revokeKey({
      licenseKeyId,
      reason: body.reason,
      actor: this.actor(request),
    });
  }

  /**
   * Corrects a stock key that was pasted wrong: the new one in, the old one
   * revoked. ADMIN, a reason and a fresh TOTP challenge, as for a revoke.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Roles('ADMIN')
  @Post('vault/keys/:licenseKeyId/replace')
  @ApiOperation({ summary: 'Replace one unsold stock key, with a reason' })
  replace(
    @Param('licenseKeyId') licenseKeyId: string,
    @Body(new ZodPipe(replaceKeySchema)) body: z.infer<typeof replaceKeySchema>,
    @Req() request: StaffRequest,
  ) {
    return this.fulfillment.replaceKey({
      licenseKeyId,
      code: body.code,
      reason: body.reason,
      actor: this.actor(request),
    });
  }

  /** One variant's keys — ids, states and dates. Never what they say. */
  @Roles('ADMIN', 'FULFILLMENT')
  @Get('vault/stock/:variantId/keys')
  @ApiOperation({ summary: 'The keys of one variant: ids, states, dates. Never plaintext.' })
  async variantKeys(@Param('variantId') variantId: string) {
    const rows = await this.fulfillment.variantKeys(variantId);
    return rows.map((row) => ({
      licenseKeyId: row.licenseKeyId,
      state: row.state,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      revokedReason: row.revokedReason,
    }));
  }

  @Roles('ADMIN', 'FULFILLMENT')
  @Get('vault/keys/:licenseKeyId/history')
  @ApiOperation({ summary: 'Who touched a key and when. Never what it says.' })
  async history(@Param('licenseKeyId') licenseKeyId: string) {
    const rows = await this.fulfillment.keyHistory(licenseKeyId);
    return rows.map((row) => ({
      action: row.action,
      actorId: row.actorId,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
      reason: row.reason,
    }));
  }
}
