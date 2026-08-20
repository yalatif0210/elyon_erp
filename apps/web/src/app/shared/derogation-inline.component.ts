import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, Derogation } from '../core/api.service';
import { ActionFeedbackComponent, ActionState, HttpFailure } from './action-panel.component';
import { IconComponent } from './icon.component';

/**
 * Octroi d'une dérogation, EN PLACE dans l'écran qui en a besoin (§ 11.4).
 *
 * ⚠️ CORRIGÉ — AUCUN CHEMIN N'EXISTAIT POUR ACCORDER UNE DÉROGATION.
 *
 *    Le registre (`derogations.component.ts`) listait, revoyait, révoquait —
 *    jamais n'en créait. Les paramètres `marginDerogationId`,
 *    `purchasePriceDerogationId`, `creditDerogationId`, `complianceDerogationId`
 *    existaient sur les DTO d'approbation et d'affectation, documentés comme
 *    obligatoires dans certains cas, et jamais renseignés par aucun écran :
 *    un DG qui devait lever un verrou n'avait tout simplement aucun bouton.
 *
 * Volontairement EN PLACE plutôt que sur un écran séparé : l'autorité qui
 * accorde la dérogation est celle-là même qui approuve ou affecte l'instant
 * d'après. La faire changer d'écran pour aller chercher un identifiant à
 * copier-coller serait le genre de détour qu'on finit par contourner.
 */
@Component({
  selector: 'erp-derogation-inline',
  standalone: true,
  imports: [FormsModule, ActionFeedbackComponent, IconComponent],
  template: `
    @if (accordee(); as d) {
      <p class="flex items-center gap-2 rounded-[3px] bg-ok-wash px-3 py-2 text-[12px] text-ok">
        <erp-icon name="check-circle" [size]="13" />
        Dérogation accordée le {{ d.grantedAt.slice(0, 10) }} : elle sera jointe à l’envoi.
      </p>
    } @else {
      <div class="rounded-[3px] border border-warn/40 bg-warn-wash px-3 py-3">
        <p class="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-warn-ink">
          <erp-icon name="lock" [size]="13" />
          {{ titre }}
        </p>
        <erp-action-feedback [error]="state.error()" [success]="null" />
        <textarea
          class="field text-[12px]"
          rows="2"
          maxlength="2000"
          placeholder="Motif circonstancié : 10 caractères minimum"
          [(ngModel)]="reason"
        ></textarea>
        <button
          type="button"
          class="btn-ghost mt-2 text-[12px]"
          [disabled]="state.busy() || reason.trim().length < 10"
          (click)="creer()"
        >
          {{ state.busy() ? 'Envoi…' : 'Accorder la dérogation' }}
        </button>
      </div>
    }
  `,
})
export class DerogationInlineComponent {
  private readonly api = inject(ApiService);
  protected readonly state = new ActionState();

  @Input({ required: true }) type!: string;
  @Input({ required: true }) subjectType!: string;
  /** DOIT être la référence lisible du sujet (§ commentaire d'`api.service.ts`). */
  @Input() subjectId?: string;
  @Input() subjectLabel?: string;
  @Input() titre = 'Une dérogation est nécessaire pour poursuivre';
  @Output() readonly accorde = new EventEmitter<string>();

  protected reason = '';
  protected readonly accordee = signal<Derogation | null>(null);

  protected creer(): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api
      .createDerogation({
        type: this.type,
        subjectType: this.subjectType,
        subjectId: this.subjectId,
        subjectLabel: this.subjectLabel,
        reason: this.reason.trim(),
      })
      .subscribe({
        next: (d) => {
          this.state.succeed('Dérogation accordée.');
          this.accordee.set(d);
          this.accorde.emit(d.id);
        },
        error: (e: HttpFailure) => this.state.fail(e, 'Dérogation refusée.'),
      });
  }
}
