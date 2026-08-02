import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../config/env.config';
import { RedisService } from '../redis/redis.service';
import {
  AccessTokenPayload,
  PUBLIC_KEY,
  REALM_KEY,
  ROLES_KEY,
  Realm,
} from './realm';

/**
 * Guard unique portant les trois vérifications, dans cet ordre :
 *   1. le jeton est valide et non révoqué ;
 *   2. son RÉALM correspond à celui qu'exige la route ;
 *   3. son RÔLE figure parmi ceux autorisés.
 *
 * L'ordre importe. Le contrôle de réalm précède celui de rôle : un compte
 * portail ne doit jamais être évalué contre la matrice des rôles internes,
 * même pour être refusé — c'est ce qui rend l'élévation de privilège
 * structurellement impossible plutôt que conditionnelle.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = extractBearer(request.headers?.authorization);
    if (!token) {
      throw new UnauthorizedException('Jeton absent');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.accessSecret,
      });
    } catch {
      // Message volontairement identique quelle que soit la cause : expiration,
      // signature invalide ou jeton forgé ne doivent pas se distinguer.
      throw new UnauthorizedException('Jeton invalide');
    }

    // Révocation immédiate — déconnexion, changement de mot de passe,
    // désactivation d'un compte. Sans ce contrôle, un jeton reste valide
    // jusqu'à son expiration naturelle.
    if (await this.redis.isSessionRevoked(payload.sid)) {
      throw new UnauthorizedException('Session révoquée');
    }

    // --- 2. Réalm -----------------------------------------------------------
    const requiredRealm = this.reflector.getAllAndOverride<Realm>(REALM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRealm) {
      // Une route authentifiée sans réalm déclaré est une erreur de
      // développement : on refuse plutôt que de laisser passer.
      throw new ForbiddenException('Périmètre non déclaré sur cette route');
    }
    if (payload.realm !== requiredRealm) {
      throw new ForbiddenException('Périmètre non autorisé');
    }

    // --- 3. Rôle ------------------------------------------------------------
    const allowedRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowedRoles?.length && !allowedRoles.includes(payload.role ?? '')) {
      throw new ForbiddenException('Rôle non autorisé');
    }

    request.auth = payload;
    request.ipAddress = extractIp(request);
    return true;
  }
}

function extractBearer(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}

function extractIp(request: { ip?: string; socket?: { remoteAddress?: string } }): string | undefined {
  // On ne fait pas confiance à X-Forwarded-For sans reverse proxy maîtrisé :
  // il est trivialement falsifiable par le client.
  return request.ip ?? request.socket?.remoteAddress;
}
