import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ActorType, AttachmentKind, GeneratedDocumentKind, InvoiceType } from '@prisma/client';
import type { Job } from 'bullmq';
import { randomBytes } from 'node:crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../common/config/settings.service';
import { StorageService } from '../common/storage/storage.service';
import { DocumentsService } from './documents.controller';
import { PdfRendererService } from './pdf-renderer.service';
import { InvoicePdfData, renderInvoiceHtml } from './invoice-pdf.template';
import {
  OperationReportCheckData,
  OperationReportIncidentData,
  OperationReportPdfData,
  OperationReportPhotoData,
  renderOperationReportHtml,
} from './operation-report-pdf.template';
import { DeliveryNotePdfData, renderDeliveryNoteHtml } from './delivery-note-pdf.template';

export interface InvoicePdfJob {
  type: 'invoice';
  invoiceId: string;
  actorId: string;
}

export interface OperationClosurePdfJob {
  type: 'operation-closure';
  operationId: string;
  /** Agent terrain à l'origine de la génération — jamais un utilisateur interne. */
  fieldUserId: string;
}

type DocumentsJob = InvoicePdfJob | OperationClosurePdfJob;

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

  async process(job: Job<DocumentsJob>): Promise<unknown> {
    switch (job.data.type) {
      case 'invoice':
        return this.processInvoice(job.data.invoiceId, job.data.actorId);
      case 'operation-closure':
        return this.processOperationClosure(job.data.operationId, job.data.fieldUserId);
      default:
        throw new Error(`Type de job inconnu : ${(job.data as { type: string }).type}`);
    }
  }

  /**
   * Jeton, URL et QR d'authenticité — identiques pour toute nature de pièce.
   *
   * ⚠️ CORRIGÉ — LE QR CODE POINTAIT SUR L'API BRUTE, PAS SUR LA PAGE.
   *
   *    `path` désignait `/api/internal/documents/verify/:token` : la route
   *    JSON elle-même, jamais la page Angular `/verification/:token` bâtie
   *    exprès pour ce cas (`VerifyDocumentComponent`, hors session, aucun
   *    `authGuard`). Scanner le QR code d'un papier n'ouvrait donc pas la
   *    page de vérification promise, mais une réponse JSON brute dans le
   *    navigateur — la promesse imprimée sur le papier n'avait toujours pas
   *    de page derrière elle, malgré l'existence de cette page.
   */
  private async buildVerification(): Promise<{ token: string; url: string; qrDataUri: string }> {
    const token = randomBytes(24).toString('hex');
    const baseUrl = await this.settings.string('DOCUMENT_VERIFY_BASE_URL', '');
    const path = `/verification/${token}`;
    const url = baseUrl ? `${baseUrl.replace(/\/+$/, '')}${path}` : path;
    const qrDataUri = await QRCode.toDataURL(url, { margin: 1, width: 200 });
    return { token, url, qrDataUri };
  }

  /** Photo embarquée en base64 — le PDF est un document autonome, sans ressource externe. */
  private async toDataUri(storageKey: string, mimeType: string): Promise<string> {
    const buffer = await this.storage.readBuffer(storageKey);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  private async processInvoice(invoiceId: string, actorId: string): Promise<{ documentId: string; reference: string }> {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: {
        partner: { select: { legalName: true, taxpayerAccountNumber: true, countryCode: true } },
        deal: { select: { reference: true, product: { select: { name: true } } } },
        // Une proforma née d'une demande de cotation n'a pas encore de deal
        // (§ discussion 17/08) : le produit se lit alors sur la demande.
        quotationRequest: { select: { product: { select: { name: true } } } },
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
    const { token: documentToken, url: verifyUrl, qrDataUri } = await this.buildVerification();

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
      dealReference: invoice.deal?.reference ?? null,
      productName: invoice.deal?.product.name ?? invoice.quotationRequest?.product.name ?? '',
      verifyUrl,
      qrDataUri,
    };

    const html = renderInvoiceHtml(data);
    const pdf = await this.renderer.renderPdf(html);
    const stored = await this.storage.put(pdf, 'application/pdf');

    const kind = KIND_BY_INVOICE_TYPE[invoice.type];
    const registered = await this.documents.register(
      { kind, invoiceId },
      { type: ActorType.INTERNAL_USER, id: actorId },
      stored,
      documentToken,
    );

    // Proforma, facture, avoir n'exigent aucune signature (§ 12.2 — seuls le
    // rapport d'exécution et le bon de livraison en exigent une, voir
    // `DocumentsService.seal`) : le scellement peut suivre immédiatement la
    // génération.
    const sealed = await this.documents.seal(registered.id, actorId);

    this.logger.log(`PDF généré et scellé : ${sealed.reference} (facture ${invoice.number})`);
    return { documentId: sealed.id, reference: sealed.reference };
  }

  /**
   * Rapport d'exécution + bon de livraison, à la clôture terrain (§ 10, § 12.2).
   *
   * ⚠️ LES DEUX PIÈCES NAISSENT NON SCELLÉES, VOLONTAIREMENT.
   *
   *    Contrairement à une facture, elles exigent une signature avant de
   *    pouvoir être scellées (`DocumentsService.seal`) : l'agent pour le
   *    rapport, l'agent ET le client pour le bon de livraison. Générer puis
   *    sceller ici, comme pour une facture, produirait une pièce scellée que
   *    personne n'a signée — précisément ce que les règles de scellement
   *    viennent d'interdire.
   *
   *    Le contenu du PDF, lui, ne change pas après signature : la signature
   *    est un FAIT enregistré à part (`Signature`), pas un dessin réinjecté
   *    dans le document. C'est ce qui permet au document d'exister — et d'être
   *    lisible — avant que quiconque n'ait signé.
   */
  private async processOperationClosure(
    operationId: string,
    fieldUserId: string,
  ): Promise<{
    operationReport: { documentId: string; reference: string };
    deliveryNote: { documentId: string; reference: string };
  }> {
    const op = await this.prisma.operation.findUniqueOrThrow({
      where: { id: operationId },
      include: {
        deal: {
          select: {
            reference: true,
            client: { select: { legalName: true, taxpayerAccountNumber: true } },
            product: { select: { name: true } },
          },
        },
        fieldAgent: { select: { fullName: true } },
        assignment: {
          select: {
            carrier: { select: { legalName: true } },
            vehicle: { select: { registration: true } },
            vehicleIdentifier: true,
            driver: { select: { fullName: true } },
          },
        },
        hseChecks: {
          orderBy: { phase: 'asc' },
          include: {
            validatedByFieldUser: { select: { fullName: true } },
            validatedByUser: { select: { fullName: true } },
            items: {
              include: {
                item: { select: { label: true } },
                recordedByFieldUser: { select: { fullName: true } },
                attachments: {
                  where: { kind: AttachmentKind.PHOTO },
                  select: { storageKey: true, mimeType: true, caption: true },
                },
              },
            },
          },
        },
        hseEvents: {
          orderBy: { occurredAt: 'asc' },
          include: {
            attachments: {
              where: { kind: AttachmentKind.PHOTO },
              select: { storageKey: true, mimeType: true, caption: true },
            },
          },
        },
        measurements: { where: { isAuthoritative: true }, take: 1 },
      },
    });

    const checks: OperationReportCheckData[] = await Promise.all(
      op.hseChecks.map(async (c) => ({
        phase: c.phase,
        validatedAt: c.validatedAt?.toISOString() ?? null,
        validatedByName: c.validatedByFieldUser?.fullName ?? c.validatedByUser?.fullName ?? null,
        items: await Promise.all(
          c.items.map(async (i) => ({
            label: i.item.label,
            level: i.level,
            outcome: i.outcome,
            recordedValue: i.recordedValue,
            comment: i.comment,
            recordedAt: i.recordedAt?.toISOString() ?? null,
            recordedByName: i.recordedByFieldUser?.fullName ?? null,
            photos: await this.photosOf(i.attachments),
          })),
        ),
      })),
    );

    const incidents: OperationReportIncidentData[] = await Promise.all(
      op.hseEvents.map(async (e) => ({
        reference: e.reference,
        type: e.type,
        severity: e.severity,
        status: e.status,
        title: e.title,
        description: e.description,
        occurredAt: e.occurredAt.toISOString(),
        closedAt: e.closedAt?.toISOString() ?? null,
        closureEvidence: e.closureEvidence,
        photos: await this.photosOf(e.attachments),
      })),
    );

    // ⚠️ UN JETON ET UNE RÉFÉRENCE PAR PIÈCE, JAMAIS PARTAGÉS.
    //
    //    Comme pour la facture : jeton et référence doivent être connus AVANT
    //    le rendu pour être imprimés dans le document lui-même (QR code,
    //    en-tête), et transmis TELS QUELS à `register()`. Les partager entre
    //    les deux pièces romprait ce couplage — le QR ou le numéro de l'une
    //    pointerait vers l'autre.
    const reportVerification = await this.buildVerification();
    const noteVerification = await this.buildVerification();
    const reportReference = await this.documents.reserveReference(GeneratedDocumentKind.OPERATION_REPORT);
    const noteReference = await this.documents.reserveReference(GeneratedDocumentKind.DELIVERY_NOTE);

    const reportData: OperationReportPdfData = {
      reference: reportReference,
      operationReference: op.reference,
      dealReference: op.deal.reference,
      clientLegalName: op.deal.client.legalName,
      productName: op.deal.product.name,
      transportMode: op.transportMode,
      originLocation: op.originLocation,
      destinationLocation: op.destinationLocation,
      plannedVolume: op.plannedVolume.toString(),
      uom: op.uom,
      actualLoadingDate: op.actualLoadingDate?.toISOString() ?? null,
      actualDischargeDate: op.actualDischargeDate?.toISOString() ?? null,
      fieldAgentName: op.fieldAgent?.fullName ?? null,
      checks,
      incidents,
      verifyUrl: reportVerification.url,
      qrDataUri: reportVerification.qrDataUri,
    };

    const measurement = op.measurements[0];
    const noteData: DeliveryNotePdfData = {
      reference: noteReference,
      operationReference: op.reference,
      dealReference: op.deal.reference,
      clientLegalName: op.deal.client.legalName,
      clientTaxpayerAccountNumber: op.deal.client.taxpayerAccountNumber,
      productName: op.deal.product.name,
      transportMode: op.transportMode,
      originLocation: op.originLocation,
      destinationLocation: op.destinationLocation,
      plannedVolume: op.plannedVolume.toString(),
      uom: op.uom,
      deliveredVolume: measurement?.dischargedVolume15?.toString() ?? op.plannedVolume.toString(),
      isDeliveredVolumeAuthoritative: Boolean(measurement),
      actualLoadingDate: op.actualLoadingDate?.toISOString() ?? null,
      actualDischargeDate: op.actualDischargeDate?.toISOString() ?? null,
      fieldAgentName: op.fieldAgent?.fullName ?? null,
      carrierName: op.assignment?.carrier?.legalName ?? null,
      vehicleRegistration: op.assignment?.vehicle?.registration ?? null,
      vehicleIdentifier: op.assignment?.vehicleIdentifier ?? null,
      driverName: op.assignment?.driver?.fullName ?? null,
      verifyUrl: noteVerification.url,
      qrDataUri: noteVerification.qrDataUri,
    };

    const reportHtml = renderOperationReportHtml(reportData);
    const reportPdf = await this.renderer.renderPdf(reportHtml);
    const reportStored = await this.storage.put(reportPdf, 'application/pdf');
    const reportRegistered = await this.documents.register(
      { kind: GeneratedDocumentKind.OPERATION_REPORT, operationId },
      { type: ActorType.FIELD_USER, id: fieldUserId },
      reportStored,
      reportVerification.token,
      reportReference,
    );

    const noteHtml = renderDeliveryNoteHtml(noteData);
    const notePdf = await this.renderer.renderPdf(noteHtml);
    const noteStored = await this.storage.put(notePdf, 'application/pdf');
    const noteRegistered = await this.documents.register(
      { kind: GeneratedDocumentKind.DELIVERY_NOTE, operationId },
      { type: ActorType.FIELD_USER, id: fieldUserId },
      noteStored,
      noteVerification.token,
      noteReference,
    );

    this.logger.log(
      `Clôture terrain : ${reportRegistered.reference} et ${noteRegistered.reference} générés pour l'opération ${op.reference}, en attente de signature.`,
    );

    return {
      operationReport: { documentId: reportRegistered.id, reference: reportRegistered.reference },
      deliveryNote: { documentId: noteRegistered.id, reference: noteRegistered.reference },
    };
  }

  /**
   * ⚠️ TOLÉRANTE À UN FICHIER MANQUANT — UNE PHOTO ABSENTE NE DOIT PAS
   *    BLOQUER LA CLÔTURE DE L'OPÉRATION ENTIÈRE.
   *
   *    `DocumentsService.download()` traite déjà ce cas ailleurs comme un
   *    incident normal à signaler, pas une exception à laisser remonter :
   *    « la ligne existe, le fichier non ». Ici, une lecture non protégée
   *    ferait échouer TOUTE la génération — rapport ET bon de livraison — sur
   *    une seule pièce corrompue ou perdue. BullMQ retenterait trois fois,
   *    pour le même échec à chaque essai : l'opération resterait bloquée
   *    indéfiniment, sans qu'aucune intervention manuelle ne puisse la
   *    débloquer autrement qu'en réparant le stockage.
   *
   *    Le rapport se génère donc SANS la photo manquante plutôt que pas du
   *    tout. L'absence est journalisée côté serveur pour investigation — elle
   *    ne l'est pas encore sur le PDF lui-même, qui ne distingue pas
   *    aujourd'hui « aucune photo prise » de « une photo attendue a disparu
   *    du stockage ».
   */
  private async photosOf(
    attachments: { storageKey: string; mimeType: string; caption: string | null }[],
  ): Promise<OperationReportPhotoData[]> {
    const resultats = await Promise.allSettled(
      attachments.map(async (a) => ({
        captionOrKind: a.caption ?? 'Photo',
        dataUri: await this.toDataUri(a.storageKey, a.mimeType),
      })),
    );

    const photos: OperationReportPhotoData[] = [];
    for (let i = 0; i < resultats.length; i += 1) {
      const r = resultats[i];
      if (r.status === 'fulfilled') {
        photos.push(r.value);
      } else {
        this.logger.error(
          `Photo introuvable dans le stockage (${attachments[i].storageKey}) — rapport généré sans elle.`,
          r.reason as Error,
        );
      }
    }
    return photos;
  }
}

