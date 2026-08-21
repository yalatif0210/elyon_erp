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
    <!--
      Même traitement que la console interne et le portail (login.component.ts
      des deux applications) : fond plein cadre, aucun texte superposé, carte
      de connexion blanche flottante. Les champs et le bouton restent ceux du
      jeu tactile (t-field, t-btn-primary) — cet écran se consulte sur une
      tablette, pas au bureau.
    -->
    <div
      class="relative flex min-h-screen items-center justify-center bg-cover bg-center px-4
             py-10 lg:justify-end lg:px-[6vw]"
      style="background-image: url('/assets/brand/fond-connexion.png?v=2'); background-color: #0a0a0a"
      role="img"
      aria-label="Elyon Trading — Powering Confidence"
    >
      <div class="w-full max-w-[420px] rounded-2xl bg-white p-8 shadow-2xl sm:p-9">
        <div class="mb-6 flex justify-center">
          <img src="/assets/brand/logo.png?v=2" alt="Elyon Trading" class="h-11 w-auto" />
        </div>

        <div class="mb-7 text-center">
          <h1 class="font-display text-[22px] font-bold tracking-[-0.01em] text-headline">
            Connexion terrain
          </h1>
          <p class="mt-1.5 text-[13px] text-ink-muted">
            Réservée aux agents d’opération et au contrôleur HSE
          </p>
        </div>

        <form (ngSubmit)="valider()" novalidate>
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

        <p class="mt-6 border-t border-rule pt-4 text-center text-[12px] leading-relaxed text-ink-faint">
          Cette tablette est identifiée par
          <span class="font-mono text-ink-muted">{{ appareil }}</span
          >. Une connexion depuis un autre appareil n’est pas refusée, mais elle est journalisée.
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

    // .trim() sur le mot de passe aussi : un mot de passe provisoire copié-
    // collé depuis une messagerie embarque souvent un espace ou un saut de
    // ligne invisible en fin de chaîne — constaté en direct, un agent
    // terrain rejeté par « Identifiants invalides » avec le bon mot de passe.
    this.session
      .connexion(this.courriel.trim(), this.motDePasse.trim(), this.codeTotp || undefined)
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
