import { Injectable, computed, signal } from '@angular/core';

/**
 * VOCABULAIRE TERRAIN — les valeurs métier ne sont JAMAIS écrites ici.
 *
 * LE PROBLÈME
 *
 *   Plusieurs charges utiles du journal exigent une valeur d'énumération :
 *   la PHASE d'une checklist, l'état visé d'une transition, la nature et la
 *   gravité d'un incident, la source d'un relevé. Le réalm terrain ne publie
 *   AUCUNE route qui énumère ces valeurs : `/api/internal/parameters`, qui les
 *   porte pour la console, est fermé au jeton de la tablette.
 *
 *   Les recopier en dur dans un `const PHASES = [...]` réglerait l'affichage
 *   et créerait une seconde vérité : le jour où une phase est ajoutée côté
 *   serveur, la tablette continuerait d'en proposer cinq, et l'agent n'aurait
 *   aucun moyen de faire ce qu'on attend de lui.
 *
 * CE QUE FAIT CE SERVICE À LA PLACE
 *
 *   Il n'invente rien : il RETIENT ce que le serveur a déjà nommé.
 *
 *   1. Par OBSERVATION — chaque objet lu contient des valeurs réelles : le
 *      statut de chaque opération de la liste de travail, la phase de chaque
 *      checklist ouverte, la nature et la gravité de chaque incident de
 *      l'historique du site. Elles sont vraies par construction.
 *
 *   2. Par APPRENTISSAGE DU REFUS — quand une valeur ne convient pas, la
 *      validation du serveur répond « phase must be one of the following
 *      values: PREPARATION, PRE_CHARGEMENT, … ». Ce message, que l'interface a
 *      de toute façon l'obligation d'afficher intégralement, ÉNUMÈRE la liste
 *      autorisée. On la retient plutôt que de la laisser défiler.
 *
 *   Tant qu'un champ n'a rien à proposer, l'écran bascule en saisie libre et
 *   le dit — mieux vaut un champ ouvert qu'une liste fausse.
 *
 * LES CLÉS SONT CELLES DU SERVEUR — `phase`, `to`, `type`, `severity`,
 * `source`, `uom`, `outcome`. C'est le nom du champ dans le DTO du domaine, et
 * c'est ce nom que le message de refus porte : le rapprochement se fait donc
 * sans table de correspondance à tenir à jour.
 */
@Injectable({ providedIn: 'root' })
export class FieldVocabularyService {
  private readonly connu = signal<Record<string, string[]>>({});

  /** Pour l'écran de diagnostic : ce que la tablette a appris jusqu'ici. */
  readonly champs = computed(() => Object.keys(this.connu()).sort());

  liste(champ: string): string[] {
    return this.connu()[champ] ?? [];
  }

  /** Retient une valeur observée. Les vides et les doublons sont ignorés. */
  noter(champ: string, valeur: unknown): void {
    if (typeof valeur !== 'string' || valeur === '') return;
    this.connu.update((etat) => {
      const deja = etat[champ] ?? [];
      if (deja.includes(valeur)) return etat;
      return { ...etat, [champ]: [...deja, valeur].sort() };
    });
  }

  noterListe(champ: string, valeurs: readonly unknown[] | undefined): void {
    for (const v of valeurs ?? []) this.noter(champ, v);
  }

  /**
   * Extrait les énumérations d'un message de refus de `class-validator`.
   *
   * Format produit par `@IsEnum` :
   *   « phase must be one of the following values: PREPARATION, LOADING »
   *
   * Les messages de refus du journal concatènent plusieurs contraintes par
   * « · » ; le drapeau `g` les parcourt toutes. On ne retient que des jetons en
   * capitales et tirets bas, qui est la forme des énumérations Prisma — une
   * phrase française mal découpée ne peut donc pas entrer dans le vocabulaire.
   */
  apprendreDuRefus(message: string | undefined | null): void {
    if (!message) return;
    const motif = /(\w+) must be one of the following values:\s*([A-Z0-9_,\s]+)/g;
    let trouve: RegExpExecArray | null;
    while ((trouve = motif.exec(message)) !== null) {
      const champ = trouve[1];
      for (const brut of trouve[2].split(',')) {
        const valeur = brut.trim();
        if (/^[A-Z][A-Z0-9_]*$/.test(valeur)) this.noter(champ, valeur);
      }
    }
  }
}
