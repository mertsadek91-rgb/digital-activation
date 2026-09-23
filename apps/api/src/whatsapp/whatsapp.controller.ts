import crypto from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type WhatsappStatus,
  type WhatsappTest,
  type WhatsappTestResult,
  whatsappTestSchema,
} from '@da/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AuditService } from '../auth/audit.service.js';
import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { MarketingSettingsService } from '../marketing/marketing-settings.service.js';
import { formatDate, storefrontUrl } from '../retention/links.js';
import { storeTimeZone } from '../retention/rules.js';

import { buttonSuffix, verifyMetaSignature } from './rules.js';
import { cartRecoveryParams, renewalParams } from './templates.js';
import { TEST_TEMPLATE, type WebhookBody, WhatsappService } from './whatsapp.service.js';

/**
 * Meta's webhook: the subscription handshake and the event deliveries.
 *
 * Not throttled, like the Stripe webhook: Meta retries anything that is not a
 * quick 200, and rate limiting its retries would turn a burst of read
 * receipts into a retry storm.
 */
@ApiTags('webhooks')
@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  constructor(private readonly whatsapp: WhatsappService) {}

  /**
   * The handshake Meta performs when the webhook URL is saved: it sends the
   * verify token it was given and expects the challenge back as plain text.
   */
  @Get()
  @ApiOperation({ summary: 'WhatsApp webhook verification' })
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): string {
    const expected = this.whatsapp.verifyToken;
    if (!expected) throw new ServiceUnavailableException('WHATSAPP_VERIFY_TOKEN is not set.');
    if (mode !== 'subscribe' || !token || !challenge || !sameSecret(token, expected)) {
      throw new ForbiddenException('Verification failed.');
    }
    void reply.type('text/plain');
    return challenge;
  }

  /**
   * Status callbacks and inbound messages.
   *
   * The signature is checked over the raw bytes before anything is read, and
   * there is no path around it: this endpoint can withdraw a customer's
   * consent, so an unsigned request is refused, not tolerated.
   */
  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'WhatsApp status and message events' })
  async receive(
    @Req() request: FastifyRequest & { rawBody?: Buffer },
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: WebhookBody,
  ): Promise<{ received: true }> {
    const secret = this.whatsapp.appSecret;
    if (!secret) throw new ServiceUnavailableException('WHATSAPP_APP_SECRET is not set.');
    const raw = request.rawBody;
    if (!raw) throw new BadRequestException('Raw body unavailable.');
    if (!verifyMetaSignature(raw, signature, secret)) {
      throw new ForbiddenException('Bad signature.');
    }
    if (body.object === 'whatsapp_business_account') {
      await this.whatsapp.handleWebhook(body);
    }
    return { received: true };
  }
}

/**
 * The admin screen's connection status and its test send.
 */
@ApiTags('admin')
@Controller('admin/marketing/whatsapp')
@UseGuards(StaffGuard)
@Roles('ADMIN', 'MARKETING')
export class WhatsappAdminController {
  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly settings: MarketingSettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Which credentials are present — as yes or no, never their values. */
  @Get('status')
  @ApiOperation({ summary: 'WhatsApp connection status and the last 30 days' })
  async status(): Promise<WhatsappStatus> {
    const apiBase = process.env.API_PUBLIC_URL ?? process.env.NEXT_PUBLIC_API_URL;
    return {
      configured: this.whatsapp.configured,
      accessToken: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
      phoneNumberId: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
      appSecret: Boolean(process.env.WHATSAPP_APP_SECRET),
      verifyToken: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
      webhookUrl: apiBase ? new URL('/v1/webhooks/whatsapp', apiBase).toString() : null,
      stats: await this.whatsapp.stats(),
    };
  }

  /**
   * Sends the configured template to one number, with sample values.
   *
   * ADMIN only, throttled and audited: it messages a real phone from the
   * store's WhatsApp number, and Meta rates the number on what it sends.
   */
  @Post('test')
  @Roles('ADMIN')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a WhatsApp template to one number as a test' })
  async test(
    @Body(new ZodPipe(whatsappTestSchema)) body: WhatsappTest,
    @Req() request: StaffRequest,
  ): Promise<WhatsappTestResult> {
    if (!this.whatsapp.configured) {
      throw new BadRequestException(
        'WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are not set.',
      );
    }
    const settings = await this.settings.get('whatsapp');
    const template = body.purpose === 'cartRecovery' ? settings.cartRecovery : settings.renewal;
    if (!template.templateName) {
      throw new BadRequestException('No template name is saved for this purpose.');
    }
    const locale = body.locale;
    const sample = locale === 'ar' ? 'منتج تجريبي' : 'Sample product';
    const params =
      body.purpose === 'cartRecovery'
        ? cartRecoveryParams({
            locale,
            firstName: null,
            productNames: [sample],
            total: '0.00',
            offer: null,
          })
        : renewalParams({
            locale,
            firstName: null,
            productName: sample,
            expiresOn: formatDate(new Date(Date.now() + 14 * 86_400_000), locale, storeTimeZone()),
            offsetDays: 14,
          });

    const result = await this.whatsapp.sendTemplate({
      to: body.to,
      template: template.templateName,
      language: locale === 'ar' ? template.languageAr : template.languageEn,
      bodyParams: params,
      buttonUrlSuffix: buttonSuffix(storefrontUrl('/cart', locale)),
      log: { template: TEST_TEMPLATE, locale, payload: { purpose: body.purpose } },
    });

    await this.audit.record({
      actorId: request.staff?.sub,
      entity: 'Setting',
      entityId: 'marketing.whatsapp',
      action: 'whatsapp.test-sent',
      // The purpose and outcome, and the number's last digits only: the audit
      // log is read by more people than the customer list is.
      after: {
        purpose: body.purpose,
        locale,
        to: `…${body.to.slice(-4)}`,
        ok: result.ok,
        error: result.error,
      },
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return { ok: result.ok, messageId: result.messageId, error: result.error };
  }
}

function sameSecret(given: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
