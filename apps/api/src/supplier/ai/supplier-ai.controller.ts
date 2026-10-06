import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AiCopyJob,
  type AiSectionJob,
  type GenerateSection,
  generateSectionSchema,
  type DraftProduct,
  type GenerateCopy,
  type SupplierAiModels,
  type SupplierAiSettings,
  type SupplierAiStatus,
  type SupplierAiTest,
  generateCopySchema,
  supplierAiSettingsSchema,
} from '@da/contracts';

import { Roles, StaffGuard, type StaffRequest } from '../../auth/staff.guard.js';
import { ZodPipe } from '../../common/zod.pipe.js';

import { SupplierAiService } from './supplier-ai.service.js';

/**
 * AI copy through OpenCode (CR-0004). Generating is catalogue work; choosing
 * the model and the house notes is ADMIN's, since it spends the owner's
 * OpenCode balance. Every call that reaches a model is a POST, so a crawler
 * or a prefetch never spends it.
 */
@ApiTags('admin')
@Controller('admin/supplier/ai')
@UseGuards(StaffGuard)
@Roles('ADMIN', 'CATALOG')
export class SupplierAiController {
  constructor(private readonly ai: SupplierAiService) {}

  @Get()
  @ApiOperation({ summary: 'AI settings and whether the OpenCode key is set' })
  status(): Promise<SupplierAiStatus> {
    return this.ai.status();
  }

  @Put()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Choose the model, protocol and house notes' })
  set(
    @Body(new ZodPipe(supplierAiSettingsSchema)) body: SupplierAiSettings,
    @Req() request: StaffRequest,
  ): Promise<SupplierAiStatus> {
    return this.ai.setSettings(body, {
      staffId: request.staff?.sub ?? '',
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get('models')
  @ApiOperation({ summary: "The models on the owner's OpenCode account" })
  models(): Promise<SupplierAiModels> {
    return this.ai.models();
  }

  @Post('test')
  @ApiOperation({ summary: 'One short call to the chosen model' })
  test(): Promise<SupplierAiTest> {
    return this.ai.test();
  }

  @Post('copy')
  @ApiOperation({ summary: 'Start generating product copy in the background (not saved)' })
  copy(@Body(new ZodPipe(generateCopySchema)) body: GenerateCopy): Promise<AiCopyJob> {
    return this.ai.startCopyJob(body);
  }

  @Get('copy/:id')
  @ApiOperation({ summary: 'A copy job: RUNNING, or DONE with the copy, or FAILED with why' })
  copyJob(@Param('id') id: string): Promise<AiCopyJob> {
    return this.ai.copyJob(id);
  }

  @Post('section')
  @ApiOperation({ summary: 'Start writing or improving one section of a product page (not saved)' })
  section(@Body(new ZodPipe(generateSectionSchema)) body: GenerateSection): Promise<AiSectionJob> {
    return this.ai.startSectionJob(body);
  }

  @Get('section/:id')
  @ApiOperation({ summary: 'A section job: RUNNING, DONE with the section, or FAILED with why' })
  sectionJob(@Param('id') id: string): Promise<AiSectionJob> {
    return this.ai.sectionJob(id);
  }

  @Post('draft/:itemId')
  @ApiOperation({ summary: 'Propose a new product from a sheet line (returned, not saved)' })
  draft(@Param('itemId') itemId: string): Promise<DraftProduct> {
    return this.ai.draftProduct(itemId);
  }
}
