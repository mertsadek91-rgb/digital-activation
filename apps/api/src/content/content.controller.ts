import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { type ContentPage, submitContactSchema } from '@da/contracts';
import type { z } from 'zod';

import { ZodPipe } from '../common/zod.pipe.js';

import { ContactService } from './contact.service.js';
import { ContentService } from './content.service.js';

@ApiTags('content')
@Controller('content')
export class ContentController {
  constructor(
    private readonly content: ContentService,
    private readonly contact: ContactService,
  ) {}

  @Get('pages/:slug')
  @ApiOperation({ summary: 'One editorial page, in the requested locale' })
  page(
    @Param('slug') slug: string,
    @Query('locale') locale = 'ar',
    @Query('preview') preview?: string,
  ): Promise<ContentPage> {
    return this.content.page(slug, locale, preview);
  }

  /**
   * Three a minute.
   *
   * Enough for somebody who mistyped their address and sent again, far too few
   * to use the acknowledgement email as a way to bomb a stranger's inbox —
   * which is the one thing a form that emails an unverified address can be
   * turned into.
   */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('contact')
  @ApiOperation({ summary: 'A message from the contact form' })
  async contactUs(
    @Body(new ZodPipe(submitContactSchema)) body: z.infer<typeof submitContactSchema>,
    @Req() request: FastifyRequest,
  ): Promise<{ received: true }> {
    await this.contact.submit({
      ...body,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    // The same answer for a real message and for one the honeypot caught.
    return { received: true };
  }

  @Get('pages')
  @ApiOperation({ summary: 'Published page slugs, for the sitemap' })
  async pages(): Promise<{ slug: string; lastModified: string }[]> {
    const rows = await this.content.publishedSlugs();
    return rows.map((row) => ({ slug: row.slug, lastModified: row.updatedAt.toISOString() }));
  }
}
