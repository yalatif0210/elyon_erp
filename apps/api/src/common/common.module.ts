import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { AuditService } from './audit/audit.service';
import { AppConfig, EnvironmentVariables, validateEnv } from './config/env.config';
import { CryptoService } from './crypto/crypto.service';
import { FxService } from './money/fx.service';
import { PrismaService } from './prisma/prisma.service';
import { ReferenceService } from './reference/reference.service';
import { RedisService } from './redis/redis.service';
import { ScreenAccessService } from './auth/screen-access.service';
import { SettingsService } from './config/settings.service';
import { StorageService } from './storage/storage.service';
import { AstmService } from './volumes/astm.service';

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
    // File de jobs asynchrones (§ 1.1) — le worker tourne DANS ce même
    // processus API : le monolithe modulaire (§ 1.2) n'a pas de second
    // déployable à faire vivre pour autant.
    BullModule.forRootAsync({
      useFactory: (config: AppConfig) => ({ connection: config.redisConnection }),
      inject: [AppConfig],
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
    ReferenceService,
    StorageService,
    AstmService,
    FxService,
    // Les règles de gestion (seuils, durées, quotas) sont lues en base, pas
    // écrites dans le code : le service est transverse au même titre que
    // l'accès base, et suit donc la même portée globale.
    SettingsService,
    // Consulté par le garde d'authentification à CHAQUE requête interne
    // (§ paramétrage 17/08) : doit être disponible partout, comme lui.
    ScreenAccessService,
  ],
  exports: [
    AppConfig,
    PrismaService,
    RedisService,
    CryptoService,
    AuditService,
    ReferenceService,
    SettingsService,
    StorageService,
    AstmService,
    FxService,
    ScreenAccessService,
  ],
})
export class CommonModule {}
