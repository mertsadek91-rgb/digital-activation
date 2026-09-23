import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { KekService } from '../vault/kek.js';

import { AuditService } from './audit.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { StaffGuard } from './staff.guard.js';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  // KekService is stateless — it reads the provider from the environment — so a
  // second instance here is the same KEK as the vault's without exporting it
  // from VaultModule, whose exports are deliberately just VaultService.
  providers: [AuthService, AuditService, StaffGuard, KekService],
  exports: [AuthService, AuditService, StaffGuard],
})
export class AuthModule {}
