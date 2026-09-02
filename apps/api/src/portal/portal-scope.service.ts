import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, InvoiceType, QuotationRequestStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * ===========================================================================
 *  PÉRIMÈTRE DU PORTAIL CLIENT — DÉFINITION UNIQUE
 *  Réf. exploration de domaine (issue #1), ticket #3.
 *
 *  POURQUOI CE SERVICE EXISTE
 *  --------------------------
 *  Le filtre par tiers (`partnerId` du jeton) était répété à la main dans
 *  chaque méthode de `PortalService` — le même schéma que le terrain a
 *  abandonné après avoir vu son propre périmètre diverger trois fois avant
 *  d'être centralisé dans `FieldScopeService`. Le risque ici est réel : le
 *  champ de rattachement au tiers change de nom selon le modèle
 *  (`Invoice.partnerId`, mais `Deal.clientId`) — une nouvelle méthode qui
 *  écrirait `{ partnerId }` sur une requête `Deal` par réflexe ne
 *  filtrerait RIEN, silencieusement, et un client authentifié verrait les
 *  affaires de tous les autres.
 *
 *  ⚠️ NE PAS S'ARRÊTER AUX FRAGMENTS `WHERE`.
 *
 *     Une première version de ce service ne rendait que des fragments
 *     `where` : le risque de nom de champ était couvert, mais chaque
 *     appelant gardait sa propre requête et son propre message de refus —
 *     exactement la duplication que `FieldScopeService` évite en portant
 *     aussi la vérification ET le 404, avec un message UNIQUE. Les
 *     méthodes `assertX` ci-dessous font de même pour les deux vérifications
 *     qui ne servent qu'à trancher « est-ce le mien ? » : la richesse
 *     propre à chaque écran (`dealDetail`, `acceptDeal`) reste dans
 *     `PortalService`, mais partage au moins le même message de refus.
 * ===========================================================================
 */

export interface PortalActor {
  partnerId?: string;
}

/**
 * Message IDENTIQUE pour « n'existe pas » et « pas le vôtre » — la même
 * discipline que `FieldScopeService.INTROUVABLE` : distinguer les deux
 * indiquerait à qui cherche qu'un autre client est servi ce jour-là.
 */
const INTROUVABLE = 'Cette ressource ne figure pas dans vos données, ou n’existe pas.';

@Injectable()
export class PortalScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Le tiers du jeton — LE point de passage unique.
   *
   * Un jeton portail sans `partnerId` est une anomalie de délivrance, pas un
   * cas à couvrir silencieusement : mieux vaut un 400 franc ici qu'une
   * requête `WHERE partner_id = NULL` qui ne renverrait jamais rien.
   */
  partnerId(req: { auth: PortalActor }): string {
    if (!req.auth.partnerId) {
      throw new BadRequestException('Jeton portail sans tiers rattaché.');
    }
    return req.auth.partnerId;
  }

  /** Modèles rattachés au tiers par leur propre champ `partnerId` (QuotationRequest, Invoice). */
  wherePartner(partnerId: string): { partnerId: string } {
    return { partnerId };
  }

  /** `Deal` se rattache au tiers par `clientId`, pas `partnerId` — même périmètre, nom distinct. */
  whereDeal(partnerId: string): { clientId: string } {
    return { clientId: partnerId };
  }

  /** `Operation` ne porte pas le tiers directement : le périmètre remonte par son affaire. */
  whereOperationByDeal(partnerId: string): { deal: { clientId: string } } {
    return { deal: { clientId: partnerId } };
  }

  /** Pièce rattachée à une facture de ce tiers — transmis tel quel à `DocumentsService.download`. */
  whereInvoiceDocument(partnerId: string): { invoice: { partnerId: string } } {
    return { invoice: { partnerId } };
  }

  /** La demande de cotation appartient-elle à mon tiers ? Sinon : introuvable. */
  async assertQuotation(
    quotationId: string,
    partnerId: string,
  ): Promise<{ status: QuotationRequestStatus }> {
    const quotation = await this.prisma.quotationRequest.findFirst({
      where: { id: quotationId, ...this.wherePartner(partnerId) },
      select: { status: true },
    });
    if (!quotation) throw new NotFoundException(INTROUVABLE);
    return quotation;
  }

  /**
   * La proforma appartient-elle à mon tiers, rattachée à CETTE demande, et
   * reste-t-elle une pièce approuvable (émise, pas un brouillon) ?
   */
  async assertProformaInvoice(
    invoiceId: string,
    quotationId: string,
    partnerId: string,
  ): Promise<{ id: string; number: string | null }> {
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        quotationRequestId: quotationId,
        ...this.wherePartner(partnerId),
        type: InvoiceType.PROFORMA,
        status: { not: InvoiceStatus.DRAFT },
      },
      select: { id: true, number: true },
    });
    if (!invoice) throw new NotFoundException(INTROUVABLE);
    return invoice;
  }

  /** Le message de refus, pour les appelants qui gardent leur propre requête (select riche). */
  get introuvable(): string {
    return INTROUVABLE;
  }
}
