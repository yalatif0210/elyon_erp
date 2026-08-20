import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  FieldUserAdminRow,
  UserAdminRow,
} from '../core/api.service';
import { ROLE_LABELS, UserRole } from '../core/auth.service';
import {
  ActionFeedbackComponent,
  ActionState,
  failureMessage,
  HttpFailure,
} from '../shared/action-panel.component';
import { TableauControlesComponent, TableauPagine } from '../shared/tableau';
import { dateOnly } from '../shared/format';

type FieldRole = 'FIELD_AGENT' | 'HSE_CONTROLLER';

const FIELD_ROLE_LABELS: Record<FieldRole, string> = {
  FIELD_AGENT: 'Agent d’opération',
  HSE_CONTROLLER: 'Contrôleur HSE',
};

const INTERNAL_ROLES: UserRole[] = [
  'DG',
  'ASSISTANT_DG',
  'IT_ADMIN',
  'CCOO',
  'SALES_REP',
  'LOGISTICS_COORD',
  'FINANCE_CFO',
  'ACCOUNTANT',
];

const FIELD_ROLES: FieldRole[] = ['FIELD_AGENT', 'HSE_CONTROLLER'];

/**
 * Gestion des comptes — internes et terrain (chantier « accès des
 * utilisateurs »).
 *
 * ⚠️ CET ÉCRAN N'EXISTAIT PAS — AUCUNE ROUTE NE CRÉAIT DE COMPTE.
 *
 *    La seule création de compte de tout le projet vivait dans
 *    `prisma/seed.ts`, jamais exécuté hors développement/CI. Un déploiement
 *    réel (staging ou production, tous deux sans semis) démarrait donc sans
 *    que personne — pas même le DG — puisse se connecter.
 *    `prisma/bootstrap-admin.ts` crée ce tout premier compte ; cet écran
 *    prend le relais pour tous les suivants.
 *
 * Volontairement hors du garde d'écran dynamique (`roleGuard` fixe dans
 * `app.routes.ts`, pas `screenGuard`) — même principe que « Accès aux
 * écrans » : un DG qui se retirerait par erreur l'accès à cet écran depuis le
 * paramétrage des écrans ne doit jamais se retrouver sans porte de sortie.
 *
 * Les comptes portail se créent à part, depuis la fiche d'un tiers
 * (`partners.component.ts`) : un `PortalUser` exige toujours un tiers, la
 * création n'a pas de sens hors de ce contexte.
 */
@Component({
  selector: 'erp-user-admin',
  standalone: true,
  imports: [FormsModule, ActionFeedbackComponent, TableauControlesComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Gérer les utilisateurs</h1>
      <p class="page-sub">
        Comptes internes et terrain. Les accès portail se créent depuis la fiche du tiers
        concerné, dans Tiers.
      </p>
    </header>

    <div class="mb-5 flex gap-2">
      <button
        type="button"
        class="rounded-md px-3.5 py-2 text-[13px] font-medium transition-all"
        [class]="vue() === 'internes'
          ? 'bg-primary text-white'
          : 'border border-rule-strong bg-surface text-ink-soft hover:bg-gray-100 hover:text-ink'"
        (click)="vue.set('internes')"
      >
        Internes
      </button>
      <button
        type="button"
        class="rounded-md px-3.5 py-2 text-[13px] font-medium transition-all"
        [class]="vue() === 'terrain'
          ? 'bg-primary text-white'
          : 'border border-rule-strong bg-surface text-ink-soft hover:bg-gray-100 hover:text-ink'"
        (click)="vue.set('terrain')"
      >
        Terrain
      </button>
    </div>

    <erp-action-feedback [error]="state.error()" [success]="state.done()" />

    <!-- ============================= INTERNES ============================= -->
    @if (vue() === 'internes') {
      <section class="card mb-5">
        <div class="card-header"><h2 class="card-title">Créer un compte interne</h2></div>
        <div class="card-body">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <label class="label" for="iu-email">Adresse électronique</label>
              <input id="iu-email" type="email" class="field" [(ngModel)]="iEmail" />
            </div>
            <div>
              <label class="label" for="iu-nom">Nom complet</label>
              <input id="iu-nom" class="field" [(ngModel)]="iFullName" />
            </div>
            <div>
              <label class="label" for="iu-role">Rôle</label>
              <select id="iu-role" class="field" [(ngModel)]="iRole">
                @for (r of internalRoles; track r) {
                  <option [value]="r">{{ roleLabel(r) }}</option>
                }
              </select>
            </div>
            <div>
              <label class="label" for="iu-mdp">Mot de passe provisoire</label>
              <input id="iu-mdp" type="text" class="field" [(ngModel)]="iPassword" placeholder="12 caractères minimum" />
            </div>
          </div>
          <p class="mt-2 text-[11px] leading-relaxed text-ink-faint">
            À communiquer hors ligne : aucun courriel n'est envoyé. Le changement est imposé à
            la première connexion.
          </p>
          <button class="btn-primary mt-3" [disabled]="state.busy()" (click)="creerInterne()">
            {{ state.busy() ? 'Création…' : 'Créer le compte' }}
          </button>
        </div>
      </section>

      <div class="card overflow-hidden">
        <erp-tableau-controles [tableau]="tableauInternes" libelle="les comptes" />
        <div class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>Compte</th>
              <th>Rôle</th>
              <th>État</th>
              <th>2FA</th>
              <th>Dernière connexion</th>
              <th style="width: 220px"></th>
            </tr>
          </thead>
          <tbody>
            @for (u of tableauInternes.lignes(); track u.id) {
              <tr>
                <td>
                  <span class="block text-[13px] text-ink">{{ u.fullName }}</span>
                  <span class="block font-mono text-[11px] text-ink-faint">{{ u.email }}</span>
                </td>
                <td>
                  <select class="field w-auto py-1 text-[12px]" [ngModel]="u.role" (ngModelChange)="changerRoleInterne(u, $event)">
                    @for (r of internalRoles; track r) {
                      <option [value]="r">{{ roleLabel(r) }}</option>
                    }
                  </select>
                </td>
                <td>
                  @if (u.isActive) {
                    <span class="text-[11px] text-ok">Actif</span>
                  } @else {
                    <span class="text-[11px] font-medium text-crit">Désactivé</span>
                  }
                </td>
                <td class="text-[11px] text-ink-faint">{{ u.totpEnabled ? 'Activée' : '-' }}</td>
                <td class="font-mono text-[12px] text-ink-soft">
                  {{ u.lastLoginAt ? dateOnly(u.lastLoginAt) : 'jamais' }}
                </td>
                <td>
                  <div class="flex justify-end gap-2">
                    <button class="btn-ghost text-[12px]" (click)="basculerActifInterne(u)">
                      {{ u.isActive ? 'Désactiver' : 'Réactiver' }}
                    </button>
                    <button class="btn-ghost text-[12px]" (click)="ouvrirReinitInterne(u)">
                      Mot de passe
                    </button>
                  </div>
                  @if (reinitOuvert() === u.id) {
                    <div class="mt-2 flex items-center gap-2">
                      <input
                        type="text"
                        class="field h-8 text-[12px]"
                        [(ngModel)]="nouveauMdp"
                        placeholder="Nouveau mot de passe provisoire"
                      />
                      <button class="btn-primary h-8 px-2 text-[12px]" (click)="reinitInterne(u)">OK</button>
                    </div>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="empty">Aucun compte interne.</td></tr>
            }
          </tbody>
        </table>
        </div>
      </div>
    }

    <!-- ============================= TERRAIN ============================= -->
    @if (vue() === 'terrain') {
      <section class="card mb-5">
        <div class="card-header"><h2 class="card-title">Créer un compte terrain</h2></div>
        <div class="card-body">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <label class="label" for="fu-email">Adresse électronique</label>
              <input id="fu-email" type="email" class="field" [(ngModel)]="fEmail" />
            </div>
            <div>
              <label class="label" for="fu-nom">Nom complet</label>
              <input id="fu-nom" class="field" [(ngModel)]="fFullName" />
            </div>
            <div>
              <label class="label" for="fu-role">Rôle</label>
              <select id="fu-role" class="field" [(ngModel)]="fRole">
                @for (r of fieldRoles; track r) {
                  <option [value]="r">{{ fieldRoleLabel(r) }}</option>
                }
              </select>
            </div>
            <div>
              <label class="label" for="fu-mdp">Mot de passe provisoire</label>
              <input id="fu-mdp" type="text" class="field" [(ngModel)]="fPassword" placeholder="12 caractères minimum" />
            </div>
          </div>
          <button class="btn-primary mt-3" [disabled]="state.busy()" (click)="creerTerrain()">
            {{ state.busy() ? 'Création…' : 'Créer le compte' }}
          </button>
        </div>
      </section>

      <div class="card overflow-hidden">
        <erp-tableau-controles [tableau]="tableauTerrain" libelle="les comptes" />
        <div class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>Compte</th>
              <th>Rôle</th>
              <th>État</th>
              <th>Appareil affecté</th>
              <th>Dernière connexion</th>
              <th style="width: 220px"></th>
            </tr>
          </thead>
          <tbody>
            @for (f of tableauTerrain.lignes(); track f.id) {
              <tr>
                <td>
                  <span class="block text-[13px] text-ink">{{ f.fullName }}</span>
                  <span class="block font-mono text-[11px] text-ink-faint">{{ f.email }}</span>
                </td>
                <td>
                  <select class="field w-auto py-1 text-[12px]" [ngModel]="f.role" (ngModelChange)="changerRoleTerrain(f, $event)">
                    @for (r of fieldRoles; track r) {
                      <option [value]="r">{{ fieldRoleLabel(r) }}</option>
                    }
                  </select>
                </td>
                <td>
                  @if (f.isActive) {
                    <span class="text-[11px] text-ok">Actif</span>
                  } @else {
                    <span class="text-[11px] font-medium text-crit">Désactivé</span>
                  }
                </td>
                <td class="font-mono text-[11px] text-ink-faint">{{ f.assignedDeviceId ?? '-' }}</td>
                <td class="font-mono text-[12px] text-ink-soft">
                  {{ f.lastLoginAt ? dateOnly(f.lastLoginAt) : 'jamais' }}
                </td>
                <td>
                  <div class="flex justify-end gap-2">
                    <button class="btn-ghost text-[12px]" (click)="basculerActifTerrain(f)">
                      {{ f.isActive ? 'Désactiver' : 'Réactiver' }}
                    </button>
                    <button class="btn-ghost text-[12px]" (click)="ouvrirReinitTerrain(f)">
                      Mot de passe
                    </button>
                  </div>
                  @if (reinitOuvert() === f.id) {
                    <div class="mt-2 flex items-center gap-2">
                      <input
                        type="text"
                        class="field h-8 text-[12px]"
                        [(ngModel)]="nouveauMdp"
                        placeholder="Nouveau mot de passe provisoire"
                      />
                      <button class="btn-primary h-8 px-2 text-[12px]" (click)="reinitTerrain(f)">OK</button>
                    </div>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="empty">Aucun compte terrain.</td></tr>
            }
          </tbody>
        </table>
        </div>
      </div>
    }
  `,
})
export class UserAdminComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly state = new ActionState();
  protected readonly vue = signal<'internes' | 'terrain'>('internes');

  protected readonly internalRoles = INTERNAL_ROLES;
  protected readonly fieldRoles = FIELD_ROLES;

  protected readonly internes = signal<UserAdminRow[]>([]);
  protected readonly tableauInternes = new TableauPagine<UserAdminRow>();
  protected readonly terrain = signal<FieldUserAdminRow[]>([]);
  protected readonly tableauTerrain = new TableauPagine<FieldUserAdminRow>();

  protected iEmail = '';
  protected iFullName = '';
  protected iRole: UserRole = 'SALES_REP';
  protected iPassword = '';

  protected fEmail = '';
  protected fFullName = '';
  protected fRole: FieldRole = 'FIELD_AGENT';
  protected fPassword = '';

  protected readonly reinitOuvert = signal<string | null>(null);
  protected nouveauMdp = '';

  ngOnInit(): void {
    this.rechargerInternes();
    this.rechargerTerrain();
  }

  private rechargerInternes(): void {
    this.api.users().subscribe((rows) => {
      this.internes.set(rows);
      this.tableauInternes.définir(rows);
    });
  }

  private rechargerTerrain(): void {
    this.api.fieldUsers().subscribe((rows) => {
      this.terrain.set(rows);
      this.tableauTerrain.définir(rows);
    });
  }

  protected roleLabel(role: string): string {
    return ROLE_LABELS[role as UserRole] ?? role;
  }

  protected fieldRoleLabel(role: string): string {
    return FIELD_ROLE_LABELS[role as FieldRole] ?? role;
  }

  protected creerInterne(): void {
    if (this.state.busy()) return;
    if (!this.iEmail.trim() || !this.iFullName.trim() || this.iPassword.trim().length < 12) {
      this.state.error.set('Adresse, nom et mot de passe (12 caractères minimum) sont requis.');
      return;
    }
    this.state.start();
    this.api
      .createUser({ email: this.iEmail.trim(), fullName: this.iFullName.trim(), role: this.iRole, password: this.iPassword })
      .subscribe({
        next: () => {
          this.state.succeed('Compte créé.');
          this.iEmail = '';
          this.iFullName = '';
          this.iPassword = '';
          this.rechargerInternes();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }

  protected creerTerrain(): void {
    if (this.state.busy()) return;
    if (!this.fEmail.trim() || !this.fFullName.trim() || this.fPassword.trim().length < 12) {
      this.state.error.set('Adresse, nom et mot de passe (12 caractères minimum) sont requis.');
      return;
    }
    this.state.start();
    this.api
      .createFieldUser({ email: this.fEmail.trim(), fullName: this.fFullName.trim(), role: this.fRole, password: this.fPassword })
      .subscribe({
        next: () => {
          this.state.succeed('Compte créé.');
          this.fEmail = '';
          this.fFullName = '';
          this.fPassword = '';
          this.rechargerTerrain();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }

  protected changerRoleInterne(u: UserAdminRow, role: string): void {
    this.api.updateUser(u.id, { role }).subscribe({
      next: () => this.rechargerInternes(),
      error: (e: HttpFailure) => this.state.error.set(failureMessage(e, 'Changement de rôle refusé.')),
    });
  }

  protected basculerActifInterne(u: UserAdminRow): void {
    this.api.updateUser(u.id, { isActive: !u.isActive }).subscribe({
      next: () => this.rechargerInternes(),
      error: (e: HttpFailure) => this.state.error.set(failureMessage(e, 'Changement d’état refusé.')),
    });
  }

  protected changerRoleTerrain(f: FieldUserAdminRow, role: string): void {
    this.api.updateFieldUser(f.id, { role }).subscribe({
      next: () => this.rechargerTerrain(),
      error: (e: HttpFailure) => this.state.error.set(failureMessage(e, 'Changement de rôle refusé.')),
    });
  }

  protected basculerActifTerrain(f: FieldUserAdminRow): void {
    this.api.updateFieldUser(f.id, { isActive: !f.isActive }).subscribe({
      next: () => this.rechargerTerrain(),
      error: (e: HttpFailure) => this.state.error.set(failureMessage(e, 'Changement d’état refusé.')),
    });
  }

  protected ouvrirReinitInterne(u: UserAdminRow): void {
    this.nouveauMdp = '';
    this.reinitOuvert.set(this.reinitOuvert() === u.id ? null : u.id);
  }

  protected ouvrirReinitTerrain(f: FieldUserAdminRow): void {
    this.nouveauMdp = '';
    this.reinitOuvert.set(this.reinitOuvert() === f.id ? null : f.id);
  }

  protected reinitInterne(u: UserAdminRow): void {
    if (this.nouveauMdp.trim().length < 12) {
      this.state.error.set('Mot de passe provisoire de 12 caractères minimum.');
      return;
    }
    this.api.resetUserPassword(u.id, this.nouveauMdp).subscribe({
      next: () => {
        this.state.succeed('Mot de passe réinitialisé.');
        this.reinitOuvert.set(null);
      },
      error: (e: HttpFailure) => this.state.error.set(failureMessage(e, 'Réinitialisation refusée.')),
    });
  }

  protected reinitTerrain(f: FieldUserAdminRow): void {
    if (this.nouveauMdp.trim().length < 12) {
      this.state.error.set('Mot de passe provisoire de 12 caractères minimum.');
      return;
    }
    this.api.resetFieldUserPassword(f.id, this.nouveauMdp).subscribe({
      next: () => {
        this.state.succeed('Mot de passe réinitialisé.');
        this.reinitOuvert.set(null);
      },
      error: (e: HttpFailure) => this.state.error.set(failureMessage(e, 'Réinitialisation refusée.')),
    });
  }

  protected readonly dateOnly = dateOnly;
}
