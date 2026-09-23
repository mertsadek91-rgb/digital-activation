import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type AdminOrderDetail,
  type AdminOrderList,
  addOrderNoteSchema,
  confirmPaymentSchema,
  refundOrderSchema,
  releaseHoldSchema,
  adminOrderListSchema,
  adminOrderDetailSchema,
} from '@da/contracts';
import type { z } from 'zod';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodResponse } from '../common/openapi.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { OrdersService } from './orders.service.js';

/**
 * Orders, for staff.
 *
 * Confirming a payment is OWNER and ADMIN only, and deliberately not
 * FULFILLMENT: it releases a licence key against money nobody in this system
 * can see, which is the one action here that cannot be undone by clicking
 * again. Releasing a hold is the same kind of act, and has the same roles.
 *
 * Reading is not open to every staff role either: an order carries the
 * customer's email, address and IP, and a CATALOG or MARKETING account has no
 * reason to page through those.
 */
@ApiTags('admin')
@Controller('admin/orders')
@UseGuards(StaffGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Roles('OWNER', 'ADMIN', 'SUPPORT', 'FULFILLMENT', 'READONLY')
  @Get()
  @ZodResponse(adminOrderListSchema)
  @ApiOperation({ summary: 'Orders, newest first' })
  list(
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ): Promise<AdminOrderList> {
    return this.orders.list({
      status,
      q: q?.trim() || undefined,
      limit: Math.min(200, Math.max(1, Number.parseInt(limit ?? '50', 10) || 50)),
      page: Math.max(1, Number.parseInt(page ?? '1', 10) || 1),
    });
  }

  @Roles('OWNER', 'ADMIN', 'SUPPORT', 'FULFILLMENT', 'READONLY')
  @Get(':number')
  @ZodResponse(adminOrderDetailSchema)
  @ApiOperation({ summary: 'One order with its lines, payments and notes' })
  detail(@Param('number') number: string): Promise<AdminOrderDetail> {
    return this.orders.detail(number);
  }

  // Ten a minute. This is a human confirming a bank statement, not a machine.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Roles('OWNER', 'ADMIN')
  @Post(':number/confirm-payment')
  @ApiOperation({ summary: 'Record money that arrived outside the store, and release the order' })
  confirmPayment(
    @Param('number') number: string,
    @Body(new ZodPipe(confirmPaymentSchema)) body: z.infer<typeof confirmPaymentSchema>,
    @Req() request: StaffRequest,
  ) {
    return this.orders.confirmPayment({
      number,
      provider: body.provider,
      reference: body.reference,
      staffId: request.staff?.sub ?? '',
      context: { ip: request.ip, userAgent: request.headers['user-agent'] },
    });
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Roles('OWNER', 'ADMIN')
  @Post(':number/release-hold')
  @ApiOperation({ summary: 'Lift a review or risk hold, and let fulfilment run' })
  releaseHold(
    @Param('number') number: string,
    @Body(new ZodPipe(releaseHoldSchema)) body: z.infer<typeof releaseHoldSchema>,
    @Req() request: StaffRequest,
  ) {
    return this.orders.releaseHold({
      number,
      reason: body.reason,
      staffId: request.staff?.sub ?? '',
      context: { ip: request.ip, userAgent: request.headers['user-agent'] },
    });
  }

  /**
   * Refunds the whole order. OWNER and ADMIN, like confirming a payment: it
   * moves money, and the panel is the only place that says who did.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Roles('OWNER', 'ADMIN')
  @Post(':number/refund')
  @ApiOperation({ summary: 'Refund an order in full (card via Stripe; others recorded)' })
  async refund(
    @Param('number') number: string,
    @Body(new ZodPipe(refundOrderSchema)) body: z.infer<typeof refundOrderSchema>,
    @Req() request: StaffRequest,
  ) {
    const result = await this.orders.refund({
      number,
      reason: body.reason,
      staffId: request.staff?.sub ?? '',
      context: { ip: request.ip, userAgent: request.headers['user-agent'] },
    });
    return result;
  }

  /**
   * Sends a licence email again.
   *
   * SUPPORT is on it deliberately: this is the single most common thing a
   * customer writes in about, and until now nobody here could answer it — the
   * customer's own page could resend and the panel could not, so the workaround
   * was to read the key out of the vault by hand and paste it into a reply.
   * That is the one outcome the vault exists to prevent, and it needed a role
   * far higher than the person answering the message.
   *
   * The address is not a parameter and cannot be: it is read from the order.
   * Throttled well below anything a person answering messages would hit, and
   * far below anything that could walk the catalogue of order lines — every
   * one of which answers 404 unless it belongs to the order in the path.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Roles('OWNER', 'ADMIN', 'SUPPORT', 'FULFILLMENT')
  @Post(':number/lines/:orderItemId/resend')
  @ApiOperation({ summary: 'Re-send the licence email for one line, to the order’s address' })
  resendLicence(
    @Param('number') number: string,
    @Param('orderItemId') orderItemId: string,
    @Req() request: StaffRequest,
  ): Promise<{ to: string }> {
    return this.orders.resendLicence({
      number,
      orderItemId,
      staffId: request.staff?.sub ?? '',
      totpAt: request.staff?.totpAt ?? 0,
      context: { ip: request.ip, userAgent: request.headers['user-agent'] },
    });
  }

  @Roles('OWNER', 'ADMIN', 'SUPPORT', 'FULFILLMENT')
  @Post(':number/notes')
  @ApiOperation({ summary: 'Add a note. Never a licence key.' })
  addNote(
    @Param('number') number: string,
    @Body(new ZodPipe(addOrderNoteSchema)) body: z.infer<typeof addOrderNoteSchema>,
    @Req() request: StaffRequest,
  ) {
    return this.orders.addNote({
      number,
      body: body.body,
      isCustomerVisible: body.isCustomerVisible,
      staffId: request.staff?.sub ?? '',
    });
  }
}
