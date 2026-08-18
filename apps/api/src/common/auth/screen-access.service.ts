import { BadRequestException, Injectable } from '@nestjs/common';
import { ScreenAccessOverride, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SCREEN_REGISTRY } from './screen-registry';

/**
 * Résout la visibilité effective d'un écran par rôle, dérogations DG
 * comprises (§ paramétrage 17/08).
 *
 * ⚠️ CACHE EN PROCESSUS, PAS REDIS.
 *
 *    La table fait au plus (nombre de rôles × nombre d'écrans) lignes - une
 *    grosse centaine dans le pire cas - et n'est écrite que par l'écran
 *    d'administration du DG, jamais en flux. Un cache mémoire invalidé à
 *    l'écriture suffit et évite une dépendance Redis pour ce qui reste, en
 *    volume, un paramétrage statique. À revoir si l'API tourne un jour en
 *    plusieurs instances : ce cache ne se propage pas entre processus.
 */
@Injectable()
export class ScreenAccessService {
  constructor(private readonly prisma: PrismaService) {}

  private cache: Map<string, ScreenAccessOverride> | null = null;

  private async overrides(): Promise<Map<string, ScreenAccessOverride>> {
    if (!this.cache) {
      const rows = await this.prisma.roleScreenAccess.findMany();
      this.cache = new Map(rows.map((r) => [`${r.role}:${r.screenKey}`, r.override]));
    }
    return this.cache;
  }

  invalidate(): void {
    this.cache = null;
  }

  /**
   * Visibilité effective pour une route marquée `@Screen(screenKey)`.
   *
   * `staticAllowed` porte ce que dirait le `@Roles()` de la route SANS
   * dérogation - c'est le comportement d'aujourd'hui, inchangé en l'absence
   * de toute ligne dans `role_screen_access`. Une dérogation explicite
   * l'emporte, dans un sens comme dans l'autre.
   */
  async isVisibleForRoute(role: UserRole, screenKey: string, staticAllowed: boolean): Promise<boolean> {
    const overrides = await this.overrides();
    const override = overrides.get(`${role}:${screenKey}`);
    if (override === ScreenAccessOverride.VISIBLE) return true;
    if (override === ScreenAccessOverride.MASQUE) return false;
    return staticAllowed;
  }

  /**
   * Écrans visibles pour un rôle - alimente le menu et les gardes de route du
   * frontend. S'appuie sur `defaultRoles` du registre : il DOIT rester le
   * miroir exact du `@Roles()` réellement posé sur la route de lecture de
   * chaque écran, faute de quoi le menu promettrait un écran que le garde
   * refuserait - ou l'inverse.
   */
  async visibleScreens(role: UserRole): Promise<string[]> {
    const overrides = await this.overrides();
    const visible: string[] = [];
    for (const screen of SCREEN_REGISTRY) {
      const override = overrides.get(`${role}:${screen.key}`);
      const defaultVisible = screen.defaultRoles === null || screen.defaultRoles.includes(role);
      const effective =
        override === ScreenAccessOverride.VISIBLE
          ? true
          : override === ScreenAccessOverride.MASQUE
            ? false
            : defaultVisible;
      if (effective) visible.push(screen.key);
    }
    return visible;
  }

  /** Matrice complète écran × rôle pour l'écran d'administration. */
  async matrix(): Promise<
    {
      key: string;
      label: string;
      group: string;
      roles: Record<
        UserRole,
        { defaultVisible: boolean; override: ScreenAccessOverride | null; effective: boolean }
      >;
    }[]
  > {
    const overrides = await this.overrides();
    const allRoles = Object.values(UserRole);
    return SCREEN_REGISTRY.map((screen) => {
      const roles = {} as Record<
        UserRole,
        { defaultVisible: boolean; override: ScreenAccessOverride | null; effective: boolean }
      >;
      for (const role of allRoles) {
        const defaultVisible = screen.defaultRoles === null || screen.defaultRoles.includes(role);
        const override = overrides.get(`${role}:${screen.key}`) ?? null;
        const effective =
          override === ScreenAccessOverride.VISIBLE
            ? true
            : override === ScreenAccessOverride.MASQUE
              ? false
              : defaultVisible;
        roles[role] = { defaultVisible, override, effective };
      }
      return { key: screen.key, label: screen.label, group: screen.group, roles };
    });
  }

  async setOverride(
    role: UserRole,
    screenKey: string,
    override: ScreenAccessOverride | null,
    actorId: string,
  ): Promise<void> {
    if (!SCREEN_REGISTRY.some((s) => s.key === screenKey)) {
      // Refuser plutôt qu'écrire une ligne orpheline que l'écran
      // d'administration ne saurait plus jamais afficher.
      throw new BadRequestException(`Écran inconnu : ${screenKey}.`);
    }
    if (override === null) {
      await this.prisma.roleScreenAccess.deleteMany({ where: { role, screenKey } });
    } else {
      await this.prisma.roleScreenAccess.upsert({
        where: { role_screenKey: { role, screenKey } },
        create: { role, screenKey, override, updatedById: actorId },
        update: { override, updatedById: actorId },
      });
    }
    this.invalidate();
  }
}
