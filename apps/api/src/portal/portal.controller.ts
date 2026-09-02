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
} from '@nestjs/common';
import {
  ActorType,
  AuditAction,
  DealStatus,
  InvoiceStatus,
  InvoiceType,
  QuotationRequestStatus,
  UnitOfMeasure,
} from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { Realm, RequireRealm } from '../common/auth/realm';
import { Page, PaginationQuery, paginate } from '../common/http/pagination.dto';
import { PrismaService } from '../common/prisma/prisma.service';
import { DocumentsService } from '../documents/documents.controller';
import { PortalScopeService } from './portal-scope.service';

/**
 * PORTAIL CLIENT (§ 13, module 0).
 *
 * ⚠️ LE CLOISONNEMENT PASSE PAR LE `WHERE`, PAS PAR UN FILTRE A POSTERIORI.
 *
 *    Chaque requête est scopée par le `partnerId` du jeton (§ 1.3 : « ses
 *    propres données, filtrées par partner_id du JWT »). Un client ne voit
 *    jamais un ID qui n'est pas le sien — il obtient un 404, jamais un 403
 *    qui confirmerait que l'objet existe.
 *
 *    La construction de ce `where` passe désormais par `PortalScopeService`
 *    (ticket #3) plutôt que d'être répétée à la main ici — voir son
 *    commentaire d'en-tête pour la raison.
 *
 *    Chaque `select` énumère ce qui SORT, jamais ce qu'on retire : marge,
 *    prix d'achat, coûts, encours crédit et fournisseur n'apparaissent dans
 *    AUCUNE requête ci-dessous, par construction du typage (§ 1.3), pas par
 *    un masquage après lecture.
 *
 * ⚠️ AUCUNE APPLICATION FRONTALE DÉDIÉE.
 *
 *    SPECIFICATIONS.md § 1.1 prévoit une « application séparée » (Angular
 *    SSR) pour ce périmètre. Ce fichier construit l'API qu'une telle
 *    application consommerait ; il ne la remplace pas.
 */

class CreateQuotationRequestDto {
  @IsUUID() productId!: string;
  @Type(() => Number) @IsNumber() @Min(0.000001) desiredVolume!: number;
  @IsEnum(UnitOfMeasure) uom!: UnitOfMeasure;
  @IsOptional() @IsISO8601() desiredDeliveryDate?: string;
  @IsOptional() @IsString() @MaxLength(2000) message?: string;
}

class PortalListQuery extends PaginationQuery {}

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly scope: PortalScopeService,
  ) {}

  // --- Catalogue (pour renseigner la demande de cotation) ----------------

  /** Liste MINIMALE : code, nom, unité par défaut — rien de tarifaire. */
  products() {
    return this.prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, defaultUom: true },
    });
  }

  // --- Demandes de cotation --------------------------------------------

  async createQuotation(dto: CreateQuotationRequestDto, partnerId: string, portalUserId: string) {
    const created = await this.prisma.quotationRequest.create({
      data: {
        partnerId,
        submittedByPortalUserId: portalUserId,
        productId: dto.productId,
        desiredVolume: dto.desiredVolume.toFixed(6),
        uom: dto.uom,
        desiredDeliveryDate: dto.desiredDeliveryDate ? new Date(dto.desiredDeliveryDate) : null,
        message: dto.message ?? null,
      },
    });

    await this.audit.record({
      actorType: ActorType.PORTAL_USER,
      actorId: portalUserId,
      action: AuditAction.CREATE,
      entityType: 'QuotationRequest',
      entityId: created.id,
      after: created,
    });

    return created;
  }

  listQuotations(partnerId: string) {
    return this.prisma.quotationRequest.findMany({
      where: this.scope.wherePartner(partnerId),
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { code: true, name: true } },
        // Le brouillon jamais soumis reste invisible au client - il n'a rien
        // à approuver tant que personne ne le lui a envoyé.
        proformas: {
          where: { type: InvoiceType.PROFORMA, status: { not: InvoiceStatus.DRAFT } },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            number: true,
            status: true,
            billedVolume: true,
            uom: true,
            unitPrice: true,
            currencyCode: true,
            acceptedAt: true,
            // Le PDF est mis en file dès l'émission (§ discussion 17/08) -
            // scellé, donc au même format que tout document produit par
            // l'ERP. `isSealed` filtre l'éventuel brouillon jamais retenu
            // d'une régénération manuelle.
            generatedDocuments: {
              where: { isSealed: true },
              orderBy: { generatedAt: 'desc' },
              take: 1,
              select: { id: true, reference: true },
            },
          },
        },
      },
    });
  }

  /**
   * Approbation d'une proforma par le CLIENT (§ discussion 17/08).
   *
   * ⚠️ LE CLOISONNEMENT PASSE PAR LE `WHERE`, DEUX FOIS.
   *
   *    La demande ET la pièce sont relues sous le `partnerId` du jeton avant
   *    toute écriture — jamais un contrôle a posteriori sur un objet déjà lu
   *    par son seul UUID (§ commentaire d'en-tête de ce fichier).
   */
  async approveProforma(partnerId: string, quotationId: string, invoiceId: string, portalUserId: string) {
    const quotation = await this.scope.assertQuotation(quotationId, partnerId);
    if (
      quotation.status === QuotationRequestStatus.CONVERTED ||
      quotation.status === QuotationRequestStatus.DECLINED
    ) {
      throw new BadRequestException(`Cette demande est close (statut : ${quotation.status}).`);
    }

    await this.scope.assertProformaInvoice(invoiceId, quotationId, partnerId);

    const now = new Date();
    const [updatedInvoice] = await this.prisma.$transaction([
      this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { acceptedByPortalUserId: portalUserId, acceptedAt: now },
      }),
      this.prisma.quotationRequest.update({
        where: { id: quotationId },
        data: { status: QuotationRequestStatus.PROFORMA_APPROVED, approvedProformaId: invoiceId },
      }),
    ]);

    await this.audit.record({
      actorType: ActorType.PORTAL_USER,
      actorId: portalUserId,
      action: AuditAction.APPROVE,
      entityType: 'Invoice',
      entityId: invoiceId,
      after: { acceptedAt: now, quotationId },
    });

    return updatedInvoice;
  }

  // --- Affaires — tableau de bord des offres ----------------------------

  async listDeals(partnerId: string, query: PortalListQuery): Promise<Page<unknown>> {
    const where = this.scope.whereDeal(partnerId);
    const [items, total] = await Promise.all([
      this.prisma.deal.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          reference: true,
          status: true,
          contractedVolume: true,
          uom: true,
          incoterm: true,
          transportMode: true,
          currencyCode: true,
          acceptedAt: true,
          createdAt: true,
          product: { select: { code: true, name: true } },
        },
      }),
      this.prisma.deal.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async dealDetail(partnerId: string, id: string) {
    const deal = await this.prisma.deal.findFirst({
      where: { id, ...this.scope.whereDeal(partnerId) },
      select: {
        id: true,
        reference: true,
        status: true,
        contractedVolume: true,
        uom: true,
        incoterm: true,
        transportMode: true,
        currencyCode: true,
        acceptedAt: true,
        createdAt: true,
        product: { select: { code: true, name: true } },
        operations: {
          select: { id: true, reference: true, phase: true, plannedVolume: true, uom: true, createdAt: true },
        },
      },
    });
    if (!deal) throw new NotFoundException(this.scope.introuvable);
    return deal;
  }

  /**
   * Acceptation de proforma (§ 13). Seule transition que le portail
   * déclenche — toutes les autres restent au commercial.
   */
  async acceptDeal(partnerId: string, id: string, portalUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const deal = await tx.deal.findFirst({
        where: { id, ...this.scope.whereDeal(partnerId) },
        select: { status: true, acceptedByPortalUserId: true },
      });
      if (!deal) throw new NotFoundException(this.scope.introuvable);
      if (deal.acceptedByPortalUserId) {
        throw new BadRequestException('Cette affaire a déjà été acceptée.');
      }
      if (deal.status !== DealStatus.PROFORMA_SENT) {
        throw new BadRequestException(
          'Cette affaire n’est pas au stade « proforma envoyée » : rien à accepter pour le moment.',
        );
      }

      const updated = await tx.deal.update({
        where: { id },
        data: {
          status: DealStatus.CUSTOMER_ACCEPTED,
          acceptedByPortalUserId: portalUserId,
          acceptedAt: new Date(),
        },
      });

      await tx.dealStatusTransition.create({
        data: {
          dealId: id,
          fromStatus: DealStatus.PROFORMA_SENT,
          toStatus: DealStatus.CUSTOMER_ACCEPTED,
          actorType: ActorType.PORTAL_USER,
          reason: 'Acceptation de la proforma depuis le portail client.',
        },
      });

      await this.audit.record({
        actorType: ActorType.PORTAL_USER,
        actorId: portalUserId,
        action: AuditAction.STATUS_CHANGE,
        entityType: 'Deal',
        entityId: id,
        before: { status: deal.status },
        after: { status: DealStatus.CUSTOMER_ACCEPTED },
      });

      return updated;
    });
  }

  // --- Suivi des livraisons ----------------------------------------------

  async listOperations(partnerId: string, query: PortalListQuery): Promise<Page<unknown>> {
    const where = this.scope.whereOperationByDeal(partnerId);
    const [items, total] = await Promise.all([
      this.prisma.operation.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          reference: true,
          phase: true,
          plannedVolume: true,
          uom: true,
          transportMode: true,
          destinationLocation: true,
          createdAt: true,
          deal: { select: { reference: true } },
        },
      }),
      this.prisma.operation.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  // --- Relevés et factures ------------------------------------------------

  async listInvoices(partnerId: string, query: PortalListQuery): Promise<Page<unknown>> {
    // ⚠️ UN BROUILLON RESTAIT VISIBLE AU CLIENT.
    //
    //    Le `where` ne filtrait que le TYPE (pas d'avoir), jamais le STATUT :
    //    une pièce encore en édition interne - numéro non définitif, montants
    //    susceptibles de changer, aucun PDF scellé - apparaissait telle quelle
    //    sur le portail. Un DRAFT n'engage rien tant qu'il n'est pas ÉMIS
    //    (`issue()`) : c'est cette frontière, pas la création, qui rend une
    //    pièce opposable et donc montrable à un tiers.
    const where = {
      ...this.scope.wherePartner(partnerId),
      type: { not: InvoiceType.CREDIT_NOTE },
      status: { not: InvoiceStatus.DRAFT },
    };
    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          number: true,
          type: true,
          status: true,
          billedVolume: true,
          uom: true,
          totalAmount: true,
          paidAmount: true,
          currencyCode: true,
          issueDate: true,
          dueDate: true,
          deal: { select: { reference: true } },
          generatedDocuments: {
            where: { isSealed: true },
            select: { id: true, reference: true, kind: true },
            take: 1,
            orderBy: { generatedAt: 'desc' },
          },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  /**
   * Binaire d'une pièce rattachée à UNE FACTURE DE CE TIERS.
   *
   * Le cloisonnement passe par le `where` transmis au service de documents —
   * `invoice: { partnerId }` — jamais par un contrôle a posteriori sur l'objet
   * une fois lu (§ commentaire d'en-tête de ce fichier).
   */
  downloadInvoiceDocument(partnerId: string, documentId: string) {
    return this.documents.download(documentId, this.scope.whereInvoiceDocument(partnerId));
  }
}

// ===========================================================================
//  Contrôleur
// ===========================================================================

@Controller('api/portal')
@RequireRealm(Realm.PORTAL)
export class PortalController {
  constructor(
    private readonly service: PortalService,
    private readonly scope: PortalScopeService,
  ) {}

  @Get('products')
  products() {
    return this.service.products();
  }

  @Post('quotations')
  createQuotation(@Body() dto: CreateQuotationRequestDto, @Req() req: { auth: { sub: string; partnerId?: string } }) {
    return this.service.createQuotation(dto, this.scope.partnerId(req), req.auth.sub);
  }

  @Get('quotations')
  listQuotations(@Req() req: { auth: { partnerId?: string } }) {
    return this.service.listQuotations(this.scope.partnerId(req));
  }

  @Patch('quotations/:id/proformas/:invoiceId/approuver')
  approveProforma(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Req() req: { auth: { sub: string; partnerId?: string } },
  ) {
    return this.service.approveProforma(this.scope.partnerId(req), id, invoiceId, req.auth.sub);
  }

  @Get('deals')
  listDeals(@Query() query: PortalListQuery, @Req() req: { auth: { partnerId?: string } }) {
    return this.service.listDeals(this.scope.partnerId(req), query);
  }

  @Get('deals/:id')
  dealDetail(@Param('id', ParseUUIDPipe) id: string, @Req() req: { auth: { partnerId?: string } }) {
    return this.service.dealDetail(this.scope.partnerId(req), id);
  }

  @Patch('deals/:id/accept')
  acceptDeal(@Param('id', ParseUUIDPipe) id: string, @Req() req: { auth: { sub: string; partnerId?: string } }) {
    return this.service.acceptDeal(this.scope.partnerId(req), id, req.auth.sub);
  }

  @Get('operations')
  listOperations(@Query() query: PortalListQuery, @Req() req: { auth: { partnerId?: string } }) {
    return this.service.listOperations(this.scope.partnerId(req), query);
  }

  @Get('invoices')
  listInvoices(@Query() query: PortalListQuery, @Req() req: { auth: { partnerId?: string } }) {
    return this.service.listInvoices(this.scope.partnerId(req), query);
  }

  @Get('documents/:id/download')
  @Header('Cache-Control', 'private, max-age=3600')
  async downloadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { auth: { partnerId?: string } },
  ) {
    const { doc, flux } = await this.service.downloadInvoiceDocument(this.scope.partnerId(req), id);
    return new StreamableFile(flux as never, {
      type: doc.mimeType,
      length: Number(doc.sizeBytes),
      disposition: `attachment; filename="${doc.reference}.pdf"`,
    });
  }
}

