import {
  BadRequestException,
  Body,
  ConflictException,
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
import { ActorType, AuditAction, GuaranteeStatus, GuaranteeType, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { Realm, RequireRealm, Roles, Screen } from '../common/auth/realm';
import { Page, PaginationQuery, paginate } from '../common/http/pagination.dto';
import { PrismaService } from '../common/prisma/prisma.service';

// ===========================================================================
//  Cycle de vie (ticket #6)
// ===========================================================================

/**
 * Seules ces transitions sont acceptées. Une garantie CONSOMMÉE, ÉCHUE ou
 * ANNULÉE est un état terminal — aucune reprise, la banque a déjà tranché.
 */
const TRANSITIONS: Record<GuaranteeStatus, GuaranteeStatus[]> = {
  PENDING: [GuaranteeStatus.ACTIVE, GuaranteeStatus.CANCELLED],
  ACTIVE: [GuaranteeStatus.CONSUMED, GuaranteeStatus.EXPIRED, GuaranteeStatus.CANCELLED],
  CONSUMED: [],
  EXPIRED: [],
  CANCELLED: [],
};

const LABEL: Record<GuaranteeStatus, string> = {
  PENDING: 'en attente',
  ACTIVE: 'active',
  CONSUMED: 'consommée',
  EXPIRED: 'échue',
  CANCELLED: 'annulée',
};

// ===========================================================================
//  DTO
// ===========================================================================

class CreateGuaranteeDto {
  @IsString() @MaxLength(64) reference!: string;
  @IsUUID() partnerId!: string;
  @IsOptional() @IsUUID() dealId?: string;
  @IsEnum(GuaranteeType) type!: GuaranteeType;

  @Type(() => Number) @IsNumber() @Min(0.0001) amount!: number;
  @IsString() @Length(3, 3) currencyCode!: string;

  @IsOptional() @IsString() @MaxLength(200) issuingBank?: string;
  @IsISO8601() issueDate!: string;
  @IsOptional() @IsISO8601() expiryDate?: string;
}

class TransitionGuaranteeDto {
  @IsEnum(GuaranteeStatus) to!: GuaranteeStatus;
}

class GuaranteeQuery extends PaginationQuery {
  @IsOptional() @IsEnum(GuaranteeStatus) status?: GuaranteeStatus;
  @IsOptional() @IsUUID() partnerId?: string;
}

// ===========================================================================
//  Service
// ===========================================================================

/**
 * Garanties bancaires (ticket #6) — cycle de vie contrôlé, pas une saisie
 * libre : une garantie ACTIVE et non échue déduit l'exposition crédit du
 * client (`v_partner_credit_exposure`, § 11.2), donc ouvre son plafond. Le
 * montant en devise pivot reste dérivé en base par
 * `trg_derive_guarantee_pivot` — jamais saisi ni recalculé ici.
 */
@Injectable()
export class GuaranteesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: GuaranteeQuery): Promise<Page<unknown>> {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      ...(query.search
        ? { reference: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.guarantee.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          partner: { select: { code: true, legalName: true } },
          deal: { select: { id: true, reference: true } },
        },
      }),
      this.prisma.guarantee.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async create(dto: CreateGuaranteeDto, actorId: string) {
    if (dto.dealId) {
      const deal = await this.prisma.deal.findUniqueOrThrow({
        where: { id: dto.dealId },
        select: { clientId: true },
      });
      if (deal.clientId !== dto.partnerId) {
        throw new BadRequestException(
          "L'affaire choisie n'appartient pas au tiers garanti : une garantie ne peut pas se rattacher à l'affaire d'un autre client.",
        );
      }
    }

    const created = await this.prisma.guarantee.create({
      data: {
        reference: dto.reference,
        partnerId: dto.partnerId,
        dealId: dto.dealId ?? null,
        type: dto.type,
        status: GuaranteeStatus.PENDING,
        amount: dto.amount.toFixed(4),
        currencyCode: dto.currencyCode,
        issuingBank: dto.issuingBank ?? null,
        issueDate: new Date(dto.issueDate),
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        recordedById: actorId,
      },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'Guarantee',
      entityId: created.id,
      after: created,
    });

    return created;
  }

  /**
   * Transition de statut — contrôlée, pas une réécriture libre. Le cycle est
   * PENDING → ACTIVE → CONSUMED/EXPIRED, avec ANNULÉE possible tant que rien
   * n'est consommé ni échu. Toute autre transition (ex. reprendre une
   * garantie déjà consommée) est refusée avec le motif.
   */
  async transition(id: string, to: GuaranteeStatus, actorId: string) {
    const guarantee = await this.prisma.guarantee.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });

    if (!TRANSITIONS[guarantee.status].includes(to)) {
      throw new BadRequestException(
        `Transition refusée : une garantie ${LABEL[guarantee.status]} ne peut pas passer à l'état ${LABEL[to]}.`,
      );
    }

    // ⚠️ CONDITIONNÉ AU STATUT LU CI-DESSUS, PAS UN `update` PAR IDENTIFIANT
    //    SEUL. Deux transitions concurrentes sur la même garantie (DG et CFO
    //    par exemple) liraient toutes deux le même statut de départ et
    //    passeraient toutes deux la vérification : sans cette précondition,
    //    la seconde écriture gagnerait en silence et le journal d'audit
    //    prétendrait à tort que les deux venaient du même état.
    const { count } = await this.prisma.guarantee.updateMany({
      where: { id, status: guarantee.status },
      data: { status: to },
    });
    if (count === 0) {
      throw new ConflictException(
        'Le statut de cette garantie a changé entre-temps : relire son état avant de réessayer.',
      );
    }
    const updated = await this.prisma.guarantee.findUniqueOrThrow({ where: { id } });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.UPDATE,
      entityType: 'Guarantee',
      entityId: id,
      before: { status: guarantee.status },
      after: { status: to },
    });

    return updated;
  }
}

// ===========================================================================
//  Contrôleur
// ===========================================================================

@Controller('api/internal/guarantees')
@RequireRealm(Realm.INTERNAL)
export class GuaranteesController {
  constructor(private readonly service: GuaranteesService) {}

  @Get()
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT, UserRole.CCOO)
  @Screen('garanties')
  list(@Query() query: GuaranteeQuery) {
    return this.service.list(query);
  }

  @Post()
  @Roles(UserRole.DG, UserRole.FINANCE_CFO)
  create(@Body() dto: CreateGuaranteeDto, @Req() req: { auth: { sub: string } }) {
    return this.service.create(dto, req.auth.sub);
  }

  @Patch(':id/statut')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO)
  transition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionGuaranteeDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.transition(id, dto.to, req.auth.sub);
  }
}
