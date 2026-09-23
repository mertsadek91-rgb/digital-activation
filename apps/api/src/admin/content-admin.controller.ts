import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  type AdminArticle,
  type AdminArticleList,
  type AdminBrand,
  type AdminBrandList,
  type AdminPage,
  type AdminPageList,
  type AdminPageVersionList,
  type CreateArticle,
  type CreatePage,
  type SetArticle,
  type SetBrand,
  type SetPage,
  createArticleSchema,
  createPageSchema,
  setArticleSchema,
  setBrandSchema,
  setPageSchema,
} from '@da/contracts';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { ContentArticlesService } from './content-articles.service.js';
import { ContentBrandsService } from './content-brands.service.js';
import { ContentPagesService } from './content-pages.service.js';

/**
 * Pages, blog posts and brand hubs.
 *
 * One role set for reading and writing alike: ADMIN, CATALOG and MARKETING
 * (OWNER passes every guard). Marketing is here because this is the copy and
 * the SEO they are measured on; support and fulfilment are not, because a
 * draft's unpublished text is not theirs to read either.
 *
 * Nothing here deletes. A page taken down is a page set to draft — its URL
 * then 404s and the history stays — and removing the row outright is the one
 * edit that would also remove the record of what the policy used to say.
 */
@ApiTags('admin')
@Controller('admin/content')
@UseGuards(StaffGuard)
@Roles('ADMIN', 'CATALOG', 'MARKETING')
export class ContentAdminController {
  constructor(
    private readonly pages: ContentPagesService,
    private readonly articles: ContentArticlesService,
    private readonly brands: ContentBrandsService,
  ) {}

  // --- pages ------------------------------------------------------------------

  @Get('pages')
  @ApiOperation({ summary: 'Every editorial page, grouped by URL, with its locales' })
  listPages(): Promise<AdminPageList> {
    return this.pages.list();
  }

  @Post('pages')
  @ApiOperation({ summary: 'Create a page as a draft in one locale' })
  createPage(
    @Body(new ZodPipe(createPageSchema)) body: CreatePage,
    @Req() request: StaffRequest,
  ): Promise<AdminPage> {
    return this.pages.create(body, request.staff?.sub);
  }

  @Get('pages/:slug')
  @ApiOperation({ summary: 'One page, both locales, blocks and SEO' })
  getPage(@Param('slug') slug: string): Promise<AdminPage> {
    return this.pages.get(slug);
  }

  @Patch('pages/:slug')
  @ApiOperation({ summary: 'Edit one locale, the template or the URL; snapshots a PageVersion' })
  updatePage(
    @Param('slug') slug: string,
    @Body(new ZodPipe(setPageSchema)) body: SetPage,
    @Req() request: StaffRequest,
  ): Promise<AdminPage> {
    return this.pages.update(slug, body, request.staff?.sub);
  }

  @Get('pages/:slug/versions')
  @ApiOperation({ summary: 'Saved states of a page, both locales, newest first' })
  pageVersions(@Param('slug') slug: string): Promise<AdminPageVersionList> {
    return this.pages.versions(slug);
  }

  @Post('pages/:slug/versions/:versionId/restore')
  @ApiOperation({
    summary: 'Save an old version as the newest one; URL, template and status unchanged',
  })
  restorePageVersion(
    @Param('slug') slug: string,
    @Param('versionId') versionId: string,
    @Req() request: StaffRequest,
  ): Promise<AdminPage> {
    return this.pages.restore(slug, versionId, request.staff?.sub);
  }

  // --- blog -------------------------------------------------------------------

  @Get('articles')
  @ApiOperation({ summary: 'Every blog post, grouped by URL, with its locales' })
  listArticles(): Promise<AdminArticleList> {
    return this.articles.list();
  }

  @Post('articles')
  @ApiOperation({ summary: 'Create a blog post as a draft in one locale' })
  createArticle(
    @Body(new ZodPipe(createArticleSchema)) body: CreateArticle,
    @Req() request: StaffRequest,
  ): Promise<AdminArticle> {
    return this.articles.create(body, request.staff?.sub);
  }

  @Get('articles/:slug')
  @ApiOperation({ summary: 'One post, both locales, with the authors to choose from' })
  getArticle(@Param('slug') slug: string): Promise<AdminArticle> {
    return this.articles.get(slug);
  }

  @Patch('articles/:slug')
  @ApiOperation({ summary: 'Edit one locale of a post, or its URL' })
  updateArticle(
    @Param('slug') slug: string,
    @Body(new ZodPipe(setArticleSchema)) body: SetArticle,
    @Req() request: StaffRequest,
  ): Promise<AdminArticle> {
    return this.articles.update(slug, body, request.staff?.sub);
  }

  // --- brands -----------------------------------------------------------------

  @Get('brands')
  @ApiOperation({ summary: 'Every brand, with its published product count' })
  listBrands(): Promise<AdminBrandList> {
    return this.brands.list();
  }

  @Get('brands/:id')
  @ApiOperation({ summary: 'One brand hub, both locales' })
  getBrand(@Param('id') id: string): Promise<AdminBrand> {
    return this.brands.get(id);
  }

  @Patch('brands/:id')
  @ApiOperation({ summary: 'Edit a brand hub’s copy and SEO, or its URL' })
  updateBrand(
    @Param('id') id: string,
    @Body(new ZodPipe(setBrandSchema)) body: SetBrand,
    @Req() request: StaffRequest,
  ): Promise<AdminBrand> {
    return this.brands.update(id, body, request.staff?.sub);
  }
}
