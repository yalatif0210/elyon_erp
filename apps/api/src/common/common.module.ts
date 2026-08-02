import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditService } from './audit/audit.service';
import { AppConfig, EnvironmentVariables, validateEnv } from './config/env.config';
import { CryptoService } from './crypto/crypto.service';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';

/**
 * Socle transverse : configuration validée, base, cache, chiffrement, audit.
 *
 * Global par choix délibéré — ces services sont des dépendances de presque
 * tous les modules métier, et les redéclarer partout n'apporterait rien
 * qu'une occasion d'oubli.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // La validation échoue au démarrage, jamais en production sous charge.
      validate: validateEnv,
    }),
  ],
  providers: [
    {
      provide: EnvironmentVariables,
      useFactory: () => validateEnv(process.env as Record<string, unknown>),
    },
    AppConfig,
    PrismaService,
    RedisService,
    CryptoService,
    AuditService,
  ],
  exports: [AppConfig, PrismaService, RedisService, CryptoService, AuditService],
})
export class CommonModule {}
