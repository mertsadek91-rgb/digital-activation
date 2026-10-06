import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CardDefaults,
  type CardPreview,
  type CardSpecInput,
  type ProductImages,
  type SaveCard,
  cardSpecSchema,
  saveCardSchema,
} from '@da/contracts';

import { Roles, StaffGuard, type StaffRequest } from '../../auth/staff.guard.js';
import { ZodPipe } from '../../common/zod.pipe.js';

import { CardService } from './card.service.js';

/** The product card picture in the legacy template (CR-0004). */
@ApiTags('admin')
@Controller('admin/supplier/card')
@UseGuards(StaffGuard)
@Roles('ADMIN', 'CATALOG')
export class CardController {
  constructor(private readonly cards: CardService) {}

  @Get(':slug')
  @ApiOperation({ summary: "The card's default words, colour and logo for a product" })
  defaults(@Param('slug') slug: string): Promise<CardDefaults> {
    return this.cards.defaults(slug);
  }

  @Post(':slug/suggest')
  @ApiOperation({ summary: 'AI proposes the words on the card (not saved)' })
  suggest(
    @Param('slug') slug: string,
    @Body(new ZodPipe(cardSpecSchema)) body: CardSpecInput,
  ): Promise<CardSpecInput> {
    return this.cards.suggest(slug, body);
  }

  @Post(':slug/preview')
  @ApiOperation({ summary: 'Render the card (not saved)' })
  preview(
    @Param('slug') slug: string,
    @Body(new ZodPipe(cardSpecSchema)) body: CardSpecInput,
  ): Promise<CardPreview> {
    return this.cards.preview(slug, body);
  }

  @Post(':slug')
  @ApiOperation({ summary: "Render the card and add it to the product's images" })
  save(
    @Param('slug') slug: string,
    @Body(new ZodPipe(saveCardSchema)) body: SaveCard,
    @Req() request: StaffRequest,
  ): Promise<ProductImages> {
    return this.cards.save(slug, body, request.staff?.sub);
  }
}
