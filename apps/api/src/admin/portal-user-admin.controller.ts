import {
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ActorType, AuditAction, UserRole } from '@prisma/client';
import { IsBoolean, IsOptional, IsEmail, Length, MaxLength } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { Realm, RequireRealm, Roles } from '../common/auth/realm';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';

class CreatePortalUserDto {
  @IsEmail({}, { message: 'Adresse électronique invalide' })
  @MaxLength(255)
  email!: string;

  @MaxLength(160)
  fullName!: string;

  @Length(12, 200, { message: 'Mot de passe provisoire de 12 caractères minimum' })
  password!: string;
}

class UpdatePortalUserDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class ResetPortalPasswordDto {
  @Length(12, 200, { message: 'Mot de passe provisoire de 12 caractères minimum' })
  password!: string;
}

/**
 * Comptes du portail client, rattachés à un tiers (§ 1.3, § 13).
 *
 * Même lacune que les deux autres réalmes : avant ce contrôleur, seul
 * `prisma/seed.ts` créait des comptes portail, jamais exécuté hors
 * développement/CI. Un `PortalUser` exige un `partnerId` par construction du
 * schéma (`onDelete: Restrict`) — la route porte donc toujours le tiers dans
 * son chemin, jamais en paramètre optionnel : un accès portail qui ne
 * viendrait pas d'une fiche tiers déjà ouverte n'aurait pas de sens.
 *
 * Écrit par les rôles qui possèdent la relation commerciale — DG, CCOO,
 * SALES_REP — pas IT_ADMIN : c'est un geste commercial, pas un geste
 * d'exploitation. « Un commercial crée l'accès depuis la console » (arbitrage
 * du chantier utilisateurs), communique ensuite les identifiants hors ligne :
 * aucune infrastructure d'envoi de courriel n'existe dans ce projet.
 */
@Injectable()
export class PortalUserAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  listForPartner(partnerId: string) {
    return this.prisma.portalUser.findMany({
      where: { partnerId },
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        mustChangePassword: true,
        totpEnabled: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    });
  }

  async create(partnerId: string, dto: CreatePortalUserDto, actorId: string) {
    const passwordHash = await this.crypto.hashPassword(dto.password);
    // Le partenaire doit exister : la contrainte de clé étrangère le garantit
    // (P2003, traduit par le filtre global) — pas de vérification préalable
    // séparée qui divergerait de la contrainte réelle.
    const created = await this.prisma.portalUser.create({
      data: {
        partnerId,
        email: dto.email.toLowerCase(),
        fullName: dto.fullName,
        passwordHash,
        mustChangePassword: true,
      },
    });
    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'PortalUser',
      entityId: created.id,
      after: { partnerId, email: created.email, fullName: created.fullName },
    });
    return { id: created.id, email: created.email };
  }

  async update(partnerId: string, id: string, dto: UpdatePortalUserDto, actorId: string) {
    const before = await this.prisma.portalUser.findFirst({ where: { id, partnerId } });
    if (!before) throw new NotFoundException('Compte portail introuvable pour ce tiers.');

    const updated = await this.prisma.portalUser.update({ where: { id }, data: dto });
    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.UPDATE,
      entityType: 'PortalUser',
      entityId: id,
      before: { isActive: before.isActive },
      after: { isActive: updated.isActive },
    });
    return { id: updated.id, isActive: updated.isActive };
  }

  async resetPassword(partnerId: string, id: string, dto: ResetPortalPasswordDto, actorId: string) {
    const before = await this.prisma.portalUser.findFirst({ where: { id, partnerId } });
    if (!before) throw new NotFoundException('Compte portail introuvable pour ce tiers.');

    const passwordHash = await this.crypto.hashPassword(dto.password);
    const updated = await this.prisma.portalUser.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true },
    });
    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.PASSWORD_RESET,
      entityType: 'PortalUser',
      entityId: id,
      after: { reinitialise_par: actorId },
    });
    return { id: updated.id, mustChangePassword: true };
  }
}

@Controller('api/internal/partners/:partnerId/portal-users')
@RequireRealm(Realm.INTERNAL)
@Roles(UserRole.DG, UserRole.CCOO, UserRole.SALES_REP)
export class PortalUserAdminController {
  constructor(private readonly service: PortalUserAdminService) {}

  @Get()
  list(@Param('partnerId', ParseUUIDPipe) partnerId: string) {
    return this.service.listForPartner(partnerId);
  }

  @Post()
  create(
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
    @Body() dto: CreatePortalUserDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.create(partnerId, dto, req.auth.sub);
  }

  @Patch(':id')
  update(
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePortalUserDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.update(partnerId, id, dto, req.auth.sub);
  }

  @Patch(':id/reset-password')
  resetPassword(
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPortalPasswordDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.resetPassword(partnerId, id, dto, req.auth.sub);
  }
}
