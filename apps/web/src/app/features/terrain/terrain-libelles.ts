import { FieldRole } from '../../core/field-session.service';
import { FieldListingReason } from '../../core/field-api.service';

/**
 * LES SEULS LIBELLÉS QUE L'INTERFACE S'AUTORISE À ÉCRIRE.
 *
 * La règle est « aucune valeur métier en dur » : ni liste de phases, ni niveau
 * de contrôle, ni libellé de statut. Elle est tenue partout ailleurs — phases,
 * statuts d'opération, niveaux de risque, natures et gravités d'incident,
 * sources de relevé, modes de transport, natures de document s'affichent tels
 * que l'API les rend, en `.t-code`, sans traduction.
 *
 * Ce fichier existe pour rendre AUDITABLE la courte liste des exceptions, et
 * pour qu'aucune autre ne s'ajoute par inadvertance dans un template. Chacune
 * est justifiée ci-dessous. Aucune n'est une donnée de fonctionnement : ce ne
 * sont pas des valeurs que l'entreprise règle, ce sont les trois ou quatre
 * termes par lesquels l'interface parle d'elle-même.
 */

/**
 * Résultat d'un point de contrôle.
 *
 * Les trois valeurs sont posées par la commande elle-même — « issue PASSED /
 * FAILED / NOT_APPLICABLE » — et ce sont des BOUTONS, pas un affichage : un
 * agent ganté qui doit choisir entre trois codes anglais en majuscules se
 * trompe. Le quatrième état de l'énumération, PENDING, n'est volontairement
 * pas proposé : c'est l'état de départ, pas une réponse.
 */
export interface ResultatPoint {
  code: 'PASSED' | 'FAILED' | 'NOT_APPLICABLE';
  libelle: string;
  /** Classe du bouton retenu — voir `.t-choice-on-*` dans styles.css. */
  marque: string;
}

export const RESULTATS_POINT: readonly ResultatPoint[] = [
  { code: 'PASSED', libelle: 'Conforme', marque: 't-choice-on-ok' },
  { code: 'FAILED', libelle: 'Non conforme', marque: 't-choice-on-crit' },
  { code: 'NOT_APPLICABLE', libelle: 'Sans objet', marque: 't-choice-on-neutral' },
];

/**
 * Rôles du réalm terrain.
 *
 * Ils ne sont pas affichés pour l'ornement : ils CONDITIONNENT l'interface,
 * puisque seul le contrôleur HSE se voit proposer la validation. L'agent doit
 * pouvoir vérifier d'un coup d'œil sous quelle qualité il est connecté — c'est
 * ce qui lui explique pourquoi le bouton n'est pas là.
 */
export const ROLES_TERRAIN: Record<FieldRole, string> = {
  FIELD_AGENT: 'Agent d’opération',
  HSE_CONTROLLER: 'Contrôleur HSE',
};

/**
 * Pourquoi l'opération figure dans la liste.
 *
 * Le serveur le calcule et le rend explicitement (`listedBecause`) avec ce
 * commentaire : « l'écran ne doit pas le deviner ». Les deux valeurs sont
 * closes par le contrat de la vue terrain, et l'écart entre « elle est à moi »
 * et « on attend ma validation » change ce que l'agent vient y faire.
 */
export const MOTIF_PRESENCE: Record<FieldListingReason, string> = {
  ASSIGNED: 'Qui vous est affectée',
  AWAITING_HSE_VALIDATION: 'En attente de votre validation',
};

/** Partie date d'un horodatage ISO, sans dépendre d'un pipe. */
export function jour(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '—';
}

/** Date et heure, à la minute — l'heure compte sur un relevé. */
export function jourHeure(iso: string | null | undefined): string {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : '—';
}

/** Valeur d'horodatage acceptée par `<input type="datetime-local">`. */
export function maintenantLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Convertit la saisie d'un `datetime-local` en ISO 8601.
 *
 * ⚠️ Le champ rend une heure LOCALE sans fuseau (« 2026-08-05T14:32 »), que
 *    `@IsISO8601()` accepte mais que le serveur interprétera en UTC : deux
 *    heures d'écart sur un relevé, c'est-à-dire un relevé faux. On repasse
 *    donc par `Date` pour que le décalage de la tablette soit porté.
 */
export function versIso(saisie: string): string {
  if (!saisie) return '';
  const d = new Date(saisie);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}
