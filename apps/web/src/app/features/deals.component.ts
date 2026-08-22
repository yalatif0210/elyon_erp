import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, DealDetail, DealRow } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { IconComponent } from '../shared/icon.component';
import { PaginationComponent, TableauControlesComponent, TableauPagine } from '../shared/tableau';
import { grouper } from '../shared/format';
import { StatusBadgeComponent, StatusKind } from '../shared/status-badge.component';
import { DealSupplierPriceComponent } from './deal-supplier-price.component';
import { DealCostingComponent } from './deal-costing.component';
import { DealApprovalComponent } from './deal-approval.component';

/** Statuts d'affaire — libellé métier, et non le jeton technique. */
const DEAL_STATUS: Record<string, { label: string; kind: StatusKind }> = {
  DRAFT: { label: 'Brouillon', kind: 'neutral' },
  FEASIBILITY_STUDY: { label: 'Étude de faisabilité', kind: 'wait' },
  QUOTED: { label: 'Chiffrée', kind: 'neutral' },
  PENDING_RISK: { label: 'Contrôle du risque', kind: 'wait' },
  CREDIT_BLOCKED: { label: 'Bloquée pour crédit', kind: 'blocked' },
  PENDING_DG_APPROVAL: { label: 'Accord DG attendu', kind: 'blocked' },
  APPROVED: { label: 'Approuvée', kind: 'ok' },
  PROFORMA_SENT: { label: 'Proforma envoyée', kind: 'wait' },
  CUSTOMER_ACCEPTED: { label: 'Acceptée par le client', kind: 'ok' },
  REJECTED_BY_CLIENT: { label: 'Refusée par le client', kind: 'blocked' },
  IN_EXECUTION: { label: 'En exécution', kind: 'transit' },
  DELIVERED: { label: 'Livrée', kind: 'ok' },
  PARTIALLY_DELIVERED: { label: 'Partiellement livrée', kind: 'transit' },
  QUALITY_CLAIM: { label: 'Réclamation qualité', kind: 'blocked' },
  INVOICED: { label: 'Facturée', kind: 'ok' },
  DISPUTED: { label: 'Litige', kind: 'blocked' },
  CLOSED: { label: 'Clôturée', kind: 'neutral' },
  CANCELLED: { label: 'Annulée', kind: 'neutral' },
};

const FILTERS: { label: string; status?: string }[] = [
  { label: 'Toutes' },
  { label: 'Accord DG attendu', status: 'PENDING_DG_APPROVAL' },
  { label: 'Approuvées', status: 'APPROVED' },
  { label: 'En exécution', status: 'IN_EXECUTION' },
];

export function dealStatus(code: string): { label: string; kind: StatusKind } {
  return DEAL_STATUS[code] ?? { label: code, kind: 'neutral' };
}

/**
 * Liste des affaires.
 *
 * La marge complète est la colonne qui décide : c'est sur elle que porte le
 * seuil, et c'est elle qu'on vient lire. Elle est donc à droite, en chiffres
 * tabulaires, avec un liseré de sévérité sur les lignes qui appellent une
 * décision — pas noyée au milieu de colonnes descriptives.
 */
@Component({
  selector: 'erp-deals',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, StatusBadgeComponent, PaginationComponent],
  template: `
    <header class="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 class="page-title">Affaires</h1>
        <p class="page-sub">Du chiffrage à la facturation : marge et seuils</p>
      </div>
      @if (auth.hasRole('SALES_REP', 'CCOO')) {
        <a routerLink="/affaires/nouvelle" class="btn-primary">
          <erp-icon name="plus" [size]="14" />
          Nouvelle affaire
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
          placeholder="Rechercher une référence…"
          aria-label="Rechercher une affaire"
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
            <th>Client</th>
            <th>Produit</th>
            <th class="num">Volume</th>
            <th class="num">Prix vente</th>
            <th class="num">Marge directe</th>
            <th class="num">Marge complète</th>
            <th>Chargé d’affaire</th>
            <th>État</th>
          </tr>
        </thead>
        <tbody>
          @for (d of rows(); track d.id) {
            <tr [class]="rowClass(d)">
              <td>
                <a [routerLink]="['/affaires', d.id]" class="ref hover:underline">{{
                  d.reference
                }}</a>
              </td>
              <td class="font-medium text-ink">{{ d.client.legalName }}</td>
              <td class="text-ink-soft">{{ d.product.name }}</td>
              <td class="num font-mono text-ink-soft">{{ volume(d) }}</td>
              <td class="num font-mono text-ink-soft">{{ money(d.unitSalePrice) }}</td>
              <td class="num font-mono" [class]="marginClass(d.estimatedDirectMargin)">
                {{ perUnit(d, d.estimatedDirectMargin) }}
              </td>
              <td class="num font-mono font-semibold" [class]="marginClass(d.estimatedFullMargin)">
                {{ perUnit(d, d.estimatedFullMargin) }}
              </td>
              <td class="text-ink-soft">{{ d.owner?.fullName ?? '-' }}</td>
              <td>
                <erp-status-badge [kind]="status(d.status).kind" [label]="status(d.status).label" />
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="9" class="empty">Aucune affaire ne correspond à ce filtre.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <erp-pagination [page]="page()" [totalPages]="totalPages()" [total]="total()"
                    libelle="affaires" (allerA)="allerA($event)" />

    <p class="mt-3 text-[11px] text-ink-faint">
      Les marges sont exprimées par unité, dans la devise de l’affaire. Elles sont recalculées
      à chaque consultation, jamais reconstituées par le navigateur.
    </p>
  `,
})
export class DealsComponent implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);

  protected readonly rows = signal<DealRow[]>([]);

  /**
   * Page demandée au serveur.
   *
   * L'écran lisait la page 1 et n'en sortait jamais : au-delà de la
   * cinquantième affaire, les lignes existaient sans s'afficher nulle part.
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

  protected setFilter(status?: string): void {
    this.active.set(status ?? '');
    this.load();
  }

  /** Anti-rebond : sans lui, chaque frappe déclenche une requête. */
  protected onSearch(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.load(), 300);
  }

  protected status(code: string) {
    return dealStatus(code);
  }

  protected volume(d: DealRow): string {
    return `${formatNumber(Number(d.contractedVolume), 0)} ${d.uom}`;
  }

  protected money(value: string): string {
    return formatNumber(Number(value), 2);
  }

  /** Les montants stockés sont totaux ; la décision se prend à l'unité. */
  protected perUnit(d: DealRow, total: string): string {
    const volume = Number(d.contractedVolume);
    if (volume <= 0) return '-';
    return formatNumber(Number(total) / volume, 2);
  }

  /**
   * Les comparaisons vivent dans le composant, jamais dans l'interpolation :
   * le parseur de template lit « < » comme une ouverture de balise.
   */
  protected marginClass(total: string): string {
    return Number(total) < 0 ? 'text-crit' : 'text-ink';
  }

  /** Liseré de sévérité : la forme double la teinte (§ 17.2). */
  protected rowClass(d: DealRow): string {
    if (Number(d.estimatedFullMargin) < 0) return 'row-crit';
    if (d.status === 'PENDING_DG_APPROVAL') return 'row-warn';
    return '';
  }

  private load(): void {
    this.api
      .deals(this.page(), {
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

const INVOICE_TYPE_LABEL: Record<string, string> = {
  PROFORMA: 'Proforma',
  SIMPLE: 'Facture simple',
  FNE: 'Facture normalisée (FNE)',
  CREDIT_NOTE: 'Avoir',
};

/**
 * Détail d'une affaire.
 *
 * L'écran est bâti autour d'une seule question : cette marge tient-elle ses
 * seuils ? La cascade de marge est donc posée comme un calcul lisible ligne à
 * ligne, et non comme une grappe d'indicateurs dont on ne voit pas le lien.
 */
@Component({
  selector: 'erp-deal-detail',
  standalone: true,
  imports: [
    RouterLink,
    IconComponent,
    StatusBadgeComponent,
    DealSupplierPriceComponent,
    DealCostingComponent,
    DealApprovalComponent,
    TableauControlesComponent,
  ],
  template: `
    @if (deal(); as d) {
      <nav class="mb-3 flex items-center gap-1.5 text-[12px] text-ink-muted">
        <a routerLink="/affaires" class="link">Affaires</a>
        <erp-icon name="chevron-right" [size]="12" />
        <span class="font-mono text-ink">{{ d.reference }}</span>
      </nav>

      <header class="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="page-title">{{ d.client.legalName }}</h1>
          <p class="page-sub">
            {{ d.product.name }} · {{ volume(d) }} · livraison {{ d.deliveryLocation }}
            @if (d.contract) {
              · contrat-cadre <span class="font-mono">{{ d.contract.reference }}</span>
            }
          </p>
        </div>
        <erp-status-badge [kind]="status(d.status).kind" [label]="status(d.status).label" />
      </header>

      <!-- Verdict des seuils : la conclusion avant le détail. -->
      <div class="card mb-5" [class]="verdictBorder(d)">
        <div class="flex items-start gap-2.5 px-4 py-3">
          <erp-icon [name]="verdictIcon(d)" [size]="16" [class]="verdictTone(d)" />
          <div class="min-w-0">
            <p class="text-[13px] font-semibold" [class]="verdictTone(d)">{{ verdictTitle(d) }}</p>
            <p class="mt-0.5 text-[13px] text-ink-soft">{{ d.thresholds.message }}</p>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_1fr]">
        <!-- ============ Cascade de marge ============ -->
        <section class="card overflow-hidden">
          <div class="card-header">
            <h2 class="card-title">Chaîne de marge</h2>
            <span class="text-[11px] text-ink-faint">
              par {{ d.uom }} · {{ d.currencyCode }}
            </span>
          </div>
          <table class="table">
            <tbody>
              <tr>
                <td class="text-ink">Prix de vente</td>
                <td class="num font-mono text-ink">{{ n(d.margin.unitSalePrice) }}</td>
              </tr>
              <tr>
                <td class="text-ink-soft">− Prix d’achat</td>
                <td class="num font-mono text-ink-soft">−{{ n(d.margin.unitPurchasePrice) }}</td>
              </tr>
              <tr>
                <td class="text-ink-soft">
                  − Charges directes
                  <span class="ml-1 text-[11px] text-ink-faint">
                    {{ d.margin.chargesFromOperations ? 'constatées' : 'estimation du devis' }}
                  </span>
                </td>
                <td class="num font-mono text-ink-soft">−{{ n(d.margin.directChargesPerUnit) }}</td>
              </tr>
              <tr>
                <td class="text-ink-soft">
                  − Portage financier
                  <span class="ml-1 text-[11px] text-ink-faint">
                    {{ d.margin.carryingCycleDays }} j à {{ n(d.margin.financingRatePct) }} %
                  </span>
                </td>
                <td class="num font-mono text-ink-soft">−{{ n(d.margin.carryingCostPerUnit) }}</td>
              </tr>
              <tr class="bg-gray-100">
                <td class="font-semibold text-ink">
                  = Marge directe
                  @if (d.thresholds.directFloor !== null) {
                    <span class="ml-1 text-[11px] font-normal text-ink-muted">
                      plancher {{ n(d.thresholds.directFloor) }}
                    </span>
                  }
                </td>
                <td
                  class="num font-mono font-semibold"
                  [class]="d.thresholds.belowDirectFloor ? 'text-crit' : 'text-ink'"
                >
                  {{ n(d.margin.directMargin) }}
                </td>
              </tr>
              <tr>
                <td class="text-ink-soft">− Charges indirectes absorbées</td>
                <td class="num font-mono text-ink-soft">
                  −{{ n(d.margin.indirectChargesPerUnit) }}
                </td>
              </tr>
              <tr class="bg-gray-100">
                <td class="font-semibold text-ink">
                  = Marge complète
                  @if (d.thresholds.minimumMargin !== null) {
                    <span class="ml-1 text-[11px] font-normal text-ink-muted">
                      seuil {{ n(d.thresholds.minimumMargin) }}
                    </span>
                  }
                </td>
                <td
                  class="num font-mono text-[15px] font-semibold"
                  [class]="d.thresholds.belowMinimumMargin ? 'text-crit' : 'text-ok'"
                >
                  {{ n(d.margin.fullMargin) }}
                </td>
              </tr>
            </tbody>
          </table>
          <p class="border-t border-rule px-[15px] py-2.5 text-[11px] leading-relaxed text-ink-faint">
            Le plancher direct sanctionne une opération qui ne couvre pas ses propres coûts :
            il bloque, et seule une dérogation du DG le lève. Le seuil de marge complète, lui,
            n’est pas un refus : il appelle l’accord du DG.
          </p>
        </section>

        <div class="flex flex-col gap-5">
          <!-- Ordre de la fiche affaire (§ discussion 15/08) :
               Client/Produit/Volume (en-tête, ci-dessus) → Fournisseur et
               prix d'achat → Chiffrage des coûts → Circuit d'approbation. -->
          <erp-deal-supplier-price [deal]="d" (changed)="reload()" />

          <erp-deal-costing
            [dealId]="d.id"
            [currency]="d.currencyCode"
            [uom]="d.uom"
            [volume]="volumeNumber(d)"
            [lines]="d.costLines ?? []"
            [status]="d.status"
          />

          <erp-deal-approval [deal]="d" (changed)="reload()" />

          <!-- ============ Origine du prix d'achat ============ -->
          <section class="card overflow-hidden">
            <div class="card-header">
              <h2 class="card-title">Origine du prix d’achat</h2>
            </div>
            @if (d.supplierPrice; as sp) {
              <dl class="divide-y divide-rule text-[13px]">
                <div class="flex justify-between gap-4 px-4 py-2">
                  <dt class="text-ink-muted">Fournisseur</dt>
                  <dd class="text-right text-ink">{{ sp.supplier.legalName }}</dd>
                </div>
                <div class="flex justify-between gap-4 px-4 py-2">
                  <dt class="text-ink-muted">Prix retenu</dt>
                  <dd class="text-right font-mono text-ink">
                    {{ money(sp.unitPrice) }} {{ sp.currencyCode }}/{{ sp.uom }}
                  </dd>
                </div>
                <div class="flex justify-between gap-4 px-4 py-2">
                  <dt class="text-ink-muted">En vigueur depuis</dt>
                  <dd class="text-right font-mono text-ink-soft">{{ day(sp.effectiveFrom) }}</dd>
                </div>
                <div class="flex justify-between gap-4 px-4 py-2">
                  <dt class="text-ink-muted">Délai fournisseur</dt>
                  <dd class="text-right font-mono text-ink-soft">
                    {{ termsLabel(sp.supplier.supplierTermsDays) }}
                  </dd>
                </div>
                <div class="flex justify-between gap-4 px-4 py-2">
                  <dt class="text-ink-muted">Validé par</dt>
                  <dd class="text-right text-ink">{{ sp.validatedBy?.fullName ?? '-' }}</dd>
                </div>
              </dl>
              <p class="border-t border-rule px-4 py-2.5 text-[11px] leading-relaxed text-ink-faint">
                Le prix d’achat n’est jamais saisi librement : il provient d’une ligne de prix
                fournisseur validée par le DG. Toute évolution crée une nouvelle ligne et
                retire l’approbation de l’affaire.
              </p>
            } @else {
              <p class="empty">
                Aucun prix fournisseur rattaché.<br />
                L’approbation sera refusée tant que l’achat n’est pas sourcé.
              </p>
            }
          </section>

          <!-- ============ Approbations ============ -->
          <section class="card overflow-hidden">
            <div class="card-header"><h2 class="card-title">Approbations</h2></div>
            <dl class="divide-y divide-rule text-[13px]">
              <div class="flex items-center justify-between gap-4 px-4 py-2">
                <dt class="text-ink-muted">Financière (CFO)</dt>
                <dd class="text-right">
                  @if (d.creditApprovedBy) {
                    <span class="text-ink">{{ d.creditApprovedBy.fullName }}</span>
                  } @else {
                    <erp-status-badge kind="wait" label="En attente" />
                  }
                </dd>
              </div>
              <div class="flex items-center justify-between gap-4 px-4 py-2">
                <dt class="text-ink-muted">Accord du DG</dt>
                <dd class="text-right">
                  @if (d.dgApprovedBy) {
                    <span class="text-ink">{{ d.dgApprovedBy.fullName }}</span>
                  } @else if (d.thresholds.belowMinimumMargin) {
                    <erp-status-badge kind="blocked" label="Requis" />
                  } @else {
                    <span class="text-ink-faint">Non requis</span>
                  }
                </dd>
              </div>
            </dl>
          </section>

          <!-- ============ Opérations ============ -->
          <section class="card overflow-hidden">
            <div class="card-header"><h2 class="card-title">Opérations</h2></div>
            @if (d.operations.length === 0) {
              <p class="empty">
                Aucune opération.<br />
                Le verrou financier interdit toute opération sur une affaire non approuvée.
              </p>
            } @else {
              <erp-tableau-controles [tableau]="tableauOperations" libelle="les opérations" />
              <table class="table">
                <tbody>
                  @for (op of tableauOperations.lignes(); track op.id) {
                    <tr>
                      <td>
                        <a [routerLink]="['/operations', op.id]" class="ref hover:underline">{{
                          op.reference
                        }}</a>
                      </td>
                      <td class="num font-mono text-ink-soft">
                        {{ nf(op.plannedVolume) }} {{ d.uom }}
                      </td>
                      <td class="text-right text-ink-soft">{{ op.status }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </section>

          <!-- ============ Dossier financier ============
               Le dossier d'affaire ne s'arrête pas à l'exécution : proformas,
               factures client (simple/FNE) et avoirs vivent tous dans la même
               table invoices, distingués par leur type, pas de vue séparée
               à synchroniser. Une affaire clôturée reste donc consultable ici
               avec toutes ses pièces, tant que le dossier existe. -->
          <section class="card mt-5 overflow-hidden">
            <div class="card-header"><h2 class="card-title">Facturation client</h2></div>
            @if (d.invoices.length === 0) {
              <p class="empty">Aucune pièce émise pour le moment.</p>
            } @else {
              <erp-tableau-controles [tableau]="tableauInvoices" libelle="les pièces" />
              <table class="table">
                <thead>
                  <tr>
                    <th>Pièce</th>
                    <th>Type</th>
                    <th>Statut</th>
                    <th class="num">Montant</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (inv of tableauInvoices.lignes(); track inv.id) {
                    <tr>
                      <td><span class="ref">{{ inv.number ?? '-' }}</span></td>
                      <td class="text-ink-soft">{{ invoiceTypeLabel(inv.type) }}</td>
                      <td class="text-ink-soft">{{ inv.status }}</td>
                      <td class="num font-mono text-ink-soft">{{ money(inv.totalAmount) }} {{ inv.currencyCode }}</td>
                      <td>
                        @if (inv.generatedDocuments.length > 0) {
                          <button
                            class="btn-ghost !h-7 !px-2.5 text-[12px]"
                            (click)="telechargerDocument(inv.generatedDocuments[0].id, inv.generatedDocuments[0].reference)"
                            [disabled]="telechargement() === inv.generatedDocuments[0].id"
                          >
                            <erp-icon name="file-text" [size]="12" />
                            {{ telechargement() === inv.generatedDocuments[0].id ? '…' : 'PDF' }}
                          </button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </section>

          <!-- Absente pour LOGISTICS_COORD : un prix d'achat visible à côté
               du chiffre d'affaires livrerait la marge par soustraction. -->
          @if (d.supplierInvoices) {
            <section class="card mt-5 overflow-hidden">
              <div class="card-header"><h2 class="card-title">Factures fournisseurs</h2></div>
              @if (d.supplierInvoices.length === 0) {
                <p class="empty">Aucune facture fournisseur rattachée.</p>
              } @else {
                <erp-tableau-controles [tableau]="tableauSupplierInvoices" libelle="les factures" />
                <table class="table">
                  <thead>
                    <tr>
                      <th>Référence</th>
                      <th>Fournisseur</th>
                      <th>Statut</th>
                      <th class="num">Montant</th>
                      <th>Apurée le</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (si of tableauSupplierInvoices.lignes(); track si.id) {
                      <tr>
                        <td><span class="ref">{{ si.reference }}</span></td>
                        <td class="text-ink-soft">{{ si.supplier.legalName }}</td>
                        <td class="text-ink-soft">{{ si.status }}</td>
                        <td class="num font-mono text-ink-soft">{{ money(si.amount) }} {{ si.currencyCode }}</td>
                        <td class="font-mono text-[12px] text-ink-soft">{{ si.settledAt ? day(si.settledAt) : '-' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
              <p class="px-[15px] pb-3 text-[11px] text-ink-faint">
                Pièce scannée : pas encore de dépôt de fichier pour les factures fournisseurs ; la
                référence et le montant sont saisis, l'original reste hors système à ce jour.
              </p>
            </section>
          }
        </div>
      </div>
    } @else {
      <p class="empty">Chargement de l’affaire…</p>
    }
  `,
})
export class DealDetailComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  protected readonly deal = signal<DealDetail | null>(null);
  protected readonly telechargement = signal<string | null>(null);
  protected readonly tableauOperations = new TableauPagine<DealDetail['operations'][number]>();
  protected readonly tableauInvoices = new TableauPagine<DealDetail['invoices'][number]>();
  protected readonly tableauSupplierInvoices = new TableauPagine<
    NonNullable<DealDetail['supplierInvoices']>[number]
  >();

  ngOnInit(): void {
    this.reload();
  }

  /** Après toute action, on relit : la marge et le circuit ont pu bouger. */
  protected reload(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.api.deal(id).subscribe((d) => {
        this.deal.set(d);
        this.tableauOperations.définir(d.operations);
        this.tableauInvoices.définir(d.invoices);
        this.tableauSupplierInvoices.définir(d.supplierInvoices ?? []);
      });
    }
  }

  protected status(code: string) {
    return dealStatus(code);
  }

  protected n(value: number): string {
    return formatNumber(value, 2);
  }

  protected nf(value: string): string {
    return formatNumber(Number(value), 0);
  }

  protected money(value: string): string {
    return formatNumber(Number(value), 2);
  }

  protected day(iso: string): string {
    return iso.slice(0, 10);
  }

  protected invoiceTypeLabel(type: string): string {
    return INVOICE_TYPE_LABEL[type] ?? type;
  }

  protected telechargerDocument(documentId: string, reference: string): void {
    if (this.telechargement()) return;
    this.telechargement.set(documentId);
    this.api.downloadDocument(documentId).subscribe({
      next: (blob) => {
        this.telechargement.set(null);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${reference}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.telechargement.set(null),
    });
  }

  protected volume(d: DealDetail): string {
    return `${formatNumber(Number(d.contractedVolume), 0)} ${d.uom}`;
  }

  /** Le volume contracté sert de diviseur au chiffrage (§ 5.4). */
  protected volumeNumber(d: DealDetail): number {
    return Number(d.contractedVolume);
  }

  /** Un délai négatif signifie un prépaiement : Elyon paie avant livraison. */
  protected termsLabel(days: number): string {
    if (days < 0) return `prépaiement ${Math.abs(days)} j`;
    if (days === 0) return 'comptant';
    return `${days} j`;
  }

  protected verdictTitle(d: DealDetail): string {
    if (!d.thresholds.configured) return 'Aucun seuil configuré';
    if (d.thresholds.belowDirectFloor) return 'Plancher direct franchi';
    if (d.thresholds.belowMinimumMargin) return 'Sous le seuil de marge';
    return 'Marge conforme aux deux seuils';
  }

  protected verdictTone(d: DealDetail): string {
    if (d.thresholds.belowDirectFloor || !d.thresholds.configured) return 'text-crit';
    if (d.thresholds.belowMinimumMargin) return 'text-warn-ink';
    return 'text-ok';
  }

  protected verdictBorder(d: DealDetail): string {
    if (d.thresholds.belowDirectFloor || !d.thresholds.configured) return 'border-crit/35';
    if (d.thresholds.belowMinimumMargin) return 'border-warn/35';
    return 'border-ok/35';
  }

  protected verdictIcon(d: DealDetail): 'lock' | 'alert-triangle' | 'check-circle' {
    if (d.thresholds.belowDirectFloor || !d.thresholds.configured) return 'lock';
    if (d.thresholds.belowMinimumMargin) return 'alert-triangle';
    return 'check-circle';
  }
}

/** Espace fine insécable en séparateur de milliers — usage francophone. */
function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '-';
  return grouper(value, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
