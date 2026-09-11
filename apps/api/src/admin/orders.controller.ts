import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type AdminOrderDetail,
  type AdminOrderList,
  addOrderNoteSchema,
  confirmPaymentSchema,
} from '@da/contracts';
import type { z } from 'zod';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { OrdersService } from './orders.service.js';

/**
 * Orders, for staff.
 *
 * Confirming a payment is OWNER and ADMIN only, and deliberately not
 * FULFILLMENT: it releases a licence key against money nobody in this system
 * can see, which is the one action here that cannot be undone by clicking
 * again.
 */
@ApiTags('admin')
@Controller('admin/orders')
@UseGuards(StaffGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'Orders, newest first' })
  list(
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ): Promise<AdminOrderList> {
    return this.orders.list({
      status,
      q: q?.trim() || undefined,
      limit: Math.min(200, Math.max(1, Number.parseInt(limit ?? '50', 10) || 50)),
    });
  }

  @Get(':number')
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
