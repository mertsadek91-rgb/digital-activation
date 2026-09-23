import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type ContactList, setContactStatusSchema, contactListSchema } from '@da/contracts';
import type { z } from 'zod';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodResponse } from '../common/openapi.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { ContactService } from './contact.service.js';

/**
 * The inbox, for staff.
 *
 * SUPPORT is on both routes and is the reason the role exists: answering
 * customers should not require the ability to publish a product or read a
 * licence key. READONLY can look and cannot mark anything, which is what a
 * read-only role is for.
 */
@ApiTags('admin')
@Controller('admin/contact')
@UseGuards(StaffGuard)
export class ContactAdminController {
  constructor(private readonly contact: ContactService) {}

  // Names, email addresses and whatever people wrote: support's inbox, not
  // something every staff role pages through.
  @Roles('ADMIN', 'SUPPORT')
  @Get()
  @ZodResponse(contactListSchema)
  @ApiOperation({ summary: 'Messages from the contact form, unanswered first' })
  list(
    @Query('includeHandled') includeHandled?: string,
    @Query('limit') limit?: string,
  ): Promise<ContactList> {
    return this.contact.list({
      includeHandled: includeHandled === 'true',
      limit: Math.min(200, Math.max(1, Number.parseInt(limit ?? '50', 10) || 50)),
    });
  }

  @Roles('OWNER', 'ADMIN', 'SUPPORT')
  @Patch(':id/status')
  @ApiOperation({ summary: 'Mark a message answered, or put it back' })
  setStatus(
    @Param('id') id: string,
    @Body(new ZodPipe(setContactStatusSchema)) body: z.infer<typeof setContactStatusSchema>,
    @Req() request: StaffRequest,
  ) {
    return this.contact.setStatus({
      id,
      status: body.status,
      staffId: request.staff?.sub ?? '',
    });
  }
}
