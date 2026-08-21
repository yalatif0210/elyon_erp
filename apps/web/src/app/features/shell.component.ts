import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ApiService, CompteurTaches } from '../core/api.service';
import { AuthService, ROLE_LABELS, UserRole } from '../core/auth.service';
import { IconComponent, IconName } from '../shared/icon.component';

interface NavItem {
  label: string;
  path: string;
  icon: IconName;
  /**
   * Clé d'écran (§ paramétrage 17/08) - la visibilité est résolue par
   * `AuthService.canSeeScreen()`, dérogations DG comprises. Absente pour les
   * DEUX seules entrées volontairement hors matrice : `roles` fixe alors la
   * règle, en dur, sans dérogation possible.
   */
  screenKey?: string;
  /** Immunisé contre la matrice - voir `screenKey`. */
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
      { label: 'Tableau de bord', path: '/tableau-de-bord', icon: 'gauge', screenKey: 'tableau-de-bord' },
      // En tête, sous le tableau de bord : c'est le premier écran qu'on ouvre
      // le matin. Ce qui n'est pas dans le chemin quotidien n'est pas lu.
      {
        label: 'Ce que j’ai à traiter',
        path: '/mes-taches',
        icon: 'clipboard-check',
        screenKey: 'mes-taches',
      },
      // Ce que les verrous NE PEUVENT PAS arrêter : le placement juste
      // au-dessus du seuil, l'écart entre marge promise et marge réalisée.
      // Sous « Piloter » et non sous « Administrer » : ce n'est pas un réglage,
      // c'est une lecture de l'entreprise.
      { label: 'Pilotage financier', path: '/pilotage', icon: 'gauge', screenKey: 'pilotage' },
      { label: 'Surveillance', path: '/supervision', icon: 'search', screenKey: 'supervision' },
      {
        label: 'Recouvrement',
        path: '/recouvrement',
        icon: 'alert-triangle',
        screenKey: 'recouvrement',
      },
    ],
  },
  {
    title: 'Vendre et livrer',
    items: [
      // Avant les affaires : le pipeline les PRÉCÈDE, une affaire naît d'une
      // opportunité gagnée. L'ordre de la navigation raconte le parcours.
      { label: 'Pipeline commercial', path: '/crm', icon: 'search', screenKey: 'crm' },
      {
        label: 'Demandes de cotation',
        path: '/demandes-de-cotation',
        icon: 'clipboard-check',
        screenKey: 'demandes-de-cotation',
      },
      { label: 'Affaires', path: '/affaires', icon: 'briefcase', screenKey: 'affaires' },
      { label: 'Opérations', path: '/operations', icon: 'truck', screenKey: 'operations' },
      { label: 'Facturation', path: '/facturation', icon: 'receipt', screenKey: 'facturation' },
      { label: 'Contrôles HSE', path: '/hse', icon: 'clipboard-check', screenKey: 'hse' },
      { label: 'Documents', path: '/documents', icon: 'file-text', screenKey: 'documents' },
      { label: 'Achats', path: '/achats', icon: 'briefcase', screenKey: 'achats' },
      { label: 'Barge', path: '/barge', icon: 'truck', screenKey: 'barge' },
    ],
  },
  {
    title: 'Administrer',
    items: [
      { label: 'Conformité', path: '/conformite', icon: 'shield', screenKey: 'conformite' },
      {
        label: 'Procédures opérationnelles',
        path: '/procedures',
        icon: 'clipboard-check',
        screenKey: 'procedures',
      },
      { label: 'Tiers', path: '/tiers', icon: 'users', screenKey: 'tiers' },
      { label: 'Dérogations', path: '/derogations', icon: 'lock', screenKey: 'derogations' },
      { label: 'Référentiels', path: '/referentiels', icon: 'layers', screenKey: 'referentiels' },
      {
        label: 'Paramétrage',
        path: '/parametrage',
        icon: 'clipboard-check',
        screenKey: 'parametrage',
      },
      {
        label: 'Journal d’audit',
        path: '/journal-audit',
        icon: 'file-text',
        screenKey: 'journal-audit',
      },
      // Hors matrice, volontairement : voir le commentaire de `NavItem.roles`.
      { label: 'Accès aux écrans', path: '/acces-ecrans', icon: 'lock', roles: ['DG'] },
      {
        label: 'Gérer les utilisateurs',
        path: '/utilisateurs',
        icon: 'users',
        roles: ['DG', 'IT_ADMIN'],
      },
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
          <img src="/assets/brand/logo.png" alt="Elyon Trading" class="h-9 w-auto" />
        </div>

        <div class="flex items-center gap-4">
          <!--
            ⚠️ LA PASTILLE COMPTE CE QUE SON LIBELLÉ ANNONCE.

               Elle affichait le nombre de tâches BLOQUANTES sous le libellé
               « à traiter ». Deux conséquences, constatées toutes les deux :

                 · avec 4 tâches à venir et aucune bloquante, la pastille
                   DISPARAISSAIT — quatre choses à faire, et rien ne le disait ;
                 · le chiffre affiché ne correspondait pas au nombre de lignes
                   de la file, ce qui donne raison de ne plus croire ni l'un ni
                   l'autre.

               Elle affiche donc le TOTAL, et se teinte en rouge dès qu'une
               tâche bloque quelqu'un. Le détail est dans l'infobulle : c'est
               là qu'on va chercher la nuance, pas dans un chiffre.
          -->
          @if (compteur(); as c) {
            @if (c.total > 0) {
              <a
                routerLink="/mes-taches"
                class="mr-3 inline-flex items-center gap-1.5 rounded-[3px] px-2.5 py-1
                       text-[12px] font-semibold"
                [class]="
                  c.bloquantes > 0
                    ? 'border border-crit/40 bg-crit-wash text-crit'
                    : 'border border-rule bg-gray-50 text-ink-soft'
                "
                [title]="infobulleTaches(c)"
              >
                <erp-icon [name]="c.bloquantes > 0 ? 'lock' : 'clipboard-check'" [size]="13" />
                {{ c.total }}
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
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly compteur = signal<CompteurTaches | null>(null);

  ngOnInit(): void {
    this.relireCompteur();
    // Charge une fois par session ; `screenGuard` réutilise le même appel mis
    // en cache. Le menu se recalcule tout seul via `visibleNav` dès que le
    // signal se remplit (§ paramétrage 17/08).
    this.auth.visibleScreens$().subscribe();

    // ⚠️ LA PASTILLE ÉTAIT LUE UNE SEULE FOIS, AU MONTAGE DU CADRE.
    //
    //    Le cadre ne se remonte pas : il survit à toutes les navigations. La
    //    pastille gardait donc, pendant toute la session, le chiffre du moment
    //    où l'application avait été ouverte — tandis que la liste, elle, se
    //    relisait à chaque visite de l'écran.
    //
    //    Constaté : « 46 à traiter » au bandeau, UNE seule ligne dans la file.
    //    Les deux venaient de la même vue ; seule la fraîcheur différait.
    //
    //    C'est exactement la dérive que la file de tâches a été conçue pour
    //    éviter. J'ai fait dériver les tâches de l'état précisément pour qu'aucun
    //    compteur ne puisse mentir — puis j'ai laissé le seul chiffre visible en
    //    permanence se figer. Une file qu'on ne croit plus est pire que pas de
    //    file du tout, et c'est le bandeau qu'on regarde en premier.
    //
    //    On relit donc à chaque navigation ACHEVÉE. Ce n'est pas un
    //    rafraîchissement périodique — une pastille qui bouge toute seule
    //    attire l'œil sans rien apprendre. C'est une relecture APRÈS un geste :
    //    l'utilisateur vient de faire quelque chose, le compte a pu changer.
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.relireCompteur());
  }

  /**
   * Le détail derrière le chiffre.
   *
   * Un total seul ne dit pas si quelqu'un est arrêté ou si tout est simplement
   * à venir. L'infobulle porte la nuance ; la pastille porte le nombre.
   */
  protected infobulleTaches(c: CompteurTaches): string {
    const morceaux: string[] = [];
    if (c.bloquantes > 0) morceaux.push(`${c.bloquantes} bloquante(s) : quelqu’un est arrêté`);
    if (c.anomalies > 0) morceaux.push(`${c.anomalies} anomalie(s) : déjà passé`);
    if (c.aVenir > 0) morceaux.push(`${c.aVenir} à venir`);
    return morceaux.join(' · ') || 'Rien ne vous attend';
  }

  private relireCompteur(): void {
    this.api.compteurTaches().subscribe({
      next: (c) => this.compteur.set(c),
      // Un rôle sans file, ou une lecture qui échoue, ne doit pas casser le
      // cadre : la pastille disparaît, le reste fonctionne.
      error: () => this.compteur.set(null),
    });
  }

  protected readonly visibleNav = computed(() => {
    const role = this.auth.role();
    // Dépend de `this.auth.screens()` pour se recalculer dès le chargement
    // asynchrone (§ paramétrage 17/08) - lu ici uniquement pour que le signal
    // entre dans les dépendances de ce computed.
    this.auth.screens();
    return NAV.map((group) => ({
      ...group,
      items: group.items.filter((i) =>
        i.roles ? role !== null && i.roles.includes(role) : this.auth.canSeeScreen(i.screenKey!),
      ),
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
