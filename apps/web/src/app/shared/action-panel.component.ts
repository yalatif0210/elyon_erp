import { Component, Input, signal } from '@angular/core';
import { IconComponent } from './icon.component';

/** Refus renvoyé par l'API — la validation rend un tableau, le métier une chaîne. */
export interface HttpFailure {
  error?: { message?: string | string[] };
}

/** Extrait le message utile d'un refus, quelle qu'en soit la forme. */
export function failureMessage(e: HttpFailure, fallback = 'Opération refusée.'): string {
  const m = e.error?.message;
  if (Array.isArray(m)) return m[0] ?? fallback;
  return m ?? fallback;
}

/**
 * Bandeau de compte rendu commun aux écrans d'action.
 *
 * Les refus viennent presque tous de la base : plancher de marge, verrou HSE,
 * moyen non conforme, prix hors bande. Ils portent leur motif rédigé, et c'est
 * ce motif qu'il faut montrer — pas un « une erreur est survenue » qui
 * obligerait l'utilisateur à deviner ce qu'on lui reproche.
 */
@Component({
  selector: 'erp-action-feedback',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (error) {
      <div
        class="mb-3 flex items-start gap-2 rounded-[3px] bg-crit-wash px-3 py-2 text-[13px] text-crit"
        role="alert"
      >
        <erp-icon name="alert-triangle" [size]="14" class="mt-0.5 shrink-0" />
        <span>{{ error }}</span>
      </div>
    }
    @if (success) {
      <p
        class="mb-3 flex items-center gap-2 rounded-[3px] bg-ok-wash px-3 py-2 text-[13px] text-ok"
        role="status"
      >
        <erp-icon name="check-circle" [size]="14" />
        {{ success }}
      </p>
    }
  `,
})
export class ActionFeedbackComponent {
  @Input() error: string | null = null;
  @Input() success: string | null = null;
}

/**
 * État partagé d'un écran d'action : occupation, refus, compte rendu.
 * Évite de réécrire les trois mêmes signaux dans chaque composant.
 */
export class ActionState {
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly done = signal<string | null>(null);

  start(): void {
    this.busy.set(true);
    this.error.set(null);
    this.done.set(null);
  }

  succeed(message: string): void {
    this.busy.set(false);
    this.done.set(message);
  }

  fail(e: HttpFailure, fallback?: string): void {
    this.busy.set(false);
    this.error.set(failureMessage(e, fallback));
  }
}
