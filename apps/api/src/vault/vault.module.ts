import { Module } from '@nestjs/common';

import { KekService } from './kek.js';
import { VaultPrismaService } from './vault-prisma.service.js';
import { VaultService } from './vault.service.js';

/**
 * The vault.
 *
 * `VaultPrismaService` is provided here and exported nowhere. What leaves this
 * module is `VaultService`, which is the only thing that can reach an encrypted
 * licence and which refuses a step-up action without a fresh TOTP challenge and
 * writes an access row before any plaintext exists.
 *
 * The isolation rests on three independent layers, so a mistake in one does not
 * open the vault: the `da_vault` Postgres role is the only one with a grant on
 * the schema, an ESLint rule makes a second `vaultPrisma` import a build
 * failure, and this module withholds the client from injection.
 */
@Module({
  providers: [VaultPrismaService, KekService, VaultService],
  exports: [VaultService],
})
export class VaultModule {}
