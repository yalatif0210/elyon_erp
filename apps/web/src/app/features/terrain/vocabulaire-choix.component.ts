import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FieldVocabularyService } from '../../core/field-vocabulary.service';

/**
 * Choix d'une valeur d'énumération, SANS liste écrite en dur.
 *
 * Les propositions viennent du vocabulaire appris de l'API (valeurs observées
 * dans les objets lus, valeurs énumérées par les messages de refus). Deux
 * conséquences assumées et rendues visibles à l'écran :
 *
 *   · tant que la tablette n'a rien vu, la liste est vide et le champ bascule
 *     en saisie libre — un champ ouvert vaut mieux qu'une liste inventée qui
 *     serait fausse le jour où le serveur en ajoute une ;
 *   · même quand la liste existe, l'échappement reste offert : le vocabulaire
 *     est ce qu'on a VU, pas nécessairement tout ce qui est admis, et l'agent
 *     ne doit jamais rester bloqué devant une liste incomplète.
 *
 * Les codes sont affichés tels quels. On ne leur invente pas de traduction :
 * une correspondance écrite ici afficherait un libellé faux dès la première
 * valeur ajoutée côté serveur.
 */
@Component({
  selector: 'terrain-choix',
  standalone: true,
  imports: [FormsModule],
  template: `
    <label class="t-label" [attr.for]="idChamp">{{ libelle }}</label>

    @if (options().length > 0 && !saisieLibre()) {
      <select
        [id]="idChamp"
        class="t-field"
        [ngModel]="value"
        (ngModelChange)="valueChange.emit($event)"
      >
        <option value="">— à choisir —</option>
        @for (o of options(); track o) {
          <option [value]="o">{{ o }}</option>
        }
      </select>
      <button type="button" class="t-hint underline underline-offset-2" (click)="ouvrirSaisie()">
        La valeur attendue ne figure pas dans la liste
      </button>
    } @else {
      <input
        [id]="idChamp"
        class="t-field font-mono uppercase"
        autocapitalize="characters"
        autocomplete="off"
        [ngModel]="value"
        (ngModelChange)="valueChange.emit($event)"
      />
      <p class="t-hint">
        @if (options().length === 0) {
          Aucune valeur n’a encore été publiée par le serveur pour ce champ. Saisissez le code
          attendu : s’il ne convient pas, le refus du serveur en donnera la liste, et elle sera
          proposée ensuite.
        } @else {
          Saisie libre. Valeurs déjà rencontrées : {{ options().join(', ') }}
        }
      </p>
    }
  `,
})
export class VocabulaireChoixComponent {
  private readonly vocabulaire = inject(FieldVocabularyService);

  /**
   * Nom du champ DANS LE DTO DU SERVEUR — `phase`, `to`, `type`, `severity`…
   *
   * Adossé à un signal, et non laissé en simple propriété : `options()` est un
   * `computed`, et un `computed` qui lit une propriété ordinaire ne se
   * recalcule pas quand elle change. Le défaut serait invisible en recette —
   * ces entrées sont fixes par écran — et se révélerait le jour où l'une
   * devient dynamique.
   */
  @Input({ required: true }) set champ(v: string) {
    this.champSignal.set(v);
  }
  @Input({ required: true }) libelle = '';
  @Input({ required: true }) idChamp = '';
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();

  /** Valeurs à écarter — une transition vers l'état courant n'a pas de sens. */
  @Input() set exclure(v: readonly string[]) {
    this.exclureSignal.set(v);
  }

  private readonly champSignal = signal('');
  private readonly exclureSignal = signal<readonly string[]>([]);

  protected readonly saisieLibre = signal(false);

  protected readonly options = computed(() =>
    this.vocabulaire.liste(this.champSignal()).filter((v) => !this.exclureSignal().includes(v)),
  );

  protected ouvrirSaisie(): void {
    this.saisieLibre.set(true);
  }
}
