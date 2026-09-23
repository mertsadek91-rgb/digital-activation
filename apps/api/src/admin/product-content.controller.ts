import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  type ProductContent,
  type SetProductContent,
  setProductContentSchema,
  productContentSchema,
} from '@da/contracts';
import { Locale } from '@da/db';
import { z } from 'zod';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodResponse } from '../common/openapi.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { ProductContentService } from './product-content.service.js';

const localeQuery = z.object({ locale: z.enum(['ar', 'en']).default('ar') });

/**
 * The description, the FAQ, the warnings and the download link.
 *
 * Separate from the SEO copy route next door on purpose: that one edits the two
 * fields the publish gate refuses on, and is used constantly. This one edits
 * the page itself, is used rarely and carefully, and returns a whole block
 * document — mixing them would make every meta-description fix carry a body.
 */
@ApiTags('admin')
@Controller('admin')
@UseGuards(StaffGuard)
export class ProductContentController {
  constructor(private readonly content: ProductContentService) {}

  @Get('products/:slug/content')
  @ZodResponse(productContentSchema)
  @ApiOperation({ summary: 'The description as blocks, with its word count' })
  get(
    @Param('slug') slug: string,
    @Query(new ZodPipe(localeQuery)) query: { locale: 'ar' | 'en' },
  ): Promise<ProductContent> {
    return this.content.content(slug, query.locale === 'en' ? Locale.EN : Locale.AR);
  }

  @Patch('products/:slug/content')
  @ZodResponse(productContentSchema)
  @Roles('ADMIN', 'CATALOG')
  @ApiOperation({ summary: 'Write the description, warnings or download link' })
  set(
    @Param('slug') slug: string,
    @Body(new ZodPipe(setProductContentSchema)) body: SetProductContent,
    @Req() request: StaffRequest,
  ): Promise<ProductContent> {
    return this.content.setContent(slug, body, request.staff?.sub);
  }
}
