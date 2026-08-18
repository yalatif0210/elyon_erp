import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  AuditAction,
  ActorType,
  DerogationStatus,
  DerogationType,
  FieldRole,
  UserRole,
} from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsString, Length, MaxLength, IsUUID } from 'class-validator';
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

/**
 * Suppléance du contrôleur HSE par un agent terrain (§ 3.4).
 *
 * Volontairement restreint au SEUL cas exercé aujourd'hui : un agent terrain
 * couvrant l'absence du contrôleur HSE. Le modèle `Delegation` porte aussi un
 * délégué INTERNE (`delegateUserId`) — non exposé ici faute d'une route qui
 * en ferait quelque chose : l'accorder produirait une suppléance sans effet,
 * exactement le piège que ce correctif referme par ailleurs.
 */
class CreateDelegationDto {
  @IsUUID() delegateFieldUserId!: string;

  @IsString()
  @Length(10, 1000, { message: 'Un motif circonstancié est obligatoire (10 caractères minimum)' })
  reason!: string;

  @IsISO8601() startsAt!: string;
  @IsISO8601() endsAt!: string;
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

  /**
   * Révoque la dérogation — ET la suppléance qu'elle trace, s'il y en a une.
   *
   * ⚠️ SANS CE SECOND VOLET, RÉVOQUER SERAIT UN LEURRE.
   *
   *    `enforce_hse_separation_of_duties` (§ 37) vérifie la fenêtre de la
   *    DÉLÉGATION, pas le statut de la dérogation qui la trace. Un DG qui
   *    révoque ici sans que la ligne `delegations` correspondante s'éteigne
   *    verrait l'écran dire « révoquée » pendant que le suppléant continue,
   *    en base, de pouvoir valider.
   */
  async revoke(id: string, actorId: string) {
    const derogation = await this.prisma.derogation.findUniqueOrThrow({
      where: { id },
      select: { delegationId: true },
    });
    const now = new Date();

    const [updated] = await this.prisma.$transaction([
      this.prisma.derogation.update({
        where: { id },
        data: { status: DerogationStatus.REVOKED, revokedAt: now },
      }),
      ...(derogation.delegationId
        ? [
            this.prisma.delegation.update({
              where: { id: derogation.delegationId },
              data: { revokedAt: now },
            }),
          ]
        : []),
    ]);

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.OVERRIDE,
      entityType: 'Derogation',
      entityId: id,
      after: { status: DerogationStatus.REVOKED, delegationRevoked: !!derogation.delegationId },
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

// ===========================================================================
//  Suppléance du contrôleur HSE — DerogationType.HSE_DELEGATION (§ 3.4)
// ===========================================================================

/**
 * ⚠️ CORRIGÉ — LA SUPPLÉANCE N'AVAIT AUCUN CHEMIN, ET SON EFFET N'EXISTAIT
 *    NULLE PART.
 *
 *    Le modèle `Delegation` et le type `HSE_DELEGATION` existaient, réservés
 *    au DG — mais rien ne les créait, et le verrou de séparation des tâches
 *    (`enforce_hse_separation_of_duties`) n'aurait de toute façon accepté
 *    comme validateur qu'un agent dont la fiche porte littéralement le rôle
 *    HSE_CONTROLLER. Une suppléance accordée n'aurait validé rien.
 *
 *    Corrigé à trois endroits qui doivent tenir ENSEMBLE, faute de quoi la
 *    suppléance reste un mot :
 *      1. ICI — le chemin pour l'accorder ;
 *      2. `FieldScopeService.effectiveActor` — pour que le suppléant VOIE la
 *         checklist qu'il doit valider, comme le ferait le contrôleur ;
 *      3. le trigger `enforce_hse_separation_of_duties` (§ 37) — pour que la
 *         validation soit RÉELLEMENT acceptée, en base, sans jamais réécrire
 *         le rôle déclaré de l'agent ni son jeton de session.
 */
@Injectable()
export class DelegationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Agents terrain éligibles à une suppléance — pour peupler le choix du DG. */
  async fieldUsers(): Promise<{ id: string; fullName: string; email: string; role: FieldRole }[]> {
    return this.prisma.fieldUser.findMany({
      where: { isActive: true },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, email: true, role: true },
    });
  }

  /**
   * Accorde la suppléance ET la dérogation qui la trace, dans la même
   * transaction : l'une sans l'autre serait soit une fenêtre d'autorisation
   * sans registre, soit une entrée de registre sans effet.
   */
  async create(dto: CreateDelegationDto, grantorId: string) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (!(endsAt > startsAt)) {
      throw new BadRequestException('La fin de la suppléance doit être postérieure à son début.');
    }

    const delegate = await this.prisma.fieldUser.findUnique({
      where: { id: dto.delegateFieldUserId },
      select: { fullName: true, isActive: true },
    });
    if (!delegate?.isActive) {
      throw new BadRequestException('Agent terrain introuvable, ou inactif.');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const delegation = await tx.delegation.create({
        data: {
          delegatedRole: FieldRole.HSE_CONTROLLER,
          grantorId,
          delegateFieldUserId: dto.delegateFieldUserId,
          reason: dto.reason,
          startsAt,
          endsAt,
        },
      });

      // Le trigger d'autorité (§ 01) vérifie que `grantorId` est bien DG pour
      // ce type — la même règle qui protège `POST /derogations` protège donc
      // aussi cette création, sans être recopiée ici.
      const derogation = await tx.derogation.create({
        data: {
          type: DerogationType.HSE_DELEGATION,
          subjectType: 'FieldUser',
          subjectLabel: delegate.fullName,
          reason: dto.reason,
          authorityId: grantorId,
          requestedById: grantorId,
          expiresAt: endsAt,
          delegationId: delegation.id,
        },
      });

      return { delegation, derogation };
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId: grantorId,
      action: AuditAction.DEROGATION_GRANTED,
      entityType: 'Delegation',
      entityId: created.delegation.id,
      after: { ...created.delegation, derogationId: created.derogation.id },
    });

    return created;
  }

  /** Révoque la suppléance ET sa dérogation — les deux doivent cesser ensemble. */
  async revoke(id: string, actorId: string) {
    const now = new Date();
    const [delegation] = await this.prisma.$transaction([
      this.prisma.delegation.update({ where: { id }, data: { revokedAt: now } }),
      this.prisma.derogation.updateMany({
        where: { delegationId: id },
        data: { status: DerogationStatus.REVOKED, revokedAt: now },
      }),
    ]);

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.OVERRIDE,
      entityType: 'Delegation',
      entityId: id,
      after: { revokedAt: now },
    });

    return delegation;
  }
}

@Controller('api/internal/delegations')
@RequireRealm(Realm.INTERNAL)
export class DelegationController {
  constructor(private readonly service: DelegationService) {}

  @Get('field-users')
  @Roles(UserRole.DG)
  fieldUsers() {
    return this.service.fieldUsers();
  }

  /** Réservée au DG — seule autorité pour ce type, vérifiée en base (§ 01). */
  @Post()
  @Roles(UserRole.DG)
  create(@Body() dto: CreateDelegationDto, @Req() req: { auth: { sub: string } }) {
    return this.service.create(dto, req.auth.sub);
  }

  @Patch(':id/revoke')
  @Roles(UserRole.DG)
  revoke(@Param('id', ParseUUIDPipe) id: string, @Req() req: { auth: { sub: string } }) {
    return this.service.revoke(id, req.auth.sub);
  }
}
