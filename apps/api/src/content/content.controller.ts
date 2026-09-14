import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import {
  type Article,
  type BlogIndex,
  type ContentPage,
  type Suggestions,
  recordNotFoundSchema,
  submitContactSchema,
} from '@da/contracts';
import type { z } from 'zod';

import { ZodPipe } from '../common/zod.pipe.js';

import { ContactService } from './contact.service.js';
import { ContentService } from './content.service.js';
import { SuggestService } from './suggest.service.js';

@ApiTags('content')
@Controller('content')
export class ContentController {
  constructor(
    private readonly content: ContentService,
    private readonly contact: ContactService,
    private readonly suggestions: SuggestService,
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

  @Get('posts')
  @ApiOperation({ summary: 'Every published blog post, newest first' })
  posts(@Query('locale') locale = 'ar', @Query('preview') preview?: string): Promise<BlogIndex> {
    return this.content.articles(locale, preview);
  }

  @Get('posts/:slug')
  @ApiOperation({ summary: 'One blog post, with the newest others' })
  post(
    @Param('slug') slug: string,
    @Query('locale') locale = 'ar',
    @Query('preview') preview?: string,
  ): Promise<Article> {
    return this.content.article(slug, locale, preview);
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

  /**
   * Asked only when every real route has declined the path, so the answer is
   * either a redirect or the 404 the caller was about to render anyway.
   */
  @Get('redirects')
  @ApiOperation({ summary: 'Where a legacy URL goes now' })
  async redirect(@Query('path') pathname = ''): Promise<{ to: string; code: number }> {
    const target = await this.content.redirectFor(pathname);
    if (!target) throw new NotFoundException('No redirect for that path.');
    return target;
  }

  /**
   * Called by the storefront when a path matched nothing at all.
   *
   * Throttled, because it is an anonymous write: a crawler walking random
   * paths must not be able to fill the table faster than a person can read it.
   * The service drops the obvious probes on top of that.
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('not-found')
  @ApiOperation({ summary: 'Record a path that answered 404' })
  async notFound(
    @Body(new ZodPipe(recordNotFoundSchema)) body: z.infer<typeof recordNotFoundSchema>,
    @Req() request: FastifyRequest,
  ): Promise<{ recorded: true }> {
    await this.content.recordNotFound({
      path: body.path,
      referer: body.referer,
      userAgent: request.headers['user-agent'],
    });
    return { recorded: true };
  }

  /**
   * What the 404 page offers instead of nothing.
   *
   * Throttled like the report above and for the same reason — a crawler
   * walking an old sitemap produces these in bursts — but more generously,
   * because one visitor hitting one dead end makes exactly one of these and
   * the answer is what decides whether they stay.
   */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('suggest')
  @ApiOperation({ summary: 'Nearest published pages to a path that 404d' })
  async suggest(@Query('path') path = '', @Query('locale') locale = 'ar'): Promise<Suggestions> {
    if (path.trim().length === 0 || path.length > 2000) return { suggestions: [] };
    return this.suggestions.suggest({ path, locale });
  }

  @Get('pages')
  @ApiOperation({ summary: 'Published page slugs, for the sitemap' })
  async pages(): Promise<{ slug: string; lastModified: string }[]> {
    const rows = await this.content.publishedSlugs();
    return rows.map((row) => ({ slug: row.slug, lastModified: row.updatedAt.toISOString() }));
  }

  /**
   * Deliberately separate from `posts` above, which carries titles, summaries
   * and reading times the sitemap has no use for. A sitemap asks one question —
   * what exists and when did it change — and answering it with the blog index
   * would mean fetching seven summaries every hour to read two fields.
   */
  @Get('post-slugs')
  @ApiOperation({ summary: 'Published post slugs and their languages, for the sitemap' })
  async postSlugs(): Promise<{ slug: string; lastModified: string; locales: string[] }[]> {
    const rows = await this.content.publishedPostSlugs();
    return rows.map((row) => ({
      slug: row.slug,
      lastModified: row.updatedAt.toISOString(),
      locales: row.locales,
    }));
  }
}
