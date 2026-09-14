import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type CatalogCollection,
  type CatalogProductWithRelated,
  type CatalogQuery,
  type CatalogStore,
  type Home,
  type SearchResults,
  type SitemapFeed,
  catalogQuerySchema,
  searchQuerySchema,
} from '@da/contracts';

import { ZodPipe } from '../common/zod.pipe.js';

import { CatalogService } from './catalog.service.js';
import { SearchService } from './search.service.js';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly searchService: SearchService,
  ) {}

  @Get('home')
  @ApiOperation({ summary: 'Everything the home page renders, in one response' })
  home(@Query(new ZodPipe(catalogQuerySchema)) query: CatalogQuery): Promise<Home> {
    return this.catalog.home(query);
  }

  @Get('store')
  @ApiOperation({ summary: 'Every published product, paginated, with the collections' })
  store(@Query(new ZodPipe(catalogQuerySchema)) query: CatalogQuery): Promise<CatalogStore> {
    return this.catalog.store(query);
  }

  /**
   * Everything the sitemap lists.
   *
   * No locale and no currency: a sitemap URL is the same URL in both
   * languages, and the hreflang alternates are derived from the path by the
   * storefront. Cached hard at the edge — it changes when the catalog does,
   * which is rarely.
   */
  /**
   * The search box.
   *
   * Throttled: the query is arbitrary text and the index is held in memory, so
   * the cost of one request is small and the cost of a thousand a second is
   * not. Well above anything a person typing could reach.
   */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('search')
  @ApiOperation({ summary: 'Products matching a query, best first' })
  search(
    @Query('q') q = '',
    @Query(new ZodPipe(catalogQuerySchema)) query: CatalogQuery,
  ): Promise<SearchResults> {
    return this.searchService.search({ q: searchQuerySchema.parse(q), query });
  }

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
  ): Promise<CatalogProductWithRelated> {
    return this.catalog.product(slug, query);
  }
}
