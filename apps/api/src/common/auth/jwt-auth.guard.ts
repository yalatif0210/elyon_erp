import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@prisma/client';
import { AppConfig } from '../config/env.config';
import { RedisService } from '../redis/redis.service';
import { ScreenAccessService } from './screen-access.service';
import {
  AccessTokenPayload,
  PUBLIC_KEY,
  REALM_KEY,
  ROLES_KEY,
  SCREEN_KEY,
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
    private readonly screenAccess: ScreenAccessService,
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

    // --- 3. Rôle --------------------------------------------------------
    const allowedRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const staticAllowed = !allowedRoles?.length || allowedRoles.includes(payload.role ?? '');

    // --- 3bis. Dérogation DG à la visibilité d'écran (§ paramétrage 17/08) --
    //
    //    UNIQUEMENT sur une route marquée @Screen() - la route de lecture qui
    //    fait vivre un écran à son ouverture. Sans cette marque, `staticAllowed`
    //    seul décide : le comportement d'aujourd'hui ne bouge pas d'un pouce
    //    pour toute route d'action.
    const screenKey = this.reflector.getAllAndOverride<string>(SCREEN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (payload.realm === Realm.INTERNAL && screenKey && payload.role) {
      const visible = await this.screenAccess.isVisibleForRoute(
        payload.role as UserRole,
        screenKey,
        staticAllowed,
      );
      if (!visible) {
        throw new ForbiddenException('Écran masqué pour ce rôle');
      }
    } else if (!staticAllowed) {
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

function extractIp(request: {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, unknown>;
}): string | undefined {
  // Derrière Cloudflare (DEPLOIEMENT.md), le nombre de sauts internes n'est
  // pas fixe — le relais public en ajoute un, `web` en ajoute un second pour
  // les requêtes /api relayées, `portal` aucun. Compter les sauts pour
  // `trust proxy` serait fragile et se déréglerait au moindre changement de
  // topologie. `CF-Connecting-IP` fait autorité à la place : posé par
  // Cloudflare à SA frontière, il écrase toute valeur qu'un client tenterait
  // d'y glisser, quel que soit ce qui se passe ensuite entre l'edge et le
  // conteneur.
  const cf = request.headers?.['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf;

  // `trust proxy = 1` étant posé dans main.ts, `request.ip` porte l'adresse
  // réelle du client, résolue depuis le dernier saut seulement. Sans ce
  // réglage, on journaliserait l'adresse de nginx sur chaque écriture.
  return request.ip ?? request.socket?.remoteAddress;
}
