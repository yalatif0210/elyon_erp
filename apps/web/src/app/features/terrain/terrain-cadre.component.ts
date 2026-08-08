import { Component, Input, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FieldQueueService } from '../../core/field-queue.service';
import { IconComponent } from '../../shared/icon.component';

/**
 * Retour au dossier de l'opération.
 *
 * Cible tactile pleine hauteur : le chevron de 12 px des écrans de bureau est
 * inatteignable avec des gants, et se tromper de lien fait perdre une saisie
 * en cours.
 */
@Component({
  selector: 'terrain-retour',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <a
      [routerLink]="['/terrain/operation', operationId]"
      class="inline-flex min-h-[52px] items-center gap-1.5 text-[15px] font-semibold text-primary"
    >
      <erp-icon name="arrow-right" [size]="17" class="rotate-180" />
      Dossier de l’opération
    </a>
  `,
})
export class TerrainRetourComponent {
  @Input({ required: true }) operationId = '';
}

/**
 * Compte rendu d'une saisie — les trois natures de nouvelle, distinguées.
 *
 * ⚠️ Le motif du serveur est affiché INTÉGRALEMENT et sans reformulation.
 *    Il est rédigé pour l'agent, seul sur site : il dit quoi faire. Le
 *    remplacer par « une erreur est survenue » renverrait au bureau pour une
 *    information qu'on avait déjà en main.
 *
 * Le refus porte en plus sa conséquence, qui n'est pas évidente : l'événement
 * refusé ne repartira jamais, et corriger veut dire REFAIRE l'action. Un agent
 * qui l'ignore attend indéfiniment un envoi qui n'aura pas lieu.
 *
 * L'échec de TRANSPORT est distinct des deux autres : rien n'a été jugé, donc
 * rien n'est perdu. C'est le seul cas où attendre est la bonne conduite.
 */
@Component({
  selector: 'terrain-compte-rendu',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (erreur) {
      <div
        class="mt-3 rounded-[3px] border border-crit/30 bg-crit-wash px-3.5 py-3 text-[15px]
               leading-relaxed text-crit"
        role="alert"
      >
        <p class="flex items-start gap-2 font-semibold">
          <erp-icon name="alert-triangle" [size]="18" class="mt-0.5" />
          Refusé par le serveur
        </p>
        <p class="mt-1.5 whitespace-pre-line">{{ erreur }}</p>
        <p class="mt-2 text-[14px]">
          Ce refus est définitif pour cet enregistrement : il ne repartira pas tel quel. Levez la
          cause, puis refaites l’action — elle produira un enregistrement neuf.
        </p>
      </div>
    }

    @if (info) {
      <p
        class="mt-3 flex items-start gap-2 rounded-[3px] border border-ok/30 bg-ok-wash px-3.5 py-3
               text-[15px] leading-relaxed text-ok"
        role="status"
      >
        <erp-icon name="check-circle" [size]="18" class="mt-0.5" />
        <span>{{ info }}</span>
      </p>
    }

    @if (file.erreurTransport(); as panne) {
      <p
        class="mt-3 flex items-start gap-2 rounded-[3px] border border-warn/50 bg-warn-wash px-3.5
               py-3 text-[15px] leading-relaxed text-warn-ink"
      >
        <erp-icon name="clock" [size]="18" class="mt-0.5" />
        <span>{{ panne }}</span>
      </p>
    }
  `,
})
export class TerrainCompteRenduComponent {
  protected readonly file = inject(FieldQueueService);

  @Input() erreur: string | null = null;
  @Input() info: string | null = null;
}
