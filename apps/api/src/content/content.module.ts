import { Module } from '@nestjs/common';

import { MailModule } from '../mail/mail.module.js';

import { AuthModule } from '../auth/auth.module.js';

import { ContactAdminController } from './contact.controller.js';
import { ContactService } from './contact.service.js';
import { ContentController } from './content.controller.js';
import { RedirectsController } from './redirects.controller.js';
import { RedirectsService } from './redirects.service.js';
import { ContentService } from './content.service.js';

@Module({
  imports: [MailModule, AuthModule],
  controllers: [ContentController, ContactAdminController, RedirectsController],
  providers: [ContentService, ContactService, RedirectsService],
  exports: [ContentService],
})
export class ContentModule {}
