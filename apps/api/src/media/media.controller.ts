import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  type PatchImage,
  type ProductImages,
  type ReorderImages,
  type UploadImage,
  patchImageSchema,
  reorderImagesSchema,
  uploadImageSchema,
  productImagesSchema,
} from '@da/contracts';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodResponse } from '../common/openapi.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { MediaService } from './media.service.js';

/**
 * Product images, for staff.
 *
 * Reading is open to any staff role — a person working the fulfilment queue
 * has reason to look at what a product is — and every write is behind ADMIN or
 * CATALOG, the same pair that can already publish a product. A picture is
 * published content: it is the first thing a shopper sees and it goes out with
 * no review step.
 */
@ApiTags('admin')
@Controller('admin')
@UseGuards(StaffGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get('products/:slug/images')
  @ZodResponse(productImagesSchema)
  @ApiOperation({ summary: "A product's images, in display order" })
  list(@Param('slug') slug: string): Promise<ProductImages> {
    return this.media.list(slug);
  }

  /**
   * Adds one image.
   *
   * Returns the whole list rather than the new row: uploading can move the
   * hero and always changes the ordering, so a client that patched one item
   * into its own state would be wrong about the rest.
   */
  @Post('products/:slug/images')
  @ZodResponse(productImagesSchema)
  @Roles('ADMIN', 'CATALOG')
  @ApiOperation({ summary: 'Upload an image and attach it to the product' })
  upload(
    @Param('slug') slug: string,
    @Body(new ZodPipe(uploadImageSchema)) body: UploadImage,
    @Req() request: StaffRequest,
  ): Promise<ProductImages> {
    return this.media.upload(slug, body, request.staff?.sub);
  }

  @Patch('images/:id')
  @ZodResponse(productImagesSchema)
  @Roles('ADMIN', 'CATALOG')
  @ApiOperation({ summary: 'Set the hero, the order, the variant or the alt text' })
  patch(
    @Param('id') id: string,
    @Body(new ZodPipe(patchImageSchema)) body: PatchImage,
    @Req() request: StaffRequest,
  ): Promise<ProductImages> {
    return this.media.patch(id, body, request.staff?.sub);
  }

  @Patch('products/:slug/images/order')
  @ZodResponse(productImagesSchema)
  @Roles('ADMIN', 'CATALOG')
  @ApiOperation({ summary: 'Reorder a product’s images in one write' })
  reorder(
    @Param('slug') slug: string,
    @Body(new ZodPipe(reorderImagesSchema)) body: ReorderImages,
    @Req() request: StaffRequest,
  ): Promise<ProductImages> {
    return this.media.reorder(slug, body.ids, request.staff?.sub);
  }

  /**
   * Detaches an image from its product. The file is not deleted — see the
   * service for why an orphaned object is the cheaper mistake.
   */
  @Delete('images/:id')
  @ZodResponse(productImagesSchema)
  @Roles('ADMIN', 'CATALOG')
  @ApiOperation({ summary: 'Remove an image from the product' })
  remove(@Param('id') id: string, @Req() request: StaffRequest): Promise<ProductImages> {
    return this.media.remove(id, request.staff?.sub);
  }
}
