import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { vaultPrisma, type PrismaClient } from '@da/db';

/**
 * The vault database client, connected as `da_vault`.
 *
 * This is the only place in the application that imports `vaultPrisma`, and an
 * ESLint rule makes a second import site a build failure rather than a
 * code-review habit. The whole isolation argument rests on that: `da_app` has
 * no grant on the `vault` schema at all, so an injection anywhere in the
 * ordinary application cannot read an encrypted licence — not because the code
 * is careful, but because the connection has no permission.
 *
 * Provided only inside VaultModule, and VaultModule exports the service that
 * mediates access rather than this client.
 */
@Injectable()
export class VaultPrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient = vaultPrisma;

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
