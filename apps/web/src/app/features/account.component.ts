import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toDataURL } from 'qrcode';
import { AuthService, ROLE_LABELS } from '../core/auth.service';
import { IconComponent } from '../shared/icon.component';

/**
 * Longueur minimale, alignée sur la politique du serveur (`ChangePasswordDto`).
 *
 * Aucune règle de composition n'est imposée, et c'est délibéré : les
 * exigences de familles de caractères produisent des variantes prévisibles du
 * même mot — « Elyon2026! », puis « Elyon2027! ». La longueur résiste mieux.
 * Les recommandations actuelles du NIST vont dans ce sens.
 */
const MIN_LENGTH = 12;

/**
 * Compte de l'utilisateur — mot de passe et second facteur.
 *
 * Cet écran comble une contradiction : tous les comptes naissent avec un mot
 * de passe provisoire, un bandeau exigeait de le changer, et aucun moyen de le
 * faire n'existait. On demandait une action impossible.
 */
@Component({
  selector: 'erp-account',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <header class="mb-5">
      <h1 class="page-title">Mon compte</h1>
      <p class="page-sub">{{ profile()?.fullName }} · {{ roleLabel() }}</p>
    </header>

    <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <!-- ============ Mot de passe ============ -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">Mot de passe</h2>
          @if (auth.passwordChangePending()) {
            <span class="badge-wait">
              <erp-icon name="alert-triangle" [size]="11" />
              Provisoire
            </span>
          }
        </div>
        <div class="card-body">
          @if (auth.passwordChangePending()) {
            <p class="mb-4 rounded-[3px] bg-warn-wash px-3 py-2 text-[13px] text-warn-ink">
              Votre mot de passe a été attribué à la création du compte. Tant qu’il n’est pas
              changé, il est connu de la personne qui vous l’a communiqué.
            </p>
          }

          <form (ngSubmit)="submitPassword()" novalidate>
            <div class="mb-3.5">
              <label class="label" for="current">Mot de passe actuel</label>
              <input
                id="current"
                name="current"
                type="password"
                class="field"
                autocomplete="current-password"
                [ngModel]="currentPassword()"
                (ngModelChange)="currentPassword.set($event)"
              />
              <p class="mt-1 text-[11px] text-ink-faint">
                Redemandé même si vous êtes connecté : un poste laissé ouvert ne doit pas
                suffire à s’approprier votre compte.
              </p>
            </div>

            <div class="mb-3.5">
              <label class="label" for="next">Nouveau mot de passe</label>
              <input
                id="next"
                name="next"
                type="password"
                class="field"
                autocomplete="new-password"
                [ngModel]="newPassword()"
                (ngModelChange)="onType($event)"
              />
            </div>

            <!-- Exigences énoncées et vérifiées à la saisie : découvrir une
                 règle par un refus est la pire façon de l'apprendre. Elles
                 reprennent EXACTEMENT celles du serveur — un écran plus
                 sévère que le serveur fait refuser des mots de passe valides. -->
            <ul class="mb-4 space-y-1">
              <li class="flex items-center gap-2 text-[12px]" [class]="ruleClass(hasLength())">
                <erp-icon [name]="hasLength() ? 'check-circle' : 'ban'" [size]="12" />
                12 caractères au minimum
                <span class="text-ink-faint">({{ newPassword().length }})</span>
              </li>
              <li class="flex items-center gap-2 text-[12px]" [class]="ruleClass(isDifferent())">
                <erp-icon [name]="isDifferent() ? 'check-circle' : 'ban'" [size]="12" />
                Différent du mot de passe actuel
              </li>
            </ul>

            <p class="mb-4 text-[11px] leading-relaxed text-ink-faint">
              Aucune combinaison de majuscules, chiffres ou symboles n’est imposée. Une phrase
              dont vous vous souvenez, quatre mots sans rapport entre eux, protège mieux
              qu’un mot court compliqué, et ne finit pas sur un papier collé sous le clavier.
            </p>

            @if (passwordError()) {
              <div
                class="mb-3.5 flex items-start gap-2 rounded-[3px] bg-crit-wash px-3 py-2
                       text-[13px] text-crit"
                role="alert"
              >
                <erp-icon name="alert-triangle" [size]="14" class="mt-0.5" />
                <span>{{ passwordError() }}</span>
              </div>
            }
            @if (passwordDone()) {
              <div
                class="mb-3.5 flex items-start gap-2 rounded-[3px] bg-ok-wash px-3 py-2
                       text-[13px] text-ok"
                role="status"
              >
                <erp-icon name="check-circle" [size]="14" class="mt-0.5" />
                <span>{{ passwordDone() }}</span>
              </div>
            }

            <button type="submit" class="btn-primary" [disabled]="!canSubmit() || busy()">
              {{ busy() ? 'Enregistrement…' : 'Changer le mot de passe' }}
            </button>
          </form>

          <p class="mt-4 border-t border-rule pt-3 text-[11px] leading-relaxed text-ink-faint">
            Toutes vos autres sessions seront fermées. Votre poste actuel reste connecté.
            Sans cela, un jeton déjà dérobé continuerait de fonctionner malgré le changement.
          </p>
        </div>
      </section>

      <!-- ============ Second facteur ============ -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">Second facteur</h2>
          @if (auth.totpPending()) {
            <span class="badge-blocked">
              <erp-icon name="lock" [size]="11" />
              Obligatoire, non configuré
            </span>
          }
        </div>
        <div class="card-body">
          @if (!secret() && !totpDone()) {
            <p class="mb-4 text-[13px] leading-relaxed text-ink-soft">
              Un code à six chiffres, renouvelé toutes les trente secondes, sera demandé en
              plus du mot de passe. Il est produit par une application d’authentification
              installée sur votre téléphone, Google Authenticator, Microsoft Authenticator
              ou équivalent.
            </p>
            @if (auth.totpPending()) {
              <p class="mb-4 rounded-[3px] bg-crit-wash px-3 py-2 text-[13px] text-crit">
                Votre rôle donne accès aux marges, aux approbations et aux règlements. Le
                second facteur est exigé pour ces fonctions.
              </p>
            }
            <button class="btn-primary" (click)="beginEnrollment()" [disabled]="busy()">
              Configurer le second facteur
            </button>
          }

          @if (secret(); as s) {
            <ol class="space-y-4 text-[13px]">
              <li>
                <p class="font-medium text-ink">1. Ouvrez votre application d’authentification</p>
                <p class="mt-0.5 text-ink-muted">Google Authenticator, Microsoft Authenticator ou équivalent.</p>
              </li>
              <li>
                <p class="font-medium text-ink">2. Scannez ce code</p>
                @if (qrCode(); as qr) {
                  <img
                    [src]="qr"
                    width="180"
                    height="180"
                    alt="Code QR d’enrôlement du second facteur"
                    class="mt-1.5 rounded-[3px] border border-rule"
                  />
                }
                <p class="mt-1.5 text-ink-muted">
                  Ou choisissez « saisir une clé » et recopiez celle-ci :
                </p>
                <code
                  class="mt-1.5 block break-all rounded-[3px] bg-gray-100 px-3 py-2 font-mono
                         text-[13px] tracking-wider text-ink"
                  >{{ s }}</code
                >
                <p class="mt-1 text-[11px] text-ink-faint">
                  Ni le code ni la clé ne seront réaffichés ensuite. Le secret n'est jamais envoyé
                  ailleurs qu'à votre application d'authentification — le code QR est produit
                  entièrement dans ce navigateur.
                </p>
              </li>
              <li>
                <p class="font-medium text-ink">3. Confirmez avec le code affiché</p>
                <input
                  class="field mt-1.5 max-w-[180px] font-mono tracking-[0.35em]"
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
          }

          @if (totpDone()) {
            <div class="flex items-start gap-2 rounded-[3px] bg-ok-wash px-3 py-2 text-[13px] text-ok">
              <erp-icon name="check-circle" [size]="14" class="mt-0.5" />
              <span>
                Second facteur actif. Il vous sera demandé à chaque connexion, en plus du mot
                de passe.
              </span>
            </div>
          }
        </div>
      </section>
    </div>
  `,
})
export class AccountComponent {
  protected readonly auth = inject(AuthService);
  protected readonly profile = this.auth.profile;

  protected readonly currentPassword = signal('');
  protected readonly newPassword = signal('');
  protected totpCode = '';

  protected readonly busy = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly passwordDone = signal<string | null>(null);
  protected readonly secret = signal<string | null>(null);
  protected readonly qrCode = signal<string | null>(null);
  protected readonly totpError = signal<string | null>(null);
  protected readonly totpDone = signal(false);

  protected readonly roleLabel = computed(() => {
    const role = this.auth.role();
    return role ? ROLE_LABELS[role] : '';
  });

  protected readonly hasLength = computed(() => this.newPassword().length >= MIN_LENGTH);

  protected readonly isDifferent = computed(
    () => this.newPassword().length > 0 && this.newPassword() !== this.currentPassword(),
  );

  protected readonly canSubmit = computed(
    () => this.currentPassword().length > 0 && this.hasLength() && this.isDifferent(),
  );

  protected onType(value: string): void {
    this.newPassword.set(value);
    this.passwordError.set(null);
  }

  /** Vert quand la règle est satisfaite, gris tant qu'elle ne l'est pas. */
  protected ruleClass(ok: boolean): string {
    return ok ? 'text-ok' : 'text-ink-faint';
  }

  protected submitPassword(): void {
    if (!this.canSubmit() || this.busy()) return;
    this.busy.set(true);
    this.passwordError.set(null);
    this.passwordDone.set(null);

    this.auth.changePassword(this.currentPassword(), this.newPassword()).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.currentPassword.set('');
        this.newPassword.set('');
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
        // Généré dans le navigateur, jamais transmis : un service tiers de
        // rendu de QR code verrait passer le secret en clair dans son URL.
        toDataURL(r.otpauthUrl, { width: 180, margin: 1 })
          .then((dataUrl) => this.qrCode.set(dataUrl))
          .catch(() => this.qrCode.set(null));
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
        this.qrCode.set(null);
        this.totpCode = '';
        this.totpDone.set(true);
      },
      error: (e: { error?: { message?: string | string[] } }) => {
        this.busy.set(false);
        this.totpError.set(firstMessage(e) ?? 'Code refusé');
      },
    });
  }
}

/** La validation renvoie un tableau de messages ; on retient le premier. */
function firstMessage(e: { error?: { message?: string | string[] } }): string | null {
  const m = e.error?.message;
  if (Array.isArray(m)) return m[0] ?? null;
  return m ?? null;
}
