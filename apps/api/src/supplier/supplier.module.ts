import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { MediaModule } from '../media/media.module.js';

import { SupplierAiController } from './ai/supplier-ai.controller.js';
import { SupplierAiService } from './ai/supplier-ai.service.js';
import { CardController } from './card/card.controller.js';
import { CardService } from './card/card.service.js';
import { SupplierSyncService } from './supplier-sync.service.js';
import { SupplierController } from './supplier.controller.js';
import { SupplierService } from './supplier.service.js';

/**
 * The supplier price sheet (CR-0004): sync, mapping and price proposals, AI
 * product copy through OpenCode, and the product card picture.
 */
@Module({
  imports: [AuthModule, MediaModule],
  controllers: [SupplierController, SupplierAiController, CardController],
  providers: [SupplierService, SupplierSyncService, SupplierAiService, CardService],
  exports: [SupplierService, SupplierSyncService, SupplierAiService],
})
export class SupplierModule {}
