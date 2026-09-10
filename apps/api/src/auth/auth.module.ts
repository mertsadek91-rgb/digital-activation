import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditService } from './audit.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { StaffGuard } from './staff.guard.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, AuditService, StaffGuard],
  exports: [AuthService, AuditService, StaffGuard],
})
export class AuthModule {}
