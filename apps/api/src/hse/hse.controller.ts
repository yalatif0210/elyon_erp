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
  Req,
} from '@nestjs/common';
import {
  ActorType,
  AuditAction,
  FieldRole,
  HseCheckOutcome,
  HseControlLevel,
  HseEventStatus,
  HseEventType,
  HseSeverity,
  OperationPhase,
  UserRole,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { FieldRoles, Realm, RequireRealm, Roles, Screen } from '../common/auth/realm';
import { FieldScopeService } from '../field/field-scope.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ReferenceService } from '../common/reference/reference.service';

// ===========================================================================
//  DTO
// ===========================================================================

export class OpenCheckDto {
  @IsEnum(OperationPhase) phase!: OperationPhase;

  /**
   * Restriction facultative à UN modèle.
   *
   * Par défaut la checklist est l'UNION des modèles de tous les types portés
   * par l'opération — c'est le comportement normal. Ce champ ne sert qu'au cas
   * particulier où l'on veut n'ouvrir qu'un modèle donné ; il ne doit pas
   * devenir le chemin ordinaire, sous peine de reperdre les contrôles des
   * autres types.
   */
  @IsOptional() @IsUUID() templateId?: string;
}

export class RecordItemDto {
  @IsEnum(HseCheckOutcome) outcome!: HseCheckOutcome;
  @IsOptional() @IsString() @MaxLength(500) recordedValue?: string;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;

  /** Horloge de la tablette — l'écart avec le serveur est un signal (§ 10.2). */
  @IsOptional() @IsISO8601() deviceTimestamp?: string;
  @IsOptional() @Type(() => Number) @IsNumber() latitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() longitude?: number;
}

export class ValidateCheckDto {
  /** Mode normal : l'entreprise ne compte qu'un contrôleur HSE (§ 7.2). */
  @IsOptional() remotely?: boolean;
}

export class RejectCheckDto {
  /** Ce que l'agent doit reprendre — exigé, vérifié aussi en base. */
  @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
}

export class HseEventDto {
  @IsEnum(HseEventType) type!: HseEventType;
  @IsEnum(HseSeverity) severity!: HseSeverity;
  @IsString() @MaxLength(200) title!: string;
  @IsString() @MinLength(10) @MaxLength(4000) description!: string;
  @IsISO8601() occurredAt!: string;
  @IsOptional() @IsString() @MaxLength(200) location?: string;
  @IsOptional() @IsUUID() operationId?: string;
}

// ===========================================================================
//  Résolution des contrôles applicables
// ===========================================================================

/** Une ligne de resolve_hse_checklist — colonnes nommées comme en base. */
interface ResolvedCheckItem {
  item_id: string;
  item_code: string;
  level: string;
  template_id: string;
  template_version: number;
  from_types: string;
}

/**
 * Le modèle d'origine s'il est UNIQUE, sinon rien.
 *
 * Une checklist assemblée à partir de plusieurs types n'a pas de modèle dont
 * on puisse invoquer la version : la provenance est alors portée point par
 * point, et ce champ reste vide plutôt que de désigner un modèle au hasard.
 */
function uniqueTemplate(items: ResolvedCheckItem[]): { id: string; version: number } | null {
  const ids = new Set(items.map((i) => i.template_id));
  if (ids.size !== 1) return null;
  return { id: items[0].template_id, version: items[0].template_version };
}

// ===========================================================================
//  Service
// ===========================================================================

@Injectable()
export class HseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reference: ReferenceService,
  ) {}

  /**
   * Instancie une checklist sur une opération.
   *
   * La VERSION du modèle et le NIVEAU de chaque point sont recopiés : une
   * checklist révisée plus tard ne doit pas réécrire ce qui a été
   * effectivement contrôlé sur le terrain, ni requalifier un point bloquant
   * en simple observation après coup.
   */
  async openCheck(operationId: string, dto: OpenCheckDto, actorId: string) {
    // Existence vérifiée d'abord : la résolution ci-dessous rendrait zéro
    // ligne sur un identifiant inconnu, et l'opération serait déclarée « sans
    // type » alors qu'elle n'existe pas — un message qui envoie chercher au
    // mauvais endroit.
    await this.prisma.operation.findUniqueOrThrow({
      where: { id: operationId },
      select: { id: true },
    });

    // La résolution est faite EN BASE (resolve_hse_checklist) : union des
    // modèles de tous les types portés, dédoublonnée par point, le niveau le
    // plus contraignant l'emportant. La refaire ici en TypeScript la ferait
    // diverger de ce que la base oppose au verrou HSE — deux vérités pour un
    // même contrôle.
    const resolved = await this.prisma.$queryRaw<ResolvedCheckItem[]>`
      SELECT item_id, item_code, level, template_id, template_version, from_types
        FROM resolve_hse_checklist(${operationId}::uuid)
       WHERE phase = ${dto.phase}
       ORDER BY display_order`;

    // Restriction volontaire à un modèle : on filtre l'union, on ne la
    // remplace pas — les règles d'applicabilité restent celles de la base.
    const items = dto.templateId
      ? resolved.filter((i) => i.template_id === dto.templateId)
      : resolved;

    if (items.length === 0) {
      const types = await this.prisma.operationTypeAssignment.count({ where: { operationId } });
      throw new BadRequestException(
        types === 0
          ? 'Cette opération ne porte aucun type : aucun contrôle HSE ne peut lui être adjoint. Indiquer au moins un type d’opération avant d’ouvrir une checklist.'
          : `Aucun point de contrôle pour la phase ${dto.phase} parmi les types portés par cette opération. Compléter les modèles de checklist rattachés à ces types.`,
      );
    }

    const check = await this.prisma.operationHseCheck.upsert({
      where: { operationId_phase: { operationId, phase: dto.phase } },
      update: {},
      create: {
        operationId,
        // Indicatif seulement, et seulement s'il n'y a qu'une provenance :
        // désigner arbitrairement l'un des modèles laisserait croire que la
        // checklist en vient tout entière.
        templateId: uniqueTemplate(items)?.id ?? null,
        templateVersion: uniqueTemplate(items)?.version ?? null,
        phase: dto.phase,
        items: {
          create: items.map((i) => ({
            itemId: i.item_id,
            // Niveau FIGÉ à l'instant du contrôle, provenance comprise.
            level: i.level as HseControlLevel,
            sourceTemplateId: i.template_id,
            sourceTemplateVersion: i.template_version,
            outcome: HseCheckOutcome.PENDING,
          })),
        },
      },
      include: { items: { include: { item: true } } },
    });

    await this.audit.record({
      actorType: ActorType.FIELD_USER,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'OperationHseCheck',
      entityId: check.id,
      after: {
        operationId,
        phase: dto.phase,
        points: items.length,
        // Traçabilité de l'assemblage : de quels types viennent les contrôles.
        types: [...new Set(items.map((i) => i.from_types))].join(' · '),
      },
    });

    return check;
  }

  /**
   * Renseignement d'un point par l'AGENT.
   *
   * Renseigner n'est pas valider. La séparation est le cœur du verrou HSE :
   * un agent qui coche « conforme » sur un point bloquant ne l'a pas validé,
   * et la base l'empêchera de valider la checklist qui le porte.
   */
  async recordItem(checkItemId: string, dto: RecordItemDto, fieldUserId: string) {
    const check = await this.prisma.operationHseCheck.findFirstOrThrow({
      where: { items: { some: { id: checkItemId } } },
      select: { id: true, validatedAt: true },
    });
    if (check.validatedAt) {
      throw new BadRequestException(
        'Checklist déjà validée : un point ne se modifie plus. Ouvrir un événement HSE si un écart apparaît après validation.',
      );
    }

    const updated = await this.prisma.operationHseCheckItem.update({
      where: { id: checkItemId },
      data: {
        outcome: dto.outcome,
        recordedValue: dto.recordedValue ?? null,
        comment: dto.comment ?? null,
        recordedByFieldUserId: fieldUserId,
        recordedAt: new Date(),
        deviceTimestamp: dto.deviceTimestamp ? new Date(dto.deviceTimestamp) : null,
        latitude: dto.latitude?.toFixed(7) ?? null,
        longitude: dto.longitude?.toFixed(7) ?? null,
      },
    });

    await this.audit.record({
      actorType: ActorType.FIELD_USER,
      actorId: fieldUserId,
      action: AuditAction.UPDATE,
      entityType: 'OperationHseCheckItem',
      entityId: checkItemId,
      after: { outcome: dto.outcome, recordedValue: dto.recordedValue },
    });

    return updated;
  }

  /**
   * Validation par le CONTRÔLEUR HSE.
   *
   * Deux règles sont appliquées en base, pas ici : seul un contrôleur HSE
   * valide, et il ne peut pas valider une checklist dont il a lui-même
   * renseigné un point bloquant.
   */
  async validateCheck(checkId: string, dto: ValidateCheckDto, fieldUserId: string) {
    const pending = await this.prisma.operationHseCheckItem.count({
      where: { checkId, outcome: HseCheckOutcome.PENDING },
    });
    if (pending > 0) {
      throw new BadRequestException(
        `${pending} point(s) de contrôle non renseigné(s) : la checklist ne peut pas être validée.`,
      );
    }

    const check = await this.prisma.operationHseCheck.update({
      where: { id: checkId },
      data: {
        validatedByFieldUserId: fieldUserId,
        validatedAt: new Date(),
        validatedRemotely: dto.remotely ?? true,
      },
      select: { id: true, operationId: true, phase: true, validatedAt: true },
    });

    await this.audit.record({
      actorType: ActorType.FIELD_USER,
      actorId: fieldUserId,
      action: AuditAction.APPROVE,
      entityType: 'OperationHseCheck',
      entityId: checkId,
      after: check,
    });

    return check;
  }

  /** Suppléance du contrôleur HSE — DG seul, vérifié en base (§ 3.4). */
  async validateCheckAsDg(checkId: string, userId: string) {
    const check = await this.prisma.operationHseCheck.update({
      where: { id: checkId },
      data: { validatedByUserId: userId, validatedAt: new Date(), validatedRemotely: true },
      select: { id: true, operationId: true, phase: true, validatedAt: true },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId: userId,
      action: AuditAction.OVERRIDE,
      entityType: 'OperationHseCheck',
      entityId: checkId,
      after: { ...check, suppleance: true },
    });

    return check;
  }

  /**
   * Rejet par le CONTRÔLEUR HSE — la checklist ne passe pas en l'état.
   *
   * Distinct de la validation : `validatedAt` n'est jamais posé ici, les
   * points restent modifiables par l'agent pour reprendre ce qui ne va pas.
   * Le motif et l'autorité sont revérifiés en base (§ 38), quel que soit le
   * chemin emprunté.
   */
  async rejectCheck(checkId: string, dto: RejectCheckDto, fieldUserId: string) {
    const check = await this.prisma.operationHseCheck.update({
      where: { id: checkId },
      data: {
        rejectedByFieldUserId: fieldUserId,
        rejectedAt: new Date(),
        rejectionReason: dto.reason,
      },
      select: { id: true, operationId: true, phase: true, rejectedAt: true, rejectionReason: true },
    });

    await this.audit.record({
      actorType: ActorType.FIELD_USER,
      actorId: fieldUserId,
      action: AuditAction.REJECT,
      entityType: 'OperationHseCheck',
      entityId: checkId,
      after: check,
    });

    return check;
  }

  /** Rejet en suppléance — DG seul, vérifié en base (§ 38). */
  async rejectCheckAsDg(checkId: string, dto: RejectCheckDto, userId: string) {
    const check = await this.prisma.operationHseCheck.update({
      where: { id: checkId },
      data: { rejectedByUserId: userId, rejectedAt: new Date(), rejectionReason: dto.reason },
      select: { id: true, operationId: true, phase: true, rejectedAt: true, rejectionReason: true },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId: userId,
      action: AuditAction.REJECT,
      entityType: 'OperationHseCheck',
      entityId: checkId,
      after: { ...check, suppleance: true },
    });

    return check;
  }

  /**
   * Événement HSE — incident, déversement, non-conformité.
   *
   * Ouvrable par l'agent comme par le contrôleur : signaler ne demande aucune
   * habilitation, seul le traitement en demande.
   */
  async openEvent(dto: HseEventDto, actor: { type: ActorType; id: string }) {
    const reference = await this.reference.annual('HSE');

    const event = await this.prisma.hseEvent.create({
      data: {
        reference,
        operationId: dto.operationId ?? null,
        type: dto.type,
        severity: dto.severity,
        status: HseEventStatus.OPEN,
        title: dto.title,
        description: dto.description,
        occurredAt: new Date(dto.occurredAt),
        location: dto.location ?? null,
        ...(actor.type === ActorType.FIELD_USER
          ? { declaredByFieldUserId: actor.id }
          : { declaredByUserId: actor.id }),
      },
    });

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: AuditAction.CREATE,
      entityType: 'HseEvent',
      entityId: event.id,
      after: event,
    });

    return event;
  }

  /** Checklists d'une opération, telles que la tablette les affiche. */
  checksForOperation(operationId: string) {
    return this.prisma.operationHseCheck.findMany({
      where: { operationId },
      include: {
        template: { select: { code: true, label: true, version: true } },
        validatedByFieldUser: { select: { fullName: true, role: true } },
        validatedByUser: { select: { fullName: true, role: true } },
        rejectedByFieldUser: { select: { fullName: true, role: true } },
        rejectedByUser: { select: { fullName: true, role: true } },
        items: {
          include: {
            item: {
              select: {
                code: true,
                label: true,
                guidance: true,
                // Le RÉGIME, pas seulement le booléen : la tablette doit
                // distinguer « interdite » de « facultative », faute de quoi
                // elle proposerait l'appareil photo en zone où il est proscrit.
                photoPolicy: true,
                requiresPhoto: true,
                requiresValue: true,
                valueLabel: true,
                // ⚠️ `requiresSignature` n'était PAS servi à la tablette : elle
                //    ne pouvait donc pas demander la signature qu'on attendait
                //    d'elle, et le point « bon de livraison signé par le
                //    client » s'enregistrait sans rien prouver. C'est la base
                //    qui l'exige désormais ; encore faut-il que l'agent sache
                //    ce qu'on lui demande AVANT d'être refusé.
                requiresSignature: true,
                displayOrder: true,
              },
            },
            recordedByFieldUser: { select: { fullName: true } },
          },
          orderBy: { item: { displayOrder: 'asc' } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

}

// ===========================================================================
//  Contrôleur TERRAIN — tablette de l'agent et du contrôleur HSE
// ===========================================================================

/**
 * Contrôleur TERRAIN des contrôles HSE.
 *
 * ⚠️ CHAQUE ROUTE VÉRIFIE LE PÉRIMÈTRE AVANT DE DÉLÉGUER.
 *
 *    `HseService` n'en a aucune notion — il sert aussi la console interne, où
 *    le cloisonnement n'a pas de sens. Ses méthodes adressent donc leurs
 *    objets par identifiant nu. Tant que ce contrôleur ne vérifiait rien, un
 *    agent lisait la checklist d'une opération qui ne lui était pas affectée
 *    et en recevait les identifiants de points — les clés d'écriture de
 *    l'étape suivante. Le contrôleur HSE, lui, pouvait valider la checklist
 *    d'une opération étrangère, c'est-à-dire OUVRIR LE VERROU HSE AVANT
 *    CHARGEMENT sur le dossier d'un autre client.
 *
 *    La vérification porte sur DEUX niveaux : l'opération, et le rattachement
 *    de l'objet désigné à cette opération. Le premier seul laisse ouverte la
 *    porte de derrière — un identifiant de point pris ailleurs.
 */
@Controller('api/field/hse')
@RequireRealm(Realm.FIELD)
export class FieldHseController {
  constructor(
    private readonly service: HseService,
    private readonly perimetre: FieldScopeService,
  ) {}

  @Get('operations/:operationId/checks')
  @FieldRoles(FieldRole.FIELD_AGENT, FieldRole.HSE_CONTROLLER)
  async checks(
    @Param('operationId', ParseUUIDPipe) operationId: string,
    @Req() req: { auth: { sub: string; role?: FieldRole } },
  ) {
    await this.perimetre.assertOperation(operationId, { id: req.auth.sub, role: req.auth.role });
    return this.service.checksForOperation(operationId);
  }

  @Post('operations/:operationId/checks')
  @FieldRoles(FieldRole.FIELD_AGENT, FieldRole.HSE_CONTROLLER)
  async open(
    @Param('operationId', ParseUUIDPipe) operationId: string,
    @Body() dto: OpenCheckDto,
    @Req() req: { auth: { sub: string; role?: FieldRole } },
  ) {
    await this.perimetre.assertOperation(operationId, { id: req.auth.sub, role: req.auth.role });
    return this.service.openCheck(operationId, dto, req.auth.sub);
  }

  /** L'agent RENSEIGNE. Il ne valide pas. */
  @Patch('check-items/:itemId')
  @FieldRoles(FieldRole.FIELD_AGENT, FieldRole.HSE_CONTROLLER)
  async record(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: RecordItemDto,
    @Req() req: { auth: { sub: string; role?: FieldRole } },
  ) {
    await this.perimetre.assertCheckItem(itemId, { id: req.auth.sub, role: req.auth.role });
    return this.service.recordItem(itemId, dto, req.auth.sub);
  }

  /**
   * Le CONTRÔLEUR HSE valide — ou son suppléant en cours de délégation (§ 3.4).
   *
   * `FIELD_AGENT` figure dans la liste POUR NE PAS BLOQUER LE SUPPLÉANT AU
   * PORTAIL : son rôle déclaré reste agent, seule une délégation active lui
   * ouvre cette route. Le tri réel — contrôleur de plein droit, suppléant
   * opposable, ou ni l'un ni l'autre — se fait en base
   * (`enforce_hse_separation_of_duties`, § 37), pas ici : un agent qui tente
   * sans délégation reçoit le refus circonstancié du trigger, pas un 403 nu.
   */
  @Patch('checks/:checkId/validate')
  @FieldRoles(FieldRole.HSE_CONTROLLER, FieldRole.FIELD_AGENT)
  async validate(
    @Param('checkId', ParseUUIDPipe) checkId: string,
    @Body() dto: ValidateCheckDto,
    @Req() req: { auth: { sub: string; role?: FieldRole } },
  ) {
    await this.perimetre.assertCheck(checkId, { id: req.auth.sub, role: req.auth.role });
    return this.service.validateCheck(checkId, dto, req.auth.sub);
  }

  /**
   * Rejet par le CONTRÔLEUR HSE, ou son suppléant en cours de délégation.
   *
   * Une checklist entièrement renseignée peut malgré tout ne pas pouvoir
   * ouvrir le verrou en l'état — un point bloquant réellement non conforme,
   * par exemple. Le rejet le dit explicitement, motif à l'appui, plutôt que
   * de laisser la checklist en attente sans qu'on sache ce qu'il faut
   * reprendre. Elle reste modifiable : ce n'est pas une validation.
   */
  @Patch('checks/:checkId/reject')
  @FieldRoles(FieldRole.HSE_CONTROLLER, FieldRole.FIELD_AGENT)
  async reject(
    @Param('checkId', ParseUUIDPipe) checkId: string,
    @Body() dto: RejectCheckDto,
    @Req() req: { auth: { sub: string; role?: FieldRole } },
  ) {
    await this.perimetre.assertCheck(checkId, { id: req.auth.sub, role: req.auth.role });
    return this.service.rejectCheck(checkId, dto, req.auth.sub);
  }

  @Post('events')
  @FieldRoles(FieldRole.FIELD_AGENT, FieldRole.HSE_CONTROLLER)
  async openEvent(
    @Body() dto: HseEventDto,
    @Req() req: { auth: { sub: string; role?: FieldRole } },
  ) {
    // L'opération citée dans le corps de requête n'est pas prise pour argent
    // comptant : un appareil qui y glisserait un identifiant arbitraire
    // rattacherait son incident au dossier d'un autre client. Un événement
    // SANS opération reste déclarable — un quasi-accident au dépôt, hors
    // mission, n'a pas de dossier auquel se rattacher.
    if (dto.operationId) {
      await this.perimetre.assertOperation(dto.operationId, {
        id: req.auth.sub,
        role: req.auth.role,
      });
    }
    return this.service.openEvent(dto, { type: ActorType.FIELD_USER, id: req.auth.sub });
  }
}

// ===========================================================================
//  Contrôleur INTERNE — consultation et suppléance
// ===========================================================================

@Controller('api/internal/hse')
@RequireRealm(Realm.INTERNAL)
export class HseController {
  constructor(private readonly service: HseService) {}

  @Get('operations/:operationId/checks')
  @Roles(
    UserRole.DG,
    UserRole.CCOO,
    UserRole.LOGISTICS_COORD,
    UserRole.ASSISTANT_DG,
    UserRole.FINANCE_CFO,
  )
  @Screen('hse')
  checks(@Param('operationId', ParseUUIDPipe) operationId: string) {
    return this.service.checksForOperation(operationId);
  }

  /** Suppléance du contrôleur HSE — DG seul. */
  @Patch('checks/:checkId/validate')
  @Roles(UserRole.DG)
  validateAsDg(
    @Param('checkId', ParseUUIDPipe) checkId: string,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.validateCheckAsDg(checkId, req.auth.sub);
  }

  /** Rejet en suppléance — DG seul. */
  @Patch('checks/:checkId/reject')
  @Roles(UserRole.DG)
  rejectAsDg(
    @Param('checkId', ParseUUIDPipe) checkId: string,
    @Body() dto: RejectCheckDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.rejectCheckAsDg(checkId, dto, req.auth.sub);
  }

  @Post('events')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD, UserRole.ASSISTANT_DG)
  openEvent(@Body() dto: HseEventDto, @Req() req: { auth: { sub: string } }) {
    return this.service.openEvent(dto, { type: ActorType.INTERNAL_USER, id: req.auth.sub });
  }
}
