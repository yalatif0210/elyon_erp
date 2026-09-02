import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { CrmInteractionKind, UserRole } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Realm, RequireRealm, Roles, Screen } from '../common/auth/realm';
import { PrismaService } from '../common/prisma/prisma.service';
import { ReferenceService } from '../common/reference/reference.service';

// ===========================================================================
//  DTO
// ===========================================================================

class CreateOpportunityDto {
  @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @IsUUID() partnerId!: string;
  @IsString() segment!: string;
  @IsOptional() @IsUUID() productId?: string;
  @IsNumber() @Min(0) estimatedVolume!: number;
  @IsString() uom!: string;
  @IsNumber() @Min(0) referencePrice!: number;
  @IsString() currencyCode!: string;
  @IsUUID() stageId!: string;
  @IsOptional() @IsUUID() ownerId?: string;
  @IsOptional() @IsDateString() expectedCloseDate?: string;

  /**
   * ⚠️ OBLIGATOIRES, ET C'EST LE § 15 QUI L'EXIGE.
   *
   *    « Chaque étape porte […] une prochaine action. » Une opportunité sans
   *    prochaine action dort jusqu'à ce qu'on la retrouve par hasard.
   */
  @IsString() @MinLength(3) @MaxLength(300) nextAction!: string;
  @IsDateString() nextActionDue!: string;

  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

class MoveStageDto {
  @IsUUID() stageId!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;

  /** Exigé par la base dès que l'étape visée est une étape de perte. */
  @IsOptional() @IsString() @MaxLength(500) lossReason?: string;

  /** La prochaine action se redéfinit à chaque étape franchie. */
  @IsOptional() @IsString() @MaxLength(300) nextAction?: string;
  @IsOptional() @IsDateString() nextActionDue?: string;
}

class LogInteractionDto {
  @IsEnum(CrmInteractionKind) kind!: CrmInteractionKind;
  @IsDateString() occurredAt!: string;
  @IsString() @MinLength(3) @MaxLength(2000) summary!: string;
  @IsOptional() @IsString() @MaxLength(160) contactName?: string;
  @IsString() @MinLength(3) @MaxLength(300) nextAction!: string;
  @IsDateString() nextActionDue!: string;
}

class CloseActionDto {
  @IsBoolean() done!: boolean;
}

class LinkDealDto {
  /** `null` retire le lien — poser une nouvelle Affaire ou en changer passe par la même route. */
  @IsOptional() @IsUUID() dealId?: string | null;
}

// ===========================================================================
//  Service
// ===========================================================================

/**
 * CRM — pipeline, opportunités et interactions (SPECIFICATIONS.md § 15).
 *
 * ⚠️ LE PIPELINE N'EST PAS UN TABLEAU DE SUIVI, C'EST UNE SOURCE DE PRÉVISION.
 *
 *    « Valeur pondérée = CA prévisionnel × Probabilité », et le § 14.3 nomme le
 *    pipeline pondéré comme source de la prévision de vente. Celle-ci fournit
 *    l'assiette du taux d'absorption (§ 14.2), qui entre dans le coût complet,
 *    qui décide du seuil de marge (§ 5.4). Un pipeline complaisant ne reste pas
 *    un problème commercial : il fait baisser le coût de revient calculé, donc
 *    passer des affaires qui ne couvrent pas leurs frais.
 *
 * Les lectures viennent de vues PostgreSQL — jamais recalculées ici.
 */
@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reference: ReferenceService,
  ) {}

  /** Les étapes, dans l'ordre du pipeline. */
  stages() {
    return this.prisma.crmPipelineStage.findMany({
      where: { isActive: true },
      orderBy: { rank: 'asc' },
    });
  }

  pipeline(filtre: { ouvertes?: boolean; responsable?: string }) {
    const conditions: string[] = [];
    if (filtre.ouvertes) conditions.push(`issue = 'OPEN'`);
    if (filtre.responsable) {
      conditions.push(`responsable = '${filtre.responsable.replace(/'/g, "''")}'`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.prisma.$queryRawUnsafe(
      `SELECT * FROM v_crm_pipeline ${where} ORDER BY etape_rang, next_action_due`,
    );
  }

  parEtape() {
    return this.prisma.$queryRawUnsafe(`SELECT * FROM v_crm_pipeline_par_etape ORDER BY rang`);
  }

  alertes() {
    return this.prisma.$queryRawUnsafe(
      `SELECT * FROM v_crm_alertes ORDER BY retard_jours DESC NULLS LAST, echeance`,
    );
  }

  conversion() {
    return this.prisma.$queryRawUnsafe(`SELECT * FROM v_crm_conversion ORDER BY rang`);
  }

  async opportunite(id: string) {
    const o = await this.prisma.crmOpportunity.findUnique({
      where: { id },
      include: {
        partner: { select: { code: true, legalName: true, type: true } },
        product: { select: { code: true, name: true } },
        stage: true,
        owner: { select: { fullName: true, role: true } },
        deal: { select: { id: true, reference: true, status: true } },
        interactions: {
          orderBy: { occurredAt: 'desc' },
          include: { author: { select: { fullName: true } } },
        },
        transitions: {
          orderBy: { occurredAt: 'desc' },
          include: {
            fromStage: { select: { code: true, label: true } },
            toStage: { select: { code: true, label: true } },
          },
        },
      },
    });
    if (!o) throw new NotFoundException('Opportunité introuvable');
    return o;
  }

  async create(dto: CreateOpportunityDto, actorId: string) {
    // La sonde protège des références posées hors séquence — reprise, jeu de
    // démonstration, migration. Sans elle, la première création réelle heurte
    // l'existant et l'utilisateur reçoit un 409 sans comprendre.
    const reference = await this.reference.monthly('OPP', 3, new Date(), async (candidate) =>
      (await this.prisma.crmOpportunity.count({ where: { reference: candidate } })) > 0,
    );
    return this.prisma.crmOpportunity.create({
      data: {
        reference,
        title: dto.title,
        partnerId: dto.partnerId,
        segment: dto.segment as never,
        productId: dto.productId ?? null,
        estimatedVolume: dto.estimatedVolume,
        uom: dto.uom as never,
        referencePrice: dto.referencePrice,
        currencyCode: dto.currencyCode,
        stageId: dto.stageId,
        // Sans responsable désigné, c'est celui qui crée : une opportunité
        // sans propriétaire n'est suivie par personne.
        ownerId: dto.ownerId ?? actorId,
        expectedCloseDate: dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : null,
        nextAction: dto.nextAction,
        nextActionDue: new Date(dto.nextActionDue),
        notes: dto.notes ?? null,
      },
    });
  }

  /**
   * Franchir une étape.
   *
   * L'historique du passage est écrit par un DÉCLENCHEUR, pas ici : confié à
   * l'application, il serait omis par l'import et par le correctif d'urgence,
   * et l'analyse de conversion porterait sur un échantillon troué.
   */
  async move(id: string, dto: MoveStageDto) {
    const cible = await this.prisma.crmPipelineStage.findUnique({ where: { id: dto.stageId } });
    if (!cible) throw new NotFoundException('Étape introuvable');
    if (!cible.isActive) {
      throw new BadRequestException(
        `L'étape « ${cible.label} » est désactivée : elle ne peut plus recevoir d'opportunité.`,
      );
    }

    // ⚠️ LA NOTE PASSE PAR UNE VARIABLE DE TRANSACTION, PAS PAR UNE RETOUCHE.
    //
    //    Premier essai : mettre à jour la ligne que le déclencheur venait
    //    d'écrire. L'historique est en AJOUT SEUL — droit révoqué et garde en
    //    place — donc la retouche échouait. Et elle échouait APRÈS que le
    //    changement d'étape avait été validé : l'étape bougeait, l'appelant
    //    recevait un 403, et personne ne pouvait deviner lequel des deux
    //    croire.
    //
    //    `set_config(…, true)` porte sur la TRANSACTION seule : la valeur
    //    disparaît au COMMIT et ne peut pas fuir vers la requête suivante d'un
    //    autre utilisateur sur la même connexion du pool.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('erp.crm_note', $1, true)`, dto.note ?? '');
      return tx.crmOpportunity.update({
        where: { id },
        data: {
          stageId: dto.stageId,
          lossReason: dto.lossReason ?? undefined,
          nextAction: dto.nextAction ?? undefined,
          nextActionDue: dto.nextActionDue ? new Date(dto.nextActionDue) : undefined,
        },
      });
    });
  }

  logInteraction(id: string, dto: LogInteractionDto, actorId: string) {
    return this.prisma.crmInteraction.create({
      data: {
        opportunityId: id,
        kind: dto.kind,
        occurredAt: new Date(dto.occurredAt),
        summary: dto.summary,
        contactName: dto.contactName ?? null,
        nextAction: dto.nextAction,
        nextActionDue: new Date(dto.nextActionDue),
        authorId: actorId,
      },
    });
  }

  /**
   * Relie (ou retire le lien vers) l'Affaire née d'une Opportunité gagnée.
   *
   * ⚠️ GESTE HUMAIN ASSUMÉ, JAMAIS UNE CRÉATION AUTOMATIQUE.
   *
   *    `CrmOpportunity.dealId` promettait « l'affaire née de l'opportunité
   *    gagnée » depuis l'origine du schéma, sans qu'aucun code ne l'écrive
   *    jamais — gagner une opportunité ne produisait aucune affaire, et rien
   *    ne permettait de relier après coup celle créée séparément. Cette
   *    méthode ne fait que poser le lien entre deux objets déjà existants.
   */
  async lierAffaire(id: string, dealId: string | null) {
    const o = await this.prisma.crmOpportunity.findUnique({
      where: { id },
      select: { id: true, stage: { select: { outcome: true } } },
    });
    if (!o) throw new NotFoundException('Opportunité introuvable');
    if (o.stage.outcome !== 'WON') {
      throw new BadRequestException(
        'Seule une opportunité gagnée peut être reliée à une affaire.',
      );
    }
    if (dealId) {
      const deal = await this.prisma.deal.findUnique({ where: { id: dealId }, select: { id: true } });
      if (!deal) throw new NotFoundException('Affaire introuvable');
    }
    return this.prisma.crmOpportunity.update({ where: { id }, data: { dealId } });
  }

  /**
   * Marquer une relance faite.
   *
   * C'est ce drapeau, et lui seul, qui fait disparaître l'alerte. Le calculer
   * — « une interaction postérieure existe, donc la relance est faite » —
   * effacerait l'alerte au premier échange sur un TOUT AUTRE sujet.
   */
  closeAction(interactionId: string, dto: CloseActionDto) {
    return this.prisma.crmInteraction.update({
      where: { id: interactionId },
      data: { nextActionDone: dto.done },
    });
  }
}

// ===========================================================================
//  Contrôleur
// ===========================================================================

@Controller('api/internal/crm')
@RequireRealm(Realm.INTERNAL)
export class CrmController {
  constructor(private readonly service: CrmService) {}

  @Get('stages')
  stages() {
    return this.service.stages();
  }

  @Get('pipeline')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP, UserRole.FINANCE_CFO, UserRole.ASSISTANT_DG)
  @Screen('crm')
  pipeline(@Query('ouvertes') ouvertes?: string, @Query('responsable') responsable?: string) {
    return this.service.pipeline({ ouvertes: ouvertes === 'true', responsable });
  }

  @Get('pipeline/par-etape')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP, UserRole.FINANCE_CFO, UserRole.ASSISTANT_DG)
  @Screen('crm')
  parEtape() {
    return this.service.parEtape();
  }

  @Get('alertes')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP, UserRole.ASSISTANT_DG)
  @Screen('crm')
  alertes() {
    return this.service.alertes();
  }

  /** Probabilité affichée contre conversion observée — l'honnêteté du pipeline. */
  @Get('conversion')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.FINANCE_CFO)
  @Screen('crm')
  conversion() {
    return this.service.conversion();
  }

  @Get('opportunites/:id')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP, UserRole.FINANCE_CFO, UserRole.ASSISTANT_DG)
  opportunite(@Param('id') id: string) {
    return this.service.opportunite(id);
  }

  @Post('opportunites')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP)
  create(@Body() dto: CreateOpportunityDto, @Req() req: { auth: { sub: string } }) {
    return this.service.create(dto, req.auth.sub);
  }

  @Patch('opportunites/:id/etape')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP)
  move(@Param('id') id: string, @Body() dto: MoveStageDto) {
    return this.service.move(id, dto);
  }

  @Patch('opportunites/:id/affaire')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP)
  lierAffaire(@Param('id') id: string, @Body() dto: LinkDealDto) {
    return this.service.lierAffaire(id, dto.dealId ?? null);
  }

  @Post('opportunites/:id/interactions')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP, UserRole.ASSISTANT_DG)
  log(
    @Param('id') id: string,
    @Body() dto: LogInteractionDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.logInteraction(id, dto, req.auth.sub);
  }

  @Patch('interactions/:id/action')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP, UserRole.ASSISTANT_DG)
  closeAction(@Param('id') id: string, @Body() dto: CloseActionDto) {
    return this.service.closeAction(id, dto);
  }
}
