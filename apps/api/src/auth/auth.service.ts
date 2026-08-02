import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { ActorType, AuditAction, UserRole } from '@prisma/client';
import { authenticator } from 'otplib';
import { AuditService } from '../common/audit/audit.service';
import { Realm } from '../common/auth/realm';
import { LOGIN_POLICY } from '../common/config/env.config';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TokenPair, TokenService } from './token.service';

/** Rôles pour lesquels le second facteur est obligatoire (§ 1.4). */
const TOTP_REQUIRED_ROLES: UserRole[] = [
  UserRole.DG,
  UserRole.FINANCE_CFO,
  UserRole.ACCOUNTANT,
  UserRole.IT_ADMIN,
];

export interface LoginResult extends TokenPair {
  mustChangePassword: boolean;
  /** Vrai quand le compte doit enrôler son second facteur avant d'aller plus loin. */
  totpEnrollmentRequired: boolean;
  profile: { id: string; fullName: string; email: string; role?: string; partnerId?: string };
}

export interface LoginContext {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  // =========================================================================
  //  Connexion — réalm interne
  // =========================================================================

  async loginInternal(
    email: string,
    password: string,
    totpCode: string | undefined,
    ctx: LoginContext,
  ): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    await this.assertUsable(user, email, Realm.INTERNAL, ctx);

    await this.verifyPassword(user!.passwordHash, password, () =>
      this.registerFailure(Realm.INTERNAL, user!.id, email, ctx),
    );

    // --- Second facteur ------------------------------------------------------
    const totpRequired = TOTP_REQUIRED_ROLES.includes(user!.role);
    if (user!.totpEnabled) {
      this.verifyTotp(user!.totpSecretEnc, totpCode);
    } else if (totpRequired) {
      // Le compte n'a pas encore enrôlé son second facteur. On délivre une
      // session, mais l'appelant doit la considérer comme contrainte :
      // l'enrôlement est la seule action autorisée (garde applicative).
      this.logger.warn(`2FA obligatoire non enrôlée — ${email} (${user!.role})`);
    }

    await this.prisma.user.update({
      where: { id: user!.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const pair = await this.tokens.issue({
      id: user!.id,
      realm: Realm.INTERNAL,
      role: user!.role,
    });

    // Trace durable de la connexion interne, à des fins d'audit et de
    // visualisation des sessions actives. Redis reste la source de vérité
    // sur la validité du jeton.
    await this.prisma.userSession.create({
      data: {
        userId: user!.id,
        tokenHash: this.crypto.hashToken(pair.refreshToken),
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent?.slice(0, 512) ?? null,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });

    await this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId: user!.id,
      actorLabel: user!.email,
      action: AuditAction.LOGIN,
      entityType: 'User',
      entityId: user!.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      ...pair,
      mustChangePassword: user!.mustChangePassword,
      totpEnrollmentRequired: totpRequired && !user!.totpEnabled,
      profile: {
        id: user!.id,
        fullName: user!.fullName,
        email: user!.email,
        role: user!.role,
      },
    };
  }

  // =========================================================================
  //  Connexion — réalm portail client
  // =========================================================================

  async loginPortal(email: string, password: string, ctx: LoginContext): Promise<LoginResult> {
    const account = await this.prisma.portalUser.findUnique({
      where: { email: email.toLowerCase() },
      include: { partner: { select: { id: true, isActive: true, legalName: true } } },
    });
    await this.assertUsable(account, email, Realm.PORTAL, ctx);

    if (!account!.partner.isActive) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    await this.verifyPassword(account!.passwordHash, password, () =>
      this.registerFailure(Realm.PORTAL, account!.id, email, ctx),
    );

    await this.prisma.portalUser.update({
      where: { id: account!.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const pair = await this.tokens.issue({
      id: account!.id,
      realm: Realm.PORTAL,
      // Le cloisonnement par ligne est porté par le jeton : aucune requête
      // portail ne peut viser un autre tiers, même en manipulant l'URL.
      partnerId: account!.partnerId,
    });

    await this.audit.record({
      actorType: ActorType.PORTAL_USER,
      actorId: account!.id,
      actorLabel: account!.email,
      action: AuditAction.LOGIN,
      entityType: 'PortalUser',
      entityId: account!.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      ...pair,
      mustChangePassword: account!.mustChangePassword,
      totpEnrollmentRequired: false,
      profile: {
        id: account!.id,
        fullName: account!.fullName,
        email: account!.email,
        partnerId: account!.partnerId,
      },
    };
  }

  // =========================================================================
  //  Connexion — réalm terrain
  // =========================================================================

  async loginField(
    email: string,
    password: string,
    totpCode: string | undefined,
    deviceId: string | undefined,
    ctx: LoginContext,
  ): Promise<LoginResult> {
    const agent = await this.prisma.fieldUser.findUnique({ where: { email: email.toLowerCase() } });
    await this.assertUsable(agent, email, Realm.FIELD, ctx);

    await this.verifyPassword(agent!.passwordHash, password, () =>
      this.registerFailure(Realm.FIELD, agent!.id, email, ctx),
    );

    if (agent!.totpEnabled) {
      this.verifyTotp(agent!.totpSecretEnc, totpCode);
    }

    // L'appareil durci est nominatif : une connexion depuis un autre appareil
    // est journalisée. On ne la refuse pas — un remplacement de tablette est
    // légitime — mais elle doit être visible.
    if (deviceId && agent!.assignedDeviceId && agent!.assignedDeviceId !== deviceId) {
      this.logger.warn(`Connexion terrain depuis un appareil non assigné — ${email}`);
      await this.audit.record({
        actorType: ActorType.FIELD_USER,
        actorId: agent!.id,
        actorLabel: agent!.email,
        action: AuditAction.LOGIN,
        entityType: 'FieldUser',
        entityId: agent!.id,
        after: { deviceMismatch: true, presentedDeviceId: deviceId },
        ipAddress: ctx.ipAddress,
      });
    }

    await this.prisma.fieldUser.update({
      where: { id: agent!.id },
      data: { lockedUntil: null, lastLoginAt: new Date() },
    });

    const pair = await this.tokens.issue({
      id: agent!.id,
      realm: Realm.FIELD,
      role: agent!.role,
    });

    await this.audit.record({
      actorType: ActorType.FIELD_USER,
      actorId: agent!.id,
      actorLabel: agent!.email,
      action: AuditAction.LOGIN,
      entityType: 'FieldUser',
      entityId: agent!.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      ...pair,
      mustChangePassword: agent!.mustChangePassword,
      totpEnrollmentRequired: false,
      profile: {
        id: agent!.id,
        fullName: agent!.fullName,
        email: agent!.email,
        role: agent!.role,
      },
    };
  }

  // =========================================================================
  //  Session
  // =========================================================================

  async refresh(refreshToken: string): Promise<TokenPair> {
    const { pair } = await this.tokens.rotate(refreshToken);
    return pair;
  }

  async logout(sid: string, actorType: ActorType, actorId: string): Promise<void> {
    await this.tokens.revoke(sid);
    await this.audit.record({
      actorType,
      actorId,
      action: AuditAction.LOGOUT,
      entityType: 'Session',
      entityId: sid,
    });
  }

  // =========================================================================
  //  Second facteur
  // =========================================================================

  /** Génère un secret et l'URI d'enrôlement. Le secret n'est stocké qu'une fois confirmé. */
  async beginTotpEnrollment(realm: Realm, subjectId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const secret = authenticator.generateSecret();
    const label = await this.subjectLabel(realm, subjectId);
    const otpauthUrl = authenticator.keyuri(label, 'Elyon Trading ERP', secret);

    // Le secret est chiffré et posé, mais totpEnabled reste faux : tant que
    // l'utilisateur n'a pas prouvé qu'il sait générer un code, activer le
    // second facteur l'enfermerait dehors.
    const enc = this.crypto.encryptSecret(secret);
    if (realm === Realm.INTERNAL) {
      await this.prisma.user.update({ where: { id: subjectId }, data: { totpSecretEnc: enc } });
    } else if (realm === Realm.FIELD) {
      await this.prisma.fieldUser.update({ where: { id: subjectId }, data: { totpSecretEnc: enc } });
    } else {
      await this.prisma.portalUser.update({ where: { id: subjectId }, data: { totpSecretEnc: enc } });
    }

    return { secret, otpauthUrl };
  }

  async confirmTotpEnrollment(realm: Realm, subjectId: string, code: string): Promise<void> {
    const encrypted = await this.storedTotpSecret(realm, subjectId);
    this.verifyTotp(encrypted, code);

    if (realm === Realm.INTERNAL) {
      await this.prisma.user.update({ where: { id: subjectId }, data: { totpEnabled: true } });
    } else if (realm === Realm.FIELD) {
      await this.prisma.fieldUser.update({ where: { id: subjectId }, data: { totpEnabled: true } });
    } else {
      await this.prisma.portalUser.update({ where: { id: subjectId }, data: { totpEnabled: true } });
    }

    await this.audit.record({
      actorType: AuditService.actorTypeFor(realm),
      actorId: subjectId,
      action: AuditAction.UPDATE,
      entityType: 'TotpEnrollment',
      entityId: subjectId,
      after: { totpEnabled: true },
    });
  }

  // =========================================================================
  //  Internes
  // =========================================================================

  /**
   * Contrôles communs à tous les réalms. Le message est TOUJOURS le même —
   * « Identifiants invalides » — que le compte n'existe pas, soit désactivé ou
   * verrouillé : distinguer ces cas donnerait un oracle d'énumération de comptes.
   */
  private async assertUsable(
    account: { isActive: boolean; lockedUntil: Date | null } | null,
    email: string,
    realm: Realm,
    ctx: LoginContext,
  ): Promise<void> {
    if (!account || !account.isActive || (account.lockedUntil && account.lockedUntil > new Date())) {
      await this.audit.record({
        actorType: AuditService.actorTypeFor(realm),
        actorLabel: email,
        action: AuditAction.LOGIN_FAILED,
        entityType: realm,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new UnauthorizedException('Identifiants invalides');
    }
  }

  private async verifyPassword(
    hash: string,
    password: string,
    onFailure: () => Promise<void>,
  ): Promise<void> {
    const ok = await verify(hash, password).catch(() => false);
    if (!ok) {
      await onFailure();
      throw new UnauthorizedException('Identifiants invalides');
    }
  }

  /** Incrémente le compteur d'échecs et verrouille au seuil. */
  private async registerFailure(
    realm: Realm,
    subjectId: string,
    email: string,
    ctx: LoginContext,
  ): Promise<void> {
    const lockUntil = new Date(Date.now() + LOGIN_POLICY.lockMinutes * 60_000);

    if (realm === Realm.INTERNAL) {
      const updated = await this.prisma.user.update({
        where: { id: subjectId },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true },
      });
      if (updated.failedLoginAttempts >= LOGIN_POLICY.maxFailedAttempts) {
        await this.prisma.user.update({
          where: { id: subjectId },
          data: { lockedUntil: lockUntil, failedLoginAttempts: 0 },
        });
      }
    } else if (realm === Realm.PORTAL) {
      const updated = await this.prisma.portalUser.update({
        where: { id: subjectId },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true },
      });
      if (updated.failedLoginAttempts >= LOGIN_POLICY.maxFailedAttempts) {
        await this.prisma.portalUser.update({
          where: { id: subjectId },
          data: { lockedUntil: lockUntil, failedLoginAttempts: 0 },
        });
      }
    } else {
      await this.prisma.fieldUser.update({
        where: { id: subjectId },
        data: { lockedUntil: lockUntil },
      });
    }

    await this.audit.record({
      actorType: AuditService.actorTypeFor(realm),
      actorId: subjectId,
      actorLabel: email,
      action: AuditAction.LOGIN_FAILED,
      entityType: realm,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private verifyTotp(encryptedSecret: string | null, code: string | undefined): void {
    if (!encryptedSecret) {
      throw new UnauthorizedException('Second facteur non configuré');
    }
    if (!code) {
      throw new UnauthorizedException('Code de second facteur requis');
    }
    const secret = this.crypto.decryptSecret(encryptedSecret);
    // otplib tolère une fenêtre d'un pas de part et d'autre : les horloges
    // dérivent, et un refus sur 2 secondes d'écart serait ingérable.
    authenticator.options = { window: 1 };
    if (!authenticator.check(code, secret)) {
      throw new UnauthorizedException('Code de second facteur invalide');
    }
  }

  private async storedTotpSecret(realm: Realm, subjectId: string): Promise<string | null> {
    if (realm === Realm.INTERNAL) {
      return (
        await this.prisma.user.findUniqueOrThrow({
          where: { id: subjectId },
          select: { totpSecretEnc: true },
        })
      ).totpSecretEnc;
    }
    if (realm === Realm.FIELD) {
      return (
        await this.prisma.fieldUser.findUniqueOrThrow({
          where: { id: subjectId },
          select: { totpSecretEnc: true },
        })
      ).totpSecretEnc;
    }
    return (
      await this.prisma.portalUser.findUniqueOrThrow({
        where: { id: subjectId },
        select: { totpSecretEnc: true },
      })
    ).totpSecretEnc;
  }

  private async subjectLabel(realm: Realm, subjectId: string): Promise<string> {
    if (realm === Realm.INTERNAL) {
      return (await this.prisma.user.findUniqueOrThrow({ where: { id: subjectId } })).email;
    }
    if (realm === Realm.FIELD) {
      return (await this.prisma.fieldUser.findUniqueOrThrow({ where: { id: subjectId } })).email;
    }
    return (await this.prisma.portalUser.findUniqueOrThrow({ where: { id: subjectId } })).email;
  }
}
