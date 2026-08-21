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
    <div class="flex min-h-screen">
      <div class="hidden w-[46%] flex-col justify-between border-r border-rule bg-surface p-10 lg:flex">
        <div class="flex items-center gap-2.5">
          <img src="/assets/brand/logo.png" alt="Elyon Trading" class="h-8 w-auto" />
        </div>

        <div class="max-w-md">
          <h2 class="text-[26px] font-semibold leading-[1.25] tracking-[-0.02em] text-ink">
            Vos demandes, vos affaires,<br />vos factures, au même endroit.
          </h2>
          <p class="mt-4 text-[14px] leading-relaxed text-ink-soft">
            Déposez une demande de cotation, suivez vos affaires jusqu'à l'acceptation de la
            proforma, consultez l'avancement de vos livraisons et vos factures émises.
          </p>
        </div>

        <p class="text-[11px] text-ink-faint">Portail client · Côte d'Ivoire</p>
      </div>

      <div class="flex flex-1 items-center justify-center px-6 py-12">
        <div class="w-full max-w-[340px]">
          <div class="mb-7 lg:hidden">
            <img src="/assets/brand/logo.png" alt="Elyon Trading" class="h-11 w-auto" />
          </div>

          <h1 class="page-title">Connexion</h1>
          <p class="page-sub mb-6">Portail client : accès réservé aux comptes rattachés à un tiers.</p>

          <form (ngSubmit)="submit()" novalidate>
            <div class="mb-3.5">
              <label class="label" for="email">Adresse électronique</label>
              <input
                id="email"
                name="email"
                type="email"
                class="field"
                autocomplete="username"
                [(ngModel)]="email"
                required
              />
            </div>

            <div class="mb-3.5">
              <label class="label" for="password">Mot de passe</label>
              <input
                id="password"
                name="password"
                type="password"
                class="field"
                autocomplete="current-password"
                [(ngModel)]="password"
                required
              />
            </div>

            @if (error()) {
              <div
                class="mb-3.5 flex items-start gap-2 rounded-[3px] border border-crit/25 bg-crit-wash px-3 py-2 text-[13px] text-crit"
                role="alert"
              >
                <erp-icon name="alert-triangle" [size]="14" class="mt-0.5" />
                <span>{{ error() }}</span>
              </div>
            }

            <button type="submit" class="btn-primary mt-1 w-full" [disabled]="busy()">
              {{ busy() ? 'Connexion…' : 'Se connecter' }}
            </button>
          </form>
        </div>
      </div>
    </div>
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected email = '';
  protected password = '';

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    this.auth.login(this.email.trim(), this.password).subscribe({
      next: () => {
        this.busy.set(false);
        void this.router.navigate(['/tableau-de-bord']);
      },
      error: (err: { error?: { message?: string } }) => {
        this.busy.set(false);
        this.error.set(err.error?.message ?? 'Connexion impossible');
      },
    });
  }
}
