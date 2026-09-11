import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { ContentPage } from '@da/contracts';

import { ContentService } from './content.service.js';

@ApiTags('content')
@Controller('content')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get('pages/:slug')
  @ApiOperation({ summary: 'One editorial page, in the requested locale' })
  page(
    @Param('slug') slug: string,
    @Query('locale') locale = 'ar',
    @Query('preview') preview?: string,
  ): Promise<ContentPage> {
    return this.content.page(slug, locale, preview);
  }

  @Get('pages')
  @ApiOperation({ summary: 'Published page slugs, for the sitemap' })
  async pages(): Promise<{ slug: string; lastModified: string }[]> {
    const rows = await this.content.publishedSlugs();
    return rows.map((row) => ({ slug: row.slug, lastModified: row.updatedAt.toISOString() }));
  }
}
