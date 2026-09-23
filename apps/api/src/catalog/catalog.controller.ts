import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CatalogCollection,
  type CatalogProductWithRelated,
  type CatalogQuery,
  type CatalogStore,
  type Home,
  type OfferedCurrencies,
  type SearchResults,
  type SitemapFeed,
  catalogQuerySchema,
  searchQuerySchema,
  offeredCurrenciesSchema,
  homeSchema,
  catalogStoreSchema,
  searchResultsSchema,
  sitemapFeedSchema,
  catalogCollectionSchema,
  catalogBrandSchema,
  catalogProductWithRelatedSchema,
} from '@da/contracts';

import { VisitorThrottle } from '../common/explicit-throttler.guard.js';
import { ZodResponse } from '../common/openapi.js';
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

  /**
   * The currency picker's options. USD first, then every active currency
   * with a rate loaded, in the store's order. Cached hard: rates change once
   * a day.
   */
  @Get('currencies')
  @ZodResponse(offeredCurrenciesSchema)
  @ApiOperation({ summary: 'Currencies the store can show prices in' })
  currencies(): Promise<OfferedCurrencies> {
    return this.catalog.offeredCurrencies();
  }

  @Get('home')
  @ZodResponse(homeSchema)
  @ApiOperation({ summary: 'Everything the home page renders, in one response' })
  home(@Query(new ZodPipe(catalogQuerySchema)) query: CatalogQuery): Promise<Home> {
    return this.catalog.home(query);
  }

  @Get('store')
  @ZodResponse(catalogStoreSchema)
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
   * Sixty a minute per visitor: a person typing and refining never gets near
   * it, a script enumerating the catalog through the search index does. The
   * page is rendered on the storefront's server, so the visitor is the address
   * it forwards with INTERNAL_API_KEY — and with no key configured the route
   * is not limited at all, since every shopper would share one count.
   */
  @VisitorThrottle(60)
  @Get('search')
  @ZodResponse(searchResultsSchema)
  @ApiOperation({ summary: 'Products matching a query, best first' })
  search(
    @Query('q') q = '',
    @Query(new ZodPipe(catalogQuerySchema)) query: CatalogQuery,
  ): Promise<SearchResults> {
    return this.searchService.search({ q: searchQuerySchema.parse(q), query });
  }

  @Get('sitemap')
  @ZodResponse(sitemapFeedSchema)
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
  @ZodResponse(catalogCollectionSchema)
  @ApiOperation({ summary: 'One collection with a page of product cards' })
  collection(
    @Param('slug') slug: string,
    @Query(new ZodPipe(catalogQuerySchema)) query: CatalogQuery,
  ): Promise<CatalogCollection> {
    return this.catalog.collection(slug, query);
  }

  @Get('brands/:slug')
  @ZodResponse(catalogBrandSchema)
  @ApiOperation({ summary: 'One brand with a page of product cards' })
  brand(@Param('slug') slug: string, @Query(new ZodPipe(catalogQuerySchema)) query: CatalogQuery) {
    return this.catalog.brand(slug, query);
  }

  @Get('products/:slug')
  @ZodResponse(catalogProductWithRelatedSchema)
  @ApiOperation({ summary: 'One product with all its variants and prices' })
  product(
    @Param('slug') slug: string,
    @Query(new ZodPipe(catalogQuerySchema)) query: CatalogQuery,
  ): Promise<CatalogProductWithRelated> {
    return this.catalog.product(slug, query);
  }
}
