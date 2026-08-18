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
  ActorType,
  AuditAction,
  CommercialSegment,
  MeasurementSource,
  OperationStatus,
  SourcingMode,
  TransportMode,
  UnitOfMeasure,
  UserRole,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { Realm, RequireRealm, Roles, Screen } from '../common/auth/realm';
import { Page, PaginationQuery, paginate } from '../common/http/pagination.dto';
import { PrismaService } from '../common/prisma/prisma.service';
import { AstmService } from '../common/volumes/astm.service';
import { MarginService } from '../sales/margin.service';
import { ReferenceService } from '../common/reference/reference.service';

// ===========================================================================
//  DTO
// ===========================================================================

/**
 * Origine TERRAIN d'une écriture.
 *
 * `User` et `FieldUser` sont deux tables séparées — c'est le cloisonnement des
 * réalms (§ 1.4). Une écriture venue de la tablette doit donc porter son
 * auteur dans la colonne du bon réalm, faute de quoi la clé étrangère
 * désignerait un compte inexistant ou, pire, un homonyme interne.
 */
export interface FieldOrigin {
  fieldUserId: string;
}

class CreateOperationDto {
  /**
   * Le verrou financier est en base : créer une opération sur un deal non
   * approuvé sera refusé par PostgreSQL, pas par ce DTO (§ 11.2).
   */
  @IsUUID() dealId!: string;

  @Type(() => Number) @IsNumber() @Min(0.000001) plannedVolume!: number;
  @IsEnum(UnitOfMeasure) uom!: UnitOfMeasure;
  @IsEnum(TransportMode) transportMode!: TransportMode;
  @IsOptional() @IsEnum(SourcingMode) sourcingMode?: SourcingMode;

  /**
   * TYPES portés par l'opération, DANS L'ORDRE DU DÉROULÉ (§ 7.1).
   *
   * Une opération peut en porter plusieurs — commencer par un transport
   * routier et se terminer par un soutage à quai — et reçoit alors l'union
   * des contrôles HSE de chacun. C'est par eux, et par eux seuls, que la
   * checklist est indexée : sans type, aucun contrôle ne s'oppose, et la base
   * refuse de faire avancer l'opération.
   */
  @IsArray()
  @ArrayNotEmpty({ message: 'Indiquer au moins un type d’opération.' })
  @IsUUID('4', { each: true })
  operationTypeIds!: string[];

  @IsString() @MaxLength(200) originLocation!: string;
  @IsString() @MaxLength(200) destinationLocation!: string;
  @IsOptional() @IsUUID() destinationSiteId?: string;

  /**
   * SITE DE CHARGEMENT — le lieu d'où part le produit (§ 6.2).
   *
   * Facultatif comme la destination : toutes les origines ne sont pas des
   * lieux référencés. Mais dès qu'il l'est, ses exigences s'opposent — un
   * badge d'accès se retire pour charger comme pour livrer.
   */
  @IsOptional() @IsUUID() originSiteId?: string;
  @IsOptional() @IsISO8601() plannedLoadingDate?: string;

  /** Propriétaire du produit en transport pour compte de tiers. */
  @IsOptional() @IsUUID() productOwnerId?: string;
  @IsOptional() @IsUUID() fieldAgentId?: string;
}

class AssignMeansDto {
  @IsOptional() @IsUUID() carrierId?: string;
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsUUID() driverId?: string;
  @IsOptional() @IsString() @MaxLength(120) vehicleIdentifier?: string;

  @Type(() => Number) @IsNumber() @Min(0) freightCost!: number;
  @IsString() @Length(3, 3) currencyCode!: string;

  /** Obligatoire si l'un des moyens est non conforme — DG seul (§ 11.2). */
  @IsOptional() @IsUUID() complianceDerogationId?: string;

  /**
   * Motif de l'écart au TARIF NÉGOCIÉ du transporteur (§ 5.4).
   *
   * Exigé par la base au-delà de la tolérance du tarif — laquelle vaut 0 par
   * défaut, règle stricte. Le montant reste saisissable : un déroutement, une
   * attente facturée existent. Ce qui est proscrit, c'est l'écart silencieux.
   */
  @IsOptional() @IsString() @MaxLength(500) freightVarianceReason?: string;
}

export class TransitionDto {
  @IsEnum(OperationStatus) to!: OperationStatus;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

class AttachHseDerogationDto {
  @IsUUID() derogationId!: string;
}

class CostLineDto {
  @IsUUID() costPostId!: string;
  @IsOptional() @IsString() @MaxLength(255) description?: string;
  @IsOptional() @IsUUID() supplierId?: string;

  @Type(() => Number) @IsNumber() @Min(0) estimatedAmount!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) actualAmount?: number;

  @IsString() @Length(3, 3) currencyCode!: string;
  @IsOptional() @IsISO8601() incurredAt?: string;
}

export class MeasurementDto {
  @IsEnum(MeasurementSource) source!: MeasurementSource;
  @IsOptional() @IsBoolean() isAuthoritative?: boolean;
  @IsOptional() @IsUUID() inspectorId?: string;
  @IsISO8601() measurementDate!: string;

  /**
   * CE QUI A ÉTÉ RELEVÉ, aux deux bouts — volume à la jauge et température.
   *
   * ⚠️ La température est OBLIGATOIRE (§ 8.2). Sans elle, aucun volume ne peut
   *    être ramené à 15 °C, et deux relevés pris à des températures
   *    différentes ne sont tout simplement pas comparables. Un chargement à
   *    32 °C et une livraison à 26 °C affichent 0,48 % d'écart à masse
   *    constante — plus du double du seuil critique.
   */
  @Type(() => Number) @IsNumber() @Min(0.000001) loadedObservedVolume!: number;
  @Type(() => Number) @IsNumber() loadedTempC!: number;
  @Type(() => Number) @IsNumber() @Min(0.000001) dischargedObservedVolume!: number;
  @Type(() => Number) @IsNumber() dischargedTempC!: number;

  @IsEnum(UnitOfMeasure) uom!: UnitOfMeasure;
  @Type(() => Number) @IsNumber() @Min(0) measuredDensity15!: number;
  @IsOptional() @IsBoolean() isOffSpec?: boolean;
}

/**
 * Ce qui a été fait, concrètement : « badge n° 4471 retiré le 06/08 ».
 *
 * La note est facultative — certaines exigences se lèvent sans référence à
 * citer — mais elle est le seul moyen de savoir, six mois plus tard, sur quoi
 * l'acquittement reposait.
 */
export class AcknowledgeSiteRequirementDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class AcknowledgeUllageDto {
  /** Un acquittement sans motif circonstancié n'est pas un acquittement. */
  @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
  @IsOptional() @IsUUID() derogationId?: string;
}

class OperationQuery extends PaginationQuery {
  @IsOptional() @IsEnum(OperationStatus) status?: OperationStatus;
  @IsOptional() @IsUUID() dealId?: string;
}

// ===========================================================================
//  Service
// ===========================================================================

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reference: ReferenceService,
    private readonly astm: AstmService,
    private readonly margins: MarginService,
  ) {}

  async list(query: OperationQuery): Promise<Page<unknown>> {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.dealId ? { dealId: query.dealId } : {}),
      ...(query.search
        ? { reference: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.operation.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          deal: {
            select: {
              reference: true,
              client: { select: { code: true, legalName: true } },
              product: { select: { code: true, name: true } },
            },
          },
          assignment: {
            select: { vehicleIdentifier: true, vehicle: { select: { registration: true } } },
          },
          fieldAgent: { select: { fullName: true } },
          _count: { select: { hseChecks: true, measurements: true, costLines: true } },
        },
      }),
      this.prisma.operation.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async findOne(id: string) {
    const operation = await this.prisma.operation.findUniqueOrThrow({
      where: { id },
      include: {
        deal: {
          select: {
            id: true,
            reference: true,
            status: true,
            unitSalePrice: true,
            currencyCode: true,
            client: { select: { code: true, legalName: true } },
            product: { select: { code: true, name: true } },
          },
        },
        productOwner: { select: { code: true, legalName: true } },
        assignment: {
          include: {
            // Le statut de conformité ne se stocke pas sur le moyen : il se
            // DÉRIVE des pièces à échéance. On remonte donc les pièces
            // bloquantes, seule source de vérité (§ 6.4).
            carrier: {
              select: {
                code: true,
                legalName: true,
                complianceRecords: {
                  where: { isBlocking: true },
                  select: { type: true, reference: true, status: true, expiryDate: true },
                },
              },
            },
            vehicle: {
              select: {
                registration: true,
                complianceRecords: {
                  where: { isBlocking: true },
                  select: { type: true, reference: true, status: true, expiryDate: true },
                },
              },
            },
            driver: {
              select: {
                fullName: true,
                complianceRecords: {
                  where: { isBlocking: true },
                  select: { type: true, reference: true, status: true, expiryDate: true },
                },
              },
            },
            complianceDerogation: true,
          },
        },
        // Types portés, DANS L'ORDRE DU DÉROULÉ : c'est par eux que les
        // contrôles HSE sont indexés, et l'ordre est celui annoncé à la
        // création — transport routier puis soutage à quai, pas l'inverse.
        operationTypes: {
          orderBy: { sequence: 'asc' },
          select: {
            sequence: true,
            operationType: { select: { id: true, code: true, label: true, description: true } },
          },
        },
        // Exigences du SITE de livraison — exposées partout où le site
        // apparaît (§ 6.2). Elles se saisissent au référentiel des sites ;
        // ici on les LIT, avec ce qui a déjà été acquitté pour cette
        // opération. Une exigence bloquante non levée empêche le départ.
        destinationSite: {
          select: {
            id: true, code: true, name: true, city: true,
            site: {
              select: {
                id: true, code: true, name: true,
                accessInstructions: true, openingHours: true, safetyInstructions: true,
                requirements: {
                  where: { isActive: true },
                  orderBy: { type: { displayOrder: 'asc' } },
                  select: {
                    id: true, detail: true, isBlocking: true,
                    type: { select: { code: true, label: true } },
                  },
                },
              },
            },
          },
        },
        // Site de CHARGEMENT — le lieu directement, avec ses exigences.
        originSite: {
          select: {
            id: true, code: true, name: true, city: true, usages: true,
            accessInstructions: true, openingHours: true, safetyInstructions: true,
            requirements: {
              where: { isActive: true },
              orderBy: { type: { displayOrder: 'asc' } },
              select: {
                id: true, detail: true, isBlocking: true,
                type: { select: { code: true, label: true } },
              },
            },
          },
        },
        siteRequirementAcks: {
          select: {
            requirementId: true,
            note: true,
            acknowledgedAt: true,
            acknowledgedBy: { select: { fullName: true } },
          },
        },
        fieldAgent: { select: { fullName: true, role: true } },
        hseValidatedBy: { select: { fullName: true, role: true } },
        hseValidatedByUser: { select: { fullName: true, role: true } },
        hseDerogation: true,
        hseChecks: {
          include: {
            template: { select: { code: true, label: true, version: true } },
            items: {
              include: { item: { select: { code: true, label: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        measurements: { orderBy: { measurementDate: 'desc' } },
        costLines: {
          include: {
            costPost: { select: { code: true, label: true, nature: true } },
            supplier: { select: { code: true, legalName: true } },
          },
        },
        purchaseOrder: true,
        statusTransitions: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });

    return { ...operation, hseGate: await this.hseGate(id) };
  }

  /**
   * État du verrou HSE, tel que la base l'appliquera.
   *
   * Le calcul est le MÊME que celui du trigger — il sert à afficher la
   * situation avant la tentative, pas à décider. La décision reste en base.
   */
  async hseGate(operationId: string) {
    const operation = await this.prisma.operation.findUniqueOrThrow({
      where: { id: operationId },
      select: { hseValidatedById: true, hseValidatedByUserId: true, hseDerogationId: true },
    });
    const pending = await this.prisma.operationHseCheckItem.count({
      where: {
        check: { operationId },
        level: 'BLOCKING',
        outcome: { not: 'PASSED' },
      },
    });
    const validated =
      operation.hseValidatedById !== null || operation.hseValidatedByUserId !== null;
    const open = operation.hseDerogationId !== null || (validated && pending === 0);

    return {
      open,
      validated,
      pendingBlockingItems: pending,
      byDerogation: operation.hseDerogationId !== null,
      message: open
        ? 'Verrou HSE ouvert : le chargement est autorisé.'
        : !validated
          ? 'Verrou HSE fermé : la checklist n’a pas été validée par le contrôleur HSE.'
          : `Verrou HSE fermé : ${pending} contrôle(s) bloquant(s) non satisfait(s).`,
    };
  }

  async create(dto: CreateOperationDto, actorId: string) {
    const reference = await this.reference.annual('OP');

    const created = await this.prisma.operation.create({
      data: {
        reference,
        dealId: dto.dealId,
        status: OperationStatus.DRAFT,
        sourcingMode: dto.sourcingMode ?? SourcingMode.BACK_TO_BACK,
        productOwnerId: dto.productOwnerId ?? null,
        plannedVolume: dto.plannedVolume.toFixed(6),
        uom: dto.uom,
        transportMode: dto.transportMode,
        originLocation: dto.originLocation,
        originSiteId: dto.originSiteId ?? null,
        destinationSiteId: dto.destinationSiteId ?? null,
        destinationLocation: dto.destinationLocation,
        plannedLoadingDate: dto.plannedLoadingDate ? new Date(dto.plannedLoadingDate) : null,
        fieldAgentId: dto.fieldAgentId ?? null,
        coordinatorId: actorId,
        // Le rang suit l'ordre de saisie : c'est le déroulé annoncé, et il
        // détermine l'ordre dans lequel les checklists sont présentées à
        // l'agent. Un rang recalculé par ordre alphabétique ou par identifiant
        // présenterait le soutage avant le transport qui l'amène.
        operationTypes: {
          create: dto.operationTypeIds.map((operationTypeId, index) => ({
            operationTypeId,
            sequence: index + 1,
          })),
        },
      },
      include: { operationTypes: { include: { operationType: true } } },
    });

    await this.prisma.operationStatusTransition.create({
      data: {
        operationId: created.id,
        toStatus: OperationStatus.DRAFT,
        actorType: ActorType.INTERNAL_USER,
        actorId,
        reason: 'Création de l’opération',
      },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'Operation',
      entityId: created.id,
      after: created,
    });

    return created;
  }

  /**
   * Affectation des moyens — porte le verrou de conformité.
   *
   * Rien n'est vérifié ici : le trigger `enforce_assignment_compliance` lit
   * le statut de conformité dérivé des pièces à échéance et refuse
   * l'affectation sans dérogation du DG.
   */
  async assign(operationId: string, dto: AssignMeansDto, actorId: string) {
    const data = {
      carrierId: dto.carrierId ?? null,
      vehicleId: dto.vehicleId ?? null,
      driverId: dto.driverId ?? null,
      vehicleIdentifier: dto.vehicleIdentifier ?? null,
      freightCost: dto.freightCost.toFixed(4),
      currencyCode: dto.currencyCode,
      freightVarianceReason: dto.freightVarianceReason ?? null,
      complianceDerogationId: dto.complianceDerogationId ?? null,
      assignedById: actorId,
      assignedAt: new Date(),
    };

    const assignment = await this.prisma.operationAssignment.upsert({
      where: { operationId },
      update: data,
      create: { operationId, ...data },
    });

    // ⚠️ LE FRET DOIT ENTRER DANS LA MARGE.
    //
    //    Il était stocké ici et lu nulle part : `directChargesForDeal` ne lit
    //    que les lignes de coût. Le PRINCIPAL coût direct d'une opération de
    //    transport était donc absent de toute marge, sauf ressaisie manuelle —
    //    laquelle produisait alors un double comptage, puisque rien ne reliait
    //    les deux saisies.
    //
    //    On matérialise donc une ligne de coût SYSTÈME, reconnaissable et
    //    unique : elle est mise à jour quand l'affectation change, jamais
    //    dupliquée. Une ligne saisie à la main par quelqu'un qui aurait
    //    ressaisi le fret reste distincte — le rapprochement des coûts la fera
    //    apparaître comme un écart, ce qui est le bon endroit pour la voir.
    await this.materialiseFret(operationId, dto);

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.UPDATE,
      entityType: 'OperationAssignment',
      entityId: assignment.id,
      after: assignment,
    });

    return assignment;
  }

  /**
   * Changement d'état. Le verrou HSE se déclenche ici — sur le passage à
   * LOADING et au-delà — et c'est PostgreSQL qui refuse, pas ce code.
   */
  async transition(
    operationId: string,
    dto: TransitionDto,
    actorId: string,
    origine?: FieldOrigin,
  ) {
    const current = await this.prisma.operation.findUniqueOrThrow({
      where: { id: operationId },
      select: { status: true },
    });

    // L'auteur peut venir du TERRAIN. Les deux réalms sont deux tables
    // distinctes : écrire un identifiant d'agent dans la colonne des
    // utilisateurs internes attribuerait l'avancement à un compte qui n'existe
    // pas, et le journal d'exécution désignerait la mauvaise personne.
    const acteur = origine?.fieldUserId
      ? { type: ActorType.FIELD_USER, id: origine.fieldUserId }
      : { type: ActorType.INTERNAL_USER, id: actorId };

    const updated = await this.prisma.operation.update({
      where: { id: operationId },
      data: {
        status: dto.to,
        ...(dto.to === OperationStatus.LOADING ? { actualLoadingDate: new Date() } : {}),
        ...(dto.to === OperationStatus.DELIVERING ? { actualDischargeDate: new Date() } : {}),
        ...(dto.to === OperationStatus.CLOSED ? { closedAt: new Date() } : {}),
        ...(dto.to === OperationStatus.CANCELLED ? { cancellationReason: dto.reason ?? null } : {}),
      },
    });

    await this.prisma.operationStatusTransition.create({
      data: {
        operationId,
        fromStatus: current.status,
        toStatus: dto.to,
        actorType: acteur.type,
        actorId: acteur.id,
        reason: dto.reason ?? null,
      },
    });

    await this.audit.record({
      actorType: acteur.type,
      actorId: acteur.id,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'Operation',
      entityId: operationId,
      before: { status: current.status },
      after: { status: dto.to },
    });

    return updated;
  }

  /**
   * Rattache une dérogation HSE_BLOCKING_OVERRIDE à l'opération — LE SEUL
   * moyen de lever un verrou HSE que rien, sur le terrain, ne peut satisfaire
   * (§ 11.2).
   *
   * ⚠️ CORRIGÉ — `hseDerogationId` N'ÉTAIT ÉCRIT NULLE PART.
   *
   *    Le trigger `enforce_hse_gate_before_loading` (§ 05) sait depuis
   *    toujours lever le verrou sur une dérogation opposable — c'est même la
   *    branche par laquelle il commence. Mais aucun code applicatif n'écrivait
   *    jamais cette colonne : une opération bloquée par un point HSE
   *    réellement irrattrapable (équipement manquant qu'on ne peut pas faire
   *    apparaître sur site) n'avait AUCUNE issue. Pas de repli, pas de geste
   *    de rattrapage — le seul chemin prévu par la base restait inatteignable.
   *
   *    Rien n'est validé ICI à dessein : la dérogation doit exister (créée au
   *    préalable via `POST /derogations`, type HSE_BLOCKING_OVERRIDE), et
   *    c'est le TRIGGER, au prochain changement de statut, qui décidera si
   *    elle est réellement opposable — actif, non révoquée, non expirée, et
   *    posée sur cette opération précise si elle désigne un sujet. Dupliquer
   *    ce contrôle ici lui donnerait une seconde version, vouée à diverger.
   */
  async attachHseDerogation(operationId: string, derogationId: string, actorId: string) {
    const updated = await this.prisma.operation.update({
      where: { id: operationId },
      data: { hseDerogationId: derogationId },
      select: { id: true, reference: true, hseDerogationId: true },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.OVERRIDE,
      entityType: 'Operation',
      entityId: operationId,
      after: { hseDerogationId: derogationId },
    });

    return updated;
  }

  /**
   * Ligne de coût.
   *
   * ⚠️ Les postes calculés par le système — portage, perte de volume — ne
   *    passent pas par ici : `isSystemComputed` reste faux et la base refuse
   *    qu'on le force depuis l'extérieur.
   */
  async addCostLine(operationId: string, dto: CostLineDto, actorId: string) {
    // La charge se compare au prix de vente : il faut donc la ramener dans la
    // devise de l'affaire, et figer le cours employé.
    const operation = await this.prisma.operation.findUniqueOrThrow({
      where: { id: operationId },
      select: { dealId: true, deal: { select: { currencyCode: true } } },
    });
    const coursVersAffaire = await this.margins.rateBetween(
      dto.currencyCode,
      operation.deal.currencyCode,
    );

    const line = await this.prisma.operationCostLine.create({
      data: {
        operationId,
        costPostId: dto.costPostId,
        description: dto.description ?? null,
        supplierId: dto.supplierId ?? null,
        estimatedAmount: dto.estimatedAmount.toFixed(4),
        actualAmount: dto.actualAmount?.toFixed(4) ?? null,
        currencyCode: dto.currencyCode,
        // Cours FIGÉ vers la devise de l'affaire : c'est lui qui rend la
        // charge comparable au prix de vente, et il ne doit plus bouger.
        fxRateToDeal: coursVersAffaire.toFixed(8),
        incurredAt: dto.incurredAt ? new Date(dto.incurredAt) : null,
      },
    });

    // Les coûts réels doivent remonter sur l'affaire SANS qu'on le demande.
    // `recomputeMargins` n'était appelé que par un endpoint dédié : une
    // opération qui dérapait de 20 % sur le fret ne modifiait aucune marge
    // affichée tant que personne n'y pensait.
    await this.margins.recompute(operation.dealId);

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'OperationCostLine',
      entityId: line.id,
      after: line,
    });

    return line;
  }

  /**
   * TARIF PROPOSÉ pour affecter les moyens.
   *
   * Sert à orienter AVANT la saisie : afficher le tarif au moment du refus ne
   * guide personne — c'est le défaut qui avait été corrigé sur le barème de
   * coûts, et il valait aussi ici. Conserver la proposition doit être le geste
   * par défaut ; s'en écarter reste possible, mais se motive.
   *
   * Rendu POUR CHAQUE TRANSPORTEUR conforme, avec son tarif s'il en a un : le
   * coordinateur choisit alors en connaissant le coût, au lieu de choisir puis
   * de découvrir.
   */
  async freightGuidance(operationId: string) {
    const op = await this.prisma.operation.findUniqueOrThrow({
      where: { id: operationId },
      select: {
        transportMode: true,
        plannedVolume: true,
        destinationSite: { select: { siteId: true } },
        deal: { select: { productId: true, currencyCode: true } },
      },
    });

    const transporteurs = await this.prisma.partner.findMany({
      where: { type: 'CARRIER', isActive: true },
      orderBy: { legalName: 'asc' },
      select: { id: true, code: true, legalName: true },
    });

    const volume = Number(op.plannedVolume);

    return Promise.all(
      transporteurs.map(async (t) => {
        const [tarif] = await this.prisma.$queryRaw<
          {
            tariff_id: string;
            basis: string;
            amount: string;
            currency_code: string;
            uom: string | null;
            tolerance_pct: string | null;
          }[]
        >`SELECT * FROM resolve_carrier_tariff(
            ${t.id}::uuid, ${op.transportMode}::text, ${op.deal.productId}::uuid,
            ${op.destinationSite?.siteId ?? null}::uuid, CURRENT_DATE)`;

        // Conformité du moyen : un transporteur non conforme ne s'affecte pas
        // sans dérogation, et le savoir AVANT de le choisir évite un aller-retour.
        const [conformite] = await this.prisma.$queryRaw<{ is_compliant: boolean }[]>`
          SELECT is_compliant FROM v_transport_compliance
           WHERE subject_kind = 'CARRIER' AND subject_id = ${t.id}::uuid`;

        if (!tarif) {
          return {
            carrierId: t.id,
            code: t.code,
            name: t.legalName,
            isCompliant: conformite?.is_compliant ?? true,
            // Pas de grille : ce n'est pas bloquant — il faut pouvoir rouler
            // avec un transporteur d'appoint un jour de rupture — mais ça se
            // voit, et la grille doit être complétée.
            tariff: null,
          };
        }

        const montant =
          tarif.basis === 'PER_UNIT' ? Number(tarif.amount) * volume : Number(tarif.amount);

        return {
          carrierId: t.id,
          code: t.code,
          name: t.legalName,
          isCompliant: conformite?.is_compliant ?? true,
          tariff: {
            id: tarif.tariff_id,
            basis: tarif.basis,
            unitAmount: Number(tarif.amount),
            uom: tarif.uom,
            currencyCode: tarif.currency_code,
            // Ce que le tarif donne POUR CETTE OPÉRATION : c'est le chiffre
            // que le coordinateur doit comparer, pas le tarif unitaire.
            expectedAmount: round6(montant),
            tolerancePct: tarif.tolerance_pct === null ? 0 : Number(tarif.tolerance_pct),
          },
        };
      }),
    );
  }

  /**
   * ACQUITTEMENT d'une exigence de site.
   *
   * Une exigence bloquante non levée empêche le départ. L'acquittement dit
   * « c'est fait », et il porte QUI l'a dit : c'est la différence entre une
   * consigne lue et une consigne suivie.
   */
  async acknowledgeSiteRequirement(
    operationId: string,
    requirementId: string,
    note: string | undefined,
    actorId: string,
  ) {
    // Le rattachement est vérifié : une exigence d'un AUTRE site acquittée ici
    // lèverait un verrou qui ne la concerne pas.
    // Le rattachement est vérifié sur les DEUX bouts : l'exigence peut venir
    // du site de chargement comme du site de livraison. Une exigence d'un
    // AUTRE site acquittée ici lèverait un verrou qui ne la concerne pas.
    const rattachee = await this.prisma.siteRequirement.findFirst({
      where: {
        id: requirementId,
        site: {
          OR: [
            { partnerSites: { some: { operationsAsDestination: { some: { id: operationId } } } } },
            { operationsAsOrigin: { some: { id: operationId } } },
          ],
        },
      },
      select: { id: true },
    });
    if (!rattachee) {
      throw new BadRequestException(
        "Cette exigence n'appartient ni au site de chargement, ni au site de livraison de cette opération.",
      );
    }

    const ack = await this.prisma.operationSiteRequirementAck.upsert({
      where: { operationId_requirementId: { operationId, requirementId } },
      update: { note: note ?? null, acknowledgedById: actorId, acknowledgedAt: new Date() },
      create: { operationId, requirementId, note: note ?? null, acknowledgedById: actorId },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.APPROVE,
      entityType: 'OperationSiteRequirementAck',
      entityId: ack.id,
      after: { operationId, requirementId, note },
    });

    return ack;
  }

  /**
   * Ligne de coût portant le fret de l'affectation.
   *
   * `isSystemComputed` la distingue d'une saisie humaine : la base refuse
   * qu'on force ce drapeau depuis l'extérieur, et le rapprochement des coûts
   * sait donc qu'aucun fournisseur ne la facturera séparément.
   *
   * Le poste employé vient du RÉFÉRENTIEL, par son code. S'il a été désactivé
   * ou renommé, on ne matérialise rien plutôt que d'inventer un poste : une
   * charge rattachée à un poste fantôme fausserait tous les regroupements.
   */
  private async materialiseFret(operationId: string, dto: AssignMeansDto): Promise<void> {
    const poste = await this.prisma.costPost.findFirst({
      where: { code: 'TRANSPORT', isActive: true },
      select: { id: true },
    });
    if (!poste) return;

    const operation = await this.prisma.operation.findUniqueOrThrow({
      where: { id: operationId },
      select: { dealId: true, deal: { select: { currencyCode: true } } },
    });
    const cours = await this.margins.rateBetween(dto.currencyCode, operation.deal.currencyCode);

    const existante = await this.prisma.operationCostLine.findFirst({
      where: { operationId, costPostId: poste.id, isSystemComputed: true },
      select: { id: true },
    });

    const donnees = {
      description: 'Fret transporteur — affectation des moyens',
      supplierId: dto.carrierId ?? null,
      estimatedAmount: dto.freightCost.toFixed(4),
      actualAmount: dto.freightCost.toFixed(4),
      currencyCode: dto.currencyCode,
      fxRateToDeal: cours.toFixed(8),
    };

    if (existante) {
      await this.prisma.operationCostLine.update({ where: { id: existante.id }, data: donnees });
    } else {
      await this.prisma.operationCostLine.create({
        data: { operationId, costPostId: poste.id, isSystemComputed: true, ...donnees },
      });
    }

    await this.margins.recompute(operation.dealId);
  }

  /**
   * Relevé de mesure.
   *
   * L'écart d'ullage est CALCULÉ ici et re-vérifié par un CHECK en base : il
   * ne se déclare pas. Les seuils applicables sont figés au moment du relevé —
   * une grille révisée ensuite ne doit pas requalifier un écart déjà acquitté.
   */
  async recordMeasurement(
    operationId: string,
    dto: MeasurementDto,
    actorId: string,
    origine?: FieldOrigin,
  ) {
    const operation = await this.prisma.operation.findUniqueOrThrow({
      where: { id: operationId },
      select: { transportMode: true, deal: { select: { productId: true, segment: true } } },
    });

    // ⚠️ LES VOLUMES À 15 °C SONT CALCULÉS ICI, PAS REÇUS.
    //
    //    Ils étaient pris tels quels de la tablette, dans des champs nommés
    //    « à 15 °C » que rien ne corrigeait. L'écart d'ullage mesurait alors la
    //    dilatation du produit autant que la perte réelle — et on ne savait
    //    pas dire dans quelle proportion.
    const chargement = this.astm.corrige(
      dto.loadedObservedVolume, dto.loadedTempC, dto.measuredDensity15);
    const livraison = this.astm.corrige(
      dto.dischargedObservedVolume, dto.dischargedTempC, dto.measuredDensity15);

    const loadedVolume15 = chargement.volume15;
    const dischargedVolume15 = livraison.volume15;

    const variance = round6(
      ((loadedVolume15 - dischargedVolume15) / loadedVolume15) * 100,
    );

    const tolerance = await this.resolveTolerance(
      operation.deal.productId,
      operation.transportMode,
      operation.deal.segment,
      new Date(dto.measurementDate),
    );

    const alert = tolerance?.alertThresholdPct ? Number(tolerance.alertThresholdPct) : null;
    const critical = tolerance?.criticalThresholdPct
      ? Number(tolerance.criticalThresholdPct)
      : null;

    const reference = await this.reference.annual('MES');

    const record = await this.prisma.measurementRecord.create({
      data: {
        reference,
        operationId,
        source: dto.source,
        isAuthoritative: dto.isAuthoritative ?? false,
        inspectorId: dto.inspectorId ?? null,
        measurementDate: new Date(dto.measurementDate),
        // Résultats de la correction.
        loadedVolume15: loadedVolume15.toFixed(6),
        dischargedVolume15: dischargedVolume15.toFixed(6),
        uom: dto.uom,

        // Ce qui a été relevé, et le facteur appliqué. Les trois sont
        // conservés : sans eux le calcul n'est pas rejouable, et une révision
        // de la table changerait rétroactivement un écart déjà acquitté.
        loadedObservedVolume: dto.loadedObservedVolume.toFixed(6),
        loadedTempC: dto.loadedTempC.toFixed(2),
        loadedVcf: chargement.vcf.toFixed(6),
        dischargedObservedVolume: dto.dischargedObservedVolume.toFixed(6),
        dischargedTempC: dto.dischargedTempC.toFixed(2),
        dischargedVcf: livraison.vcf.toFixed(6),

        // Conservés pour l'historique : ils portaient le relevé « observé »
        // unique de l'ancien modèle, qui ne distinguait pas les deux bouts.
        observedVolume: dto.dischargedObservedVolume.toFixed(6),
        observedTempC: dto.dischargedTempC.toFixed(2),
        measuredDensity15: dto.measuredDensity15.toFixed(6),
        isOffSpec: dto.isOffSpec ?? false,
        ullageVariancePct: variance.toFixed(6),
        toleranceId: tolerance?.id ?? null,
        alertThresholdPct: alert?.toFixed(6) ?? null,
        criticalThresholdPct: critical?.toFixed(6) ?? null,
        // ⚠️ COMPARAISON LARGE, ET NON STRICTE.
        //
        //    Elle était stricte. Or la grille actuelle porte un seuil normal
        //    ÉGAL au seuil d'alerte (0,200000 %) : un écart tombant exactement
        //    dessus ne levait AUCUNE alerte. Un seuil qu'on peut atteindre sans
        //    le déclencher n'est pas un seuil.
        ullageAlertTriggered: alert !== null && variance >= alert,
        ullageCriticalTriggered: critical !== null && variance >= critical,
        // Deux colonnes distinctes, jamais l'une pour l'autre : le relevé
        // contradictoire fait sur le terrain et la saisie faite au bureau
        // n'ont pas la même valeur probante, et la confusion se paierait au
        // moment d'établir qui a mesuré quoi.
        enteredByFieldUserId: origine?.fieldUserId ?? null,
        enteredByUserId: origine?.fieldUserId ? null : actorId,
      },
    });

    await this.audit.record({
      actorType: origine?.fieldUserId ? ActorType.FIELD_USER : ActorType.INTERNAL_USER,
      actorId: origine?.fieldUserId ?? actorId,
      action: AuditAction.CREATE,
      entityType: 'MeasurementRecord',
      entityId: record.id,
      after: record,
    });

    return record;
  }

  /** Acquittement d'un écart — CCOO, CFO ou DG seuls, vérifié en base (§ 8.3). */
  async acknowledgeUllage(measurementId: string, dto: AcknowledgeUllageDto, actorId: string) {
    const updated = await this.prisma.measurementRecord.update({
      where: { id: measurementId },
      data: {
        ullageAckById: actorId,
        ullageAckAt: new Date(),
        ullageAckReason: dto.reason,
        ullageDerogationId: dto.derogationId ?? null,
      },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.APPROVE,
      entityType: 'MeasurementRecord',
      entityId: measurementId,
      after: { ullageAckById: actorId, reason: dto.reason },
    });

    return updated;
  }

  /**
   * Tolérance applicable : la plus spécifique d'abord — produit + mode, puis
   * produit seul, puis mode seul, puis la règle générale.
   */
  private async resolveTolerance(
    productId: string,
    mode: TransportMode,
    segment: CommercialSegment,
    at: Date,
  ) {
    const candidates = await this.prisma.ullageTolerance.findMany({
      where: {
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
        AND: [
          { OR: [{ productId }, { productId: null }] },
          { OR: [{ transportMode: mode }, { transportMode: null }] },
          { OR: [{ segment }, { segment: null }] },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    const rank = (t: {
      productId: string | null;
      transportMode: TransportMode | null;
      segment: CommercialSegment | null;
    }) => (t.productId ? 4 : 0) + (t.transportMode ? 2 : 0) + (t.segment ? 1 : 0);

    return candidates.sort((a, b) => rank(b) - rank(a))[0] ?? null;
  }
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

// ===========================================================================
//  Contrôleur
// ===========================================================================

@Controller('api/internal/operations')
@RequireRealm(Realm.INTERNAL)
export class OperationsController {
  constructor(private readonly service: OperationsService) {}

  @Get()
  @Roles(
    UserRole.DG,
    UserRole.CCOO,
    UserRole.LOGISTICS_COORD,
    UserRole.SALES_REP,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.ASSISTANT_DG,
  )
  @Screen('operations')
  list(@Query() query: OperationQuery) {
    return this.service.list(query);
  }

  @Get(':id')
  @Roles(
    UserRole.DG,
    UserRole.CCOO,
    UserRole.LOGISTICS_COORD,
    UserRole.SALES_REP,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
  )
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles(UserRole.LOGISTICS_COORD, UserRole.CCOO)
  create(@Body() dto: CreateOperationDto, @Req() req: { auth: { sub: string } }) {
    return this.service.create(dto, req.auth.sub);
  }

  /**
   * Tarifs proposés AVANT d'affecter — un par transporteur.
   *
   * Afficher le tarif au moment du refus ne guide personne : le coordinateur
   * doit voir ce que chaque transporteur coûte, et lequel est conforme, au
   * moment où il choisit.
   */
  @Get(':id/freight-guidance')
  @Roles(UserRole.LOGISTICS_COORD, UserRole.CCOO, UserRole.DG, UserRole.FINANCE_CFO)
  freightGuidance(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.freightGuidance(id);
  }

  /** Acquittement d'une exigence bloquante du site de livraison (§ 6.2). */
  @Post(':id/site-requirements/:requirementId/acknowledge')
  @Roles(UserRole.LOGISTICS_COORD, UserRole.CCOO, UserRole.DG)
  acknowledgeSiteRequirement(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requirementId', ParseUUIDPipe) requirementId: string,
    @Body() dto: AcknowledgeSiteRequirementDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.acknowledgeSiteRequirement(id, requirementId, dto.note, req.auth.sub);
  }

  @Patch(':id/assignment')
  @Roles(UserRole.LOGISTICS_COORD, UserRole.CCOO, UserRole.DG)
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignMeansDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.assign(id, dto, req.auth.sub);
  }

  @Patch(':id/status')
  @Roles(UserRole.LOGISTICS_COORD, UserRole.CCOO, UserRole.DG)
  transition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransitionDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.transition(id, dto, req.auth.sub);
  }

  /**
   * Rattache la dérogation qui lève un verrou HSE autrement définitif
   * (§ 11.2). La dérogation elle-même se crée au registre
   * (`POST /derogations`, DG/DAF/CCOO) — cette route ne fait que la joindre à
   * l'opération.
   */
  @Patch(':id/hse-derogation')
  @Roles(UserRole.LOGISTICS_COORD, UserRole.CCOO, UserRole.DG)
  attachHseDerogation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttachHseDerogationDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.attachHseDerogation(id, dto.derogationId, req.auth.sub);
  }

  @Post(':id/cost-lines')
  @Roles(UserRole.LOGISTICS_COORD, UserRole.CCOO, UserRole.ACCOUNTANT, UserRole.FINANCE_CFO)
  addCostLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CostLineDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.addCostLine(id, dto, req.auth.sub);
  }

  @Post(':id/measurements')
  @Roles(UserRole.LOGISTICS_COORD, UserRole.CCOO)
  recordMeasurement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MeasurementDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.recordMeasurement(id, dto, req.auth.sub);
  }

  /** Acquittement d'un écart de volume — CCOO, CFO, DG (§ 8.3). */
  @Patch('measurements/:measurementId/acknowledge')
  @Roles(UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.DG)
  acknowledge(
    @Param('measurementId', ParseUUIDPipe) measurementId: string,
    @Body() dto: AcknowledgeUllageDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.acknowledgeUllage(measurementId, dto, req.auth.sub);
  }
}
