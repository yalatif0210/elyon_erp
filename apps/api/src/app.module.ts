import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DerogationController, DerogationService } from './admin/derogations.controller';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { CommonModule } from './common/common.module';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { HealthController } from './health/health.controller';
import { ComplianceController, ComplianceService } from './referentials/compliance.controller';
import {
  ReferentialsController,
  ReferentialsService,
} from './referentials/referentials.controller';

/**
 * Racine du monolithe modulaire (SPECIFICATIONS.md § 1.2).
 *
 * LOT 1 — socle, référentiels, conformité, dérogations.
 * LOT 2 ajoutera : sales · procurement · operations · hse · invoicing · fiscal
 *                  · field · portal.
 *
 * Les guards sont montés GLOBALEMENT : une route nouvelle est authentifiée par
 * défaut et doit se déclarer explicitement publique. L'inverse — ouvrir par
 * défaut et penser à fermer — finit toujours par laisser une porte ouverte.
 */
@Module({
  imports: [
    CommonModule,
    JwtModule.register({}),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    AuthModule,
  ],
  controllers: [
    HealthController,
    ReferentialsController,
    ComplianceController,
    DerogationController,
  ],
  providers: [
    ReferentialsService,
    ComplianceService,
    DerogationService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Traduit les refus d'invariants de la base en 422 intelligibles :
    // sans lui, les garde-fous métier remonteraient en 500 muets.
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
