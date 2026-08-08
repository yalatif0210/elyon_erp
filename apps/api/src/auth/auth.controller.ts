import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ActorType } from '@prisma/client';
import { AuditService } from '../common/audit/audit.service';
import { Public, Realm, RequireRealm } from '../common/auth/realm';
import { RATE_WINDOW_MS, loginRateLimit } from '../common/config/rate-limits';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  FieldLoginDto,
  LoginDto,
  RefreshDto,
  TotpConfirmDto,
} from './auth.dto';

/**
 * Limitation de débit sur la connexion — LOGIN_RATE_PER_MINUTE, par IP.
 *
 * La protection contre les essais de mot de passe en série ne repose PAS sur
 * ce compteur : elle repose sur le verrouillage PAR COMPTE
 * (LOGIN_MAX_FAILED_ATTEMPTS échecs, puis LOGIN_LOCK_MINUTES de blocage).
 * C'est lui qui protège une cible désignée, et il ne dépend pas de l'adresse
 * d'où viennent les tentatives.
 *
 * Le compteur par IP ne sert qu'à contenir l'abus volumétrique. Le régler
 * trop bas se retourne contre l'entreprise : tout un bureau derrière une seule
 * sortie internet partage le même compteur, et un utilisateur qui se trompe
 * trois fois bloque ses collègues.
 *
 * ⚠️ La limite est passée en FONCTION, pas en nombre. Le décorateur est
 *    évalué à l'import du module — bien avant la base — et fige tout nombre
 *    qu'on lui donne ; la fonction, elle, est résolue à chaque requête et rend
 *    la valeur lue au démarrage. Changer LOGIN_RATE_PER_MINUTE exige donc un
 *    redémarrage de l'API, comme le dit la description du paramètre.
 */
const LOGIN_THROTTLE = { default: { limit: () => loginRateLimit(), ttl: RATE_WINDOW_MS } };

function context(req: any) {
  return {
    ipAddress: req.ip ?? req.socket?.remoteAddress,
    userAgent: req.headers?.['user-agent'],
  };
}

// ===========================================================================
//  Réalm INTERNE
// ===========================================================================

@Controller('api/internal/auth')
@RequireRealm(Realm.INTERNAL)
export class InternalAuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.loginInternal(dto.email, dto.password, dto.totpCode, context(req));
  }

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: any): Promise<void> {
    await this.auth.logout(req.auth.sid, ActorType.INTERNAL_USER, req.auth.sub);
  }

  @Get('me')
  me(@Req() req: any) {
    return { id: req.auth.sub, realm: req.auth.realm, role: req.auth.role };
  }

  /** Enrôlement du second facteur — obligatoire pour DG, CFO, comptable, IT. */
  @Post('totp/enroll')
  @HttpCode(HttpStatus.OK)
  enroll(@Req() req: any) {
    return this.auth.beginTotpEnrollment(Realm.INTERNAL, req.auth.sub);
  }

  @Post('totp/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirm(@Body() dto: TotpConfirmDto, @Req() req: any): Promise<void> {
    await this.auth.confirmTotpEnrollment(Realm.INTERNAL, req.auth.sub, dto.code);
  }

  /**
   * Changement de mot de passe.
   *
   * Tous les comptes naissent avec un mot de passe provisoire et
   * `mustChangePassword`. Sans cette route, l'obligation affichée en tête
   * d'écran était impossible à satisfaire — on exigeait une action qui
   * n'existait pas.
   *
   * Volontairement HORS de la limitation de débit de connexion : la session
   * est déjà authentifiée, et brider quelqu'un qui se trompe en resaisissant
   * son mot de passe actuel n'ajoute aucune protection.
   */
  @Patch('password')
  @HttpCode(HttpStatus.OK)
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: any) {
    return this.auth.changePassword(
      Realm.INTERNAL,
      req.auth.sub,
      req.auth.sid,
      dto.currentPassword,
      dto.newPassword,
      context(req),
    );
  }
}

// ===========================================================================
//  Réalm PORTAIL CLIENT
//  Aucune donnée interne n'est accessible depuis ce périmètre : le jeton
//  émis ici porte un partnerId et sera refusé sur /api/internal.
// ===========================================================================

@Controller('api/portal/auth')
@RequireRealm(Realm.PORTAL)
export class PortalAuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.loginPortal(dto.email, dto.password, context(req));
  }

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: any): Promise<void> {
    await this.auth.logout(req.auth.sid, ActorType.PORTAL_USER, req.auth.sub);
  }

  @Get('me')
  me(@Req() req: any) {
    return { id: req.auth.sub, realm: req.auth.realm, partnerId: req.auth.partnerId };
  }

  /**
   * Changement de mot de passe.
   *
   * Tous les comptes naissent avec un mot de passe provisoire et
   * `mustChangePassword`. Sans cette route, l'obligation affichée en tête
   * d'écran était impossible à satisfaire — on exigeait une action qui
   * n'existait pas.
   *
   * Volontairement HORS de la limitation de débit de connexion : la session
   * est déjà authentifiée, et brider quelqu'un qui se trompe en resaisissant
   * son mot de passe actuel n'ajoute aucune protection.
   */
  @Patch('password')
  @HttpCode(HttpStatus.OK)
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: any) {
    return this.auth.changePassword(
      Realm.PORTAL,
      req.auth.sub,
      req.auth.sid,
      dto.currentPassword,
      dto.newPassword,
      context(req),
    );
  }
}

// ===========================================================================
//  Réalm TERRAIN
//  Agents d'opération et contrôleur HSE. Aucun accès aux données commerciales.
// ===========================================================================

@Controller('api/field/auth')
@RequireRealm(Realm.FIELD)
export class FieldAuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: FieldLoginDto, @Req() req: any) {
    return this.auth.loginField(dto.email, dto.password, dto.totpCode, dto.deviceId, context(req));
  }

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: any): Promise<void> {
    await this.auth.logout(req.auth.sid, ActorType.FIELD_USER, req.auth.sub);
  }

  @Get('me')
  me(@Req() req: any) {
    return { id: req.auth.sub, realm: req.auth.realm, role: req.auth.role };
  }

  @Post('totp/enroll')
  @HttpCode(HttpStatus.OK)
  enroll(@Req() req: any) {
    return this.auth.beginTotpEnrollment(Realm.FIELD, req.auth.sub);
  }

  @Post('totp/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirm(@Body() dto: TotpConfirmDto, @Req() req: any): Promise<void> {
    await this.auth.confirmTotpEnrollment(Realm.FIELD, req.auth.sub, dto.code);
  }

  /**
   * Changement de mot de passe.
   *
   * Tous les comptes naissent avec un mot de passe provisoire et
   * `mustChangePassword`. Sans cette route, l'obligation affichée en tête
   * d'écran était impossible à satisfaire — on exigeait une action qui
   * n'existait pas.
   *
   * Volontairement HORS de la limitation de débit de connexion : la session
   * est déjà authentifiée, et brider quelqu'un qui se trompe en resaisissant
   * son mot de passe actuel n'ajoute aucune protection.
   */
  @Patch('password')
  @HttpCode(HttpStatus.OK)
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: any) {
    return this.auth.changePassword(
      Realm.FIELD,
      req.auth.sub,
      req.auth.sid,
      dto.currentPassword,
      dto.newPassword,
      context(req),
    );
  }
}

/** Réexport utilitaire pour le module. */
export const AUTH_CONTROLLERS = [
  InternalAuthController,
  PortalAuthController,
  FieldAuthController,
];

export { AuditService };
