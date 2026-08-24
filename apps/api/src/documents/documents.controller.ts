import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ActorType,
  AuditAction,
  FieldRole,
  GeneratedDocumentKind,
  OperationPhase,
  Prisma,
  SignatoryKind,
  UserRole,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
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
  MinLength,
} from 'class-validator';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AuditService } from '../common/audit/audit.service';
import { FieldRoles, Public, Realm, RequireRealm, Roles, Screen } from '../common/auth/realm';
import { Page, PaginationQuery, paginate } from '../common/http/pagination.dto';
import { FieldActor, FieldScopeService } from '../field/field-scope.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ReferenceService } from '../common/reference/reference.service';
import { StorageService } from '../common/storage/storage.service';
// Import de TYPE seulement : `pdf.processor.ts` importe déjà `DocumentsService`
// depuis ce fichier — une valeur importée ici créerait un cycle à l'exécution,
// pas seulement dans les types.
import type { OperationClosurePdfJob } from './pdf.processor';

// ===========================================================================
//  DTO
// ===========================================================================

/**
 * ⚠️ CORRIGÉ — `storageKey`, `sha256` ET `sizeBytes` ÉTAIENT SAISIS LIBREMENT.
 *
 *    Trois valeurs qui n'ont de sens que si elles décrivent RÉELLEMENT le
 *    fichier déposé — l'empreinte est censée être « la seule garantie
 *    d'intégrité entre le papier et le système » — pouvaient être tapées à la
 *    main, sans aucun rapport avec un fichier réellement reçu. Le coffre ne
 *    recevait jamais de binaire : la ligne pouvait référencer un objet
 *    inexistant, ou l'empreinte d'un autre fichier. Ces trois champs sont
 *    désormais CALCULÉS par le serveur à partir du fichier réellement
 *    téléversé — voir `DocumentsController.register`.
 */
class RegisterDocumentDto {
  @IsEnum(GeneratedDocumentKind) kind!: GeneratedDocumentKind;

  @IsOptional() @IsUUID() dealId?: string;
  @IsOptional() @IsUUID() operationId?: string;
  @IsOptional() @IsUUID() invoiceId?: string;
}

class SignDocumentDto {
  @IsEnum(SignatoryKind) kind!: SignatoryKind;

  @IsString() @MaxLength(160) signatoryName!: string;
  /** Qualité du signataire — indispensable à l'opposabilité de la pièce. */
  @IsString() @MaxLength(160) signatoryCapacity!: string;
  @IsOptional() @IsString() @MaxLength(64) idDocumentRef?: string;

  @IsOptional() @IsUUID() driverId?: string;

  /** Image de la signature manuscrite capturée sur tablette. */
  @IsOptional() @IsString() @MaxLength(512) signatureStorageKey?: string;
  @IsOptional() @IsString() @Length(64, 64) signatureSha256?: string;

  /** Horloge de l'appareil — l'écart avec le serveur est un signal (§ 10.2). */
  @IsOptional() @IsISO8601() deviceTimestamp?: string;
  @IsOptional() @Type(() => Number) @IsNumber() latitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() longitude?: number;
}

class SupersedeDocumentDto extends RegisterDocumentDto {
  /** Une pièce qui en remplace une autre doit dire pourquoi. */
  @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
}

class DocumentQuery extends PaginationQuery {
  @IsOptional() @IsEnum(GeneratedDocumentKind) kind?: GeneratedDocumentKind;
  @IsOptional() @IsUUID() dealId?: string;
  @IsOptional() @IsUUID() operationId?: string;
}

// ===========================================================================
//  Service
// ===========================================================================

/** Préfixe de numérotation par nature de pièce. */
const DOC_SCOPE: Record<GeneratedDocumentKind, string> = {
  PROFORMA: 'DOC-PRO',
  INVOICE: 'DOC-FAC',
  CREDIT_NOTE: 'DOC-AV',
  DELIVERY_NOTE: 'BL',
  OPERATION_REPORT: 'RAP',
  TRANSPORT_ORDER: 'OT',
  MEASUREMENT_REPORT: 'REL',
};

/** Plafond de sécurité du tuyau, en octets — même principe que la conformité. */
const PLAFOND_TUYAU = 32 * 1024 * 1024;

/** Nature admise pour une pièce déposée à la main — un scan, pas un exécutable. */
const NATURES_ADMISES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

/** Fichier reçu, tel que multer le rend — voir field-attachments.controller.ts. */
interface FichierRecu {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Documents produits et signatures (§ 12).
 *
 * Le binaire n'entre JAMAIS en base : seules la clé de stockage objet et
 * l'empreinte SHA-256 y figurent. C'est elle qui permet, des années plus tard,
 * de confronter un papier présenté par un client, un assureur ou un auditeur
 * à ce que le système a réellement émis.
 *
 * UNE PIÈCE SCELLÉE NE SE MODIFIE PLUS. La correction produit un NOUVEAU
 * document portant « annule et remplace » et le motif du remplacement. La
 * règle est appliquée par trigger en base : aucune refonte de cette API ne
 * peut la contourner.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reference: ReferenceService,
    private readonly storage: StorageService,
  ) {}

  async list(query: DocumentQuery): Promise<Page<unknown>> {
    const where = {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.dealId ? { dealId: query.dealId } : {}),
      ...(query.operationId ? { operationId: query.operationId } : {}),
      ...(query.search
        ? { reference: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.generatedDocument.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { generatedAt: 'desc' },
        include: {
          deal: { select: { reference: true } },
          operation: { select: { reference: true } },
          invoice: { select: { number: true } },
          generatedBy: { select: { fullName: true } },
          supersedes: { select: { reference: true } },
          _count: { select: { signatures: true } },
        },
      }),
      this.prisma.generatedDocument.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  findOne(id: string) {
    return this.prisma.generatedDocument.findUniqueOrThrow({
      where: { id },
      include: {
        deal: { select: { reference: true, client: { select: { legalName: true } } } },
        operation: { select: { reference: true } },
        invoice: { select: { number: true, type: true } },
        generatedBy: { select: { fullName: true, role: true } },
        supersedes: { select: { id: true, reference: true } },
        supersededBy: { select: { id: true, reference: true } },
        signatures: {
          orderBy: { serverTimestamp: 'asc' },
          include: {
            user: { select: { fullName: true, role: true } },
            fieldUser: { select: { fullName: true, role: true } },
            driver: { select: { fullName: true } },
          },
        },
      },
    });
  }

  /**
   * Binaire d'une pièce SCELLÉE — une pièce encore mutable n'a pas de contenu
   * qu'on puisse promettre stable à qui le reçoit.
   *
   * `extraWhere` porte le cloisonnement de l'appelant (ex. portail : la pièce
   * doit se rattacher à une facture du tiers du jeton) — c'est au contrôleur
   * de le fournir, jamais à ce service de deviner qui appelle.
   */
  async download(id: string, extraWhere: Prisma.GeneratedDocumentWhereInput = {}) {
    const doc = await this.prisma.generatedDocument.findFirst({
      where: { id, isSealed: true, ...extraWhere },
      select: { storageKey: true, mimeType: true, sizeBytes: true, reference: true },
    });
    if (!doc) throw new NotFoundException('Pièce introuvable.');
    if (!(await this.storage.exists(doc.storageKey))) {
      throw new NotFoundException(
        'La référence existe mais le fichier est absent du stockage : à signaler.',
      );
    }
    return { doc, flux: this.storage.read(doc.storageKey) };
  }

  /**
   * Numéro de la séquence d'une nature de pièce, AVEC SONDE.
   *
   * ⚠️ CORRIGÉ — LA SONDE FACULTATIVE DE `ReferenceService` N'ÉTAIT JAMAIS
   *    FOURNIE ICI, ALORS QUE SON PROPRE COMMENTAIRE DÉCRIT EXACTEMENT CE CAS.
   *
   *    Un jeu de données de démonstration pose des références SANS passer
   *    par le compteur (`BL-2026-00001` inséré directement en base) : le
   *    compteur ignore leur existence et repart de 1. Le jour où cette
   *    nature de pièce est numérotée pour de vrai pour la PREMIÈRE fois, le
   *    numéro qu'il propose percute l'existant — `register()` échoue sur une
   *    contrainte d'unicité, après que le PDF a déjà été rendu avec ce
   *    numéro dans son en-tête. Constaté en le déclenchant : deux
   *    générations sur la même opération, la première perdue en échec, la
   *    seconde ayant sauté un numéro.
   */
  private annualReference(kind: GeneratedDocumentKind): Promise<string> {
    return this.reference.annual(DOC_SCOPE[kind], 5, new Date(), async (candidate) => {
      const pris = await this.prisma.generatedDocument.findUnique({
        where: { reference: candidate },
        select: { id: true },
      });
      return pris !== null;
    });
  }

  /**
   * Réserve un numéro de la séquence d'une nature de pièce, AVANT génération.
   *
   * Sert au générateur PDF (`DocumentsPdfProcessor`) exactement comme le
   * jeton d'authenticité précalculé ci-dessous : la référence doit être
   * connue AVANT le rendu pour être imprimée dans l'en-tête du document —
   * `register()` ne peut pas en fournir une nouvelle après coup sans que le
   * PDF déjà rendu affiche un numéro qui n'est plus le sien.
   */
  reserveReference(kind: GeneratedDocumentKind): Promise<string> {
    return this.annualReference(kind);
  }

  /**
   * Dépose le fichier reçu et rend les faits de stockage — clé, empreinte,
   * taille, nature. Jamais saisis : toujours CALCULÉS à partir d'un binaire
   * réellement reçu, seule garantie que l'empreinte enregistrée corresponde
   * au papier qu'elle est censée attester.
   */
  async materialiser(fichier: FichierRecu | undefined) {
    if (!fichier) {
      throw new BadRequestException('Aucun fichier reçu.');
    }
    if (!NATURES_ADMISES.includes(fichier.mimetype)) {
      throw new BadRequestException(
        `Type de fichier refusé (${fichier.mimetype}). Types admis : ${NATURES_ADMISES.join(', ')}.`,
      );
    }
    const objet = await this.storage.put(fichier.buffer, fichier.mimetype);
    return {
      storageKey: objet.storageKey,
      mimeType: objet.mimeType,
      sizeBytes: objet.sizeBytes,
      sha256: objet.sha256,
    };
  }

  /**
   * Enregistre une pièce produite. Non scellée : elle reste rectifiable.
   *
   * `precomputedToken`/`precomputedReference` servent au générateur PDF
   * (`DocumentsPdfProcessor`) : jeton et référence doivent être connus AVANT
   * le rendu pour être imprimés dans le document lui-même (QR code, en-tête)
   * — l'enregistrement ne peut pas en fournir de nouveaux après coup, le PDF
   * serait déjà figé avec les mauvais dedans.
   *
   * `actor` peut être un agent terrain : le rapport d'exécution et le bon de
   * livraison naissent d'une génération déclenchée depuis la tablette, pas du
   * bureau (§ 10, § 12.2). `generatedById` ne pointe alors PAS l'agent — la
   * colonne ne référence que `users`, jamais `field_users` — l'auteur réel
   * reste néanmoins tracé dans l'audit, qui distingue les deux réalms.
   */
  async register(
    dto: RegisterDocumentDto,
    actor: { type: ActorType; id: string },
    storageFacts: { storageKey: string; mimeType: string; sizeBytes: number; sha256: string },
    precomputedToken?: string,
    precomputedReference?: string,
  ) {
    if (!dto.dealId && !dto.operationId && !dto.invoiceId) {
      throw new BadRequestException(
        'Une pièce doit être rattachée à une affaire, une opération ou une facture : sans quoi elle est introuvable le jour où on la cherche.',
      );
    }

    const created = await this.prisma.generatedDocument.create({
      data: {
        kind: dto.kind,
        reference: precomputedReference ?? (await this.annualReference(dto.kind)),
        dealId: dto.dealId ?? null,
        operationId: dto.operationId ?? null,
        invoiceId: dto.invoiceId ?? null,
        storageKey: storageFacts.storageKey,
        mimeType: storageFacts.mimeType,
        sizeBytes: BigInt(Math.round(storageFacts.sizeBytes)),
        sha256: storageFacts.sha256,
        authenticityToken: precomputedToken ?? randomBytes(24).toString('hex'),
        generatedById: actor.type === ActorType.INTERNAL_USER ? actor.id : null,
      },
    });

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: AuditAction.CREATE,
      entityType: 'GeneratedDocument',
      entityId: created.id,
      after: { ...created, sizeBytes: String(created.sizeBytes) },
    });

    return created;
  }

  /**
   * Apposition d'une signature.
   *
   * Les DEUX horodatages sont conservés : celui de l'appareil et celui du
   * serveur. L'horloge d'une tablette n'est pas fiable, et l'écart entre les
   * deux est en soi un signal d'audit (§ 10.2).
   */
  async sign(
    documentId: string,
    dto: SignDocumentDto,
    actor: { type: ActorType; id: string },
  ) {
    const doc = await this.prisma.generatedDocument.findUniqueOrThrow({
      where: { id: documentId },
      select: { isSealed: true, reference: true },
    });
    if (doc.isSealed) {
      throw new BadRequestException(
        `La pièce ${doc.reference} est scellée : elle n’accepte plus de signature. Émettre une pièce « annule et remplace ».`,
      );
    }

    const signature = await this.prisma.signature.create({
      data: {
        documentId,
        kind: dto.kind,
        userId: actor.type === ActorType.INTERNAL_USER ? actor.id : null,
        fieldUserId: actor.type === ActorType.FIELD_USER ? actor.id : null,
        driverId: dto.driverId ?? null,
        signatoryName: dto.signatoryName,
        signatoryCapacity: dto.signatoryCapacity,
        idDocumentRef: dto.idDocumentRef ?? null,
        signatureStorageKey: dto.signatureStorageKey ?? null,
        signatureSha256: dto.signatureSha256 ?? null,
        deviceTimestamp: dto.deviceTimestamp ? new Date(dto.deviceTimestamp) : null,
        latitude: dto.latitude?.toFixed(7) ?? null,
        longitude: dto.longitude?.toFixed(7) ?? null,
      },
    });

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: AuditAction.CREATE,
      entityType: 'Signature',
      entityId: signature.id,
      after: {
        documentId,
        signatoryName: dto.signatoryName,
        signatoryCapacity: dto.signatoryCapacity,
      },
    });

    // ⚠️ SCELLE AUTOMATIQUEMENT DÈS QUE LES SIGNATAIRES REQUIS Y SONT.
    //
    //    Un rapport ou un bon de livraison correctement signé qui attend
    //    encore un geste manuel de scellement reproduirait le piège de la
    //    facture simple sans motif (§ discussion 17/08) : signé sur le
    //    terrain, puis coincé au bureau faute d'un clic que personne ne
    //    pense à faire. `seal()` reste appelable à la main ; ceci ne fait que
    //    ne pas attendre qu'on le fasse quand la pièce est déjà complète.
    try {
      await this.seal(documentId, actor.id);
    } catch {
      // Signataire encore manquant (bon de livraison : le client n'a pas
      // encore signé) - ce n'est pas une erreur, juste pas encore le moment.
    }

    return signature;
  }

  /**
   * Scellement — la pièce quitte le domaine du modifiable.
   *
   * À partir d'ici, ni la clé de stockage, ni l'empreinte, ni la taille ne
   * peuvent changer : un trigger le refuse. C'est ce qui donne sa valeur au
   * QR code d'authenticité imprimé sur le papier.
   */
  async seal(id: string, actorId: string) {
    const doc = await this.prisma.generatedDocument.findUniqueOrThrow({
      where: { id },
      select: {
        isSealed: true,
        kind: true,
        reference: true,
        signatures: { select: { kind: true } },
      },
    });
    if (doc.isSealed) {
      throw new BadRequestException(`La pièce ${doc.reference} est déjà scellée.`);
    }

    // ⚠️ LE RAPPORT ET LE BON DE LIVRAISON N'ATTENDENT PAS LES MÊMES
    //    SIGNATAIRES (§ discussion 17/08) - « au moins une signature »
    //    laissait sceller un bon de livraison que seul l'agent avait signé,
    //    sans le client. Un rapport d'exécution est un constat de l'agent :
    //    lui seul l'atteste. Un bon de livraison engage les deux parties.
    const kinds = new Set(doc.signatures.map((s) => s.kind));
    if (doc.kind === GeneratedDocumentKind.OPERATION_REPORT && !kinds.has(SignatoryKind.FIELD_USER)) {
      throw new BadRequestException(
        `Le rapport d’exécution ${doc.reference} n’est pas encore signé par l’agent terrain.`,
      );
    }
    if (doc.kind === GeneratedDocumentKind.DELIVERY_NOTE) {
      const manquants: string[] = [];
      if (!kinds.has(SignatoryKind.FIELD_USER)) manquants.push('l’agent terrain');
      if (!kinds.has(SignatoryKind.CLIENT_REPRESENTATIVE)) manquants.push('le représentant du client');
      if (manquants.length > 0) {
        throw new BadRequestException(
          `Le bon de livraison ${doc.reference} attend encore la signature de ${manquants.join(' et de ')}.`,
        );
      }
    }

    const sealed = await this.prisma.generatedDocument.update({
      where: { id },
      data: { isSealed: true, sealedAt: new Date() },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.UPDATE,
      entityType: 'GeneratedDocument',
      entityId: id,
      after: { isSealed: true, sealedAt: sealed.sealedAt },
    });

    return sealed;
  }

  /**
   * « Annule et remplace » — la seule façon de corriger une pièce scellée.
   * L'ancienne reste en place : on n'efface pas l'histoire, on la complète.
   */
  async supersede(
    id: string,
    dto: SupersedeDocumentDto,
    actorId: string,
    storageFacts: { storageKey: string; mimeType: string; sizeBytes: number; sha256: string },
  ) {
    const original = await this.prisma.generatedDocument.findUniqueOrThrow({
      where: { id },
      select: { id: true, kind: true, dealId: true, operationId: true, invoiceId: true, supersededBy: true },
    });
    if (original.supersededBy) {
      throw new BadRequestException('Cette pièce a déjà été remplacée.');
    }

    const replacement = await this.prisma.generatedDocument.create({
      data: {
        kind: dto.kind ?? original.kind,
        reference: await this.annualReference(dto.kind ?? original.kind),
        dealId: dto.dealId ?? original.dealId,
        operationId: dto.operationId ?? original.operationId,
        invoiceId: dto.invoiceId ?? original.invoiceId,
        storageKey: storageFacts.storageKey,
        mimeType: storageFacts.mimeType,
        sizeBytes: BigInt(Math.round(storageFacts.sizeBytes)),
        sha256: storageFacts.sha256,
        authenticityToken: randomBytes(24).toString('hex'),
        supersedesId: original.id,
        supersessionReason: dto.reason,
        generatedById: actorId,
      },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.OVERRIDE,
      entityType: 'GeneratedDocument',
      entityId: replacement.id,
      before: { supersedesId: original.id },
      after: { reference: replacement.reference, reason: dto.reason },
    });

    return replacement;
  }

  /**
   * Vérification d'authenticité par jeton — route PUBLIQUE par destination.
   *
   * Elle ne révèle que ce qu'un porteur du papier connaît déjà : la nature de
   * la pièce, sa référence, sa date et son empreinte. Jamais de montant, ni de
   * client, ni de marge.
   */
  async verify(token: string) {
    const doc = await this.prisma.generatedDocument.findUnique({
      where: { authenticityToken: token },
      select: {
        kind: true,
        reference: true,
        sha256: true,
        generatedAt: true,
        isSealed: true,
        sealedAt: true,
        supersededBy: { select: { reference: true } },
      },
    });
    if (!doc) {
      return { valid: false, message: 'Aucune pièce ne correspond à ce jeton.' };
    }
    return {
      valid: true,
      kind: doc.kind,
      reference: doc.reference,
      sha256: doc.sha256,
      generatedAt: doc.generatedAt,
      sealed: doc.isSealed,
      sealedAt: doc.sealedAt,
      superseded: doc.supersededBy?.reference ?? null,
      message: doc.supersededBy
        ? `Pièce authentique, mais REMPLACÉE par ${doc.supersededBy.reference}.`
        : 'Pièce authentique.',
    };
  }
}

// ===========================================================================
//  Contrôleur interne
// ===========================================================================

@Controller('api/internal/documents')
@RequireRealm(Realm.INTERNAL)
export class DocumentsController {
  constructor(
    private readonly service: DocumentsService,
    @InjectQueue('documents') private readonly documentsQueue: Queue,
  ) {}

  /** Suivi d'une génération PDF mise en file (§ 1.1). */
  @Get('jobs/:jobId')
  @Roles(
    UserRole.DG,
    UserRole.CCOO,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.LOGISTICS_COORD,
  )
  async jobStatus(@Param('jobId') jobId: string) {
    const job = await this.documentsQueue.getJob(jobId);
    if (!job) throw new NotFoundException('Tâche de génération introuvable : peut-être déjà purgée.');
    const state = await job.getState();
    return {
      state,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason ?? null,
      result: state === 'completed' ? job.returnvalue : null,
    };
  }

  @Get()
  @Roles(
    UserRole.DG,
    UserRole.CCOO,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.LOGISTICS_COORD,
    UserRole.ASSISTANT_DG,
  )
  @Screen('documents')
  list(@Query() query: DocumentQuery) {
    return this.service.list(query);
  }

  /**
   * ⚠️ CORRIGÉ — CETTE ROUTE ÉTAIT DÉCRITE COMME PUBLIQUE ET NE L'ÉTAIT PAS.
   *
   *    Le commentaire de `DocumentsService.verify` dit depuis toujours
   *    « route PUBLIQUE par destination » : un client, un assureur ou un
   *    auditeur qui scanne le QR code d'un papier n'a — et ne doit pas avoir —
   *    de compte interne. Elle héritait pourtant du réalm `INTERNAL` et d'une
   *    liste de rôles posés sur la classe et la méthode : quiconque scannait
   *    le QR code sans jeton interne valide recevait un 401, jamais la
   *    vérification promise. Seul un usage interne, jamais testé pour de vrai
   *    depuis un papier, ne l'aurait révélé.
   */
  @Get('verify/:token')
  @Public()
  verify(@Param('token') token: string) {
    return this.service.verify(token);
  }

  @Get(':id')
  @Roles(
    UserRole.DG,
    UserRole.CCOO,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.LOGISTICS_COORD,
  )
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/download')
  @Roles(
    UserRole.DG,
    UserRole.CCOO,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.LOGISTICS_COORD,
  )
  @Header('Cache-Control', 'private, max-age=3600')
  async download(@Param('id', ParseUUIDPipe) id: string) {
    const { doc, flux } = await this.service.download(id);
    return new StreamableFile(flux as never, {
      type: doc.mimeType,
      length: Number(doc.sizeBytes),
      disposition: `attachment; filename="${doc.reference}.pdf"`,
    });
  }

  /**
   * ⚠️ CORRIGÉ — LA PIÈCE SE DÉPOSAIT SANS FICHIER, CLÉ ET EMPREINTE SAISIES
   *    À LA MAIN.
   *
   *    Aucun bouton de téléversement n'existait, et `storageKey`/`sha256`
   *    étaient des champs de texte libre : rien ne garantissait qu'ils
   *    décrivaient un fichier réellement présent dans le coffre, ni le bon.
   *    Le dépôt est désormais un envoi multipart : le fichier est reçu ICI,
   *    et la clé comme l'empreinte en sont CALCULÉES, jamais saisies.
   */
  @Post()
  @Roles(UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT, UserRole.LOGISTICS_COORD)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PLAFOND_TUYAU } }))
  async register(
    @UploadedFile() fichier: FichierRecu | undefined,
    @Body() dto: RegisterDocumentDto,
    @Req() req: { auth: { sub: string } },
  ) {
    const storageFacts = await this.service.materialiser(fichier);
    return this.service.register(dto, { type: ActorType.INTERNAL_USER, id: req.auth.sub }, storageFacts);
  }

  @Post(':id/signatures')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD)
  sign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignDocumentDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.sign(id, dto, { type: ActorType.INTERNAL_USER, id: req.auth.sub });
  }

  @Patch(':id/seal')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
  seal(@Param('id', ParseUUIDPipe) id: string, @Req() req: { auth: { sub: string } }) {
    return this.service.seal(id, req.auth.sub);
  }

  @Post(':id/supersede')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.FINANCE_CFO)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PLAFOND_TUYAU } }))
  async supersede(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() fichier: FichierRecu | undefined,
    @Body() dto: SupersedeDocumentDto,
    @Req() req: { auth: { sub: string } },
  ) {
    const storageFacts = await this.service.materialiser(fichier);
    return this.service.supersede(id, dto, req.auth.sub, storageFacts);
  }
}

// ===========================================================================
//  Contrôleur terrain — signature sur site, par l'agent ou le contrôleur HSE
// ===========================================================================

/**
 * Natures de pièces qu'un agent de terrain peut voir — LISTE BLANCHE.
 *
 * Une liste NOIRE serait fausse par construction : toute nature ajoutée plus
 * tard serait visible par défaut, et personne ne s'en apercevrait avant qu'une
 * facture ne parte sur une tablette.
 */
const NATURES_VISIBLES_DU_TERRAIN: GeneratedDocumentKind[] = [
  GeneratedDocumentKind.TRANSPORT_ORDER,
  GeneratedDocumentKind.DELIVERY_NOTE,
  GeneratedDocumentKind.MEASUREMENT_REPORT,
  GeneratedDocumentKind.OPERATION_REPORT,
];

/**
 * Registre documentaire vu du TERRAIN.
 *
 * ⚠️ SERVICE DISTINCT DE CELUI DE LA CONSOLE INTERNE, ET C'EST LA CORRECTION.
 *
 *    Ce contrôleur déléguait à `DocumentsService`, écrit pour le bureau : sans
 *    périmètre, sans liste blanche, et rendant `deal.reference` et
 *    `invoice.number` dans son `include`. Un agent obtenait l'INTÉGRALITÉ du
 *    registre documentaire, références d'affaires comprises, et pouvait
 *    demander `?kind=INVOICE`. Que la réponse soit aujourd'hui vide tient au
 *    jeu de données, non à un contrôle : la première facture enregistrée
 *    devenait lisible par tout agent.
 *
 *    Le § 10.3 est explicite — l'agent ne voit jamais une facture, ni une
 *    donnée d'un autre client. Le cloisonnement passe par un objet DÉDIÉ, pas
 *    par un masquage a posteriori.
 */
/**
 * Étapes à partir desquelles la clôture terrain peut être déclenchée.
 *
 * Avant `DECHARGEMENT`, la livraison n'a pas eu lieu : un bon de livraison
 * n'aurait rien à décrire. À partir de `CLOTURE`, les deux pièces sont
 * censées déjà exister — le trigger `enforce_closure_documents_sealed`
 * (§ SQL) le garantit — et une seconde génération ferait doublon.
 */
const ETAPES_CLOTURABLES: OperationPhase[] = [
  OperationPhase.DECHARGEMENT,
  OperationPhase.POST_DECHARGEMENT,
];

@Injectable()
export class FieldDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perimetre: FieldScopeService,
    @InjectQueue('documents') private readonly documentsQueue: Queue<OperationClosurePdfJob>,
  ) {}

  /**
   * Déclenche la génération du rapport d'exécution et du bon de livraison.
   *
   * ⚠️ CORRIGÉ — CES DEUX PIÈCES ÉTAIENT « DÉCLARÉES, JAMAIS DÉCLENCHÉES ».
   *
   *    `GeneratedDocumentKind.OPERATION_REPORT` et `DELIVERY_NOTE` existaient
   *    dans le schéma, dans la liste blanche du terrain et dans les règles de
   *    scellement — mais rien ne les produisait jamais (§ discussion 17/08).
   *
   *    Génération asynchrone, comme pour une facture (`DocumentsPdfProcessor`) :
   *    le rendu Chromium ne doit pas tenir la requête de l'agent, sur une
   *    tablette dont le réseau est incertain.
   */
  async generateClosureDocuments(operationId: string, actor: FieldActor): Promise<{ jobId: string }> {
    await this.perimetre.assertOperation(operationId, actor);

    const operation = await this.prisma.operation.findUniqueOrThrow({
      where: { id: operationId },
      select: { phase: true, reference: true },
    });
    if (!ETAPES_CLOTURABLES.includes(operation.phase)) {
      throw new BadRequestException(
        `L'opération ${operation.reference} n'est pas au stade de la clôture (étape actuelle : ${operation.phase}). La livraison doit avoir eu lieu, et les deux pièces ne se génèrent qu'une fois.`,
      );
    }

    const existants = await this.prisma.generatedDocument.findMany({
      where: {
        operationId,
        kind: { in: [GeneratedDocumentKind.OPERATION_REPORT, GeneratedDocumentKind.DELIVERY_NOTE] },
      },
      select: { kind: true, reference: true },
    });
    if (existants.length > 0) {
      throw new BadRequestException(
        `Cette opération porte déjà : ${existants.map((e) => e.reference).join(', ')}. Une pièce ne se génère qu'une fois : voir sa signature depuis la liste des documents.`,
      );
    }

    const job = await this.documentsQueue.add(
      'operation-closure',
      { type: 'operation-closure', operationId, fieldUserId: actor.id },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );
    return { jobId: job.id! };
  }

  /**
   * Pièces des opérations DE L'AGENT, et de ces natures-là seulement.
   *
   * Le filtre par opération est une RESTRICTION du périmètre, jamais un moyen
   * d'en sortir : l'opération demandée est croisée avec celles de l'agent.
   */
  async list(
    query: { operationId?: string; pageSize: number; skip: number },
    actor: FieldActor,
  ): Promise<Page<unknown>> {
    const where: Prisma.GeneratedDocumentWhereInput = {
      kind: { in: NATURES_VISIBLES_DU_TERRAIN },
      operation: {
        AND: [
          this.perimetre.where(actor),
          ...(query.operationId ? [{ id: query.operationId }] : []),
        ],
      },
    };

    const [items, total] = await Promise.all([
      this.prisma.generatedDocument.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { generatedAt: 'desc' },
        // `select` et non `include` : on énumère ce qui sort, plutôt que
        // d'énumérer ce qu'on retire. La référence de l'affaire et le numéro
        // de facture ne figurent pas ici, et ne peuvent pas y revenir par
        // inadvertance.
        select: {
          id: true,
          kind: true,
          reference: true,
          isSealed: true,
          sealedAt: true,
          generatedAt: true,
          operation: { select: { id: true, reference: true } },
          _count: { select: { signatures: true } },
        },
      }),
      this.prisma.generatedDocument.count({ where }),
    ]);
    return paginate(items, total, { pageSize: query.pageSize, skip: query.skip } as never);
  }

  /**
   * La pièce est-elle signable par cet agent ?
   *
   * Le refus doit venir du PÉRIMÈTRE, pas de l'état de la pièce. Sans cette
   * vérification, le seul obstacle était le scellement — donc les pièces non
   * scellées d'autres clients acceptaient une signature de complaisance sur
   * un bon de livraison opposable.
   */
  async assertSignable(documentId: string, actor: FieldActor): Promise<void> {
    const piece = await this.prisma.generatedDocument.findFirst({
      where: {
        id: documentId,
        kind: { in: NATURES_VISIBLES_DU_TERRAIN },
        operation: this.perimetre.where(actor),
      },
      select: { id: true },
    });
    if (!piece) throw new NotFoundException(this.perimetre.introuvable);
  }
}

@Controller('api/field/documents')
@RequireRealm(Realm.FIELD)
export class FieldDocumentsController {
  constructor(
    private readonly service: FieldDocumentsService,
    private readonly interne: DocumentsService,
  ) {}

  @Get()
  @FieldRoles(FieldRole.FIELD_AGENT, FieldRole.HSE_CONTROLLER)
  list(
    @Query() query: DocumentQuery,
    @Req() req: { auth: { sub: string; role?: FieldRole } },
  ) {
    return this.service.list(
      { operationId: query.operationId, pageSize: query.pageSize, skip: query.skip },
      { id: req.auth.sub, role: req.auth.role },
    );
  }

  /**
   * Génère le rapport d'exécution et le bon de livraison de l'opération.
   * Réservé au FIELD_AGENT : c'est lui qui clôture, jamais le contrôleur HSE
   * seul — même s'il partage la liste blanche de lecture et de signature.
   */
  @Post('operations/:operationId/closure')
  @FieldRoles(FieldRole.FIELD_AGENT)
  generateClosure(
    @Param('operationId', ParseUUIDPipe) operationId: string,
    @Req() req: { auth: { sub: string; role?: FieldRole } },
  ) {
    return this.service.generateClosureDocuments(operationId, { id: req.auth.sub, role: req.auth.role });
  }

  /**
   * Signature des parties prenantes en fin d'opération, sur la tablette.
   * Le client signe ici, et repart avec son exemplaire papier.
   */
  @Post(':id/signatures')
  @FieldRoles(FieldRole.FIELD_AGENT, FieldRole.HSE_CONTROLLER)
  async sign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignDocumentDto,
    @Req() req: { auth: { sub: string; role?: FieldRole } },
  ) {
    await this.service.assertSignable(id, { id: req.auth.sub, role: req.auth.role });
    // La pose de signature elle-même reste au service commun : les règles de
    // scellement et d'ordre des signataires sont les mêmes des deux côtés, et
    // les dupliquer les ferait diverger.
    return this.interne.sign(id, dto, { type: ActorType.FIELD_USER, id: req.auth.sub });
  }
}
