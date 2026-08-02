import { Routes } from '@angular/router';
import { authGuard, roleGuard } from './core/auth.guard';

/**
 * Routage de la console interne.
 *
 * Chargement paresseux systématique : la console couvrira une quinzaine de
 * modules d'ici le lot 4, et tout charger au démarrage rendrait la première
 * page inutilement lente.
 */
export const routes: Routes = [
  {
    path: 'connexion',
    loadComponent: () => import('./features/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', redirectTo: 'tableau-de-bord', pathMatch: 'full' },
      {
        path: 'tableau-de-bord',
        loadComponent: () =>
          import('./features/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'conformite',
        loadComponent: () =>
          import('./features/compliance.component').then((m) => m.ComplianceComponent),
      },
      {
        path: 'echeancier',
        loadComponent: () =>
          import('./features/compliance.component').then((m) => m.ExpiryComponent),
      },
      {
        path: 'tiers',
        loadComponent: () =>
          import('./features/partners.component').then((m) => m.PartnersComponent),
      },
      {
        path: 'derogations',
        // Filtrage de confort : l'autorisation réelle est côté serveur.
        canActivate: [roleGuard('DG', 'FINANCE_CFO', 'CCOO', 'ACCOUNTANT', 'ASSISTANT_DG')],
        loadComponent: () =>
          import('./features/derogations.component').then((m) => m.DerogationsComponent),
      },
      {
        path: 'referentiels',
        loadComponent: () =>
          import('./features/referentials.component').then((m) => m.ReferentialsComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
