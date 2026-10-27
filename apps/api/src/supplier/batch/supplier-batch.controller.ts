import { Body, Controller, Delete, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AiBatchView, type StartAiBatch, startAiBatchSchema } from '@da/contracts';

import { Roles, StaffGuard, type StaffRequest } from '../../auth/staff.guard.js';
import { ZodPipe } from '../../common/zod.pipe.js';

import { SupplierBatchService } from './supplier-batch.service.js';

/**
 * Products from sheet lines with AI, one line after another (TASK-0150).
 *
 * Starting, stopping and retrying are ADMIN's (OWNER always passes): they
 * create products, which is one role narrower than editing them, and spend
 * the owner's OpenCode balance. CATALOG may watch.
 */
@ApiTags('admin')
@Controller('admin/supplier/ai/batch')
@UseGuards(StaffGuard)
@Roles('ADMIN')
export class SupplierBatchController {
  constructor(private readonly batch: SupplierBatchService) {}

  @Get()
  @Roles('ADMIN', 'CATALOG')
  @ApiOperation({ summary: 'The current batch and where each of its lines is' })
  current(): Promise<AiBatchView> {
    return this.batch.current();
  }

  @Post()
  @ApiOperation({ summary: 'Queue lines: draft, create, link and write each product with AI' })
  start(
    @Body(new ZodPipe(startAiBatchSchema)) body: StartAiBatch,
    @Req() request: StaffRequest,
  ): Promise<AiBatchView> {
    return this.batch.start(body, { staffId: request.staff?.sub ?? '' });
  }

  @Post('cancel')
  @ApiOperation({ summary: 'Stop the batch after the call in progress' })
  cancel(): Promise<AiBatchView> {
    return this.batch.cancel();
  }

  @Post('retry')
  @ApiOperation({ summary: 'Queue the failed and cancelled lines again' })
  retry(@Req() request: StaffRequest): Promise<AiBatchView> {
    return this.batch.retry({ staffId: request.staff?.sub ?? '' });
  }

  @Delete()
  @ApiOperation({ summary: 'Clear a finished batch from the panel' })
  dismiss(): Promise<AiBatchView> {
    return this.batch.dismiss();
  }
}
