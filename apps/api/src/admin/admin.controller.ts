import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AdminProductList,
  type AdminProductQuery,
  type ProductCopy,
  type Readiness,
  type SetProductCopy,
  adminProductQuerySchema,
  setActivationStepsSchema,
  setCredentialKindSchema,
  setInventorySchema,
  setProductCopySchema,
  setStatusSchema,
} from '@da/contracts';
import { Locale } from '@da/db';
import { z } from 'zod';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { AdminService } from './admin.service.js';

/**
 * Everything here is behind StaffGuard, and writes are behind a role.
 *
 * READONLY exists so a marketer or an accountant can be given the panel
 * without the ability to change a price or publish a page.
 */
@ApiTags('admin')
@Controller('admin')
@UseGuards(StaffGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('products')
  @ApiOperation({ summary: 'Product list with publish readiness and stock' })
  products(
    @Query(new ZodPipe(adminProductQuerySchema)) query: AdminProductQuery,
  ): Promise<AdminProductList> {
    return this.admin.list(query);
  }

  @Get('products/:slug/readiness')
  @ApiOperation({ summary: 'Why a product can or cannot be published' })
  readiness(@Param('slug') slug: string, @Query('locale') locale = 'ar'): Promise<Readiness> {
    return this.admin.readiness(slug, locale);
  }

  @Roles('ADMIN', 'CATALOG')
  @Patch('products/:slug/status')
  @ApiOperation({ summary: 'Publish or unpublish. Refuses while a blocker stands.' })
  setStatus(
    @Param('slug') slug: string,
    @Body(new ZodPipe(setStatusSchema)) body: z.infer<typeof setStatusSchema>,
    @Req() request: StaffRequest,
  ) {
    return this.admin.setStatus(slug, body.status, body.locale, request.staff?.sub ?? '', {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Roles('ADMIN', 'CATALOG', 'FULFILLMENT')
  @Patch('variants/:sku/inventory')
  @ApiOperation({ summary: 'Set on-hand stock and record the movement' })
  setInventory(
    @Param('sku') sku: string,
    @Body(new ZodPipe(setInventorySchema)) body: z.infer<typeof setInventorySchema>,
    @Req() request: StaffRequest,
  ) {
    return this.admin.setInventory(
      sku,
      body.onHand,
      body.reason,
      body.note,
      request.staff?.sub ?? '',
      { ip: request.ip, userAgent: request.headers['user-agent'] },
    );
  }

  /**
   * Which of the two shapes a variant is delivered in.
   *
   * FULFILLMENT is not on this route: it changes how every future key for the
   * line is stored and labelled, which is a catalog decision rather than a
   * queue one.
   */
  @Roles('ADMIN', 'CATALOG')
  @Patch('variants/:sku/credential-kind')
  @ApiOperation({ summary: 'Deliver this variant as a key or as an account' })
  setCredentialKind(
    @Param('sku') sku: string,
    @Body(new ZodPipe(setCredentialKindSchema)) body: z.infer<typeof setCredentialKindSchema>,
    @Req() request: StaffRequest,
  ) {
    return this.admin.setCredentialKind(sku, body.credentialKind, request.staff?.sub ?? '', {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  /**
   * The copy the publish gate reads, per locale.
   *
   * Behind a role even to read it: a body and a meta description are not
   * secrets, but this is the same drawer that writes them, and READONLY exists
   * so an accountant can be given the panel without a path to the catalog.
   */
  @Roles('OWNER', 'ADMIN', 'CATALOG')
  @Get('products/:slug/copy')
  @ApiOperation({ summary: 'SEO title, meta description and body for one locale' })
  productCopy(@Param('slug') slug: string, @Query('locale') locale = 'ar'): Promise<ProductCopy> {
    return this.admin.productCopy(slug, locale);
  }

  @Roles('OWNER', 'ADMIN', 'CATALOG')
  @Patch('products/:slug/copy')
  @ApiOperation({ summary: 'Write the copy the gate refuses on, and re-assess' })
  setProductCopy(
    @Param('slug') slug: string,
    @Body(new ZodPipe(setProductCopySchema)) body: SetProductCopy,
    @Req() request: StaffRequest,
  ): Promise<ProductCopy> {
    return this.admin.setProductCopy(slug, body, request.staff?.sub ?? '', {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get('products/:slug/activation-steps')
  @ApiOperation({ summary: 'The activation how-to as it stands' })
  activationSteps(@Param('slug') slug: string, @Query('locale') locale = 'ar') {
    return this.admin.activationSteps(slug, locale);
  }

  @Roles('ADMIN', 'CATALOG')
  @Patch('products/:slug/activation-steps')
  @ApiOperation({ summary: 'The activation how-to sent with the licence email' })
  setActivationSteps(
    @Param('slug') slug: string,
    @Body(new ZodPipe(setActivationStepsSchema)) body: z.infer<typeof setActivationStepsSchema>,
    @Req() request: StaffRequest,
  ) {
    return this.admin.setActivationSteps(slug, body.locale, body.steps, request.staff?.sub ?? '', {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get('locales')
  @ApiOperation({ summary: 'Locales the admin can edit' })
  locales(): { code: string; label: string }[] {
    return [
      { code: Locale.AR.toLowerCase(), label: 'العربية' },
      { code: Locale.EN.toLowerCase(), label: 'English' },
    ];
  }
}
