import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

/**
 * Les trois périmètres d'exposition (SPECIFICATIONS.md § 1.3).
 *
 * Le réalm est porté par le jeton ET vérifié contre celui qu'exige la route.
 * Un jeton portail présenté sur /api/internal est rejeté structurellement,
 * sans qu'aucune vérification de rôle n'ait à intervenir.
 */
export enum Realm {
  INTERNAL = 'internal',
  PORTAL = 'portal',
  FIELD = 'field',
}

/** Contenu du jeton d'accès. Volontairement minimal : aucune donnée métier. */
export interface AccessTokenPayload {
  /** Identifiant de l'utilisateur dans SA table (users, portal_users, field_users). */
  sub: string;
  realm: Realm;
  /** Rôle interne, ou rôle terrain. Absent pour le portail. */
  role?: string;
  /** Cloisonnement par ligne du portail : le tiers auquel le compte est rattaché. */
  partnerId?: string;
  /** Identifiant de session — permet la révocation ciblée. */
  sid: string;
}

export interface RefreshTokenPayload {
  sub: string;
  realm: Realm;
  sid: string;
}

// --- Métadonnées de route -------------------------------------------------

export const REALM_KEY = 'erp:realm';
export const ROLES_KEY = 'erp:roles';
export const PUBLIC_KEY = 'erp:public';
export const SKIP_AUDIT_KEY = 'erp:skipAudit';

/** Réalm exigé par la route. Posé au niveau du contrôleur, jamais oublié. */
export const RequireRealm = (realm: Realm) => SetMetadata(REALM_KEY, realm);

/** Rôles internes autorisés. Sans ce décorateur, tout rôle du réalm passe. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Route non authentifiée — connexion, santé. À utiliser avec parcimonie. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Exclut la route de la journalisation d'audit (lectures massives). */
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);

/** Utilisateur authentifié, attaché à la requête par le guard. */
export interface AuthenticatedRequest extends Request {
  auth?: AccessTokenPayload;
  ipAddress?: string;
}
