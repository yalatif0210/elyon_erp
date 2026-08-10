import { Directive, ElementRef, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * SÉPARATEURS DE MILLIERS À LA SAISIE COMME À LA LECTURE.
 *
 * ⚠️ POURQUOI UNE DIRECTIVE, ET NON UN FORMATAGE RECOPIÉ ÉCRAN PAR ÉCRAN.
 *
 *    « 120000000 » et « 12000000 » se distinguent à l'œil au bout de plusieurs
 *    secondes, et une erreur d'un facteur dix sur un budget annuel ne se voit
 *    à la relecture que si quelqu'un recompte les chiffres. Le séparateur rend
 *    l'écart immédiat.
 *
 *    Recopié dans chaque écran, ce comportement finirait par diverger : ici
 *    une virgule décimale acceptée, là non ; ici le curseur qui saute, là non.
 *    Une seule implémentation, appliquée partout.
 *
 * ⚠️ L'ESPACE INSÉCABLE, PAS L'ESPACE FINE.
 *
 *    La typographie française voudrait l'espace fine insécable (U+202F), que
 *    `toLocaleString('fr-FR')` produit. Son rendu est irrégulier d'une police
 *    et d'un navigateur à l'autre, au point de disparaître. L'espace insécable
 *    ordinaire s'affiche partout, et c'est un tableau de chiffres qu'on lit,
 *    pas un livre.
 *
 * ⚠️ LE MODÈLE NE PORTE PAS LES SÉPARATEURS.
 *
 *    L'écran affiche « 120 000 000 », le modèle porte « 120000000 ». Les deux
 *    seraient acceptés par le serveur, qui tolère les espaces et la virgule
 *    décimale, mais tout code qui ferait `Number(valeur)` sur le modèle
 *    obtiendrait NaN sans rien dire.
 */

/** Espace insécable : voir l'avertissement ci-dessus. */
const INSECABLE = ' ';

/**
 * Sépare la partie entière de la partie décimale, quel que soit ce qui a été
 * tapé ou collé.
 *
 * ⚠️ LE POINT N'EST PAS TOUJOURS UN SÉPARATEUR DÉCIMAL.
 *
 *    Le pavé numérique produit « . » ou « , » selon le système, donc un point
 *    isolé est bien une décimale. Mais « 1.234.567 » collé depuis un tableur
 *    est un million deux cent trente-quatre mille : lire le premier point
 *    comme une décimale donnait 1,234567, soit un montant divisé par un
 *    million. Sur un budget annuel, l'erreur passe inaperçue à la relecture.
 *
 *    Trois cas, et ils couvrent tout ce qui se tape ou se colle :
 *      · une virgule est présente  → elle décide, les points sont des milliers
 *      · deux points ou plus       → ce sont des milliers
 *      · au plus un point          → il est décimal
 */
function decomposer(texte: string): { entiere: string; decimale: string | null } {
  const retenu = texte.replace(/[^\d.,]/g, '');
  const points = (retenu.match(/\./g) ?? []).length;

  const normalise =
    retenu.includes(',') || points > 1 ? retenu.replace(/\./g, '') : retenu.replace('.', ',');

  const coupe = normalise.indexOf(',');
  const entiere = (coupe === -1 ? normalise : normalise.slice(0, coupe)).replace(/\D/g, '');
  // Les virgules surnuméraires sont écartées : une seule sépare les décimales.
  const decimale = coupe === -1 ? null : normalise.slice(coupe + 1).replace(/\D/g, '');
  return { entiere, decimale };
}

/**
 * Met en forme ce que l'utilisateur est en train de taper.
 *
 * Tolérant par construction : on met en forme À CHAQUE FRAPPE, donc l'état
 * intermédiaire doit rester saisissable. « 12 345, » est une étape normale
 * vers « 12 345,67 » ; la refuser rendrait la décimale impossible à atteindre.
 */
export function formaterMontant(brut: string | null | undefined): string {
  if (brut === null || brut === undefined) return '';
  const texte = String(brut);
  const negatif = texte.trimStart().startsWith('-');
  const { entiere, decimale } = decomposer(texte);

  if (entiere === '' && decimale === null) return negatif ? '-' : '';

  const groupee = entiere.replace(/\B(?=(\d{3})+(?!\d))/g, INSECABLE);
  const signe = negatif ? '-' : '';
  return decimale === null ? signe + groupee : `${signe}${groupee},${decimale}`;
}

/** Repasse à la forme que tout calcul attend : sans séparateur, point décimal. */
export function montantBrut(affiche: string | null | undefined): string {
  if (affiche === null || affiche === undefined) return '';
  const negatif = String(affiche).trimStart().startsWith('-');
  const { entiere, decimale } = decomposer(String(affiche));
  if (entiere === '' && (decimale === null || decimale === '')) return '';
  const corps = decimale ? `${entiere || '0'}.${decimale}` : entiere;
  return (negatif ? '-' : '') + corps;
}

const chiffres = (t: string): number => (t.match(/\d/g) ?? []).length;

@Directive({
  selector: 'input[erpMontant]',
  standalone: true,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MontantDirective),
      multi: true,
    },
  ],
  host: {
    '(input)': 'saisie()',
    '(blur)': 'sortie()',
    inputmode: 'decimal',
    autocomplete: 'off',
  },
})
export class MontantDirective implements ControlValueAccessor {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);

  private propager: (v: number | null) => void = () => undefined;
  private toucher: () => void = () => undefined;

  writeValue(v: unknown): void {
    this.el.nativeElement.value = formaterMontant(
      v === null || v === undefined ? '' : String(v),
    );
  }

  registerOnChange(fn: (v: number | null) => void): void {
    this.propager = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.toucher = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.el.nativeElement.disabled = disabled;
  }

  /**
   * ⚠️ LE CURSEUR SE REPOSITIONNE SUR LE NOMBRE DE CHIFFRES, PAS SUR L'INDICE.
   *
   *    Réécrire la valeur renvoie le curseur à la fin : corriger le premier
   *    chiffre d'un montant deviendrait impossible, et l'aide au confort
   *    visuel se paierait d'une saisie exaspérante. On compte donc les
   *    chiffres situés à gauche du curseur avant la mise en forme, et on le
   *    replace après le même nombre de chiffres. Un séparateur inséré ou
   *    retiré ne le déplace pas.
   */
  protected saisie(): void {
    const el = this.el.nativeElement;
    const gauche = chiffres(el.value.slice(0, el.selectionStart ?? el.value.length));

    const affiche = formaterMontant(el.value);
    el.value = affiche;

    let vus = 0;
    let position = affiche.length;
    for (let i = 0; i < affiche.length; i += 1) {
      if (vus === gauche) {
        position = i;
        break;
      }
      if (/\d/.test(affiche[i])) vus += 1;
      if (vus === gauche) position = i + 1;
    }
    el.setSelectionRange(position, position);

    // ⚠️ ON TRANSMET UN NOMBRE, PAS UNE CHAÎNE.
    //
    //    La directive propageait « 1234.56 ». Les champs qui la reçoivent sont
    //    déclarés `number | null`, et tous leurs appelants actuels encadrent
    //    par `Number(...)` — donc rien ne cassait. Mais la déclaration était
    //    fausse, et le premier qui s'y fierait écrirait `a + b` : sur deux
    //    montants de mille, la concaténation donne 1 0001 000, un résultat
    //    plausible à l'œil.
    //
    //    On rend donc la déclaration vraie plutôt que de l'affaiblir. Le champ
    //    vide et l'état « 1 234, » en cours de frappe valent respectivement
    //    null et 1234 : l'affichage garde la virgule, le modèle non.
    const brut = montantBrut(affiche);
    this.propager(brut === '' ? null : Number(brut));
  }

  /** À la sortie du champ, on retire la virgule laissée en suspens. */
  protected sortie(): void {
    const el = this.el.nativeElement;
    el.value = formaterMontant(montantBrut(el.value));
    this.toucher();
  }
}
