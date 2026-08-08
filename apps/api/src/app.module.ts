import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { DerogationController, DerogationService } from './admin/derogations.controller';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { LocalizedThrottlerGuard } from './common/auth/throttler.guard';
import { CommonModule } from './common/common.module';
import { RATE_WINDOW_MS, primeRateLimits } from './common/config/rate-limits';
import { SettingsService } from './common/config/settings.service';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import {
  DocumentsController,
  DocumentsService,
  FieldDocumentsController,
  FieldDocumentsService,
} from './documents/documents.controller';
import {
  FieldOperationsController,
  FieldOperationsService,
} from './field/field-operations.controller';
import {
  FieldAttachmentsController,
  FieldAttachmentsService,
  InternalAttachmentsController,
} from './field/field-attachments.controller';
import { FieldScopeService } from './field/field-scope.service';
import { FieldSyncController, FieldSyncService } from './field/field-sync.controller';
import { HealthController } from './health/health.controller';
import { FieldHseController, HseController, HseService } from './hse/hse.controller';
import { InvoicesController, InvoicesService } from './invoicing/invoices.controller';
import { OperationsController, OperationsService } from './operations/operations.controller';
import {
  SupplierInvoicesController,
  SupplierInvoicesService,
} from './procurement/supplier-invoices.controller';
import { DealsController, DealsService } from './sales/deals.controller';
import { MarginService } from './sales/margin.service';
import { CrmController, CrmService } from './crm/crm.controller';
import { SupervisionController, SupervisionService } from './supervision/supervision.controller';
import { ComplianceController, ComplianceService } from './referentials/compliance.controller';
import {
  ParametersController,
  ParametersService,
} from './referentials/parameters.controller';
import {
  ReferentialsController,
  ReferentialsService,
} from './referentials/referentials.controller';

/**
 * Racine du monolithe modulaire (SPECIFICATIONS.md § 1.2).
 *
 * LOT 1 — socle, référentiels, conformité, dérogations.
 * LOT 2 — deals et chaîne de marge, opérations, HSE, facturation, registre
 *         fournisseurs, documents et signatures, pilotage.
 *         Restent à venir : fiscal (transmission FNE réelle) · field · portal.
 *
 * Les guards sont montés GLOBALEMENT : une route nouvelle est authentifiée par
 * défaut et doit se déclarer explicitement publique. L'inverse — ouvrir par
 * défaut et penser à fermer — finit toujours par laisser une porte ouverte.
 */
@Module({
  imports: [
    CommonModule,
    JwtModule.register({}),
    // Plafond de débit global, LU EN BASE AU DÉMARRAGE (API_RATE_PER_MINUTE).
    //
    // ⚠️ Le changement ne prend effet QU'AU REDÉMARRAGE de l'API : le
    //    ThrottlerModule construit sa configuration une fois, ici, et la
    //    garde. La factory arme au passage le plafond de connexion, que le
    //    contrôleur d'authentification résout à chaque requête (rate-limits.ts).
    ThrottlerModule.forRootAsync({
      imports: [CommonModule],
      inject: [SettingsService],
      useFactory: async (settings: SettingsService) => {
        const { api } = await primeRateLimits(settings);
        return [{ name: 'default', ttl: RATE_WINDOW_MS, limit: api }];
      },
    }),
    AuthModule,
  ],
  controllers: [
    HealthController,
    ReferentialsController,
    ParametersController,
    ComplianceController,
    DerogationController,
    DealsController,
    OperationsController,
    HseController,
    FieldHseController,
    FieldOperationsController,
    FieldSyncController,
    FieldAttachmentsController,
    InternalAttachmentsController,
    InvoicesController,
    SupplierInvoicesController,
    DocumentsController,
    FieldDocumentsController,
    CrmController,
    SupervisionController,
  ],
  providers: [
    ReferentialsService,
    ParametersService,
    ComplianceService,
    DerogationService,
    DealsService,
    MarginService,
    OperationsService,
    HseService,
    FieldOperationsService,
    FieldSyncService,
    FieldAttachmentsService,
    FieldScopeService,
    InvoicesService,
    SupplierInvoicesService,
    DocumentsService,
    FieldDocumentsService,
    CrmService,
    SupervisionService,
    { provide: APP_GUARD, useClass: LocalizedThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Traduit les refus d'invariants de la base en 422 intelligibles :
    // sans lui, les garde-fous métier remonteraient en 500 muets.
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
