import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ActorType,
  FieldEventStatus,
  FieldEventType,
  FieldRole,
  Prisma,
} from '@prisma/client';
import { Type, plainToInstance } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
  validateSync,
} from 'class-validator';
import { FieldRoles, Realm, RequireRealm, SkipAudit } from '../common/auth/realm';
import { translatePostgresError } from '../common/filters/prisma-exception.filter';
import { PrismaService } from '../common/prisma/prisma.service';
import { FieldActor, FieldScopeService } from './field-scope.service';
import {
  HseEventDto,
  HseService,
  OpenCheckDto,
  RecordItemDto,
  RejectCheckDto,
  ValidateCheckDto,
} from '../hse/hse.controller';
import {
  MeasurementDto,
  OperationsService,
  TransitionDto,
} from '../operations/operations.controller';

// ===========================================================================
//  DTO
// ===========================================================================

/** Un identifiant mal formé doit être refusé AVANT d'atteindre la base. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class SyncEventDto {
  /**
   * UUID GÉNÉRÉ SUR L'APPAREIL.
   *
   * C'est lui qui rend l'envoi idempotent : il devient la clé primaire de la
   * ligne de journal, et un renvoi après coupure retombe sur la même ligne.
   * Le laisser produire par le serveur reviendrait à dupliquer tout ce que le
   * réseau a coupé entre l'écriture et l'accusé de réception.
   */
  @IsUUID() id!: string;

  @IsUUID() operationId!: string;
  @IsEnum(FieldEventType) type!: FieldEventType;
  @IsObject() payload!: Record<string, unknown>;

  /** Rang dans le journal de l'appareil — l'ordre de PRODUCTION fait foi. */
  @Type(() => Number) @IsInt() @Min(0) sequence!: number;

  @IsISO8601() deviceTimestamp!: string;
  @IsOptional() @Type(() => Number) @IsNumber() latitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() longitude?: number;
}

class SyncBatchDto {
  /** Appareil émetteur — l'écart avec l'appareil affecté est un signal (§ 10.5). */
  @IsString() @MaxLength(128) deviceId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncEventDto)
  events!: SyncEventDto[];
}

// ===========================================================================
//  Réponse
// ===========================================================================

export interface SyncOutcome {
  id: string;
  status: FieldEventStatus;
  /** Rédigé pour l'agent : il doit dire QUOI FAIRE, pas seulement que c'est refusé. */
  reason?: string;
}

export interface SyncReport {
  received: number;
  accepted: number;
  rejected: number;
  /** Non traités : un événement antérieur de la même opération a été refusé. */
  deferred: number;
  /** Déjà connus du serveur — un renvoi, pas un doublon. */
  alreadyKnown: number;
  outcomes: SyncOutcome[];
}

/**
 * Contrat de charge utile, PAR NATURE D'ÉVÉNEMENT.
 *
 * Ce sont les DTO du domaine eux-mêmes, importés et non recopiés : recopiés,
 * ils divergeraient au premier champ ajouté, et la tablette enverrait en toute
 * bonne foi ce que le serveur n'accepte plus.
 */
const CHARGE_UTILE = {
  [FieldEventType.CHECK_OPENED]: OpenCheckDto,
  [FieldEventType.CHECK_ITEM_RECORDED]: RecordItemDto,
  [FieldEventType.CHECK_VALIDATED]: ValidateCheckDto,
  [FieldEventType.CHECK_REJECTED]: RejectCheckDto,
  [FieldEventType.MEASUREMENT_RECORDED]: MeasurementDto,
  [FieldEventType.STATUS_ADVANCED]: TransitionDto,
  [FieldEventType.HSE_EVENT_DECLARED]: HseEventDto,
} as const;

/**
 * Valide la charge utile d'un événement contre le DTO de sa nature.
 *
 * ⚠️ SANS CETTE ÉTAPE, RIEN NE VALIDAIT LA CHARGE UTILE.
 *
 *    Le tuyau de validation de Nest s'arrête à l'enveloppe : la charge est
 *    déclarée `Record<string, unknown>`, donc tout y passe. Une valeur fautive
 *    — un état de contrôle qui n'existe pas, un identifiant mal formé —
 *    traversait alors le service jusqu'à Prisma, et l'agent recevait sur sa
 *    tablette une trace d'appel interne au lieu d'une consigne.
 *
 *    Les champs non déclarés sont ÉCARTÉS, pas seulement ignorés : ce qui
 *    vient d'un appareil ne doit jamais atteindre la base sans être passé par
 *    une déclaration.
 */
/**
 * Clés d'ADRESSAGE, portées par la charge utile faute de chemin d'URL.
 *
 * Sur l'API classique, `checkItemId` et `checkId` sont des segments d'URL :
 * ils ne figurent donc dans aucun DTO. Un événement, lui, n'a pas d'URL — il
 * les transporte dans sa charge. Les valider contre le DTO du domaine les
 * ferait refuser comme champs inconnus, et TOUT événement de renseignement de
 * point serait rejeté.
 */
const CLES_ADRESSAGE = ['checkItemId', 'checkId'];

function valideCharge<T extends object>(
  type: FieldEventType,
  payload: Record<string, unknown>,
): T {
  const classe = CHARGE_UTILE[type] as unknown as new () => T;
  const utile = Object.fromEntries(
    Object.entries(payload).filter(([cle]) => !CLES_ADRESSAGE.includes(cle)),
  );
  const instance = plainToInstance(classe, utile, {
    enableImplicitConversion: false,
    excludeExtraneousValues: false,
  });

  const erreurs = validateSync(instance as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });

  if (erreurs.length > 0) {
    const details = erreurs
      .flatMap((e) => Object.values(e.constraints ?? {}))
      .join(' · ');
    throw new BadRequestException(
      `Contenu de l'événement invalide : ${details}. Cet événement ne repartira pas tel quel : corrigez la saisie et refaites l'action.`,
    );
  }

  return instance;
}

// ===========================================================================
//  Service
// ===========================================================================

/**
 * Ingestion du journal terrain (SPECIFICATIONS.md § 10.2).
 *
 * PRINCIPE : on synchronise des ÉVÉNEMENTS, pas des ÉTATS.
 *
 *   « La tablette ne détient pas une copie modifiable de l'opération qu'elle
 *     renverrait au serveur — cette approche fabrique des conflits
 *     insolubles. »
 *
 * Ce service ne porte AUCUNE règle métier. Il rejoue les événements dans leur
 * ordre de production et DÉLÈGUE à des services de domaine déjà écrits, qui
 * eux-mêmes s'appuient sur les invariants tenus par PostgreSQL. Réécrire ici
 * la moindre vérification créerait une seconde porte d'entrée — celle par
 * laquelle un chargement déclaré avant validation HSE finirait par passer.
 *
 * ⚠️ UN REFUS EST DÉFINITIF, ET IL BRÛLE L'IDENTIFIANT DE L'ÉVÉNEMENT.
 *
 *    Le journal est en ajout seul : il conserve que cet événement-là a été
 *    refusé, et à quelle date. Le renvoyer tel quel retombera sur la même
 *    ligne et rendra le même refus, indéfiniment. « Résoudre » un rejet
 *    signifie donc, côté tablette : lever la cause, puis produire un
 *    ÉVÉNEMENT NEUF, avec un identifiant neuf.
 *
 *    L'alternative — réévaluer un refus au renvoi — supposerait de réécrire
 *    une ligne de journal, c'est-à-dire d'effacer la trace qu'une opération a
 *    été tentée hors des règles. C'est précisément ce que le journal existe
 *    pour empêcher.
 *
 *    À ne pas confondre avec DEFERRED, qui n'a JAMAIS été jugé : celui-là
 *    n'est pas journalisé et repartira inchangé.
 */
@Injectable()
export class FieldSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hse: HseService,
    private readonly operations: OperationsService,
    private readonly perimetre: FieldScopeService,
  ) {}

  /**
   * Périmètre de l'agent, en clause `WHERE`.
   *
   * Identique à celui des lectures terrain, et pour la même raison : sans lui,
   * deviner un UUID d'opération suffirait à écrire dans le dossier d'un autre
   * agent — donc d'un autre client.
   */
  /**
   * Périmètre — DÉFINITION UNIQUE, partagée (`FieldScopeService`).
   *
   * Elle était recopiée ici, et les copies avaient divergé : le périmètre
   * d'écriture était devenu PLUS LARGE que celui de lecture. Le contrôleur
   * HSE pouvait écrire sur des opérations qu'il ne pouvait pas afficher.
   */
  private scope(actor: FieldActor): Prisma.OperationWhereInput {
    return this.perimetre.where(actor);
  }

  async ingest(batch: SyncBatchDto, actor: FieldActor): Promise<SyncReport> {
    const outcomes: SyncOutcome[] = [];
    // Comptés à part des déjà-connus : un renvoi n'a rien appliqué, et le
    // faire figurer dans « accepté » ferait croire à la tablette qu'elle vient
    // de produire un effet qu'elle ne fait que redemander.
    const traites: SyncOutcome[] = [];
    let alreadyKnown = 0;

    // Déjà reçus lors d'un envoi précédent : on ne les rejoue pas, on rend le
    // sort qu'ils ont eu. C'est ce qui distingue un RENVOI d'un DOUBLON — et
    // sans cette distinction, une coupure réseau après application produirait
    // deux relevés pour un seul jaugeage.
    const connus = await this.prisma.fieldSyncEvent.findMany({
      where: { id: { in: batch.events.map((e) => e.id) } },
      select: { id: true, status: true, rejectionReason: true },
    });
    const parId = new Map(connus.map((e) => [e.id, e]));

    // Regroupement par opération : l'ordre de production ne vaut qu'à
    // l'intérieur d'une opération, et le refus d'un événement ne doit pas
    // suspendre le déroulé d'une AUTRE opération, sans rapport avec lui.
    const parOperation = new Map<string, SyncEventDto[]>();
    for (const e of batch.events) {
      if (parId.has(e.id)) {
        alreadyKnown += 1;
        const known = parId.get(e.id)!;
        outcomes.push({
          id: e.id,
          status: known.status,
          reason: known.rejectionReason ?? undefined,
        });
        continue;
      }
      const liste = parOperation.get(e.operationId) ?? [];
      liste.push(e);
      parOperation.set(e.operationId, liste);
    }

    for (const [operationId, evenements] of parOperation) {
      evenements.sort((a, b) => a.sequence - b.sequence);

      const autorise = await this.prisma.operation.findFirst({
        where: { AND: [{ id: operationId }, this.scope(actor)] },
        select: { id: true },
      });

      if (!autorise) {
        // Message IDENTIQUE pour « n'existe pas » et « pas la vôtre » : les
        // distinguer indiquerait à qui cherche que l'opération existe, et par
        // recoupement qu'un client est servi ce jour-là.
        const motif =
          'Cette opération ne figure pas dans votre affectation. Contactez le coordinateur logistique si elle devrait vous revenir.';
        for (const e of evenements) {
          await this.journalise(e, batch.deviceId, actor, FieldEventStatus.REJECTED, motif);
          const issue = { id: e.id, status: FieldEventStatus.REJECTED, reason: motif };
          outcomes.push(issue);
          traites.push(issue);
        }
        continue;
      }

      let bloque = false;
      for (const e of evenements) {
        if (bloque) {
          // NON journalisé, et c'est délibéré : la ligne porterait l'UUID de
          // l'appareil, et le renvoi suivant serait pris pour un doublon déjà
          // traité. L'événement serait alors perdu pour de bon. Il reste dans
          // la file de la tablette, qui le represéntera une fois le blocage
          // levé.
          const suspendu = {
            id: e.id,
            status: FieldEventStatus.DEFERRED,
            reason:
              'Non traité : un événement antérieur de cette opération a été refusé. Il repartira une fois le refus résolu.',
          };
          outcomes.push(suspendu);
          traites.push(suspendu);
          continue;
        }

        try {
          await this.applique(e, actor);
          await this.journalise(e, batch.deviceId, actor, FieldEventStatus.ACCEPTED);
          const issue = { id: e.id, status: FieldEventStatus.ACCEPTED };
          outcomes.push(issue);
          traites.push(issue);
        } catch (error) {
          const raison = this.lisible(error);
          await this.journalise(e, batch.deviceId, actor, FieldEventStatus.REJECTED, raison);
          const issue = { id: e.id, status: FieldEventStatus.REJECTED, reason: raison };
          outcomes.push(issue);
          traites.push(issue);
          // Les événements suivants de CETTE opération sont suspendus : ils
          // décrivent la suite d'un déroulé dont une étape vient d'être
          // refusée. Les appliquer quand même enregistrerait une livraison
          // sous un chargement qui n'a pas eu lieu.
          bloque = true;
        }
      }
    }

    return {
      received: batch.events.length,
      accepted: traites.filter((o) => o.status === FieldEventStatus.ACCEPTED).length,
      rejected: traites.filter((o) => o.status === FieldEventStatus.REJECTED).length,
      deferred: traites.filter((o) => o.status === FieldEventStatus.DEFERRED).length,
      alreadyKnown,
      outcomes,
    };
  }

  /**
   * Application d'un événement — pure délégation.
   *
   * Chaque branche extrait de la charge utile ce que le service de domaine
   * attend, et rien de plus. La charge utile n'est JAMAIS écrite telle quelle :
   * elle vient d'un appareil, et un champ inattendu qu'on recopierait
   * atteindrait la base sans avoir traversé la moindre validation.
   */
  private async applique(e: SyncEventDto, actor: FieldActor): Promise<void> {
    const p = e.payload;

    switch (e.type) {
      case FieldEventType.CHECK_OPENED:
        await this.hse.openCheck(e.operationId, valideCharge(e.type, p), actor.id);
        return;

      case FieldEventType.CHECK_ITEM_RECORDED: {
        const dto = valideCharge<RecordItemDto>(e.type, {
          ...p,
          // L'horodatage et la position viennent de l'ENVELOPPE, jamais de la
          // charge : un relevé fait à 14h32 hors connexion et remonté à 19h00
          // s'est fait à 14h32, et c'est l'événement qui porte cette heure.
          deviceTimestamp: e.deviceTimestamp,
          ...(e.latitude !== undefined ? { latitude: e.latitude } : {}),
          ...(e.longitude !== undefined ? { longitude: e.longitude } : {}),
        });
        const checkItemId = String(p['checkItemId'] ?? '');
        if (!UUID.test(checkItemId)) {
          throw new BadRequestException(
            'Point de contrôle non identifié : cet événement ne désigne aucun point existant.',
          );
        }

        // ⚠️ Le point doit appartenir à l'opération de l'ÉVÉNEMENT.
        //
        //    Le périmètre a été vérifié sur l'opération, pas sur le point.
        //    `recordItem` retrouve la checklist à partir du seul identifiant
        //    du point : sans ce rattachement, un identifiant de point pris
        //    ailleurs permettrait de renseigner la checklist d'une opération
        //    qu'on n'a pas le droit d'ouvrir — le cloisonnement tomberait par
        //    la porte de derrière.
        const rattache = await this.prisma.operationHseCheckItem.findFirst({
          where: { id: checkItemId, check: { operationId: e.operationId } },
          select: { id: true },
        });
        if (!rattache) {
          throw new BadRequestException(
            'Ce point de contrôle n’appartient pas à cette opération. Rouvrez la checklist depuis l’opération avant de la renseigner.',
          );
        }

        await this.hse.recordItem(checkItemId, dto, actor.id);
        return;
      }

      case FieldEventType.CHECK_VALIDATED: {
        const checkId = String(p['checkId'] ?? '');
        if (!UUID.test(checkId)) {
          throw new BadRequestException(
            'Checklist non identifiée : cet événement ne désigne aucune checklist existante.',
          );
        }
        // Même raison que ci-dessus : la checklist doit être celle de
        // l'opération dont le périmètre a été vérifié.
        const sienne = await this.prisma.operationHseCheck.findFirst({
          where: { id: checkId, operationId: e.operationId },
          select: { id: true },
        });
        if (!sienne) {
          throw new BadRequestException(
            'Cette checklist n’appartient pas à cette opération.',
          );
        }
        await this.hse.validateCheck(checkId, valideCharge(e.type, p), actor.id);
        return;
      }

      case FieldEventType.CHECK_REJECTED: {
        const checkId = String(p['checkId'] ?? '');
        if (!UUID.test(checkId)) {
          throw new BadRequestException(
            'Checklist non identifiée : cet événement ne désigne aucune checklist existante.',
          );
        }
        const sienne = await this.prisma.operationHseCheck.findFirst({
          where: { id: checkId, operationId: e.operationId },
          select: { id: true },
        });
        if (!sienne) {
          throw new BadRequestException(
            'Cette checklist n’appartient pas à cette opération.',
          );
        }
        await this.hse.rejectCheck(checkId, valideCharge(e.type, p), actor.id);
        return;
      }

      case FieldEventType.MEASUREMENT_RECORDED:
        await this.operations.recordMeasurement(
          e.operationId,
          valideCharge(e.type, p),
          actor.id,
          { fieldUserId: actor.id },
        );
        return;

      case FieldEventType.STATUS_ADVANCED:
        await this.operations.transition(
          e.operationId,
          valideCharge(e.type, p),
          actor.id,
          { fieldUserId: actor.id },
        );
        return;

      case FieldEventType.HSE_EVENT_DECLARED:
        // L'opération vient de l'ENVELOPPE de l'événement, jamais de la charge
        // utile : un appareil qui y glisserait un autre identifiant rattacherait
        // son incident au dossier d'un autre agent, donc d'un autre client.
        await this.hse.openEvent(
          valideCharge(e.type, { ...p, operationId: e.operationId }),
          { type: ActorType.FIELD_USER, id: actor.id },
        );
        return;
    }
  }

  /**
   * Message destiné à l'AGENT, sur sa tablette, souvent sans réseau et sans
   * personne à qui demander. Il doit dire quoi faire. Un « Bad Request » nu
   * laisse l'opération en suspens jusqu'au retour au bureau.
   */
  private lisible(error: unknown): string {
    const reponse = (error as { response?: { message?: string | string[] } })?.response?.message;
    if (Array.isArray(reponse)) return reponse.join(' · ').slice(0, 1000);
    if (typeof reponse === 'string') return reponse.slice(0, 1000);

    const message = (error as { message?: string })?.message ?? '';

    // ⚠️ REFUS VENU DE LA BASE — le cas le plus fréquent, et le plus mal rendu
    //    si on n'y prend pas garde.
    //
    //    Les verrous métier sont tenus par PostgreSQL : ce sont eux qui
    //    refusent qu'un contrôleur valide une checklist dont il a renseigné un
    //    point bloquant. Prisma enveloppe ce refus dans une trace d'appel
    //    interne — « Invalid this.prisma.operationHseCheck.update() invocation
    //    in /app/dist/hse/hse.controller.js:239 » — qui partirait telle quelle
    //    sur la tablette.
    //
    //    Le filtre global sait la traduire, mais il ne voit jamais ces
    //    exceptions : elles sont rattrapées ICI, pour être journalisées. On
    //    emprunte donc le MÊME traducteur, plutôt que d'en écrire un second
    //    qui finirait par diverger.
    if (message.includes('PostgresError') || message.includes('code:')) {
      const traduit = translatePostgresError(message);
      if (traduit.code !== 'UNKNOWN' && traduit.message !== 'Erreur de persistance.') {
        return traduit.message.slice(0, 1000);
      }
    }

    // Reste les pannes internes, qu'on ne détaille PAS : une trace d'appel ne
    // dit rien à l'agent et renseigne qui n'a rien à savoir de la structure.
    if (message.includes('Invalid `this.prisma') || message.includes('/app/dist/')) {
      return 'Refusé par le serveur. Signalez-le au coordinateur logistique en indiquant l’opération et l’action tentée : le motif exact n’est pas exploitable depuis la tablette.';
    }

    return (message || 'Refusé par le serveur, sans motif exploitable.').slice(0, 1000);
  }

  private async journalise(
    e: SyncEventDto,
    deviceId: string,
    actor: FieldActor,
    status: FieldEventStatus,
    reason?: string,
  ): Promise<void> {
    await this.prisma.fieldSyncEvent.create({
      data: {
        id: e.id,
        operationId: e.operationId,
        fieldUserId: actor.id,
        deviceId,
        type: e.type,
        payload: e.payload as never,
        sequence: e.sequence,
        deviceTimestamp: new Date(e.deviceTimestamp),
        status,
        rejectionReason: reason ?? null,
        appliedAt: status === FieldEventStatus.ACCEPTED ? new Date() : null,
        latitude: e.latitude?.toFixed(7) ?? null,
        longitude: e.longitude?.toFixed(7) ?? null,
      },
    });
  }

  /**
   * Refus en attente de résolution.
   *
   * L'appareil peut avoir été réinitialisé, ou l'agent avoir changé de
   * tablette : la file locale disparaît, pas les refus. Ils restent
   * consultables ici, faute de quoi une opération resterait bloquée sans que
   * personne ne sache pourquoi.
   */
  async rejections(actor: FieldActor, since?: string) {
    return this.prisma.fieldSyncEvent.findMany({
      where: {
        fieldUserId: actor.id,
        status: FieldEventStatus.REJECTED,
        ...(since ? { receivedAt: { gte: new Date(since) } } : {}),
      },
      orderBy: { receivedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        operationId: true,
        type: true,
        sequence: true,
        deviceTimestamp: true,
        receivedAt: true,
        rejectionReason: true,
        operation: { select: { reference: true } },
      },
    });
  }
}

// ===========================================================================
//  Contrôleur
// ===========================================================================

@Controller('api/field/sync')
@RequireRealm(Realm.FIELD)
export class FieldSyncController {
  constructor(private readonly service: FieldSyncService) {}

  /**
   * Remontée d'un lot d'événements.
   *
   * L'agent authentifié est pris du JETON, jamais de la charge utile : un
   * `fieldUserId` transmis par l'appareil ferait du cloisonnement une
   * suggestion.
   */
  @Post()
  ingest(
    @Body() batch: SyncBatchDto,
    @Req() req: { auth: { sub: string; role?: FieldRole } },
  ): Promise<SyncReport> {
    return this.service.ingest(batch, { id: req.auth.sub, role: req.auth.role });
  }

  /** Refus en attente — la file locale peut avoir disparu, pas eux. */
  @Get('rejections')
  @SkipAudit()
  @FieldRoles(FieldRole.FIELD_AGENT, FieldRole.HSE_CONTROLLER)
  rejections(
    @Req() req: { auth: { sub: string; role?: FieldRole } },
    @Query('since') since?: string,
  ) {
    return this.service.rejections({ id: req.auth.sub, role: req.auth.role }, since);
  }
}
