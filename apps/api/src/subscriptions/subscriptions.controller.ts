import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type NewsletterConfirm,
  type NewsletterSubscribe,
  type NewsletterToken,
  type StockAlertRequest,
  newsletterConfirmSchema,
  newsletterSubscribeSchema,
  newsletterTokenSchema,
  stockAlertSchema,
} from '@da/contracts';

import { ZodPipe } from '../common/zod.pipe.js';

import { SubscriptionsService } from './subscriptions.service.js';

/**
 * Called from the browser, so the address limits are per visitor. Tight on
 * the two that send mail to an unverified address, for the same reason the
 * contact form is: an endpoint that emails whatever it is given is a way to
 * aim the store's domain at a stranger's inbox.
 */
@ApiTags('subscriptions')
@Controller()
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('stock-alerts')
  @HttpCode(202)
  @ApiOperation({ summary: 'Ask to be emailed when a variant is back in stock' })
  stockAlert(@Body(new ZodPipe(stockAlertSchema)) body: StockAlertRequest): Promise<{ ok: true }> {
    return this.subscriptions.requestStockAlert(body);
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('newsletter')
  @HttpCode(202)
  @ApiOperation({ summary: 'Send a newsletter confirmation email' })
  subscribe(
    @Body(new ZodPipe(newsletterSubscribeSchema)) body: NewsletterSubscribe,
  ): Promise<{ ok: true }> {
    return this.subscriptions.subscribe(body);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('newsletter/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm a newsletter subscription from the emailed link' })
  confirm(
    @Body(new ZodPipe(newsletterConfirmSchema)) body: NewsletterConfirm,
  ): Promise<{ ok: true }> {
    return this.subscriptions.confirm(body.token, body.locale);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('newsletter/unsubscribe')
  @HttpCode(200)
  @ApiOperation({ summary: 'Withdraw newsletter consent from a signed link' })
  unsubscribe(
    @Body(new ZodPipe(newsletterTokenSchema)) body: NewsletterToken,
  ): Promise<{ ok: true }> {
    return this.subscriptions.unsubscribe(body.token);
  }
}
