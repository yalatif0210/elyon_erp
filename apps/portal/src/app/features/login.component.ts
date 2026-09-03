import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { IconComponent } from '../shared/icon.component';

@Component({
  selector: 'erp-portal-login',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <!--
      Même traitement que la console interne (apps/web/login.component.ts) :
      image de marque en fond plein cadre, aucun texte superposé, carte de
      connexion blanche flottante. Un client qui reçoit un lien vers l'un ou
      l'autre doit reconnaître la même identité visuelle.
    -->
    <div
      class="relative flex min-h-screen items-center justify-center bg-cover bg-center px-4
             py-10 lg:justify-end lg:px-[6vw]"
      style="background-image: url('/assets/brand/fond-connexion.png?v=2'); background-color: #0a0a0a"
      role="img"
      aria-label="Elyon Trading — Powering Confidence"
    >
      <div class="w-full max-w-[400px] rounded-2xl bg-white p-8 shadow-2xl sm:p-9">
        <div class="mb-7 text-center">
          <h1 class="font-display text-[22px] font-bold tracking-[-0.01em] text-headline">
            Bienvenue
          </h1>
          <p class="mt-1.5 text-[13px] text-ink-muted">
            Connectez-vous à votre espace ELYON TRADING
          </p>
        </div>

        <form (ngSubmit)="submit()" novalidate>
          <div class="mb-3.5">
            <label class="label" for="email">Email</label>
            <div class="relative">
              <erp-icon
                name="mail"
                [size]="15"
                class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <input id="email" name="email" type="email" class="field pl-9" autocomplete="username"
                     placeholder="Entrez votre email" [(ngModel)]="email" required />
            </div>
          </div>

          <div class="mb-2">
            <label class="label" for="password">Mot de passe</label>
            <div class="relative">
              <erp-icon
                name="lock"
                [size]="15"
                class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <input id="password" [type]="showPassword() ? 'text' : 'password'" name="password"
                     class="field pl-9 pr-9" autocomplete="current-password"
                     placeholder="Entrez votre mot de passe" [(ngModel)]="password" required />
              <button
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-soft"
                [attr.aria-label]="showPassword() ? 'Masquer le mot de passe' : 'Afficher le mot de passe'"
                (click)="showPassword.set(!showPassword())"
              >
                <erp-icon [name]="showPassword() ? 'eye-off' : 'eye'" [size]="15" />
              </button>
            </div>
          </div>

          <!-- Le champ n'apparaît qu'après un refus explicite pour code manquant :
               l'afficher d'emblée déroute les comptes sans second facteur. -->
          @if (totpRequired()) {
            <div class="mb-3.5 mt-3.5">
              <label class="label" for="totp">Code de vérification</label>
              <input id="totp" name="totp" inputmode="numeric" maxlength="6"
                     class="field font-mono tracking-[0.35em]" placeholder="000000"
                     autocomplete="one-time-code" [(ngModel)]="totpCode" />
            </div>
          }

          @if (error()) {
            <div class="mb-3.5 mt-3.5 flex items-start gap-2 rounded-[3px] border border-crit/25
                        bg-crit-wash px-3 py-2 text-[13px] text-crit" role="alert">
              <erp-icon name="alert-triangle" [size]="14" class="mt-0.5" />
              <span>{{ error() }}</span>
            </div>
          }

          <button type="submit" class="btn-primary mt-5 w-full" [disabled]="busy()">
            {{ busy() ? 'Connexion…' : 'Se connecter' }}
          </button>
        </form>

        <p class="mt-6 border-t border-rule pt-4 text-center text-[11px] leading-relaxed text-ink-faint">
          Portail client : accès réservé aux comptes rattachés à un tiers.<br />
          Besoin d'aide ? Contactez votre interlocuteur Elyon Trading.
        </p>
      </div>
    </div>
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected email = '';
  protected password = '';
  protected totpCode = '';

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly totpRequired = signal(false);
  protected readonly showPassword = signal(false);

  protected submit(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    // .trim() sur le mot de passe aussi : un mot de passe provisoire copié-
    // collé depuis une messagerie embarque souvent un espace ou un saut de
    // ligne invisible en fin de chaîne, rejeté avec le même message générique
    // qu'un vrai mot de passe erroné — constaté en direct sur un compte terrain.
    this.auth.login(this.email.trim(), this.password.trim(), this.totpCode || undefined).subscribe({
      next: () => {
        this.busy.set(false);
        void this.router.navigate(['/tableau-de-bord']);
      },
      error: (err: { error?: { message?: string } }) => {
        this.busy.set(false);
        const message = err.error?.message ?? 'Connexion impossible';
        // Le serveur ne distingue jamais « compte inconnu » de « mot de passe
        // erroné » — on n'invente pas ici la distinction qu'il refuse de faire.
        if (message.toLowerCase().includes('second facteur')) {
          this.totpRequired.set(true);
        }
        this.error.set(message);
      },
    });
  }
}
