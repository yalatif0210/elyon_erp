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
    <div class="flex min-h-screen">
      <!--
        Le panneau de gauche n'est pas décoratif : il énonce ce que la console
        engage. Un ERP dont chaque écriture est journalisée et dont les verrous
        sont opposables se présente comme tel dès la porte.
      -->
      <div class="hidden w-[46%] flex-col justify-between border-r border-rule bg-surface p-10 lg:flex">
        <div class="flex items-center gap-2.5">
          <div class="flex h-7 w-7 items-center justify-center rounded-[3px] bg-primary text-white">
            <erp-icon name="layers" [size]="15" />
          </div>
          <span class="text-[13px] font-semibold text-ink">Elyon Trading</span>
        </div>

        <div class="max-w-md">
          <h2 class="text-[26px] font-semibold leading-[1.25] tracking-[-0.02em] text-ink">
            Distribution pétrolière —<br />de l’affaire à la facture.
          </h2>
          <p class="mt-4 text-[14px] leading-relaxed text-ink-soft">
            Trois verrous encadrent l’exécution : aucune opération sur une affaire non
            approuvée, aucun chargement sans contrôles HSE validés, aucun moyen non
            conforme affecté sans l’accord du DG.
          </p>
          <dl class="mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-[3px] border border-rule bg-rule">
            <div class="bg-surface px-3 py-3">
              <dt class="text-[11px] uppercase tracking-[0.06em] text-ink-muted">Verrous</dt>
              <dd class="tabular mt-1 text-[20px] font-semibold text-ink">3</dd>
            </div>
            <div class="bg-surface px-3 py-3">
              <dt class="text-[11px] uppercase tracking-[0.06em] text-ink-muted">Périmètres</dt>
              <dd class="tabular mt-1 text-[20px] font-semibold text-ink">3</dd>
            </div>
            <div class="bg-surface px-3 py-3">
              <dt class="text-[11px] uppercase tracking-[0.06em] text-ink-muted">Devise pivot</dt>
              <dd class="mt-1 font-mono text-[20px] font-semibold text-ink">USD</dd>
            </div>
          </dl>
        </div>

        <p class="text-[11px] text-ink-faint">Côte d’Ivoire · XOF local, USD pivot</p>
      </div>

      <!-- Panneau de saisie -->
      <div class="flex flex-1 items-center justify-center px-6 py-12">
        <div class="w-full max-w-[340px]">
          <div class="mb-7 lg:hidden">
            <div class="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-[3px] bg-primary text-white">
              <erp-icon name="layers" [size]="18" />
            </div>
            <h1 class="text-[17px] font-semibold text-ink">Elyon Trading</h1>
          </div>

          <h1 class="page-title">Connexion</h1>
          <p class="page-sub mb-6">Console interne — accès réservé au personnel Elyon.</p>

          <form (ngSubmit)="submit()" novalidate>
            <div class="mb-3.5">
              <label class="label" for="email">Adresse électronique</label>
              <input id="email" name="email" type="email" class="field" autocomplete="username"
                     [(ngModel)]="email" required />
            </div>

            <div class="mb-3.5">
              <label class="label" for="password">Mot de passe</label>
              <input id="password" name="password" type="password" class="field"
                     autocomplete="current-password" [(ngModel)]="password" required />
            </div>

            <!-- Le champ n'apparaît qu'après un refus explicite pour code manquant :
                 l'afficher d'emblée déroute les comptes sans second facteur. -->
            @if (totpRequired()) {
              <div class="mb-3.5">
                <label class="label" for="totp">Code de vérification</label>
                <input id="totp" name="totp" inputmode="numeric" maxlength="6"
                       class="field font-mono tracking-[0.35em]" placeholder="000000"
                       autocomplete="one-time-code" [(ngModel)]="totpCode" />
              </div>
            }

            @if (error()) {
              <div class="mb-3.5 flex items-start gap-2 rounded-[3px] border border-crit/25
                          bg-crit-wash px-3 py-2 text-[13px] text-crit" role="alert">
                <erp-icon name="alert-triangle" [size]="14" class="mt-0.5" />
                <span>{{ error() }}</span>
              </div>
            }

            <button type="submit" class="btn-primary mt-1 w-full" [disabled]="busy()">
              {{ busy() ? 'Connexion…' : 'Se connecter' }}
            </button>
          </form>

          <p class="mt-6 border-t border-rule pt-4 text-[11px] leading-relaxed text-ink-faint">
            Toute connexion est journalisée — auteur, horodatage et adresse. Le journal
            d’audit est inscrit en base et ne peut être réécrit.
          </p>
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
