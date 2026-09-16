import { Module } from '@nestjs/common';

import { MailModule } from '../mail/mail.module.js';

import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';

import { ContactAdminController } from './contact.controller.js';
import { ContactService } from './contact.service.js';
import { ContentController } from './content.controller.js';
import { RedirectsController } from './redirects.controller.js';
import { RedirectsService } from './redirects.service.js';
import { ContentService } from './content.service.js';
import { SuggestService } from './suggest.service.js';

@Module({
  // CatalogModule for the product cards a blog post links to. The catalog owns
  // card building, and a second builder here would be a second place for a
  // price to be formatted differently from the grid one click away.
  imports: [MailModule, AuthModule, CatalogModule],
  controllers: [ContentController, ContactAdminController, RedirectsController],
  providers: [ContentService, ContactService, RedirectsService, SuggestService],
  exports: [ContentService],
})
export class ContentModule {}
