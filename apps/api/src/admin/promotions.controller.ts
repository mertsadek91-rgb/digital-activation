import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AdminPromotion,
  type AdminPromotionList,
  createPromotionSchema,
  updatePromotionSchema,
} from '@da/contracts';
import type { z } from 'zod';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { PromotionsService } from './promotions.service.js';

/**
 * Coupons.
 *
 * Reading is open to any staff role, because "is this code still live" is a
 * question support answers all day. Writing is OWNER and ADMIN only, and
 * deliberately not CATALOG: the role that manages products can already change
 * a price, and letting it also mint a 90% code would mean two independent ways
 * to give the shop away. The audit row on every write names who did it.
 *
 * There is no delete. A code is on the orders that used it, so removing it
 * makes those orders reference nothing; `isActive: false` is the reversible
 * thing somebody actually wants.
 */
@ApiTags('admin')
@Controller('admin/promotions')
@UseGuards(StaffGuard)
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  // Every live code is on this list, and a code is money. MARKETING reads it
  // because it plans around it; changing one stays ADMIN.
  @Roles('ADMIN', 'MARKETING')
  @Get()
  @ApiOperation({ summary: 'Coupons with what each has actually done' })
  list(@Query('filter') filter?: string): Promise<AdminPromotionList> {
    return this.promotions.list(filter);
  }

  @Roles('ADMIN')
  @Post()
  @ApiOperation({ summary: 'Mint a coupon' })
  create(
    @Body(new ZodPipe(createPromotionSchema)) body: z.infer<typeof createPromotionSchema>,
    @Req() request: StaffRequest,
  ): Promise<AdminPromotion> {
    return this.promotions.create({
      body,
      staffId: request.staff?.sub ?? '',
      context: { ip: request.ip, userAgent: request.headers['user-agent'] },
    });
  }

  /**
   * Everything editable after the fact — which is not the code and not the
   * type. Both are on orders that have already been placed.
   */
  @Roles('ADMIN')
  @Patch(':id')
  @ApiOperation({ summary: 'Change a coupon’s value, window, limits or state' })
  update(
    @Param('id') id: string,
    @Body(new ZodPipe(updatePromotionSchema)) body: z.infer<typeof updatePromotionSchema>,
    @Req() request: StaffRequest,
  ): Promise<AdminPromotion> {
    return this.promotions.update({
      id,
      body,
      staffId: request.staff?.sub ?? '',
      context: { ip: request.ip, userAgent: request.headers['user-agent'] },
    });
  }
}
