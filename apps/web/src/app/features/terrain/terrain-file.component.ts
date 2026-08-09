import { Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FieldPhotoService } from '../../core/field-photo.service';
import { FieldQueueService } from '../../core/field-queue.service';
import { IconComponent } from '../../shared/icon.component';
import { jourHeure } from './terrain-libelles';

/**
 * LA FILE D'ENVOI, telle que l'agent doit pouvoir la lire.
 *
 * C'est l'écran auquel mène le compteur du bandeau. Sans lui, ce compteur est
 * un chiffre sans recours : l'agent voit « 3 refusés » et n'a aucun moyen de
 * savoir lesquels, ni pourquoi, ni quoi faire.
 *
 * ⚠️ LES TROIS SORTS N'APPELLENT PAS LA MÊME CONDUITE, et l'écran doit le dire
 *    explicitement — c'est la seule information qui compte ici :
 *
 *      en attente / suspendu → ne rien faire, cela repartira tout seul ;
 *      refusé                → lire le motif, lever la cause, REFAIRE l'action ;
 *      acquis                → c'est en base, il n'y a plus rien à faire.
 *
 *    Confondre « suspendu » et « refusé » conduirait l'agent soit à refaire un
 *    travail qui allait partir, soit à attendre indéfiniment un envoi qui
 *    n'aura jamais lieu.
 */
@Component({
  selector: 'terrain-file',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <div class="t-screen">
      <a
        routerLink="/terrain"
        class="inline-flex min-h-[52px] items-center gap-1.5 text-[15px] font-semibold text-primary"
      >
        <erp-icon name="arrow-right" [size]="17" class="rotate-180" />
        Mes opérations
      </a>

      <h1 class="t-title mt-2">File d’envoi</h1>
      <p class="t-sub">
        Tout ce que vous saisissez passe par ici avant d’être transmis.
      </p>

      <!-- ============ Où sont conservées les saisies ============ -->
      @if (file.avertissementStockage(); as alerte) {
        <p
          class="mt-3 flex items-start gap-2 rounded-[3px] border border-warn/50 bg-warn-wash px-3.5
                 py-3 text-[15px] leading-relaxed text-warn-ink"
        >
          <erp-icon name="alert-triangle" [size]="18" class="mt-0.5 shrink-0" />
          <span>{{ alerte }}</span>
        </p>
      } @else {
        <p class="mt-3 flex items-start gap-2 text-[15px] leading-relaxed text-ink-soft">
          <erp-icon name="lock" [size]="17" class="mt-0.5 shrink-0 text-ok" />
          <span>
            Vos saisies sont conservées sur la tablette. Elles survivent à une extinction et
            repartiront d’elles-mêmes au retour du réseau.
          </span>
        </p>
      }

      @if (file.erreurTransport(); as panne) {
        <p class="mt-3 rounded-[3px] border border-warn/50 bg-warn-wash px-3.5 py-3 text-[15px] leading-relaxed text-warn-ink">
          {{ panne }}
          <span class="mt-1 block">
            Rien n’a été jugé : tout ce qui attend repartira tel quel, sans doublon.
          </span>
        </p>
      }

      <div class="t-actionbar">
        <button class="t-btn-primary" [disabled]="file.envoiEnCours() || enAttente() === 0" (click)="renvoyer()">
          {{ file.envoiEnCours() ? 'Envoi…' : 'Envoyer maintenant' }}
        </button>
      </div>

      <!-- ============ À traiter par l'agent ============ -->
      <p class="t-section">
        Refusés : action requise
        @if (refuses().length > 0) { ({{ refuses().length }}) }
      </p>
      @for (e of refuses(); track e.id) {
        <div class="mt-2 rounded-[3px] border border-crit/40 bg-crit-wash p-4">
          <p class="text-[17px] font-semibold leading-snug text-crit">{{ e.intitule }}</p>
          <p class="mt-0.5 text-[14px] text-ink-muted">
            {{ e.reference }} · {{ dateHeureDe(e.deviceTimestamp) }}
          </p>
          <p class="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-crit">{{ e.motif }}</p>
          <p class="mt-2 text-[14px] leading-relaxed text-ink-soft">
            Ce refus est définitif pour cette saisie : elle ne repartira pas. Levez la cause,
            puis <strong>refaites l’action</strong> depuis l’opération.
          </p>
        </div>
      } @empty {
        <p class="t-hint">Aucun refus.</p>
      }

      <!-- ============ Rien à faire, cela part tout seul ============ -->
      <p class="t-section">
        En attente d’envoi
        @if (enAttente() > 0) { ({{ enAttente() }}) }
      </p>
      @for (e of attente(); track e.id) {
        <div class="mt-2 rounded-[3px] border border-rule-strong bg-surface p-4">
          <div class="flex items-start justify-between gap-3">
            <p class="text-[17px] font-semibold leading-snug text-ink">{{ e.intitule }}</p>
            <span
              class="shrink-0 rounded-[3px] px-2 py-1 text-[13px] font-semibold"
              [class]="e.etat === 'SUSPENDU' ? 'bg-warn-wash text-warn-ink' : 'bg-gray-100 text-ink-muted'"
            >
              {{ e.etat === 'SUSPENDU' ? 'Suspendu' : 'En attente' }}
            </span>
          </div>
          <p class="mt-0.5 text-[14px] text-ink-muted">
            {{ e.reference }} · {{ dateHeureDe(e.deviceTimestamp) }}
            @if (e.presentations > 1) { · {{ e.presentations }} tentatives }
          </p>
          @if (e.etat === 'SUSPENDU') {
            <p class="mt-2 text-[15px] leading-relaxed text-ink-soft">
              Une saisie antérieure de la même opération a été refusée. Celle-ci n’a pas été
              jugée : elle repartira inchangée une fois le refus traité. Ne la refaites pas.
            </p>
          }
        </div>
      } @empty {
        <p class="t-hint">Rien en attente.</p>
      }

      <!-- ============ Photos — file distincte ============ -->
      <p class="t-section">
        Photos
        @if (photos.enAttente().length > 0) { ({{ photos.enAttente().length }} en cours) }
      </p>
      <p class="t-hint">
        Les photos partent par une file distincte, pour qu’une pièce lourde ne retienne jamais
        un contrôle qui, lui, débloque l’opération.
      </p>
      @for (p of photos.refusees(); track p.clientUuid) {
        <div class="mt-2 rounded-[3px] border border-crit/40 bg-crit-wash p-4">
          <p class="text-[15px] font-semibold text-crit">Photo refusée</p>
          <p class="mt-1 text-[15px] leading-relaxed text-crit">{{ p.motif }}</p>
          <button
            type="button"
            class="mt-2 text-[15px] font-semibold text-primary underline"
            (click)="photos.retirer(p.clientUuid)"
          >
            Retirer de la file
          </button>
        </div>
      }

      <!-- ============ Acquis — pour mémoire ============ -->
      <p class="t-section">Envoyés et acceptés</p>
      @for (e of file.acquis(); track e.id) {
        <div class="mt-2 flex items-start gap-2 rounded-[3px] border border-rule px-4 py-3">
          <erp-icon name="check-circle" [size]="17" class="mt-0.5 shrink-0 text-ok" />
          <span class="text-[15px] leading-snug text-ink-soft">
            {{ e.intitule }}
            <span class="block text-[14px] text-ink-muted">{{ e.reference }}</span>
          </span>
        </div>
      } @empty {
        <p class="t-hint">Rien d’envoyé pour l’instant.</p>
      }
    </div>
  `,
})
export class TerrainFileComponent implements OnInit {
  protected readonly file = inject(FieldQueueService);
  protected readonly photos = inject(FieldPhotoService);

  protected readonly dateHeureDe = jourHeure;

  protected readonly attente = this.file.enAttente;
  protected readonly refuses = this.file.refuses;
  protected readonly enAttente = computed(() => this.attente().length);

  /**
   * Une tentative d'envoi à l'ouverture.
   *
   * L'agent qui vient consulter sa file est, la plupart du temps, quelqu'un
   * qui vient de retrouver du réseau et veut vérifier que tout est parti.
   */
  ngOnInit(): void {
    void this.file.envoyer();
    void this.photos.envoyer();
  }

  protected renvoyer(): void {
    void this.file.envoyer();
    void this.photos.envoyer();
  }
}
