import { Injectable, Logger } from '@nestjs/common';
import { ActorType, AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Realm } from '../auth/realm';

export interface AuditEntry {
  actorType: ActorType;
  actorId?: string;
  actorLabel?: string;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Journal d'audit (SPECIFICATIONS.md § 1.4).
 *
 * La table est append-only, garantie par trigger PostgreSQL : ni l'application
 * ni l'administrateur ne peuvent réécrire l'histoire. Ce service n'a donc que
 * deux responsabilités — écrire, et ne jamais faire échouer l'action métier
 * qu'il journalise.
 *
 * CHAMPS SENSIBLES : les états avant/après sont expurgés avant écriture. Un
 * journal d'audit contenant des empreintes de mots de passe ou des secrets TOTP
 * déplacerait le secret au lieu de le protéger.
 */
/** Champs jamais journalisés, quelle que soit l'entité. */
const REDACTED_FIELDS = new Set([
  'passwordHash',
  'password_hash',
  'password',
  'totpSecretEnc',
  'totp_secret_enc',
  'totpSecret',
  'tokenHash',
  'token_hash',
  'accessToken',
  'refreshToken',
]);

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorType: entry.actorType,
          actorId: entry.actorId ?? null,
          actorLabel: entry.actorLabel ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          beforeState: redact(entry.before) as Prisma.InputJsonValue,
          afterState: redact(entry.after) as Prisma.InputJsonValue,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent?.slice(0, 512) ?? null,
        },
      });
    } catch (error) {
      // Un échec d'écriture du journal ne doit JAMAIS annuler l'action métier :
      // refuser une approbation de crédit parce que le journal est saturé
      // serait une panne bien pire que la perte d'une ligne de trace.
      // En revanche il doit être bruyant : c'est une anomalie d'exploitation.
      this.logger.error(
        `Échec d'écriture du journal d'audit — ${entry.action} ${entry.entityType}`,
        error as Error,
      );
    }
  }

  /** Traduit un réalm en type d'acteur pour le journal. */
  static actorTypeFor(realm: Realm | undefined): ActorType {
    switch (realm) {
      case Realm.INTERNAL:
        return ActorType.INTERNAL_USER;
      case Realm.PORTAL:
        return ActorType.PORTAL_USER;
      case Realm.FIELD:
        return ActorType.FIELD_USER;
      default:
        return ActorType.SYSTEM;
    }
  }
}

/**
 * Remplace récursivement les valeurs sensibles par un marqueur, et rend
 * l'état sérialisable en JSON.
 *
 * ⚠️ PIÈGE VÉRIFIÉ EN PRODUCTION. On passe ici des objets Prisma bruts, qui
 *    contiennent des `Decimal` et des `BigInt` — pas des objets simples.
 *
 *    Les instances de decimal.js portent une propriété PROPRE et énumérable
 *    `constructor` pointant sur une fonction. Une descente récursive naïve la
 *    recopiait, et Prisma refusait ensuite d'écrire une fonction dans une
 *    colonne JSON. Le journal d'audit échouait alors SILENCIEUSEMENT sur
 *    toute entité portant un montant — c'est-à-dire presque toutes.
 *
 *    D'où la règle : on ne descend QUE dans les objets simples et les
 *    tableaux. Tout le reste est réduit à sa forme textuelle.
 */
function redact(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'function') return undefined;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== 'object') return value;

  // Decimal, Buffer, et tout objet porteur d'un comportement : on garde la
  // valeur lisible, jamais la structure interne.
  if (!isPlainObject(value)) {
    const candidate = value as { toJSON?: () => unknown };
    return typeof candidate.toJSON === 'function' ? candidate.toJSON() : String(value);
  }

  const output: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    output[key] = REDACTED_FIELDS.has(key) ? '[expurgé]' : redact(val);
  }
  return output;
}

/** Vrai pour les seuls objets littéraux — ceux dans lesquels on peut descendre. */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
