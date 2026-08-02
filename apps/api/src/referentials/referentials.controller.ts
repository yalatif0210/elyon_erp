import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';
import { Realm, RequireRealm, Roles, SkipAudit } from '../common/auth/realm';
import { Page, PaginationQuery, paginate } from '../common/http/pagination.dto';
import { PrismaService } from '../common/prisma/prisma.service';

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
      include: { defaultPriceIndex: { select: { code: true, name: true } } },
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

  async partners(query: PaginationQuery & { type?: string }): Promise<Page<unknown>> {
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
        include: {
          sites: { where: { isActive: true }, select: { id: true, code: true, name: true, city: true } },
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

  @Get('partners')
  partners(@Query() query: PartnerQuery) {
    return this.service.partners(query);
  }

  @Get('cost-posts')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT, UserRole.CCOO, UserRole.LOGISTICS_COORD)
  costPosts() {
    return this.service.costPosts();
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
}
