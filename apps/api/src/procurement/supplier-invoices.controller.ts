import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ActorType, AuditAction, SupplierInvoiceStatus, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { Realm, RequireRealm, Roles, Screen } from '../common/auth/realm';
import { Page, PaginationQuery, paginate } from '../common/http/pagination.dto';
import { PrismaService } from '../common/prisma/prisma.service';
import { round4 } from '../common/money/money';

// ===========================================================================
//  DTO
// ===========================================================================

class RecordSupplierInvoiceDto {
  /** Référence portée par le document du fournisseur, telle quelle. */
  @IsString() @MaxLength(64) reference!: string;
  @IsUUID() supplierId!: string;

  /**
   * Rattachement au dossier d'affaire. Facultatif, mais c'est lui qui rend le
   * rapprochement possible : une facture de fret ou d'inspection sans deal ne
   * pourra jamais être confrontée au coût enregistré (§ 14.6).
   */
  @IsOptional() @IsUUID() dealId?: string;
  @IsOptional() @IsUUID() purchaseOrderId?: string;

  @Type(() => Number) @IsNumber() @Min(0) amount!: number;
  @IsString() @Length(3, 3) currencyCode!: string;

  /** TVA déductible — extraite du montant, jamais ajoutée. */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) vatRatePct?: number;

  @IsISO8601() invoiceDate!: string;
  @IsOptional() @IsISO8601() dueDate?: string;
  @IsOptional() @IsEnum(SupplierInvoiceStatus) status?: SupplierInvoiceStatus;
}

class PrepaymentDto {
  /** Montant réglé AVANT réception de la marchandise. */
  @Type(() => Number) @IsNumber() @Min(0.0001) amount!: number;
  @IsISO8601() paidAt!: string;
  @IsOptional() @IsString() @MaxLength(120) bankReference?: string;
}

class SettlementDto {
  /** Date à laquelle la contrepartie a été constatée. */
  @IsISO8601() settledAt!: string;
  /**
   * L'apurement manuel est une EXCEPTION : la voie normale est automatique,
   * déclenchée par le chargement ou la clôture de l'opération. Y recourir
   * signifie qu'aucun de ces deux faits ne surviendra — facture rattachée à
   * aucun dossier, opération annulée, régularisation. Le motif est donc exigé.
   */
  @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
}

class SupplierInvoiceQuery extends PaginationQuery {
  @IsOptional() @IsEnum(SupplierInvoiceStatus) status?: SupplierInvoiceStatus;
  @IsOptional() @IsUUID() dealId?: string;
  @IsOptional() @IsUUID() supplierId?: string;
}

// ===========================================================================
//  Service
// ===========================================================================

/**
 * Registre des factures fournisseurs et des prépaiements (§ 14.6).
 *
 * Ce module sert deux besoins distincts, souvent confondus :
 *
 *   1. LE RAPPROCHEMENT. Confronter le coût enregistré sur une affaire à
 *      l'argent réellement sorti. C'est le contrôle anti-détournement le plus
 *      solide, parce qu'il ne repose sur aucune déclaration : une charge qui
 *      n'a pas de facture derrière, ou une facture sans charge, se voit.
 *
 *   2. LA TRÉSORERIE IMMOBILISÉE. Elyon paie ses fournisseurs AVANT livraison.
 *      Le terme « dettes fournisseurs » du BFR est donc proche de zéro ; ce
 *      sont les AVANCES qui pèsent à l'actif — argent sorti, marchandise non
 *      encore reçue. C'est ce poste qu'il faut voir en permanence.
 */
@Injectable()
export class SupplierInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: SupplierInvoiceQuery): Promise<Page<unknown>> {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.dealId ? { dealId: query.dealId } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.search
        ? { reference: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.supplierInvoice.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { invoiceDate: 'desc' },
        include: {
          supplier: { select: { code: true, legalName: true, supplierTermsDays: true } },
          deal: { select: { id: true, reference: true, client: { select: { legalName: true } } } },
          recordedBy: { select: { fullName: true } },
        },
      }),
      this.prisma.supplierInvoice.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  findOne(id: string) {
    return this.prisma.supplierInvoice.findUniqueOrThrow({
      where: { id },
      include: {
        supplier: { select: { code: true, legalName: true, supplierTermsDays: true } },
        deal: { select: { id: true, reference: true, client: { select: { legalName: true } } } },
        purchaseOrder: { select: { reference: true } },
        payments: { orderBy: { valueDate: 'desc' } },
        costLines: {
          include: { costPost: { select: { code: true, label: true, nature: true } } },
        },
        recordedBy: { select: { fullName: true, role: true } },
      },
    });
  }

  /**
   * Enregistrement d'une facture fournisseur.
   *
   * La TVA déductible est EXTRAITE du montant par la même formule que la TVA
   * collectée sur les ventes : `montant × taux ÷ (100 + taux)`. Les deux
   * pendants doivent obéir à la même règle, sinon la déclaration ne tombe pas.
   */
  async record(dto: RecordSupplierInvoiceDto, actorId: string) {
    const rate = dto.vatRatePct ?? 0;
    const vatAmount = rate > 0 ? round4((dto.amount * rate) / (100 + rate)) : 0;
    const toPivot = await this.rateToPivot(dto.currencyCode);

    const created = await this.prisma.supplierInvoice.create({
      data: {
        reference: dto.reference,
        supplierId: dto.supplierId,
        dealId: dto.dealId ?? null,
        purchaseOrderId: dto.purchaseOrderId ?? null,
        status: dto.status ?? SupplierInvoiceStatus.RECEIVED,
        amount: dto.amount.toFixed(4),
        currencyCode: dto.currencyCode,
        fxRateToPivot: toPivot.toFixed(8),
        amountPivot: round4(dto.amount * toPivot).toFixed(4),
        vatRatePct: rate.toFixed(3),
        vatAmount: vatAmount.toFixed(4),
        invoiceDate: new Date(dto.invoiceDate),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        recordedById: actorId,
      },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'SupplierInvoice',
      entityId: created.id,
      after: created,
    });

    return created;
  }

  /**
   * Prépaiement — argent sorti avant réception.
   *
   * Le montant reste au BFR tant qu'il n'est pas apuré par la livraison. On
   * enregistre donc DEUX choses distinctes : le règlement lui-même, et le
   * fait qu'il précède la contrepartie physique.
   */
  async prepay(id: string, dto: PrepaymentDto, actorId: string) {
    const invoice = await this.prisma.supplierInvoice.findUniqueOrThrow({
      where: { id },
      select: {
        supplierId: true,
        amount: true,
        paidAmount: true,
        prepaidAmount: true,
        currencyCode: true,
        settledAt: true,
        recordedById: true,
      },
    });

    // ⚠️ CORRIGÉ (audit, axe C, S1) — séparation des tâches. Celui qui a saisi
    // la facture fournisseur ne peut pas être celui qui en déclenche le
    // règlement : sans ce garde-fou, une pièce fictive et son paiement
    // pouvaient sortir de la même main, sans second regard.
    if (invoice.recordedById === actorId) {
      throw new ForbiddenException(
        'Séparation des tâches : la personne qui a saisi cette facture fournisseur ne peut pas en enregistrer le règlement. Un autre compte doit le faire.',
      );
    }

    const paid = round4(Number(invoice.paidAmount) + dto.amount);
    if (paid > Number(invoice.amount) + 0.01) {
      throw new BadRequestException(
        `Règlement de ${dto.amount} supérieur au solde dû (${round4(Number(invoice.amount) - Number(invoice.paidAmount))}).`,
      );
    }

    const toPivot = await this.rateToPivot(invoice.currencyCode);
    const prepaid = round4(Number(invoice.prepaidAmount) + dto.amount);

    const [payment] = await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          direction: 'OUTBOUND',
          partnerId: invoice.supplierId,
          supplierInvoiceId: id,
          amount: dto.amount.toFixed(4),
          currencyCode: invoice.currencyCode,
          fxRateToPivot: toPivot.toFixed(8),
          amountPivot: round4(dto.amount * toPivot).toFixed(4),
          valueDate: new Date(dto.paidAt),
          bankReference: dto.bankReference ?? null,
          recordedById: actorId,
        },
      }),
      this.prisma.supplierInvoice.update({
        where: { id },
        data: {
          paidAmount: paid.toFixed(4),
          paidAmountPivot: round4(paid * toPivot).toFixed(4),
          // Tant que la marchandise n'est pas reçue, le règlement est une AVANCE.
          ...(invoice.settledAt
            ? {}
            : {
                prepaidAmount: prepaid.toFixed(4),
                prepaidAmountPivot: round4(prepaid * toPivot).toFixed(4),
                prepaidAt: new Date(dto.paidAt),
              }),
          ...(paid >= Number(invoice.amount) - 0.01
            ? { status: SupplierInvoiceStatus.PAID }
            : {}),
        },
      }),
    ]);

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'SupplierPayment',
      entityId: payment.id,
      after: { supplierInvoiceId: id, amount: dto.amount, prepaid: !invoice.settledAt },
    });

    return payment;
  }

  /**
   * Apurement MANUEL — voie d'exception.
   *
   * La voie normale est automatique : un trigger apure l'avance au chargement
   * constaté de l'opération, au prorata du volume enlevé, ou à la clôture
   * pour les prestations sans marchandise (§ 14.6). Tant que l'apurement est
   * un acte déclaratif, l'indicateur de trésorerie immobilisée peut être remis
   * à zéro sans qu'un litre soit arrivé — et il ne mesure alors plus rien.
   *
   * Reste nécessaire quand aucun de ces deux faits ne surviendra : facture
   * rattachée à aucun dossier, opération annulée, régularisation comptable.
   * D'où le motif obligatoire et la trace au journal.
   */
  async settle(id: string, dto: SettlementDto, actorId: string) {
    const invoice = await this.prisma.supplierInvoice.findUniqueOrThrow({
      where: { id },
      select: {
        prepaidAmount: true,
        settledAmount: true,
        settledAt: true,
        purchaseOrder: { select: { operation: { select: { reference: true, status: true } } } },
      },
    });
    if (invoice.settledAt) {
      throw new BadRequestException('Cette avance est déjà intégralement apurée.');
    }
    if (Number(invoice.prepaidAmount) <= 0) {
      throw new BadRequestException(
        'Aucune avance à apurer sur cette facture : rien n’a été réglé avant réception.',
      );
    }

    const updated = await this.prisma.supplierInvoice.update({
      where: { id },
      data: {
        settledAmount: invoice.prepaidAmount,
        settledAt: new Date(dto.settledAt),
      },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.OVERRIDE,
      entityType: 'SupplierInvoice',
      entityId: id,
      before: { settledAmount: invoice.settledAmount },
      after: {
        settledAt: dto.settledAt,
        settledAmount: invoice.prepaidAmount,
        reason: dto.reason,
        manuel: true,
        operation: invoice.purchaseOrder?.operation?.reference ?? null,
      },
    });

    return updated;
  }

  /** Rattachement d'une ligne de coût à la facture qui la justifie (§ 14.6). */
  async attachCostLine(id: string, costLineId: string, actorId: string) {
    const updated = await this.prisma.operationCostLine.update({
      where: { id: costLineId },
      data: { supplierInvoiceId: id },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.UPDATE,
      entityType: 'OperationCostLine',
      entityId: costLineId,
      after: { supplierInvoiceId: id },
    });

    return updated;
  }

  /** Taux vers la devise pivot, à la date du jour. */
  private async rateToPivot(currencyCode: string): Promise<number> {
    const pivot = await this.prisma.currency.findFirstOrThrow({ where: { isPivot: true } });
    if (pivot.code === currencyCode) return 1;

    const today = new Date();
    const window = {
      effectiveFrom: { lte: today },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
    };

    const direct = await this.prisma.fxRate.findFirst({
      where: { baseCurrencyCode: currencyCode, quoteCurrencyCode: pivot.code, ...window },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (direct) return Number(direct.rate);

    // Le sens inverse est accepté et inversé : une paire USD/XOF sert les deux
    // conversions. Exiger une ligne par sens ferait diverger deux cours.
    const inverse = await this.prisma.fxRate.findFirst({
      where: { baseCurrencyCode: pivot.code, quoteCurrencyCode: currencyCode, ...window },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (inverse) return 1 / Number(inverse.rate);

    throw new BadRequestException(
      `Aucun taux de change en vigueur pour ${currencyCode} → ${pivot.code}. La facture ne peut pas être valorisée au pivot.`,
    );
  }
}

// ===========================================================================
//  Contrôleur
// ===========================================================================

@Controller('api/internal/supplier-invoices')
@RequireRealm(Realm.INTERNAL)
export class SupplierInvoicesController {
  constructor(private readonly service: SupplierInvoicesService) {}

  @Get()
  @Roles(
    UserRole.DG,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.CCOO,
    UserRole.LOGISTICS_COORD,
  )
  @Screen('achats')
  list(@Query() query: SupplierInvoiceQuery) {
    return this.service.list(query);
  }

  @Get(':id')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT, UserRole.CCOO)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles(UserRole.FINANCE_CFO, UserRole.ACCOUNTANT, UserRole.LOGISTICS_COORD)
  record(@Body() dto: RecordSupplierInvoiceDto, @Req() req: { auth: { sub: string } }) {
    return this.service.record(dto, req.auth.sub);
  }

  /** Règlement — qualifié d'avance tant que la marchandise n'est pas reçue. */
  @Post(':id/payments')
  @Roles(UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
  prepay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrepaymentDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.prepay(id, dto, req.auth.sub);
  }

  /** Apurement de l'avance à la réception de la marchandise. */
  @Patch(':id/settle')
  @Roles(UserRole.FINANCE_CFO, UserRole.ACCOUNTANT, UserRole.LOGISTICS_COORD)
  settle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SettlementDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.settle(id, dto, req.auth.sub);
  }

  @Patch(':id/cost-lines/:costLineId')
  @Roles(UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
  attach(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('costLineId', ParseUUIDPipe) costLineId: string,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.attachCostLine(id, costLineId, req.auth.sub);
  }
}
