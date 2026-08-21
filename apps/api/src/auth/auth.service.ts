import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ActorType, AuditAction, UserRole } from '@prisma/client';
import { authenticator } from 'otplib';
import { AuditService } from '../common/audit/audit.service';
import { Realm } from '../common/auth/realm';
import { LOGIN_POLICY, TOKEN_TTL } from '../common/config/env.config';
import { SettingsService } from '../common/config/settings.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TokenPair, TokenService } from './token.service';

/**
 * Rôles pour lesquels le second facteur est obligatoire (§ 1.4) — REPLI.
 *
 * La liste effective est lue en base sous `TOTP_REQUIRED_ROLES` : l'ajout
 * d'un rôle à l'obligation de 2FA est une décision de sécurité interne, elle
 * ne doit pas attendre une livraison. Ces quatre rôles restent le filet si la
 * ligne disparaît.
 */
const TOTP_REQUIRED_ROLES_FALLBACK: UserRole[] = [
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
    private readonly settings: SettingsService,
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
    const totpRequired = (await this.totpRequiredRoles()).includes(user!.role);
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
        // Dérivé de la durée du jeton de rafraîchissement, jamais recopié :
        // écrite deux fois, cette durée divergeait dès qu'on touchait à
        // TOKEN_TTL — le journal des sessions aurait affiché des connexions
        // encore ouvertes dont le jeton était mort, ou l'inverse.
        expiresAt: new Date(Date.now() + TOKEN_TTL.refreshSeconds * 1000),
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
    // Compte inexistant ou désactivé : message générique — révéler lequel
    // des deux permettrait de deviner quels courriels ont un compte.
    if (!account || !account.isActive) {
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

    // Compte verrouillé : message EXPLICITE, avec l'heure de déblocage.
    //
    // ⚠️ Fondu jusqu'ici dans le même message générique que « mot de passe
    //    faux » — un titulaire qui retapait le bon mot de passe pendant le
    //    verrou recevait la même phrase que s'il s'était trompé, sans aucun
    //    moyen de savoir qu'attendre suffisait. Constaté en direct : un
    //    agent terrain jugé « bloqué sans raison » alors que son compte
    //    était simplement verrouillé depuis un échec antérieur.
    if (account.lockedUntil && account.lockedUntil > new Date()) {
      await this.audit.record({
        actorType: AuditService.actorTypeFor(realm),
        actorLabel: email,
        action: AuditAction.LOGIN_FAILED,
        entityType: realm,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      const heure = account.lockedUntil.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Africa/Abidjan',
      });
      throw new UnauthorizedException(
        `Compte verrouillé après plusieurs échecs de connexion. Réessayez après ${heure}.`,
      );
    }
  }

  private async verifyPassword(
    passwordHash: string,
    password: string,
    onFailure: () => Promise<void>,
  ): Promise<void> {
    const ok = await this.crypto.verifyPassword(passwordHash, password);
    if (!ok) {
      await onFailure();
      throw new UnauthorizedException('Identifiants invalides');
    }
  }

  /**
   * Rôles soumis au second facteur, tels que paramétrés (§ 1.4).
   *
   * ⚠️ UN RÔLE INCONNU EST ÉCARTÉ, PAS ACCEPTÉ. Une faute de frappe — « DGG »
   *    au lieu de « DG » — dispenserait sinon la direction de second facteur
   *    sans que rien ne le signale. Et si PLUS AUCUNE entrée n'est valide, on
   *    revient au repli : la 2FA obligatoire ne se désactive pas par accident
   *    de saisie.
   */
  private async totpRequiredRoles(): Promise<UserRole[]> {
    const configured = await this.settings.list(
      'TOTP_REQUIRED_ROLES',
      TOTP_REQUIRED_ROLES_FALLBACK,
    );
    const known = new Set<string>(Object.values(UserRole));
    const kept: UserRole[] = [];
    const rejected: string[] = [];

    for (const entry of configured) {
      const role = entry.toUpperCase();
      if (known.has(role)) kept.push(role as UserRole);
      else rejected.push(entry);
    }

    if (rejected.length > 0) {
      this.logger.warn(
        `TOTP_REQUIRED_ROLES — rôle(s) inconnu(s) ignoré(s) : ${rejected.join(', ')}`,
      );
    }
    if (kept.length === 0) {
      this.logger.warn('TOTP_REQUIRED_ROLES illisible — repli sur la liste par défaut.');
      return TOTP_REQUIRED_ROLES_FALLBACK;
    }
    return kept;
  }

  /** Incrémente le compteur d'échecs et verrouille au seuil. */
  private async registerFailure(
    realm: Realm,
    subjectId: string,
    email: string,
    ctx: LoginContext,
  ): Promise<void> {
    const [rawAttempts, rawMinutes] = await Promise.all([
      this.settings.number('LOGIN_MAX_FAILED_ATTEMPTS', LOGIN_POLICY.maxFailedAttempts),
      this.settings.number('LOGIN_LOCK_MINUTES', LOGIN_POLICY.lockMinutes),
    ]);

    // ⚠️ Les deux bornes basses ne sont pas décoratives. Un seuil à 0
    //    verrouillerait tout le monde dès la première faute de frappe ; une
    //    durée à 0 poserait une date de déblocage déjà passée, c'est-à-dire
    //    aucun verrouillage du tout — un compte serait alors attaquable
    //    indéfiniment, sans que le paramétrage n'ait l'air désactivé.
    const maxFailedAttempts = Math.max(1, Math.floor(rawAttempts));
    const lockMinutes = Math.max(1, Math.floor(rawMinutes));
    const lockUntil = new Date(Date.now() + lockMinutes * 60_000);

    if (realm === Realm.INTERNAL) {
      const updated = await this.prisma.user.update({
        where: { id: subjectId },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true },
      });
      if (updated.failedLoginAttempts >= maxFailedAttempts) {
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
      if (updated.failedLoginAttempts >= maxFailedAttempts) {
        await this.prisma.portalUser.update({
          where: { id: subjectId },
          data: { lockedUntil: lockUntil, failedLoginAttempts: 0 },
        });
      }
    } else {
      // ⚠️ VERROUILLAIT AUPARAVANT SUR LE TOUT PREMIER ÉCHEC — sans seuil,
      //    contrairement aux deux branches ci-dessus. `FieldUser` n'avait
      //    d'ailleurs même pas de colonne `failed_login_attempts` : ce
      //    déséquilibre n'était pas un raccourci délibéré, un oubli. Constaté
      //    en direct : une simple faute de frappe sur une tablette terrain
      //    verrouillait 15 minutes, rendant TOUTE tentative suivante — même
      //    avec le bon mot de passe — indiscernable d'un compte réellement
      //    bloqué. Aligné sur le même seuil que les deux autres réalmes.
      const updated = await this.prisma.fieldUser.update({
        where: { id: subjectId },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true },
      });
      if (updated.failedLoginAttempts >= maxFailedAttempts) {
        await this.prisma.fieldUser.update({
          where: { id: subjectId },
          data: { lockedUntil: lockUntil, failedLoginAttempts: 0 },
        });
      }
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

  // =========================================================================
  //  Changement de mot de passe
  // =========================================================================

  /**
   * Changement de mot de passe, tous réalms confondus.
   *
   * Trois exigences, chacune pour une raison précise :
   *
   *   1. L'ANCIEN MOT DE PASSE EST REDEMANDÉ, alors même que la session est
   *      authentifiée. Un poste laissé ouvert ne doit pas suffire à
   *      s'approprier un compte.
   *
   *   2. LE NOUVEAU DOIT DIFFÉRER DE L'ANCIEN. Sans ce contrôle, l'obligation
   *      de changement se satisfait en resaisissant le même — et le mot de
   *      passe provisoire distribué à tous survit indéfiniment.
   *
   *   3. TOUTES LES AUTRES SESSIONS SONT RÉVOQUÉES. Changer son mot de passe
   *      après un soupçon de compromission ne sert à rien si le jeton déjà
   *      volé continue de fonctionner jusqu'à son expiration naturelle.
   */
  async changePassword(
    realm: Realm,
    subjectId: string,
    currentSid: string,
    currentPassword: string,
    newPassword: string,
    ctx: LoginContext,
  ): Promise<{ revokedSessions: number }> {
    const account = await this.loadCredentials(realm, subjectId);

    const ok = await this.crypto.verifyPassword(account.passwordHash, currentPassword);
    if (!ok) {
      await this.audit.record({
        actorType: AuditService.actorTypeFor(realm),
        actorId: subjectId,
        action: AuditAction.PASSWORD_RESET,
        entityType: 'Credentials',
        entityId: subjectId,
        after: { refus: 'mot de passe actuel incorrect' },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new UnauthorizedException('Mot de passe actuel incorrect');
    }

    const reused = await this.crypto.verifyPassword(account.passwordHash, newPassword);
    if (reused) {
      throw new BadRequestException(
        'Le nouveau mot de passe doit être différent de l’actuel.',
      );
    }

    const passwordHash = await this.crypto.hashPassword(newPassword);
    await this.persistPassword(realm, subjectId, passwordHash);

    // La session courante survit — l'utilisateur vient de prouver qui il est.
    // Toutes les autres tombent.
    const revoked = await this.tokens.revokeAllExcept(realm, subjectId, currentSid);

    await this.audit.record({
      actorType: AuditService.actorTypeFor(realm),
      actorId: subjectId,
      action: AuditAction.PASSWORD_RESET,
      entityType: 'Credentials',
      entityId: subjectId,
      after: { sessionsRevoquees: revoked },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { revokedSessions: revoked };
  }

  /** Empreinte du mot de passe, quel que soit le réalm. */
  private async loadCredentials(
    realm: Realm,
    subjectId: string,
  ): Promise<{ passwordHash: string }> {
    if (realm === Realm.INTERNAL) {
      return this.prisma.user.findUniqueOrThrow({
        where: { id: subjectId },
        select: { passwordHash: true },
      });
    }
    if (realm === Realm.FIELD) {
      return this.prisma.fieldUser.findUniqueOrThrow({
        where: { id: subjectId },
        select: { passwordHash: true },
      });
    }
    return this.prisma.portalUser.findUniqueOrThrow({
      where: { id: subjectId },
      select: { passwordHash: true },
    });
  }

  /** L'obligation de changement tombe par la même écriture. */
  private async persistPassword(
    realm: Realm,
    subjectId: string,
    passwordHash: string,
  ): Promise<void> {
    const data = { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() };
    if (realm === Realm.INTERNAL) {
      await this.prisma.user.update({ where: { id: subjectId }, data });
      return;
    }
    if (realm === Realm.FIELD) {
      await this.prisma.fieldUser.update({ where: { id: subjectId }, data });
      return;
    }
    await this.prisma.portalUser.update({ where: { id: subjectId }, data });
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
