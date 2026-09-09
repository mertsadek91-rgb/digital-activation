import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { prisma, type PrismaClient } from '@da/db';

/**
 * The application database client, connected as the `da_app` Postgres role.
 *
 * That role has no grant on the `vault` schema, so nothing injected with this
 * service can read an encrypted licence key — including code that tries. The
 * vault has its own service, injected only into the vault module.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient = prisma;

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
