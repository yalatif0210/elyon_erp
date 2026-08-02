import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { IconComponent } from '../shared/icon.component';

@Component({
  selector: 'erp-login',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="flex min-h-screen items-center justify-center px-4">
      <div class="w-full max-w-sm">
        <div class="mb-8 text-center">
          <div class="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-sky-500 text-slate-950">
            <erp-icon name="layers" [size]="22" />
          </div>
          <h1 class="text-lg font-semibold text-slate-100">Elyon Trading</h1>
          <p class="mt-1 text-sm text-slate-500">Console interne</p>
        </div>

        <form class="card p-5" (ngSubmit)="submit()">
          <div class="mb-4">
            <label class="label" for="email">Adresse électronique</label>
            <input id="email" name="email" type="email" class="field" autocomplete="username"
                   [(ngModel)]="email" required />
          </div>

          <div class="mb-4">
            <label class="label" for="password">Mot de passe</label>
            <input id="password" name="password" type="password" class="field"
                   autocomplete="current-password" [(ngModel)]="password" required />
          </div>

          <!-- Le champ n'apparaît qu'après un refus explicite pour code manquant :
               l'afficher d'emblée déroute les comptes sans second facteur. -->
          @if (totpRequired()) {
            <div class="mb-4">
              <label class="label" for="totp">Code de vérification</label>
              <input id="totp" name="totp" inputmode="numeric" maxlength="6"
                     class="field font-mono tracking-widest" placeholder="000000"
                     autocomplete="one-time-code" [(ngModel)]="totpCode" />
            </div>
          }

          @if (error()) {
            <div class="mb-4 flex items-start gap-2 rounded-md bg-rose-500/10 px-3 py-2
                        text-sm text-rose-400 ring-1 ring-inset ring-rose-500/30">
              <erp-icon name="alert-triangle" [size]="15" />
              <span>{{ error() }}</span>
            </div>
          }

          <button type="submit" class="btn-primary w-full" [disabled]="busy()">
            {{ busy() ? 'Connexion…' : 'Se connecter' }}
          </button>
        </form>

        <p class="mt-6 text-center text-xs text-slate-600">
          Accès réservé. Toute connexion est journalisée.
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

  protected submit(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    this.auth.login(this.email.trim(), this.password, this.totpCode || undefined).subscribe({
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
