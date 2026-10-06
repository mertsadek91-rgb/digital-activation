import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type StudioChat,
  type StudioJob,
  type StudioView,
  type WriteArticle,
  setIdeaStatusSchema,
  studioChatSchema,
  writeArticleSchema,
} from '@da/contracts';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { StudioService } from './studio.service.js';

/**
 * The article studio (CR-0006). Writing articles is content work: ADMIN,
 * CATALOG and MARKETING, as the blog editor is. Model calls are POSTs that
 * start background jobs, polled at /admin/studio/jobs/:id.
 */
@ApiTags('admin')
@Controller('admin/studio')
@UseGuards(StaffGuard)
@Roles('ADMIN', 'CATALOG', 'MARKETING')
export class StudioController {
  constructor(private readonly studio: StudioService) {}

  @Get()
  @ApiOperation({ summary: 'Ideas, the conversation, and what the site has' })
  view(): Promise<StudioView> {
    return this.studio.view();
  }

  @Post('chat')
  @ApiOperation({ summary: 'Ask for ideas, or answer the model about them (background job)' })
  chat(@Body(new ZodPipe(studioChatSchema)) body: StudioChat): Promise<StudioJob> {
    return this.studio.chat(body);
  }

  @Delete('chat')
  @ApiOperation({ summary: 'Start the conversation over (ideas are kept)' })
  clear(): Promise<StudioView> {
    return this.studio.clearThread();
  }

  @Patch('ideas/:id')
  @ApiOperation({ summary: 'Dismiss an idea or bring it back' })
  setIdea(
    @Param('id') id: string,
    @Body(new ZodPipe(setIdeaStatusSchema)) body: { status: 'NEW' | 'DISMISSED' },
  ): Promise<StudioView> {
    return this.studio.setIdeaStatus(id, body.status);
  }

  @Post('articles')
  @ApiOperation({ summary: 'Write a draft article from an idea or a title (background job)' })
  write(
    @Body(new ZodPipe(writeArticleSchema)) body: WriteArticle,
    @Req() request: StaffRequest,
  ): Promise<StudioJob> {
    return this.studio.write(body, { staffId: request.staff?.sub ?? '' });
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: 'A studio job: RUNNING, DONE with its result, or FAILED with why' })
  job(@Param('id') id: string): Promise<StudioJob> {
    return this.studio.job(id);
  }
}
