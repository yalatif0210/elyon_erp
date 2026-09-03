import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { IconComponent } from '../shared/icon.component';

const MIN_LENGTH = 12;

function firstMessage(e: { error?: { message?: string | string[] } }): string | null {
  const m = e.error?.message;
  if (Array.isArray(m)) return m[0] ?? null;
  return m ?? null;
}

/**
 * Changement de mot de passe — même règle que la console interne (12
 * caractères minimum, différent de l'actuel). Chaque compte portail naît
 * avec un mot de passe provisoire et `mustChangePassword` (§ 1.4).
 *
 * Second facteur (ticket #8) — STRICTEMENT VOLONTAIRE dans ce Royaume : à la
 * différence de la console interne, aucun profil de compte portail ne
 * l'exige jamais. Le service est le même (`AuthService` côté API), déjà
 * partagé avec l'Interne et le Terrain ; seul l'écran manquait ici.
 */
@Component({
  selector: 'erp-portal-account',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Mon compte</h1>
      <p class="page-sub">{{ profile()?.fullName }} · {{ profile()?.email }}</p>
    </header>

    <div class="grid max-w-md gap-5">
      <section class="card overflow-hidden">
        <div class="card-header">
          <h2 class="card-title">Mot de passe</h2>
        </div>
        <div class="card-body">
          <form (ngSubmit)="submit()" novalidate>
            <div class="mb-3.5">
              <label class="label" for="current">Mot de passe actuel</label>
              <input
                id="current"
                type="password"
                class="field"
                autocomplete="current-password"
                [(ngModel)]="currentPassword"
                name="current"
                required
              />
            </div>
            <div class="mb-2">
              <label class="label" for="new">Nouveau mot de passe</label>
              <input
                id="new"
                type="password"
                class="field"
                autocomplete="new-password"
                [(ngModel)]="newPassword"
                name="new"
                (ngModelChange)="onType()"
                required
              />
            </div>
            <ul class="mb-3.5 space-y-0.5 text-[12px]">
              <li [class]="ruleClass(hasLength())">{{ hasLength() ? '✓' : '·' }} Au moins {{ MIN_LENGTH }} caractères</li>
              <li [class]="ruleClass(isDifferent())">{{ isDifferent() ? '✓' : '·' }} Différent de l'actuel</li>
            </ul>

            @if (passwordError()) {
              <div
                class="mb-3.5 flex items-start gap-2 rounded-[3px] border border-crit/25 bg-crit-wash px-3 py-2 text-[13px] text-crit"
                role="alert"
              >
                <erp-icon name="alert-triangle" [size]="14" class="mt-0.5" />
                <span>{{ passwordError() }}</span>
              </div>
            }
            @if (passwordDone()) {
              <p class="mb-3.5 flex items-center gap-2 rounded-[3px] bg-ok-wash px-3 py-2 text-[13px] text-ok" role="status">
                <erp-icon name="check-circle" [size]="14" />
                {{ passwordDone() }}
              </p>
            }

            <button type="submit" class="btn-primary" [disabled]="!canSubmit() || busy()">
              {{ busy() ? 'Changement…' : 'Changer le mot de passe' }}
            </button>
          </form>
        </div>
      </section>

      <!-- ============ Second facteur (ticket #8) ============ -->
      <section class="card overflow-hidden">
        <div class="card-header">
          <h2 class="card-title">Second facteur</h2>
        </div>
        <div class="card-body">
          @if (totpDone()) {
            <div class="flex items-start gap-2 rounded-[3px] bg-ok-wash px-3 py-2 text-[13px] text-ok">
              <erp-icon name="check-circle" [size]="14" class="mt-0.5" />
              <span>Second facteur activé. Il vous sera demandé à chaque connexion.</span>
            </div>
          } @else if (totpEnabled() === null) {
            <p class="text-[13px] text-ink-faint">Chargement…</p>
          } @else if (totpEnabled()) {
            <p class="mb-3.5 text-[13px] leading-relaxed text-ink-soft">
              Actif sur votre compte : un code à six chiffres, en plus du mot de passe, vous est
              demandé à chaque connexion.
            </p>

            @if (!showDisable()) {
              <button class="btn-ghost" (click)="showDisable.set(true)">Désactiver</button>
            } @else {
              <div class="mb-3">
                <label class="label" for="code-off">Code actuel</label>
                <input
                  id="code-off"
                  class="field max-w-[140px] font-mono tracking-[0.35em]"
                  inputmode="numeric"
                  maxlength="6"
                  placeholder="000000"
                  autocomplete="one-time-code"
                  [(ngModel)]="disableCode"
                />
              </div>
              @if (totpError()) {
                <div
                  class="mb-3.5 flex items-start gap-2 rounded-[3px] bg-crit-wash px-3 py-2 text-[13px] text-crit"
                  role="alert"
                >
                  <erp-icon name="alert-triangle" [size]="14" class="mt-0.5" />
                  <span>{{ totpError() }}</span>
                </div>
              }
              <div class="flex gap-2.5">
                <button class="btn-primary" (click)="confirmDisable()" [disabled]="busy()">
                  Confirmer la désactivation
                </button>
                <button class="btn-ghost" (click)="cancelDisable()">Annuler</button>
              </div>
            }
          } @else if (secret()) {
            <ol class="space-y-4 text-[13px]">
              <li>
                <p class="font-medium text-ink">1. Ouvrez votre application d'authentification</p>
                <p class="mt-0.5 text-ink-muted">Google Authenticator, Microsoft Authenticator ou équivalent.</p>
              </li>
              <li>
                <p class="font-medium text-ink">2. Saisissez cette clé</p>
                <code
                  class="mt-1.5 block break-all rounded-[3px] bg-gray-100 px-3 py-2 font-mono
                         text-[13px] tracking-wider text-ink"
                  >{{ secret() }}</code
                >
                <p class="mt-1 text-[11px] text-ink-faint">
                  Recopiez-la telle quelle - « saisir une clé manuelle » dans l'application. Elle
                  ne sera plus jamais réaffichée ensuite.
                </p>
              </li>
              <li>
                <p class="font-medium text-ink">3. Confirmez avec le code affiché</p>
                <input
                  class="field mt-1.5 max-w-[140px] font-mono tracking-[0.35em]"
                  inputmode="numeric"
                  maxlength="6"
                  placeholder="000000"
                  autocomplete="one-time-code"
                  aria-label="Code de vérification"
                  [(ngModel)]="totpCode"
                />
              </li>
            </ol>

            @if (totpError()) {
              <div
                class="mt-3.5 flex items-start gap-2 rounded-[3px] bg-crit-wash px-3 py-2
                       text-[13px] text-crit"
                role="alert"
              >
                <erp-icon name="alert-triangle" [size]="14" class="mt-0.5" />
                <span>{{ totpError() }}</span>
              </div>
            }

            <button class="btn-primary mt-4" (click)="confirmEnrollment()" [disabled]="busy()">
              Activer
            </button>
          } @else {
            <p class="mb-4 text-[13px] leading-relaxed text-ink-soft">
              Facultatif. Un code à six chiffres, renouvelé toutes les trente secondes, viendra
              s'ajouter à votre mot de passe. Il est produit par une application
              d'authentification installée sur votre téléphone.
            </p>
            <button class="btn-primary" (click)="beginEnrollment()" [disabled]="busy()">
              Activer le second facteur
            </button>
          }
        </div>
      </section>
    </div>
  `,
})
export class AccountComponent implements OnInit {
  private readonly auth = inject(AuthService);
  protected readonly profile = this.auth.profile;
  protected readonly MIN_LENGTH = MIN_LENGTH;

  protected currentPassword = '';
  protected newPassword = '';
  protected totpCode = '';
  protected disableCode = '';

  protected readonly busy = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly passwordDone = signal<string | null>(null);
  protected readonly typed = signal('');

  protected readonly totpEnabled = signal<boolean | null>(null);
  protected readonly secret = signal<string | null>(null);
  protected readonly totpError = signal<string | null>(null);
  protected readonly totpDone = signal(false);
  protected readonly showDisable = signal(false);

  protected readonly hasLength = computed(() => this.typed().length >= MIN_LENGTH);
  protected readonly isDifferent = computed(
    () => this.typed().length > 0 && this.typed() !== this.currentPassword,
  );
  protected readonly canSubmit = computed(
    () => this.currentPassword.length > 0 && this.hasLength() && this.isDifferent(),
  );

  ngOnInit(): void {
    this.auth.me().subscribe((m) => this.totpEnabled.set(m.totpEnabled));
  }

  protected onType(): void {
    this.typed.set(this.newPassword);
    this.passwordError.set(null);
  }

  protected ruleClass(ok: boolean): string {
    return ok ? 'text-ok' : 'text-ink-faint';
  }

  protected submit(): void {
    if (!this.canSubmit() || this.busy()) return;
    this.busy.set(true);
    this.passwordError.set(null);
    this.passwordDone.set(null);

    // .trim() : un mot de passe copié-collé embarque souvent un espace ou un
    // saut de ligne invisible en fin de chaîne — voir login.component.ts.
    this.auth.changePassword(this.currentPassword.trim(), this.newPassword.trim()).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.currentPassword = '';
        this.newPassword = '';
        this.typed.set('');
        this.passwordDone.set(
          r.revokedSessions > 0
            ? `Mot de passe changé. ${r.revokedSessions} autre(s) session(s) fermée(s).`
            : 'Mot de passe changé.',
        );
      },
      error: (e: { error?: { message?: string | string[] } }) => {
        this.busy.set(false);
        this.passwordError.set(firstMessage(e) ?? 'Changement impossible');
      },
    });
  }

  protected beginEnrollment(): void {
    this.busy.set(true);
    this.totpError.set(null);
    this.auth.beginTotpEnrollment().subscribe({
      next: (r) => {
        this.busy.set(false);
        this.secret.set(r.secret);
      },
      error: (e: { error?: { message?: string | string[] } }) => {
        this.busy.set(false);
        this.totpError.set(firstMessage(e) ?? 'Configuration impossible');
      },
    });
  }

  protected confirmEnrollment(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.totpError.set(null);
    this.auth.confirmTotpEnrollment(this.totpCode).subscribe({
      next: () => {
        this.busy.set(false);
        this.secret.set(null);
        this.totpCode = '';
        this.totpDone.set(true);
        this.totpEnabled.set(true);
      },
      error: (e: { error?: { message?: string | string[] } }) => {
        this.busy.set(false);
        this.totpError.set(firstMessage(e) ?? 'Code refusé');
      },
    });
  }

  protected cancelDisable(): void {
    this.showDisable.set(false);
    this.disableCode = '';
    this.totpError.set(null);
  }

  protected confirmDisable(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.totpError.set(null);
    this.auth.disableTotp(this.disableCode).subscribe({
      next: () => {
        this.busy.set(false);
        this.disableCode = '';
        this.showDisable.set(false);
        this.totpDone.set(false);
        this.totpEnabled.set(false);
      },
      error: (e: { error?: { message?: string | string[] } }) => {
        this.busy.set(false);
        this.totpError.set(firstMessage(e) ?? 'Code refusé');
      },
    });
  }
}
