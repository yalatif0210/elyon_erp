import { BadRequestException, Body, Controller, Get, Injectable, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ActorType, AuditAction, DunningMethod, InvoiceType, UserRole } from '@prisma/client';
import { IsEnum, IsISO8601, IsString, MinLength } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { Realm, RequireRealm, Roles, Screen } from '../common/auth/realm';
import { FxService } from '../common/money/fx.service';
import { PrismaService } from '../common/prisma/prisma.service';

// ===========================================================================
//  DTO
// ===========================================================================

class RecordDunningDto {
  @IsEnum(DunningMethod) method!: DunningMethod;
  @IsString() @MinLength(5) notes!: string;
  @IsISO8601() contactedAt!: string;
}

type Bucket = 'A_VENIR' | 'J1_30' | 'J31_60' | 'J61_90' | 'J90_PLUS' | 'SANS_ECHEANCE';

// ===========================================================================
//  Service
// ===========================================================================

/**
 * RECOUVREMENT (§ 3.3, § 14.6, § 16).
 *
 * SPECIFICATIONS.md ne détaille ni paliers d'escalade ni automatisation — le
 * document ne mentionne « recouvrement » que par la matrice RBAC et le poste
 * comptable qui en porte le nom. Ce service reste donc à la mesure de ce qui
 * est spécifié : une balance âgée pour VOIR l'exposition, une journalisation
 * manuelle pour TRACER une relance — pas une politique inventée.
 */
@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fx: FxService,
  ) {}

  private bucketOf(dueDate: Date | null, today: Date): Bucket {
    if (!dueDate) return 'SANS_ECHEANCE';
    const days = Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000);
    if (days <= 0) return 'A_VENIR';
    if (days <= 30) return 'J1_30';
    if (days <= 60) return 'J31_60';
    if (days <= 90) return 'J61_90';
    return 'J90_PLUS';
  }

  /**
   * Balance âgée — créances ouvertes (« facturées non encaissées »).
   *
   * Les proforma ne créent aucune créance et les avoirs n'en sont pas une :
   * les deux sont exclus. Le tri par client somme des pièces qui peuvent être
   * dans des devises différentes ; la seule façon de les additionner est de
   * passer par le pivot, mais ce calcul reste interne — la synthèse par
   * client est reconvertie en XOF avant de sortir de ce service. Le détail
   * par pièce, lui, n'a jamais eu besoin du pivot : une seule pièce n'a
   * qu'une seule devise, la sienne.
   */
  async agedReceivables() {
    const today = new Date();
    const tauxXof = await this.fx.pivotToLocalRate();
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'DISPUTED'] },
        type: { in: [InvoiceType.SIMPLE, InvoiceType.FNE] },
      },
      select: {
        id: true,
        number: true,
        dueDate: true,
        status: true,
        currencyCode: true,
        totalAmount: true,
        paidAmount: true,
        totalAmountPivot: true,
        paidAmountPivot: true,
        partner: { select: { id: true, code: true, legalName: true } },
        _count: { select: { dunningActions: true } },
      },
      orderBy: { dueDate: 'asc' },
    });

    const brutes = invoices
      .map((inv) => ({
        invoiceId: inv.id,
        number: inv.number,
        status: inv.status,
        dueDate: inv.dueDate,
        currencyCode: inv.currencyCode,
        outstanding: Number(inv.totalAmount) - Number(inv.paidAmount),
        outstandingPivot: Number(inv.totalAmountPivot) - Number(inv.paidAmountPivot),
        partner: inv.partner,
        dunningCount: inv._count.dunningActions,
        bucket: this.bucketOf(inv.dueDate, today),
        daysOverdue: inv.dueDate ? Math.floor((today.getTime() - inv.dueDate.getTime()) / 86_400_000) : null,
      }))
      .filter((l) => l.outstandingPivot > 0.01);

    const byPartner = new Map<
      string,
      { partner: { id: string; code: string; legalName: string }; buckets: Record<Bucket, number>; total: number }
    >();
    for (const line of brutes) {
      let entry = byPartner.get(line.partner.id);
      if (!entry) {
        entry = {
          partner: line.partner,
          buckets: { A_VENIR: 0, J1_30: 0, J31_60: 0, J61_90: 0, J90_PLUS: 0, SANS_ECHEANCE: 0 },
          total: 0,
        };
        byPartner.set(line.partner.id, entry);
      }
      const xof = line.outstandingPivot * tauxXof;
      entry.buckets[line.bucket] += xof;
      entry.total += xof;
    }

    // `outstandingPivot` ne sort jamais de ce service : le détail par pièce
    // ne montre que le montant natif de la pièce elle-même.
    const lines = brutes.map(({ outstandingPivot: _outstandingPivot, ...l }) => l);

    return { lines, byPartner: [...byPartner.values()].sort((a, b) => b.total - a.total) };
  }

  async recordDunning(invoiceId: string, dto: RecordDunningDto, actorId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { number: true, type: true, status: true },
    });
    if (!invoice) throw new BadRequestException('Facture introuvable.');
    if (invoice.type === InvoiceType.PROFORMA || invoice.type === InvoiceType.CREDIT_NOTE) {
      throw new BadRequestException(`${invoice.number} ne porte aucune créance à relancer.`);
    }

    const action = await this.prisma.dunningAction.create({
      data: {
        invoiceId,
        method: dto.method,
        notes: dto.notes,
        contactedAt: new Date(dto.contactedAt),
        recordedById: actorId,
      },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'DunningAction',
      entityId: action.id,
      after: action,
    });

    return action;
  }

  listDunning(invoiceId: string) {
    return this.prisma.dunningAction.findMany({
      where: { invoiceId },
      orderBy: { contactedAt: 'desc' },
      include: { recordedBy: { select: { fullName: true } } },
    });
  }
}

// ===========================================================================
//  Contrôleur
// ===========================================================================

@Controller('api/internal')
@RequireRealm(Realm.INTERNAL)
export class CollectionsController {
  constructor(private readonly service: CollectionsService) {}

  @Get('supervision/aged-receivables')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
  @Screen('recouvrement')
  agedReceivables() {
    return this.service.agedReceivables();
  }

  @Get('invoices/:id/dunning')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listDunning(id);
  }

  @Post('invoices/:id/dunning')
  @Roles(UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
  record(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordDunningDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.recordDunning(id, dto, req.auth.sub);
  }
}
