import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CartQuery,
  type OfferCatalogOptions,
  type OfferStats,
  type OfferSuggestions,
  type OfferSuggestionsQuery,
  type OrderSuggestions,
  type SalePreview,
  type SalePreviewInput,
  cartQuerySchema,
  offerSuggestionsQuerySchema,
  salePreviewInputSchema,
} from '@da/contracts';
import type { FastifyRequest } from 'fastify';

import { AccountService } from '../account/account.service.js';
import { Roles, StaffGuard } from '../auth/staff.guard.js';
import { verifyOrderAccessKey } from '../common/order-link.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { OffersService } from './offers.service.js';

/** Suggestions for the storefront: public, and carrying nothing but cards. */
@ApiTags('offers')
@Controller('offers')
export class OffersPublicController {
  constructor(
    private readonly offers: OffersService,
    private readonly account: AccountService,
  ) {}

  @Get('suggestions')
  @ApiOperation({ summary: '"Goes well with" cards for products just added or in the cart' })
  suggestions(
    @Query(new ZodPipe(offerSuggestionsQuerySchema)) query: OfferSuggestionsQuery,
  ): Promise<OfferSuggestions> {
    // Slugs in, public cards out: nothing here says what anybody bought. The
    // order page uses `orders/:number` below, for the access key.
    return this.offers.suggestions(query.products, query.context, {
      locale: query.locale,
      currency: query.currency,
    });
  }

  /**
   * "Complete your setup" on a paid order, for whoever may open that order —
   * the same three proofs as the order page itself.
   */
  @Get('orders/:number')
  @ApiOperation({ summary: 'Suggestions for a paid order, with its link key' })
  async forOrder(
    @Param('number') number: string,
    @Query(new ZodPipe(cartQuerySchema)) query: CartQuery,
    @Query('key') key: string | undefined,
    @Req() request: FastifyRequest,
  ): Promise<OrderSuggestions> {
    if (verifyOrderAccessKey(number, key)) {
      return this.offers.forOrder(number, query, { skipOwnerCheck: true });
    }
    const session = await this.account.sessionFor(request.cookies?.da_customer);
    return this.offers.forOrder(number, query, {
      cartToken: request.cookies?.da_cart,
      customerId: session?.customerId,
    });
  }
}

/**
 * The offers and seasonal screens' helpers. Their settings themselves are
 * saved through the shared marketing settings route, which audits them.
 */
@ApiTags('admin')
@Controller('admin/marketing')
@UseGuards(StaffGuard)
@Roles('ADMIN', 'MARKETING')
export class OffersAdminController {
  constructor(private readonly offers: OffersService) {}

  @Get('offers/options')
  @ApiOperation({ summary: 'Products and categories for the offer and sale pickers' })
  options(): Promise<OfferCatalogOptions> {
    return this.offers.catalogOptions();
  }

  @Get('offers/stats')
  @ApiOperation({ summary: 'Paid orders in the last 30 days by volume tier, pair and sale' })
  stats(): Promise<OfferStats> {
    return this.offers.stats();
  }

  @Post('seasonal/preview')
  @ApiOperation({ summary: 'How many published products a sale scope would price' })
  preview(@Body(new ZodPipe(salePreviewInputSchema)) body: SalePreviewInput): Promise<SalePreview> {
    return this.offers.salePreview(body);
  }
}
