import { Component, OnDestroy, OnInit, computed, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { FieldApiService } from '../../core/field-api.service';
import { FieldQueueService } from '../../core/field-queue.service';
import { FieldSessionService } from '../../core/field-session.service';
import { IconComponent } from '../../shared/icon.component';
import { ROLES_TERRAIN } from './terrain-libelles';

/**
 * Cadre TERRAIN.
 *
 * Volontairement dépouillé, et sans rien de commun avec la coquille
 * bureautique : pas de barre latérale de dix entrées, pas de sous-navigation.
 * Un agent sur site ne parcourt pas une arborescence, il exécute une liste de
 * travail. Deux destinations suffisent — ses opérations, et sa file d'envoi —
 * et l'une des deux est un compteur qu'il doit voir sans la chercher.
 *
 * L'entête reste collée en haut parce qu'elle porte l'état de la file : c'est
 * la seule information qui doit rester visible pendant qu'on saisit.
 */
@Component({
  selector: 'terrain-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, IconComponent],
  template: `
    <div class="min-h-screen bg-paper">
      <header
        class="sticky top-0 z-30 flex h-[68px] items-center justify-between gap-3 border-b
               border-gray-900/[0.12] bg-surface px-4 shadow-soft"
      >
        <a routerLink="/terrain" class="flex min-w-0 items-center gap-2.5">
          <div
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] bg-primary text-white"
          >
            <erp-icon name="clipboard-check" [size]="19" />
          </div>
          <span class="min-w-0">
            <span class="block truncate text-[15px] font-semibold text-gray-900">
              {{ profil()?.fullName }}
            </span>
            <span class="block truncate text-[12px] text-ink-muted">{{ roleLisible() }}</span>
          </span>
        </a>

        <div class="flex shrink-0 items-center gap-2">
          <!--
            Le compteur de file est un LIEN, pas un badge décoratif : quand il
            n'est pas à zéro, l'agent doit pouvoir en connaître la cause d'un
            seul geste. Le rouge des refus prime sur l'orange de l'attente —
            un refus arrête l'opération, une attente non.
          -->
          <a
            routerLink="/terrain/file"
            class="flex min-h-[52px] items-center gap-1.5 rounded-[3px] border px-3
                   text-[15px] font-semibold"
            [class]="classeFile()"
          >
            <erp-icon [name]="refuses() > 0 ? 'alert-triangle' : 'clock'" [size]="17" />
            {{ refuses() > 0 ? refuses() : enAttente() }}
            <span class="sr-only">
              {{ refuses() > 0 ? 'événements refusés' : 'événements en attente d’envoi' }}
            </span>
          </a>

          <button
            class="flex min-h-[52px] min-w-[52px] items-center justify-center rounded-[3px]
                   border border-rule-strong text-ink"
            (click)="quitter()"
            aria-label="Déconnexion"
          >
            <erp-icon name="log-out" [size]="19" />
          </button>
        </div>
      </header>

      @if (session.motDePasseAChanger()) {
        <div class="flex items-center gap-2 border-b border-rule bg-info-wash px-4 py-3 text-[14px] text-info">
          <erp-icon name="lock" [size]="16" />
          Mot de passe provisoire.
          <a routerLink="/terrain/mot-de-passe" class="font-semibold underline underline-offset-2">
            Le changer
          </a>
        </div>
      }
      @if (session.totpRequis()) {
        <div class="flex items-center gap-2 border-b border-rule bg-crit-wash px-4 py-3 text-[14px] text-crit">
          <erp-icon name="lock" [size]="16" />
          Second facteur obligatoire, non configuré.
          <a routerLink="/terrain/second-facteur" class="font-semibold underline underline-offset-2">
            Le configurer
          </a>
        </div>
      }

      <router-outlet />
    </div>
  `,
})
export class TerrainShellComponent implements OnInit, OnDestroy {
  protected readonly session = inject(FieldSessionService);
  private readonly file = inject(FieldQueueService);
  private readonly api = inject(FieldApiService);

  protected readonly profil = this.session.profil;
  protected readonly enAttente = computed(() => this.file.enAttente().length);
  protected readonly refuses = computed(() => this.file.refuses().length);

  protected readonly roleLisible = computed(() => {
    const role = this.session.role();
    return role ? ROLES_TERRAIN[role] : '';
  });

  protected readonly classeFile = computed(() => {
    if (this.refuses() > 0) return 'border-crit/40 bg-crit-wash text-crit';
    if (this.enAttente() > 0) return 'border-warn/50 bg-warn-wash text-warn-ink';
    return 'border-rule-strong bg-surface text-ink-muted';
  });

  /**
   * La position est suivie tant que le cadre terrain est monté, et arrêtée
   * ensuite : une veille de géolocalisation qui survivrait à la déconnexion
   * consommerait la batterie d'une tablette dont c'est la ressource rare.
   */
  ngOnInit(): void {
    this.file.suivrePosition();
    // Ouvre le stockage local et REPREND ce qui attendait depuis la dernière
    // session : une journée saisie hors réseau ne doit pas se perdre parce que
    // la tablette s'est éteinte. C'est le premier geste du cadre, avant tout
    // écran de saisie.
    void this.file.initialiser();
    // Vocabulaire fixe (§ 25/08/2026) — chargé une fois ici, pour que
    // « source », « nature » et « gravité » proposent leurs valeurs dès le
    // premier écran visité, sans attendre un refus pour les apprendre.
    this.api.chargerVocabulaire();
  }

  ngOnDestroy(): void {
    this.file.arreterPosition();
  }

  protected quitter(): void {
    this.session.deconnexion();
  }
}
