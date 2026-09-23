import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type PaymentSettings,
  type PaymentSettingsView,
  paymentSettingsSchema,
  paymentSettingsViewSchema,
} from '@da/contracts';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodResponse } from '../common/openapi.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { PaymentSettingsService } from './payment-settings.service.js';

/**
 * Where customer money is sent.
 *
 * OWNER and ADMIN only, and CATALOG deliberately absent even though the
 * neighbouring redirect screen lets it write. Naming a product and answering a
 * dead URL are content decisions; an IBAN is not content in the same sense —
 * changing it re-points every bank transfer the store takes from that moment,
 * and the customer has no way to tell that it changed.
 */
@ApiTags('admin')
@Controller('admin/payment-methods')
@UseGuards(StaffGuard)
@Roles('OWNER', 'ADMIN')
export class PaymentSettingsController {
  constructor(private readonly settings: PaymentSettingsService) {}

  @Get()
  @ZodResponse(paymentSettingsViewSchema)
  @ApiOperation({ summary: 'Manual payment details, and which methods they offer' })
  view(): Promise<PaymentSettingsView> {
    return this.settings.view();
  }

  /**
   * A whole-document write rather than a patch.
   *
   * The screen edits both methods at once and the object is small, so a PUT
   * cannot leave one field of an account behind from an older version of the
   * details — which is precisely the way a half-updated bank account routes
   * money to a closed one.
   */
  @Put()
  @ZodResponse(paymentSettingsViewSchema)
  @ApiOperation({ summary: 'Replace the manual payment details' })
  save(
    @Body(new ZodPipe(paymentSettingsSchema)) body: PaymentSettings,
    @Req() request: StaffRequest,
  ): Promise<PaymentSettingsView> {
    return this.settings.write(body, {
      staffId: request.staff?.sub ?? '',
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
