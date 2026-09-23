import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type Pagination,
  type ProductReviews,
  paginationSchema,
  productReviewsSchema,
} from '@da/contracts';

import { ZodResponse } from '../common/openapi.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { ReviewsService } from './reviews.service.js';

/**
 * Published reviews, for anybody.
 *
 * Read-only, and the only review route with no session behind it. Writing one
 * is an account action and lives in the account module, because the thing that
 * makes a review possible is an order line and the thing that proves the line
 * is yours is the cookie.
 */
@ApiTags('catalog')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('products/:slug')
  @ZodResponse(productReviewsSchema)
  @ApiOperation({ summary: 'Approved reviews for one product, with the aggregate' })
  forProduct(
    @Param('slug') slug: string,
    @Query(new ZodPipe(paginationSchema)) query: Pagination,
  ): Promise<ProductReviews> {
    return this.reviews.forProduct(slug, query.page, query.perPage);
  }
}
