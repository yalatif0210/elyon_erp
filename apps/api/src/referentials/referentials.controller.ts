import {
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import { CommercialSegment, UserRole } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';
import { Realm, RequireRealm, Roles, SkipAudit } from '../common/auth/realm';
import { Page, PaginationQuery, paginate } from '../common/http/pagination.dto';
import { PrismaService } from '../common/prisma/prisma.service';
import { findReferential } from './registry';

/**
 * Lecture des référentiels du lot 1.
 *
 * Ces données sont administrées, peu volumineuses et très lues : elles
 * alimentent les listes déroulantes de toute l'application. Les écritures
 * relèvent de la console d'administration et sont traitées séparément, avec
 * les contrôles de rôle correspondants.
 */
@Injectable()
export class ReferentialsService {
  constructor(private readonly prisma: PrismaService) {}

  currencies() {
    return this.prisma.currency.findMany({
      where: { isActive: true },
      orderBy: [{ isPivot: 'desc' }, { isLocal: 'desc' }, { code: 'asc' }],
      select: {
        code: true,
        name: true,
        symbol: true,
        decimalPlaces: true,
        isPivot: true,
        isLocal: true,
        isFunctional: true,
        isDocumentEligible: true,
        pegCurrencyCode: true,
        pegRate: true,
      },
    });
  }

  products() {
    return this.prisma.product.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  /** Répertoire des postes de coûts — les deux axes, nature et variabilité. */
  costPosts() {
    return this.prisma.costPost.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
      include: { costPool: { select: { code: true, label: true, allocationBasis: true } } },
    });
  }

  /**
   * Types d'opération proposés à la création (§ 7.1).
   *
   * Le nombre de checklists rattachées est renvoyé avec chaque type : un type
   * qui n'en porte aucune n'apporte aucun contrôle, et celui qui compose le
   * déroulé doit pouvoir s'en apercevoir au moment où il choisit, pas au
   * moment où la checklist s'ouvre vide.
   */
  async operationTypes(segment?: CommercialSegment) {
    const rows = await this.prisma.operationType.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
      include: {
        _count: { select: { checklists: { where: { isActive: true, isCurrent: true } } } },
      },
    });

    // Une liste de segments VIDE vaut « tous » — la même convention que les
    // checklists. Filtrer sur l'appartenance stricte masquerait les types
    // génériques, c'est-à-dire la majorité.
    return rows
      .filter((t) => !segment || t.segments.length === 0 || t.segments.includes(segment))
      .map(({ _count, ...t }) => ({ ...t, checklistCount: _count.checklists }));
  }

  /**
   * Modèles de checklist HSE — servis pour ALIMENTER LES LISTES DE CHOIX.
   *
   * Sans cette lecture, le champ « Modèle de checklist » de l'écran de
   * paramétrage retombe en saisie libre et l'utilisateur doit deviner le code
   * exact : une faute de frappe rattache un point de contrôle à rien, et le
   * point n'est jamais opposé sur le terrain.
   */
  hseChecklists() {
    return this.prisma.hseChecklistTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ code: 'asc' }],
      select: {
        id: true,
        code: true,
        label: true,
        version: true,
        isCurrent: true,
        operationTypes: { select: { code: true, label: true } },
        _count: { select: { items: true } },
      },
    });
  }

  /**
   * Exigences d'un site de livraison — consultables partout où le site apparaît.
   *
   * Une seule lecture pour tous les écrans qui en ont besoin : préparation
   * d'opération, dossier d'opération, fiche de site sur la tablette. Deux
   * lectures finiraient par diverger, et c'est l'agent devant la barrière qui
   * en paierait le prix.
   */
  siteRequirements(siteId: string) {
    return this.prisma.siteRequirement.findMany({
      where: { siteId: siteId, isActive: true, type: { isActive: true } },
      orderBy: { type: { displayOrder: 'asc' } },
      select: {
        id: true,
        detail: true,
        isBlocking: true,
        type: { select: { code: true, label: true, description: true } },
      },
    });
  }

  /**
   * Sites, filtrés par USAGE.
   *
   * ⚠️ L'USAGE EST UNE DONNÉE DU LIEU, PAS UNE DÉDUCTION SUR SA NATURE.
   *
   *    Rien ici ne présume qu'une station-service ne charge pas, ni qu'un
   *    dépôt ne reçoit pas : c'est l'exploitant qui déclare, site par site, ce
   *    que le lieu sait faire. Une station-service EST un lieu de chargement
   *    dans ce métier — on y prend du produit pour dépanner un client, et le
   *    système ne doit pas en décider à la place de qui le sait.
   *
   *    Le filtre ne fait donc que refléter ce qui a été déclaré. Un lieu qui
   *    porte les deux usages apparaît dans les deux listes — c'est le cas que
   *    l'ancien modèle obligeait à dupliquer.
   */
  sites(usage?: 'LOADING' | 'DELIVERY') {
    return this.prisma.site.findMany({
      where: {
        isActive: true,
        ...(usage ? { usages: { has: usage as never } } : {}),
      },
      orderBy: [{ city: 'asc' }, { name: 'asc' }],
      select: {
        id: true, code: true, name: true, city: true, usages: true,
        accessInstructions: true, openingHours: true, safetyInstructions: true,
        defaultHseRiskLevel: true,
        requirements: {
          where: { isActive: true },
          orderBy: { type: { displayOrder: 'asc' } },
          select: {
            id: true, detail: true, isBlocking: true,
            type: { select: { code: true, label: true, description: true } },
          },
        },
      },
    });
  }

  /** Taux d'absorption courants — dénominateur budgété (§ 14.2). */
  absorptionRates(fiscalYear: number) {
    return this.prisma.absorptionRate.findMany({
      where: { fiscalYear, isCurrent: true },
      include: { costPool: { select: { code: true, label: true, allocationBasis: true, segments: true } } },
      orderBy: { costPool: { code: 'asc' } },
    });
  }

  /** Grille des seuils de marge — plancher direct et seuil minimum (§ 5.4). */
  marginThresholds() {
    return this.prisma.marginThreshold.findMany({
      where: { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
      orderBy: [{ segment: 'asc' }, { effectiveFrom: 'desc' }],
      include: { product: { select: { code: true, name: true } } },
    });
  }

  /** Grille de tolérance d'écart de volume (§ 8.3). */
  ullageTolerances() {
    return this.prisma.ullageTolerance.findMany({
      where: { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
      orderBy: { effectiveFrom: 'desc' },
      include: { product: { select: { code: true, name: true } } },
    });
  }

  /** Taux de change en vigueur, tous types confondus. */
  fxRates() {
    return this.prisma.fxRate.findMany({
      where: { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
      orderBy: [{ baseCurrencyCode: 'asc' }, { effectiveFrom: 'desc' }],
      take: 100,
    });
  }

  /** Prix administrés en vigueur — référence consultable (§ 5.3). */
  administeredPrices() {
    return this.prisma.administeredPrice.findMany({
      where: { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
      orderBy: [{ referenceType: 'asc' }, { effectiveFrom: 'desc' }],
      include: { product: { select: { code: true, name: true } } },
      take: 100,
    });
  }

  /**
   * Répertoire des tiers.
   *
   * ⚠️ Le PLAFOND et le STATUT de crédit ne sortent que pour les rôles qui y
   *    ont droit. Les autres ont besoin de la liste — pour choisir un client,
   *    un transporteur, un site — pas de son risque financier. Les retirer de
   *    la sélection plutôt que de refuser la route entière : le coordinateur
   *    logistique doit pouvoir choisir un transporteur.
   */
  async partners(
    query: PaginationQuery & { type?: string },
    role?: UserRole,
  ): Promise<Page<unknown>> {
    const voitLeCredit =
      role === UserRole.DG ||
      role === UserRole.FINANCE_CFO ||
      role === UserRole.ACCOUNTANT ||
      role === UserRole.CCOO;
    const where = {
      isActive: true,
      ...(query.type ? { type: query.type as never } : {}),
      ...(query.search
        ? {
            OR: [
              { legalName: { contains: query.search, mode: 'insensitive' as const } },
              { code: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.partner.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { legalName: 'asc' },
        // ⚠️ CE QUI SORT EST ÉNUMÉRÉ, ET LE RISQUE CRÉDIT EN EST ABSENT SAUF
        //    POUR QUI Y A DROIT.
        //
        //    La requête rendait le modèle ENTIER — plafond, statut et
        //    approbateur de crédit compris — à tout rôle interne, alors que la
        //    route dédiée (`/supervision/credit-exposure`) répond 403 au
        //    coordinateur logistique. Une habilitation ne vaut rien si une
        //    autre porte l'ignore.
        //
        //    Énuméré plutôt que masqué : une colonne ajoutée demain ne sortira
        //    pas par défaut. C'est le bon sens du défaut sur une route qui
        //    sert des données de risque.
        select: {
          id: true,
          code: true,
          legalName: true,
          type: true,
          countryCode: true,
          segment: true,
          taxpayerAccountNumber: true,
          rccmNumber: true,
          taxRegime: true,
          isVatExempt: true,
          vatExemptionReference: true,
          paymentTermsDays: true,
          supplierTermsDays: true,
          isActive: true,
          ...(voitLeCredit
            ? {
                creditLimit: true as const,
                creditLimitCurrencyCode: true as const,
                creditStatus: true as const,
              }
            : {}),
          // Les sites d'un tiers, AVEC les exigences du lieu qu'ils désignent.
          //
          // Les exigences appartiennent au LIEU et se saisissent au
          // référentiel des sites (§ 6.2). Elles sont exposées ICI parce que
          // c'est là qu'on choisit une destination : celui qui prépare
          // l'opération doit les voir au moment où il décide, pas quand le
          // camion est à la barrière.
          sites: {
            where: { isActive: true },
            select: {
              id: true, code: true, name: true, city: true,
              site: {
                select: {
                  id: true, code: true, name: true, city: true,
                  accessInstructions: true, openingHours: true, safetyInstructions: true,
                  defaultHseRiskLevel: true,
                  requirements: {
                    where: { isActive: true },
                    orderBy: { type: { displayOrder: 'asc' } },
                    select: {
                      id: true, detail: true, isBlocking: true,
                      type: { select: { code: true, label: true, description: true } },
                    },
                  },
                },
              },
            },
          },
          _count: { select: { complianceRecords: true, vehicles: true, drivers: true } },
        },
      }),
      this.prisma.partner.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  /** Paramètres métier — seuils, taux de financement, préavis d'alerte. */
  settings() {
    return this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
  }

  /**
   * Lecture d'un référentiel désigné par sa CLÉ DE REGISTRE.
   *
   * Sert les référentiels qu'aucune route spécifique ne couvre — seize sur
   * vingt-neuf au moment où cette méthode a été écrite. Le registre est la
   * seule source : un référentiel ajouté devient lisible sans qu'on écrive
   * quoi que ce soit ici.
   *
   * ⚠️ PLAFOND À 500 LIGNES, ET C'EST DÉLIBÉRÉ.
   *
   *    Cette lecture alimente des listes déroulantes. Au-delà de quelques
   *    centaines d'entrées, une liste déroulante n'est plus utilisable et il
   *    faut une recherche — le plafond fait apparaître le besoin au lieu de
   *    laisser l'écran ramer en silence sur dix mille lignes.
   */
  async parReferentiel(key: string) {
    const spec = findReferential(key);
    if (!spec) {
      throw new NotFoundException(
        `Référentiel « ${key} » inconnu. Les référentiels disponibles sont ceux du registre (§ 1.1 bis).`,
      );
    }

    const delegate = (this.prisma as unknown as Record<string, unknown>)[spec.model] as {
      findMany: (a: unknown) => Promise<Record<string, unknown>[]>;
    };
    if (!delegate) {
      throw new NotFoundException(`Référentiel « ${key} » sans table associée.`);
    }

    // Tri sur le premier champ d'identité : c'est celui qui désigne la ligne
    // pour un humain, donc celui dans lequel il la cherchera.
    const cle = spec.identity[0];
    return delegate.findMany({ orderBy: { [cle]: 'asc' }, take: 500 });
  }
}

/**
 * Toute propriété d'un DTO doit porter un décorateur de validation : avec
 * `forbidNonWhitelisted`, class-transformer matérialise la propriété même
 * absente de la requête, et le validateur la rejette comme non déclarée.
 */
class PartnerQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(['CLIENT', 'PROSPECT', 'SUPPLIER', 'CARRIER', 'INSPECTOR'])
  type?: string;
}

@Controller('api/internal/referentials')
@RequireRealm(Realm.INTERNAL)
@SkipAudit()
export class ReferentialsController {
  constructor(private readonly service: ReferentialsService) {}

  @Get('currencies')
  currencies() {
    return this.service.currencies();
  }

  @Get('fx-rates')
  fxRates() {
    return this.service.fxRates();
  }

  @Get('products')
  products() {
    return this.service.products();
  }

  @Get('administered-prices')
  administeredPrices() {
    return this.service.administeredPrices();
  }

  /**
   * ⚠️ CETTE ROUTE SERT DES DONNÉES DE RISQUE CLIENT.
   *
   *    `partners()` rend le modèle entier, plafond de crédit et statut de
   *    crédit compris. Elle ne portait AUCUN contrôle de rôle : le
   *    coordinateur logistique, à qui `/supervision/credit-exposure` répond
   *    403, y lisait les plafonds et les encours de tous les clients.
   *
   *    L'habilitation posée ailleurs ne vaut rien si une autre porte l'ignore.
   */
  @Get('partners')
  @Roles(
    UserRole.DG,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.CCOO,
    UserRole.ASSISTANT_DG,
    UserRole.SALES_REP,
    UserRole.LOGISTICS_COORD,
  )
  partners(@Query() query: PartnerQuery, @Req() req: { auth: { role?: UserRole } }) {
    return this.service.partners(query, req.auth.role);
  }

  @Get('cost-posts')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT, UserRole.CCOO, UserRole.LOGISTICS_COORD)
  costPosts() {
    return this.service.costPosts();
  }

  @Get('operation-types')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD, UserRole.SALES_REP)
  operationTypes(@Query('segment') segment?: CommercialSegment) {
    return this.service.operationTypes(segment);
  }

  @Get('sites/:id/requirements')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD, UserRole.SALES_REP)
  siteRequirements(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.siteRequirements(id);
  }

  @Get('sites')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD, UserRole.SALES_REP)
  sites(@Query('usage') usage?: 'LOADING' | 'DELIVERY') {
    return this.service.sites(usage);
  }

  @Get('hse-checklists')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD)
  hseChecklists() {
    return this.service.hseChecklists();
  }

  @Get('absorption-rates')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
  absorptionRates(@Query('fiscalYear') fiscalYear?: string) {
    return this.service.absorptionRates(Number(fiscalYear) || new Date().getUTCFullYear());
  }

  @Get('margin-thresholds')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO, UserRole.ACCOUNTANT)
  marginThresholds() {
    return this.service.marginThresholds();
  }

  @Get('ullage-tolerances')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO, UserRole.LOGISTICS_COORD)
  ullageTolerances() {
    return this.service.ullageTolerances();
  }

  @Get('settings')
  @Roles(UserRole.DG, UserRole.IT_ADMIN, UserRole.FINANCE_CFO)
  settings() {
    return this.service.settings();
  }

  /**
   * LECTURE GÉNÉRIQUE D'UN RÉFÉRENTIEL DÉCLARÉ AU REGISTRE.
   *
   * ⚠️ LES ROUTES DE LECTURE ÉTAIENT UNE LISTE TENUE À LA MAIN.
   *
   *    Treize routes écrites une à une, face à VINGT-NEUF référentiels déclarés
   *    au registre. Seize étaient donc écrivables et illisibles — et un
   *    référentiel qu'on ne peut pas lire ne peut pas alimenter une liste
   *    déroulante.
   *
   *    Conséquence constatée : cinq champs de référence retombaient en saisie
   *    libre, dont `fiscalYearId` sur les trois écrans du paramétrage financier
   *    — taux de financement, budget de charges fixes, prévision de vente.
   *    Autrement dit, le premier geste du CFO consistait à recopier à la main
   *    un identifiant technique.
   *
   *    Le registre sait déjà quels référentiels existent. Une liste tenue en
   *    parallèle finit toujours par diverger : on n'oublie pas d'ajouter le
   *    référentiel, on oublie d'ajouter sa route.
   *
   * ⚠️ DÉCLARÉE EN DERNIER, ET CE N'EST PAS UN DÉTAIL.
   *
   *    NestJS retient la PREMIÈRE route qui correspond. Placée plus haut,
   *    `:key` avalerait `currencies`, `partners` et toutes les autres — avec
   *    leurs filtres de rôle et leur pagination. Les routes spécifiques
   *    gardent donc la main ; celle-ci ne sert que ce qu'aucune ne couvre.
   *
   * Le cloisonnement par rôle des routes spécifiques reste intact : elles ne
   * passent jamais par ici. Cette route sert des référentiels de paramétrage —
   * exercices, regroupements de charges, types d'exigence — dont la lecture ne
   * révèle aucune donnée de risque client.
   */
  @Get(':key')
  @Roles(
    UserRole.DG,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.CCOO,
    UserRole.LOGISTICS_COORD,
    UserRole.ASSISTANT_DG,
    UserRole.IT_ADMIN,
  )
  generique(@Param('key') key: string) {
    return this.service.parReferentiel(key);
  }
}
