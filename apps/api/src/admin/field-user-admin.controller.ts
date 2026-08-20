import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ActorType, AuditAction, FieldRole, UserRole } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsEmail, Length, MaxLength } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { Realm, RequireRealm, Roles } from '../common/auth/realm';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';

class CreateFieldUserDto {
  @IsEmail({}, { message: 'Adresse électronique invalide' })
  @MaxLength(255)
  email!: string;

  @MaxLength(160)
  fullName!: string;

  @IsEnum(FieldRole)
  role!: FieldRole;

  @Length(12, 200, { message: 'Mot de passe provisoire de 12 caractères minimum' })
  password!: string;
}

class UpdateFieldUserDto {
  @IsOptional() @IsEnum(FieldRole) role?: FieldRole;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class ResetFieldPasswordDto {
  @Length(12, 200, { message: 'Mot de passe provisoire de 12 caractères minimum' })
  password!: string;
}

/**
 * Comptes terrain — agent d'opération, contrôleur HSE (§ 10.3).
 *
 * Même lacune que les comptes internes (voir `user-admin.controller.ts`),
 * même correctif : avant ce contrôleur, seul `prisma/seed.ts` créait des
 * comptes terrain, jamais exécuté hors développement/CI.
 *
 * Écrit par les mêmes rôles que la gestion des comptes internes (DG,
 * IT_ADMIN) — pas le coordinateur logistique, qui affecte des agents à des
 * opérations mais ne gouverne pas leurs accès.
 */
@Injectable()
export class FieldUserAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.fieldUser.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        totpEnabled: true,
        assignedDeviceId: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    });
  }

  async create(dto: CreateFieldUserDto, actorId: string) {
    const passwordHash = await this.crypto.hashPassword(dto.password);
    const created = await this.prisma.fieldUser.create({
      data: {
        email: dto.email,
        fullName: dto.fullName,
        role: dto.role,
        passwordHash,
        mustChangePassword: true,
      },
    });
    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.CREATE,
      entityType: 'FieldUser',
      entityId: created.id,
      after: { email: created.email, fullName: created.fullName, role: created.role },
    });
    return { id: created.id, email: created.email };
  }

  async update(id: string, dto: UpdateFieldUserDto, actorId: string) {
    const before = await this.prisma.fieldUser.findUnique({ where: { id } });
    if (!before) throw new ForbiddenException('Compte introuvable.');

    const updated = await this.prisma.fieldUser.update({ where: { id }, data: dto });
    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.UPDATE,
      entityType: 'FieldUser',
      entityId: id,
      before: { role: before.role, isActive: before.isActive },
      after: { role: updated.role, isActive: updated.isActive },
    });
    return { id: updated.id, role: updated.role, isActive: updated.isActive };
  }

  async resetPassword(id: string, dto: ResetFieldPasswordDto, actorId: string) {
    const passwordHash = await this.crypto.hashPassword(dto.password);
    const updated = await this.prisma.fieldUser.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true },
    });
    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.PASSWORD_RESET,
      entityType: 'FieldUser',
      entityId: id,
      after: { reinitialise_par: actorId },
    });
    return { id: updated.id, mustChangePassword: true };
  }
}

@Controller('api/internal/field-users')
@RequireRealm(Realm.INTERNAL)
export class FieldUserAdminController {
  constructor(private readonly service: FieldUserAdminService) {}

  // Hors du registre d'écrans dynamique (comme /acces-ecrans) : pas de
  // @Screen() ici, délibérément — voir user-admin.controller.ts.
  @Get()
  @Roles(UserRole.DG, UserRole.IT_ADMIN)
  list() {
    return this.service.list();
  }

  @Post()
  @Roles(UserRole.DG, UserRole.IT_ADMIN)
  create(@Body() dto: CreateFieldUserDto, @Req() req: { auth: { sub: string } }) {
    return this.service.create(dto, req.auth.sub);
  }

  @Patch(':id')
  @Roles(UserRole.DG, UserRole.IT_ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFieldUserDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.update(id, dto, req.auth.sub);
  }

  @Patch(':id/reset-password')
  @Roles(UserRole.DG, UserRole.IT_ADMIN)
  resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetFieldPasswordDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.resetPassword(id, dto, req.auth.sub);
  }
}
