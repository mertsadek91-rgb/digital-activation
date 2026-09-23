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
} from '@da/contracts';
import { z } from 'zod';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { type Actor, VaultService } from '../vault/vault.service.js';

import { FulfillmentService } from './fulfillment.service.js';

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
  @ApiOperation({ summary: 'Show one licence to a named member of staff' })
  async reveal(
    @Param('licenseKeyId') licenseKeyId: string,
    @Body(new ZodPipe(revealSchema)) _body: z.infer<typeof revealSchema>,
    @Req() request: StaffRequest,
  ): Promise<RevealResult> {
    const secret = await this.vault.reveal({ licenseKeyId, actor: this.actor(request) });
    // Already split by the vault. Passed through field by field so the panel
    // can label each part rather than printing one run-together string.
    return {
      kind: secret.kind,
      key: secret.key,
      username: secret.username,
      password: secret.password,
    };
  }

  @Roles('ADMIN')
  @Post('vault/keys/:licenseKeyId/revoke')
  @ApiOperation({ summary: 'Take a licence out of circulation, with a reason' })
  revoke(
    @Param('licenseKeyId') licenseKeyId: string,
    @Body(new ZodPipe(markFailedSchema)) body: z.infer<typeof markFailedSchema>,
    @Req() request: StaffRequest,
  ) {
    return this.vault.revoke({
      licenseKeyId,
      reason: body.reason,
      actor: this.actor(request),
    });
  }

  @Roles('ADMIN', 'FULFILLMENT')
  @Get('vault/keys/:licenseKeyId/history')
  @ApiOperation({ summary: 'Who touched a key and when. Never what it says.' })
  async history(@Param('licenseKeyId') licenseKeyId: string) {
    const rows = await this.vault.history(licenseKeyId);
    return rows.map((row) => ({
      action: row.action,
      actorId: row.actorId,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
