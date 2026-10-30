import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AgentBatchDetail,
  type AgentCandidates,
  type AgentOverview,
  type StartAgentBatch,
  startAgentBatchSchema,
} from '@da/contracts';
import { z } from 'zod';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { ProductAgentService } from './product-agent.service.js';

const batchActionSchema = z.object({ action: z.enum(['pause', 'resume', 'cancel']) });

/**
 * The product agent (CR-0007). Reading and stopping are catalogue work;
 * starting or retrying a batch is ADMIN's, since it spends the owner's
 * OpenCode balance and publishes products without a second look.
 */
@ApiTags('admin')
@Controller('admin/agent')
@UseGuards(StaffGuard)
@Roles('ADMIN', 'CATALOG')
export class ProductAgentController {
  constructor(private readonly agent: ProductAgentService) {}

  private actor(request: StaffRequest) {
    return {
      staffId: request.staff?.sub ?? '',
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };
  }

  @Get()
  @ApiOperation({ summary: 'Recent batches, and whether the AI and the worker are ready' })
  overview(): Promise<AgentOverview> {
    return this.agent.overview();
  }

  @Get('candidates')
  @ApiOperation({ summary: 'Products to rewrite and unlinked supplier lines to create' })
  candidates(): Promise<AgentCandidates> {
    return this.agent.candidates();
  }

  @Post('batches')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Start a batch; the worker takes it from here' })
  start(
    @Body(new ZodPipe(startAgentBatchSchema)) body: StartAgentBatch,
    @Req() request: StaffRequest,
  ): Promise<AgentBatchDetail> {
    return this.agent.start(body, this.actor(request));
  }

  @Get('batches/:id')
  @ApiOperation({ summary: 'One batch with every item, its log and its outcome' })
  batch(@Param('id') id: string): Promise<AgentBatchDetail> {
    return this.agent.batch(id);
  }

  @Post('batches/:id/status')
  @ApiOperation({ summary: 'Pause or cancel a batch; resuming is ADMIN only' })
  setStatus(
    @Param('id') id: string,
    @Body(new ZodPipe(batchActionSchema)) body: z.infer<typeof batchActionSchema>,
    @Req() request: StaffRequest,
  ): Promise<AgentBatchDetail> {
    // Resuming spends the AI balance and publishes, as starting does: ADMIN's.
    const role = request.staff?.role;
    if (body.action === 'resume' && role !== 'ADMIN' && role !== 'OWNER') {
      throw new ForbiddenException('Your role does not allow this.');
    }
    return this.agent.setStatus(id, body.action, this.actor(request));
  }

  @Post('items/:id/retry')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Queue a failed, skipped or cancelled item again' })
  retry(@Param('id') id: string, @Req() request: StaffRequest): Promise<AgentBatchDetail> {
    return this.agent.retry(id, this.actor(request));
  }

  @Post('items/:id/revert')
  @ApiOperation({ summary: 'Undo what one item did to its product' })
  revert(@Param('id') id: string, @Req() request: StaffRequest): Promise<AgentBatchDetail> {
    return this.agent.revert(id, this.actor(request));
  }
}
