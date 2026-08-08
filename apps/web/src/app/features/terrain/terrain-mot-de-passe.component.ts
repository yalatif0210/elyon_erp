import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FieldSessionService } from '../../core/field-session.service';
import { IconComponent } from '../../shared/icon.component';
import { messageServeur } from './terrain-depot';

/**
 * Changement de mot de passe TERRAIN.
 *
 * L'écran existe parce que le bandeau l'exige : un compte terrain est créé
 * avec un mot de passe provisoire et une bannière qui demande de le changer.
 * Sans cet écran, la bannière est une injonction sans issue — et l'agent
 * conserve indéfiniment un mot de passe que le coordinateur connaît.
 *
 * ⚠️ LA POLITIQUE EST CELLE DU SERVEUR, et elle n'est pas recopiée ici : la
 *    longueur minimale est affichée à titre indicatif, mais c'est le refus du
 *    serveur qui fait foi et qui s'affiche INTÉGRALEMENT. Une règle recopiée
 *    dans l'écran finirait par diverger de celle qui est appliquée, et l'agent
 *    verrait « conforme » sur une saisie que le serveur refuse.
 */
@Component({
  selector: 'terrain-mot-de-passe',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
  template: `
    <div class="t-screen">
      <a
        routerLink="/terrain"
        class="inline-flex min-h-[52px] items-center gap-1.5 text-[15px] font-semibold text-primary"
      >
        <erp-icon name="arrow-right" [size]="17" class="rotate-180" />
        Mes opérations
      </a>

      <h1 class="t-title mt-2">Changer mon mot de passe</h1>
      <p class="t-sub">
        Une phrase de passe longue résiste mieux qu’un mot court et compliqué. Douze caractères
        au minimum.
      </p>

      @if (erreur(); as e) {
        <div
          class="mt-3 rounded-[3px] border border-crit/30 bg-crit-wash px-3.5 py-3 text-[15px]
                 leading-relaxed text-crit"
          role="alert"
        >
          <p class="flex items-start gap-2 font-semibold">
            <erp-icon name="alert-triangle" [size]="18" class="mt-0.5" />
            Refusé
          </p>
          <p class="mt-1.5 whitespace-pre-line">{{ e }}</p>
        </div>
      }

      @if (fait()) {
        <p
          class="mt-3 flex items-start gap-2 rounded-[3px] border border-ok/30 bg-ok-wash px-3.5
                 py-3 text-[15px] leading-relaxed text-ok"
          role="status"
        >
          <erp-icon name="check-circle" [size]="18" class="mt-0.5" />
          <span>{{ fait() }}</span>
        </p>
      }

      <div class="mt-5">
        <label class="t-label" for="actuel">Mot de passe actuel</label>
        <input
          id="actuel"
          class="t-field"
          type="password"
          autocomplete="current-password"
          [(ngModel)]="actuel"
        />
      </div>

      <div class="mt-4">
        <label class="t-label" for="nouveau">Nouveau mot de passe</label>
        <input
          id="nouveau"
          class="t-field"
          type="password"
          autocomplete="new-password"
          [(ngModel)]="nouveau"
        />
      </div>

      <div class="mt-4">
        <label class="t-label" for="repeter">Répéter le nouveau mot de passe</label>
        <input
          id="repeter"
          class="t-field"
          type="password"
          autocomplete="new-password"
          [(ngModel)]="repete"
        />
        <!-- La seule vérification faite ICI : que les deux saisies coïncident.
             Le serveur ne peut pas la faire, il ne reçoit qu'une valeur — et
             une faute de frappe enfermerait l'agent dehors, sur site. -->
        @if (repete !== '' && nouveau !== repete) {
          <p class="t-hint text-crit">Les deux saisies ne coïncident pas.</p>
        }
      </div>

      <div class="t-actionbar">
        <button
          class="t-btn-primary"
          [disabled]="occupe() || actuel === '' || nouveau === '' || nouveau !== repete"
          (click)="changer()"
        >
          {{ occupe() ? 'Envoi…' : 'Changer le mot de passe' }}
        </button>
      </div>

      <p class="t-hint">
        Les autres sessions ouvertes sur d’autres appareils seront fermées : un mot de passe
        changé doit l’être partout, sinon changer ne protège de rien.
      </p>
    </div>
  `,
})
export class TerrainMotDePasseComponent {
  private readonly session = inject(FieldSessionService);
  private readonly router = inject(Router);

  protected actuel = '';
  protected nouveau = '';
  protected repete = '';

  protected readonly occupe = signal(false);
  protected readonly erreur = signal<string | null>(null);
  protected readonly fait = signal<string | null>(null);

  protected changer(): void {
    this.occupe.set(true);
    this.erreur.set(null);
    this.fait.set(null);

    this.session.changerMotDePasse(this.actuel, this.nouveau).subscribe({
      next: (res) => {
        this.occupe.set(false);
        this.actuel = this.nouveau = this.repete = '';
        this.fait.set(
          res.revokedSessions > 0
            ? `Mot de passe changé. ${res.revokedSessions} autre(s) session(s) fermée(s).`
            : 'Mot de passe changé.',
        );
        // On laisse le message se lire avant de rendre la main : basculer
        // aussitôt ferait douter que le changement a bien eu lieu.
        setTimeout(() => void this.router.navigate(['/terrain']), 2500);
      },
      error: (e: unknown) => {
        this.occupe.set(false);
        this.erreur.set(messageServeur(e, 'Changement refusé.'));
      },
    });
  }
}
