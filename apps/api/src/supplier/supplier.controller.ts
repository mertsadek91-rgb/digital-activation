import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type ApplySupplierPrices,
  type ApplySupplierPricesResult,
  type SetManualStock,
  type SetSupplierLink,
  type SetSupplierSource,
  type SetVariantMarkup,
  type SetVariantMarkupResult,
  type SupplierItems,
  type SupplierItemsQuery,
  type SupplierLog,
  type SupplierMapping,
  type SupplierMappingQuery,
  type SupplierMappingRow,
  type SupplierPrices,
  type SupplierSourceView,
  type SupplierSyncResult,
  type SupplierUploadInput,
  applySupplierPricesSchema,
  linkBySkuSchema,
  setManualStockSchema,
  setSupplierLinkSchema,
  setSupplierSourceSchema,
  setVariantMarkupSchema,
  supplierItemsQuerySchema,
  supplierLogQuerySchema,
  supplierMappingQuerySchema,
  supplierSyncInputSchema,
  supplierUploadInputSchema,
} from '@da/contracts';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { SupplierService } from './supplier.service.js';

function actor(request: StaffRequest) {
  return {
    staffId: request.staff?.sub ?? '',
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  };
}

/**
 * The supplier price sheet (CR-0004).
 *
 * Reading, syncing and linking are catalogue work (ADMIN, CATALOG). Changing
 * the sheet, the markup and applying prices is money, so ADMIN only — OWNER
 * always passes.
 */
@ApiTags('admin')
@Controller('admin/supplier')
@UseGuards(StaffGuard)
@Roles('ADMIN', 'CATALOG')
export class SupplierController {
  constructor(private readonly supplier: SupplierService) {}

  @Get('source')
  @ApiOperation({ summary: 'The connected supplier sheet and its settings, or null' })
  source(): Promise<SupplierSourceView | null> {
    return this.supplier.source();
  }

  @Put('source')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Connect the supplier sheet, or change its markup and sync settings' })
  setSource(
    @Body(new ZodPipe(setSupplierSourceSchema)) body: SetSupplierSource,
    @Req() request: StaffRequest,
  ): Promise<SupplierSourceView> {
    return this.supplier.setSource(body, actor(request));
  }

  @Post('sync')
  @ApiOperation({ summary: 'Read the supplier sheet now' })
  sync(
    @Body(new ZodPipe(supplierSyncInputSchema)) body: { force: boolean },
    @Req() request: StaffRequest,
  ): Promise<SupplierSyncResult> {
    // Overriding the sync's safety refusals is ADMIN's (OWNER passes).
    const role = request.staff?.role;
    if (body.force && role !== 'ADMIN' && role !== 'OWNER') {
      throw new ForbiddenException('Only an admin can apply a refused read.');
    }
    return this.supplier.syncNow(actor(request), body.force);
  }

  @Post('upload')
  @ApiOperation({ summary: 'Read the supplier list from an uploaded .xlsx (base64)' })
  upload(
    @Body(new ZodPipe(supplierUploadInputSchema)) body: SupplierUploadInput,
    @Req() request: StaffRequest,
  ): Promise<SupplierSyncResult> {
    // The same rule as the sync: only an admin applies a refused read.
    const role = request.staff?.role;
    if (body.force && role !== 'ADMIN' && role !== 'OWNER') {
      throw new ForbiddenException('Only an admin can apply a refused read.');
    }
    return this.supplier.uploadNow(actor(request), body);
  }

  @Get('items')
  @ApiOperation({ summary: 'Every line read from the sheet, filtered' })
  items(
    @Query(new ZodPipe(supplierItemsQuerySchema)) query: SupplierItemsQuery,
  ): Promise<SupplierItems> {
    return this.supplier.items(query);
  }

  @Get('log')
  @ApiOperation({ summary: 'Syncs, sheet changes and the actions taken on them' })
  log(
    @Query(new ZodPipe(supplierLogQuerySchema)) query: { itemId?: string; limit: number },
  ): Promise<SupplierLog> {
    return this.supplier.log(query);
  }

  @Get('mapping')
  @ApiOperation({ summary: 'Our variants with their sheet line, or suggestions' })
  mapping(
    @Query(new ZodPipe(supplierMappingQuerySchema)) query: SupplierMappingQuery,
  ): Promise<SupplierMapping> {
    return this.supplier.mapping(query);
  }

  @Put('links/:variantId')
  @ApiOperation({ summary: 'Link a variant to a sheet line' })
  setLink(
    @Param('variantId') variantId: string,
    @Body(new ZodPipe(setSupplierLinkSchema)) body: SetSupplierLink,
    @Req() request: StaffRequest,
  ): Promise<SupplierMappingRow> {
    // Linking is catalogue work; a variant's own markup is money, like the
    // source's markup, so it is ADMIN's (OWNER passes). Sending a markup at
    // all, a number or a blank that clears one, changes it; omitting it keeps
    // the link's markup as it is (TASK-0137).
    const role = request.staff?.role;
    if (body.markupPercent !== undefined && role !== 'ADMIN' && role !== 'OWNER') {
      throw new ForbiddenException('Only an admin can set or clear a markup.');
    }
    return this.supplier.setLink(variantId, body, actor(request));
  }

  @Put('items/:itemId/link-sku')
  @ApiOperation({ summary: 'Link a sheet line to a variant by SKU (after creating it)' })
  linkBySku(
    @Param('itemId') itemId: string,
    @Body(new ZodPipe(linkBySkuSchema)) body: { sku: string },
    @Req() request: StaffRequest,
  ): Promise<SupplierMappingRow> {
    return this.supplier.linkBySku(itemId, body.sku, actor(request));
  }

  @Delete('links/:variantId')
  @ApiOperation({ summary: 'Unlink a variant from the sheet' })
  removeLink(
    @Param('variantId') variantId: string,
    @Req() request: StaffRequest,
  ): Promise<SupplierMappingRow> {
    // Unlinking drops the link's own markup, so with one it is ADMIN's
    // (OWNER passes), like changing it (TASK-0138).
    const role = request.staff?.role;
    return this.supplier.removeLink(variantId, actor(request), {
      mayChangeMarkup: role === 'ADMIN' || role === 'OWNER',
    });
  }

  @Put('skips/:variantId')
  @ApiOperation({ summary: 'Mark a variant as not sold by this supplier (hidden from linking)' })
  skip(
    @Param('variantId') variantId: string,
    @Req() request: StaffRequest,
  ): Promise<SupplierMappingRow> {
    return this.supplier.setSkipped(variantId, true, actor(request));
  }

  @Delete('skips/:variantId')
  @ApiOperation({ summary: 'Put a skipped variant back into linking' })
  unskip(
    @Param('variantId') variantId: string,
    @Req() request: StaffRequest,
  ): Promise<SupplierMappingRow> {
    return this.supplier.setSkipped(variantId, false, actor(request));
  }

  @Put('stock/:variantId')
  @ApiOperation({ summary: 'Mark a variant out of stock by hand, or back in stock' })
  setStock(
    @Param('variantId') variantId: string,
    @Body(new ZodPipe(setManualStockSchema)) body: SetManualStock,
    @Req() request: StaffRequest,
  ): Promise<SupplierMappingRow> {
    return this.supplier.setManualStock(variantId, body.outOfStock, actor(request));
  }

  @Get('prices')
  @ApiOperation({ summary: 'Price proposals from cost × (1 + markup)' })
  prices(): Promise<SupplierPrices> {
    return this.supplier.prices();
  }

  @Put('prices/:variantId/markup')
  @Roles('ADMIN')
  @ApiOperation({ summary: "Set a variant's own markup, from a percentage or a wanted price" })
  setMarkup(
    @Param('variantId') variantId: string,
    @Body(new ZodPipe(setVariantMarkupSchema)) body: SetVariantMarkup,
    @Req() request: StaffRequest,
  ): Promise<SetVariantMarkupResult> {
    return this.supplier.setMarkup(variantId, body, actor(request));
  }

  @Post('prices/apply')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Apply price proposals to one, some or all linked variants' })
  apply(
    @Body(new ZodPipe(applySupplierPricesSchema)) body: ApplySupplierPrices,
    @Req() request: StaffRequest,
  ): Promise<ApplySupplierPricesResult> {
    return this.supplier.applyPrices(body, actor(request));
  }
}
