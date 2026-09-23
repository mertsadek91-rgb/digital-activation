import { Readable } from 'node:stream';

import { Controller, Get, Param, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AdminCustomerDetail, AdminCustomerList } from '@da/contracts';

import { AuditService } from '../auth/audit.service.js';
import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';

import { CustomersService } from './customers.service.js';

/**
 * Customers, for staff.
 *
 * SUPPORT reads them because the first question on any message is "who is
 * this and what have they bought"; READONLY reads them like it reads orders.
 * FULFILLMENT, CATALOG and MARKETING do not: a customer record is an email,
 * a phone and a purchase history, and none of those jobs needs to browse it.
 *
 * The export is OWNER and ADMIN only — a file of every address the store
 * holds is the most portable thing this panel can produce — throttled, and
 * audited with the filter that produced it.
 */
@ApiTags('admin')
@Controller('admin/customers')
@UseGuards(StaffGuard)
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly audit: AuditService,
  ) {}

  @Roles('OWNER', 'ADMIN', 'SUPPORT', 'READONLY')
  @Get()
  @ApiOperation({ summary: 'Customers, newest first, searchable by email or name' })
  list(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ): Promise<AdminCustomerList> {
    return this.customers.list({
      q: q?.trim() || undefined,
      limit: Math.min(200, Math.max(1, Number.parseInt(limit ?? '50', 10) || 50)),
      page: Math.max(1, Number.parseInt(page ?? '1', 10) || 1),
    });
  }

  // Declared before `:id` so the literal path is never read as an id.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Roles('OWNER', 'ADMIN')
  @Get('export.csv')
  @ApiOperation({
    summary: 'Every customer as CSV, with consent columns; consent=opted-in for a mailing list',
  })
  async exportCsv(
    @Req() request: StaffRequest,
    @Query('q') q?: string,
    @Query('consent') consent?: string,
  ): Promise<StreamableFile> {
    const optedInOnly = consent === 'opted-in';
    await this.audit.record({
      actorId: request.staff?.sub,
      entity: 'Customer',
      entityId: 'export',
      action: 'customers.exported',
      after: { q: q?.trim() || null, consent: optedInOnly ? 'opted-in' : 'all' },
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    const stamp = new Date().toISOString().slice(0, 10);
    return new StreamableFile(
      Readable.from(this.customers.exportCsv({ q: q?.trim() || undefined, optedInOnly })),
      {
        type: 'text/csv; charset=utf-8',
        disposition: `attachment; filename="customers-${stamp}.csv"`,
      },
    );
  }

  @Roles('OWNER', 'ADMIN', 'SUPPORT', 'READONLY')
  @Get(':id')
  @ApiOperation({ summary: 'One customer: profile, consent, orders, licence count' })
  detail(@Param('id') id: string): Promise<AdminCustomerDetail> {
    return this.customers.detail(id);
  }
}
