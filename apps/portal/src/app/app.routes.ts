import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

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
        loadComponent: () => import('./features/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'devis',
        loadComponent: () => import('./features/devis.component').then((m) => m.DevisComponent),
      },
      {
        path: 'affaires',
        loadComponent: () => import('./features/affaires.component').then((m) => m.AffairesComponent),
      },
      {
        path: 'affaires/:id',
        loadComponent: () => import('./features/affaires.component').then((m) => m.DealDetailComponent),
      },
      {
        path: 'livraisons',
        loadComponent: () => import('./features/livraisons.component').then((m) => m.LivraisonsComponent),
      },
      {
        path: 'factures',
        loadComponent: () => import('./features/factures.component').then((m) => m.FacturesComponent),
      },
      {
        path: 'mon-compte',
        loadComponent: () => import('./features/account.component').then((m) => m.AccountComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
