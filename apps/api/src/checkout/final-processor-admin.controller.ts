import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type AdminFpConnectResult,
  type AdminFpEventList,
  type AdminFpOverview,
  type UpdateFpMethod,
  adminFpConnectResultSchema,
  adminFpEventListSchema,
  adminFpOverviewSchema,
  fpMethodIdSchema,
  updateFpMethodSchema,
} from '@da/contracts';

import { AuditService } from '../auth/audit.service.js';
import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodResponse } from '../common/openapi.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { FinalProcessorService, fpAdminMessage, fpErrorCode } from './final-processor.service.js';
import { FpPaymentsService } from './fp-payments.service.js';
import { PaymentSettingsService } from './payment-settings.service.js';

/**
 * Final Processor in the panel: connection (B.2), methods (B.3) and the
 * notification log (B.5).
 *
 * OWNER and ADMIN only, for reading too — the same gate as the bank details
 * beside it (`PaymentSettingsController`): which methods take money, and where
 * the processor sends its webhooks, are decisions about where customer money
 * goes. The site secret is never returned, not even masked.
 */
@ApiTags('admin')
@Controller('admin/payments/final-processor')
@UseGuards(StaffGuard)
@Roles('OWNER', 'ADMIN')
export class FinalProcessorAdminController {
  constructor(
    private readonly settings: PaymentSettingsService,
    private readonly fp: FinalProcessorService,
    private readonly payments: FpPaymentsService,
    private readonly audit: AuditService,
  ) {}

  /** `?refresh=1` asks the processor again instead of using the five-minute cache. */
  @Get()
  @ZodResponse(adminFpOverviewSchema)
  @ApiOperation({ summary: 'Final Processor: configuration, connection and methods' })
  overview(@Query('refresh') refresh?: string): Promise<AdminFpOverview> {
    return this.settings.finalProcessorOverview({ fresh: refresh === '1' || refresh === 'true' });
  }

  /**
   * "Test connection": registers the webhook URL with the processor and checks
   * the keys. Always 200 — a failure is an answer with its code explained.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('connect')
  @ZodResponse(adminFpConnectResultSchema)
  @ApiOperation({ summary: 'Register the webhook URL with Final Processor and check the keys' })
  async connect(@Req() request: StaffRequest): Promise<AdminFpConnectResult> {
    let answer: AdminFpConnectResult;
    try {
      const result = await this.fp.connect();
      answer = {
        connected: true,
        site: { siteId: result.site.site_id, name: result.site.name },
        webhookUrl: result.webhookUrl,
        currencies: result.currencies,
        methods: result.methods.map((method) => ({
          id: method.id,
          label: method.label,
          currencies: method.currencies,
          testMode: method.test_mode,
        })),
        testMode: result.methods.some((method) => method.test_mode),
      };
    } catch (error) {
      const code = fpErrorCode(error);
      answer = { connected: false, errorCode: code, message: fpAdminMessage(code) };
    }
    await this.audit.record({
      actorId: request.staff?.sub,
      entity: 'Setting',
      entityId: 'final-processor',
      action: 'payment.fp.connect',
      after: answer.connected
        ? { connected: true, webhookUrl: answer.webhookUrl }
        : { connected: false, errorCode: answer.errorCode },
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return answer;
  }

  @Put('methods/:id')
  @ZodResponse(adminFpOverviewSchema)
  @ApiOperation({ summary: 'Customise how one Final Processor method appears in this shop' })
  saveMethod(
    @Param('id', new ZodPipe(fpMethodIdSchema)) id: string,
    @Body(new ZodPipe(updateFpMethodSchema)) body: UpdateFpMethod,
    @Req() request: StaffRequest,
  ): Promise<AdminFpOverview> {
    return this.settings.saveFinalProcessorMethod(id, body, {
      staffId: request.staff?.sub ?? '',
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get('events')
  @ZodResponse(adminFpEventListSchema)
  @ApiOperation({ summary: 'Processed Final Processor webhooks, newest first (30 days)' })
  events(@Query('page') page?: string): Promise<AdminFpEventList> {
    return this.payments.events(Math.max(1, Number.parseInt(page ?? '1', 10) || 1));
  }
}
