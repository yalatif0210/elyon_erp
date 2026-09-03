import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { PurchaseOrderStatus, UserRole } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { Realm, RequireRealm, Roles, Screen } from '../common/auth/realm';
import { Page, PaginationQuery, paginate } from '../common/http/pagination.dto';
import { PrismaService } from '../common/prisma/prisma.service';

// ===========================================================================
//  DTO
// ===========================================================================

class PurchaseOrderQuery extends PaginationQuery {
  @IsOptional() @IsEnum(PurchaseOrderStatus) status?: PurchaseOrderStatus;
  @IsOptional() @IsUUID() supplierId?: string;
  /** L'affaire, pas l'opération : le rattachement d'une facture se choisit au niveau du dossier (ticket #9). */
  @IsOptional() @IsUUID() dealId?: string;
}

// ===========================================================================
//  Service
// ===========================================================================

/**
 * Registre des commandes d'achat émises en mode BACK_TO_BACK (ticket #5).
 *
 * Lecture seule ici : l'émission elle-même se déclenche à l'affectation des
 * moyens sur l'opération, jamais à sa création — voir
 * `OperationsService.emettreCommandeAchat`. Le fournisseur et le prix repris
 * viennent du prix fournisseur validé sur l'affaire, jamais ressaisis.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PurchaseOrderQuery): Promise<Page<unknown>> {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.dealId ? { operation: { dealId: query.dealId } } : {}),
      ...(query.search
        ? { reference: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { issuedAt: 'desc' },
        include: {
          supplier: { select: { code: true, legalName: true } },
          operation: {
            select: {
              id: true,
              reference: true,
              deal: {
                select: { id: true, reference: true, client: { select: { legalName: true } } },
              },
            },
          },
        },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return paginate(items, total, query);
  }
}

// ===========================================================================
//  Contrôleur
// ===========================================================================

@Controller('api/internal/purchase-orders')
@RequireRealm(Realm.INTERNAL)
export class PurchaseOrdersController {
  constructor(private readonly service: PurchaseOrdersService) {}

  @Get()
  @Roles(
    UserRole.DG,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.CCOO,
    UserRole.LOGISTICS_COORD,
  )
  @Screen('achats')
  list(@Query() query: PurchaseOrderQuery) {
    return this.service.list(query);
  }
}
