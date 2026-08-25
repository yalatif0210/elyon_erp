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
export function translatePostgresError(raw: string): { status: number; message: string; code: string } {
  const match = /code:\s*"(\w+)",\s*message:\s*"([\s\S]*?)",\s*severity:/.exec(raw);
  const sqlState = match?.[1];
  const pgMessage = match?.[2]?.trim();

  switch (sqlState) {
    // 23514 — check_violation : nos CHECK et nos RAISE EXCEPTION de trigger.
    //
    // Nos RAISE portent un message rédigé : on le rend tel quel. Une CHECK,
    // elle, ne dit que le nom de la contrainte — il faut le traduire, sinon
    // l'utilisateur lit « chk_deal_cost_line_variance_justified » et ne sait
    // pas ce qu'on attend de lui.
    case '23514':
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: 'INVARIANT_VIOLATION',
        message: humaniseCheck(pgMessage ?? raw),
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

    default: {
      // ⚠️ CORRIGÉ — un appel Prisma Client ordinaire (createMany/deleteMany/
      //    update…), à la différence d'un $queryRaw, ne fait PAS remonter le
      //    wrapper « PostgresError { code: "...", message: "...", severity:
      //    ... } » que le motif ci-dessus attend : juste « Error in connector:
      //    Error querying the database: ERROR: <message métier> », le tout
      //    sur UNE SEULE ligne (« ERROR: » n'ouvre pas sa propre ligne, donc
      //    `cleanPgMessage` — écrit pour P2010 — ne le trouve pas non plus).
      //    Le motif ci-dessus ne matchait jamais, et un refus de trigger
      //    parfaitement rédigé (ex. le verrou de capacité cumulée des
      //    véhicules) retombait sur le texte générique — inexploitable pour
      //    l'utilisateur qui vient de le provoquer en saisie courante. Une
      //    CRUD ordinaire n'atteint ce texte brut QUE via un CHECK ou un
      //    RAISE EXCEPTION (unicité, clé étrangère : déjà interceptées plus
      //    haut) : chercher « ERROR: » n'importe où dans le texte, pas
      //    seulement en tête de ligne, est donc sûr ici.
      const idx = raw.indexOf('ERROR:');
      const extrait = idx >= 0 ? raw.slice(idx + 'ERROR:'.length).split('\n')[0].trim() : undefined;
      if (extrait) {
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          code: 'INVARIANT_VIOLATION',
          message: extrait,
        };
      }
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: sqlState ?? 'UNKNOWN',
        message: 'Erreur de persistance.',
      };
    }
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

  // Les contraintes CHECK ne portent pas de message. Rendre le nom brut de la
  // contrainte à un utilisateur ne l'aide pas : il faut lui dire ce qu'il doit
  // corriger. Les règles susceptibles d'être heurtées en saisie courante sont
  // donc traduites ; les autres retombent sur le nom, qui reste exploitable
  // par l'exploitant.
  // Les guillemets arrivent ÉCHAPPÉS : le message PostgreSQL est imbriqué
  // dans le texte d'erreur de Prisma, qui l'a lui-même sérialisé. Un motif
  // qui n'attend que des guillemets nus ne trouve jamais rien.
  const CHECK_NAME = /violates check constraint\s*\\?"([^"\\]+)/i;
  const constraint = CHECK_NAME.exec(raw);
  if (constraint) {
    return CHECK_MESSAGES[constraint[1]] ?? `Règle métier non respectée : ${constraint[1]}.`;
  }

  return cleaned || 'Règle métier non respectée.';
}

/**
 * Traduit le nom d'une contrainte CHECK en consigne. Sans correspondance, on
 * rend le nom : il reste exploitable par l'exploitant, à défaut de l'être par
 * l'utilisateur.
 */
export function humaniseCheck(message: string): string {
  const found = CHECK_NAME.exec(message);
  if (!found) return message;
  return CHECK_MESSAGES[found[1]] ?? `Règle métier non respectée : ${found[1]}.`;
}

/**
 * Contraintes traduites — celles qu'un utilisateur peut heurter en saisissant.
 * Le message dit CE QU'IL FAUT FAIRE, pas ce qui a échoué.
 */
const CHECK_MESSAGES: Record<string, string> = {
  chk_deal_cost_line_variance_justified:
    'Le montant retenu s’écarte du barème : un motif est exigé pour l’expliquer.',
  chk_cost_standard_unit_requires_uom:
    'Une valeur exprimée au litre doit préciser son unité de référence.',
  chk_cost_standard_tolerance_range: 'L’écart toléré doit être compris entre 0 et 100 pour cent.',
  chk_cost_standard_period: 'La date de fin de validité précède la date de début.',
  chk_supplier_invoice_settled_complete:
    'Une date d’apurement suppose l’avance intégralement apurée.',
  chk_invoices_vat_requires_flag:
    'Un montant de TVA a été porté alors que la TVA n’est pas cochée sur la pièce.',
  chk_invoices_vat_extracted:
    'La TVA doit être EXTRAITE du total (total × taux ÷ 100 + taux), jamais ajoutée.',
  chk_invoices_total_derived: 'Le total facture doit valoir le brut moins la réduction.',
  chk_invoices_gross_derived: 'Le montant brut doit valoir le volume multiplié par le prix.',
  chk_products_density_range:
    'La densité à 15 °C doit être comprise entre 0,4 et 1,2 : au-delà, ce n’est pas un produit pétrolier.',
  chk_measurement_ullage_computed:
    'L’écart de volume est calculé par le système : il ne se saisit pas.',
  chk_measurement_ack_complete:
    'L’acquittement d’un écart exige un auteur et un motif circonstancié.',
  chk_document_supersession_reason:
    'Une pièce « annule et remplace » doit dire pourquoi elle remplace la précédente.',
  chk_invoices_simple_decision:
    'Le recours à la facture simple est une décision interne : décideur, date et motif sont exigés.',
  chk_cost_posts_allocation_coherence:
    'Un poste DIRECT ne doit porter ni « Pool de charges indirectes » ni « Assiette d’absorption » : videz ces deux champs. Un poste INDIRECT exige les deux.',
};

/** Réexporté pour les tests d'invariants. */
export { cleanPgMessage };

/**
 * Nom de la contrainte heurtée.
 *
 * ⚠️ Les guillemets arrivent ÉCHAPPÉS : le message PostgreSQL est imbriqué
 *    dans le texte d'erreur de Prisma, qui l'a lui-même sérialisé. Un motif
 *    qui n'attend que des guillemets nus ne trouve jamais rien.
 */
const CHECK_NAME = new RegExp('violates check constraint\\s*\\\\?"([^"\\\\]+)', 'i');

/** Garde-fou : ne jamais laisser fuiter une trace technique en production. */
export function isSafeToExpose(exception: unknown): boolean {
  return exception instanceof HttpException;
}
