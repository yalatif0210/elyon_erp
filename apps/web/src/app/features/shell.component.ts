import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService, ROLE_LABELS, UserRole } from '../core/auth.service';
import { IconComponent, IconName } from '../shared/icon.component';

interface NavItem {
  label: string;
  path: string;
  icon: IconName;
  /** Rôles pour lesquels l'entrée est proposée. Vide = tous. */
  roles?: UserRole[];
}

const NAV: NavItem[] = [
  { label: 'Tableau de bord', path: '/tableau-de-bord', icon: 'gauge' },
  { label: 'Conformité', path: '/conformite', icon: 'shield' },
  { label: 'Échéancier', path: '/echeancier', icon: 'clock' },
  { label: 'Tiers', path: '/tiers', icon: 'users' },
  {
    label: 'Dérogations',
    path: '/derogations',
    icon: 'lock',
    roles: ['DG', 'FINANCE_CFO', 'CCOO', 'ACCOUNTANT', 'ASSISTANT_DG'],
  },
  { label: 'Référentiels', path: '/referentiels', icon: 'layers' },
];

@Component({
  selector: 'erp-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  template: `
    <div class="flex min-h-screen">
      <!-- Barre latérale -->
      <aside class="flex w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
        <div class="flex items-center gap-2.5 border-b border-slate-800 px-4 py-4">
          <div class="flex h-8 w-8 items-center justify-center rounded-md bg-sky-500 text-slate-950">
            <erp-icon name="layers" [size]="17" />
          </div>
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-slate-100">Elyon Trading</p>
            <p class="text-[11px] text-slate-500">ERP · Lot 1</p>
          </div>
        </div>

        <nav class="flex-1 space-y-0.5 p-2">
          @for (item of visibleNav(); track item.path) {
            <a
              [routerLink]="item.path"
              routerLinkActive="bg-slate-800 text-slate-100"
              class="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-slate-400
                     transition-all hover:bg-slate-800/60 hover:text-slate-200"
            >
              <erp-icon [name]="item.icon" [size]="16" />
              {{ item.label }}
            </a>
          }
        </nav>

        <div class="border-t border-slate-800 p-3">
          <p class="truncate text-sm text-slate-200">{{ profile()?.fullName }}</p>
          <p class="mt-0.5 truncate text-[11px] text-slate-500">{{ roleLabel() }}</p>
          <button class="btn-ghost mt-2.5 w-full text-xs" (click)="logout()">
            <erp-icon name="log-out" [size]="14" />
            Déconnexion
          </button>
        </div>
      </aside>

      <main class="min-w-0 flex-1 overflow-x-auto">
        <!-- Bandeaux d'action obligatoire : ils ne se ferment pas tant que
             l'action n'est pas faite. -->
        @if (auth.totpPending()) {
          <div class="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2.5 text-sm text-amber-300">
            <erp-icon name="alert-triangle" [size]="15" />
            Second facteur obligatoire pour votre rôle et non encore configuré.
          </div>
        }
        @if (auth.passwordChangePending()) {
          <div class="flex items-center gap-2 border-b border-sky-500/30 bg-sky-500/10 px-6 py-2.5 text-sm text-sky-300">
            <erp-icon name="lock" [size]="15" />
            Mot de passe provisoire — un changement est requis.
          </div>
        }

        <div class="p-6">
          <router-outlet />
        </div>
      </main>
    </div>
  `,
})
export class ShellComponent {
  protected readonly auth = inject(AuthService);
  protected readonly profile = this.auth.profile;

  protected readonly visibleNav = computed(() => {
    const role = this.auth.role();
    return NAV.filter((item) => !item.roles || (role !== null && item.roles.includes(role)));
  });

  protected readonly roleLabel = computed(() => {
    const role = this.auth.role();
    return role ? ROLE_LABELS[role] : '';
  });

  protected logout(): void {
    this.auth.logout();
  }
}
