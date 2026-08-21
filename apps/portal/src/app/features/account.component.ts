import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { IconComponent } from '../shared/icon.component';

const MIN_LENGTH = 12;

function firstMessage(e: { error?: { message?: string | string[] } }): string | null {
  const m = e.error?.message;
  if (Array.isArray(m)) return m[0] ?? null;
  return m ?? null;
}

/** Changement de mot de passe — même règle que la console interne (12
 *  caractères minimum, différent de l'actuel). Chaque compte portail naît
 *  avec un mot de passe provisoire et `mustChangePassword` (§ 1.4). */
@Component({
  selector: 'erp-portal-account',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Mon compte</h1>
      <p class="page-sub">{{ profile()?.fullName }} · {{ profile()?.email }}</p>
    </header>

    <section class="card max-w-md overflow-hidden">
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
  `,
})
export class AccountComponent {
  private readonly auth = inject(AuthService);
  protected readonly profile = this.auth.profile;
  protected readonly MIN_LENGTH = MIN_LENGTH;

  protected currentPassword = '';
  protected newPassword = '';

  protected readonly busy = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly passwordDone = signal<string | null>(null);
  protected readonly typed = signal('');

  protected readonly hasLength = computed(() => this.typed().length >= MIN_LENGTH);
  protected readonly isDifferent = computed(
    () => this.typed().length > 0 && this.typed() !== this.currentPassword,
  );
  protected readonly canSubmit = computed(
    () => this.currentPassword.length > 0 && this.hasLength() && this.isDifferent(),
  );

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
}
