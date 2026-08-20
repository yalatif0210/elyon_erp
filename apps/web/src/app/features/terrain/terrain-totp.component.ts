import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { toDataURL } from 'qrcode';
import { FieldSessionService } from '../../core/field-session.service';
import { IconComponent } from '../../shared/icon.component';
import { messageServeur } from './terrain-depot';

/**
 * SECOND FACTEUR — enrôlement TERRAIN (§ 1.4, § 10.5).
 *
 * ⚠️ CETTE PIÈCE MANQUAIT — LES ROUTES SERVEUR EXISTAIENT, PAS L'ÉCRAN.
 *
 *    `POST /api/field/auth/totp/enroll` et `/confirm` existent depuis
 *    toujours, symétriques de leur équivalent bureautique. Mais
 *    `totpEnrollmentRequired`, reçu à la connexion, était jeté sans jamais
 *    être lu côté terrain (§ correctif `field-session.service.ts`) : un agent
 *    signalé pour un second facteur obligatoire n'avait aucun bouton pour
 *    l'activer, sur aucun écran.
 */
@Component({
  selector: 'terrain-totp',
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

      <h1 class="t-title mt-2">Second facteur</h1>
      <p class="t-sub">
        Un code à six chiffres, renouvelé toutes les trente secondes, sera demandé en plus du mot
        de passe. Il est produit par une application d’authentification installée sur votre
        téléphone : Google Authenticator, Microsoft Authenticator ou équivalent.
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

      @if (!secret() && !fait()) {
        <div class="t-actionbar">
          <button class="t-btn-primary" [disabled]="occupe()" (click)="ouvrir()">
            {{ occupe() ? 'Envoi…' : 'Configurer le second facteur' }}
          </button>
        </div>
      }

      @if (secret(); as s) {
        <div class="mt-5 space-y-4">
          <div>
            <p class="text-[15px] font-semibold text-ink">1. Ouvrez votre application d’authentification</p>
            <p class="mt-0.5 text-[14px] text-ink-muted">Choisissez « ajouter un compte », puis « saisir une clé ».</p>
          </div>
          <div>
            <p class="text-[15px] font-semibold text-ink">2. Scannez ce code</p>
            @if (qrCode(); as qr) {
              <img
                [src]="qr"
                width="180"
                height="180"
                alt="Code QR d’enrôlement du second facteur"
                class="mt-1.5 rounded-[3px] border border-rule"
              />
            }
            <p class="mt-1.5 text-[14px] text-ink-muted">
              Ou choisissez « saisir une clé » et recopiez celle-ci :
            </p>
            <code
              class="mt-1.5 block break-all rounded-[3px] bg-gray-100 px-3 py-2.5 font-mono
                     text-[14px] tracking-wider text-ink"
              >{{ s }}</code
            >
            <p class="mt-1 text-[13px] text-ink-faint">
              Ni le code ni la clé ne seront réaffichés ensuite. Le secret n’est jamais envoyé
              ailleurs qu’à votre application d’authentification.
            </p>
          </div>
          <div>
            <p class="text-[15px] font-semibold text-ink">3. Confirmez avec le code affiché</p>
            <input
              id="code-totp"
              class="t-field mt-1.5 max-w-[220px] font-mono tracking-[0.35em]"
              inputmode="numeric"
              maxlength="6"
              placeholder="000000"
              autocomplete="one-time-code"
              aria-label="Code de vérification"
              [(ngModel)]="code"
            />
          </div>
        </div>

        <div class="t-actionbar">
          <button class="t-btn-primary" [disabled]="occupe() || code.length !== 6" (click)="confirmer()">
            {{ occupe() ? 'Envoi…' : 'Activer' }}
          </button>
        </div>
      }

      @if (fait()) {
        <p
          class="mt-5 flex items-start gap-2 rounded-[3px] border border-ok/30 bg-ok-wash px-3.5
                 py-3 text-[15px] leading-relaxed text-ok"
          role="status"
        >
          <erp-icon name="check-circle" [size]="18" class="mt-0.5" />
          <span>Second facteur actif. Il vous sera demandé à chaque connexion, en plus du mot de passe.</span>
        </p>
      }
    </div>
  `,
})
export class TerrainTotpComponent {
  private readonly session = inject(FieldSessionService);
  private readonly router = inject(Router);

  protected readonly secret = signal<string | null>(null);
  protected readonly qrCode = signal<string | null>(null);
  protected readonly occupe = signal(false);
  protected readonly erreur = signal<string | null>(null);
  protected readonly fait = signal(false);
  protected code = '';

  protected ouvrir(): void {
    this.occupe.set(true);
    this.erreur.set(null);
    this.session.ouvrirEnrolementTotp().subscribe({
      next: (res) => {
        this.occupe.set(false);
        this.secret.set(res.secret);
        toDataURL(res.otpauthUrl, { width: 180, margin: 1 })
          .then((dataUrl) => this.qrCode.set(dataUrl))
          .catch(() => this.qrCode.set(null));
      },
      error: (e: unknown) => {
        this.occupe.set(false);
        this.erreur.set(messageServeur(e, 'Configuration impossible.'));
      },
    });
  }

  protected confirmer(): void {
    this.occupe.set(true);
    this.erreur.set(null);
    this.session.confirmerEnrolementTotp(this.code).subscribe({
      next: () => {
        this.occupe.set(false);
        this.secret.set(null);
        this.qrCode.set(null);
        this.fait.set(true);
        this.code = '';
        setTimeout(() => void this.router.navigate(['/terrain']), 2500);
      },
      error: (e: unknown) => {
        this.occupe.set(false);
        this.erreur.set(messageServeur(e, 'Code refusé.'));
      },
    });
  }
}
