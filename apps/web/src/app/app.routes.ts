import { Routes } from '@angular/router';
import { authGuard, roleGuard, screenGuard } from './core/auth.guard';
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

  // Vérification publique d'un document par QR code (§ 12.2) - hors session,
  // aucun `authGuard` : quiconque scanne un papier n'a pas de compte interne.
  {
    path: 'verification/:token',
    loadComponent: () =>
      import('./features/verify-document.component').then((m) => m.VerifyDocumentComponent),
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
      {
        path: 'operation/:id/cloture',
        loadComponent: () =>
          import('./features/terrain/terrain-cloture.component').then(
            (m) => m.TerrainClotureComponent,
          ),
      },
      // Symétrique de `mot-de-passe` : un compte signalé pour un second
      // facteur obligatoire doit pouvoir l'activer sans quitter la tablette.
      {
        path: 'second-facteur',
        loadComponent: () =>
          import('./features/terrain/terrain-totp.component').then(
            (m) => m.TerrainTotpComponent,
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
        canActivate: [screenGuard('tableau-de-bord')],
        loadComponent: () =>
          import('./features/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'mes-taches',
        canActivate: [screenGuard('mes-taches')],
        loadComponent: () => import('./features/taches.component').then((m) => m.TachesComponent),
      },
      {
        path: 'mon-compte',
        loadComponent: () => import('./features/account.component').then((m) => m.AccountComponent),
      },
      // --- Lot 2 : chaîne commerciale et exécution ---
      {
        path: 'affaires',
        canActivate: [screenGuard('affaires')],
        loadComponent: () => import('./features/deals.component').then((m) => m.DealsComponent),
      },
      // Déclarée AVANT affaires/:id : le routeur retient la première route
      // qui correspond, et :id avalerait « nouvelle » comme un identifiant.
      {
        path: 'affaires/nouvelle',
        canActivate: [roleGuard('SALES_REP', 'CCOO')],
        loadComponent: () =>
          import('./features/deal-create.component').then((m) => m.DealCreateComponent),
      },
      {
        path: 'affaires/:id',
        canActivate: [screenGuard('affaires')],
        loadComponent: () =>
          import('./features/deals.component').then((m) => m.DealDetailComponent),
      },
      {
        path: 'operations',
        canActivate: [screenGuard('operations')],
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
        canActivate: [screenGuard('operations')],
        loadComponent: () =>
          import('./features/operations.component').then((m) => m.OperationDetailComponent),
      },
      {
        path: 'facturation',
        canActivate: [screenGuard('facturation')],
        loadComponent: () =>
          import('./features/invoices.component').then((m) => m.InvoicesComponent),
      },
      {
        path: 'achats',
        canActivate: [screenGuard('achats')],
        loadComponent: () =>
          import('./features/supplier-invoices.component').then(
            (m) => m.SupplierInvoicesComponent,
          ),
      },
      {
        path: 'hse',
        canActivate: [screenGuard('hse')],
        loadComponent: () => import('./features/hse.component').then((m) => m.HseComponent),
      },
      {
        path: 'documents',
        canActivate: [screenGuard('documents')],
        loadComponent: () =>
          import('./features/documents.component').then((m) => m.DocumentsComponent),
      },
      {
        path: 'conformite',
        canActivate: [screenGuard('conformite')],
        loadComponent: () =>
          import('./features/compliance.component').then((m) => m.ComplianceComponent),
      },
      // Fusionné dans « Conformité » (§ discussion 20/08) : la vue par pièce
      // vit désormais dans le même écran, sous un onglet. Redirigé plutôt que
      // supprimé pour qu'un lien ou une habitude déjà pris ne tombe pas sur
      // une page absente.
      { path: 'echeancier', redirectTo: 'conformite' },
      {
        path: 'procedures',
        canActivate: [screenGuard('procedures')],
        loadComponent: () =>
          import('./features/procedures.component').then((m) => m.ProceduresComponent),
      },
      {
        path: 'tiers',
        canActivate: [screenGuard('tiers')],
        loadComponent: () =>
          import('./features/partners.component').then((m) => m.PartnersComponent),
      },
      {
        path: 'derogations',
        canActivate: [screenGuard('derogations')],
        loadComponent: () =>
          import('./features/derogations.component').then((m) => m.DerogationsComponent),
      },
      {
        path: 'garanties',
        canActivate: [screenGuard('garanties')],
        loadComponent: () =>
          import('./features/guarantees.component').then((m) => m.GuaranteesComponent),
      },
      {
        path: 'exercices-fiscaux',
        canActivate: [screenGuard('exercices-fiscaux')],
        loadComponent: () =>
          import('./features/fiscal-years.component').then((m) => m.FiscalYearsComponent),
      },
      // La file de tâches renvoie ici pour les écarts d'invariant. Sans cette
      // route, le lien retombait sur le tableau de bord — en silence, et au
      // moment précis où quelque chose ne va pas.
      {
        path: 'supervision',
        canActivate: [screenGuard('supervision')],
        loadComponent: () =>
          import('./features/supervision.component').then((m) => m.SupervisionComponent),
      },
      {
        path: 'journal-audit',
        canActivate: [screenGuard('journal-audit')],
        loadComponent: () =>
          import('./features/audit-log.component').then((m) => m.AuditLogComponent),
      },
      {
        path: 'crm',
        canActivate: [screenGuard('crm')],
        loadComponent: () => import('./features/crm.component').then((m) => m.CrmComponent),
      },
      // Déclarée AVANT crm/:id : le routeur retient la première route qui
      // correspond, et :id avalerait « nouvelle » comme un identifiant.
      {
        path: 'crm/nouvelle',
        canActivate: [roleGuard('DG', 'CCOO', 'SALES_REP')],
        loadComponent: () =>
          import('./features/opportunity-create.component').then(
            (m) => m.OpportunityCreateComponent,
          ),
      },
      {
        path: 'crm/:id',
        canActivate: [screenGuard('crm')],
        loadComponent: () =>
          import('./features/opportunity-detail.component').then(
            (m) => m.OpportunityDetailComponent,
          ),
      },
      {
        path: 'demandes-de-cotation',
        canActivate: [screenGuard('demandes-de-cotation')],
        loadComponent: () =>
          import('./features/quotations.component').then((m) => m.QuotationsComponent),
      },
      {
        path: 'pilotage',
        canActivate: [screenGuard('pilotage')],
        loadComponent: () =>
          import('./features/pilotage.component').then((m) => m.PilotageComponent),
      },
      {
        path: 'barge',
        canActivate: [screenGuard('barge')],
        loadComponent: () => import('./features/barge.component').then((m) => m.BargeComponent),
      },
      {
        path: 'recouvrement',
        canActivate: [screenGuard('recouvrement')],
        loadComponent: () =>
          import('./features/collections.component').then((m) => m.CollectionsComponent),
      },
      {
        path: 'parametrage',
        canActivate: [screenGuard('parametrage')],
        loadComponent: () =>
          import('./features/parameters.component').then((m) => m.ParametersComponent),
      },
      {
        path: 'referentiels',
        canActivate: [screenGuard('referentiels')],
        loadComponent: () =>
          import('./features/referentials.component').then((m) => m.ReferentialsComponent),
      },
      // Accès aux écrans : hors matrice, hors @Screen() - un @Roles(DG) fixe
      // en garantit l'accès quoi que le DG règle par ailleurs (§ paramétrage
      // 17/08, voir screen-access.controller.ts).
      {
        path: 'acces-ecrans',
        canActivate: [roleGuard('DG')],
        loadComponent: () =>
          import('./features/screen-access.component').then((m) => m.ScreenAccessComponent),
      },
      // Gérer les utilisateurs : même principe que l'accès aux écrans - hors
      // matrice, hors @Screen() - un DG qui se retirerait par erreur l'accès
      // à cet écran depuis le paramétrage des écrans ne doit jamais se
      // retrouver sans porte de sortie (voir user-admin.controller.ts).
      {
        path: 'utilisateurs',
        canActivate: [roleGuard('DG', 'IT_ADMIN')],
        loadComponent: () =>
          import('./features/user-admin.component').then((m) => m.UserAdminComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
