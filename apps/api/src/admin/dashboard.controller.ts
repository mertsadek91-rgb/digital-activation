import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AdminDashboard } from '@da/contracts';

import { StaffGuard } from '../auth/staff.guard.js';

import { DashboardService } from './dashboard.service.js';

/**
 * The panel's front page.
 *
 * Readable by every staff role including READONLY, and there is nothing to
 * write: it is a summary of screens each of which already applies its own
 * permissions. Nothing sensitive is on it — no licence key, no customer
 * address, no payment reference. The one identifying thing it carries is the
 * email on each of the eight newest orders, which is on the orders screen the
 * same session can already open.
 */
@ApiTags('admin')
@Controller('admin/dashboard')
@UseGuards(StaffGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Revenue, the work waiting, and what is selling' })
  summary(): Promise<AdminDashboard> {
    return this.dashboard.summary();
  }
}
