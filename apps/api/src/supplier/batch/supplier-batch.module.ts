import { Module } from '@nestjs/common';

import { AdminModule } from '../../admin/admin.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { SupplierModule } from '../supplier.module.js';

import { SupplierBatchController } from './supplier-batch.controller.js';
import { SupplierBatchService } from './supplier-batch.service.js';

/**
 * One-click AI products from sheet lines (TASK-0150). Its own module because
 * it composes the supplier and the catalog editors, and neither of those
 * modules should import the other.
 */
@Module({
  imports: [AuthModule, AdminModule, SupplierModule],
  controllers: [SupplierBatchController],
  providers: [SupplierBatchService],
  exports: [SupplierBatchService],
})
export class SupplierBatchModule {}
