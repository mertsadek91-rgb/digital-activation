import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';

import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';

/**
 * Its own module rather than a third controller inside AdminModule, because it
 * is the one part of the panel that reaches outside the database: object
 * storage, and a decode-and-re-encode step that is the security boundary for
 * every file a person uploads. Keeping it separate means those two things have
 * one door.
 */
@Module({
  imports: [AuthModule],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
