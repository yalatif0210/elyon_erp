import { Routes } from '@angular/router';
import { authGuard, roleGuard } from './core/auth.guard';
import { fieldGuard } from './core/field.guard';

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

  // =========================================================================
  //  TERRAIN — la tablette de l'agent (§ 10)
  //
  //  Déclaré AVANT la console interne : les deux arbres sont voisins mais
  //  n'ont rien de commun. Réalm d'authentification distinct, session
  //  distincte, cadre distinct, et surtout objets DÉDIÉS — l'agent ne voit ni
  //  prix, ni marge, ni encours (§ 10.3).
  //
  //  ⚠️ `fieldGuard`, jamais `authGuard`. Une session interne ne doit pas
  //     ouvrir les écrans terrain, ni l'inverse : le cloisonnement des réalms
  //     s'arrêterait à la porte du serveur alors qu'il commence ici.
  // =========================================================================
  {
    path: 'terrain/connexion',
    loadComponent: () =>
      import('./features/terrain/terrain-login.component').then((m) => m.TerrainLoginComponent),
  },
  {
    path: 'terrain',
    canActivate: [fieldGuard],
    loadComponent: () =>
      import('./features/terrain/terrain-shell.component').then((m) => m.TerrainShellComponent),
    children: [
      { path: '', pathMatch: 'full',
        loadComponent: () =>
          import('./features/terrain/terrain-worklist.component').then(
            (m) => m.TerrainWorklistComponent,
          ),
      },
      {
        path: 'operation/:id',
        loadComponent: () =>
          import('./features/terrain/terrain-operation.component').then(
            (m) => m.TerrainOperationComponent,
          ),
      },
      {
        path: 'operation/:id/site',
        loadComponent: () =>
          import('./features/terrain/terrain-site.component').then((m) => m.TerrainSiteComponent),
      },
      // La checklist SANS identifiant ouvre le choix de la phase ; avec
      // identifiant, elle ouvre celle-là. Deux routes plutôt qu'un paramètre
      // facultatif : le routeur d'Angular ne distingue pas « absent » de
      // « vide », et l'écran finirait par ouvrir une checklist nulle.
      {
        path: 'operation/:id/checklist',
        loadComponent: () =>
          import('./features/terrain/terrain-checklist.component').then(
            (m) => m.TerrainChecklistComponent,
          ),
      },
      {
        path: 'operation/:id/checklist/:checkId',
        loadComponent: () =>
          import('./features/terrain/terrain-checklist.component').then(
            (m) => m.TerrainChecklistComponent,
          ),
      },
      {
        path: 'operation/:id/releve',
        loadComponent: () =>
          import('./features/terrain/terrain-saisies.component').then(
            (m) => m.TerrainMeasurementComponent,
          ),
      },
      {
        path: 'operation/:id/incident',
        loadComponent: () =>
          import('./features/terrain/terrain-saisies.component').then(
            (m) => m.TerrainIncidentComponent,
          ),
      },
      {
        path: 'operation/:id/avancement',
        loadComponent: () =>
          import('./features/terrain/terrain-saisies.component').then(
            (m) => m.TerrainStatusComponent,
          ),
      },
      // La file est l'écran auquel mène le compteur du bandeau. Sans elle, ce
      // compteur est un chiffre sans recours : l'agent voit « 3 refusés » et
      // n'a aucun moyen de savoir lesquels, ni pourquoi.
      {
        path: 'file',
        loadComponent: () =>
          import('./features/terrain/terrain-file.component').then((m) => m.TerrainFileComponent),
      },
      // Un compte terrain naît avec un mot de passe provisoire et une bannière
      // qui demande de le changer. Sans cet écran, la bannière est une
      // injonction sans issue.
      {
        path: 'mot-de-passe',
        loadComponent: () =>
          import('./features/terrain/terrain-mot-de-passe.component').then(
            (m) => m.TerrainMotDePasseComponent,
          ),
      },
    ],
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
        path: 'mes-taches',
        loadComponent: () => import('./features/taches.component').then((m) => m.TachesComponent),
      },
      {
        path: 'mon-compte',
        loadComponent: () => import('./features/account.component').then((m) => m.AccountComponent),
      },
      // --- Lot 2 : chaîne commerciale et exécution ---
      {
        path: 'affaires',
        loadComponent: () => import('./features/deals.component').then((m) => m.DealsComponent),
      },
      {
        path: 'affaires/:id',
        loadComponent: () =>
          import('./features/deals.component').then((m) => m.DealDetailComponent),
      },
      {
        path: 'operations',
        loadComponent: () =>
          import('./features/operations.component').then((m) => m.OperationsComponent),
      },
      // Déclarée AVANT `operations/:id` : le routeur retient la première route
      // qui correspond, et `:id` avalerait « nouvelle » comme un identifiant.
      {
        path: 'operations/nouvelle',
        // Filtrage de confort : la création est réservée au coordinateur
        // logistique et au CCOO côté serveur, qui reste seul juge.
        canActivate: [roleGuard('LOGISTICS_COORD', 'CCOO')],
        loadComponent: () =>
          import('./features/operation-create.component').then(
            (m) => m.OperationCreateComponent,
          ),
      },
      {
        path: 'operations/:id',
        loadComponent: () =>
          import('./features/operations.component').then((m) => m.OperationDetailComponent),
      },
      {
        path: 'facturation',
        loadComponent: () =>
          import('./features/invoices.component').then((m) => m.InvoicesComponent),
      },
      {
        path: 'achats',
        loadComponent: () =>
          import('./features/supplier-invoices.component').then(
            (m) => m.SupplierInvoicesComponent,
          ),
      },
      {
        path: 'hse',
        loadComponent: () => import('./features/hse.component').then((m) => m.HseComponent),
      },
      {
        path: 'documents',
        loadComponent: () =>
          import('./features/documents.component').then((m) => m.DocumentsComponent),
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
      // La file de tâches renvoie ici pour les écarts d'invariant. Sans cette
      // route, le lien retombait sur le tableau de bord — en silence, et au
      // moment précis où quelque chose ne va pas.
      {
        path: 'supervision',
        // Filtrage de confort : le serveur reste seul juge, route par route.
        canActivate: [roleGuard('DG', 'FINANCE_CFO', 'CCOO', 'ACCOUNTANT', 'IT_ADMIN')],
        loadComponent: () =>
          import('./features/supervision.component').then((m) => m.SupervisionComponent),
      },
      {
        path: 'crm',
        canActivate: [roleGuard('DG', 'CCOO', 'SALES_REP', 'FINANCE_CFO', 'ASSISTANT_DG')],
        loadComponent: () => import('./features/crm.component').then((m) => m.CrmComponent),
      },
      {
        path: 'pilotage',
        canActivate: [roleGuard('DG', 'FINANCE_CFO', 'CCOO', 'ACCOUNTANT', 'LOGISTICS_COORD')],
        loadComponent: () =>
          import('./features/pilotage.component').then((m) => m.PilotageComponent),
      },
      {
        path: 'parametrage',
        loadComponent: () =>
          import('./features/parameters.component').then((m) => m.ParametersComponent),
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
