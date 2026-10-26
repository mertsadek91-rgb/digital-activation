import { Module } from '@nestjs/common';

import { AdminModule } from '../admin/admin.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';
import { SupplierModule } from '../supplier/supplier.module.js';

import { ProductAgentController } from './product-agent.controller.js';
import { ProductAgentRunner } from './product-agent.runner.js';
import { ProductAgentService } from './product-agent.service.js';
import { ProductAgentWorker } from './product-agent.worker.js';

/**
 * The product agent (CR-0007): batches of products rewritten, or created
 * from supplier lines, by AI in the background — through the same services
 * the panel's editors write with.
 */
@Module({
  imports: [AuthModule, AdminModule, SupplierModule, MediaModule],
  controllers: [ProductAgentController],
  providers: [ProductAgentService, ProductAgentRunner, ProductAgentWorker],
})
export class ProductAgentModule {}
