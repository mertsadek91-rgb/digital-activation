import { Module } from '@nestjs/common';

import { MailModule } from '../mail/mail.module.js';

import { ContactService } from './contact.service.js';
import { ContentController } from './content.controller.js';
import { ContentService } from './content.service.js';

@Module({
  imports: [MailModule],
  controllers: [ContentController],
  providers: [ContentService, ContactService],
  exports: [ContentService],
})
export class ContentModule {}
