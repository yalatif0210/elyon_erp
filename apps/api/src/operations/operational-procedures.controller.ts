import { Body, Controller, Get, Injectable, Param, ParseUUIDPipe, Patch, Req } from '@nestjs/common';
import { ActorType, AuditAction, UserRole } from '@prisma/client';
import { IsString, MinLength } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { Realm, RequireRealm, Roles, Screen } from '../common/auth/realm';
import { PrismaService } from '../common/prisma/prisma.service';

class SetProcedureDto {
  @IsString() @MinLength(1) content!: string;
}

/**
 * PROCÉDURES OPÉRATIONNELLES, PAR TYPE D'OPÉRATION (§ discussion 20/08).
 *
 * Aucun mode opératoire n'existait nulle part dans l'application : un agent
 * découvrait le déroulé d'un chargement, d'un soutage ou d'un transfert par
 * pipeline en le vivant, jamais en le lisant avant. Ce module ouvre un
 * emplacement, un seul par type, éditable par l'Assistante de Direction et
 * lisible par tout rôle interne — ce n'est pas une donnée sensible, c'est un
 * mode opératoire que l'entreprise entière doit pouvoir consulter.
 */
@Injectable()
export class OperationalProceduresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Chaque type d'opération, avec sa procédure si elle existe. */
  list() {
    return this.prisma.operationType.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        label: true,
        description: true,
        procedure: {
          select: {
            content: true,
            updatedAt: true,
            updatedBy: { select: { fullName: true } },
          },
        },
      },
    });
  }

  /**
   * Pose ou remplace la procédure d'un type — une seule ligne par type,
   * jamais un historique empilé : une procédure qui se reprend REMPLACE la
   * précédente.
   */
  async set(operationTypeId: string, dto: SetProcedureDto, actorId: string) {
    await this.prisma.operationType.findUniqueOrThrow({
      where: { id: operationTypeId },
      select: { id: true },
    });

    const procedure = await this.prisma.operationalProcedure.upsert({
      where: { operationTypeId },
      create: { operationTypeId, content: dto.content, updatedById: actorId },
      update: { content: dto.content, updatedById: actorId },
      select: { id: true, content: true, updatedAt: true },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.UPDATE,
      entityType: 'OperationalProcedure',
      entityId: procedure.id,
      after: { operationTypeId, content: dto.content },
    });

    return procedure;
  }
}

@Controller('api/internal/operational-procedures')
@RequireRealm(Realm.INTERNAL)
export class OperationalProceduresController {
  constructor(private readonly service: OperationalProceduresService) {}

  /**
   * Aucun `@Roles` posé : visible par tout rôle interne authentifié. Ce
   * n'est pas un oubli — voir le commentaire d'en-tête du service.
   */
  @Get()
  @Screen('procedures')
  list() {
    return this.service.list();
  }

  @Patch(':operationTypeId')
  @Roles(UserRole.ASSISTANT_DG)
  set(
    @Param('operationTypeId', ParseUUIDPipe) operationTypeId: string,
    @Body() dto: SetProcedureDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.set(operationTypeId, dto, req.auth.sub);
  }
}
