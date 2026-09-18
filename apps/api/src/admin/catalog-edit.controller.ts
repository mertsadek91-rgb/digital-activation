import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  type ProductIdentity,
  type ProductTerms,
  type SetProductIdentity,
  type SetVariantTerms,
  setProductIdentitySchema,
  setVariantTermsSchema,
} from '@da/contracts';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { CatalogEditService } from './catalog-edit.service.js';

/**
 * What a product is, and what it costs.
 *
 * Writes are ADMIN or CATALOG — the pair that can already publish — because
 * every field behind these routes is either a public promise or a public URL.
 * `costUsd` is the one exception in the other direction: it is what the shop
 * paid, it is returned here, and no storefront endpoint has ever exposed it.
 */
@ApiTags('admin')
@Controller('admin')
@UseGuards(StaffGuard)
export class CatalogEditController {
  constructor(private readonly edit: CatalogEditService) {}

  @Get('products/:slug/identity')
  @ApiOperation({ summary: 'Name, slug, kind, brand and categories' })
  identity(@Param('slug') slug: string): Promise<ProductIdentity> {
    return this.edit.identity(slug);
  }

  @Patch('products/:slug/identity')
  @Roles('ADMIN', 'CATALOG')
  @ApiOperation({ summary: 'Change identity; a slug change also writes its 301' })
  setIdentity(
    @Param('slug') slug: string,
    @Body(new ZodPipe(setProductIdentitySchema)) body: SetProductIdentity,
    @Req() request: StaffRequest,
  ): Promise<ProductIdentity> {
    return this.edit.setIdentity(slug, body, request.staff?.sub);
  }

  @Get('products/:slug/terms')
  @ApiOperation({ summary: 'Price and licence terms for every variant' })
  terms(@Param('slug') slug: string): Promise<ProductTerms> {
    return this.edit.terms(slug);
  }

  @Patch('variants/:sku/terms')
  @Roles('ADMIN', 'CATALOG')
  @ApiOperation({ summary: 'Change one variant’s price and licence terms' })
  setTerms(
    @Param('sku') sku: string,
    @Body(new ZodPipe(setVariantTermsSchema)) body: SetVariantTerms,
    @Req() request: StaffRequest,
  ): Promise<ProductTerms> {
    return this.edit.setTerms(sku, body, request.staff?.sub);
  }
}
