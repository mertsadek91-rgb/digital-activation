import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type LaunchReadiness, launchReadinessSchema } from '@da/contracts';

import { ZodResponse } from '../common/openapi.js';
import { Roles, StaffGuard } from '../auth/staff.guard.js';

import { LaunchService } from './launch.service.js';

/**
 * Whether the store could take an order right now.
 *
 * OWNER and ADMIN only (TASK-0095). Nothing here is written, but it shows
 * how the store's infrastructure is configured and where mail delivery is
 * failing, which is for the people who can fix it.
 */
@ApiTags('admin')
@Controller('admin/launch')
@UseGuards(StaffGuard)
@Roles('OWNER', 'ADMIN')
export class LaunchController {
  constructor(private readonly launch: LaunchService) {}

  @Get()
  @ZodResponse(launchReadinessSchema)
  @ApiOperation({ summary: 'What stands between this store and its first order' })
  readiness(): Promise<LaunchReadiness> {
    return this.launch.readiness();
  }
}
