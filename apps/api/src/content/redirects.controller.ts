import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type RedirectsView, createRedirectSchema, updateRedirectSchema } from '@da/contracts';
import type { z } from 'zod';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { RedirectsService } from './redirects.service.js';

/**
 * The redirect map and the 404 log, for staff.
 *
 * CATALOG is on the writes beside ADMIN: answering a dead URL is the same kind
 * of work as naming a product, and making it wait for an administrator is how
 * a 404 stays a 404 for a month.
 */
@ApiTags('admin')
@Controller('admin/redirects')
@UseGuards(StaffGuard)
export class RedirectsController {
  constructor(private readonly redirects: RedirectsService) {}

  @Get()
  @ApiOperation({ summary: 'The redirect map and the unanswered 404s' })
  view(@Query('limit') limit?: string): Promise<RedirectsView> {
    return this.redirects.view(
      Math.min(500, Math.max(1, Number.parseInt(limit ?? '200', 10) || 200)),
    );
  }

  @Roles('OWNER', 'ADMIN', 'CATALOG')
  @Post()
  @ApiOperation({ summary: 'Answer a dead URL by hand' })
  create(
    @Body(new ZodPipe(createRedirectSchema)) body: z.infer<typeof createRedirectSchema>,
    @Req() request: StaffRequest,
  ) {
    return this.redirects.create({ ...body, staffId: request.staff?.sub ?? '' });
  }

  @Roles('OWNER', 'ADMIN', 'CATALOG')
  @Patch(':id')
  @ApiOperation({ summary: 'Change where a redirect points, or switch it off' })
  update(
    @Param('id') id: string,
    @Body(new ZodPipe(updateRedirectSchema)) body: z.infer<typeof updateRedirectSchema>,
  ) {
    return this.redirects.update({ id, ...body });
  }

  @Roles('OWNER', 'ADMIN')
  @Delete(':id')
  @ApiOperation({ summary: 'Remove a redirect entirely' })
  remove(@Param('id') id: string) {
    return this.redirects.remove(id);
  }

  @Roles('OWNER', 'ADMIN', 'CATALOG')
  @Post('not-found/:id/resolve')
  @ApiOperation({ summary: 'Dismiss a 404 without writing a redirect' })
  resolve(@Param('id') id: string) {
    return this.redirects.resolveNotFound(id);
  }
}
