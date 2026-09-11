import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AdminReviewList,
  type AdminReviewQuery,
  adminReviewQuerySchema,
  moderateReviewSchema,
  replyToReviewSchema,
} from '@da/contracts';
import type { z } from 'zod';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ReviewsService } from '../reviews/reviews.service.js';

/**
 * The moderation queue.
 *
 * SUPPORT is on the write routes for the same reason it is on the inbox:
 * reading a review and deciding whether it is a real customer or a link farm
 * is support work, and it should not require the role that can change a price
 * or read a licence key. READONLY can see the queue and move nothing.
 *
 * Every decision is audited. A review is the one thing on this site written by
 * somebody outside it, and "who took this down" has to be answerable — the
 * legacy store's 565 fabricated reviews existed precisely because nothing
 * recorded who put them there.
 */
@ApiTags('admin')
@Controller('admin/reviews')
@UseGuards(StaffGuard)
export class ReviewsAdminController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'Reviews by status, oldest first while pending' })
  list(
    @Query(new ZodPipe(adminReviewQuerySchema)) query: AdminReviewQuery,
  ): Promise<AdminReviewList> {
    return this.reviews.list(query);
  }

  @Roles('ADMIN', 'SUPPORT')
  @Patch(':id/status')
  @ApiOperation({ summary: 'Publish a review, or refuse it' })
  moderate(
    @Param('id') id: string,
    @Body(new ZodPipe(moderateReviewSchema)) body: z.infer<typeof moderateReviewSchema>,
    @Req() request: StaffRequest,
  ) {
    return this.reviews.moderate({
      id,
      status: body.status,
      staffId: request.staff?.sub ?? '',
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  /**
   * The store's answer, printed under the review.
   *
   * Separate from the status route on purpose: replying is not a decision
   * about whether to publish, and a bad review answered well is worth more
   * than the same review quietly rejected.
   */
  @Roles('ADMIN', 'SUPPORT')
  @Post(':id/reply')
  @ApiOperation({ summary: 'Reply to a review as the store' })
  reply(
    @Param('id') id: string,
    @Body(new ZodPipe(replyToReviewSchema)) body: z.infer<typeof replyToReviewSchema>,
    @Req() request: StaffRequest,
  ) {
    return this.reviews.reply({
      id,
      body: body.body,
      staffId: request.staff?.sub ?? '',
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
