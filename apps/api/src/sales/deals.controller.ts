import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ActorType,
  AuditAction,
  CommercialSegment,
  ContractStatus,
  CostBasis,
  DealStatus,
  DiscountMode,
  Prisma,
  TransportMode,
  UnitOfMeasure,
  UserRole,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { Realm, RequireRealm, Roles, Screen } from '../common/auth/realm';
import { SettingsService } from '../common/config/settings.service';
import { Page, PaginationQuery, paginate } from '../common/http/pagination.dto';
import { PrismaService } from '../common/prisma/prisma.service';
import { ReferenceService } from '../common/reference/reference.service';
import { MarginService } from './margin.service';
import { round4 } from '../common/money/money';

// ===========================================================================
//  DTO
// ===========================================================================

class CreateDealDto {
  @IsOptional() @IsUUID() contractId?: string;
  @IsUUID() clientId!: string;
  @IsOptional() @IsUUID() siteId?: string;
  @IsUUID() productId!: string;

  @IsEnum(CommercialSegment) segment!: CommercialSegment;

  /**
   * Absents pour un produit SERVICE (ex. barge) : validés ci-dessous, dans
   * `create()`, où le produit réel est connu — un décorateur déclaratif ne
   * peut pas conditionner un champ à une table qu'il ne voit pas.
   */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.000001) contractedVolume?: number;
  @IsOptional() @IsEnum(UnitOfMeasure) uom?: UnitOfMeasure;
  @IsOptional() @IsEnum(TransportMode) transportMode?: TransportMode;

  @IsString() @MaxLength(200) deliveryLocation!: string;
  @IsOptional() @IsISO8601() targetDeliveryDate?: string;

  @IsString() @Length(3, 3) currencyCode!: string;

  /** Prix de vente — SAISI. Il peut évoluer jusqu'à la facturation. */
  @Type(() => Number) @IsNumber() @Min(0) unitSalePrice!: number;

  /**
   * Le prix d'achat n'est pas saisi : il provient d'un prix fournisseur
   * validé par le DG. On ne transmet que sa référence (§ 5.4).
   */
  @IsOptional() @IsUUID() supplierPriceId?: string;

  @IsOptional() @IsEnum(DiscountMode) discountMode?: DiscountMode;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discountValue?: number;

  /**
   * COÛTS AFFÉRENTS À L'AFFAIRE, chiffrés dès la construction du devis.
   *
   * Sans eux, la marge annoncée à l'approbation ignore le transport, la
   * manutention et l'inspection : elle est surévaluée du montant exact de ce
   * qu'on a omis, et le CFO approuve sur un chiffre qui n'a jamais existé.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DealCostLineDto)
  costLines?: DealCostLineDto[];
}

/**
 * Ligne de coût chiffrée par le commercial.
 *
 * Le poste vient du référentiel : on ne saisit pas un intitulé libre, sinon le
 * rapprochement avec les factures fournisseurs et l'analyse par nature
 * deviennent impossibles.
 */
class DealCostLineDto {
  @IsUUID() costPostId!: string;

  /**
   * Base de saisie. Elle vient du BARÈME et n'est pas un choix du commercial :
   * un transport se négocie au litre, une manutention à la rotation, et c'est
   * le paramétrage qui l'a tranché une fois pour toutes.
   *
   * Transmise uniquement pour un poste sans barème — sinon celle du barème
   * prime, quoi que l'appelant envoie.
   */
  @IsOptional() @IsEnum(CostBasis) basis?: CostBasis;

  /** Ce qui est retenu, dans la base du barème. Le total en est dérivé. */
  @Type(() => Number) @IsNumber() @Min(0) amount!: number;

  @IsOptional() @IsString() @MaxLength(255) description?: string;

  /**
   * Fournisseur pressenti — facultatif, SAUF pour le poste TRANSPORT dès
   * qu'un montant y est engagé : la base y exige alors un tiers de type
   * transporteur (`trg_deal_transport_tariff`, § 5.4). C'est ici que le
   * transporteur d'une affaire se choisit désormais, plus à l'affectation
   * des moyens.
   */
  @IsOptional() @IsUUID() supplierId?: string;

  /**
   * Exigé dès que l'écart au barème dépasse la tolérance — et, pour le poste
   * TRANSPORT, dès que l'écart au tarif négocié du transporteur la dépasse
   * aussi (un seul champ, un seul motif à lire pour les deux vérifications).
   */
  @IsOptional() @IsString() @MaxLength(500) varianceReason?: string;
}

/**
 * Rattachement d'un prix fournisseur à l'affaire.
 *
 * Le commercial choisit un FOURNISSEUR — donc son prix validé. Il peut retenir
 * un montant différent dans la bande de tolérance ; au-delà, motif obligatoire
 * et dérogation du DG pour approuver (§ 5.4).
 */
class AttachSupplierPriceDto {
  @IsUUID() supplierPriceId!: string;

  /**
   * Prix réellement retenu. À défaut, celui du fournisseur — c'est le cas
   * normal, et il doit être le geste par défaut.
   */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) unitPurchasePrice?: number;

  @IsOptional() @IsString() @MaxLength(500) varianceReason?: string;
}

class ApproveDealDto {
  /** Dérogation obligatoire lorsque la marge directe est sous le plancher. */
  @IsOptional() @IsUUID() marginDerogationId?: string;

  /**
   * Dérogation obligatoire lorsque le prix d'achat sort de la bande (§ 5.4).
   *
   * ⚠️ ELLE MANQUAIT, ET C'ÉTAIT UNE IMPASSE. La base exige une dérogation de
   *    type PURCHASE_PRICE_VARIANCE pour approuver hors bande, et AUCUN chemin
   *    applicatif ne permettait de la rattacher : une affaire dans ce cas
   *    n'était plus approuvable, définitivement. La règle était écrite,
   *    documentée, et impossible à exercer.
   */
  @IsOptional() @IsUUID() purchasePriceDerogationId?: string;

  /**
   * Dérogation du DG autorisant l'approbation au-delà du plafond de crédit
   * du client (§ 9.1).
   */
  @IsOptional() @IsUUID() creditDerogationId?: string;

  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

class DealQuery extends PaginationQuery {
  @IsOptional() @IsEnum(DealStatus) status?: DealStatus;
  @IsOptional() @IsEnum(CommercialSegment) segment?: CommercialSegment;
}

// ===========================================================================
//  Service
// ===========================================================================

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly margin: MarginService,
    private readonly audit: AuditService,
    private readonly reference: ReferenceService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Contrats-cadres — pour renseigner le rattachement optionnel à la
   * création d'une affaire.
   *
   * ⚠️ NE PASSE PAS PAR LE REGISTRE DE RÉFÉRENTIELS.
   *
   *    La lecture générique (`/referentials/contracts`) dérive ses rôles de
   *    qui peut ÉCRIRE le référentiel — SALES_REP n'y figure pas, et c'est
   *    volontaire (§ commentaire de `rolesDeLecture`, fuite déjà corrigée une
   *    fois). Un commercial doit pourtant pouvoir choisir le contrat-cadre de
   *    l'affaire qu'il crée : plutôt que d'élargir ce mécanisme partagé par
   *    vingt-huit référentiels pour un seul besoin, cette lecture est dédiée
   *    et réduite au strict nécessaire — sans les conditions commerciales
   *    complètes que la fiche contrat porte par ailleurs.
   */
  contractsPourCreation() {
    return this.prisma.contract.findMany({
      where: { status: ContractStatus.ACTIVE },
      select: { id: true, reference: true, title: true, clientId: true, segment: true, currencyCode: true },
      orderBy: { reference: 'asc' },
    });
  }

  /**
   * Barème applicable à un poste, dans le contexte de l'affaire.
   *
   * La résolution est faite EN BASE (`resolve_cost_standard`) : la refaire ici
   * la ferait diverger de la règle réellement appliquée le jour où l'une des
   * deux bouge.
   */
  private async resolveStandard(
    costPostId: string,
    deal: { segment: string; transportMode: string | null; productId: string },
  ) {
    const rows = await this.prisma.$queryRaw<
      Array<{ basis: string; amount: Prisma.Decimal; uom: string | null; tolerance_pct: Prisma.Decimal | null }>
    >`SELECT basis, amount, tolerance_pct
        FROM resolve_cost_standard(${costPostId}::uuid, ${deal.segment}::text,
                                   ${deal.transportMode}::text, ${deal.productId}::uuid,
                                   CURRENT_DATE)`;
    const r = rows[0];
    if (!r) return null;
    return {
      basis: r.basis as CostBasis,
      amount: Number(r.amount),
      uom: r.uom,
      tolerancePct: r.tolerance_pct === null ? null : Number(r.tolerance_pct),
    };
  }

  /**
   * Barème applicable à CHAQUE poste direct, dans le contexte de l'affaire.
   *
   * Sert à orienter le commercial AVANT qu'il ne saisisse : afficher la valeur
   * de référence après coup ne guide personne. C'est aussi ce qui permet de
   * pré-remplir — conserver la proposition doit être le geste par défaut.
   */
  async costGuidance(dealId: string) {
    const deal = await this.prisma.deal.findUniqueOrThrow({
      where: { id: dealId },
      select: {
        segment: true,
        transportMode: true,
        productId: true,
        currencyCode: true,
        contractedVolume: true,
      },
    });

    const posts = await this.prisma.costPost.findMany({
      where: { isActive: true, nature: 'DIRECT', isSystemComputed: false },
      orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
      select: { id: true, code: true, label: true },
    });

    const volume = Number(deal.contractedVolume);
    const guidance = await Promise.all(
      posts.map(async (post) => {
        const standard = await this.resolveStandard(post.id, deal);
        return {
          costPostId: post.id,
          code: post.code,
          label: post.label,
          // Sans barème, la base reste au choix : le poste n'a jamais été tarifé.
          basis: standard?.basis ?? null,
          amount: standard?.amount ?? null,
          uom: standard?.uom ?? null,
          tolerancePct: standard?.tolerancePct ?? null,
          /** Total que produirait la valeur du barème, pour lecture directe. */
          standardTotal:
            standard === null
              ? null
              : standard.basis === CostBasis.PER_UNIT
                ? round4(standard.amount * volume)
                : standard.amount,
        };
      }),
    );

    return { currencyCode: deal.currencyCode, contractedVolume: volume, postes: guidance };
  }

  /**
   * Tarifs proposés AVANT de retenir un transporteur, pour le poste
   * TRANSPORT du chiffrage (§ 5.4).
   *
   * Ajouté le 22/08/2026 : le transporteur se choisit désormais au
   * chiffrage, jamais à l'affectation des moyens (qui n'existe pas encore à
   * ce stade) — c'est ici, et seulement ici, que la comparaison au tarif
   * négocié a un sens. Rendu POUR CHAQUE TRANSPORTEUR conforme, avec son
   * tarif s'il en a un, sur le même principe que `costGuidance` : afficher
   * l'écart après coup ne guide personne.
   *
   * ⚠️ ORIGINE NULLE, ASSUMÉE : l'affaire ne connaît que la destination
   *    (`site_id`). Le dépôt d'origine est une décision de sourcing qui
   *    n'existe qu'à l'opération — voir `20_tarif_transporteur.sql`. Un
   *    tarif nommant une origine précise ne peut donc jamais ressortir ici.
   */
  async carrierGuidance(dealId: string) {
    const deal = await this.prisma.deal.findUniqueOrThrow({
      where: { id: dealId },
      select: { transportMode: true, productId: true, siteId: true, contractedVolume: true },
    });

    const transporteurs = await this.prisma.partner.findMany({
      where: { type: 'CARRIER', isActive: true },
      orderBy: { legalName: 'asc' },
      select: { id: true, code: true, legalName: true },
    });

    const volume = Number(deal.contractedVolume);

    return Promise.all(
      transporteurs.map(async (t) => {
        const [tarif] = await this.prisma.$queryRaw<
          {
            tariff_id: string;
            basis: string;
            amount: string;
            currency_code: string;
            uom: string | null;
            tolerance_pct: string | null;
          }[]
        >`SELECT * FROM resolve_carrier_tariff(
            ${t.id}::uuid, ${deal.transportMode}::text, ${deal.productId}::uuid,
            NULL::uuid, ${deal.siteId ?? null}::uuid, CURRENT_DATE)`;

        // Conformité du moyen : un transporteur non conforme ne s'affecte pas
        // sans dérogation, et le savoir AVANT de le choisir évite un aller-retour.
        const [conformite] = await this.prisma.$queryRaw<{ is_compliant: boolean }[]>`
          SELECT is_compliant FROM v_transport_compliance
           WHERE subject_kind = 'CARRIER' AND subject_id = ${t.id}::uuid`;

        if (!tarif) {
          return {
            carrierId: t.id,
            code: t.code,
            name: t.legalName,
            isCompliant: conformite?.is_compliant ?? true,
            // Pas de grille : ce n'est pas bloquant — il faut pouvoir chiffrer
            // avec un transporteur d'appoint un jour de rupture — mais ça se
            // voit, et la grille doit être complétée.
            tariff: null,
          };
        }

        const montant =
          tarif.basis === 'PER_UNIT' ? Number(tarif.amount) * volume : Number(tarif.amount);

        return {
          carrierId: t.id,
          code: t.code,
          name: t.legalName,
          isCompliant: conformite?.is_compliant ?? true,
          tariff: {
            id: tarif.tariff_id,
            basis: tarif.basis,
            unitAmount: Number(tarif.amount),
            uom: tarif.uom,
            currencyCode: tarif.currency_code,
            // Ce que le tarif donne POUR CETTE AFFAIRE : c'est le chiffre que
            // le commercial doit comparer, pas le tarif unitaire.
            expectedAmount: round4(montant),
            tolerancePct: tarif.tolerance_pct === null ? 0 : Number(tarif.tolerance_pct),
          },
        };
      }),
    );
  }

  /**
   * Traduit une ligne saisie en ligne stockée.
   *
   * Le TOTAL est dérivé de la base : forfait tel quel, ou valeur unitaire
   * multipliée par le volume contracté. La valeur du barème est figée au
   * même instant — une grille révisée ensuite ne doit pas requalifier
   * rétroactivement un écart déjà justifié.
   */
  private async materialise(
    line: DealCostLineDto,
    deal: { segment: string; transportMode: string | null; productId: string; currencyCode: string },
    volume: number,
  ) {
    const standard = await this.resolveStandard(line.costPostId, deal);

    // LA BASE VIENT DU BARÈME quand il existe. Laisser l'appelant la choisir
    // permettrait de saisir 30 « en forfait » sur un poste tarifé au litre :
    // le total tomberait à 30 au lieu de 900 000, et la marge deviendrait
    // fantaisiste sans qu'aucune règle ne soit violée.
    const basis = standard?.basis ?? line.basis ?? CostBasis.FIXED;
    const total = basis === CostBasis.PER_UNIT ? round4(line.amount * volume) : line.amount;

    // Le barème est ramené au même référentiel que la saisie : on compare
    // deux totaux, jamais un total à une valeur unitaire.
    const standardTotal =
      standard === null
        ? null
        : standard.basis === CostBasis.PER_UNIT
          ? round4(standard.amount * volume)
          : standard.amount;

    return {
      costPostId: line.costPostId,
      description: line.description ?? null,
      supplierId: line.supplierId ?? null,
      basis,
      inputAmount: line.amount.toFixed(4),
      estimatedAmount: total.toFixed(4),
      standardAmount: standardTotal === null ? null : standardTotal.toFixed(4),
      standardBasis: standard?.basis ?? null,
      standardTolerancePct: standard?.tolerancePct?.toFixed(3) ?? null,
      varianceReason: line.varianceReason ?? null,
      currencyCode: deal.currencyCode,
    };
  }

  /**
   * Prix fournisseurs mobilisables pour cette affaire.
   *
   * Ne sont rendus que les prix VALIDÉS PAR LE DG, portant le bon produit et
   * en vigueur à ce jour. C'est la traduction à l'écran de l'invariant : le
   * prix d'achat ne se saisit pas librement, il se CHOISIT parmi ceux-là.
   *
   * Le délai fournisseur accompagne chaque ligne : il détermine le coût de
   * portage, et deux fournisseurs au même prix ne coûtent pas la même chose
   * si l'un est payé d'avance et l'autre à trente jours.
   */
  async supplierPrices(dealId: string) {
    const deal = await this.prisma.deal.findUniqueOrThrow({
      where: { id: dealId },
      select: {
        productId: true,
        currencyCode: true,
        uom: true,
        unitPurchasePrice: true,
        supplierPriceId: true,
        client: { select: { paymentTermsDays: true } },
      },
    });

    const today = new Date();
    const prices = await this.prisma.supplierPrice.findMany({
      where: {
        productId: deal.productId,
        validatedAt: { not: null },
        // Une version désactivée n'est jamais proposée pour une affaire
        // nouvelle — voir le commentaire du champ dans le schéma.
        isActive: true,
        effectiveFrom: { lte: today },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
      },
      orderBy: [{ unitPrice: 'asc' }],
      include: {
        supplier: { select: { id: true, code: true, legalName: true, supplierTermsDays: true } },
        validatedBy: { select: { fullName: true, role: true } },
      },
    });

    const [band, rate, daysPerYear] = await Promise.all([
      this.settings.number('PURCHASE_PRICE_BAND_PCT', 3),
      this.settings.number('FINANCING_RATE_ANNUAL_PCT', 10),
      this.settings.number('CARRYING_DAYS_PER_YEAR', 360),
    ]);

    return {
      currencyCode: deal.currencyCode,
      uom: deal.uom,
      bandPct: band,
      selectedSupplierPriceId: deal.supplierPriceId,
      retainedUnitPrice: Number(deal.unitPurchasePrice),
      prix: prices.map((sp) => {
        const unit = Number(sp.unitPrice);
        // Le portage dépend du fournisseur : un prépaiement allonge le cycle.
        // Le calcul est DÉLÉGUÉ au service de marge, seule implémentation de
        // la formule : réécrite ici, elle divergeait du chiffre affiché sur
        // l'affaire dès que la base annuelle ou le cycle changeaient de règle.
        const carrying = this.margin.computeCarryingCost(
          unit,
          deal.client.paymentTermsDays,
          sp.supplier.supplierTermsDays,
          rate,
          daysPerYear,
        );
        return {
          supplierPriceId: sp.id,
          supplierId: sp.supplier.id,
          supplierCode: sp.supplier.code,
          supplierName: sp.supplier.legalName,
          unitPrice: unit,
          currencyCode: sp.currencyCode,
          uom: sp.uom,
          sourceLabel: sp.sourceLabel,
          effectiveFrom: sp.effectiveFrom,
          supplierTermsDays: sp.supplier.supplierTermsDays,
          validatedBy: sp.validatedBy?.fullName ?? null,
          version: sp.version,
          isActive: sp.isActive,
          /** Bornes dans lesquelles le prix retenu ne demande aucun motif. */
          bandMin: round4(unit * (1 - band / 100)),
          bandMax: round4(unit * (1 + band / 100)),
          /** Portage induit, pour comparer deux fournisseurs à leur coût réel. */
          carryingPerUnit: carrying.perUnit,
          carryingCycleDays: carrying.cycleDays,
        };
      }),
    };
  }

  /**
   * Rattache un prix fournisseur à l'affaire.
   *
   * Le prix retenu vaut par défaut celui du fournisseur. Les cinq règles déjà
   * écrites s'appliquent toutes, en base : validation par le DG, immuabilité
   * du prix validé, cohérence du produit, bande de tolérance, et retrait de
   * l'approbation en cas de modification ultérieure.
   */
  async attachSupplierPrice(
    id: string,
    dto: AttachSupplierPriceDto,
    actorId: string,
    role?: UserRole,
  ) {
    const sp = await this.prisma.supplierPrice.findUniqueOrThrow({
      where: { id: dto.supplierPriceId },
      select: { unitPrice: true, supplier: { select: { legalName: true } } },
    });

    const deal = await this.prisma.deal.findUniqueOrThrow({
      where: { id },
      select: { contractedVolume: true, ownerId: true, status: true },
    });
    DealsService.verifierPropriete(role, actorId, deal.ownerId);
    DealsService.verifierModifiable(deal.status);
    const retained = dto.unitPurchasePrice ?? Number(sp.unitPrice);

    await this.prisma.deal.update({
      where: { id },
      data: {
        supplierPriceId: dto.supplierPriceId,
        unitPurchasePrice: retained.toFixed(4),
        purchaseAmount: round4(retained * Number(deal.contractedVolume)).toFixed(4),
        purchasePriceVarianceReason: dto.varianceReason ?? null,
      },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.UPDATE,
      entityType: 'DealSupplierPrice',
      entityId: id,
      after: {
        fournisseur: sp.supplier.legalName,
        prixValide: Number(sp.unitPrice),
        prixRetenu: retained,
        motif: dto.varianceReason ?? null,
      },
    });

    return this.recomputeMargins(id);
  }

  /**
   * ⚠️ DEUX RÈGLES DE CONFIDENTIALITÉ, POSÉES ICI ET NULLE PART AILLEURS.
   *
   *    Elles étaient absentes toutes les deux, et c'est le dirigeant qui les a
   *    tranchées : « un commercial ne voit que ses propres affaires, et un
   *    coordinateur logistique ne voit pas les marges ».
   *
   *    Elles vivent au même endroit à dessein. Placées d'un côté dans la liste
   *    et de l'autre dans le détail, elles auraient fini par diverger — et le
   *    détail est justement le chemin qu'on emprunte en changeant un
   *    identifiant dans l'URL.
   */

  /** Un commercial ne voit que les affaires dont il est propriétaire. */
  private static filtrePropriete(role?: UserRole, actorId?: string) {
    return role === UserRole.SALES_REP && actorId ? { ownerId: actorId } : {};
  }

  /**
   * Même règle, posée une seule fois pour toute ROUTE D'ÉCRITURE.
   *
   * ⚠️ CORRIGÉ (audit, axe C, S1) — `setCostLines`, `attachSupplierPrice` et
   *    `submitForRisk` n'appliquaient PAS ce contrôle, contrairement à la
   *    lecture (`findOne`) qui le porte depuis le 08/08 : un commercial
   *    pouvait chiffrer les coûts, choisir le fournisseur ou soumettre au
   *    risque l'affaire d'un collègue, simplement en connaissant son
   *    identifiant. `filtrePropriete` protège la LISTE, ce contrôle protège
   *    l'ACCÈS DIRECT — les deux sont nécessaires, ni l'un ni l'autre ne
   *    suffit seul.
   */
  private static verifierPropriete(
    role: UserRole | undefined,
    actorId: string | undefined,
    ownerId: string | null,
    suite: string = 'n’agit que sur les siennes',
  ): void {
    if (role === UserRole.SALES_REP && actorId && ownerId !== actorId) {
      throw new ForbiddenException(`Cette affaire appartient à un autre commercial. Chacun ${suite}.`);
    }
  }

  /**
   * Une affaire soumise au contrôle du risque — ou au-delà — ne se modifie
   * plus. Seul le brouillon (DRAFT) reste ouvert au chiffrage : au-delà, la
   * marge qui a servi de base à la décision d'approbation ne doit plus
   * bouger sous les pieds de qui l'a validée.
   */
  private static verifierModifiable(status: DealStatus): void {
    if (status !== DealStatus.DRAFT) {
      throw new BadRequestException(
        `Cette affaire n'est plus au brouillon (statut : ${status}) : elle ne se modifie plus.`,
      );
    }
  }

  /**
   * Le coordinateur logistique ne voit ni marge ni prix d'achat.
   *
   * Retirer la marge en laissant le prix d'achat serait une passoire : la
   * marge s'en recalcule de tête. Le prix de VENTE reste visible — il faut
   * savoir ce qu'on transporte — mais il ne suffit pas à reconstituer la marge
   * sans les charges ni l'achat.
   */
  private static readonly CHAMPS_CONFIDENTIELS = [
    'unitPurchasePrice',
    'estimatedDirectMargin',
    'estimatedFullMargin',
    'realizedDirectMargin',
    'realizedFullMargin',
    'supplierPriceId',
  ] as const;

  private static voitLesMarges(role?: UserRole): boolean {
    return role !== UserRole.LOGISTICS_COORD;
  }

  private static masqueMarges<T extends Record<string, unknown>>(ligne: T): T {
    const copie = { ...ligne };
    for (const champ of DealsService.CHAMPS_CONFIDENTIELS) delete copie[champ];
    return copie;
  }

  async list(query: DealQuery, role?: UserRole, actorId?: string): Promise<Page<unknown>> {
    const where = {
      ...DealsService.filtrePropriete(role, actorId),
      ...(query.status ? { status: query.status } : {}),
      ...(query.segment ? { segment: query.segment } : {}),
      ...(query.search
        ? {
            OR: [
              { reference: { contains: query.search, mode: 'insensitive' as const } },
              { client: { legalName: { contains: query.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.deal.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          client: { select: { code: true, legalName: true } },
          product: { select: { code: true, name: true } },
          owner: { select: { fullName: true } },
          _count: { select: { operations: true, invoices: true } },
        },
      }),
      this.prisma.deal.count({ where }),
    ]);
    const visibles = DealsService.voitLesMarges(role)
      ? items
      : items.map((d) => DealsService.masqueMarges(d as Record<string, unknown>));
    return paginate(visibles, total, query);
  }

  /**
   * Vue détaillée : le deal, sa chaîne de marge recalculée, et le verdict.
   *
   * ⚠️ LE FILTRE DE LA LISTE NE PROTÈGE RIEN SANS CELUI-CI.
   *
   *    Restreindre la liste d'un commercial à ses propres affaires est
   *    cosmétique tant que le détail répond à n'importe quel identifiant : il
   *    suffit d'en changer un dans l'URL. C'est le défaut d'accès direct à
   *    l'objet, et il se corrige où l'objet est servi.
   */
  async findOne(id: string, role?: UserRole, actorId?: string) {
    const deal = await this.prisma.deal.findUniqueOrThrow({
      where: { id },
      include: {
        contract: { select: { reference: true, title: true } },
        client: { select: { code: true, legalName: true, paymentTermsDays: true, creditStatus: true } },
        site: { select: { name: true, city: true } },
        product: { select: { code: true, name: true } },
        owner: { select: { fullName: true, role: true } },
        supplierPrice: {
          include: {
            supplier: { select: { code: true, legalName: true, supplierTermsDays: true } },
            validatedBy: { select: { fullName: true, role: true } },
          },
        },
        creditApprovedBy: { select: { fullName: true, role: true } },
        dgApprovedBy: { select: { fullName: true, role: true } },
        marginDerogation: true,
        costLines: {
          include: {
            costPost: { select: { code: true, label: true, nature: true, variability: true } },
            supplier: { select: { code: true, legalName: true } },
          },
          orderBy: { costPost: { displayOrder: 'asc' } },
        },
        operations: { select: { id: true, reference: true, phase: true, plannedVolume: true } },
        invoices: {
          select: {
            id: true,
            number: true,
            type: true,
            status: true,
            totalAmount: true,
            currencyCode: true,
            generatedDocuments: {
              where: { isSealed: true },
              select: { id: true, reference: true },
              take: 1,
              orderBy: { generatedAt: 'desc' },
            },
          },
        },
        supplierInvoices: {
          select: {
            id: true,
            reference: true,
            status: true,
            amount: true,
            currencyCode: true,
            supplier: { select: { code: true, legalName: true } },
            prepaidAt: true,
            settledAt: true,
          },
        },
        statusTransitions: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });

    DealsService.verifierPropriete(role, actorId, deal.ownerId, 'ne consulte que les siennes');

    // Le coordinateur logistique reçoit l'affaire sans sa chaîne de marge : ni
    // le détail du calcul, ni le verdict de seuil, ni les lignes de coût — qui
    // reconstitueraient la marge à elles seules.
    if (!DealsService.voitLesMarges(role)) {
      // ⚠️ `supplierInvoices.amount` EST UN PRIX D'ACHAT — masqué au même
      //    titre que `costLines`/`supplierPrice` : le revenu (`invoices`) est
      //    déjà visible, un coût d'achat visible à côté livrerait la marge
      //    par simple soustraction, ce que ce filtre existe précisément pour
      //    empêcher (§ 5.4).
      const { costLines: _costLines, supplierPrice: _supplierPrice, supplierInvoices: _supplierInvoices, ...reste } = deal;
      return DealsService.masqueMarges(reste as Record<string, unknown>);
    }

    const breakdown = await this.margin.computeForDeal(id);
    const verdict = await this.margin.evaluateThresholds(
      deal.segment,
      deal.productId,
      deal.currencyCode,
      deal.uom,
      breakdown,
    );

    return { ...deal, margin: breakdown, thresholds: verdict };
  }

  async create(dto: CreateDealDto, actorId: string) {
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: dto.productId },
      select: { isService: true },
    });

    // ⚠️ UN PRODUIT SERVICE (barge) N'A NI TRANSPORT, NI VOLUME, NI UNITÉ.
    //
    //    Le volume contracté vaut 1 FORFAIT par convention plutôt que d'être
    //    NULL : la chaîne de marge est exprimée « par unité » partout ailleurs
    //    (§ MarginService), et 1 la rend triviale sans lui créer de cas
    //    particulier. Le prix unitaire porte donc directement le montant
    //    total de la prestation — « prix d'exploitation » à l'écran.
    //
    //    Pour un produit PHYSIQUE, ces trois champs restent obligatoires : le
    //    DTO ne peut plus les imposer par décorateur puisqu'ils dépendent du
    //    produit choisi, connu seulement ici.
    let contractedVolume: number;
    let uom: UnitOfMeasure;
    let transportMode: TransportMode | null;
    if (product.isService) {
      contractedVolume = 1;
      uom = UnitOfMeasure.FORFAIT;
      transportMode = null;
    } else {
      if (dto.contractedVolume === undefined || !dto.uom || !dto.transportMode) {
        throw new BadRequestException(
          'Volume, unité et mode de transport sont requis pour un produit physique.',
        );
      }
      contractedVolume = dto.contractedVolume;
      uom = dto.uom;
      transportMode = dto.transportMode;
    }

    // La sonde protège des références posées hors séquence — reprise de
    // données, jeu de démonstration, migration. Sans elle, la première
    // création réelle heurte l'existant et l'utilisateur reçoit un 409.
    const reference = await this.reference.monthly('DEAL', 3, new Date(), async (candidate) =>
      (await this.prisma.deal.count({ where: { reference: candidate } })) > 0,
    );

    // Le prix d'achat est repris du prix fournisseur, jamais transmis par
    // l'appelant : la base refuserait toute divergence.
    let unitPurchasePrice = 0;
    if (dto.supplierPriceId) {
      const sp = await this.prisma.supplierPrice.findUniqueOrThrow({
        where: { id: dto.supplierPriceId },
        select: { unitPrice: true },
      });
      unitPurchasePrice = Number(sp.unitPrice);
    }

    const costLines = await Promise.all(
      (dto.costLines ?? []).map((l) =>
        this.materialise(
          l,
          {
            segment: dto.segment,
            transportMode,
            productId: dto.productId,
            currencyCode: dto.currencyCode,
          },
          contractedVolume,
        ),
      ),
    );

    const discountAmount = computeDiscount(
      dto.unitSalePrice * contractedVolume,
      contractedVolume,
      dto.discountMode,
      dto.discountValue,
    );

    const created = await this.prisma.deal.create({
      data: {
        costLines: costLines.length ? { create: costLines } : undefined,
        reference,
        contractId: dto.contractId ?? null,
        clientId: dto.clientId,
        siteId: dto.siteId ?? null,
        productId: dto.productId,
        ownerId: actorId,
        status: DealStatus.DRAFT,
        segment: dto.segment,
        contractedVolume: contractedVolume.toFixed(6),
        uom,
        transportMode,
        deliveryLocation: dto.deliveryLocation,
        targetDeliveryDate: dto.targetDeliveryDate ? new Date(dto.targetDeliveryDate) : null,
        currencyCode: dto.currencyCode,
        unitSalePrice: dto.unitSalePrice.toFixed(4),
        saleAmount: (dto.unitSalePrice * contractedVolume).toFixed(4),
        supplierPriceId: dto.supplierPriceId ?? null,
        unitPurchasePrice: unitPurchasePrice.toFixed(4),
        purchaseAmount: (unitPurchasePrice * contractedVolume).toFixed(4),
        discountMode: dto.discountMode ?? null,
        discountValue: dto.discountValue?.toFixed(4) ?? null,
        discountAmount: discountAmount.toFixed(4),
      },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'Deal',
      entityId: created.id,
      after: created,
    });

    return this.recomputeMargins(created.id);
  }

  /**
   * Suppression d'un brouillon (§ discussion 15/08).
   *
   * ⚠️ RÉSERVÉE AU BROUILLON — ET C'EST TOUT L'INTÉRÊT.
   *
   *    Une affaire soumise a déjà pu engager une décision (risque, DG) ;
   *    la supprimer effacerait cette décision sans laisser de trace, alors
   *    que le reste du système tient à ce qu'aucune action n'y disparaisse
   *    sans preuve (§ 1.4). Un brouillon, lui, n'a encore rien engagé — le
   *    verrou qui l'empêche d'être MODIFIÉ passé DRAFT (`verifierModifiable`)
   *    interdit exactement les mêmes statuts ici, par la même règle.
   *
   *    Les lignes de coût du brouillon disparaissent avec lui (cascade) ; une
   *    opération ou une facture déjà rattachées bloquent la suppression au
   *    lieu d'être effacées en silence — cas qui ne devrait jamais se
   *    présenter sur un DRAFT, le verrou financier l'interdisant en amont,
   *    mais la base reste le dernier mot, pas cette hypothèse.
   */
  async remove(id: string, actorId: string, role?: UserRole): Promise<void> {
    const deal = await this.prisma.deal.findUniqueOrThrow({
      where: { id },
      select: { status: true, ownerId: true, reference: true },
    });
    DealsService.verifierPropriete(role, actorId, deal.ownerId, 'ne supprime que les siennes');
    DealsService.verifierModifiable(deal.status);

    await this.prisma.deal.delete({ where: { id } });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.DELETE,
      entityType: 'Deal',
      entityId: id,
      before: deal,
    });
  }

  /** Soumet l'affaire au contrôle du risque. */
  async submitForRisk(id: string, actorId: string, role?: UserRole) {
    const deal = await this.prisma.deal.findUniqueOrThrow({ where: { id }, select: { status: true, ownerId: true } });
    DealsService.verifierPropriete(role, actorId, deal.ownerId);
    DealsService.verifierModifiable(deal.status);
    await this.recomputeMargins(id);
    return this.transition(id, DealStatus.PENDING_RISK, actorId, 'Soumis au contrôle du risque', role);
  }

  /**
   * Approbation par le CFO.
   *
   * Les seuils ne sont PAS vérifiés ici : la base le fait au moment de
   * l'écriture. Dupliquer la règle côté application la rendrait affaiblissable
   * par un futur changement de code sans que personne ne s'en aperçoive.
   */
  async approve(id: string, dto: ApproveDealDto, actorId: string) {
    await this.recomputeMargins(id);

    const updated = await this.prisma.deal.update({
      where: { id },
      data: {
        creditApprovedById: actorId,
        creditApprovedAt: new Date(),
        marginDerogationId: dto.marginDerogationId ?? undefined,
        // Les trois dérogations que l'approbation peut invoquer. Chacune est
        // vérifiée EN BASE — type, statut, expiration, sujet : en fournir une
        // ne suffit pas, elle doit être opposable (§ 11.2).
        purchasePriceDerogationId: dto.purchasePriceDerogationId ?? undefined,
        creditDerogationId: dto.creditDerogationId ?? undefined,
        status: DealStatus.APPROVED,
      },
    });

    await this.prisma.dealStatusTransition.create({
      data: {
        dealId: id,
        toStatus: DealStatus.APPROVED,
        actorType: ActorType.INTERNAL_USER,
        actorId,
        reason: dto.note ?? 'Approbation financière',
      },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.APPROVE,
      entityType: 'Deal',
      entityId: id,
      after: { creditApprovedById: actorId, marginDerogationId: dto.marginDerogationId },
    });

    return updated;
  }

  /** Accord du DG sur une marge sous le seuil minimum. */
  async grantDgApproval(id: string, actorId: string, note?: string) {
    const updated = await this.prisma.deal.update({
      where: { id },
      data: { dgApprovedById: actorId, dgApprovedAt: new Date() },
    });
    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.APPROVE,
      entityType: 'DealMarginDerogation',
      entityId: id,
      after: { dgApprovedById: actorId, note },
    });
    return updated;
  }

  /**
   * Remplace le chiffrage des coûts d'une affaire.
   *
   * Volontairement un REMPLACEMENT et non un ajout : un devis se reprend en
   * entier. Empiler des lignes successives laisserait des reliquats invisibles
   * qui gonfleraient les charges sans que personne ne comprenne d'où.
   */
  async setCostLines(id: string, lines: DealCostLineDto[], actorId: string, role?: UserRole) {
    const deal = await this.prisma.deal.findUniqueOrThrow({
      where: { id },
      select: {
        currencyCode: true,
        segment: true,
        transportMode: true,
        productId: true,
        contractedVolume: true,
        ownerId: true,
        status: true,
      },
    });
    DealsService.verifierPropriete(role, actorId, deal.ownerId);
    DealsService.verifierModifiable(deal.status);

    const materialised = await Promise.all(
      lines.map((l) => this.materialise(l, deal, Number(deal.contractedVolume))),
    );

    await this.prisma.$transaction([
      this.prisma.dealCostLine.deleteMany({ where: { dealId: id, isSystemComputed: false } }),
      this.prisma.dealCostLine.createMany({
        data: materialised.map((l) => ({ dealId: id, ...l })),
      }),
    ]);

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.UPDATE,
      entityType: 'DealCostLines',
      entityId: id,
      after: { lignes: materialised.length, total: materialised.reduce((s, l) => s + Number(l.estimatedAmount), 0) },
    });

    return this.recomputeMargins(id);
  }

  /**
   * Recalcule et persiste la chaîne de marge.
   * Appelé avant toute décision : approuver sur des chiffres périmés n'aurait
   * aucun sens.
   */
  async recomputeMargins(id: string) {
    // Délégué au service de marge : c'est là que vit le calcul, et c'est là
    // que les lignes de coût d'opération peuvent le déclencher sans créer de
    // dépendance circulaire entre les deux services.
    return this.margin.recompute(id);
  }

  private async transition(id: string, to: DealStatus, actorId: string, reason: string, role?: UserRole) {
    const current = await this.prisma.deal.findUniqueOrThrow({ where: { id }, select: { status: true, ownerId: true } });
    DealsService.verifierPropriete(role, actorId, current.ownerId);
    const updated = await this.prisma.deal.update({ where: { id }, data: { status: to } });
    await this.prisma.dealStatusTransition.create({
      data: {
        dealId: id,
        fromStatus: current.status,
        toStatus: to,
        actorType: ActorType.INTERNAL_USER,
        actorId,
        reason,
      },
    });
    return updated;
  }
}

/** Une remise diminue le montant de vente — au litre, en pourcentage ou en montant. */
export function computeDiscount(
  grossAmount: number,
  volume: number,
  mode?: DiscountMode | null,
  value?: number | null,
): number {
  if (!mode || value == null) return 0;
  switch (mode) {
    case DiscountMode.PER_UNIT:
      return round4(value * volume);
    case DiscountMode.PERCENTAGE:
      return round4((grossAmount * value) / 100);
    case DiscountMode.FIXED_AMOUNT:
      return round4(value);
    default:
      return 0;
  }
}

// ===========================================================================
//  Contrôleur
// ===========================================================================

@Controller('api/internal/deals')
@RequireRealm(Realm.INTERNAL)
export class DealsController {
  constructor(private readonly service: DealsService) {}

  @Get()
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT, UserRole.LOGISTICS_COORD, UserRole.ASSISTANT_DG)
  @Screen('affaires')
  list(@Query() query: DealQuery, @Req() req: { auth: { role?: UserRole; sub: string } }) {
    return this.service.list(query, req.auth.role, req.auth.sub);
  }

  // Déclarée AVANT :id : sinon le routeur retient `:id` en premier et
  // "lookups" heurte le ParseUUIDPipe au lieu d'atteindre cette route.
  @Get('lookups/contracts')
  @Roles(UserRole.SALES_REP, UserRole.CCOO)
  contractsPourCreation() {
    return this.service.contractsPourCreation();
  }

  @Get(':id')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT, UserRole.LOGISTICS_COORD)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { auth: { role?: UserRole; sub: string } },
  ) {
    return this.service.findOne(id, req.auth.role, req.auth.sub);
  }

  @Post()
  @Roles(UserRole.SALES_REP, UserRole.CCOO)
  create(@Body() dto: CreateDealDto, @Req() req: { auth: { sub: string } }) {
    return this.service.create(dto, req.auth.sub);
  }

  @Delete(':id')
  @Roles(UserRole.SALES_REP, UserRole.CCOO)
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: { auth: { sub: string; role?: UserRole } }) {
    return this.service.remove(id, req.auth.sub, req.auth.role);
  }

  @Patch(':id/submit')
  @Roles(UserRole.SALES_REP, UserRole.CCOO)
  submit(@Param('id', ParseUUIDPipe) id: string, @Req() req: { auth: { sub: string; role?: UserRole } }) {
    return this.service.submitForRisk(id, req.auth.sub, req.auth.role);
  }

  /** Approbation financière — CFO, ou DG en dérogation. */
  @Patch(':id/approve')
  @Roles(UserRole.FINANCE_CFO, UserRole.DG)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveDealDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.approve(id, dto, req.auth.sub);
  }

  /** Accord du DG sur une marge sous le seuil minimum. */
  @Patch(':id/dg-approval')
  @Roles(UserRole.DG)
  dgApproval(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveDealDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.grantDgApproval(id, req.auth.sub, dto.note);
  }

  /** Prix fournisseurs validés et en vigueur pour le produit de l'affaire. */
  @Get(':id/supplier-prices')
  @Roles(UserRole.SALES_REP, UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.DG, UserRole.LOGISTICS_COORD)
  supplierPrices(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.supplierPrices(id);
  }

  /** Choix du fournisseur — c'est lui qui détermine le prix d'achat. */
  @Patch(':id/supplier-price')
  @Roles(UserRole.SALES_REP, UserRole.CCOO, UserRole.FINANCE_CFO)
  attachSupplierPrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttachSupplierPriceDto,
    @Req() req: { auth: { sub: string; role?: UserRole } },
  ) {
    return this.service.attachSupplierPrice(id, dto, req.auth.sub, req.auth.role);
  }

  /**
   * Barème applicable à chaque poste, dans le contexte de cette affaire.
   * Consommé par l'écran de chiffrage pour orienter AVANT la saisie.
   */
  @Get(':id/cost-guidance')
  @Roles(UserRole.SALES_REP, UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.DG)
  costGuidance(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.costGuidance(id);
  }

  /**
   * Tarifs proposés par transporteur, pour le poste TRANSPORT du chiffrage
   * (§ 5.4, revu le 22/08/2026 : le transporteur se choisit ici, plus à
   * l'affectation des moyens).
   */
  @Get(':id/carrier-guidance')
  @Roles(UserRole.SALES_REP, UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.DG)
  carrierGuidance(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.carrierGuidance(id);
  }

  /** Chiffrage des coûts — le commercial, tant que l'affaire n'est pas exécutée. */
  @Put(':id/cost-lines')
  @Roles(UserRole.SALES_REP, UserRole.CCOO, UserRole.FINANCE_CFO)
  setCostLines(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { costLines: DealCostLineDto[] },
    @Req() req: { auth: { sub: string; role?: UserRole } },
  ) {
    return this.service.setCostLines(id, dto.costLines ?? [], req.auth.sub, req.auth.role);
  }

  @Patch(':id/recompute')
  @Roles(UserRole.SALES_REP, UserRole.CCOO, UserRole.FINANCE_CFO)
  recompute(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.recomputeMargins(id);
  }
}
