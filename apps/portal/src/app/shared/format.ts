/**
 * Nombre groupé par milliers, à la française.
 *
 * ⚠️ LE MÊME SÉPARATEUR QU'À LA SAISIE, ET C'EST TOUT L'INTÉRÊT.
 *
 *    `toLocaleString('fr-FR')` rend une espace FINE insécable (U+202F), dont
 *    le rendu varie d'une police et d'un navigateur à l'autre, jusqu'à
 *    disparaître. La saisie, elle, pose une espace insécable ordinaire. Un
 *    montant relu ne ressemblerait donc pas au montant tapé, et sur une
 *    colonne de chiffres cet écart se voit tout de suite.
 *
 *    Un écran l'avait déjà corrigé dans son coin. Le corriger ici le corrige
 *    partout, et empêche les quinze mises en forme de rediverger chacune de
 *    leur côté.
 */
export function grouper(n: number, options?: Intl.NumberFormatOptions): string {
  return n.toLocaleString('fr-FR', options).replace(/ /g, ' ');
}

/** Rend la partie date d'un horodatage ISO, sans dépendre d'un pipe. */
export function dateOnly(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '-';
}

/**
 * Libellé du délai restant.
 *
 * Vit ici et non dans le template : le parseur Angular lit « < » comme une
 * ouverture de balise, ce qui casse silencieusement le rendu.
 */
export function remainingLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)} j échue`;
  return `${days} j`;
}

/** Couleur du délai : échu, proche, confortable. */
export function daysClass(days: number): string {
  if (days < 0) return 'font-semibold text-crit';
  if (days <= 30) return 'font-semibold text-warn-ink';
  return 'text-ink-soft';
}

/**
 * Liseré de sévérité porté par la ligne de table.
 *
 * La forme double la teinte : une échéance échue se repère sans lire et sans
 * dépendre de la perception des couleurs (§ 17.2).
 */
export function rowClass(days: number): string {
  if (days < 0) return 'row-crit';
  if (days <= 30) return 'row-warn';
  return '';
}
