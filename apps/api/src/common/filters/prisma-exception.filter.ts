import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Traduit les refus de PostgreSQL en réponses HTTP intelligibles.
 *
 * POURQUOI CE FILTRE EST ESSENTIEL
 * --------------------------------
 * Les invariants du système sont portés par la base (SPECIFICATIONS.md § 11) :
 * un contrôle HSE non validé, une dérogation accordée par le mauvais rôle, un
 * taux d'absorption incohérent sont refusés par un trigger ou un CHECK, avec un
 * message métier explicite rédigé en français.
 *
 * Sans traduction, ces refus remonteraient en 500 « Internal Server Error » et
 * l'utilisateur ne saurait pas ce qu'on lui reproche — ce qui reviendrait à
 * avoir des garde-fous invisibles. Le filtre les expose en 422 avec leur
 * message d'origine.
 */
@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientValidationError,
  // Indispensable : Prisma ne mappe PAS les exceptions levées par un trigger.
  // Un RAISE EXCEPTION arrive ici enveloppé dans une erreur « inconnue », avec
  // le code PostgreSQL et le message métier intacts dans le texte. Sans cette
  // classe, tous nos invariants remonteraient en 500 muets.
  Prisma.PrismaClientUnknownRequestError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const request = host.switchToHttp().getRequest();

    const { status, message, code } = this.translate(exception);

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url} — ${code}`, exception as Error);
    } else {
      this.logger.warn(`${request.method} ${request.url} — ${code} : ${message}`);
    }

    response.status(status).json({
      statusCode: status,
      error: HttpStatus[status] ?? 'Error',
      code,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  private translate(exception: unknown): { status: number; message: string; code: string } {
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'PRISMA_VALIDATION',
        message: 'Requête invalide.',
      };
    }

    // --- Exceptions de trigger : Prisma les enveloppe sans les mapper --------
    if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
      return translatePostgresError(exception.message);
    }

    if (!(exception instanceof Prisma.PrismaClientKnownRequestError)) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'UNKNOWN',
        message: 'Erreur interne.',
      };
    }

    switch (exception.code) {
      // --- Violation d'un invariant métier porté par la base -----------------
      // P2010 : requête brute rejetée · les triggers RAISE EXCEPTION arrivent ici.
      case 'P2010': {
        const meta = exception.meta as { message?: string } | undefined;
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          code: 'INVARIANT_VIOLATION',
          message: cleanPgMessage(meta?.message ?? exception.message),
        };
      }

      // P2004 : contrainte de base violée — CHECK et triggers passent par là.
      case 'P2004':
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          code: 'INVARIANT_VIOLATION',
          message: cleanPgMessage(exception.message),
        };

      // --- Conflits d'unicité ------------------------------------------------
      case 'P2002': {
        const target = (exception.meta as { target?: string[] } | undefined)?.target;
        const fields = Array.isArray(target) ? target.join(', ') : 'clé';
        return {
          status: HttpStatus.CONFLICT,
          code: 'DUPLICATE',
          message: `Une entrée existe déjà pour : ${fields}.`,
        };
      }

      // --- Référence invalide ------------------------------------------------
      case 'P2003':
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          code: 'FOREIGN_KEY',
          message: 'Référence inexistante ou suppression bloquée par une dépendance.',
        };

      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'Ressource introuvable.',
        };

      // --- Moindre privilège : erp_app tente ce qu'il n'a pas le droit de faire
      case 'P1010':
        return {
          status: HttpStatus.FORBIDDEN,
          code: 'DB_PERMISSION_DENIED',
          message: 'Opération refusée par les privilèges de la base.',
        };

      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: exception.code,
          message: 'Erreur de persistance.',
        };
    }
  }
}

/**
 * Extrait le code SQLSTATE et le message métier d'une erreur enveloppée.
 *
 * Le moteur Prisma restitue la panne sous cette forme :
 *   PostgresError { code: "23514", message: "Dérogation … réservée au DG …", … }
 *
 * Ce sont exactement le code et le message rédigés dans nos triggers.
 */
function translatePostgresError(raw: string): { status: number; message: string; code: string } {
  const match = /code:\s*"(\w+)",\s*message:\s*"([\s\S]*?)",\s*severity:/.exec(raw);
  const sqlState = match?.[1];
  const pgMessage = match?.[2]?.trim();

  switch (sqlState) {
    // 23514 — check_violation : nos CHECK et nos RAISE EXCEPTION de trigger.
    case '23514':
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: 'INVARIANT_VIOLATION',
        message: pgMessage ?? 'Règle métier non respectée.',
      };

    // 42501 — insufficient_privilege : journaux append-only, moindre privilège.
    case '42501':
      return {
        status: HttpStatus.FORBIDDEN,
        code: 'APPEND_ONLY',
        message: pgMessage ?? 'Opération interdite sur cette ressource.',
      };

    case '23505':
      return {
        status: HttpStatus.CONFLICT,
        code: 'DUPLICATE',
        message: pgMessage ?? 'Une entrée équivalente existe déjà.',
      };

    case '23503':
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: 'FOREIGN_KEY',
        message: pgMessage ?? 'Référence inexistante ou dépendance bloquante.',
      };

    default:
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: sqlState ?? 'UNKNOWN',
        message: 'Erreur de persistance.',
      };
  }
}

/**
 * Extrait le message métier du bavardage PostgreSQL.
 *
 * Un RAISE EXCEPTION remonte enveloppé de « ERROR: », d'un CONTEXT et parfois
 * d'un DETAIL. Seule la première ligne porte le message rédigé pour l'humain.
 */
function cleanPgMessage(raw: string): string {
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('ERROR:') || l.includes('INVARIANT'));

  const cleaned = (line ?? raw.split('\n')[0] ?? raw).replace(/^ERROR:\s*/i, '').trim();

  // Les contraintes CHECK ne portent pas de message : on rend le nom de la
  // contrainte, qui est explicite par convention (chk_deals_credit_approval…).
  const constraint = /violates check constraint "([^"]+)"/i.exec(raw);
  if (constraint) {
    return `Règle métier non respectée : ${constraint[1]}.`;
  }

  return cleaned || 'Règle métier non respectée.';
}

/** Réexporté pour les tests d'invariants. */
export { cleanPgMessage };

/** Garde-fou : ne jamais laisser fuiter une trace technique en production. */
export function isSafeToExpose(exception: unknown): boolean {
  return exception instanceof HttpException;
}
