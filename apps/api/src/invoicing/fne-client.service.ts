import { Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  AuditAction,
  FneStatus,
  Invoice,
  InvoicePaymentMethod,
  InvoiceType,
  Partner,
  PartnerContact,
} from '@prisma/client';
import { AuditService } from '../common/audit/audit.service';
import { SettingsService } from '../common/config/settings.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { round4 } from '../common/money/money';

/**
 * CLIENT DE L'API FNE (DGI, Côte d'Ivoire) — § 9.5.
 *
 * Référence : « Procédure d'interfaçage des entreprises par API », DGI,
 * mai 2025 (déposée le 15/08/2026). Deux points de terminaison utilisés :
 *
 *   POST /external/invoices/sign            certification d'une facture de vente
 *   POST /external/invoices/{id}/refund     certification d'un avoir
 *
 * ⚠️ TROIS HYPOTHÈSES DE MAPPING NE SONT PAS DANS LE DOCUMENT DGI — À
 *    CONFIRMER avant la première transmission réelle, cf. § 19 « Points
 *    ouverts » : le document ne dit rien de ces choix, ils sont déduits du
 *    modèle de données existant.
 *
 *    1. `template` (B2B/B2C/B2F) : déduit de la présence d'un NCC et du pays
 *       du client, faute d'un champ dédié sur `Partner`. Aucun cas ne produit
 *       B2G (institution gouvernementale) — à couvrir manuellement si un
 *       client de ce type apparaît.
 *    2. `paymentMethod` : déduit de `Partner.paymentTermsDays` (délai > 0 →
 *       « à terme », sinon « espèces »), faute d'un mode de paiement saisi
 *       sur la pièce.
 *    3. Code de TVA (TVA/TVAB/TVAC/TVAD) : déduit du taux et de la présence
 *       d'une référence d'exonération, faute d'un champ « régime FNE » dédié.
 *
 * ⚠️ NE BLOQUE JAMAIS L'ÉMISSION DE LA PIÈCE CHEZ ELYON. Une panne DGI, une
 *    clé absente ou une erreur de configuration laissent la transmission en
 *    `PENDING_TRANSMISSION` — reprise par `retry()` — plutôt que de faire
 *    échouer `InvoicesService.issue()`. La facture existe et engage
 *    juridiquement Elyon dès son émission (§ 9) ; sa certification fiscale
 *    est un fait distinct, pas une condition de son existence.
 */
@Injectable()
export class FneClientService {
  private readonly logger = new Logger(FneClientService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Tente la certification d'une facture de vente FNE. Best-effort. */
  async certifySale(invoiceId: string, actorId: string): Promise<void> {
    if (!(await this.settings.boolean('FISCAL_NORMALIZED_INVOICING', false))) return;

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        partner: { include: { contacts: { orderBy: { isPrimary: 'desc' } } } },
        deal: { include: { product: true } },
        issuedBy: { select: { fullName: true } },
      },
    });
    if (!invoice || invoice.type !== InvoiceType.FNE) return;

    const built = await this.buildSalePayload(invoice, invoice.partner, invoice.deal?.product?.name ?? invoice.number, invoice.issuedBy?.fullName);
    if (!built.ok) {
      await this.markUncertifiable(invoiceId, built.reason);
      return;
    }

    const endpoint = await this.endpoint('/external/invoices/sign');
    if (!endpoint.ok) {
      await this.markUncertifiable(invoiceId, endpoint.reason);
      return;
    }

    await this.prisma.fneTransmission.update({
      where: { invoiceId },
      data: { attemptCount: { increment: 1 }, requestPayload: built.body as object },
    });

    const result = await this.post(endpoint.url, endpoint.apiKey, built.body);

    if (result.ok) {
      await this.prisma.$transaction([
        this.prisma.fneTransmission.update({
          where: { invoiceId },
          data: {
            status: FneStatus.ACCEPTED,
            fiscalReference: result.payload.reference ?? null,
            fiscalQrPayload: result.payload.token ?? null,
            transmittedAt: new Date(),
            acceptedAt: new Date(),
            responsePayload: result.payload as object,
            rejectionCode: null,
            rejectionReason: null,
          },
        }),
        // Le code fiscal déclaré à la DGI est consigné sur la pièce elle-même,
        // pas seulement dans le transport JSON — `taxCode` existait en base
        // sans jamais être écrit.
        ...(invoice.taxCode === null
          ? [this.prisma.invoice.update({ where: { id: invoiceId }, data: { taxCode: built.taxCode } })]
          : []),
      ]);
      await this.audit.record({
        actorType: ActorType.INTERNAL_USER,
        actorId,
        action: AuditAction.STATUS_CHANGE,
        entityType: 'FneTransmission',
        entityId: invoiceId,
        after: { status: FneStatus.ACCEPTED, fiscalReference: result.payload.reference },
      });
      return;
    }

    await this.recordFailure(invoiceId, result);
  }

  /**
   * Tente la certification d'un avoir. Suppose que la pièce corrigée est une
   * FNE déjà ACCEPTED — un avoir DGI référence obligatoirement une facture
   * DGI existante (§ V.API#2 du document).
   *
   * Notre modèle de facture est mono-ligne : la quantité de l'article
   * d'origine à retourner est calculée au PRORATA du volume de l'avoir sur
   * le volume de la pièce corrigée, faute de lignes distinctes à l'un et
   * l'autre bout.
   */
  async certifyCreditNote(invoiceId: string, actorId: string): Promise<void> {
    if (!(await this.settings.boolean('FISCAL_NORMALIZED_INVOICING', false))) return;

    const creditNote = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!creditNote || creditNote.type !== InvoiceType.CREDIT_NOTE || !creditNote.correctedInvoiceId) return;

    const original = await this.prisma.invoice.findUnique({
      where: { id: creditNote.correctedInvoiceId },
      include: { fneTransmission: true },
    });

    if (!original || original.type !== InvoiceType.FNE || original.fneTransmission?.status !== FneStatus.ACCEPTED) {
      await this.markUncertifiable(
        invoiceId,
        'La pièce corrigée n’a pas de certification FNE acceptée : impossible d’émettre un avoir DGI dessus.',
      );
      return;
    }

    const dgiInvoice = (original.fneTransmission.responsePayload as { invoice?: { id?: string } } | null)
      ?.invoice as { id?: string; items?: Array<{ id?: string; quantity?: number }> } | undefined;
    const dgiItem = dgiInvoice?.items?.[0];
    if (!dgiInvoice?.id || !dgiItem?.id) {
      await this.markUncertifiable(
        invoiceId,
        'La réponse DGI de la pièce d’origine ne contient pas d’identifiant d’article exploitable pour l’avoir.',
      );
      return;
    }

    const ratio = Number(original.billedVolume) > 0 ? Number(creditNote.billedVolume) / Number(original.billedVolume) : 0;
    const quantity = Math.max(1, Math.round((dgiItem.quantity ?? 0) * ratio));

    const endpoint = await this.endpoint(`/external/invoices/${dgiInvoice.id}/refund`);
    if (!endpoint.ok) {
      await this.markUncertifiable(invoiceId, endpoint.reason);
      return;
    }

    const body = { items: [{ id: dgiItem.id, quantity }] };

    await this.prisma.fneTransmission.upsert({
      where: { invoiceId },
      update: { attemptCount: { increment: 1 }, requestPayload: body as object },
      create: { invoiceId, status: FneStatus.PENDING_TRANSMISSION, attemptCount: 1, requestPayload: body as object },
    });

    const result = await this.post(endpoint.url, endpoint.apiKey, body);

    if (result.ok) {
      await this.prisma.fneTransmission.update({
        where: { invoiceId },
        data: {
          status: FneStatus.ACCEPTED,
          fiscalReference: result.payload.reference ?? null,
          fiscalQrPayload: result.payload.token ?? null,
          transmittedAt: new Date(),
          acceptedAt: new Date(),
          responsePayload: result.payload as object,
          rejectionCode: null,
          rejectionReason: null,
        },
      });
      await this.audit.record({
        actorType: ActorType.INTERNAL_USER,
        actorId,
        action: AuditAction.STATUS_CHANGE,
        entityType: 'FneTransmission',
        entityId: invoiceId,
        after: { status: FneStatus.ACCEPTED, fiscalReference: result.payload.reference },
      });
      return;
    }

    await this.recordFailure(invoiceId, result);
  }

  /**
   * Reprise manuelle d'une transmission restée en attente ou à corriger —
   * la tâche `FNE_NON_TRANSMISE` (`22_file_de_taches.sql`) signale ces
   * pièces sans offrir jusqu'ici de moyen d'agir dessus.
   */
  async retry(invoiceId: string, actorId: string): Promise<void> {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { type: true },
    });
    if (invoice.type === InvoiceType.CREDIT_NOTE) {
      await this.certifyCreditNote(invoiceId, actorId);
    } else {
      await this.certifySale(invoiceId, actorId);
    }
  }

  // ---------------------------------------------------------------------
  //  Construction du corps de requête — API #1 (sign)
  // ---------------------------------------------------------------------

  private async buildSalePayload(
    invoice: Invoice,
    partner: (Partner & { contacts: PartnerContact[] }) | null,
    productLabel: string,
    sellerName: string | undefined,
  ): Promise<
    { ok: true; body: Record<string, unknown>; taxCode: string } | { ok: false; reason: string }
  > {
    if (!partner) return { ok: false, reason: 'Facture sans client rattaché.' };

    const contact = partner.contacts[0];
    if (!contact?.phone || !contact?.email) {
      return {
        ok: false,
        reason: `${partner.legalName} n’a pas de contact avec téléphone ET email : la DGI exige les deux.`,
      };
    }

    const fiscalCountry = await this.settings.string('FISCAL_COUNTRY', 'CI');
    // B2G d'abord : une institution publique domiciliée en CI porte souvent un
    // NCC, ce qui la ferait sinon tomber en B2B — c'est le statut, pas le NCC,
    // qui distingue les deux gabarits pour la DGI.
    const template = partner.isGovernmentInstitution
      ? 'B2G'
      : partner.countryCode && partner.countryCode !== fiscalCountry
        ? 'B2F'
        : partner.taxpayerAccountNumber
          ? 'B2B'
          : 'B2C';

    if (template === 'B2B' && !partner.taxpayerAccountNumber) {
      return { ok: false, reason: `${partner.legalName} n’a pas de NCC : requis pour une facture B2B.` };
    }

    const pointOfSale = await this.settings.string('FNE_POINT_OF_SALE', '');
    const establishment = await this.settings.string('FNE_ESTABLISHMENT', '');
    if (!pointOfSale || !establishment) {
      return {
        ok: false,
        reason: 'FNE_POINT_OF_SALE ou FNE_ESTABLISHMENT non paramétrés — voir l’espace FNE d’Elyon, onglet Paramétrage.',
      };
    }

    const ratePct = invoice.isVatApplicable ? Number(invoice.vatRatePct) : 0;
    // `Invoice.taxCode` existait en base sans jamais être lu ni écrit — un
    // code saisi explicitement (future correction manuelle) reste prioritaire
    // sur la déduction, au même titre que le taux de TVA en § create().
    //
    // ⚠️ AUCUN REPLI SUR TVAD. Le document DGI le réserve explicitement « pour
    //    TEE et RME » (Annexe 1) — des dispositifs de reçus, pas une case
    //    générique d'exonération légale. Une pièce non assujettie SANS
    //    référence d'exonération documente un flou fiscal réel : mieux vaut
    //    l'arrêter ici, avant transmission à la DGI, que deviner un code.
    if (!invoice.isVatApplicable && !invoice.vatExemptionReference && !invoice.taxCode) {
      return {
        ok: false,
        reason:
          'Pièce non assujettie à la TVA sans référence d’exonération ni code fiscal saisi : le code DGI applicable (TVAC/TVAD/autre) doit être confirmé — avec le conseil fiscal ou la DGI — avant transmission.',
      };
    }
    const taxCode =
      invoice.taxCode ?? (invoice.isVatApplicable ? (ratePct >= 13.5 ? 'TVA' : 'TVAB') : 'TVAC');

    // Le document DGI attend un prix et une remise HORS TAXE : la DGI calcule
    // elle-même la TVA à partir du code `taxes`. Nos montants sont TTC — voir
    // l'en-tête de fichier.
    const exclTax = (ttc: number) => (invoice.isVatApplicable ? round4(ttc / (1 + ratePct / 100)) : ttc);

    const unitPriceHt = exclTax(Number(invoice.unitPrice));
    const discountHt = exclTax(Number(invoice.discountAmount));

    if (!invoice.paymentMethod) {
      return {
        ok: false,
        reason: 'Mode de règlement non saisi sur la pièce : requis par la DGI (§ V.API#1).',
      };
    }
    const paymentMethod = DGI_PAYMENT_METHOD[invoice.paymentMethod];

    const localCurrency = await this.settings.string('LOCAL_CURRENCY', 'XOF');
    const usesForeignCurrency = invoice.documentCurrencyCode !== localCurrency;

    const body: Record<string, unknown> = {
      invoiceType: 'sale',
      paymentMethod,
      template,
      isRne: false,
      ...(template === 'B2B' ? { clientNcc: partner.taxpayerAccountNumber } : {}),
      clientCompanyName: partner.legalName,
      clientPhone: contact.phone,
      clientEmail: contact.email,
      ...(sellerName ? { clientSellerName: sellerName } : {}),
      pointOfSale,
      establishment,
      ...(usesForeignCurrency
        ? { foreignCurrency: invoice.documentCurrencyCode, foreignCurrencyRate: Number(invoice.documentFxRate) }
        : {}),
      items: [
        {
          taxes: [taxCode],
          customTaxes: [],
          reference: invoice.number,
          description: productLabel,
          quantity: Number(invoice.billedVolume),
          amount: unitPriceHt,
          discount: discountHt,
          measurementUnit: MEASUREMENT_UNIT[invoice.uom],
        },
      ],
    };

    return { ok: true, body, taxCode };
  }

  // ---------------------------------------------------------------------
  //  Transport
  // ---------------------------------------------------------------------

  private async endpoint(
    path: string,
  ): Promise<{ ok: true; url: string; apiKey: string } | { ok: false; reason: string }> {
    const baseUrl = await this.settings.string('FNE_API_BASE_URL', '');
    const apiKey = await this.settings.string('FNE_API_KEY', '');
    if (!baseUrl) return { ok: false, reason: 'FNE_API_BASE_URL non paramétré.' };
    if (!apiKey) {
      return { ok: false, reason: 'FNE_API_KEY absente — inscription DGI non terminée (procédure § III).' };
    }
    return { ok: true, url: `${baseUrl.replace(/\/+$/, '')}${path}`, apiKey };
  }

  private async post(
    url: string,
    apiKey: string,
    body: unknown,
  ): Promise<
    | { ok: true; payload: { reference?: string; token?: string; [k: string]: unknown } }
    | { ok: false; httpStatus: number | null; payload: unknown; error: string | null }
  > {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => null)) as
        | { reference?: string; token?: string; [k: string]: unknown }
        | null;
      if (res.ok && payload) return { ok: true, payload };
      return { ok: false, httpStatus: res.status, payload, error: null };
    } catch (e) {
      // Plateforme DGI injoignable — pas une réponse d'erreur, une absence de
      // réponse. Distingué du 400/401/500 pour ne pas classer une panne
      // réseau comme une pièce « à corriger ».
      this.logger.warn(`Plateforme FNE injoignable (${url}) : ${(e as Error).message}`);
      return { ok: false, httpStatus: null, payload: null, error: (e as Error).message };
    }
  }

  private async recordFailure(
    invoiceId: string,
    result: { ok: false; httpStatus: number | null; payload: unknown; error: string | null },
  ): Promise<void> {
    const payload = result.payload as { statusCode?: number; message?: string } | null;
    // 400 = pièce mal formée, à corriger avant tout nouvel essai. 401/500 et
    // les pannes réseau restent PENDING : rejouables sans rien changer à la
    // pièce, dès que la clé ou la plateforme sont rétablies.
    const status = result.httpStatus === 400 ? FneStatus.TO_CORRECT : FneStatus.PENDING_TRANSMISSION;

    await this.prisma.fneTransmission.update({
      where: { invoiceId },
      data: {
        status,
        responsePayload: (payload ?? { httpStatus: result.httpStatus }) as object,
        rejectionCode: payload?.statusCode ? String(payload.statusCode) : result.httpStatus ? String(result.httpStatus) : null,
        rejectionReason: payload?.message ?? result.error ?? `Réponse HTTP ${result.httpStatus ?? 'absente'}.`,
      },
    });
  }

  private async markUncertifiable(invoiceId: string, reason: string): Promise<void> {
    this.logger.warn(`Facture ${invoiceId} non transmissible à la FNE : ${reason}`);
    await this.prisma.fneTransmission.upsert({
      where: { invoiceId },
      update: { rejectionReason: reason },
      create: { invoiceId, status: FneStatus.PENDING_TRANSMISSION, rejectionReason: reason },
    });
  }
}

const MEASUREMENT_UNIT: Record<string, string> = {
  L: 'L',
  M3: 'm3',
  MT: 'mt',
  BBL: 'bbl',
};

const DGI_PAYMENT_METHOD: Record<InvoicePaymentMethod, string> = {
  CASH: 'cash',
  CARD: 'card',
  CHECK: 'check',
  MOBILE_MONEY: 'mobile-money',
  TRANSFER: 'transfer',
  DEFERRED: 'deferred',
};
