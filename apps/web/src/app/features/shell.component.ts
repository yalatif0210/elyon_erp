import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService, CompteurTaches } from '../core/api.service';
import { AuthService, ROLE_LABELS, UserRole } from '../core/auth.service';
import { IconComponent, IconName } from '../shared/icon.component';

interface NavItem {
  label: string;
  path: string;
  icon: IconName;
  /** Rôles pour lesquels l'entrée est proposée. Vide = tous. */
  roles?: UserRole[];
}

interface NavGroup {
  /** Ce que l'utilisateur vient faire, pas le nom du module. */
  title: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    title: 'Piloter',
    items: [
      { label: 'Tableau de bord', path: '/tableau-de-bord', icon: 'gauge' },
      // En tête, sous le tableau de bord : c'est le premier écran qu'on ouvre
      // le matin. Ce qui n'est pas dans le chemin quotidien n'est pas lu.
      { label: 'Ce que j’ai à traiter', path: '/mes-taches', icon: 'clipboard-check' },
      // Ce que les verrous NE PEUVENT PAS arrêter : le placement juste
      // au-dessus du seuil, l'écart entre marge promise et marge réalisée.
      // Sous « Piloter » et non sous « Administrer » : ce n'est pas un réglage,
      // c'est une lecture de l'entreprise.
      {
        label: 'Pilotage financier',
        path: '/pilotage',
        icon: 'gauge',
        roles: ['DG', 'FINANCE_CFO', 'CCOO', 'ACCOUNTANT', 'LOGISTICS_COORD'],
      },
      {
        label: 'Surveillance',
        path: '/supervision',
        icon: 'search',
        roles: ['DG', 'FINANCE_CFO', 'CCOO', 'ACCOUNTANT', 'IT_ADMIN'],
      },
    ],
  },
  {
    title: 'Vendre et livrer',
    items: [
      // Avant les affaires : le pipeline les PRÉCÈDE, une affaire naît d'une
      // opportunité gagnée. L'ordre de la navigation raconte le parcours.
      {
        label: 'Pipeline commercial',
        path: '/crm',
        icon: 'search',
        roles: ['DG', 'CCOO', 'SALES_REP', 'FINANCE_CFO', 'ASSISTANT_DG'],
      },
      { label: 'Affaires', path: '/affaires', icon: 'briefcase' },
      { label: 'Opérations', path: '/operations', icon: 'truck' },
      { label: 'Facturation', path: '/facturation', icon: 'receipt' },
      { label: 'Contrôles HSE', path: '/hse', icon: 'clipboard-check' },
      { label: 'Documents', path: '/documents', icon: 'file-text' },
      {
        label: 'Achats',
        path: '/achats',
        icon: 'briefcase',
        roles: ['DG', 'FINANCE_CFO', 'ACCOUNTANT', 'CCOO', 'LOGISTICS_COORD'],
      },
    ],
  },
  {
    title: 'Administrer',
    items: [
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
      { label: 'Paramétrage', path: '/parametrage', icon: 'clipboard-check' },
    ],
  },
];

/**
 * Coquille de l'application.
 *
 * La navigation est GROUPÉE PAR INTENTION — piloter, vendre et livrer,
 * administrer — et non par module technique. Une liste plate de dix entrées
 * oblige à relire les libellés à chaque fois ; trois groupes de trois ou
 * cinq se mémorisent en une semaine.
 */
@Component({
  selector: 'erp-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  template: `
    <!--
      Structure d'Azia : .az-header en bandeau blanc de 64 px sur toute la
      largeur, .az-sidebar de 240 px dessous, puis .az-content-header et
      .az-content-body qui portent chacun leur propre gouttière.
    -->
    <div class="flex min-h-screen flex-col">
      <header
        class="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4
               border-b border-gray-900/[0.12] bg-surface px-6 shadow-soft"
      >
        <div class="flex items-center gap-2.5">
          <div
            class="flex h-8 w-8 items-center justify-center rounded-[3px] bg-primary text-white"
          >
            <erp-icon name="layers" [size]="17" />
          </div>
          <span class="font-display text-[16px] font-bold tracking-[-0.01em] text-headline">
            Elyon Trading
          </span>
        </div>

        <div class="flex items-center gap-4">
          @if (compteur(); as c) {
            @if (c.bloquantes > 0) {
              <a
                routerLink="/mes-taches"
                class="mr-3 inline-flex items-center gap-1.5 rounded-[3px] border border-crit/40
                       bg-crit-wash px-2.5 py-1 text-[12px] font-semibold text-crit"
                [title]="c.bloquantes + ' tâche(s) bloquante(s) — quelqu’un est arrêté'"
              >
                <erp-icon name="lock" [size]="13" />
                {{ c.bloquantes }}
                <span class="hidden sm:inline">à traiter</span>
              </a>
            }
          }

          <a routerLink="/mon-compte" class="hidden text-right leading-tight sm:block">
            <p class="text-[13px] font-medium text-gray-900 hover:text-primary">
              {{ profile()?.fullName }}
            </p>
            <p class="text-[11px] text-ink-muted">{{ roleLabel() }}</p>
          </a>
          <button class="btn-ghost" (click)="logout()">
            <erp-icon name="log-out" [size]="14" />
            <span class="hidden sm:inline">Déconnexion</span>
          </button>
        </div>
      </header>

      <div class="flex min-h-0 flex-1">
        <!-- ================= Barre latérale ================= -->
        <aside
          class="hidden w-[240px] shrink-0 border-r border-rule bg-surface px-5 pb-5 lg:block"
        >
          <nav>
            @for (group of visibleNav(); track group.title) {
              <p class="nav-label">{{ group.title }}</p>
              @for (item of group.items; track item.path) {
                <a
                  [routerLink]="item.path"
                  routerLinkActive="nav-active"
                  class="nav-item"
                >
                  <erp-icon [name]="item.icon" [size]="18" class="w-6" />
                  {{ item.label }}
                </a>
              }
            }
          </nav>
        </aside>

        <!-- ================= Zone de travail ================= -->
        <main class="min-w-0 flex-1">
          <!-- Bandeaux d'action obligatoire : ils ne se ferment pas tant que
               l'action n'est pas faite. -->
          @if (auth.totpPending()) {
            <div
              class="flex items-center gap-2 border-b border-rule bg-warn-wash px-5 py-2.5
                     text-[13px] text-warn-ink-ink"
            >
              <erp-icon name="alert-triangle" [size]="14" />
              Second facteur obligatoire pour votre rôle, et non encore configuré.
              <a routerLink="/mon-compte" class="ml-1 font-medium underline underline-offset-2">
                Le configurer
              </a>
            </div>
          }
          @if (auth.passwordChangePending()) {
            <div
              class="flex items-center gap-2 border-b border-rule bg-info-wash px-5 py-2.5
                     text-[13px] text-info"
            >
              <erp-icon name="lock" [size]="14" />
              Mot de passe provisoire — un changement est requis.
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
export class ShellComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  protected readonly profile = this.auth.profile;

  /**
   * Décompte de MA file, pour la pastille.
   *
   * On n'affiche que les BLOQUANTES : un total incluant deux cents anomalies
   * anciennes noierait les trois qui arrêtent quelqu'un aujourd'hui, et la
   * pastille cesserait d'être lue.
   */
  protected readonly compteur = signal<CompteurTaches | null>(null);

  ngOnInit(): void {
    // Lu une fois au montage du cadre. Pas de rafraîchissement périodique :
    // une pastille qui bouge toute seule attire l'œil sans rien apprendre, et
    // la file se relit à chaque navigation vers l'écran.
    this.api.compteurTaches().subscribe({
      next: (c) => this.compteur.set(c),
      // Un rôle sans file, ou une lecture qui échoue, ne doit pas casser le
      // cadre : la pastille disparaît, le reste fonctionne.
      error: () => this.compteur.set(null),
    });
  }

  protected readonly visibleNav = computed(() => {
    const role = this.auth.role();
    return NAV.map((group) => ({
      ...group,
      items: group.items.filter((i) => !i.roles || (role !== null && i.roles.includes(role))),
    })).filter((group) => group.items.length > 0);
  });

  protected readonly roleLabel = computed(() => {
    const role = this.auth.role();
    return role ? ROLE_LABELS[role] : '';
  });

  protected logout(): void {
    this.auth.logout();
  }
}
