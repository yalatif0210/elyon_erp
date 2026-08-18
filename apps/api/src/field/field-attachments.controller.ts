import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ActorType, AuditAction, FieldRole, Prisma } from '@prisma/client';
import { AuditService } from '../common/audit/audit.service';
import { FieldRoles, Realm, RequireRealm, Roles, SkipAudit } from '../common/auth/realm';
import { SettingsService } from '../common/config/settings.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { FieldActor, FieldScopeService } from './field-scope.service';
import { UserRole } from '@prisma/client';

// ===========================================================================
//  Types
// ===========================================================================

/**
 * Fichier reçu, tel que multer le rend.
 *
 * Déclaré ici plutôt qu'importé de `@types/multer` : une dépendance de plus
 * pour six champs, dont aucun ne change jamais.
 */
interface FichierRecu {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Plafond de sécurité du tuyau, en octets. Le plafond MÉTIER est paramétré. */
const PLAFOND_TUYAU = 32 * 1024 * 1024;

// ===========================================================================
//  Service
// ===========================================================================

/**
 * Remontée des pièces jointes produites sur le terrain (§ 10.2).
 *
 * ⚠️ HORS DU FLUX D'ÉVÉNEMENTS, ET C'EST TOUT L'INTÉRÊT.
 *
 *    « Les photos ne transitent pas dans le flux d'événements — compression
 *      sur l'appareil, file d'envoi séparée avec reprise. Sinon une opération
 *      à vingt photos bloque toute la synchronisation. »
 *
 *    Une checklist validée pèse quelques centaines d'octets et doit partir
 *    tout de suite ; une photo pèse deux mégaoctets et peut attendre le
 *    réseau. Les mêler ferait dépendre la première de la seconde.
 *
 * L'IDEMPOTENCE JOUE À DEUX NIVEAUX :
 *
 *    · l'identifiant d'appareil (`clientUuid`) pour l'ENREGISTREMENT — un
 *      renvoi retombe sur la même ligne ;
 *    · l'empreinte du contenu pour le FICHIER — le même octet n'est écrit
 *      qu'une fois, quel que soit le nombre d'envois.
 */
@Injectable()
export class FieldAttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly perimetre: FieldScopeService,
  ) {}

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

  async depose(
    fichier: FichierRecu | undefined,
    corps: Record<string, string>,
    actor: FieldActor,
  ) {
    if (!fichier) {
      throw new BadRequestException('Aucun fichier reçu.');
    }

    const clientUuid = String(corps['clientUuid'] ?? '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientUuid)) {
      throw new BadRequestException(
        'Identifiant d’appareil manquant ou mal formé : sans lui, une reprise après coupure déposerait la photo une seconde fois.',
      );
    }

    // Déjà déposée. On rend la ligne existante SANS réécrire : c'est ce qui
    // permet à la tablette de reprendre un envoi interrompu sans se demander
    // s'il avait abouti.
    const deja = await this.prisma.operationAttachment.findUnique({
      where: { clientUuid },
      select: { id: true, storageKey: true, sha256: true, sizeBytes: true, createdAt: true },
    });
    if (deja) return { ...deja, alreadyPresent: true };

    // --- Plafonds et natures admises : PARAMÉTRÉS, jamais figés -------------
    // Une entreprise qui change de tablettes change de définition de photo. Le
    // repli n'est pas une valeur « vraie », c'est ce qui évite que l'absence
    // du paramètre ferme la remontée du terrain.
    const plafondMo = await this.settings.number('FIELD_ATTACHMENT_MAX_MB', 8);
    const naturesAdmises = await this.settings.list('FIELD_ATTACHMENT_MIME_TYPES', [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ]);

    if (fichier.size > plafondMo * 1024 * 1024) {
      throw new BadRequestException(
        `Pièce trop lourde : ${(fichier.size / 1048576).toFixed(1)} Mo pour un plafond de ${plafondMo} Mo. Compressez la photo sur la tablette avant de l’envoyer.`,
      );
    }
    if (!naturesAdmises.includes(fichier.mimetype)) {
      throw new BadRequestException(
        `Type de fichier refusé (${fichier.mimetype}). Types admis : ${naturesAdmises.join(', ')}.`,
      );
    }

    // --- Rattachement, et vérification du périmètre -------------------------
    const checkItemId = corps['checkItemId'] || null;
    const hseEventId = corps['hseEventId'] || null;
    if (!checkItemId && !hseEventId) {
      throw new BadRequestException(
        'La pièce doit se rattacher à un point de contrôle ou à un événement HSE : une photo sans rattachement n’est opposable à rien.',
      );
    }

    if (checkItemId) {
      const ok = await this.prisma.operationHseCheckItem.findFirst({
        where: { id: checkItemId, check: { operation: this.scope(actor) } },
        select: { id: true },
      });
      if (!ok) throw new NotFoundException(this.INTROUVABLE);
    }
    if (hseEventId) {
      const ok = await this.prisma.hseEvent.findFirst({
        where: { id: hseEventId, operation: this.scope(actor) },
        select: { id: true },
      });
      if (!ok) throw new NotFoundException(this.INTROUVABLE);
    }

    // NATURE de la pièce. Le défaut est la photo — c'est le cas courant — mais
    // une signature ne satisfait pas une exigence de photo, ni l'inverse : un
    // point qui demande la signature du client au bon de livraison n'est pas
    // rempli par un cliché du camion. La base le vérifie ; encore faut-il
    // qu'elle sache de quoi il s'agit.
    const natures = ['PHOTO', 'SIGNATURE', 'DOCUMENT'];
    const nature = String(corps['kind'] ?? 'PHOTO').toUpperCase();
    if (!natures.includes(nature)) {
      throw new BadRequestException(
        `Nature de pièce inconnue (${nature}). Natures admises : ${natures.join(', ')}.`,
      );
    }

    const objet = await this.storage.put(fichier.buffer, fichier.mimetype);

    const piece = await this.prisma.operationAttachment.create({
      data: {
        clientUuid,
        kind: nature as never,
        checkItemId,
        hseEventId,
        storageKey: objet.storageKey,
        mimeType: objet.mimeType,
        sizeBytes: BigInt(objet.sizeBytes),
        sha256: objet.sha256,
        caption: corps['caption']?.slice(0, 500) || null,
        capturedAt: corps['capturedAt'] ? new Date(corps['capturedAt']) : null,
        deviceTimestamp: corps['deviceTimestamp'] ? new Date(corps['deviceTimestamp']) : null,
        latitude: corps['latitude'] ? Number(corps['latitude']).toFixed(7) : null,
        longitude: corps['longitude'] ? Number(corps['longitude']).toFixed(7) : null,
      },
      select: { id: true, storageKey: true, sha256: true, sizeBytes: true, createdAt: true },
    });

    await this.audit.record({
      actorType: ActorType.FIELD_USER,
      actorId: actor.id,
      action: AuditAction.CREATE,
      entityType: 'OperationAttachment',
      entityId: piece.id,
      after: {
        checkItemId,
        hseEventId,
        sha256: objet.sha256,
        sizeBytes: objet.sizeBytes,
        // Le contenu était déjà là : la tablette a renvoyé, elle n'a pas
        // produit une seconde photo.
        contenuDejaPresent: objet.alreadyPresent,
      },
    });

    return { ...piece, alreadyPresent: false };
  }

  /**
   * Message IDENTIQUE pour « n'existe pas » et « pas la vôtre ».
   *
   * Les distinguer indiquerait à qui cherche que l'objet existe, et par
   * recoupement qu'un client est servi ce jour-là.
   */
  private readonly INTROUVABLE =
    'Élément introuvable dans votre affectation. Rouvrez le dossier de l’opération avant de joindre une pièce.';

  /**
   * Restitution du binaire.
   *
   * Le périmètre est revérifié À LA LECTURE, pas seulement au dépôt : une
   * affectation change, et un lien de photo qui resterait ouvert après le
   * retrait de l'opération serait une fuite silencieuse.
   */
  async lit(id: string, actor: FieldActor | null) {
    const piece = await this.prisma.operationAttachment.findFirst({
      where: {
        id,
        ...(actor
          ? {
              OR: [
                { checkItem: { check: { operation: this.scope(actor) } } },
                { hseEvent: { operation: this.scope(actor) } },
              ],
            }
          : {}),
      },
      select: { storageKey: true, mimeType: true, sizeBytes: true },
    });
    if (!piece) throw new NotFoundException(this.INTROUVABLE);

    if (!(await this.storage.exists(piece.storageKey))) {
      // La ligne existe, le fichier non. Le dire clairement plutôt que de
      // rendre un flux vide : un flux vide passe pour une photo noire.
      throw new NotFoundException(
        'Le fichier de cette pièce est absent du stockage. Signalez-le : la référence existe mais le contenu a été perdu.',
      );
    }

    return { piece, flux: this.storage.read(piece.storageKey) };
  }

  /**
   * Pièces d'une opération, pour la validation à distance depuis le bureau.
   *
   * Le binaire n'y figure pas — seulement de quoi l'aller chercher, et de quoi
   * savoir à quoi il se rattache. Renvoyer les contenus ferait de cette
   * lecture une pièce jointe de plusieurs mégaoctets pour un écran qui n'en
   * affichera qu'une à la fois.
   */
  pourOperation(operationId: string) {
    return this.prisma.operationAttachment.findMany({
      where: {
        OR: [
          { checkItem: { check: { operationId } } },
          { hseEvent: { operationId } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        kind: true,
        mimeType: true,
        sizeBytes: true,
        caption: true,
        capturedAt: true,
        deviceTimestamp: true,
        createdAt: true,
        latitude: true,
        longitude: true,
        checkItem: {
          select: {
            id: true,
            level: true,
            outcome: true,
            item: { select: { code: true, label: true, phase: true } },
          },
        },
        hseEvent: { select: { id: true, reference: true, type: true, severity: true } },
      },
    });
  }
}

// ===========================================================================
//  Contrôleur TERRAIN
// ===========================================================================

@Controller('api/field/attachments')
@RequireRealm(Realm.FIELD)
export class FieldAttachmentsController {
  constructor(private readonly service: FieldAttachmentsService) {}

  /**
   * Dépôt d'une pièce.
   *
   * Le fichier est gardé EN MÉMOIRE et non écrit dans un répertoire
   * temporaire : le conteneur est en lecture seule, et un fichier déposé dans
   * le tmpfs devrait de toute façon être relu pour être empreinté. Le plafond
   * du tuyau protège la mémoire ; le plafond métier, plus bas, est paramétré.
   */
  @Post()
  @FieldRoles(FieldRole.FIELD_AGENT, FieldRole.HSE_CONTROLLER)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PLAFOND_TUYAU } }))
  depose(
    @UploadedFile() fichier: FichierRecu | undefined,
    @Req() req: { auth: { sub: string; role?: FieldRole }; body: Record<string, string> },
  ) {
    return this.service.depose(fichier, req.body ?? {}, {
      id: req.auth.sub,
      role: req.auth.role,
    });
  }

  @Get(':id')
  @SkipAudit()
  @FieldRoles(FieldRole.FIELD_AGENT, FieldRole.HSE_CONTROLLER)
  @Header('Cache-Control', 'private, max-age=3600')
  async lit(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { auth: { sub: string; role?: FieldRole } },
  ) {
    const { piece, flux } = await this.service.lit(id, {
      id: req.auth.sub,
      role: req.auth.role,
    });
    return new StreamableFile(flux as never, {
      type: piece.mimeType,
      length: Number(piece.sizeBytes),
      // `inline` et non `attachment` : la photo se regarde, elle ne se
      // télécharge pas. Le nom est l'identifiant, jamais celui d'origine —
      // un nom de fichier venu d'un appareil est une chaîne non maîtrisée.
      disposition: 'inline',
    });
  }
}

// ===========================================================================
//  Contrôleur INTERNE — consultation depuis le bureau
// ===========================================================================

@Controller('api/internal/attachments')
@RequireRealm(Realm.INTERNAL)
export class InternalAttachmentsController {
  constructor(private readonly service: FieldAttachmentsService) {}

  /**
   * Le contrôleur HSE valide À DISTANCE, sur photos et relevés (§ 7.2). La
   * validation à distance étant le mode NORMAL, cette lecture n'est pas un
   * confort : sans elle, le dispositif entier repose sur une présence
   * physique que l'entreprise ne peut pas assurer.
   */
  @Get(':id')
  @SkipAudit()
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD)
  @Header('Cache-Control', 'private, max-age=3600')
  async lit(@Param('id', ParseUUIDPipe) id: string) {
    // Pas de périmètre terrain ici : les rôles ci-dessus voient l'ensemble des
    // opérations par construction. Le cloisonnement de l'agent n'a pas de sens
    // pour qui a déjà accès au dossier complet.
    const { piece, flux } = await this.service.lit(id, null);
    return new StreamableFile(flux as never, {
      type: piece.mimeType,
      length: Number(piece.sizeBytes),
      disposition: 'inline',
    });
  }

  @Get()
  @SkipAudit()
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD)
  liste(@Query('operationId', ParseUUIDPipe) operationId: string) {
    return this.service.pourOperation(operationId);
  }
}
