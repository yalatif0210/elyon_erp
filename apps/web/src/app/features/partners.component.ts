import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, Partner, PortalUserAdminRow } from '../core/api.service';
import {
  ActionFeedbackComponent,
  ActionState,
  failureMessage,
  HttpFailure,
} from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';
import { PaginationComponent } from '../shared/tableau';
import { StatusBadgeComponent } from '../shared/status-badge.component';
import { dateOnly } from '../shared/format';

const TYPE_LABELS: Record<string, string> = {
  CLIENT: 'Client',
  PROSPECT: 'Prospect',
  SUPPLIER: 'Fournisseur',
  CARRIER: 'Transporteur',
  INSPECTOR: 'Inspecteur',
};

const SEGMENT_LABELS: Record<string, string> = {
  MARITIME: 'Maritime',
  B2B: 'B2B',
  RETAIL: 'Retail',
};

@Component({
  selector: 'erp-partners',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    StatusBadgeComponent,
    PaginationComponent,
    ActionFeedbackComponent,
  ],
  template: `
    <header class="mb-5">
      <h1 class="page-title">Tiers</h1>
      <p class="page-sub">Clients, fournisseurs, transporteurs et inspecteurs</p>
    </header>

    <div class="mb-4 flex items-center gap-3">
      <div class="relative w-full max-w-xs">
        <erp-icon name="search" [size]="14"
                  class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input class="field pl-8" placeholder="Rechercher un tiers…" aria-label="Rechercher un tiers"
               [(ngModel)]="search" (ngModelChange)="onSearch()" />
      </div>
      <span class="ml-auto tabular text-[12px] text-ink-muted">{{ total() }} tiers</span>
    </div>

    <erp-action-feedback [error]="state.error()" [success]="state.done()" />

    <div class="card overflow-x-auto">
      <table class="table">
        <thead>
          <tr>
            <th>Code</th><th>Raison sociale</th><th>Type</th><th>Segment</th>
            <th>Pays</th><th class="num">Délai</th>
            <th class="num">Moyens</th><th>Crédit</th><th style="width: 130px"></th>
          </tr>
        </thead>
        <tbody>
          @for (p of rows(); track p.id) {
            <tr>
              <td><span class="ref">{{ p.code }}</span></td>
              <td class="font-medium text-ink">{{ p.legalName }}</td>
              <td class="text-ink-soft">{{ typeLabel(p.type) }}</td>
              <td>
                @if (p.segment) {
                  <span class="rounded-[3px] bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
                    {{ segmentLabel(p.segment) }}
                  </span>
                } @else {
                  <span class="text-ink-faint">-</span>
                }
              </td>
              <td class="font-mono text-[12px] text-ink-muted">{{ p.countryCode }}</td>
              <td class="num font-mono text-ink-soft">
                {{ p.paymentTermsDays === 0 ? 'comptant' : p.paymentTermsDays + ' j' }}
              </td>
              <td class="num font-mono text-ink-soft">{{ p._count.vehicles + p._count.drivers }}</td>
              <td>
                @if (p.creditStatus === 'ACTIVE') {
                  <erp-status-badge kind="ok" label="Actif" />
                } @else if (p.creditStatus === 'WATCH') {
                  <erp-status-badge kind="wait" label="Surveillé" />
                } @else {
                  <erp-status-badge kind="blocked" label="Bloqué" />
                }
              </td>
              <td>
                <button type="button" class="btn-ghost text-[12px]" (click)="basculerPortail(p)">
                  {{ portailOuvert() === p.id ? 'Masquer' : 'Accès portail' }}
                </button>
              </td>
            </tr>
            @if (portailOuvert() === p.id) {
              <tr>
                <td colspan="10" class="bg-gray-50 px-4 py-3">
                  <div class="mb-3">
                    <table class="table">
                      <thead>
                        <tr>
                          <th>Compte</th><th>État</th><th>Dernière connexion</th>
                          <th style="width: 220px"></th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (u of portailComptes(); track u.id) {
                          <tr>
                            <td>
                              <span class="block text-[13px] text-ink">{{ u.fullName }}</span>
                              <span class="block font-mono text-[11px] text-ink-faint">{{ u.email }}</span>
                            </td>
                            <td>
                              @if (u.isActive) {
                                <span class="text-[11px] text-ok">Actif</span>
                              } @else {
                                <span class="text-[11px] font-medium text-crit">Désactivé</span>
                              }
                            </td>
                            <td class="font-mono text-[12px] text-ink-soft">
                              {{ u.lastLoginAt ? dateOnly(u.lastLoginAt) : 'jamais' }}
                            </td>
                            <td>
                              <div class="flex justify-end gap-2">
                                <button class="btn-ghost text-[12px]" (click)="basculerActifPortail(p, u)">
                                  {{ u.isActive ? 'Désactiver' : 'Réactiver' }}
                                </button>
                                <button class="btn-ghost text-[12px]" (click)="ouvrirReinitPortail(u)">
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
                                  <button class="btn-primary h-8 px-2 text-[12px]" (click)="reinitPortail(p, u)">OK</button>
                                </div>
                              }
                            </td>
                          </tr>
                        } @empty {
                          <tr><td colspan="4" class="empty">Aucun accès portail pour ce tiers.</td></tr>
                        }
                      </tbody>
                    </table>
                  </div>

                  <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div>
                      <label class="label" for="pu-email">Adresse électronique</label>
                      <input id="pu-email" type="email" class="field" [(ngModel)]="puEmail" />
                    </div>
                    <div>
                      <label class="label" for="pu-nom">Nom complet</label>
                      <input id="pu-nom" class="field" [(ngModel)]="puFullName" />
                    </div>
                    <div class="md:col-span-2">
                      <label class="label" for="pu-mdp">Mot de passe provisoire</label>
                      <input id="pu-mdp" type="text" class="field" [(ngModel)]="puPassword" placeholder="12 caractères minimum" />
                    </div>
                  </div>
                  <button class="btn-primary mt-3" [disabled]="state.busy()" (click)="creerPortail(p)">
                    {{ state.busy() ? 'Création…' : 'Créer l’accès' }}
                  </button>
                </td>
              </tr>
            }
          } @empty {
            <tr>
              <td colspan="10" class="empty">
                Aucun tiers ne correspond à cette recherche.
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <erp-pagination
      [page]="page()"
      [totalPages]="totalPages()"
      [total]="total()"
      libelle="tiers"
      (allerA)="allerA($event)"
    />
  `,
})
export class PartnersComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly rows = signal<Partner[]>([]);

  /**
   * Page demandée au serveur.
   *
   * ⚠️ L'ÉCRAN LISAIT LA PAGE 1 ET N'EN SORTAIT JAMAIS.
   *
   *    L'API est paginée depuis l'origine — cinquante lignes par page — mais
   *    aucune commande n'était affichée et le total n'était pas lu. Au-delà de
   *    la cinquantième ligne, les données existaient et restaient invisibles,
   *    sans compteur ni message pour le dire.
   */
  protected readonly page = signal(1);
  protected readonly totalPages = signal(1);

  protected allerA(p: number): void {
    this.page.set(p);
    this.load();
  }

  protected readonly total = signal(0);
  protected search = '';

  private debounce?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.load();
  }

  /** Anti-rebond : sans lui, chaque frappe déclenche une requête. */
  protected onSearch(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.load(), 300);
  }

  protected typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  protected segmentLabel(segment: string): string {
    return SEGMENT_LABELS[segment] ?? segment;
  }

  private load(): void {
    this.api.partners(this.page(), this.search.trim() || undefined).subscribe((page) => {
      this.rows.set(page.items);
      this.total.set(page.total);
      this.totalPages.set(page.totalPages);
    });
  }

  // --- Accès portail : créés par un commercial depuis la fiche du tiers,
  // jamais par le client lui-même (§ discussion accès des utilisateurs). ---

  protected readonly state = new ActionState();
  protected readonly portailOuvert = signal<string | null>(null);
  protected readonly portailComptes = signal<PortalUserAdminRow[]>([]);

  protected puEmail = '';
  protected puFullName = '';
  protected puPassword = '';

  protected readonly reinitOuvert = signal<string | null>(null);
  protected nouveauMdp = '';

  protected basculerPortail(p: Partner): void {
    if (this.portailOuvert() === p.id) {
      this.portailOuvert.set(null);
      return;
    }
    this.portailOuvert.set(p.id);
    this.reinitOuvert.set(null);
    this.rechargerPortail(p.id);
  }

  private rechargerPortail(partnerId: string): void {
    this.api.portalUsers(partnerId).subscribe((rows) => this.portailComptes.set(rows));
  }

  protected creerPortail(p: Partner): void {
    if (this.state.busy()) return;
    if (!this.puEmail.trim() || !this.puFullName.trim() || this.puPassword.trim().length < 12) {
      this.state.error.set('Adresse, nom et mot de passe (12 caractères minimum) sont requis.');
      return;
    }
    this.state.start();
    this.api
      .createPortalUser(p.id, {
        email: this.puEmail.trim(),
        fullName: this.puFullName.trim(),
        password: this.puPassword,
      })
      .subscribe({
        next: () => {
          this.state.succeed('Accès créé.');
          this.puEmail = '';
          this.puFullName = '';
          this.puPassword = '';
          this.rechargerPortail(p.id);
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }

  protected basculerActifPortail(p: Partner, u: PortalUserAdminRow): void {
    this.api.updatePortalUser(p.id, u.id, { isActive: !u.isActive }).subscribe({
      next: () => this.rechargerPortail(p.id),
      error: (e: HttpFailure) => this.state.error.set(failureMessage(e, 'Changement d’état refusé.')),
    });
  }

  protected ouvrirReinitPortail(u: PortalUserAdminRow): void {
    this.nouveauMdp = '';
    this.reinitOuvert.set(this.reinitOuvert() === u.id ? null : u.id);
  }

  protected reinitPortail(p: Partner, u: PortalUserAdminRow): void {
    if (this.nouveauMdp.trim().length < 12) {
      this.state.error.set('Mot de passe provisoire de 12 caractères minimum.');
      return;
    }
    this.api.resetPortalUserPassword(p.id, u.id, this.nouveauMdp).subscribe({
      next: () => {
        this.state.succeed('Mot de passe réinitialisé.');
        this.reinitOuvert.set(null);
      },
      error: (e: HttpFailure) => this.state.error.set(failureMessage(e, 'Réinitialisation refusée.')),
    });
  }

  protected readonly dateOnly = dateOnly;
}
