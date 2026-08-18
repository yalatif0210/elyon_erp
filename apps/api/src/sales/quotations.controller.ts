import { BadRequestException, Body, Controller, Get, Injectable, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import {
  ActorType,
  AuditAction,
  CommercialSegment,
  InvoiceStatus,
  InvoiceType,
  QuotationRequestStatus,
  TransportMode,
  UserRole,
} from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { Realm, RequireRealm, Roles, Screen } from '../common/auth/realm';
import { PrismaService } from '../common/prisma/prisma.service';
import { DealsService } from './deals.controller';

/**
 * DEMANDES DE COTATION REÇUES DU PORTAIL (§ 13, module 0) — CÔTÉ COMMERCIAL.
 *
 * ⚠️ SANS CE MODULE, LE CANAL PORTAIL N'A PAS DE SECOND BOUT.
 *
 *    Le portail client écrit dans `quotation_requests`, mais rien côté
 *    interne n'en montrait le contenu jusqu'ici : une demande y arrivait,
 *    un accusé de réception partait, et plus personne ne la revoyait — ni
 *    écran, ni tâche, ni notification. Ce contrôleur ouvre la lecture et le
 *    triage.
 *
 * LA CONVERSION CRÉE RÉELLEMENT L'AFFAIRE (§ discussion 17/08, point 2) - à
 * partir de la demande ET de la proforma approuvée, qui portent déjà tiers,
 * produit, volume, prix et devise. Seuls le mode de transport et le lieu de
 * livraison manquent : rien dans le parcours de cotation ne les capture, ils
 * se saisissent au moment de convertir.
 */

class DeclineQuotationDto {
  @IsString() @MaxLength(500) reason!: string;
}

class ConvertQuotationDto {
  @IsOptional() @IsEnum(CommercialSegment) segment?: CommercialSegment;
  @IsOptional() @IsEnum(TransportMode) transportMode?: TransportMode;
  @IsOptional() @IsUUID() siteId?: string;
  @IsOptional() @IsString() @MaxLength(200) deliveryLocation?: string;
}

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly deals: DealsService,
  ) {}

  list(status?: QuotationRequestStatus) {
    return this.prisma.quotationRequest.findMany({
      where: status ? { status } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        partner: { select: { code: true, legalName: true, segment: true } },
        product: { select: { code: true, name: true, isService: true } },
        submittedByPortalUser: { select: { fullName: true, email: true } },
        convertedDeal: { select: { id: true, reference: true } },
        approvedProforma: { select: { id: true, number: true } },
        proformas: {
          where: { type: InvoiceType.PROFORMA },
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
          },
        },
      },
    });
  }

  async setStatus(id: string, status: QuotationRequestStatus, actorId: string, reason?: string) {
    const existing = await this.prisma.quotationRequest.findUniqueOrThrow({ where: { id } });
    if (existing.status === QuotationRequestStatus.CONVERTED) {
      throw new BadRequestException('Cette demande est déjà convertie en affaire : son statut ne se rouvre pas.');
    }
    if (status === QuotationRequestStatus.CONVERTED) {
      throw new BadRequestException(
        'La conversion se fait en créant l’affaire, pas en changeant ce statut à la main.',
      );
    }

    const updated = await this.prisma.quotationRequest.update({ where: { id }, data: { status } });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'QuotationRequest',
      entityId: id,
      before: { status: existing.status },
      after: { status, reason: reason ?? null },
    });

    return updated;
  }

  /**
   * Convertit une demande APPROUVÉE en affaire.
   *
   * ⚠️ CRÉE RÉELLEMENT L'AFFAIRE (§ discussion 17/08, point 2).
   *
   *    Tiers, produit, volume, prix et devise viennent de la demande et de
   *    la proforma approuvée - « toutes ses informations », rien n'est
   *    ressaisi. Seuls le mode de transport et le lieu de livraison sont
   *    demandés ici : rien dans le parcours de cotation ne les capture.
   *    `DealsService.create()` fait ensuite exactement ce qu'il fait pour
   *    toute affaire - produit service compris, sans le redire ici.
   *
   *    Une fois l'affaire créée : la proforma approuvée en reçoit le
   *    `dealId` sans perdre son `quotationRequestId` (elle garde sa
   *    provenance), et ses sœurs, restées sans objet, s'effacent (brouillon
   *    jamais soumis) ou s'annulent (déjà émise).
   */
  async convert(id: string, dto: ConvertQuotationDto, actorId: string) {
    const quotation = await this.prisma.quotationRequest.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        partnerId: true,
        productId: true,
        approvedProformaId: true,
        partner: { select: { segment: true } },
        product: { select: { isService: true } },
      },
    });
    if (quotation.status !== QuotationRequestStatus.PROFORMA_APPROVED) {
      throw new BadRequestException(
        `Cette demande n'a pas de proforma approuvée par le client (statut : ${quotation.status}) : la conversion n'est pas encore possible.`,
      );
    }
    // `approvedProformaId` ne peut être NULL ici : la seule route qui pose
    // PROFORMA_APPROVED (`approveProforma`, côté portail) le pose dans la
    // MÊME transaction. Un statut sans proforma associée serait une
    // incohérence de données, pas un cas métier à prévoir.
    const approvedProformaId = quotation.approvedProformaId!;
    const proforma = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: approvedProformaId },
      select: { billedVolume: true, uom: true, unitPrice: true, currencyCode: true },
    });

    const segment = dto.segment ?? quotation.partner.segment;
    if (!segment) {
      throw new BadRequestException(
        'Ce tiers ne porte aucun segment commercial par défaut : indiquez-en un pour convertir.',
      );
    }
    if (!quotation.product.isService && (!dto.transportMode || !dto.deliveryLocation)) {
      throw new BadRequestException(
        'Mode de transport et lieu de livraison sont requis pour convertir : ce produit physique doit être livré quelque part.',
      );
    }

    const deal = await this.deals.create(
      {
        clientId: quotation.partnerId,
        productId: quotation.productId,
        segment,
        contractedVolume: quotation.product.isService ? undefined : Number(proforma.billedVolume),
        uom: quotation.product.isService ? undefined : proforma.uom,
        transportMode: quotation.product.isService ? undefined : dto.transportMode,
        siteId: dto.siteId,
        deliveryLocation: quotation.product.isService ? 'Exploitation' : dto.deliveryLocation!,
        currencyCode: proforma.currencyCode,
        unitSalePrice: Number(proforma.unitPrice),
      },
      actorId,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      // La proforma approuvée gagne l'affaire sans perdre sa provenance.
      await tx.invoice.update({ where: { id: approvedProformaId }, data: { dealId: deal.id } });

      // Les sœurs n'ont plus d'objet : un brouillon jamais soumis au client
      // s'efface, une proforma déjà émise s'annule - la trace reste.
      await tx.invoice.deleteMany({
        where: { quotationRequestId: id, id: { not: approvedProformaId }, status: InvoiceStatus.DRAFT },
      });
      await tx.invoice.updateMany({
        where: {
          quotationRequestId: id,
          id: { not: approvedProformaId },
          status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
        },
        data: {
          status: InvoiceStatus.CANCELLED,
          cancelledById: actorId,
          cancelledAt: new Date(),
          cancellationReason: 'Demande de cotation convertie via une autre proforma.',
        },
      });

      return tx.quotationRequest.update({
        where: { id },
        data: { status: QuotationRequestStatus.CONVERTED, convertedDealId: deal.id },
      });
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'QuotationRequest',
      entityId: id,
      before: { status: quotation.status },
      after: { status: QuotationRequestStatus.CONVERTED, convertedDealId: deal.id },
    });

    return { ...updated, deal };
  }
}

@Controller('api/internal/quotations')
@RequireRealm(Realm.INTERNAL)
export class QuotationsController {
  constructor(private readonly service: QuotationsService) {}

  @Get()
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP, UserRole.ASSISTANT_DG)
  @Screen('demandes-de-cotation')
  list(@Query('status') status?: QuotationRequestStatus) {
    return this.service.list(status);
  }

  @Patch(':id/en-etude')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP)
  marquerEnEtude(@Param('id', ParseUUIDPipe) id: string, @Req() req: { auth: { sub: string } }) {
    return this.service.setStatus(id, QuotationRequestStatus.IN_REVIEW, req.auth.sub);
  }

  @Patch(':id/decliner')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP)
  decliner(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineQuotationDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.setStatus(id, QuotationRequestStatus.DECLINED, req.auth.sub, dto.reason);
  }

  @Patch(':id/convertir')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP)
  convertir(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertQuotationDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.convert(id, dto, req.auth.sub);
  }
}
