import { BadRequestException, Body, Controller, Get, Injectable, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { ActorType, AuditAction, QuotationRequestStatus, UserRole } from '@prisma/client';
import { IsString, MaxLength } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { Realm, RequireRealm, Roles } from '../common/auth/realm';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * DEMANDES DE COTATION REÇUES DU PORTAIL (§ 13, module 0) — CÔTÉ COMMERCIAL.
 *
 * ⚠️ SANS CE MODULE, LE CANAL PORTAIL N'A PAS DE SECOND BOUT.
 *
 *    Le portail client écrit dans `quotation_requests`, mais rien côté
 *    interne n'en montrait le contenu jusqu'ici : une demande y arrivait,
 *    un accusé de réception partait, et plus personne ne la revoyait — ni
 *    écran, ni tâche, ni notification. Ce contrôleur ouvre la lecture et le
 *    triage ; il ne construit PAS la conversion automatique en affaire, qui
 *    suppose la tarification et le chiffrage des coûts (§ 5.4) — un geste
 *    commercial, pas une transformation mécanique. Le commercial lit la
 *    demande ici, puis crée l'affaire par la voie normale.
 */

class DeclineQuotationDto {
  @IsString() @MaxLength(500) reason!: string;
}

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(status?: QuotationRequestStatus) {
    return this.prisma.quotationRequest.findMany({
      where: status ? { status } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        partner: { select: { code: true, legalName: true } },
        product: { select: { code: true, name: true } },
        submittedByPortalUser: { select: { fullName: true, email: true } },
        convertedDeal: { select: { id: true, reference: true } },
      },
    });
  }

  async setStatus(id: string, status: QuotationRequestStatus, actorId: string, reason?: string) {
    const existing = await this.prisma.quotationRequest.findUniqueOrThrow({ where: { id } });
    if (existing.status === QuotationRequestStatus.CONVERTED) {
      throw new BadRequestException('Cette demande est déjà convertie en affaire : son statut ne se rouvre pas.');
    }
    if (status === QuotationRequestStatus.CONVERTED) {
      throw new BadRequestException(
        'La conversion se fait en créant l’affaire, pas en changeant ce statut à la main.',
      );
    }

    const updated = await this.prisma.quotationRequest.update({ where: { id }, data: { status } });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'QuotationRequest',
      entityId: id,
      before: { status: existing.status },
      after: { status, reason: reason ?? null },
    });

    return updated;
  }
}

@Controller('api/internal/quotations')
@RequireRealm(Realm.INTERNAL)
export class QuotationsController {
  constructor(private readonly service: QuotationsService) {}

  @Get()
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP, UserRole.ASSISTANT_DG)
  list(@Query('status') status?: QuotationRequestStatus) {
    return this.service.list(status);
  }

  @Patch(':id/en-etude')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP)
  marquerEnEtude(@Param('id', ParseUUIDPipe) id: string, @Req() req: { auth: { sub: string } }) {
    return this.service.setStatus(id, QuotationRequestStatus.IN_REVIEW, req.auth.sub);
  }

  @Patch(':id/decliner')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP)
  decliner(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineQuotationDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.setStatus(id, QuotationRequestStatus.DECLINED, req.auth.sub, dto.reason);
  }
}
