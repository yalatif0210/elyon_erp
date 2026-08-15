import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ActorType, AuditAction, UserRole } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Realm, RequireRealm, Roles, SkipAudit } from '../auth/realm';
import { Page, PaginationQuery, paginate } from '../http/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * LECTURE DU JOURNAL D'AUDIT (§ 1.4).
 *
 * ⚠️ CORRIGÉ (audit, axe C, S1) — CETTE ROUTE N'EXISTAIT PAS.
 *
 *    Le journal était correctement alimenté (`AuditService.record`, append-only
 *    garanti par trigger PostgreSQL) mais totalement illisible depuis
 *    l'application : aucune route, pour aucun rôle, DG compris. Une écriture
 *    frauduleuse s'y serait accumulée sans que personne ne puisse jamais la
 *    consulter — la traçabilité existait en base, pas en pratique. C'est ce
 *    qui privait les deux failles voisines (IDOR en écriture, absence de
 *    séparation des tâches) de tout filet de détection.
 *
 *    Réservée à DG et IT_ADMIN : le journal porte l'ensemble des actions de
 *    tous les rôles, y compris les refus et corrections — sa lecture n'a de
 *    sens qu'au niveau de la gouvernance, pas module par module.
 */
class AuditLogQuery extends PaginationQuery {
  @IsOptional() @IsEnum(ActorType) actorType?: ActorType;
  @IsOptional() @IsUUID() actorId?: string;
  @IsOptional() @IsEnum(AuditAction) action?: AuditAction;
  @IsOptional() @IsString() @MaxLength(64) entityType?: string;
  @IsOptional() @IsString() @MaxLength(64) entityId?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditLogQuery): Promise<Page<unknown>> {
    const where = {
      ...(query.actorType ? { actorType: query.actorType } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const noms = await this.resoudreActeurs(items);

    // BigInt (id) n'est pas sérialisable en JSON tel quel — converti en
    // chaîne, comme le fait déjà `redact()` côté écriture pour la même raison.
    const serialisables = items.map((i) => ({
      ...i,
      id: i.id.toString(),
      actorName: i.actorLabel ?? (i.actorId ? (noms.get(i.actorId) ?? null) : null),
    }));
    return paginate(serialisables, total, query);
  }

  /**
   * Nom lisible de l'acteur, faute de quoi le journal n'affiche que des
   * identifiants opaques — illisible en pratique pour qui n'a pas la base
   * sous la main, ce que ce correctif est censé éviter.
   *
   * `AuditLog.actorId` n'a JAMAIS de relation Prisma — par construction, un
   * append-only ne doit dépendre d'aucune ligne susceptible de disparaître.
   * La résolution se fait donc ici, en dehors du schéma, par requêtes
   * groupées sur les trois tables de comptes possibles.
   */
  private async resoudreActeurs(
    items: { actorType: ActorType; actorId: string | null }[],
  ): Promise<Map<string, string>> {
    const idsInternes = [...new Set(items.filter((i) => i.actorType === ActorType.INTERNAL_USER && i.actorId).map((i) => i.actorId!))];
    const idsPortail = [...new Set(items.filter((i) => i.actorType === ActorType.PORTAL_USER && i.actorId).map((i) => i.actorId!))];
    const idsTerrain = [...new Set(items.filter((i) => i.actorType === ActorType.FIELD_USER && i.actorId).map((i) => i.actorId!))];

    const [internes, portail, terrain] = await Promise.all([
      idsInternes.length
        ? this.prisma.user.findMany({ where: { id: { in: idsInternes } }, select: { id: true, fullName: true } })
        : [],
      idsPortail.length
        ? this.prisma.portalUser.findMany({ where: { id: { in: idsPortail } }, select: { id: true, fullName: true } })
        : [],
      idsTerrain.length
        ? this.prisma.fieldUser.findMany({ where: { id: { in: idsTerrain } }, select: { id: true, fullName: true } })
        : [],
    ]);

    const noms = new Map<string, string>();
    for (const u of [...internes, ...portail, ...terrain]) noms.set(u.id, u.fullName);
    return noms;
  }
}

@Controller('api/internal/audit-log')
@RequireRealm(Realm.INTERNAL)
@SkipAudit()
export class AuditLogController {
  constructor(private readonly service: AuditLogService) {}

  @Get()
  @Roles(UserRole.DG, UserRole.IT_ADMIN)
  list(@Query() query: AuditLogQuery) {
    return this.service.list(query);
  }
}
