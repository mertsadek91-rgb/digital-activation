import { Module } from '@nestjs/common';

import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { SearchService } from './search.service.js';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, SearchService],
  exports: [CatalogService],
})
export class CatalogModule {}
