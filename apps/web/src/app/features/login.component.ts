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
        Le panneau de gauche n'est pas décoratif au hasard : la scène (quai,
        cuves, barge) situe le métier — négoce et logistique pétrolière —
        avant même que l'écran de saisie n'apparaisse.
      -->
      <div class="relative hidden w-[46%] flex-col justify-between overflow-hidden p-10 lg:flex">
        <svg
          class="absolute inset-0 h-full w-full"
          viewBox="0 0 800 1000"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="ciel" x1="0" y1="0" x2="0.4" y2="1">
              <stop offset="0%" stop-color="#1c273c" />
              <stop offset="55%" stop-color="#3d2f9e" />
              <stop offset="100%" stop-color="#3366ff" />
            </linearGradient>
            <linearGradient id="eau" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#161f33" />
              <stop offset="100%" stop-color="#0f1526" />
            </linearGradient>
          </defs>

          <rect width="800" height="1000" fill="url(#ciel)" />

          <!-- Jauge — la précision de la mesure, thème filé dans tout l'ERP -->
          <g stroke="#ffffff" stroke-opacity="0.08" fill="none">
            <circle cx="640" cy="230" r="150" />
            <circle cx="640" cy="230" r="110" />
            <circle cx="640" cy="230" r="70" />
          </g>

          <!-- Grille technique, très estompée -->
          <g stroke="#ffffff" stroke-opacity="0.04">
            <line x1="0" y1="120" x2="800" y2="120" />
            <line x1="0" y1="240" x2="800" y2="240" />
            <line x1="0" y1="360" x2="800" y2="360" />
            <line x1="160" y1="0" x2="160" y2="560" />
            <line x1="320" y1="0" x2="320" y2="560" />
            <line x1="480" y1="0" x2="480" y2="560" />
          </g>

          <!-- Terminal — silhouette de cuves de stockage -->
          <g fill="#0f1526" fill-opacity="0.55">
            <ellipse cx="130" cy="470" rx="42" ry="10" />
            <rect x="88" y="410" width="84" height="60" rx="4" />
            <ellipse cx="130" cy="410" rx="42" ry="10" />

            <ellipse cx="230" cy="480" rx="34" ry="8" />
            <rect x="196" y="430" width="68" height="50" rx="4" />
            <ellipse cx="230" cy="430" rx="34" ry="8" />
          </g>

          <!-- Ligne d'horizon -->
          <rect x="0" y="560" width="800" height="440" fill="url(#eau)" />
          <rect x="0" y="558" width="800" height="3" fill="#00cccc" fill-opacity="0.35" />

          <!-- Barge — coque simplifiée -->
          <g fill="#f4f5f8" fill-opacity="0.9">
            <path d="M120 640 L520 640 L494 690 L146 690 Z" />
            <rect x="190" y="600" width="70" height="42" rx="3" />
            <rect x="205" y="580" width="18" height="24" rx="2" />
          </g>
          <rect x="60" y="690" width="500" height="4" fill="#0f1526" fill-opacity="0.4" />

          <!-- Ondes -->
          <g stroke="#00cccc" stroke-opacity="0.18" fill="none" stroke-width="2">
            <path d="M0 760 Q 40 750 80 760 T 160 760 T 240 760 T 320 760 T 400 760 T 480 760 T 560 760 T 640 760 T 720 760 T 800 760" />
            <path d="M0 830 Q 50 818 100 830 T 200 830 T 300 830 T 400 830 T 500 830 T 600 830 T 700 830 T 800 830" />
            <path d="M0 900 Q 60 886 120 900 T 240 900 T 360 900 T 480 900 T 600 900 T 720 900 T 800 900" />
          </g>
        </svg>

        <!-- Voile de lisibilité, uniforme : la position exacte du bloc de
             texte dépend de la distribution flex, pas d'une zone fixe de la
             scène — un dégradé qui suppose « le texte est en haut et en bas »
             laisserait un creux de contraste juste sous le titre. -->
        <div class="absolute inset-0 bg-[#0f1526]/55"></div>

        <div class="relative flex items-center gap-2.5">
          <div class="flex h-7 w-7 items-center justify-center rounded-[3px] bg-white text-primary">
            <erp-icon name="layers" [size]="15" />
          </div>
          <span class="text-[13px] font-semibold text-white">Elyon Trading</span>
        </div>

        <div class="relative max-w-md">
          <h2 class="text-[26px] font-semibold leading-[1.25] tracking-[-0.02em] text-white">
            Distribution pétrolière :<br />de l’affaire à la facture.
          </h2>
          <p class="mt-4 text-[14px] leading-relaxed text-white/75">
            Gasoil et essence, du quai d’Abidjan jusqu’au dernier kilomètre.
          </p>
        </div>

        <p class="relative text-[11px] text-white/50">Côte d’Ivoire</p>
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
          <p class="page-sub mb-6">Application interne : accès réservé au personnel Elyon.</p>

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
            Toute connexion est journalisée : auteur, horodatage et adresse. Le journal
            d’audit est conservé et ne peut être réécrit.
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
