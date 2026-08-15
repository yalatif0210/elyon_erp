import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { GeneratedDocumentKind, InvoiceType } from '@prisma/client';
import type { Job } from 'bullmq';
import { randomBytes } from 'node:crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../common/config/settings.service';
import { StorageService } from '../common/storage/storage.service';
import { DocumentsService } from './documents.controller';
import { PdfRendererService } from './pdf-renderer.service';
import { InvoicePdfData, renderInvoiceHtml } from './invoice-pdf.template';

export interface InvoicePdfJob {
  type: 'invoice';
  invoiceId: string;
  actorId: string;
}

const KIND_BY_INVOICE_TYPE: Record<InvoiceType, GeneratedDocumentKind> = {
  PROFORMA: GeneratedDocumentKind.PROFORMA,
  SIMPLE: GeneratedDocumentKind.INVOICE,
  FNE: GeneratedDocumentKind.INVOICE,
  CREDIT_NOTE: GeneratedDocumentKind.CREDIT_NOTE,
};

/**
 * Traitement asynchrone de la génération PDF (§ 1.1, § 12).
 *
 * Best-effort du même esprit que `FneClientService` : une panne Chromium ne
 * doit rien casser côté facturation. Le job échoue, BullMQ le retente
 * (3 essais, backoff exponentiel — posé à l'enqueue), et la pièce reste
 * consultable sans PDF entre-temps.
 */
@Processor('documents')
export class DocumentsPdfProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentsPdfProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly renderer: PdfRendererService,
    private readonly storage: StorageService,
    private readonly documents: DocumentsService,
    private readonly settings: SettingsService,
  ) {
    super();
  }

  async process(job: Job<InvoicePdfJob>): Promise<{ documentId: string; reference: string }> {
    if (job.data.type !== 'invoice') {
      throw new Error(`Type de job inconnu : ${(job.data as { type: string }).type}`);
    }
    return this.processInvoice(job.data.invoiceId, job.data.actorId);
  }

  private async processInvoice(invoiceId: string, actorId: string): Promise<{ documentId: string; reference: string }> {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: {
        partner: { select: { legalName: true, taxpayerAccountNumber: true, countryCode: true } },
        deal: { select: { reference: true, product: { select: { name: true } } } },
        fneTransmission: { select: { fiscalReference: true } },
        correctedInvoice: { select: { number: true } },
      },
    });

    // ⚠️ LE JETON EST CELUI DU DOCUMENT, PAS CELUI DE LA FACTURE.
    //
    //    `Invoice.authenticityToken` et `GeneratedDocument.authenticityToken`
    //    sont deux jetons DISTINCTS — `DocumentsService.verify()` ne connaît
    //    que le second. Il doit donc être généré ICI, avant le rendu, pour
    //    être à la fois imprimé dans le PDF (QR code) et transmis tel quel à
    //    `register()` ci-dessous : un jeton créé après coup par `register()`
    //    ne correspondrait plus à ce que le QR code du PDF déjà scellé porte.
    const documentToken = randomBytes(24).toString('hex');
    const baseUrl = await this.settings.string('DOCUMENT_VERIFY_BASE_URL', '');
    const verifyPath = `/api/internal/documents/verify/${documentToken}`;
    const verifyUrl = baseUrl ? `${baseUrl.replace(/\/+$/, '')}${verifyPath}` : verifyPath;
    const qrDataUri = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 200 });

    const data: InvoicePdfData = {
      number: invoice.number,
      type: invoice.type,
      issueDate: invoice.issueDate?.toISOString() ?? null,
      dueDate: invoice.dueDate?.toISOString() ?? null,
      billedVolume: invoice.billedVolume.toString(),
      uom: invoice.uom,
      unitPrice: invoice.unitPrice.toString(),
      currencyCode: invoice.currencyCode,
      grossAmount: invoice.grossAmount.toString(),
      discountAmount: invoice.discountAmount.toString(),
      totalAmount: invoice.totalAmount.toString(),
      vatAmount: invoice.vatAmount.toString(),
      isVatApplicable: invoice.isVatApplicable,
      vatRatePct: invoice.vatRatePct.toString(),
      printedTaxRegime: invoice.printedTaxRegime,
      vatExemptionReference: invoice.vatExemptionReference,
      fiscalReference: invoice.fneTransmission?.fiscalReference ?? null,
      correctedInvoiceNumber: invoice.correctedInvoice?.number ?? null,
      partnerLegalName: invoice.partner.legalName,
      partnerTaxpayerAccountNumber: invoice.partner.taxpayerAccountNumber,
      partnerCountryCode: invoice.partner.countryCode,
      dealReference: invoice.deal.reference,
      productName: invoice.deal.product.name,
      verifyUrl,
      qrDataUri,
    };

    const html = renderInvoiceHtml(data);
    const pdf = await this.renderer.renderPdf(html);
    const stored = await this.storage.put(pdf, 'application/pdf');

    const kind = KIND_BY_INVOICE_TYPE[invoice.type];
    const registered = await this.documents.register(
      { kind, invoiceId, storageKey: stored.storageKey, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, sha256: stored.sha256 },
      actorId,
      documentToken,
    );

    // Proforma, facture, avoir n'appellent aucune signature (§ 12.2, liste
    // REQUIRES_SIGNATURE de DocumentsService) : le scellement peut suivre
    // immédiatement la génération.
    const sealed = await this.documents.seal(registered.id, actorId);

    this.logger.log(`PDF généré et scellé : ${sealed.reference} (facture ${invoice.number})`);
    return { documentId: sealed.id, reference: sealed.reference };
  }
}

