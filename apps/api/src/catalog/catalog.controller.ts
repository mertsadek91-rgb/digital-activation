import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CatalogCollection,
  type CatalogProduct,
  type CatalogQuery,
  type Home,
  type SitemapFeed,
  catalogQuerySchema,
} from '@da/contracts';

import { ZodPipe } from '../common/zod.pipe.js';

import { CatalogService } from './catalog.service.js';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('home')
  @ApiOperation({ summary: 'Everything the home page renders, in one response' })
  home(@Query(new ZodPipe(catalogQuerySchema)) query: CatalogQuery): Promise<Home> {
    return this.catalog.home(query);
  }

  /**
   * Everything the sitemap lists.
   *
   * No locale and no currency: a sitemap URL is the same URL in both
   * languages, and the hreflang alternates are derived from the path by the
   * storefront. Cached hard at the edge — it changes when the catalog does,
   * which is rarely.
   */
  @Get('sitemap')
  @ApiOperation({ summary: 'Published paths with their lastmod, for the sitemap' })
  sitemap(): Promise<SitemapFeed> {
    return this.catalog.sitemap();
  }

  @Get('collections')
  @ApiOperation({ summary: 'Every collection with its published product count' })
  collections(@Query(new ZodPipe(catalogQuerySchema)) query: CatalogQuery) {
    return this.catalog.collections(query);
  }

  @Get('collections/:slug')
  @ApiOperation({ summary: 'One collection with a page of product cards' })
  collection(
    @Param('slug') slug: string,
    @Query(new ZodPipe(catalogQuerySchema)) query: CatalogQuery,
  ): Promise<CatalogCollection> {
    return this.catalog.collection(slug, query);
  }

  @Get('products/:slug')
  @ApiOperation({ summary: 'One product with all its variants and prices' })
  product(
    @Param('slug') slug: string,
    @Query(new ZodPipe(catalogQuerySchema)) query: CatalogQuery,
  ): Promise<CatalogProduct> {
    return this.catalog.product(slug, query);
  }
}
