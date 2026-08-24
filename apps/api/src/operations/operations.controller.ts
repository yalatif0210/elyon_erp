import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
  FieldRole,
  MeasurementSource,
  OperationHaltType,
  OperationPhase,
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

  /**
   * SITE DE CHARGEMENT — le lieu d'où part le produit (§ 6.2).
   *
   * Facultatif : toutes les origines ne sont pas des lieux référencés. Mais
   * dès qu'il l'est, ses exigences s'opposent — un badge d'accès se retire
   * pour charger comme pour livrer.
   *
   * ⚠️ PAS DE `destinationSiteId` ICI, ET CE N'EST PAS UN OUBLI.
   *
   *    Le site de livraison est hérité du `siteId` de l'affaire, jamais
   *    choisi indépendamment par l'appelant — voir `create()` ci-dessous.
   *    Une opération qui s'écarterait du lieu contracté par l'affaire dont
   *    elle découle serait une erreur, pas une variante légitime.
   */
  @IsOptional() @IsUUID() originSiteId?: string;
  @IsOptional() @IsISO8601() plannedLoadingDate?: string;

  /** Propriétaire du produit en transport pour compte de tiers. */
  @IsOptional() @IsUUID() productOwnerId?: string;
  @IsOptional() @IsUUID() fieldAgentId?: string;
}

/**
 * ⚠️ PLUS DE `carrierId` NI DE CHAMPS FRET ICI — REVU LE 22/08/2026.
 *
 *    Le transporteur et son coût se choisissent désormais au chiffrage de
 *    l'affaire (`DealCostLineDto`, poste TRANSPORT), comparés au tarif
 *    négocié à ce moment-là. `assign()` copie le transporteur déjà retenu ;
 *    il ne le reçoit plus en entrée, et ne reçoit plus de fret à comparer.
 */
class AssignMeansDto {
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsUUID() driverId?: string;
  @IsOptional() @IsString() @MaxLength(120) vehicleIdentifier?: string;

  /** Obligatoire si l'un des moyens est non conforme — DG seul (§ 11.2). */
  @IsOptional() @IsUUID() complianceDerogationId?: string;
}

export class TransitionDto {
  @IsEnum(OperationPhase) to!: OperationPhase;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

/** DG/CCOO seuls — arrêt d'urgence, jamais une étape de la séquence. */
export class HaltDto {
  @IsEnum(OperationHaltType) haltType!: OperationHaltType;
  @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
}

/** Nul = retire l'affectation, sans en remettre une autre. */
class SetFieldAgentDto {
  @IsOptional() @IsUUID() fieldAgentId?: string | null;
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
  @IsOptional() @IsEnum(OperationPhase) phase?: OperationPhase;
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
      ...(query.phase ? { phase: query.phase } : {}),
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
          assignments: {
            select: {
              vehicleIdentifier: true,
              vehicle: { select: { registration: true } },
              carrier: { select: { id: true, legalName: true } },
            },
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
            // Transporteur retenu AU CHIFFRAGE (§ 5.4) — connu dès l'affaire
            // approuvée, bien avant qu'une affectation de moyens existe sur
            // l'opération. `assignments[].carrier` (plus bas) ne le reprend
            // que lorsque le coordinateur affecte véhicule et chauffeur ;
            // avant ce geste, c'est ICI qu'il faut le lire.
            costLines: {
              where: { costPost: { code: 'TRANSPORT' } },
              select: { supplier: { select: { id: true, legalName: true } } },
            },
          },
        },
        productOwner: { select: { code: true, legalName: true } },
        // Un véhicule par ligne (§ 22/08/2026) — plusieurs quand la capacité
        // d'un seul ne couvre pas le volume prévu.
        assignments: {
          include: {
            // Le statut de conformité ne se stocke pas sur le moyen : il se
            // DÉRIVE des pièces à échéance. On remonte donc les pièces
            // bloquantes, seule source de vérité (§ 6.4).
            carrier: {
              select: {
                id: true,
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
        haltedBy: { select: { fullName: true } },
        hseChecks: {
          include: {
            template: { select: { code: true, label: true, version: true } },
            derogation: true,
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
        phaseTransitions: { orderBy: { createdAt: 'desc' }, take: 20 },
        _count: { select: { hseChecks: true, measurements: true, costLines: true } },
      },
    });

    return { ...operation, hseGate: await this.hseGate(id) };
  }

  /**
   * État du verrou HSE POUR L'ÉTAPE COURANTE, tel que la base l'appliquera.
   *
   * ⚠️ REVU LE 22/08/2026 — un seul verrou global n'a plus de sens : CHAQUE
   *    étape porte sa propre checklist (`OperationHseCheck`, unique par
   *    `(operationId, phase)`) et sa propre dérogation. Le calcul reprend
   *    donc celui du trigger `enforce_phase_sequence`, mais
   *    borné à `operation.phase` — il sert à afficher la situation avant la
   *    tentative de passer à l'étape suivante, pas à décider : la décision
   *    reste en base.
   */
  async hseGate(operationId: string) {
    const operation = await this.prisma.operation.findUniqueOrThrow({
      where: { id: operationId },
      select: { phase: true, haltedAt: true, haltType: true },
    });

    if (operation.haltedAt) {
      return {
        open: false,
        validated: false,
        pendingBlockingItems: 0,
        byDerogation: false,
        message: `Opération à l’arrêt (${operation.haltType}) : elle ne progresse plus.`,
      };
    }

    const resolved = await this.prisma.$queryRaw<{ item_id: string }[]>`
      SELECT item_id FROM resolve_hse_checklist(${operationId}::uuid)
       WHERE phase = ${operation.phase}::"operation_phase"`;

    if (resolved.length === 0) {
      return {
        open: true,
        validated: true,
        pendingBlockingItems: 0,
        byDerogation: false,
        message: `Verrou HSE ouvert : l’étape ${operation.phase} ne porte aucun point de contrôle pour cette opération.`,
      };
    }

    const check = await this.prisma.operationHseCheck.findUnique({
      where: { operationId_phase: { operationId, phase: operation.phase } },
      select: { id: true, validatedAt: true, derogationId: true },
    });

    const totalChecks = check ? 1 : 0;
    const pending = check
      ? await this.prisma.operationHseCheckItem.count({
          where: { checkId: check.id, level: 'BLOCKING', outcome: { not: 'PASSED' } },
        })
      : 0;
    // Une checklist créée mais encore en cours de renseignement (un point
    // PENDING) attend l'AGENT terrain, pas le contrôleur.
    const enCoursSurLeTerrain = check
      ? await this.prisma.operationHseCheckItem.count({
          where: { checkId: check.id, outcome: 'PENDING' },
        })
      : 0;
    const validated = check?.validatedAt != null;
    const byDerogation = check?.derogationId != null;
    const open = byDerogation || (validated && pending === 0);

    return {
      open,
      validated,
      pendingBlockingItems: pending,
      byDerogation,
      message: open
        ? `Verrou HSE ouvert : l’étape ${operation.phase} est satisfaite.`
        : totalChecks === 0
          ? `Verrou HSE fermé : aucune checklist n’a encore été renseignée sur le terrain pour l’étape ${operation.phase}.`
          : enCoursSurLeTerrain > 0
            ? `Verrou HSE fermé : la checklist de l’étape ${operation.phase} est en cours de renseignement sur le terrain.`
            : !validated
              ? `Verrou HSE fermé : la checklist de l’étape ${operation.phase} est renseignée, en attente de validation par le contrôleur HSE (ou sa suppléance par le DG, dans Contrôles HSE).`
              : `Verrou HSE fermé : ${pending} contrôle(s) bloquant(s) non satisfait(s) à l’étape ${operation.phase}.`,
    };
  }

  async create(dto: CreateOperationDto, actorId: string) {
    const reference = await this.reference.annual('OP');

    // ⚠️ LE SITE DE LIVRAISON EST HÉRITÉ DE L'AFFAIRE, JAMAIS ACCEPTÉ DU DTO.
    //
    //    Une opération qui s'écarterait du lieu contracté par son affaire
    //    serait une erreur, pas une variante légitime — constaté en direct :
    //    rien n'empêchait auparavant de saisir un site totalement étranger à
    //    l'affaire, ou d'en omettre un que l'affaire avait pourtant précisé.
    const deal = await this.prisma.deal.findUniqueOrThrow({
      where: { id: dto.dealId },
      select: { siteId: true },
    });

    const created = await this.prisma.operation.create({
      data: {
        reference,
        dealId: dto.dealId,
        phase: OperationPhase.PREPARATION,
        sourcingMode: dto.sourcingMode ?? SourcingMode.BACK_TO_BACK,
        productOwnerId: dto.productOwnerId ?? null,
        plannedVolume: dto.plannedVolume.toFixed(6),
        uom: dto.uom,
        transportMode: dto.transportMode,
        originLocation: dto.originLocation,
        originSiteId: dto.originSiteId ?? null,
        destinationSiteId: deal.siteId,
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

    await this.prisma.operationPhaseTransition.create({
      data: {
        operationId: created.id,
        toPhase: OperationPhase.PREPARATION,
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
   * ⚠️ PLUSIEURS VÉHICULES, REVU LE 22/08/2026.
   *
   *    Un volume qui dépasse la capacité d'une seule citerne en mobilise
   *    PLUSIEURS, chacune avec son propre chauffeur : `lignes` remplace
   *    intégralement les affectations existantes, comme
   *    `DealsService.setCostLines` remplace les lignes de coût d'une affaire
   *    — suppression puis recréation, dans UNE transaction. Le trigger
   *    `enforce_vehicle_capacity` (SQL) est DIFFÉRÉ exactement pour cette
   *    raison : il ne juge la capacité CUMULÉE qu'au commit, quand toutes les
   *    lignes de ce remplacement sont en place.
   *
   *    Rien d'autre n'est vérifié ici : `enforce_assignment_compliance` et
   *    `enforce_vehicle_allowed_products` lisent, PAR LIGNE, le statut de
   *    conformité dérivé des pièces à échéance et refusent l'affectation sans
   *    dérogation du DG.
   */
  async setAssignments(operationId: string, lignes: AssignMeansDto[], actorId: string) {
    // ⚠️ LE TRANSPORTEUR N'EST PLUS CHOISI ICI — REVU LE 22/08/2026.
    //
    //    Il vient de la ligne de coût TRANSPORT de l'affaire, retenue au
    //    chiffrage, jamais ressaisi ni modifiable à l'affectation des moyens.
    //    Recopié en lecture seule, SUR CHAQUE LIGNE, pour que la vérification
    //    de conformité du transporteur continue de porter sur le bon tiers.
    const operationDeal = await this.prisma.operation.findUniqueOrThrow({
      where: { id: operationId },
      select: { dealId: true },
    });
    const posteTransport = await this.prisma.dealCostLine.findFirst({
      where: { dealId: operationDeal.dealId, costPost: { code: 'TRANSPORT' } },
      select: { supplierId: true },
    });
    const carrierId = posteTransport?.supplierId ?? null;
    const assignedAt = new Date();

    await this.prisma.$transaction([
      this.prisma.operationAssignment.deleteMany({ where: { operationId } }),
      this.prisma.operationAssignment.createMany({
        data: lignes.map((l) => ({
          operationId,
          carrierId,
          vehicleId: l.vehicleId ?? null,
          driverId: l.driverId ?? null,
          vehicleIdentifier: l.vehicleIdentifier ?? null,
          complianceDerogationId: l.complianceDerogationId ?? null,
          assignedById: actorId,
          assignedAt,
        })),
      }),
    ]);

    const assignments = await this.prisma.operationAssignment.findMany({ where: { operationId } });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.UPDATE,
      entityType: 'OperationAssignment',
      entityId: operationId,
      after: { lignes: assignments.length, vehicules: assignments.map((a) => a.vehicleId) },
    });

    return assignments;
  }

  /**
   * Agents terrain actifs — de quoi peupler un choix, pas un CRUD.
   *
   * ⚠️ CORRIGÉ — RIEN N'AFFECTAIT JAMAIS `Operation.fieldAgentId`.
   *
   *    Le champ existe depuis toujours et conditionne tout ce qu'un agent
   *    voit sur sa tablette (`FieldScopeService.where()` : un agent ne voit
   *    que les opérations où `fieldAgentId` vaut SON identifiant). Sans
   *    écran pour le renseigner, aucun agent terrain ne pouvait jamais voir
   *    aucune opération — le circuit « renseigner la checklist HSE sur le
   *    terrain » était inatteignable de bout en bout.
   */
  fieldAgents() {
    return this.prisma.fieldUser.findMany({
      where: { role: FieldRole.FIELD_AGENT, isActive: true },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true },
    });
  }

  async setFieldAgent(operationId: string, fieldAgentId: string | null, actorId: string) {
    const operation = await this.prisma.operation.update({
      where: { id: operationId },
      data: { fieldAgentId },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.UPDATE,
      entityType: 'Operation',
      entityId: operationId,
      after: { fieldAgentId },
    });

    return operation;
  }

  /**
   * Suppression d'un brouillon (calqué sur `DealsService.remove`).
   *
   * ⚠️ RÉSERVÉE AU BROUILLON, ET C'EST TOUT L'INTÉRÊT.
   *
   *    Une opération avancée a déjà pu engager une décision (chargement,
   *    facturation) ; la supprimer effacerait cette décision sans laisser de
   *    trace. Un brouillon, lui, n'a encore rien engagé.
   *
   *    Les enfants à cascade (types portés, checklists HSE, exigences
   *    acquittées, coûts, affectations) disparaissent avec elle. Un bon de
   *    commande ou un relevé déjà rattachés bloquent la suppression au lieu
   *    d'être effacés en silence (`onDelete: Restrict`) — cas qui ne devrait
   *    jamais se présenter sur un DRAFT, mais la base reste le dernier mot,
   *    pas cette hypothèse.
   */
  async remove(id: string, actorId: string): Promise<void> {
    const operation = await this.prisma.operation.findUniqueOrThrow({
      where: { id },
      select: { phase: true, reference: true },
    });
    if (operation.phase !== OperationPhase.PREPARATION) {
      throw new BadRequestException(
        `Cette opération a dépassé l'étape PREPARATION (étape actuelle : ${operation.phase}) : elle ne se supprime plus.`,
      );
    }

    await this.prisma.operation.delete({ where: { id } });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.DELETE,
      entityType: 'Operation',
      entityId: id,
      before: operation,
    });
  }

  /**
   * Avancement d'une étape à la suivante.
   *
   * ⚠️ REVU LE 22/08/2026 — TERRAIN SEUL.
   *
   *    Une opération avance depuis le terrain, à mesure que ses points de
   *    contrôle sont réellement satisfaits — jamais depuis un bureau qui ne
   *    peut pas constater un fait physique. Cette méthode ne doit plus être
   *    atteinte que par `field-sync.controller.ts` (événement
   *    `STATUS_ADVANCED`), jamais par une route interne. L'ordre strict et le
   *    verrou HSE par étape sont appliqués par la base
   *    (`enforce_phase_sequence`) —
   *    c'est elle qui refuse, pas ce code.
   */
  async transition(
    operationId: string,
    dto: TransitionDto,
    actorId: string,
    origine?: FieldOrigin,
  ) {
    const current = await this.prisma.operation.findUniqueOrThrow({
      where: { id: operationId },
      select: { phase: true },
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
        phase: dto.to,
        ...(dto.to === OperationPhase.CHARGEMENT ? { actualLoadingDate: new Date() } : {}),
        ...(dto.to === OperationPhase.DECHARGEMENT ? { actualDischargeDate: new Date() } : {}),
        ...(dto.to === OperationPhase.CLOTURE ? { closedAt: new Date() } : {}),
      },
    });

    await this.prisma.operationPhaseTransition.create({
      data: {
        operationId,
        fromPhase: current.phase,
        toPhase: dto.to,
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
      before: { phase: current.phase },
      after: { phase: dto.to },
    });

    return updated;
  }

  /**
   * Arrêt d'urgence — INCIDENT ou CANCELLED, réservé au DG et au CCOO
   * (§ 22/08/2026).
   *
   * PARALLÈLE à la séquence, jamais une transition : `phase` n'est jamais
   * touchée, l'étape en cours reste visible telle quelle. Le trigger
   * `enforce_phase_sequence` refuse ensuite toute nouvelle transition tant
   * que l'arrêt n'est pas levé.
   */
  async halt(operationId: string, dto: HaltDto, actorId: string) {
    const updated = await this.prisma.operation.update({
      where: { id: operationId },
      data: {
        haltedAt: new Date(),
        haltType: dto.haltType,
        haltReason: dto.reason,
        haltedById: actorId,
      },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'Operation',
      entityId: operationId,
      after: { haltType: dto.haltType, haltReason: dto.reason },
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
   *    c'est le TRIGGER, au prochain changement d'étape, qui décidera si
   *    elle est réellement opposable — actif, non révoquée, non expirée, et
   *    posée sur cette opération précise si elle désigne un sujet. Dupliquer
   *    ce contrôle ici lui donnerait une seconde version, vouée à diverger.
   *
   * ⚠️ DÉPLACÉ SUR LA CHECKLIST DE L'ÉTAPE COURANTE (22/08/2026) — la
   *    dérogation n'ouvre plus le verrou de toute l'opération, seulement
   *    celui de l'étape qu'elle vise. Le check est créé s'il n'existe pas
   *    encore (l'agent n'a pas forcément ouvert la checklist quand
   *    l'équipement manquant est constaté).
   */
  async attachHseDerogation(operationId: string, derogationId: string, actorId: string) {
    const operation = await this.prisma.operation.findUniqueOrThrow({
      where: { id: operationId },
      select: { phase: true },
    });

    const check = await this.prisma.operationHseCheck.upsert({
      where: { operationId_phase: { operationId, phase: operation.phase } },
      update: { derogationId },
      create: { operationId, phase: operation.phase, derogationId },
      select: { id: true, phase: true, derogationId: true },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.OVERRIDE,
      entityType: 'OperationHseCheck',
      entityId: check.id,
      after: { phase: check.phase, derogationId },
    });

    return check;
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
            { operationsAsDestination: { some: { id: operationId } } },
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

  // ⚠️ DÉCLARÉE AVANT `:id` — le routeur retient la première route qui
  //    correspond, et `:id` avalerait « field-agents » comme un identifiant.
  @Get('field-agents')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD)
  fieldAgents() {
    return this.service.fieldAgents();
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

  @Delete(':id')
  @Roles(UserRole.LOGISTICS_COORD, UserRole.CCOO)
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: { auth: { sub: string } }) {
    return this.service.remove(id, req.auth.sub);
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
    @Body() dto: { assignments: AssignMeansDto[] },
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.setAssignments(id, dto.assignments ?? [], req.auth.sub);
  }

  @Patch(':id/field-agent')
  @Roles(UserRole.LOGISTICS_COORD, UserRole.CCOO, UserRole.DG)
  setFieldAgent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetFieldAgentDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.setFieldAgent(id, dto.fieldAgentId ?? null, req.auth.sub);
  }

  // ⚠️ PLUS DE ROUTE INTERNE POUR AVANCER UNE ÉTAPE (22/08/2026).
  //
  //    `OperationsService.transition()` reste appelé, mais UNIQUEMENT depuis
  //    `field-sync.controller.ts` (événement STATUS_ADVANCED) — jamais depuis
  //    un rôle de bureau. Une opération avance depuis le terrain, à mesure
  //    que ses points de contrôle sont réellement satisfaits ; le bureau ne
  //    constate pas un fait physique, il ne le décide pas. Voir `halt()`
  //    ci-dessous pour ce qui reste au bureau : l'arrêt d'urgence.

  /** Arrêt d'urgence — INCIDENT ou CANCELLED, réservé au DG et au CCOO. */
  @Patch(':id/halt')
  @Roles(UserRole.DG, UserRole.CCOO)
  halt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HaltDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.halt(id, dto, req.auth.sub);
  }

  /**
   * Rattache la dérogation qui lève un verrou HSE autrement définitif
   * (§ 11.2). La dérogation elle-même se crée au registre
   * (`POST /derogations`, DG/DAF/CCOO) — cette route ne fait que la joindre à
   * l'opération.
   */
  @Patch(':id/hse-derogation')
  @Roles(UserRole.LOGISTICS_COORD, UserRole.CCOO, UserRole.DG, UserRole.FINANCE_CFO)
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
