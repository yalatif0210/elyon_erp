import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ActorType, AuditAction, FiscalYearStatus, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { Realm, RequireRealm, Roles, Screen } from '../common/auth/realm';
import { PrismaService } from '../common/prisma/prisma.service';

// ===========================================================================
//  Cycle de vie (ticket #7)
//
//  Réponse du Directeur Financier (question posée en session, faute de
//  clarification actée pendant l'exploration de domaine) : un exercice ne
//  clôture qu'après sa date de fin, et dans l'ordre chronologique. Rouvrir
//  un exercice clos reste possible mais réservé au DG, avec un motif
//  explicite tracé.
// ===========================================================================

const LABEL: Record<FiscalYearStatus, string> = {
  PLANNED: 'en préparation',
  OPEN: 'ouvert',
  CLOSED: 'clos',
};

// ===========================================================================
//  DTO
// ===========================================================================

class CreateFiscalYearDto {
  @Type(() => Number) @IsInt() year!: number;
  @IsString() @MaxLength(48) label!: string;
  @IsISO8601() startsOn!: string;
  @IsISO8601() endsOn!: string;
  @IsOptional() @IsBoolean() isCurrent?: boolean;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class TransitionFiscalYearDto {
  @IsEnum(FiscalYearStatus) to!: FiscalYearStatus;

  /** Obligatoire pour rouvrir un exercice clos — jamais pour les autres transitions. */
  @IsOptional() @IsString() @MinLength(10) @MaxLength(1000) reason?: string;
}

// ===========================================================================
//  Service
// ===========================================================================

/**
 * Exercices fiscaux (ticket #7) — cycle de vie contrôlé, pas une saisie
 * libre : PLANNED → OPEN → CLOSED, avec réouverture possible mais réservée
 * au DG et tracée. Le verrou existant (`refuse_ecriture_exercice_clos`, SQL)
 * continue seul de protéger les données budgétaires d'un exercice clos —
 * cet écran ne fait qu'ajouter un contrôle sur la transition elle-même.
 */
@Injectable()
export class FiscalYearsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.fiscalYear.findMany({
      orderBy: { year: 'desc' },
      select: {
        id: true,
        year: true,
        label: true,
        startsOn: true,
        endsOn: true,
        status: true,
        isCurrent: true,
      },
    });
  }

  /**
   * Seule voie de création (ticket #10 — retirée du moteur générique de
   * paramétrage). Un exercice naît toujours PLANNED : jamais de statut reçu
   * ici, sous peine de recréer la saisie libre que ce module referme.
   *
   * ⚠️ IDEMPOTENT SUR LE MILLÉSIME, JAMAIS SUR LE STATUT NI SUR `isCurrent`
   *    QUAND IL N'EST PAS FOURNI.
   *
   *    Recréer un exercice existant met à jour son descriptif (label,
   *    bornes, notes) mais NE TOUCHE JAMAIS `status` : sinon republier le
   *    même millésime rouvrirait silencieusement un exercice clos, exactement
   *    le contournement que la réouverture réservée au DG (avec motif) est
   *    censée empêcher. `isCurrent` obéit à la même prudence pour une autre
   *    raison : l'écran de création ne l'envoie jamais, et l'omettre ne doit
   *    pas éteindre en silence l'exercice réellement courant le jour où
   *    quelqu'un republie son millésime pour corriger un simple libellé.
   */
  async create(dto: CreateFiscalYearDto, actorId: string) {
    const descriptif = {
      label: dto.label,
      startsOn: new Date(dto.startsOn),
      endsOn: new Date(dto.endsOn),
      notes: dto.notes ?? null,
    };
    const created = await this.prisma.fiscalYear.upsert({
      where: { year: dto.year },
      update: {
        ...descriptif,
        ...(dto.isCurrent !== undefined ? { isCurrent: dto.isCurrent } : {}),
      },
      create: { year: dto.year, authorId: actorId, isCurrent: dto.isCurrent ?? false, ...descriptif },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'FiscalYear',
      entityId: created.id,
      after: created,
    });

    return created;
  }

  /**
   * Transition contrôlée — voir la note de cycle de vie en tête de fichier.
   *
   * ⚠️ CONDITIONNÉE AU STATUT LU, PAS UN `update` PAR IDENTIFIANT SEUL.
   *    Même précaution que `GuaranteesService.transition` : deux appels
   *    concurrents sur le même exercice ne doivent pas tous deux réussir
   *    contre le même état de départ.
   */
  async transition(id: string, to: FiscalYearStatus, reason: string | undefined, actorId: string, role: UserRole) {
    const fy = await this.prisma.fiscalYear.findUniqueOrThrow({
      where: { id },
      select: { status: true, year: true, endsOn: true },
    });

    if (fy.status === FiscalYearStatus.PLANNED && to === FiscalYearStatus.OPEN) {
      // Aucune condition supplémentaire : passer en courant est un choix de gestion.
    } else if (fy.status === FiscalYearStatus.OPEN && to === FiscalYearStatus.CLOSED) {
      if (fy.endsOn.getTime() > Date.now()) {
        throw new BadRequestException(
          `L'exercice ${fy.year} ne peut pas être clos avant sa date de fin (${fy.endsOn.toISOString().slice(0, 10)}).`,
        );
      }
      const anterieurOuvert = await this.prisma.fiscalYear.findFirst({
        where: { year: { lt: fy.year }, status: FiscalYearStatus.OPEN },
        select: { year: true },
      });
      if (anterieurOuvert) {
        throw new BadRequestException(
          `L'exercice ${anterieurOuvert.year} est encore ouvert : les exercices se clôturent dans l'ordre chronologique.`,
        );
      }
    } else if (fy.status === FiscalYearStatus.CLOSED && to === FiscalYearStatus.OPEN) {
      if (role !== UserRole.DG) {
        throw new ForbiddenException('Rouvrir un exercice clos est réservé au DG.');
      }
      if (!reason) {
        throw new BadRequestException(
          "Rouvrir un exercice clos exige un motif explicite d'au moins 10 caractères : ce n'est jamais un effet de bord d'une saisie.",
        );
      }
    } else {
      throw new BadRequestException(
        `Transition refusée : un exercice ${LABEL[fy.status]} ne peut pas passer à l'état ${LABEL[to]}.`,
      );
    }

    const { count } = await this.prisma.fiscalYear.updateMany({
      where: { id, status: fy.status },
      data: { status: to },
    });
    if (count === 0) {
      throw new ConflictException(
        "Le statut de cet exercice a changé entre-temps : relire son état avant de réessayer.",
      );
    }
    const updated = await this.prisma.fiscalYear.findUniqueOrThrow({ where: { id } });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.UPDATE,
      entityType: 'FiscalYear',
      entityId: id,
      before: { status: fy.status },
      after: { status: to, reason: reason ?? null },
    });

    return updated;
  }
}

// ===========================================================================
//  Contrôleur
// ===========================================================================

@Controller('api/internal/fiscal-years')
@RequireRealm(Realm.INTERNAL)
export class FiscalYearsController {
  constructor(private readonly service: FiscalYearsService) {}

  @Get()
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO, UserRole.ACCOUNTANT)
  @Screen('exercices-fiscaux')
  list() {
    return this.service.list();
  }

  @Post()
  @Roles(UserRole.DG, UserRole.FINANCE_CFO)
  create(@Body() dto: CreateFiscalYearDto, @Req() req: { auth: { sub: string } }) {
    return this.service.create(dto, req.auth.sub);
  }

  @Patch(':id/statut')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO)
  transition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionFiscalYearDto,
    @Req() req: { auth: { sub: string; role: UserRole } },
  ) {
    return this.service.transition(id, dto.to, dto.reason, req.auth.sub, req.auth.role);
  }
}
