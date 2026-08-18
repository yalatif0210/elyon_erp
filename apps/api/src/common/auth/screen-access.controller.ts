import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ActorType, AuditAction, ScreenAccessOverride, UserRole } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { Realm, RequireRealm, Roles } from './realm';
import { ScreenAccessService } from './screen-access.service';

class SetScreenAccessDto {
  @IsEnum(UserRole) role!: UserRole;
  /** Vérifiée en service contre `SCREEN_REGISTRY` - pas de `@IsEnum` ici, la liste vit à un seul endroit. */
  @IsString() screenKey!: string;
  /** Absent ou `null` = retour à l'hérité (supprime la dérogation). */
  @IsOptional() @IsEnum(ScreenAccessOverride) override?: ScreenAccessOverride;
}

/**
 * Paramétrage DG de la visibilité des écrans par rôle (§ paramétrage 17/08).
 *
 * Volontairement hors de `RoleScreenAccess` lui-même : cet écran ne porte
 * PAS de `@Screen()` et reste sur un `@Roles(DG)` fixe, immunisé contre la
 * table qu'il édite - sans quoi un DG pourrait se retirer l'accès au seul
 * endroit qui permet de se le redonner.
 */
@Controller('api/internal/screen-access')
@RequireRealm(Realm.INTERNAL)
export class ScreenAccessController {
  constructor(
    private readonly screenAccess: ScreenAccessService,
    private readonly audit: AuditService,
  ) {}

  /** Écrans visibles pour l'acteur courant - alimente le menu et les gardes de route. */
  @Get('me')
  async me(@Req() req: { auth: { role?: UserRole } }): Promise<{ screens: string[] }> {
    if (!req.auth.role) return { screens: [] };
    return { screens: await this.screenAccess.visibleScreens(req.auth.role) };
  }

  @Get()
  @Roles(UserRole.DG)
  matrix() {
    return this.screenAccess.matrix();
  }

  @Patch()
  @Roles(UserRole.DG)
  async setOverride(
    @Body() dto: SetScreenAccessDto,
    @Req() req: { auth: { sub: string } },
  ): Promise<{ role: UserRole; screenKey: string; override: ScreenAccessOverride | null }> {
    await this.screenAccess.setOverride(dto.role, dto.screenKey, dto.override ?? null, req.auth.sub);

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId: req.auth.sub,
      action: AuditAction.UPDATE,
      entityType: 'RoleScreenAccess',
      entityId: `${dto.role}:${dto.screenKey}`,
      after: { role: dto.role, screenKey: dto.screenKey, override: dto.override ?? null },
    });

    return { role: dto.role, screenKey: dto.screenKey, override: dto.override ?? null };
  }
}
