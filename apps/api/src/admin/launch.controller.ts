import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { LaunchReadiness } from '@da/contracts';

import { StaffGuard } from '../auth/staff.guard.js';

import { LaunchService } from './launch.service.js';

/**
 * Whether the store could take an order right now.
 *
 * Readable by every staff role including READONLY, and there is nothing to
 * write: it is six questions asked of things that already know their own
 * answers. The only sensitive thing on it is the shape of what is not
 * configured yet, which anybody with a panel session can see on the screen
 * that configures it.
 */
@ApiTags('admin')
@Controller('admin/launch')
@UseGuards(StaffGuard)
export class LaunchController {
  constructor(private readonly launch: LaunchService) {}

  @Get()
  @ApiOperation({ summary: 'What stands between this store and its first order' })
  readiness(): Promise<LaunchReadiness> {
    return this.launch.readiness();
  }
}
