import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { IconComponent, IconName } from '../shared/icon.component';

interface NavItem {
  label: string;
  path: string;
  icon: IconName;
}

/** Cinq entrées, jamais groupées : le portail n'a qu'un seul tiers à servir,
 *  pas de rôle à filtrer — un regroupement par intention n'a rien à trier. */
const NAV: NavItem[] = [
  { label: 'Tableau de bord', path: '/tableau-de-bord', icon: 'gauge' },
  { label: 'Demandes de cotation', path: '/devis', icon: 'clipboard-check' },
  { label: 'Affaires', path: '/affaires', icon: 'briefcase' },
  { label: 'Livraisons', path: '/livraisons', icon: 'truck' },
  { label: 'Factures', path: '/factures', icon: 'receipt' },
];

/**
 * Coquille du portail client — même structure Azia que la console interne
 * (bandeau 64 px, barre latérale 240 px), mais SANS filtrage par rôle : un
 * jeton portail correspond à un seul tiers, jamais à un rôle interne.
 */
@Component({
  selector: 'erp-portal-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  template: `
    <div class="flex min-h-screen flex-col">
      <header
        class="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4
               border-b border-gray-900/[0.12] bg-surface px-6 shadow-soft"
      >
        <div class="flex items-center gap-2.5">
          <div class="flex h-8 w-8 items-center justify-center rounded-[3px] bg-primary text-white">
            <erp-icon name="layers" [size]="17" />
          </div>
          <span class="font-display text-[16px] font-bold tracking-[-0.01em] text-headline">
            Elyon Trading · Portail client
          </span>
        </div>

        <div class="flex items-center gap-4">
          <span class="hidden text-right leading-tight sm:block">
            <p class="text-[13px] font-medium text-gray-900">{{ profile()?.fullName }}</p>
            <p class="text-[11px] text-ink-muted">{{ profile()?.email }}</p>
          </span>
          <button class="btn-ghost" (click)="logout()">
            <erp-icon name="log-out" [size]="14" />
            <span class="hidden sm:inline">Déconnexion</span>
          </button>
        </div>
      </header>

      <div class="flex min-h-0 flex-1">
        <aside class="hidden w-[240px] shrink-0 border-r border-rule bg-surface px-5 pb-5 lg:block">
          <nav>
            <p class="nav-label">Mon activité</p>
            @for (item of NAV; track item.path) {
              <a [routerLink]="item.path" routerLinkActive="nav-active" class="nav-item">
                <erp-icon [name]="item.icon" [size]="18" class="w-6" />
                {{ item.label }}
              </a>
            }
          </nav>
        </aside>

        <main class="min-w-0 flex-1">
          @if (auth.passwordChangePending()) {
            <div
              class="flex items-center gap-2 border-b border-rule bg-info-wash px-5 py-2.5 text-[13px] text-info"
            >
              <erp-icon name="lock" [size]="14" />
              Mot de passe provisoire, un changement est requis.
              <a routerLink="/mon-compte" class="ml-1 font-medium underline underline-offset-2">
                Le changer
              </a>
            </div>
          }

          <div class="p-5">
            <router-outlet />
          </div>
        </main>
      </div>
    </div>
  `,
})
export class ShellComponent {
  protected readonly auth = inject(AuthService);
  protected readonly profile = this.auth.profile;
  protected readonly NAV = NAV;

  protected logout(): void {
    this.auth.logout();
  }
}
