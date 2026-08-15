import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ActorType, AuditAction, InvoiceType, UserRole, VehicleMaintenanceType, VehicleType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsISO8601, IsNumber, IsOptional, IsString, Length, Min, MinLength } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { Realm, RequireRealm, Roles } from '../common/auth/realm';
import { PrismaService } from '../common/prisma/prisma.service';

// ===========================================================================
//  DTO
// ===========================================================================

class RecordMaintenanceDto {
  @IsEnum(VehicleMaintenanceType) type!: VehicleMaintenanceType;
  @IsString() @MinLength(5) description!: string;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) cost?: number;
  @IsOptional() @IsString() @Length(3, 3) currencyCode?: string;

  @IsISO8601() performedAt!: string;
  @IsOptional() @IsISO8601() nextDueAt?: string;
  @IsOptional() @IsString() performedBy?: string;
}

// ===========================================================================
//  Service
// ===========================================================================

/**
 * MAINTENANCE ET COMPTE D'EXPLOITATION DES MOYENS (§ 13, module 7).
 *
 * Générique à tout `Vehicle` — la barge n'a pas de table dédiée : elle est un
 * `Vehicle` de type `BUNKER_BARGE`, au même titre qu'un camion-citerne ou un
 * wagon. Dupliquer immatriculation, capacité et conformité pour elle seule
 * aurait recréé un second registre à tenir cohérent avec le premier.
 *
 * ⚠️ LE CHIFFRE D'AFFAIRES PAR BARGE EST UNE APPROXIMATION ASSUMÉE.
 *
 *    La facturation porte sur l'AFFAIRE (Deal), jamais sur l'opération ni
 *    le moyen qui l'a exécutée — une affaire peut enchaîner plusieurs
 *    opérations, sur plusieurs moyens. Faute d'un lien facture ↔ opération
 *    dans le modèle actuel, le chiffre d'affaires attribué à une barge est
 *    la somme des pièces émises sur les affaires ayant eu AU MOINS UNE
 *    opération confiée à elle — pas une répartition au prorata. Une affaire
 *    scindée entre deux barges compte pour chacune. À affiner si la
 *    granularité devient un vrai besoin de pilotage (§ 14.4).
 */
@Injectable()
export class BargeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async assertIsVehicle(vehicleId: string): Promise<{ registration: string }> {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { registration: true },
    });
    if (!vehicle) throw new BadRequestException('Moyen introuvable.');
    return vehicle;
  }

  async recordMaintenance(vehicleId: string, dto: RecordMaintenanceDto, actorId: string) {
    await this.assertIsVehicle(vehicleId);

    if (dto.cost && dto.cost > 0 && !dto.currencyCode) {
      throw new BadRequestException('Un coût de maintenance saisi exige sa devise.');
    }

    const event = await this.prisma.vehicleMaintenanceEvent.create({
      data: {
        vehicleId,
        type: dto.type,
        description: dto.description,
        cost: (dto.cost ?? 0).toFixed(4),
        currencyCode: dto.currencyCode ?? (await this.pivotCurrency()),
        performedAt: new Date(dto.performedAt),
        nextDueAt: dto.nextDueAt ? new Date(dto.nextDueAt) : null,
        performedBy: dto.performedBy ?? null,
        recordedById: actorId,
      },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'VehicleMaintenanceEvent',
      entityId: event.id,
      after: event,
    });

    return event;
  }

  listMaintenance(vehicleId: string) {
    return this.prisma.vehicleMaintenanceEvent.findMany({
      where: { vehicleId },
      orderBy: { performedAt: 'desc' },
      include: { recordedBy: { select: { fullName: true } } },
    });
  }

  private async pivotCurrency(): Promise<string> {
    const pivot = await this.prisma.currency.findFirstOrThrow({ where: { isPivot: true } });
    return pivot.code;
  }

  /** Taux vers le pivot, à la date du jour — même règle que la facturation. */
  private async pivotRate(currencyCode: string, pivotCode: string): Promise<number> {
    if (currencyCode === pivotCode) return 1;
    const today = new Date();
    const window = {
      effectiveFrom: { lte: today },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
    };
    const direct = await this.prisma.fxRate.findFirst({
      where: { baseCurrencyCode: currencyCode, quoteCurrencyCode: pivotCode, ...window },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (direct) return Number(direct.rate);
    const inverse = await this.prisma.fxRate.findFirst({
      where: { baseCurrencyCode: pivotCode, quoteCurrencyCode: currencyCode, ...window },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (inverse) return 1 / Number(inverse.rate);
    return 0; // Pas de taux : la ligne est exclue du total plutôt que de fausser le pivot.
  }

  /**
   * Compte d'exploitation par barge (§ 16 : voyages, volumes, coûts,
   * revenus, marge, maintenance).
   */
  async bargePnL() {
    const pivotCode = await this.pivotCurrency();
    const barges = await this.prisma.vehicle.findMany({
      where: { type: VehicleType.BUNKER_BARGE },
      select: {
        id: true,
        registration: true,
        brandModel: true,
        isActive: true,
        isCompliant: true,
        assignments: {
          select: {
            freightCost: true,
            currencyCode: true,
            operation: {
              select: {
                id: true,
                dealId: true,
                plannedVolume: true,
                uom: true,
                status: true,
                costLines: {
                  select: { actualAmount: true, estimatedAmount: true, currencyCode: true },
                },
              },
            },
          },
        },
        maintenanceEvents: { select: { cost: true, currencyCode: true, performedAt: true, nextDueAt: true, type: true } },
      },
    });

    return Promise.all(
      barges.map(async (barge) => {
        const dealIds = new Set(barge.assignments.map((a) => a.operation.dealId));
        // ⚠️ PAS DE SOMME UNIQUE : L, M3, MT et BBL ne s'additionnent pas tels
        // quels (audit, axe A, S3) — regroupé PAR UNITÉ plutôt que converti en
        // silence, faute d'un module de conversion partagé entre volumes déjà
        // homogènes (barème ASTM) et volumes hétérogènes entre opérations.
        const volumeParUnite: Record<string, number> = {};
        for (const a of barge.assignments) {
          const uom = a.operation.uom;
          volumeParUnite[uom] = (volumeParUnite[uom] ?? 0) + Number(a.operation.plannedVolume);
        }

        let operatingCostPivot = 0;
        for (const a of barge.assignments) {
          const rate = await this.pivotRate(a.currencyCode, pivotCode);
          operatingCostPivot += Number(a.freightCost) * rate;
          for (const line of a.operation.costLines) {
            const lineRate = await this.pivotRate(line.currencyCode, pivotCode);
            operatingCostPivot += Number(line.actualAmount ?? line.estimatedAmount) * lineRate;
          }
        }

        let maintenanceCostPivot = 0;
        for (const m of barge.maintenanceEvents) {
          const rate = await this.pivotRate(m.currencyCode, pivotCode);
          maintenanceCostPivot += Number(m.cost) * rate;
        }

        let revenuePivot = 0;
        if (dealIds.size > 0) {
          const invoices = await this.prisma.invoice.findMany({
            where: {
              dealId: { in: [...dealIds] },
              status: { not: 'DRAFT' },
              type: { in: [InvoiceType.SIMPLE, InvoiceType.FNE, InvoiceType.CREDIT_NOTE] },
            },
            select: { type: true, totalAmountPivot: true },
          });
          revenuePivot = invoices.reduce(
            (s, inv) => s + (inv.type === InvoiceType.CREDIT_NOTE ? -Number(inv.totalAmountPivot) : Number(inv.totalAmountPivot)),
            0,
          );
        }

        return {
          vehicleId: barge.id,
          registration: barge.registration,
          brandModel: barge.brandModel,
          isActive: barge.isActive,
          isCompliant: barge.isCompliant,
          voyages: barge.assignments.length,
          volumeParUnite,
          pivotCurrency: pivotCode,
          revenuePivot: Number(revenuePivot.toFixed(4)),
          operatingCostPivot: Number(operatingCostPivot.toFixed(4)),
          maintenanceCostPivot: Number(maintenanceCostPivot.toFixed(4)),
          marginPivot: Number((revenuePivot - operatingCostPivot - maintenanceCostPivot).toFixed(4)),
          maintenanceEventCount: barge.maintenanceEvents.length,
          // ⚠️ CORRIGÉ (audit, axe A, S3) : rendait la DERNIÈRE intervention
          // passée (`performedAt` trié à l'envers), pas la PROCHAINE échéance
          // — le nom du champ promettait l'inverse de ce qu'il contenait.
          nextMaintenanceDue:
            barge.maintenanceEvents
              .map((m) => m.nextDueAt)
              .filter((d): d is Date => d !== null)
              .sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
        };
      }),
    );
  }
}

// ===========================================================================
//  Contrôleur
// ===========================================================================

@Controller('api/internal/vehicles')
@RequireRealm(Realm.INTERNAL)
export class VehicleMaintenanceController {
  constructor(private readonly service: BargeService) {}

  @Get(':vehicleId/maintenance')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.LOGISTICS_COORD)
  list(@Param('vehicleId', ParseUUIDPipe) vehicleId: string) {
    return this.service.listMaintenance(vehicleId);
  }

  @Post(':vehicleId/maintenance')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD)
  record(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: RecordMaintenanceDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.recordMaintenance(vehicleId, dto, req.auth.sub);
  }
}

@Controller('api/internal/supervision')
@RequireRealm(Realm.INTERNAL)
export class BargeSupervisionController {
  constructor(private readonly service: BargeService) {}

  @Get('barges')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.LOGISTICS_COORD)
  bargePnL() {
    return this.service.bargePnL();
  }
}
