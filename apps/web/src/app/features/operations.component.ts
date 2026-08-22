import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, OperationDetail, OperationRow, SupplierInvoiceRow } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import {
  ActionFeedbackComponent,
  ActionState,
  HttpFailure,
} from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';
import { PaginationComponent } from '../shared/tableau';
import { grouper } from '../shared/format';
import { StatusBadgeComponent, StatusKind } from '../shared/status-badge.component';
import { OperationActionsComponent } from './operation-actions.component';

const OP_STATUS: Record<string, { label: string; kind: StatusKind }> = {
  DRAFT: { label: 'Brouillon', kind: 'neutral' },
  SOURCING: { label: 'Sourcing', kind: 'wait' },
  HSE_PREPARATION: { label: 'Préparation HSE', kind: 'wait' },
  HSE_BLOCKED: { label: 'Bloquée HSE', kind: 'blocked' },
  PLANNED: { label: 'Planifiée', kind: 'wait' },
  LOADING: { label: 'Chargement', kind: 'transit' },
  IN_TRANSIT: { label: 'En transit', kind: 'transit' },
  DELIVERING: { label: 'Livraison', kind: 'transit' },
  FINAL_CHECK: { label: 'Contrôle final', kind: 'wait' },
  CLOSED: { label: 'Clôturée', kind: 'ok' },
  INCIDENT: { label: 'Incident', kind: 'blocked' },
  CANCELLED: { label: 'Annulée', kind: 'neutral' },
};

const TRANSPORT: Record<string, string> = {
  TRUCK: 'Camion',
  VESSEL: 'Navire',
  BARGE: 'Barge',
  PIPELINE: 'Pipeline',
  RAIL: 'Rail',
};

export function opStatus(code: string): { label: string; kind: StatusKind } {
  return OP_STATUS[code] ?? { label: code, kind: 'neutral' };
}

const FILTERS: { label: string; status?: string }[] = [
  { label: 'Toutes' },
  { label: 'À préparer', status: 'DRAFT' },
  { label: 'En transit', status: 'IN_TRANSIT' },
  { label: 'Clôturées', status: 'CLOSED' },
];

/**
 * Liste des opérations.
 *
 * Ce que le coordinateur logistique cherche d'abord : où en est le camion, et
 * qu'est-ce qui bloque. Le moyen affecté et la destination viennent donc avant
 * les compteurs, et l'état ferme la ligne.
 */
@Component({
  selector: 'erp-operations',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, StatusBadgeComponent, PaginationComponent],
  template: `
    <header class="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="page-title">Opérations</h1>
        <p class="page-sub">Exécution physique : moyens, contrôles HSE et relevés</p>
      </div>
      <!-- Proposée aux seuls rôles que le serveur laissera créer : un bouton
           qui renvoie sur le tableau de bord sans rien dire est pire qu'un
           bouton absent. L'autorisation réelle reste celle du serveur. -->
      @if (canCreate()) {
        <a routerLink="/operations/nouvelle" class="btn-primary shrink-0">
          <erp-icon name="plus" [size]="14" />
          Nouvelle opération
        </a>
      }
    </header>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      @for (f of filters; track f.label) {
        <button
          type="button"
          class="rounded-[3px] px-2.5 py-1 text-[12px] font-medium transition-colors"
          [class]="
            active() === (f.status ?? '')
              ? 'bg-primary text-white'
              : 'border border-rule-strong bg-surface text-ink-soft hover:bg-gray-100 hover:text-ink'
          "
          (click)="setFilter(f.status)"
        >
          {{ f.label }}
        </button>
      }

      <div class="relative ml-auto w-full max-w-xs">
        <erp-icon
          name="search"
          [size]="14"
          class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
        />
        <input
          class="field pl-8"
          placeholder="Rechercher une opération…"
          aria-label="Rechercher une opération"
          [(ngModel)]="search"
          (ngModelChange)="onSearch()"
        />
      </div>
    </div>

    <div class="card overflow-x-auto">
      <table class="table">
        <thead>
          <tr>
            <th>Référence</th>
            <th>Affaire</th>
            <th>Client</th>
            <th>Destination</th>
            <th>Moyen</th>
            <th class="num">Volume</th>
            <th class="num">Chargement</th>
            <th>État</th>
          </tr>
        </thead>
        <tbody>
          @for (o of rows(); track o.id) {
            <tr [class]="rowClass(o)">
              <td>
                <a [routerLink]="['/operations', o.id]" class="ref hover:underline">{{
                  o.reference
                }}</a>
              </td>
              <td class="font-mono text-[12px] text-ink-muted">{{ o.deal.reference }}</td>
              <td class="font-medium text-ink">{{ o.deal.client.legalName }}</td>
              <td class="text-ink-soft">{{ o.destinationLocation }}</td>
              <td class="text-ink-soft">
                <span class="text-[11px] uppercase tracking-[0.05em] text-ink-faint">{{
                  transport(o.transportMode)
                }}</span>
                <span class="ml-1.5 font-mono text-[12px]">{{ means(o) }}</span>
              </td>
              <td class="num font-mono text-ink-soft">{{ volume(o) }}</td>
              <td class="num font-mono text-ink-soft">{{ o.plannedLoadingDate?.slice(0, 10) ?? '-' }}</td>
              <td>
                <erp-status-badge [kind]="status(o.status).kind" [label]="status(o.status).label" />
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="8" class="empty">Aucune opération ne correspond à ce filtre.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <erp-pagination
      [page]="page()"
      [totalPages]="totalPages()"
      [total]="total()"
      libelle="opérations"
      (allerA)="allerA($event)"
    />
  `,
})
export class OperationsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  protected readonly rows = signal<OperationRow[]>([]);

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
  protected readonly total = signal(0);
  protected readonly totalPages = signal(1);

  protected allerA(p: number): void {
    this.page.set(p);
    this.load();
  }

  protected readonly active = signal('');
  protected readonly filters = FILTERS;
  protected search = '';

  private debounce?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.load();
  }

  /** Miroir des rôles admis par le contrôleur pour la création (§ 7.1). */
  protected canCreate(): boolean {
    return this.auth.hasRole('LOGISTICS_COORD', 'CCOO');
  }

  protected setFilter(status?: string): void {
    this.active.set(status ?? '');
    this.load();
  }

  protected onSearch(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.load(), 300);
  }

  protected status(code: string) {
    return opStatus(code);
  }

  protected transport(code: string): string {
    return TRANSPORT[code] ?? code;
  }

  /** Un ou plusieurs véhicules (§ 22/08/2026) — joints, pas un compte : c'est l'immatriculation qui identifie le camion au dépôt. */
  protected means(o: OperationRow): string {
    if (o.assignments.length === 0) return 'non affecté';
    return o.assignments.map((a) => a.vehicle?.registration ?? a.vehicleIdentifier ?? '?').join(', ');
  }

  protected volume(o: OperationRow): string {
    return `${grouper(Number(o.plannedVolume), { maximumFractionDigits: 0 })} ${o.uom}`;
  }

  protected rowClass(o: OperationRow): string {
    if (o.status === 'HSE_BLOCKED' || o.status === 'INCIDENT') return 'row-crit';
    if (o.assignments.length === 0) return 'row-warn';
    return '';
  }

  private load(): void {
    this.api
      .operations(this.page(), {
        status: this.active() || undefined,
        search: this.search.trim() || undefined,
      })
      .subscribe((page) => {
        this.rows.set(page.items);
        this.total.set(page.total);
        this.totalPages.set(page.totalPages);
      });
  }
}

/**
 * Détail d'une opération.
 *
 * Le verrou HSE est la première chose affichée. C'est lui qui décide si
 * l'opération avance, et un utilisateur qui ne comprend pas pourquoi le
 * chargement est refusé perd un temps considérable à chercher ailleurs.
 */
@Component({
  selector: 'erp-operation-detail',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    IconComponent,
    StatusBadgeComponent,
    ActionFeedbackComponent,
    OperationActionsComponent,
  ],
  template: `
    @if (operation(); as o) {
      <nav class="mb-3 flex items-center gap-1.5 text-[12px] text-ink-muted">
        <a routerLink="/operations" class="link">Opérations</a>
        <erp-icon name="chevron-right" [size]="12" />
        <span class="font-mono text-ink">{{ o.reference }}</span>
      </nav>

      <header class="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="page-title">{{ o.deal.client.legalName }}</h1>
          <p class="page-sub">
            {{ o.deal.product.name }} · {{ volume(o) }} · vers {{ o.destinationLocation }}
          </p>
        </div>
        <erp-status-badge [kind]="status(o.status).kind" [label]="status(o.status).label" />
      </header>

      <!-- ============ Verrou HSE ============ -->
      <section class="card mb-5" [class]="o.hseGate.open ? 'border-ok/35' : 'border-crit/35'">
        <div class="flex items-start gap-2.5 px-4 py-3">
          <erp-icon
            [name]="o.hseGate.open ? 'check-circle' : 'lock'"
            [size]="16"
            [class]="o.hseGate.open ? 'text-ok' : 'text-crit'"
          />
          <div class="min-w-0 flex-1">
            <p class="text-[13px] font-semibold" [class]="o.hseGate.open ? 'text-ok' : 'text-crit'">
              {{ o.hseGate.open ? 'Verrou HSE ouvert' : 'Verrou HSE fermé' }}
            </p>
            <p class="mt-0.5 text-[13px] text-ink-soft">{{ o.hseGate.message }}</p>
            @if (o.hseGate.byDerogation) {
              <p class="mt-1 text-[12px] text-warn-ink">
                Ouvert par dérogation du DG, et non par validation des contrôles.
              </p>
            }
          </div>
          <dl class="hidden shrink-0 gap-6 sm:flex">
            <div class="text-right">
              <dt class="text-[11px] uppercase tracking-[0.06em] text-ink-muted">Checklists</dt>
              <dd class="tabular mt-0.5 font-mono text-[17px] font-semibold text-ink">
                {{ o._count.hseChecks }}
              </dd>
            </div>
            <div class="text-right">
              <dt class="text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                Bloquants ouverts
              </dt>
              <dd
                class="tabular mt-0.5 font-mono text-[17px] font-semibold"
                [class]="o.hseGate.pendingBlockingItems > 0 ? 'text-crit' : 'text-ok'"
              >
                {{ o.hseGate.pendingBlockingItems }}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <!-- ============ Types portés, DANS L'ORDRE DU DÉROULÉ ============ -->
      <section class="card mb-5 overflow-hidden">
        <div class="card-header">
          <h2 class="card-title">Déroulé de l’opération</h2>
          <span class="text-[11px] text-ink-faint">{{ o.operationTypes.length }} type(s)</span>
        </div>
        <ol class="divide-y divide-rule">
          @for (t of o.operationTypes; track t.operationType.id) {
            <li class="flex items-start gap-2.5 px-4 py-2.5">
              <span
                class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px]
                       bg-primary font-mono text-[11px] font-semibold text-white"
              >
                {{ t.sequence }}
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-[13px]">
                  <span class="font-mono text-[12px] text-ink-muted">{{ t.operationType.code }}</span>
                  <span class="ml-1.5 font-medium text-ink">{{ t.operationType.label }}</span>
                </p>
                @if (t.operationType.description) {
                  <p class="mt-0.5 text-[11px] leading-snug text-ink-faint">
                    {{ t.operationType.description }}
                  </p>
                }
              </div>
            </li>
          } @empty {
            <li class="empty px-4 py-3 text-[13px]">
              Aucun type porté. Les contrôles HSE étant indexés par le type, aucun ne s’oppose
              à cette opération, et elle ne pourra pas avancer.
            </li>
          }
        </ol>
        <p class="border-t border-rule px-4 py-2.5 text-[11px] leading-relaxed text-ink-faint">
          Le rang est celui annoncé à la création : c’est l’ordre réel des étapes. Les contrôles
          HSE de l’opération sont l’union dédoublonnée des checklists de tous ces types.
        </p>
      </section>

      <erp-operation-actions
        class="mb-5 block"
        [operation]="o"
        [gate]="o.hseGate"
        [measurements]="o.measurements ?? []"
        (changed)="reload()"
      />

      <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section class="card overflow-hidden">
          <div class="card-header"><h2 class="card-title">Acheminement</h2></div>
          <dl class="divide-y divide-rule text-[13px]">
            <div class="flex justify-between gap-4 px-4 py-2">
              <dt class="text-ink-muted">Affaire</dt>
              <dd class="font-mono text-ink">{{ o.deal.reference }}</dd>
            </div>
            <div class="flex justify-between gap-4 px-4 py-2">
              <dt class="text-ink-muted">Mode</dt>
              <dd class="text-ink">{{ transport(o.transportMode) }}</dd>
            </div>
            <div class="flex justify-between gap-4 px-4 py-2">
              <dt class="text-ink-muted">Moyen(s) affecté(s)</dt>
              <dd class="text-right">
                @if (o.assignments.length > 0) {
                  <span class="font-mono text-ink">{{ means(o) }}</span>
                } @else {
                  <erp-status-badge kind="wait" label="Non affecté" />
                }
              </dd>
            </div>
            <div class="flex justify-between gap-4 px-4 py-2">
              <dt class="text-ink-muted">Agent terrain</dt>
              <dd class="text-ink">{{ o.fieldAgent?.fullName ?? '-' }}</dd>
            </div>
            <div class="flex justify-between gap-4 px-4 py-2">
              <dt class="text-ink-muted">Chargement prévu</dt>
              <dd class="font-mono text-ink-soft">
                {{ o.plannedLoadingDate?.slice(0, 10) ?? '-' }}
              </dd>
            </div>
          </dl>
        </section>

        <section class="card overflow-hidden">
          <div class="card-header"><h2 class="card-title">Suivi</h2></div>
          <dl class="divide-y divide-rule text-[13px]">
            <div class="flex justify-between gap-4 px-4 py-2">
              <dt class="text-ink-muted">Relevés de mesure</dt>
              <dd class="font-mono text-ink">{{ o._count.measurements }}</dd>
            </div>
            <div class="flex justify-between gap-4 px-4 py-2">
              <dt class="text-ink-muted">Lignes de coût</dt>
              <dd class="font-mono text-ink">{{ o._count.costLines }}</dd>
            </div>
          </dl>
          <p class="border-t border-rule px-4 py-2.5 text-[11px] leading-relaxed text-ink-faint">
            L’écart de volume relevé est un contrôle opérationnel et HSE. Il alerte et ouvre une
            enquête au seuil critique, mais il ne retient jamais une facture : le volume facturé
            est saisi à l’édition de la pièce.
          </p>
        </section>
      </div>

      <!-- ============ Lignes de coût et rapprochement fournisseur ============
           ⚠️ CORRIGÉ — o.costLines était servi par le serveur depuis
              toujours, et rien ne l'affichait : la fiche ne montrait qu'un
              compte. Le rattachement à la facture fournisseur (§ 14.6) n'avait
              donc, en pratique, aucun geste pour l'exercer. -->
      @if (o.costLines.length > 0) {
        <section class="card mt-5 overflow-hidden">
          <div class="card-header"><h2 class="card-title">Lignes de coût</h2></div>
          <erp-action-feedback [error]="costState.error()" [success]="costState.done()" />
          <div class="overflow-x-auto">
            <table class="table">
              <thead>
                <tr>
                  <th>Poste</th>
                  <th>Fournisseur</th>
                  <th class="num">Montant</th>
                  <th>Facture fournisseur</th>
                </tr>
              </thead>
              <tbody>
                @for (l of o.costLines; track l.id) {
                  <tr>
                    <td>
                      <span class="text-ink">{{ l.costPost.label }}</span>
                      @if (l.description) {
                        <p class="mt-0.5 text-[11px] text-ink-faint">{{ l.description }}</p>
                      }
                      @if (l.isSystemComputed) {
                        <span class="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-ink-faint">
                          calculée
                        </span>
                      }
                    </td>
                    <td class="text-ink-soft">{{ l.supplier?.legalName ?? '-' }}</td>
                    <td class="num font-mono text-ink-soft">
                      {{ money(+(l.actualAmount ?? l.estimatedAmount)) }}
                      <span class="ml-1 text-[11px] text-ink-faint">{{ l.currencyCode }}</span>
                    </td>
                    <td>
                      @if (l.supplierInvoiceId) {
                        <span class="flex items-center gap-1 text-[12px] font-medium text-ok">
                          <erp-icon name="check-circle" [size]="13" />
                          {{ factureLabel(l.supplierInvoiceId) }}
                        </span>
                      } @else if (!l.supplierId) {
                        <span class="text-[11px] text-ink-faint">aucun fournisseur sur la ligne</span>
                      } @else if (candidates(l).length === 0) {
                        <span class="text-[11px] text-ink-faint">
                          aucune facture non rattachée pour ce fournisseur
                        </span>
                      } @else if (!peutRattacher()) {
                        <span class="text-[11px] text-ink-faint">DAF ou comptable seuls</span>
                      } @else {
                        <div class="flex items-center gap-1.5">
                          <select class="field h-8 py-0 text-[12px]" [(ngModel)]="attachChoice[l.id]">
                            <option value="">Choisir…</option>
                            @for (inv of candidates(l); track inv.id) {
                              <option [value]="inv.id">{{ inv.reference }} · {{ money(+inv.amount) }} {{ inv.currencyCode }}</option>
                            }
                          </select>
                          <button
                            type="button"
                            class="btn-ghost px-2 py-1 text-[12px]"
                            [disabled]="costState.busy() || !attachChoice[l.id]"
                            (click)="attacher(l.id)"
                          >
                            Rattacher
                          </button>
                        </div>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="border-t border-rule px-4 py-2.5 text-[11px] leading-relaxed text-ink-faint">
            Un coût réel rattaché à sa facture fournisseur est le rapprochement le plus solide dont
            dispose l’entreprise : il ne repose sur aucune déclaration, seulement sur la
            confrontation de deux enregistrements indépendants.
          </p>
        </section>
      }
    } @else {
      <p class="empty">Chargement de l’opération…</p>
    }
  `,
})
export class OperationDetailComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);

  protected readonly operation = signal<OperationDetail | null>(null);

  // --- Rattachement des coûts aux factures fournisseurs (§ 14.6) -----------
  protected readonly costState = new ActionState();
  /** Factures NON RATTACHÉES de l'affaire — candidates au rattachement. */
  private readonly invoicesLibres = signal<SupplierInvoiceRow[]>([]);
  /** Toutes les factures de l'affaire — pour AFFICHER la référence d'un rattachement déjà fait. */
  private readonly invoicesToutes = signal<SupplierInvoiceRow[]>([]);
  /** Choix en cours, par ligne de coût — l'écran ne soumet rien tant qu'on n'a pas cliqué. */
  protected readonly attachChoice: Record<string, string> = {};

  ngOnInit(): void {
    this.reload();
  }

  /** Après toute action, on relit : le verrou HSE a pu changer d'état. */
  protected reload(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.api.operation(id).subscribe((o) => {
      this.operation.set(o);
      this.api.supplierInvoices(1, { dealId: o.deal.id }).subscribe((p) => {
        this.invoicesToutes.set(p.items);
        this.invoicesLibres.set(
          p.items.filter((inv) => !o.costLines.some((l) => l.supplierInvoiceId === inv.id)),
        );
      });
    });
  }

  /** Factures non rattachées, du MÊME fournisseur que la ligne. */
  protected candidates(l: OperationDetail['costLines'][number]): SupplierInvoiceRow[] {
    return this.invoicesLibres().filter((inv) => inv.supplier.code === l.supplier?.code);
  }

  protected factureLabel(invoiceId: string): string {
    return this.invoicesToutes().find((inv) => inv.id === invoiceId)?.reference ?? invoiceId;
  }

  /** Le rattachement est réservé au DAF et au comptable — vérifié en base de toute façon. */
  protected peutRattacher(): boolean {
    return this.auth.hasRole('FINANCE_CFO', 'ACCOUNTANT');
  }

  protected attacher(costLineId: string): void {
    const invoiceId = this.attachChoice[costLineId];
    if (!invoiceId || this.costState.busy()) return;
    this.costState.start();
    this.api.attachCostLine(invoiceId, costLineId).subscribe({
      next: () => {
        this.costState.succeed('Ligne de coût rattachée à la facture fournisseur.');
        delete this.attachChoice[costLineId];
        this.reload();
      },
      error: (e: HttpFailure) => this.costState.fail(e),
    });
  }

  protected status(code: string) {
    return opStatus(code);
  }

  protected transport(code: string): string {
    return TRANSPORT[code] ?? code;
  }

  protected means(o: OperationRow): string {
    if (o.assignments.length === 0) return '-';
    return o.assignments.map((a) => a.vehicle?.registration ?? a.vehicleIdentifier ?? '?').join(', ');
  }

  protected volume(o: OperationRow): string {
    return `${grouper(Number(o.plannedVolume), { maximumFractionDigits: 0 })} ${o.uom}`;
  }

  protected money(value: number): string {
    if (!Number.isFinite(value)) return '-';
    return grouper(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
