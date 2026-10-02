import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AdminDashboard, adminDashboardSchema } from '@da/contracts';

import { ZodResponse } from '../common/openapi.js';
import { Roles, StaffGuard } from '../auth/staff.guard.js';

import { DashboardService } from './dashboard.service.js';

/**
 * The panel's front page.
 *
 * OWNER and ADMIN only (TASK-0095). Nothing here is written, but it carries
 * store revenue and the email on each of the eight newest orders, and the
 * owner decided on 2026-10-02 that neither belongs with READONLY.
 */
@ApiTags('admin')
@Controller('admin/dashboard')
@UseGuards(StaffGuard)
@Roles('OWNER', 'ADMIN')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ZodResponse(adminDashboardSchema)
  @ApiOperation({ summary: 'Revenue, the work waiting, and what is selling' })
  summary(): Promise<AdminDashboard> {
    return this.dashboard.summary();
  }
}
