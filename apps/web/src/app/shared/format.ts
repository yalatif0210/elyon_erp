/** Rend la partie date d'un horodatage ISO, sans dépendre d'un pipe. */
export function dateOnly(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '—';
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
  if (days < 0) return 'text-rose-400';
  if (days <= 30) return 'text-amber-400';
  return 'text-slate-300';
}
