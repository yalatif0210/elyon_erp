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
import { ActorType, AuditAction, UserRole } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsEmail, Length, MaxLength } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { Realm, RequireRealm, Roles } from '../common/auth/realm';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';

class CreateUserDto {
  @IsEmail({}, { message: 'Adresse électronique invalide' })
  @MaxLength(255)
  email!: string;

  @MaxLength(160)
  fullName!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  /** Provisoire : `mustChangePassword` est toujours forcé à la création. */
  @Length(12, 200, { message: 'Mot de passe provisoire de 12 caractères minimum' })
  password!: string;
}

class UpdateUserDto {
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class ResetPasswordDto {
  @Length(12, 200, { message: 'Mot de passe provisoire de 12 caractères minimum' })
  password!: string;
}

/**
 * Comptes internes (SPECIFICATIONS.md § 1.3, § 1.4).
 *
 * ⚠️ AVANT CE CONTRÔLEUR, AUCUNE ROUTE NE CRÉAIT DE COMPTE.
 *
 *    La seule création d'un `User` vivait dans `prisma/seed.ts`, un script de
 *    données de démonstration jamais exécuté hors développement/CI. Un
 *    déploiement réel (staging ou production, tous deux sur `db:deploy`,
 *    sans semis) démarrait donc sans que personne — pas même le DG — puisse
 *    se connecter. `prisma/bootstrap-admin.ts` crée le tout premier compte ;
 *    ce contrôleur prend le relais pour tous les suivants.
 *
 * Un administrateur ne peut ni se désactiver ni changer son propre rôle
 * depuis cet écran — même principe que `/acces-ecrans` : se retirer soi-même
 * l'accès à la seule porte qui permet de le redonner n'a pas d'issue.
 */
@Injectable()
export class UserAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        mustChangePassword: true,
        totpEnabled: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    });
  }

  async create(dto: CreateUserDto, actorId: string) {
    const passwordHash = await this.crypto.hashPassword(dto.password);
    const created = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
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
      entityType: 'User',
      entityId: created.id,
      after: { email: created.email, fullName: created.fullName, role: created.role },
    });
    return { id: created.id, email: created.email };
  }

  async update(id: string, dto: UpdateUserDto, actorId: string) {
    if (id === actorId) {
      throw new ForbiddenException(
        'Impossible de modifier son propre compte depuis cet écran : demandez à un autre administrateur.',
      );
    }
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) throw new ForbiddenException('Compte introuvable.');

    const updated = await this.prisma.user.update({ where: { id }, data: dto });
    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: id,
      before: { role: before.role, isActive: before.isActive },
      after: { role: updated.role, isActive: updated.isActive },
    });
    return { id: updated.id, role: updated.role, isActive: updated.isActive };
  }

  async resetPassword(id: string, dto: ResetPasswordDto, actorId: string) {
    if (id === actorId) {
      throw new ForbiddenException(
        'Utilisez « Changer mon mot de passe » dans Mon compte pour votre propre mot de passe.',
      );
    }
    const passwordHash = await this.crypto.hashPassword(dto.password);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true },
    });
    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action: AuditAction.PASSWORD_RESET,
      entityType: 'User',
      entityId: id,
      after: { reinitialise_par: actorId },
    });
    return { id: updated.id, mustChangePassword: true };
  }
}

@Controller('api/internal/users')
@RequireRealm(Realm.INTERNAL)
export class UserAdminController {
  constructor(private readonly service: UserAdminService) {}

  // Hors du registre d'écrans dynamique (comme /acces-ecrans) : pas de
  // @Screen() ici, délibérément — voir l'en-tête de ce fichier.
  @Get()
  @Roles(UserRole.DG, UserRole.IT_ADMIN)
  list() {
    return this.service.list();
  }

  @Post()
  @Roles(UserRole.DG, UserRole.IT_ADMIN)
  create(@Body() dto: CreateUserDto, @Req() req: { auth: { sub: string } }) {
    return this.service.create(dto, req.auth.sub);
  }

  @Patch(':id')
  @Roles(UserRole.DG, UserRole.IT_ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.update(id, dto, req.auth.sub);
  }

  @Patch(':id/reset-password')
  @Roles(UserRole.DG, UserRole.IT_ADMIN)
  resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
    @Req() req: { auth: { sub: string } },
  ) {
    return this.service.resetPassword(id, dto, req.auth.sub);
  }
}
