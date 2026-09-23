import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  type CreateProduct,
  type CreateVariant,
  type CreatedProduct,
  type ProductIdentity,
  type ProductTerms,
  type SetProductIdentity,
  type SetVariantTerms,
  createProductSchema,
  createVariantSchema,
  setProductIdentitySchema,
  setVariantTermsSchema,
  createdProductSchema,
  productTermsSchema,
  productIdentitySchema,
} from '@da/contracts';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodResponse } from '../common/openapi.js';
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

  /**
   * A new product and the one variant that makes it one.
   *
   * OWNER and ADMIN only, one role narrower than editing. Adding a row to the
   * catalog is not the same decision as correcting a price on a row that is
   * already there, and CATALOG is the role for the second.
   */
  @Post('products')
  @ZodResponse(createdProductSchema)
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create a draft product with its first variant' })
  create(
    @Body(new ZodPipe(createProductSchema)) body: CreateProduct,
    @Req() request: StaffRequest,
  ): Promise<CreatedProduct> {
    return this.edit.createProduct(body, request.staff?.sub);
  }

  @Post('products/:slug/variants')
  @ZodResponse(productTermsSchema)
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Add another variant to an existing product' })
  addVariant(
    @Param('slug') slug: string,
    @Body(new ZodPipe(createVariantSchema)) body: CreateVariant,
    @Req() request: StaffRequest,
  ): Promise<ProductTerms> {
    return this.edit.createVariant(slug, body, request.staff?.sub);
  }

  @Get('products/:slug/identity')
  @ZodResponse(productIdentitySchema)
  @ApiOperation({ summary: 'Name, slug, kind, brand and categories' })
  identity(@Param('slug') slug: string): Promise<ProductIdentity> {
    return this.edit.identity(slug);
  }

  @Patch('products/:slug/identity')
  @ZodResponse(productIdentitySchema)
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
  @ZodResponse(productTermsSchema)
  @ApiOperation({ summary: 'Price and licence terms for every variant' })
  terms(@Param('slug') slug: string): Promise<ProductTerms> {
    return this.edit.terms(slug);
  }

  @Patch('variants/:sku/terms')
  @ZodResponse(productTermsSchema)
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
