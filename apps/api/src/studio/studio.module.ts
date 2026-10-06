import { Module } from '@nestjs/common';

import { AdminModule } from '../admin/admin.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SupplierModule } from '../supplier/supplier.module.js';

import { StudioController } from './studio.controller.js';
import { StudioService } from './studio.service.js';

/** The article studio (CR-0006): ideas and AI-written draft articles. */
@Module({
  imports: [AuthModule, AdminModule, SupplierModule],
  controllers: [StudioController],
  providers: [StudioService],
})
export class StudioModule {}
