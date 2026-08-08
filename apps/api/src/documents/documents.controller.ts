import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
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
  FieldRole,
  GeneratedDocumentKind,
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
  Min,
  MinLength,
} from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { FieldRoles, Realm, RequireRealm, Roles } from '../common/auth/realm';
import { Page, PaginationQuery, paginate } from '../common/http/pagination.dto';
import { FieldActor, FieldScopeService } from '../field/field-scope.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ReferenceService } from '../common/reference/reference.service';

// ===========================================================================
//  DTO
// ===========================================================================

class RegisterDocumentDto {
  @IsEnum(GeneratedDocumentKind) kind!: GeneratedDocumentKind;

  @IsOptional() @IsUUID() dealId?: string;
  @IsOptional() @IsUUID() operationId?: string;
  @IsOptional() @IsUUID() invoiceId?: string;

  /** Clé de l'objet dans le coffre — le binaire n'est JAMAIS en base. */
  @IsString() @MaxLength(512) storageKey!: string;
  @IsOptional() @IsString() @MaxLength(120) mimeType?: string;
  @Type(() => Number) @IsNumber() @Min(1) sizeBytes!: number;
  /** Empreinte du fichier, seule garantie d'intégrité entre papier et système. */
  @IsString() @Length(64, 64) sha256!: string;
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

  /** Enregistre une pièce produite. Non scellée : elle reste rectifiable. */
  async register(dto: RegisterDocumentDto, actorId: string) {
    if (!dto.dealId && !dto.operationId && !dto.invoiceId) {
      throw new BadRequestException(
        'Une pièce doit être rattachée à une affaire, une opération ou une facture — sans quoi elle est introuvable le jour où on la cherche.',
      );
    }

    const created = await this.prisma.generatedDocument.create({
      data: {
        kind: dto.kind,
        reference: await this.reference.annual(DOC_SCOPE[dto.kind], 5),
        dealId: dto.dealId ?? null,
        operationId: dto.operationId ?? null,
        invoiceId: dto.invoiceId ?? null,
        storageKey: dto.storageKey,
        mimeType: dto.mimeType ?? 'application/pdf',
        sizeBytes: BigInt(Math.round(dto.sizeBytes)),
        sha256: dto.sha256,
        authenticityToken: randomBytes(24).toString('hex'),
        generatedById: actorId,
      },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
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
        `La pièce ${doc.reference} est scellée : elle n’accepte plus de signature. Émettre une pièce « annule et remplace » (§ 12.2).`,
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
      select: { isSealed: true, kind: true, reference: true, _count: { select: { signatures: true } } },
    });
    if (doc.isSealed) {
      throw new BadRequestException(`La pièce ${doc.reference} est déjà scellée.`);
    }
    // Un bon de livraison ou un rapport d'exécution non signé n'a aucune
    // valeur opposable : le sceller reviendrait à figer une pièce vide.
    const REQUIRES_SIGNATURE: GeneratedDocumentKind[] = [
      GeneratedDocumentKind.DELIVERY_NOTE,
      GeneratedDocumentKind.OPERATION_REPORT,
    ];
    if (REQUIRES_SIGNATURE.includes(doc.kind) && doc._count.signatures === 0) {
      throw new BadRequestException(
        `La pièce ${doc.reference} ne porte aucune signature. Un ${
          doc.kind === GeneratedDocumentKind.DELIVERY_NOTE
            ? 'bon de livraison'
            : 'rapport d’exécution'
        } non signé n’est pas opposable.`,
      );
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
  async supersede(id: string, dto: SupersedeDocumentDto, actorId: string) {
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
        reference: await this.reference.annual(DOC_SCOPE[dto.kind ?? original.kind], 5),
        dealId: dto.dealId ?? original.dealId,
        operationId: dto.operationId ?? original.operationId,
        invoiceId: dto.invoiceId ?? original.invoiceId,
        storageKey: dto.storageKey,
        mimeType: dto.mimeType ?? 'application/pdf',
        sizeBytes: BigInt(Math.round(dto.sizeBytes)),
        sha256: dto.sha256,
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
  constructor(private readonly service: DocumentsService) {}

  @Get()
  @Roles(
    UserRole.DG,
    UserRole.CCOO,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.LOGISTICS_COORD,
    UserRole.ASSISTANT_DG,
  )
  list(@Query() query: DocumentQuery) {
    return this.service.list(query);
  }

  @Get('verify/:token')
  @Roles(
    UserRole.DG,
    UserRole.CCOO,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.LOGISTICS_COORD,
    UserRole.ASSISTANT_DG,
  )
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

  @Post()
  @Roles(UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT, UserRole.LOGISTICS_COORD)
  register(@Body() dto: RegisterDocumentDto, @Req() req: { auth: { sub: string } }) {
    return this.service.register(dto, req.auth.sub);
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
  supersede(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SupersedeDocumentDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.supersede(id, dto, req.auth.sub);
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
@Injectable()
export class FieldDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perimetre: FieldScopeService,
  ) {}

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
