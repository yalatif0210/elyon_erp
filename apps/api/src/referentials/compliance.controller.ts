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
  AuditAction, ComplianceType, DocumentType, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Realm, RequireRealm, Roles, Screen } from '../common/auth/realm';
import { SettingsService } from '../common/config/settings.service';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';

/**
 * Conformité des tiers, véhicules et chauffeurs (SPECIFICATIONS.md § 6.4).
 *
 * C'est la valeur immédiate du lot 1 : avant même qu'une opération existe,
 * savoir quelle assurance expire, quel contrôle technique est périmé et quel
 * chauffeur n'est plus habilité vaut déjà le déploiement.
 *
 * Le statut n'est JAMAIS saisi — il est dérivé de la date d'expiration par un
 * trigger. Ces endpoints ne font que le lire.
 */

class ExpiryWatchQuery {
  /** Fenêtre de préavis en jours. Par défaut celle du paramétrage. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  withinDays?: number;

  /** N'afficher que les pièces bloquantes pour l'affectation. */
  @IsOptional()
  @IsString()
  blockingOnly?: string;
}

class CreateComplianceDto {
  @IsEnum(ComplianceType)
  type!: ComplianceType;

  @IsString()
  @MaxLength(120)
  reference!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  issuingBody?: string;

  @IsDateString()
  issueDate!: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;

  /**
   * Pièce numérisée qui atteste l'enregistrement — issue d'un dépôt
   * préalable (`POST compliance/documents`). Facultative : un enregistrement
   * saisi de mémoire, en attendant le scan, reste possible.
   */
  @IsOptional()
  @IsUUID()
  documentId?: string;
}

/** Plafond de sécurité du tuyau, en octets — même principe que le terrain. */
const PLAFOND_TUYAU = 32 * 1024 * 1024;

/** Nature admise pour un document de conformité — un scan, pas un exécutable. */
const NATURES_ADMISES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

/**
 * `DocumentType` est un référentiel plus large que `ComplianceType` — il
 * couvre aussi les pièces générées (facture, bon de livraison…). Dérivé
 * plutôt que redemandé : l'agent qui vient de choisir « Assurance » n'a pas
 * à choisir une seconde fois, dans un vocabulaire différent, ce qu'il vient
 * de dire.
 */
const DOCUMENT_TYPE_PAR_COMPLIANCE_TYPE: Record<ComplianceType, DocumentType> = {
  CUSTOMS_LICENSE: DocumentType.CUSTOMS_CERTIFICATE,
  MINISTERIAL_APPROVAL: DocumentType.MINISTERIAL_APPROVAL,
  IMPORT_EXPORT_LICENSE: DocumentType.IMPORT_EXPORT_LICENSE,
  INSURANCE: DocumentType.INSURANCE_POLICY,
  TECHNICAL_INSPECTION: DocumentType.TECHNICAL_INSPECTION,
  DRIVER_LICENSE: DocumentType.DRIVER_DOCUMENT,
  DRIVER_TRAINING: DocumentType.DRIVER_DOCUMENT,
  HSE_CERTIFICATION: DocumentType.OTHER,
  VESSEL_CERTIFICATE: DocumentType.VESSEL_CERTIFICATE,
  SAFETY_DATA_SHEET: DocumentType.SAFETY_DATA_SHEET,
  OTHER: DocumentType.OTHER,
};

/** Fichier reçu, tel que multer le rend — voir field-attachments.controller.ts. */
interface FichierRecu {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** État de conformité consolidé — vue v_transport_compliance. */
  async overview(): Promise<unknown[]> {
    return this.prisma.$queryRawUnsafe(
      `SELECT subject_kind, subject_id, subject_code, subject_label,
              expired_count::int, suspended_count::int, expiring_count::int,
              next_expiry, is_compliant
         FROM v_transport_compliance
        ORDER BY is_compliant ASC, expiring_count DESC, subject_kind, subject_label`,
    );
  }

  /** Moyens actuellement non conformes — ceux qui déclenchent le verrou § 11.2. */
  async nonCompliant(): Promise<unknown[]> {
    return this.prisma.$queryRawUnsafe(
      `SELECT subject_kind, subject_id, subject_code, subject_label,
              expired_count::int, suspended_count::int
         FROM v_transport_compliance
        WHERE NOT is_compliant
        ORDER BY subject_kind, subject_label`,
    );
  }

  /** Échéancier documentaire — alimente le moteur d'alerte (§ 6.6). */
  async expiryWatch(withinDays: number | undefined, blockingOnly: boolean): Promise<unknown[]> {
    const horizon = withinDays ?? (await this.noticeDays());
    return this.prisma.$queryRawUnsafe(
      `SELECT id, type, reference, expiry_date, days_remaining::int, status,
              is_blocking, owner_kind, owner_label, owner_id
         FROM v_compliance_expiry_watch
        WHERE days_remaining <= $1
          AND ($2::boolean IS NOT TRUE OR is_blocking)
        ORDER BY expiry_date`,
      horizon,
      blockingOnly,
    );
  }

  /**
   * Dépôt de la pièce numérisée, AVANT l'enregistrement qui la référence.
   *
   * ⚠️ CORRIGÉ — LE DÉPÔT N'EXISTAIT NULLE PART.
   *
   *    `GET records/:id` rendait `document.storageKey` depuis toujours,
   *    `records/:id/document` sait la restituer — mais aucun enregistrement
   *    de conformité n'avait jamais de fichier réellement rattaché : ni la
   *    création, ni aucune autre route n'acceptait de le déposer. La preuve
   *    documentaire d'une conformité — le SEUL fait qui rend une assurance ou
   *    un agrément opposables — n'existait jamais que dans le classeur papier
   *    de quelqu'un.
   *
   *    Déposé D'ABORD, séparément : le formulaire de création reste un envoi
   *    JSON simple, et un agent qui a le scan en main mais pas encore tous
   *    les autres champs peut le déposer sans perdre sa saisie.
   */
  async uploadDocument(
    fichier: FichierRecu | undefined,
    complianceType: ComplianceType,
    actorId: string,
  ) {
    if (!fichier) {
      throw new BadRequestException('Aucun fichier reçu.');
    }
    if (!(complianceType in DOCUMENT_TYPE_PAR_COMPLIANCE_TYPE)) {
      throw new BadRequestException(`Nature de conformité inconnue (${complianceType}).`);
    }
    if (!NATURES_ADMISES.includes(fichier.mimetype)) {
      throw new BadRequestException(
        `Type de fichier refusé (${fichier.mimetype}). Types admis : ${NATURES_ADMISES.join(', ')}.`,
      );
    }

    const objet = await this.storage.put(fichier.buffer, fichier.mimetype);

    // ⚠️ `Document.storageKey` EST UNIQUE — CONTRAIREMENT À
    //    `OperationAttachment.storageKey`, VOLONTAIREMENT PAS UNIQUE LÀ-BAS
    //    (§ commentaire du modèle) PARCE QUE LE MÊME CLICHÉ SERT DEUX POINTS
    //    DE CONTRÔLE, UN CAS NORMAL. Le même risque existe ici : une police
    //    d'assurance flotte couvre plusieurs véhicules, le même scan peut
    //    légitimement attester deux enregistrements de conformité distincts.
    //    Sans ce garde-fou, le second dépôt du MÊME fichier échouerait sur la
    //    contrainte d'unicité — une erreur 500 opaque là où l'agent s'attend
    //    juste à pouvoir réutiliser un scan déjà déposé.
    const existant = objet.alreadyPresent
      ? await this.prisma.document.findFirst({
          where: { storageKey: objet.storageKey },
          select: { id: true, title: true },
        })
      : null;
    if (existant) {
      return existant;
    }

    const document = await this.prisma.document.create({
      data: {
        type: DOCUMENT_TYPE_PAR_COMPLIANCE_TYPE[complianceType],
        title: fichier.originalname.slice(0, 255),
        storageKey: objet.storageKey,
        mimeType: objet.mimeType,
        sizeBytes: BigInt(objet.sizeBytes),
        sha256: objet.sha256,
        // Pièce de conformité interne par défaut : ni le client, ni le
        // terrain n'ont besoin de voir une police d'assurance ou un contrôle
        // technique pour affecter un moyen — seul son EFFET (conforme ou non)
        // leur est montré, jamais la pièce elle-même.
        isClientVisible: false,
        isFieldVisible: false,
        uploadedById: actorId,
      },
      select: { id: true, title: true },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'Document',
      entityId: document.id,
      after: { title: document.title, sha256: objet.sha256 },
    });

    return document;
  }

  async create(dto: CreateComplianceDto, actorId: string) {
    // Le rattachement à exactement un porteur est vérifié en base
    // (chk_compliance_single_owner) : inutile de le dupliquer ici, la
    // contrainte remontera en 422 via le filtre Prisma.
    const piece = await this.prisma.complianceRecord.create({
      data: {
        type: dto.type,
        reference: dto.reference,
        issuingBody: dto.issuingBody ?? null,
        issueDate: new Date(dto.issueDate),
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        partnerId: dto.partnerId ?? null,
        vehicleId: dto.vehicleId ?? null,
        driverId: dto.driverId ?? null,
        documentId: dto.documentId ?? null,
        recordedById: actorId,
      },
    });

    // ⚠️ CETTE ÉCRITURE NE LAISSAIT AUCUNE TRACE D'AUDIT.
    //
    //    C'est pourtant la pièce qui rend un transporteur, un véhicule ou un
    //    chauffeur AFFECTABLE (§ 6.4) : enregistrer une assurance périmée comme
    //    valide ouvre le verrou de conformité. Le seul témoin était la colonne
    //    `recordedById` de la ligne elle-même — modifiable, et effacée par la
    //    correction suivante.
    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'ComplianceRecord',
      entityId: piece.id,
      after: piece,
    });

    return piece;
  }

  findOne(id: string) {
    return this.prisma.complianceRecord.findUniqueOrThrow({
      where: { id },
      include: {
        partner: { select: { code: true, legalName: true } },
        vehicle: { select: { registration: true, brandModel: true } },
        driver: { select: { fullName: true, employeeNumber: true } },
        document: { select: { id: true, title: true, storageKey: true } },
      },
    });
  }

  /**
   * Pièce numérisée derrière un enregistrement de conformité.
   *
   * ⚠️ CORRIGÉ — `GET records/:id` RENDAIT DÉJÀ `document.storageKey`, SANS
   *    AUCUNE ROUTE POUR ALLER LE LIRE. Le détail d'un enregistrement de
   *    conformité savait dire QUEL document l'atteste, jamais MONTRER ce
   *    document — l'agrément, l'assurance ou le contrôle technique lui-même.
   */
  async downloadDocument(id: string) {
    const record = await this.prisma.complianceRecord.findUnique({
      where: { id },
      select: { document: { select: { title: true, storageKey: true, mimeType: true, sizeBytes: true } } },
    });
    if (!record?.document) {
      throw new NotFoundException('Aucune pièce numérisée rattachée à cet enregistrement.');
    }
    if (!(await this.storage.exists(record.document.storageKey))) {
      throw new NotFoundException('La pièce est référencée mais le fichier est absent du stockage.');
    }
    return { doc: record.document, flux: this.storage.read(record.document.storageKey) };
  }

  /**
   * Préavis d'alerte sur les pièces à échéance (§ 6.6).
   *
   * Passe par le service de paramétrage plutôt que par une lecture directe :
   * celle-ci rendait NaN sur une valeur non numérique — l'horizon de la
   * surveillance disparaissait alors sans message, et la liste des pièces à
   * renouveler revenait vide comme si tout était en règle.
   */
  private noticeDays(): Promise<number> {
    return this.settings.number('DOC_EXPIRY_ALERT_DAYS', 60);
  }
}

@Controller('api/internal/compliance')
@RequireRealm(Realm.INTERNAL)
export class ComplianceController {
  constructor(private readonly service: ComplianceService) {}

  @Get('overview')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD, UserRole.FINANCE_CFO, UserRole.ASSISTANT_DG)
  @Screen('conformite')
  overview() {
    return this.service.overview();
  }

  @Get('non-compliant')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD, UserRole.FINANCE_CFO)
  nonCompliant() {
    return this.service.nonCompliant();
  }

  @Get('expiry-watch')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD, UserRole.ASSISTANT_DG, UserRole.FINANCE_CFO)
  @Screen('echeancier')
  expiryWatch(@Query() query: ExpiryWatchQuery) {
    return this.service.expiryWatch(query.withinDays, query.blockingOnly === 'true');
  }

  /**
   * Dépôt du scan — AVANT la création de l'enregistrement, voir
   * `ComplianceService.uploadDocument`. Le fichier reste en mémoire, jamais
   * écrit sur un disque temporaire : le conteneur de l'API est en lecture
   * seule (même principe que `FieldAttachmentsController`).
   */
  @Post('documents')
  @Roles(UserRole.LOGISTICS_COORD, UserRole.CCOO, UserRole.ASSISTANT_DG)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PLAFOND_TUYAU } }))
  uploadDocument(
    @UploadedFile() fichier: FichierRecu | undefined,
    @Body('type') complianceType: ComplianceType,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.uploadDocument(fichier, complianceType, req.auth.sub);
  }

  @Post('records')
  @Roles(UserRole.LOGISTICS_COORD, UserRole.CCOO, UserRole.ASSISTANT_DG)
  create(@Body() dto: CreateComplianceDto, @Req() req: { auth: { sub: string } }) {
    return this.service.create(dto, req.auth.sub);
  }

  @Get('records/:id')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD, UserRole.ASSISTANT_DG)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Get('records/:id/document')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD, UserRole.ASSISTANT_DG)
  @Header('Cache-Control', 'private, max-age=3600')
  async downloadDocument(@Param('id', ParseUUIDPipe) id: string) {
    const { doc, flux } = await this.service.downloadDocument(id);
    return new StreamableFile(flux as never, {
      type: doc.mimeType,
      length: Number(doc.sizeBytes),
      disposition: 'inline',
    });
  }
}
