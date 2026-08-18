import { Body, Controller, Get, Injectable, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { AuditAction, ActorType, DerogationStatus, DerogationType, UserRole } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { Realm, RequireRealm, Roles, Screen } from '../common/auth/realm';
import { Page, PaginationQuery, paginate } from '../common/http/pagination.dto';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Registre des dérogations (SPECIFICATIONS.md § 11.4).
 *
 * Registre UNIQUE pour les trois verrous et la suppléance HSE. C'est la pièce
 * qu'un auditeur ou un assureur demandera à consulter après un incident.
 *
 * L'autorité habilitée par type est vérifiée EN BASE (trigger
 * trg_derogation_authority) : conformité transport, plancher direct et
 * suppléance HSE sont réservés au DG. Ce contrôleur ne duplique pas cette
 * règle — il la laisse remonter en 422 via le filtre Prisma, de sorte qu'une
 * évolution du code ne puisse pas l'affaiblir sans toucher à la base.
 */

class CreateDerogationDto {
  @IsEnum(DerogationType)
  type!: DerogationType;

  @IsString()
  @MaxLength(64)
  subjectType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  subjectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  subjectLabel?: string;

  /** Motif écrit — 10 caractères minimum, également imposé en base. */
  @IsString()
  @Length(10, 2000, { message: 'Un motif circonstancié est obligatoire (10 caractères minimum)' })
  reason!: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

class ReviewDerogationDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

class DerogationQuery extends PaginationQuery {
  @IsOptional()
  @IsEnum(DerogationType)
  type?: DerogationType;

  @IsOptional()
  @IsEnum(DerogationStatus)
  status?: DerogationStatus;
}

@Injectable()
export class DerogationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: DerogationQuery): Promise<Page<unknown>> {
    const where = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.derogation.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { grantedAt: 'desc' },
        include: {
          authority: { select: { fullName: true, role: true } },
          requestedBy: { select: { fullName: true, role: true } },
        },
      }),
      this.prisma.derogation.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  /**
   * Dérogations exceptionnelles en attente de revue mensuelle.
   * Le franchissement du plancher direct y bascule automatiquement (§ 5.4).
   */
  async pendingReview(): Promise<unknown[]> {
    return this.prisma.derogation.findMany({
      where: { requiresMonthlyReview: true, reviewedAt: null, status: DerogationStatus.ACTIVE },
      orderBy: { grantedAt: 'asc' },
      include: { authority: { select: { fullName: true, role: true } } },
    });
  }

  async create(dto: CreateDerogationDto, authorityId: string, requestedById: string) {
    const created = await this.prisma.derogation.create({
      data: {
        type: dto.type,
        subjectType: dto.subjectType,
        subjectId: dto.subjectId ?? null,
        subjectLabel: dto.subjectLabel ?? null,
        reason: dto.reason,
        authorityId,
        requestedById,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId: authorityId,
      action: AuditAction.DEROGATION_GRANTED,
      entityType: 'Derogation',
      entityId: created.id,
      after: created,
    });

    return created;
  }

  async revoke(id: string, actorId: string) {
    const updated = await this.prisma.derogation.update({
      where: { id },
      data: { status: DerogationStatus.REVOKED, revokedAt: new Date() },
    });
    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.OVERRIDE,
      entityType: 'Derogation',
      entityId: id,
      after: { status: DerogationStatus.REVOKED },
    });
    return updated;
  }

  async markReviewed(id: string, dto: ReviewDerogationDto, actorId: string) {
    const updated = await this.prisma.derogation.update({
      where: { id },
      data: { reviewedAt: new Date() },
    });
    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.UPDATE,
      entityType: 'Derogation',
      entityId: id,
      after: { reviewedAt: updated.reviewedAt, note: dto.note },
    });
    return updated;
  }
}

@Controller('api/internal/derogations')
@RequireRealm(Realm.INTERNAL)
export class DerogationController {
  constructor(private readonly service: DerogationService) {}

  @Get()
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO, UserRole.ACCOUNTANT, UserRole.ASSISTANT_DG)
  @Screen('derogations')
  list(@Query() query: DerogationQuery) {
    return this.service.list(query);
  }

  /** Revue mensuelle des dérogations exceptionnelles. */
  @Get('pending-review')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO)
  pendingReview() {
    return this.service.pendingReview();
  }

  /**
   * Accorder une dérogation. L'autorité est TOUJOURS l'utilisateur connecté :
   * on ne peut pas déroger au nom d'un autre. Le trigger de base refusera si
   * le rôle n'est pas habilité pour ce type.
   */
  @Post()
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO)
  create(@Body() dto: CreateDerogationDto, @Req() req: { auth: { sub: string } }) {
    return this.service.create(dto, req.auth.sub, req.auth.sub);
  }

  @Patch(':id/revoke')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO)
  revoke(@Param('id', ParseUUIDPipe) id: string, @Req() req: { auth: { sub: string } }) {
    return this.service.revoke(id, req.auth.sub);
  }

  @Patch(':id/reviewed')
  @Roles(UserRole.DG)
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDerogationDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.markReviewed(id, dto, req.auth.sub);
  }
}
