/**
 * ARRONDI MONÉTAIRE — UNE SEULE AUTORITÉ.
 *
 * ⚠️ CINQ DÉFINITIONS CONCURRENTES COEXISTAIENT DANS QUATRE FICHIERS.
 *
 *    `round4` était redéfini à l'identique dans `invoices.controller.ts`,
 *    `supplier-invoices.controller.ts`, `deals.controller.ts` et
 *    `margin.service.ts`, plus un `roundTo` paramétré par la devise. Quatre
 *    copies d'une même règle ne restent identiques que tant que personne n'en
 *    corrige une — et le jour où l'une bouge, une facture et la marge de la
 *    même affaire cessent de se répondre, sans que rien ne le signale.
 *
 * ⚠️ L'ANCIEN ARRONDI SE TROMPAIT SUR LES CAS LIMITES, ET C'ÉTAIT DÉMONTRABLE.
 *
 *    `Math.round(n * 10 ** d) / 10 ** d` rendait 1 pour `roundTo(1.005, 2)` au
 *    lieu de 1,01. La cause : 1,005 n'est pas représentable en binaire, sa
 *    valeur machine est 1,00499999999999989, et la multiplication la conserve
 *    en dessous du demi. Le client voit un centime disparaître, et la pièce
 *    reste cohérente avec elle-même — donc indétectable.
 *
 *    La correction passe par la notation exponentielle : `Number('1.005e2')`
 *    vaut exactement 100.5, que `Math.round` arrondit correctement. Vérifié sur
 *    1,005 · 8,615 · 2,675 · −1,005 · 1,0049.
 *
 * ⚠️ CE QUI RESTE, ET QU'IL FAUT SAVOIR.
 *
 *    Les montants sont STOCKÉS en `numeric(18,4)` — exact. Les CALCULS passent
 *    encore par le type `number` de JavaScript, donc par des flottants IEEE 754.
 *    Aux ordres de grandeur d'Elyon en XOF (aucune décimale, montants très en
 *    deçà de 2^53), les doubles sont exacts. Le risque résiduel porte sur le
 *    plan document en devise à deux décimales et sur les marges unitaires à
 *    quatre décimales comparées à un seuil.
 *
 *    Passer l'ensemble de la chaîne en décimal exact est un chantier à part
 *    entière, à engager si le volume en devise étrangère devient significatif.
 *    En attendant, TOUT passe par ici : le jour où ce module bascule en
 *    décimal, il bascule pour tout le monde d'un coup.
 */

/** Décimales du plan de calcul interne — jamais celles de restitution. */
export const CALC_DECIMALS = 4;

/**
 * Arrondi commercial à `decimals` décimales, demi-unité vers le haut en valeur
 * absolue (symétrique autour de zéro).
 *
 * Le passage par la notation exponentielle n'est pas une coquetterie : c'est ce
 * qui corrige les cas limites où la multiplication décale la valeur sous le
 * demi. Voir l'en-tête.
 */
export function roundTo(n: number, decimals: number): number {
  if (!Number.isFinite(n)) return n;
  if (decimals < 0) return n;

  const signe = n < 0 ? -1 : 1;
  const abs = Math.abs(n);

  // `Number(abs + 'e' + d)` décale la virgule SANS multiplication flottante.
  const decale = Number(`${abs}e${decimals}`);
  if (!Number.isFinite(decale)) return n;

  const arrondi = Number(`${Math.round(decale)}e-${decimals}`);
  return signe * arrondi;
}

/** Arrondi au plan de calcul interne (4 décimales). */
export function round4(n: number): number {
  return roundTo(n, CALC_DECIMALS);
}

/**
 * Extraction de TVA d'un montant TTC.
 *
 * Centralisée ici parce qu'elle porte une règle fiscale — la TVA est INCLUSE
 * dans le total affiché — et qu'une seconde implémentation ailleurs finirait
 * par l'extraire d'un montant HT.
 */
export function extractVat(totalTtc: number, ratePct: number): number {
  if (ratePct <= 0) return 0;
  return round4((totalTtc * ratePct) / (100 + ratePct));
}
