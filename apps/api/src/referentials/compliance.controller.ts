import {
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ActorType,
  AuditAction, ComplianceType, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Realm, RequireRealm, Roles, Screen } from '../common/auth/realm';
import { SettingsService } from '../common/config/settings.service';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Conformité des tiers, véhicules et chauffeurs (SPECIFICATIONS.md § 6.4).
 *
 * C'est la valeur immédiate du lot 1 : avant même qu'une opération existe,
 * savoir quelle assurance expire, quel contrôle technique est périmé et quel
 * chauffeur n'est plus habilité vaut déjà le déploiement.
 *
 * Le statut n'est JAMAIS saisi — il est dérivé de la date d'expiration par un
 * trigger. Ces endpoints ne font que le lire.
 */

class ExpiryWatchQuery {
  /** Fenêtre de préavis en jours. Par défaut celle du paramétrage. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  withinDays?: number;

  /** N'afficher que les pièces bloquantes pour l'affectation. */
  @IsOptional()
  @IsString()
  blockingOnly?: string;
}

class CreateComplianceDto {
  @IsEnum(ComplianceType)
  type!: ComplianceType;

  @IsString()
  @MaxLength(120)
  reference!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  issuingBody?: string;

  @IsDateString()
  issueDate!: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;
}

@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** État de conformité consolidé — vue v_transport_compliance. */
  async overview(): Promise<unknown[]> {
    return this.prisma.$queryRawUnsafe(
      `SELECT subject_kind, subject_id, subject_code, subject_label,
              expired_count::int, suspended_count::int, expiring_count::int,
              next_expiry, is_compliant
         FROM v_transport_compliance
        ORDER BY is_compliant ASC, expiring_count DESC, subject_kind, subject_label`,
    );
  }

  /** Moyens actuellement non conformes — ceux qui déclenchent le verrou § 11.2. */
  async nonCompliant(): Promise<unknown[]> {
    return this.prisma.$queryRawUnsafe(
      `SELECT subject_kind, subject_id, subject_code, subject_label,
              expired_count::int, suspended_count::int
         FROM v_transport_compliance
        WHERE NOT is_compliant
        ORDER BY subject_kind, subject_label`,
    );
  }

  /** Échéancier documentaire — alimente le moteur d'alerte (§ 6.6). */
  async expiryWatch(withinDays: number | undefined, blockingOnly: boolean): Promise<unknown[]> {
    const horizon = withinDays ?? (await this.noticeDays());
    return this.prisma.$queryRawUnsafe(
      `SELECT id, type, reference, expiry_date, days_remaining::int, status,
              is_blocking, owner_kind, owner_label, owner_id
         FROM v_compliance_expiry_watch
        WHERE days_remaining <= $1
          AND ($2::boolean IS NOT TRUE OR is_blocking)
        ORDER BY expiry_date`,
      horizon,
      blockingOnly,
    );
  }

  async create(dto: CreateComplianceDto, actorId: string) {
    // Le rattachement à exactement un porteur est vérifié en base
    // (chk_compliance_single_owner) : inutile de le dupliquer ici, la
    // contrainte remontera en 422 via le filtre Prisma.
    const piece = await this.prisma.complianceRecord.create({
      data: {
        type: dto.type,
        reference: dto.reference,
        issuingBody: dto.issuingBody ?? null,
        issueDate: new Date(dto.issueDate),
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        partnerId: dto.partnerId ?? null,
        vehicleId: dto.vehicleId ?? null,
        driverId: dto.driverId ?? null,
        recordedById: actorId,
      },
    });

    // ⚠️ CETTE ÉCRITURE NE LAISSAIT AUCUNE TRACE D'AUDIT.
    //
    //    C'est pourtant la pièce qui rend un transporteur, un véhicule ou un
    //    chauffeur AFFECTABLE (§ 6.4) : enregistrer une assurance périmée comme
    //    valide ouvre le verrou de conformité. Le seul témoin était la colonne
    //    `recordedById` de la ligne elle-même — modifiable, et effacée par la
    //    correction suivante.
    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'ComplianceRecord',
      entityId: piece.id,
      after: piece,
    });

    return piece;
  }

  findOne(id: string) {
    return this.prisma.complianceRecord.findUniqueOrThrow({
      where: { id },
      include: {
        partner: { select: { code: true, legalName: true } },
        vehicle: { select: { registration: true, brandModel: true } },
        driver: { select: { fullName: true, employeeNumber: true } },
        document: { select: { id: true, title: true, storageKey: true } },
      },
    });
  }

  /**
   * Préavis d'alerte sur les pièces à échéance (§ 6.6).
   *
   * Passe par le service de paramétrage plutôt que par une lecture directe :
   * celle-ci rendait NaN sur une valeur non numérique — l'horizon de la
   * surveillance disparaissait alors sans message, et la liste des pièces à
   * renouveler revenait vide comme si tout était en règle.
   */
  private noticeDays(): Promise<number> {
    return this.settings.number('DOC_EXPIRY_ALERT_DAYS', 60);
  }
}

@Controller('api/internal/compliance')
@RequireRealm(Realm.INTERNAL)
export class ComplianceController {
  constructor(private readonly service: ComplianceService) {}

  @Get('overview')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD, UserRole.FINANCE_CFO, UserRole.ASSISTANT_DG)
  @Screen('conformite')
  overview() {
    return this.service.overview();
  }

  @Get('non-compliant')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD, UserRole.FINANCE_CFO)
  nonCompliant() {
    return this.service.nonCompliant();
  }

  @Get('expiry-watch')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD, UserRole.ASSISTANT_DG, UserRole.FINANCE_CFO)
  @Screen('echeancier')
  expiryWatch(@Query() query: ExpiryWatchQuery) {
    return this.service.expiryWatch(query.withinDays, query.blockingOnly === 'true');
  }

  @Post('records')
  @Roles(UserRole.LOGISTICS_COORD, UserRole.CCOO, UserRole.ASSISTANT_DG)
  create(@Body() dto: CreateComplianceDto, @Req() req: { auth: { sub: string } }) {
    return this.service.create(dto, req.auth.sub);
  }

  @Get('records/:id')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD, UserRole.ASSISTANT_DG)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }
}
