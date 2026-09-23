import { Module } from '@nestjs/common';

import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { FxRefreshService } from './fx-refresh.service.js';
import { SearchService } from './search.service.js';

@Module({
  controllers: [CatalogController],
  // FxRefreshService writes the exchange rates every price here converts with.
  providers: [CatalogService, FxRefreshService, SearchService],
  exports: [CatalogService],
})
export class CatalogModule {}
