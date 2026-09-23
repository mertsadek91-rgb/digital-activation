import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  type AdminCategoryList,
  type CreateCategory,
  type CreateProductLink,
  type ProductLinks,
  type SetCategory,
  createCategorySchema,
  createProductLinkSchema,
  setCategorySchema,
  adminCategoryListSchema,
  productLinksSchema,
} from '@da/contracts';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodResponse } from '../common/openapi.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { TaxonomyService } from './taxonomy.service.js';

/**
 * Sections, and the links between products.
 *
 * Reading is open to any staff role; writing is ADMIN or CATALOG, the same
 * pair that publishes a product. A section is a public page and a link between
 * products is a recommendation the shop makes in its own name.
 */
@ApiTags('admin')
@Controller('admin')
@UseGuards(StaffGuard)
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get('categories')
  @ZodResponse(adminCategoryListSchema)
  @ApiOperation({ summary: 'Every section, with how many published products it holds' })
  categories(): Promise<AdminCategoryList> {
    return this.taxonomy.categories();
  }

  @Post('categories')
  @ZodResponse(adminCategoryListSchema)
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Create a section' })
  create(
    @Body(new ZodPipe(createCategorySchema)) body: CreateCategory,
    @Req() request: StaffRequest,
  ): Promise<AdminCategoryList> {
    return this.taxonomy.createCategory(body, request.staff?.sub);
  }

  @Patch('categories/:id')
  @ZodResponse(adminCategoryListSchema)
  @Roles('ADMIN', 'CATALOG')
  @ApiOperation({ summary: 'Rename, move or reorder a section; a slug change writes its 301' })
  update(
    @Param('id') id: string,
    @Body(new ZodPipe(setCategorySchema)) body: SetCategory,
    @Req() request: StaffRequest,
  ): Promise<AdminCategoryList> {
    return this.taxonomy.setCategory(id, body, request.staff?.sub);
  }

  @Get('products/:slug/links')
  @ZodResponse(productLinksSchema)
  @ApiOperation({ summary: 'Products this one is linked to' })
  links(@Param('slug') slug: string): Promise<ProductLinks> {
    return this.taxonomy.links(slug);
  }

  @Post('products/:slug/links')
  @ZodResponse(productLinksSchema)
  @Roles('ADMIN', 'CATALOG')
  @ApiOperation({ summary: 'Link another product to this one' })
  addLink(
    @Param('slug') slug: string,
    @Body(new ZodPipe(createProductLinkSchema)) body: CreateProductLink,
    @Req() request: StaffRequest,
  ): Promise<ProductLinks> {
    return this.taxonomy.addLink(slug, body, request.staff?.sub);
  }

  @Delete('links/:id')
  @ZodResponse(productLinksSchema)
  @Roles('ADMIN', 'CATALOG')
  @ApiOperation({ summary: 'Remove a link' })
  removeLink(@Param('id') id: string, @Req() request: StaffRequest): Promise<ProductLinks> {
    return this.taxonomy.removeLink(id, request.staff?.sub);
  }
}
