import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Accès base. Le pooling est piloté par la chaîne de connexion
 * (connection_limit / pool_timeout), pas par du code applicatif.
 *
 * Cette connexion utilise le rôle erp_app : aucun DDL, aucun effacement
 * de journal ni de dérogation possible, même en cas de compromission
 * de l'API (SPECIFICATIONS.md § 1.4).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
