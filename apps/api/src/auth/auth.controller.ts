import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ActorType } from '@prisma/client';
import { AuditService } from '../common/audit/audit.service';
import { Public, Realm, RequireRealm } from '../common/auth/realm';
import { AuthService } from './auth.service';
import { FieldLoginDto, LoginDto, RefreshDto, TotpConfirmDto } from './auth.dto';

/** Limitation de débit sur la connexion : 5 tentatives par minute et par IP. */
const LOGIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

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
}

/** Réexport utilitaire pour le module. */
export const AUTH_CONTROLLERS = [
  InternalAuthController,
  PortalAuthController,
  FieldAuthController,
];

export { AuditService };
