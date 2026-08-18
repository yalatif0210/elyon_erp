import { SetMetadata } from '@nestjs/common';
import type { FieldRole, UserRole } from '@prisma/client';

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
export const SCREEN_KEY = 'erp:screen';

/** Réalm exigé par la route. Posé au niveau du contrôleur, jamais oublié. */
export const RequireRealm = (realm: Realm) => SetMetadata(REALM_KEY, realm);

/** Rôles internes autorisés. Sans ce décorateur, tout rôle du réalm passe. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Écran dont cette route porte le contenu de lecture (§ paramétrage 17/08).
 *
 * Posé UNIQUEMENT sur la ou les routes qui font vivre un écran à son
 * ouverture (liste, détail affiché d'emblée) - jamais sur une route
 * d'action. C'est ce qui rend `RoleScreenAccess` sûre par construction : la
 * dérogation DG ne peut viser que ce qui est marqué, et rien n'est marqué en
 * dehors de la lecture d'ouverture d'écran.
 */
export const Screen = (key: string) => SetMetadata(SCREEN_KEY, key);

/**
 * Rôles TERRAIN autorisés. Décorateur distinct de `Roles` par typage, pas par
 * mécanisme : les deux alimentent la même métadonnée, et le guard n'accepte
 * jamais un rôle sans que le réalm ait été validé d'abord. Un rôle interne
 * écrit sur une route terrain ne compilerait pas.
 */
export const FieldRoles = (...roles: FieldRole[]) => SetMetadata(ROLES_KEY, roles);

/** Route non authentifiée — connexion, santé. À utiliser avec parcimonie. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Exclut la route de la journalisation d'audit (lectures massives). */
/**
 * @deprecated NE COMMANDE RIEN, et n'a jamais rien commandé.
 *
 * ⚠️ Aucun intercepteur ne consomme `SKIP_AUDIT_KEY` : il n'existe pas
 *    d'audit automatique dans cette application. L'audit est écrit
 *    EXPLICITEMENT par chaque service, via `AuditService.record`.
 *
 *    Le décorateur laissait donc croire l'inverse — qu'une route non marquée
 *    était auditée d'office. Un lecteur en déduisait à tort que l'absence de
 *    marque valait garantie, et la création d'une pièce de conformité est
 *    restée sans trace pour cette raison.
 *
 *    Conservé le temps de le retirer des huit routes qui le portent, puis à
 *    supprimer. Ne l'ajoutez nulle part : une marque qui ne commande rien est
 *    pire qu'une absence de marque.
 */
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);

/** Utilisateur authentifié, attaché à la requête par le guard. */
export interface AuthenticatedRequest extends Request {
  auth?: AccessTokenPayload;
  ipAddress?: string;
}
