import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CatalogCollection,
  type CatalogProduct,
  type CatalogQuery,
  type Home,
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
