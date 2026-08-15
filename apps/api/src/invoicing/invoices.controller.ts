import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Logger,
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
  DiscountMode,
  FneStatus,
  InvoicePaymentMethod,
  InvoiceStatus,
  InvoiceType,
  TaxRegime,
  UnitOfMeasure,
  UserRole,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { Type } from 'class-transformer';
import {
  IsBoolean,
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
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AuditService } from '../common/audit/audit.service';
import { Realm, RequireRealm, Roles } from '../common/auth/realm';
import { Page, PaginationQuery, paginate } from '../common/http/pagination.dto';
import { SettingsService } from '../common/config/settings.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ReferenceService } from '../common/reference/reference.service';
import { computeDiscount } from '../sales/deals.controller';
import { extractVat, round4, roundTo } from '../common/money/money';
import { FneClientService } from './fne-client.service';
import type { InvoicePdfJob } from '../documents/pdf.processor';

// ===========================================================================
//  DTO
// ===========================================================================

class CreateInvoiceDto {
  @IsUUID() dealId!: string;
  @IsEnum(InvoiceType) type!: InvoiceType;

  /**
   * Volume et prix sont SAISIS à l'édition et peuvent évoluer d'une proforma
   * à la facture définitive (§ 9). Le relevé de mesure ne les détermine pas.
   */
  @Type(() => Number) @IsNumber() @Min(0.000001) billedVolume!: number;
  @IsEnum(UnitOfMeasure) uom!: UnitOfMeasure;
  /** Prix de vente unitaire, TOUTES TAXES COMPRISES. */
  @Type(() => Number) @IsNumber() @Min(0) unitPrice!: number;

  @IsString() @Length(3, 3) currencyCode!: string;

  @IsOptional() @IsEnum(DiscountMode) discountMode?: DiscountMode;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discountValue?: number;

  /** DÉCLENCHEUR de la TVA — une case propre à la pièce, cochée à l'édition. */
  @IsOptional() @IsBoolean() isVatApplicable?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) vatRatePct?: number;

  /** MENTION IMPRIMÉE en entête. Sans effet sur les montants. */
  @IsOptional() @IsEnum(TaxRegime) printedTaxRegime?: TaxRegime;
  @IsOptional() @IsString() @MaxLength(120) vatExemptionReference?: string;

  /** Devise d'impression, au choix de l'éditeur (§ 9.2). */
  @IsOptional() @IsString() @Length(3, 3) documentCurrencyCode?: string;

  /** Requis par la DGI sur toute FNE transmise (§ 9.5). Sans effet sur les
   *  autres types de pièce. */
  @IsOptional() @IsEnum(InvoicePaymentMethod) paymentMethod?: InvoicePaymentMethod;

  /** Proforma d'origine, lorsque la pièce en est issue. */
  @IsOptional() @IsUUID() sourceProformaId?: string;
  /** Pièce corrigée — obligatoire pour un avoir. */
  @IsOptional() @IsUUID() correctedInvoiceId?: string;

  /** Décision INTERNE de recourir à la facture simple (§ 9.3). */
  @IsOptional() @IsString() @MinLength(10) @MaxLength(1000) simpleInvoiceReason?: string;
}

class IssueInvoiceDto {
  @IsOptional() @IsISO8601() issueDate?: string;
  /** À défaut, calculée depuis les conditions de paiement du client. */
  @IsOptional() @IsISO8601() dueDate?: string;
}

class CancelInvoiceDto {
  @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
}

class PaymentDto {
  @Type(() => Number) @IsNumber() @Min(0.0001) amount!: number;
  @IsString() @Length(3, 3) currencyCode!: string;
  @IsISO8601() valueDate!: string;
  @IsOptional() @IsString() @MaxLength(120) bankReference?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

class InvoiceQuery extends PaginationQuery {
  @IsOptional() @IsEnum(InvoiceType) type?: InvoiceType;
  @IsOptional() @IsEnum(InvoiceStatus) status?: InvoiceStatus;
  @IsOptional() @IsUUID() dealId?: string;
  @IsOptional() @IsUUID() partnerId?: string;
}

// ===========================================================================
//  Service
// ===========================================================================

/** Préfixe de numérotation par nature de pièce — séquences distinctes. */
const NUMBER_SCOPE: Record<InvoiceType, string> = {
  PROFORMA: 'PRO',
  SIMPLE: 'FAC',
  FNE: 'FNE',
  CREDIT_NOTE: 'AV',
};

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reference: ReferenceService,
    private readonly settings: SettingsService,
    private readonly fneClient: FneClientService,
    @InjectQueue('documents') private readonly documentsQueue: Queue<InvoicePdfJob>,
  ) {}

  /**
   * Met en file la génération du PDF — jamais rendue en ligne (§ 1.1) : voir
   * l'en-tête de `DocumentsPdfProcessor`. Une pièce au brouillon n'a ni date
   * d'émission ni échéance définitives ; son PDF attendrait l'émission.
   */
  async queuePdf(id: string, actorId: string): Promise<{ jobId: string }> {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id },
      select: { status: true, number: true },
    });
    if (invoice.status === InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        `${invoice.number} est au brouillon : émettre la pièce avant de générer son PDF.`,
      );
    }

    const job = await this.documentsQueue.add(
      'invoice',
      { type: 'invoice', invoiceId: id, actorId },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );
    return { jobId: job.id! };
  }

  async list(query: InvoiceQuery): Promise<Page<unknown>> {
    const where = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.dealId ? { dealId: query.dealId } : {}),
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      ...(query.search
        ? { number: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          partner: { select: { code: true, legalName: true } },
          deal: { select: { id: true, reference: true } },
          fneTransmission: { select: { status: true, fiscalReference: true } },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  findOne(id: string) {
    return this.prisma.invoice.findUniqueOrThrow({
      where: { id },
      include: {
        deal: {
          select: {
            reference: true,
            segment: true,
            product: { select: { code: true, name: true } },
          },
        },
        partner: {
          select: {
            code: true,
            legalName: true,
            taxpayerAccountNumber: true,
            paymentTermsDays: true,
            isVatExempt: true,
          },
        },
        currency: true,
        documentCurrency: true,
        sourceProforma: { select: { id: true, number: true } },
        correctedInvoice: { select: { id: true, number: true } },
        creditNotes: { select: { id: true, number: true, totalAmount: true } },
        fneTransmission: true,
        payments: { orderBy: { valueDate: 'desc' } },
        issuedBy: { select: { fullName: true, role: true } },
        simpleInvoiceDecidedBy: { select: { fullName: true, role: true } },
      },
    });
  }

  /**
   * Édition d'une pièce.
   *
   * La chaîne de montants est ici — et seulement ici :
   *
   *     brut  = volume × prix TTC
   *     TOTAL = brut − réduction          ← ce que doit le client
   *     TVA   = TOTAL × taux ÷ (100 + taux)   si applicable
   *
   * La TVA est EXTRAITE du total, jamais ajoutée : elle y est comprise et ne
   * figure sur la pièce qu'à titre d'information — « dont TVA … ». La base
   * revérifie chaque égalité par CHECK : un arrondi divergent est refusé.
   */
  async create(dto: CreateInvoiceDto, actorId: string) {
    if (dto.type === InvoiceType.CREDIT_NOTE && !dto.correctedInvoiceId) {
      throw new BadRequestException('Un avoir doit référencer la pièce qu’il corrige.');
    }

    // ⚠️ UN AVOIR NE PEUT PAS DÉPASSER CE QU'IL CORRIGE.
    //
    //    Rien ne comparait son montant à la pièce corrigée. La vue de risque
    //    soustrait chaque avoir de l'en-cours : un avoir de 100 000 000 FCFA
    //    adossé à une facture de 800 000 ramenait l'exposition du client à
    //    ZÉRO, et lui restituait tout son crédit disponible. Une écriture
    //    d'une ligne, sans rapprochement, sans plafond, sans dérogation.
    if (dto.type === InvoiceType.CREDIT_NOTE && dto.correctedInvoiceId) {
      await this.assertAvoirRecevable(dto.correctedInvoiceId, dto.billedVolume * dto.unitPrice);
    }

    const deal = await this.prisma.deal.findUniqueOrThrow({
      where: { id: dto.dealId },
      select: { clientId: true, currencyCode: true },
    });

    const currencyCode = dto.currencyCode || deal.currencyCode;
    const documentCurrencyCode = dto.documentCurrencyCode ?? currencyCode;

    // ⚠️ LE PLAN TRANSACTION S'ARRONDIT À LA PRÉCISION DE SA DEVISE.
    //
    //    Il ne le faisait pas : seul le plan DOCUMENT arrondissait. Le XOF n'a
    //    pas de décimale — le § 9.2 le dit : « tout montant imprimé en FCFA est
    //    un entier ». Le total stocké portait donc 9 447 530,0895 quand
    //    l'imprimé disait 9 447 530. Le client paie l'imprimé ; il restait
    //    0,0895 FCFA, le statut passait à PARTIELLEMENT PAYÉE et n'atteignait
    //    JAMAIS PAYÉE. La pièce restait indéfiniment dans l'en-cours.
    //
    //    Dans l'autre sens — arrondi au-dessus — `recordPayment` REFUSAIT
    //    purement et simplement l'encaissement du montant imprimé.
    const decimals = await this.decimalPlaces(currencyCode);

    const grossAmount = roundTo(dto.billedVolume * dto.unitPrice, decimals);
    const discountAmount = roundTo(
      computeDiscount(grossAmount, dto.billedVolume, dto.discountMode, dto.discountValue),
      decimals,
    );
    const totalAmount = roundTo(grossAmount - discountAmount, decimals);
    if (totalAmount < 0) {
      throw new BadRequestException('La réduction dépasse le montant brut de la pièce.');
    }

    // ⚠️ LE TAUX DE TVA VIENT DU PARAMÉTRAGE, PAS DE LA REQUÊTE SEULE.
    //
    //    Il venait ENTIÈREMENT de la requête, avec un repli à zéro. Une pièce
    //    normalisée cochée « TVA applicable » sans taux sortait donc à 0 % :
    //    tous les CHECK passaient, la pièce était transmise à la DGI, et la
    //    TVA collectée n'était pas déclarée. `VAT_STANDARD_RATE` existait en
    //    base, s'affichait à l'écran de paramétrage, et n'était lu par
    //    personne.
    //
    //    Un taux explicitement fourni reste prioritaire : une exonération ou
    //    un régime particulier se saisit. Mais l'ABSENCE de taux prend celui
    //    de droit commun, et un taux NUL sur une pièce assujettie est refusé —
    //    c'est une pièce fiscale, pas une case à cocher.
    const isVatApplicable = dto.isVatApplicable ?? false;
    const vatRatePct = isVatApplicable
      ? (dto.vatRatePct ?? (await this.settings.number('VAT_STANDARD_RATE', 18)))
      : 0;

    if (isVatApplicable && vatRatePct <= 0) {
      throw new BadRequestException(
        'TVA déclarée applicable mais taux nul. Saisissez le taux, ou décochez la TVA et indiquez la référence d’exonération : une pièce assujettie à 0 % est un redressement en attente.',
      );
    }

    const vatAmount = isVatApplicable ? roundTo(extractVat(totalAmount, vatRatePct), decimals) : 0;

    const [toPivot, toDocument] = await Promise.all([
      this.rateToPivot(currencyCode),
      this.rateBetween(currencyCode, documentCurrencyCode),
    ]);
    const documentDecimals = await this.decimalPlaces(documentCurrencyCode);

    // Le cours TEL QU'IL SERA CONSERVÉ : c'est lui qui doit servir au calcul,
    // faute de quoi le montant et le cours de la même ligne ne se répondent
    // plus.
    const cours = Number(toPivot.rate.toFixed(8));

    const number = await this.reference.annual(NUMBER_SCOPE[dto.type], 5);

    const invoice = await this.prisma.invoice.create({
      data: {
        number,
        type: dto.type,
        status: InvoiceStatus.DRAFT,
        dealId: dto.dealId,
        partnerId: deal.clientId,
        createdById: actorId,
        sourceProformaId: dto.sourceProformaId ?? null,
        correctedInvoiceId: dto.correctedInvoiceId ?? null,

        billedVolume: dto.billedVolume.toFixed(6),
        uom: dto.uom,
        unitPrice: dto.unitPrice.toFixed(4),

        // --- Plan TRANSACTION : fait foi juridiquement ---
        currencyCode,
        grossAmount: grossAmount.toFixed(4),
        discountMode: dto.discountMode ?? null,
        discountValue: dto.discountValue?.toFixed(4) ?? null,
        discountAmount: discountAmount.toFixed(4),
        totalAmount: totalAmount.toFixed(4),
        vatAmount: vatAmount.toFixed(4),

        // --- Plan PIVOT : risque, marge, en-cours ---
        //
        // ⚠️ Le montant est calculé À PARTIR DU COURS STOCKÉ, pas du cours brut.
        //    La colonne ne retient que huit décimales ; multiplier par le cours
        //    à pleine précision produisait un montant que le cours conservé ne
        //    permet plus de retrouver. Écart constaté : 0,04 USD sur 15 600 —
        //    négligeable en soi, mais c'est un rapprochement qui ne tombe
        //    jamais juste, et personne ne saura dire pourquoi.
        fxRateToPivot: cours.toFixed(8),
        fxRateDate: toPivot.date,
        totalAmountPivot: round4(totalAmount * cours).toFixed(4),

        // --- Plan DOCUMENT : devise d'impression ---
        documentCurrencyCode,
        documentFxRate: toDocument.rate.toFixed(8),
        documentFxRateId: toDocument.id,
        documentGrossAmount: roundTo(grossAmount * toDocument.rate, documentDecimals).toFixed(4),
        documentTotalAmount: roundTo(totalAmount * toDocument.rate, documentDecimals).toFixed(4),
        documentVatAmount: roundTo(vatAmount * toDocument.rate, documentDecimals).toFixed(4),

        // --- Fiscalité ---
        isVatApplicable,
        vatRatePct: vatRatePct.toFixed(3),
        printedTaxRegime: dto.printedTaxRegime ?? TaxRegime.TTC,
        vatExemptionReference: dto.vatExemptionReference ?? null,
        // Un mode explicitement fourni reste prioritaire — même règle que le
        // taux de TVA ci-dessus. Le défaut est un réglage, pas une déduction :
        // rien dans la commande ne dit COMMENT le client va payer.
        paymentMethod: dto.paymentMethod ?? (await this.defaultPaymentMethod()),

        ...(dto.type === InvoiceType.SIMPLE && dto.simpleInvoiceReason
          ? {
              simpleInvoiceDecidedById: actorId,
              simpleInvoiceDecidedAt: new Date(),
              simpleInvoiceReason: dto.simpleInvoiceReason,
            }
          : {}),
      },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'Invoice',
      entityId: invoice.id,
      after: invoice,
    });

    return invoice;
  }

  /**
   * Émission — la pièce quitte le brouillon et devient opposable.
   *
   * Un écart de volume N'A AUCUN EFFET ICI. L'ullage est un contrôle
   * opérationnel et HSE : il alerte, il ouvre une non-conformité au seuil
   * critique, mais il ne retient jamais une facture. Le volume facturé est
   * saisi à l'édition et ne se déduit pas du relevé (§ 8.3).
   */
  async issue(id: string, dto: IssueInvoiceDto, actorId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        type: true,
        status: true,
        correctedInvoiceId: true,
        partner: { select: { paymentTermsDays: true } },
      },
    });

    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Seule une pièce au brouillon peut être émise.');
    }

    const issueDate = dto.issueDate ? new Date(dto.issueDate) : new Date();
    const dueDate = dto.dueDate
      ? new Date(dto.dueDate)
      : addDays(issueDate, invoice.partner.paymentTermsDays);

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.ISSUED,
        issueDate,
        // Une proforma ne crée aucune créance : pas d'échéance de paiement.
        dueDate: invoice.type === InvoiceType.PROFORMA ? null : dueDate,
        issuedById: actorId,
        issuedAt: new Date(),
        authenticityToken: randomBytes(24).toString('hex'),
      },
    });

    // La FNE entre dans le cycle fiscal dès son émission (§ 9.5). Un avoir
    // sur une pièce FNE relève du même cycle : la DGI le certifie par un
    // second appel (refund), distinct de celui d'une facture (sign).
    const correctsFne =
      invoice.type === InvoiceType.CREDIT_NOTE && invoice.correctedInvoiceId
        ? (
            await this.prisma.invoice.findUnique({
              where: { id: invoice.correctedInvoiceId },
              select: { type: true },
            })
          )?.type === InvoiceType.FNE
        : false;

    if (invoice.type === InvoiceType.FNE || correctsFne) {
      await this.prisma.fneTransmission.upsert({
        where: { invoiceId: id },
        update: { status: FneStatus.PENDING_TRANSMISSION },
        create: { invoiceId: id, status: FneStatus.PENDING_TRANSMISSION },
      });

      // Best-effort : ne fait jamais échouer l'émission de la pièce. Voir
      // l'en-tête de FneClientService.
      try {
        if (invoice.type === InvoiceType.FNE) {
          await this.fneClient.certifySale(id, actorId);
        } else {
          await this.fneClient.certifyCreditNote(id, actorId);
        }
      } catch (e) {
        this.logger.warn(`Transmission FNE de ${id} interrompue par une erreur imprévue : ${(e as Error).message}`);
      }
    }

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'Invoice',
      entityId: id,
      before: { status: InvoiceStatus.DRAFT },
      after: { status: InvoiceStatus.ISSUED, issueDate, dueDate },
    });

    return updated;
  }

  /**
   * Conversion d'une proforma en pièce définitive.
   *
   * Volume et prix sont REPRIS mais restent modifiables : entre la proforma
   * et la facture, la quantité effectivement livrée a pu changer (§ 9.3).
   */
  async convertProforma(
    proformaId: string,
    dto: Partial<CreateInvoiceDto> & { type: InvoiceType },
    actorId: string,
  ) {
    const proforma = await this.prisma.invoice.findUniqueOrThrow({ where: { id: proformaId } });
    if (proforma.type !== InvoiceType.PROFORMA) {
      throw new BadRequestException('Seule une proforma se convertit.');
    }
    if (dto.type === InvoiceType.PROFORMA) {
      throw new BadRequestException('Une proforma ne se convertit pas en proforma.');
    }

    return this.create(
      {
        dealId: proforma.dealId,
        type: dto.type,
        billedVolume: dto.billedVolume ?? Number(proforma.billedVolume),
        uom: dto.uom ?? proforma.uom,
        unitPrice: dto.unitPrice ?? Number(proforma.unitPrice),
        currencyCode: dto.currencyCode ?? proforma.currencyCode,
        discountMode: dto.discountMode ?? proforma.discountMode ?? undefined,
        discountValue:
          dto.discountValue ??
          (proforma.discountValue === null ? undefined : Number(proforma.discountValue)),
        isVatApplicable: dto.isVatApplicable ?? proforma.isVatApplicable,
        vatRatePct: dto.vatRatePct ?? Number(proforma.vatRatePct),
        printedTaxRegime: dto.printedTaxRegime ?? proforma.printedTaxRegime,
        vatExemptionReference:
          dto.vatExemptionReference ?? proforma.vatExemptionReference ?? undefined,
        documentCurrencyCode: dto.documentCurrencyCode ?? proforma.documentCurrencyCode,
        paymentMethod: dto.paymentMethod ?? proforma.paymentMethod ?? undefined,
        sourceProformaId: proforma.id,
        simpleInvoiceReason: dto.simpleInvoiceReason,
      },
      actorId,
    );
  }

  /** Encaissement client — met à jour l'en-cours par le même chemin (§ 9.1). */
  async recordPayment(invoiceId: string, dto: PaymentDto, actorId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: {
        id: true,
        type: true,
        partnerId: true,
        totalAmount: true,
        paidAmount: true,
        currencyCode: true,
        // Le cours FIGÉ à l'émission : c'est lui qui convertit l'encaissement,
        // pas celui du jour.
        fxRateToPivot: true,
        createdById: true,
      },
    });

    if (invoice.type === InvoiceType.PROFORMA) {
      throw new BadRequestException(
        'Une proforma ne porte pas d’encaissement : elle ne crée aucune créance (§ 9.3).',
      );
    }

    // ⚠️ CORRIGÉ (audit, axe C, S1) — séparation des tâches. Celui qui a créé
    // la facture ne peut pas être celui qui en enregistre l'encaissement :
    // sans ce garde-fou, une pièce fictive et son encaissement pouvaient
    // sortir de la même main, sans second regard.
    if (invoice.createdById && invoice.createdById === actorId) {
      throw new ForbiddenException(
        'Séparation des tâches : la personne qui a créé cette facture ne peut pas en enregistrer l’encaissement. Un autre compte doit le faire.',
      );
    }

    const toPivot = await this.rateToPivot(dto.currencyCode);

    // L'encaissement se compare au total DANS LA PRÉCISION DE LA DEVISE. En
    // XOF, un solde de 0,0895 n'existe pas : le client paie le montant
    // imprimé, et refuser son règlement pour une fraction de franc bloquait
    // la pièce des deux côtés — jamais soldée, ou encaissement refusé.
    const decimals = await this.decimalPlaces(invoice.currencyCode);
    const paid = roundTo(Number(invoice.paidAmount) + dto.amount, decimals);
    const total = roundTo(Number(invoice.totalAmount), decimals);
    const tolerance = 10 ** -decimals / 2;

    if (paid > total + tolerance) {
      throw new BadRequestException(
        `Encaissement de ${dto.amount} supérieur au solde dû (${roundTo(total - Number(invoice.paidAmount), decimals)}).`,
      );
    }

    // ⚠️ LE SOLDE DE LA PIÈCE N'EST PLUS ÉCRIT ICI.
    //
    //    Il l'était, en VALEUR ABSOLUE, à partir d'une lecture faite HORS
    //    transaction. Deux règlements concurrents de 600 sur une facture de
    //    1 000 lisaient tous deux 0, calculaient tous deux 600, passaient tous
    //    deux le contrôle, et s'écrivaient tous deux : 1 200 au journal, 600 au
    //    solde, facture « partiellement payée ». L'en-cours crédit, qui lit
    //    `paid_amount_pivot`, était faux d'autant.
    //
    //    Le solde est désormais DÉRIVÉ du journal par un déclencheur
    //    (`31_encaissement_fiable.sql`). La course se referme d'elle-même : le
    //    second règlement recalcule la somme, dépasse le total, et la contrainte
    //    `paid_amount <= total_amount` le refuse. C'est le moteur qui arbitre,
    //    plus l'application — donc l'import et la reprise de données sont
    //    protégés au même titre que cet appel.
    //
    //    Le contrôle ci-dessus est CONSERVÉ : il rend un message lisible dans le
    //    cas courant, là où la contrainte rendrait une erreur technique. Il n'est
    //    plus ce qui protège.
    const payment = await this.prisma.payment.create({
      data: {
        direction: 'INBOUND',
        partnerId: invoice.partnerId,
        invoiceId,
        amount: dto.amount.toFixed(4),
        currencyCode: dto.currencyCode,
        fxRateToPivot: toPivot.rate.toFixed(8),
        amountPivot: round4(dto.amount * toPivot.rate).toFixed(4),
        valueDate: new Date(dto.valueDate),
        bankReference: dto.bankReference ?? null,
        notes: dto.notes ?? null,
        recordedById: actorId,
      },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'Payment',
      entityId: payment.id,
      after: payment,
    });

    return payment;
  }

  /**
   * Reprise manuelle d'une transmission FNE restée en attente ou à corriger.
   * La file de tâches (`22_file_de_taches.sql`, tâche `FNE_NON_TRANSMISE`)
   * signale ces pièces ; ce point d'entrée est ce sur quoi elle débouche.
   */
  async retryFne(id: string, actorId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id },
      select: { fneTransmission: { select: { status: true } } },
    });
    if (!invoice.fneTransmission) {
      throw new BadRequestException('Cette pièce n’est pas engagée dans le cycle FNE.');
    }
    if (invoice.fneTransmission.status === FneStatus.ACCEPTED) {
      throw new BadRequestException('Cette pièce est déjà certifiée par la DGI.');
    }

    await this.fneClient.retry(id, actorId);
    return this.prisma.invoice.findUniqueOrThrow({ where: { id }, include: { fneTransmission: true } });
  }

  /**
   * Annulation directe d'une pièce émise par erreur (arbitrage du 15/08).
   *
   * ⚠️ FERMÉE DÈS QU'UN ENCAISSEMENT EXISTE, MÊME PARTIEL.
   *
   *    Annuler une pièce déjà réglée effacerait la créance sans effacer
   *    l'argent reçu : le paiement resterait sans pièce à rapprocher. Seul
   *    l'avoir corrige une pièce encaissée — il laisse la trace que
   *    l'annulation directe ne laisserait pas.
   *
   *    Une FNE déjà ACCEPTÉE par la DGI ne s'annule pas davantage en
   *    interne : elle est opposable côté DGI, l'avoir est la seule
   *    correction qui reste cohérente des deux côtés.
   */
  async cancel(id: string, dto: CancelInvoiceDto, actorId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id },
      select: {
        number: true,
        status: true,
        type: true,
        paidAmount: true,
        fneTransmission: { select: { status: true } },
      },
    });

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException(`${invoice.number} est déjà annulée.`);
    }
    if (invoice.status === InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        `${invoice.number} est au brouillon : elle n’a jamais été émise, rien à annuler formellement.`,
      );
    }
    if (Number(invoice.paidAmount) > 0) {
      throw new BadRequestException(
        `${invoice.number} porte un encaissement : seul un avoir peut la corriger, une annulation directe effacerait le paiement reçu sans laisser de trace.`,
      );
    }
    if (invoice.type === InvoiceType.FNE && invoice.fneTransmission?.status === FneStatus.ACCEPTED) {
      throw new BadRequestException(
        `${invoice.number} est certifiée par la DGI : seul un avoir la corrige, une annulation interne ne l’efface pas côté fiscal.`,
      );
    }

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.CANCELLED,
        cancelledById: actorId,
        cancelledAt: new Date(),
        cancellationReason: dto.reason,
      },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'Invoice',
      entityId: id,
      before: { status: invoice.status },
      after: { status: InvoiceStatus.CANCELLED, reason: dto.reason },
    });

    return updated;
  }

  // --- Règles transverses ---------------------------------------------------

  /** Taux vers la devise pivot. 1 si la pièce est déjà libellée dans le pivot. */
  private async rateToPivot(currencyCode: string): Promise<{ rate: number; date: Date }> {
    const pivot = await this.prisma.currency.findFirstOrThrow({ where: { isPivot: true } });
    if (pivot.code === currencyCode) return { rate: 1, date: new Date() };

    const resolved = await this.rateBetween(currencyCode, pivot.code);
    return { rate: resolved.rate, date: resolved.date };
  }

  /**
   * Taux entre deux devises, à la date du jour.
   *
   * Le sens inverse est accepté et inversé : une paire USD/XOF sert les deux
   * conversions. Refuser XOF→USD faute d'une ligne dédiée obligerait à saisir
   * deux fois le même cours, et à les voir diverger.
   */
  private async rateBetween(
    from: string,
    to: string,
  ): Promise<{ rate: number; date: Date; id: string | null }> {
    if (from === to) return { rate: 1, date: new Date(), id: null };

    const today = new Date();
    const window = {
      effectiveFrom: { lte: today },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
    };

    const direct = await this.prisma.fxRate.findFirst({
      where: { baseCurrencyCode: from, quoteCurrencyCode: to, ...window },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (direct) {
      return { rate: Number(direct.rate), date: direct.effectiveFrom, id: direct.id };
    }

    const inverse = await this.prisma.fxRate.findFirst({
      where: { baseCurrencyCode: to, quoteCurrencyCode: from, ...window },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (inverse) {
      return { rate: 1 / Number(inverse.rate), date: inverse.effectiveFrom, id: inverse.id };
    }

    throw new BadRequestException(
      `Aucun taux de change en vigueur pour ${from} → ${to}. La pièce ne peut pas être libellée sans taux daté et traçable.`,
    );
  }

  /**
   * Un avoir ne peut pas excéder le restant à corriger sur la pièce visée.
   *
   * Le cumul des avoirs déjà émis est pris en compte : sans cela, dix avoirs
   * de la moitié du montant passeraient chacun le contrôle.
   */
  private async assertAvoirRecevable(correctedInvoiceId: string, montant: number): Promise<void> {
    const piece = await this.prisma.invoice.findUnique({
      where: { id: correctedInvoiceId },
      select: { number: true, totalAmount: true, currencyCode: true, type: true },
    });
    if (!piece) {
      throw new BadRequestException('La pièce corrigée par cet avoir est introuvable.');
    }
    if (piece.type === InvoiceType.CREDIT_NOTE) {
      throw new BadRequestException(
        `${piece.number} est elle-même un avoir : un avoir ne se corrige pas par un avoir.`,
      );
    }

    const dejaAvoire = await this.prisma.invoice.aggregate({
      where: { correctedInvoiceId, type: InvoiceType.CREDIT_NOTE },
      _sum: { totalAmount: true },
    });

    const corrigeable =
      Number(piece.totalAmount) - Number(dejaAvoire._sum.totalAmount ?? 0);

    // La tolérance suit la DEVISE : en XOF, le plus petit écart réel vaut 1.
    // Un seuil de 0,01 écrit en dur n'y tolère rien — et tolère mille fois
    // trop sur une devise à deux décimales.
    const decimals = await this.decimalPlaces(piece.currencyCode);
    const tolerance = 10 ** -decimals / 2;

    if (montant > corrigeable + tolerance) {
      throw new BadRequestException(
        `Avoir de ${montant.toFixed(decimals)} ${piece.currencyCode} sur ${piece.number}, dont il ne reste que ${corrigeable.toFixed(decimals)} à corriger${
          Number(dejaAvoire._sum.totalAmount ?? 0) > 0
            ? ` (${Number(dejaAvoire._sum.totalAmount).toFixed(decimals)} déjà avoirés)`
            : ''
        }. Un avoir qui dépasse la pièce qu'il corrige efface un en-cours qui existe.`,
      );
    }
  }

  /**
   * Repli de `FNE_DEFAULT_PAYMENT_METHOD` — jamais une valeur au hasard. Une
   * clé vide, absente ou mal orthographiée dans le réglage vaut ABSENCE de
   * défaut : la pièce reste sans mode de règlement, à saisir explicitement,
   * plutôt que d'en hériter un que personne n'a choisi.
   */
  private async defaultPaymentMethod(): Promise<InvoicePaymentMethod | null> {
    const raw = await this.settings.string('FNE_DEFAULT_PAYMENT_METHOD', '');
    if (!raw) return null;

    const value = raw.trim().toUpperCase() as InvoicePaymentMethod;
    if (!Object.values(InvoicePaymentMethod).includes(value)) {
      this.logger.warn(
        `FNE_DEFAULT_PAYMENT_METHOD = « ${raw} » n’est pas une valeur reconnue — aucun défaut appliqué.`,
      );
      return null;
    }
    return value;
  }

  private async decimalPlaces(currencyCode: string): Promise<number> {
    const currency = await this.prisma.currency.findUniqueOrThrow({
      where: { code: currencyCode },
      select: { decimalPlaces: true },
    });
    return currency.decimalPlaces;
  }
}

function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// ===========================================================================
//  Contrôleur
// ===========================================================================

@Controller('api/internal/invoices')
@RequireRealm(Realm.INTERNAL)
export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  @Get()
  @Roles(
    UserRole.DG,
    UserRole.CCOO,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.SALES_REP,
    UserRole.ASSISTANT_DG,
  )
  list(@Query() query: InvoiceQuery) {
    return this.service.list(query);
  }

  @Get(':id')
  @Roles(
    UserRole.DG,
    UserRole.CCOO,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.SALES_REP,
  )
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles(UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT, UserRole.SALES_REP)
  create(@Body() dto: CreateInvoiceDto, @Req() req: { auth: { sub: string } }) {
    return this.service.create(dto, req.auth.sub);
  }

  @Post(':id/convert')
  @Roles(UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
  convert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInvoiceDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.convertProforma(id, dto, req.auth.sub);
  }

  @Patch(':id/issue')
  @Roles(UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
  issue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IssueInvoiceDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.issue(id, dto, req.auth.sub);
  }

  @Patch(':id/fne/retry')
  @Roles(UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
  retryFne(@Param('id', ParseUUIDPipe) id: string, @Req() req: { auth: { sub: string } }) {
    return this.service.retryFne(id, req.auth.sub);
  }

  @Post(':id/pdf')
  @Roles(UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
  queuePdf(@Param('id', ParseUUIDPipe) id: string, @Req() req: { auth: { sub: string } }) {
    return this.service.queuePdf(id, req.auth.sub);
  }

  @Patch(':id/cancel')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelInvoiceDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.cancel(id, dto, req.auth.sub);
  }

  @Post(':id/payments')
  @Roles(UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PaymentDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.recordPayment(id, dto, req.auth.sub);
  }
}
