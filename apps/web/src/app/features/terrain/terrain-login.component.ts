import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { FieldSessionService } from '../../core/field-session.service';
import { IconComponent } from '../../shared/icon.component';

/**
 * Connexion au réalm TERRAIN.
 *
 * Écran distinct de la connexion bureautique, et pas seulement par la taille
 * des champs : ce sont deux réalms, deux jetons, deux périmètres. Un agent qui
 * saisirait ses identifiants sur `/connexion` obtiendrait un refus sans
 * comprendre pourquoi — la porte le dit donc d'entrée.
 */
@Component({
  selector: 'terrain-login',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="min-h-screen bg-paper">
      <div class="t-screen">
        <div class="mb-8 mt-6 flex items-center gap-3">
          <div class="flex h-11 w-11 items-center justify-center rounded-[3px] bg-primary text-white">
            <erp-icon name="clipboard-check" [size]="22" />
          </div>
          <div>
            <p class="font-display text-[18px] font-bold text-headline">Elyon Trading</p>
            <p class="text-[14px] text-ink-muted">Terrain</p>
          </div>
        </div>

        <h1 class="t-title">Connexion</h1>
        <p class="t-sub">
          Accès réservé aux agents d’opération et au contrôleur HSE. Les écrans de gestion ne
          sont pas accessibles depuis cette tablette.
        </p>

        <form class="mt-6" (ngSubmit)="valider()" novalidate>
          <div class="mb-4">
            <label class="t-label" for="courriel">Adresse électronique</label>
            <input
              id="courriel"
              name="courriel"
              type="email"
              inputmode="email"
              autocomplete="username"
              autocapitalize="none"
              class="t-field"
              [(ngModel)]="courriel"
            />
          </div>

          <div class="mb-4">
            <label class="t-label" for="motdepasse">Mot de passe</label>
            <input
              id="motdepasse"
              name="motdepasse"
              type="password"
              autocomplete="current-password"
              class="t-field"
              [(ngModel)]="motDePasse"
            />
          </div>

          <!-- N'apparaît qu'après un refus explicite : l'afficher d'emblée
               déroute les comptes sans second facteur. -->
          @if (totpDemande()) {
            <div class="mb-4">
              <label class="t-label" for="totp">Code de vérification</label>
              <input
                id="totp"
                name="totp"
                inputmode="numeric"
                maxlength="6"
                autocomplete="one-time-code"
                class="t-field font-mono tracking-[0.4em]"
                placeholder="000000"
                [(ngModel)]="codeTotp"
              />
            </div>
          }

          @if (erreur()) {
            <div
              class="mb-4 flex items-start gap-2 rounded-[3px] border border-crit/30 bg-crit-wash
                     px-3.5 py-3 text-[15px] leading-relaxed text-crit"
              role="alert"
            >
              <erp-icon name="alert-triangle" [size]="18" class="mt-0.5" />
              <span>{{ erreur() }}</span>
            </div>
          }

          <button type="submit" class="t-btn-primary mt-2" [disabled]="occupe()">
            {{ occupe() ? 'Connexion…' : 'Se connecter' }}
          </button>
        </form>

        <p class="mt-8 border-t border-rule pt-4 text-[13px] leading-relaxed text-ink-muted">
          Cette tablette est identifiée par
          <span class="font-mono text-[12px] text-ink">{{ appareil }}</span
          >. Une connexion depuis un appareil autre que celui qui vous est assigné n’est pas
          refusée, mais elle est journalisée.
        </p>
      </div>
    </div>
  `,
})
export class TerrainLoginComponent {
  private readonly session = inject(FieldSessionService);
  private readonly router = inject(Router);

  protected courriel = '';
  protected motDePasse = '';
  protected codeTotp = '';

  protected readonly appareil = this.session.appareil;
  protected readonly occupe = signal(false);
  protected readonly erreur = signal<string | null>(null);
  protected readonly totpDemande = signal(false);

  protected valider(): void {
    if (this.occupe()) return;
    this.occupe.set(true);
    this.erreur.set(null);

    this.session
      .connexion(this.courriel.trim(), this.motDePasse, this.codeTotp || undefined)
      .subscribe({
        next: () => {
          this.occupe.set(false);
          void this.router.navigate(['/terrain']);
        },
        error: (e: { error?: { message?: string | string[] } }) => {
          this.occupe.set(false);
          const brut = e.error?.message;
          const message = Array.isArray(brut) ? brut.join(' · ') : (brut ?? 'Connexion impossible.');
          // Le serveur ne distingue jamais « compte inconnu » de « mot de passe
          // erroné » : on n'invente pas ici la distinction qu'il refuse de faire.
          if (message.toLowerCase().includes('second facteur')) this.totpDemande.set(true);
          this.erreur.set(message);
        },
      });
  }
}
