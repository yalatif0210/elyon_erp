import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ApiService,
  DeviseOption,
  CostReconciliationRow,
  DealRow,
  Partner,
  PurchaseOrderRow,
  SupplierInvoiceRow,
} from '../core/api.service';
import {
  ActionFeedbackComponent,
  ActionState,
  HttpFailure,
} from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';
import { PaginationComponent } from '../shared/tableau';
import { grouper } from '../shared/format';
import { MontantDirective } from '../shared/montant.directive';
import { StatusBadgeComponent, StatusKind } from '../shared/status-badge.component';

const STATUS: Record<string, { label: string; kind: StatusKind }> = {
  EXPECTED: { label: 'Attendue', kind: 'wait' },
  RECEIVED: { label: 'Reçue', kind: 'transit' },
  APPROVED: { label: 'Approuvée', kind: 'transit' },
  PAID: { label: 'Réglée', kind: 'ok' },
  DISPUTED: { label: 'Contestée', kind: 'blocked' },
  CANCELLED: { label: 'Annulée', kind: 'neutral' },
};

const FILTERS: { label: string; status?: string }[] = [
  { label: 'Toutes' },
  { label: 'Attendues', status: 'EXPECTED' },
  { label: 'Reçues', status: 'RECEIVED' },
  { label: 'Réglées', status: 'PAID' },
];

const STATUS_PO: Record<string, { label: string; kind: StatusKind }> = {
  DRAFT: { label: 'Brouillon', kind: 'wait' },
  ISSUED: { label: 'Émise', kind: 'transit' },
  CONFIRMED: { label: 'Confirmée', kind: 'transit' },
  FULFILLED: { label: 'Honorée', kind: 'ok' },
  CANCELLED: { label: 'Annulée', kind: 'neutral' },
};

const FILTERS_PO: { label: string; status?: string }[] = [
  { label: 'Toutes' },
  { label: 'Émises', status: 'ISSUED' },
  { label: 'Confirmées', status: 'CONFIRMED' },
  { label: 'Honorées', status: 'FULFILLED' },
];

/**
 * Registre des factures fournisseurs et trésorerie immobilisée (§ 14.6).
 *
 * L'écran répond à deux questions que la comptabilité classique confond :
 *
 *   « Combien d'argent est sorti sans contrepartie reçue ? »
 *     Elyon paie AVANT livraison. Ce ne sont donc pas les dettes qui pèsent au
 *     BFR, ce sont les AVANCES. C'est le chiffre mis en tête.
 *
 *   « Le coût enregistré correspond-il à l'argent réellement sorti ? »
 *     Contrôle anti-détournement le plus solide, parce qu'il ne repose sur
 *     aucune déclaration : une charge sans facture, ou une facture sans
 *     charge, apparaît d'elle-même.
 */
@Component({
  selector: 'erp-supplier-invoices',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    IconComponent,
    StatusBadgeComponent,
    ActionFeedbackComponent,
    MontantDirective,
  
    PaginationComponent,
  ],
  template: `
    <header class="mb-5">
      <h1 class="page-title">Achats et prépaiements</h1>
      <p class="page-sub">
        Factures fournisseurs, avances non apurées et rapprochement des coûts
      </p>
    </header>

    <!-- Trésorerie immobilisée : le chiffre qui gouverne le besoin en fonds. -->
    <div class="card mb-5 grid grid-cols-2 gap-px overflow-hidden bg-rule lg:grid-cols-4">
      <div class="stat bg-surface">
        <span class="stat-label">Factures</span>
        <span class="stat-value">{{ rows().length }}</span>
        <span class="stat-note">Sur le filtre courant</span>
      </div>
      <div class="stat bg-surface">
        <span class="stat-label">Total facturé</span>
        <span class="stat-value text-[20px]">{{ money(totalBilled()) }}</span>
        <span class="stat-note">Toutes devises, converties en XOF</span>
      </div>
      <div class="stat bg-surface" [class.bg-warn-wash]="outstandingPrepaid() > 0">
        <span class="stat-label">Reliquat immobilisé</span>
        <span class="stat-value text-[20px]" [class]="prepaidClass()">{{
          money(outstandingPrepaid())
        }}</span>
        <span class="stat-note">
          Sans contrepartie constatée : sur {{ money(totalPrepaid()) }} avancés
        </span>
      </div>
      <div class="stat bg-surface">
        <span class="stat-label">Plus ancienne avance</span>
        <span class="stat-value text-[20px]">{{ oldestPrepaymentDays() }}</span>
        <span class="stat-note">Depuis le règlement, reliquat non soldé</span>
      </div>
    </div>

    <erp-action-feedback [error]="state.error()" [success]="state.done()" />

    <!-- ============ Commandes d'achat (ticket #5) ============ -->
    <section class="card mb-5 overflow-hidden">
      <div class="card-header">
        <h2 class="card-title">Commandes d'achat</h2>
        <span class="text-[11px] text-ink-faint">émises en mode BACK_TO_BACK, à l'affectation des moyens</span>
      </div>
      <div class="flex flex-wrap items-center gap-2 border-b border-rule px-[15px] py-2.5">
        @for (f of filtersPo; track f.label) {
          <button
            type="button"
            class="rounded-[3px] px-2.5 py-1 text-[12px] font-medium transition-colors"
            [class]="
              activePo() === (f.status ?? '')
                ? 'bg-primary text-white'
                : 'border border-rule-strong bg-surface text-ink-soft hover:bg-gray-100 hover:text-ink'
            "
            (click)="setFilterPo(f.status)"
          >
            {{ f.label }}
          </button>
        }
      </div>
      @if (commandes().length === 0) {
        <p class="empty">
          Aucune commande d'achat sur ce filtre. Elle s'émet automatiquement à l'affectation des
          moyens sur une opération en mode BACK_TO_BACK.
        </p>
      } @else {
        <div class="overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>Référence</th>
                <th>Opération</th>
                <th>Affaire</th>
                <th>Fournisseur</th>
                <th class="num">Volume</th>
                <th class="num">Prix unitaire</th>
                <th class="num">Montant</th>
                <th>Port de chargement</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              @for (c of commandes(); track c.id) {
                <tr>
                  <td><span class="ref">{{ c.reference }}</span></td>
                  <td>
                    <a [routerLink]="['/operations', c.operation.id]" class="link font-mono text-[12px]">{{
                      c.operation.reference
                    }}</a>
                  </td>
                  <td>
                    <a [routerLink]="['/affaires', c.operation.deal.id]" class="link font-mono text-[12px]">{{
                      c.operation.deal.reference
                    }}</a>
                  </td>
                  <td class="font-medium text-ink">{{ c.supplier.legalName }}</td>
                  <td class="num font-mono text-ink-soft">{{ money(+c.orderedVolume) }} {{ c.uom }}</td>
                  <td class="num font-mono text-ink-soft">{{ money(+c.unitPrice) }}</td>
                  <td class="num font-mono font-semibold text-ink">
                    {{ money(+c.totalAmount) }}
                    <span class="ml-1 text-[11px] font-normal text-ink-faint">{{ c.currencyCode }}</span>
                  </td>
                  <td class="text-[12px] text-ink-soft">{{ c.loadingPort ?? '-' }}</td>
                  <td>
                    <erp-status-badge [kind]="statusPo(c.status).kind" [label]="statusPo(c.status).label" />
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      <erp-pagination [page]="commandesPage()" [totalPages]="commandesTotalPages()" [total]="commandesTotal()"
                      libelle="commandes d'achat" (allerA)="allerACommandes($event)" />
    </section>

    <!-- ============ Enregistrer une facture fournisseur ============ -->
    <section class="card mb-5">
      <div class="card-header">
        <h2 class="card-title">Enregistrer une facture fournisseur</h2>
      </div>
      <div class="card-body">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label class="label" for="ref-f">Référence du fournisseur</label>
            <input id="ref-f" class="field font-mono" [(ngModel)]="newReference" />
          </div>
          <div>
            <label class="label" for="sup-f">Fournisseur</label>
            <select id="sup-f" class="field" [(ngModel)]="newSupplierId" (ngModelChange)="onSupplierOuAffaireChange()">
              <option [ngValue]="''">Choisir</option>
              @for (p of suppliers(); track p.id) {
                <option [ngValue]="p.id">{{ p.legalName }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label" for="deal-f">Affaire</label>
            <select id="deal-f" class="field" [(ngModel)]="newDealId" (ngModelChange)="onSupplierOuAffaireChange()">
              <option [ngValue]="''">Non rattachée</option>
              @for (d of dealOptions(); track d.id) {
                <option [ngValue]="d.id">{{ d.reference }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label" for="po-f">Commande d'achat</label>
            <select id="po-f" class="field" [(ngModel)]="newPurchaseOrderId" [disabled]="!newSupplierId">
              <option [ngValue]="''">Hors commande</option>
              @for (po of purchaseOrderOptions(); track po.id) {
                <option [ngValue]="po.id">{{ po.reference }} · {{ po.operation.reference }}</option>
              }
            </select>
            @if (newSupplierId && purchaseOrderOptions().length === 0) {
              <p class="mt-1 text-[11px] text-ink-faint">
                Aucune commande d'achat émise pour ce fournisseur{{ newDealId ? ' sur cette affaire' : '' }}.
              </p>
            }
          </div>
          <div>
            <label class="label" for="mnt-f">Montant</label>
            <input id="mnt-f" class="field text-right font-mono" erpMontant [(ngModel)]="newAmount" />
          </div>
          <div>
            <label class="label" for="tva-f">Taux de TVA déductible</label>
            <input id="tva-f" class="field text-right font-mono" [(ngModel)]="newVatRate" />
          </div>
          <div>
            <label class="label" for="date-f">Date de facture</label>
            <input id="date-f" type="date" class="field" [(ngModel)]="newInvoiceDate" />
          </div>
        </div>
        <p class="mt-2 text-[11px] leading-relaxed text-ink-faint">
          Une facture non rattachée à une affaire ne pourra jamais être confrontée au coût
          enregistré : le rapprochement, lui, est le contrôle qui ne repose sur aucune
          déclaration.
        </p>
        <button class="btn-primary mt-3" (click)="record()" [disabled]="state.busy()">
          Enregistrer
        </button>
      </div>
    </section>

    @if (settling(); as inv) {
      <section class="card mb-5 border-warn/40">
        <div class="card-header">
          <h2 class="card-title">Apurer manuellement {{ inv.reference }}</h2>
        </div>
        <div class="card-body">
          <p class="mb-3 text-[13px] text-ink-soft">
            Voie d’EXCEPTION. L’apurement se fait normalement tout seul, au chargement de
            l’opération ou à sa clôture. N’y recourir que si aucun de ces deux faits ne
            surviendra : facture rattachée à aucun dossier, opération annulée, régularisation.
          </p>
          <div class="flex flex-wrap items-end gap-3">
            <div>
              <label class="label" for="dt-ap">Date d’apurement</label>
              <input id="dt-ap" type="date" class="field" [(ngModel)]="settleDate" />
            </div>
            <div class="min-w-[280px] flex-1">
              <label class="label" for="motif-ap">Motif</label>
              <input id="motif-ap" class="field" [(ngModel)]="settleReason" />
            </div>
            <button class="btn-primary" (click)="settle(inv)" [disabled]="state.busy()">
              Apurer
            </button>
            <button class="btn-ghost" (click)="settling.set(null)">Annuler</button>
          </div>
        </div>
      </section>
    }

    @if (paying(); as inv) {
      <section class="card mb-5">
        <div class="card-header">
          <h2 class="card-title">Régler {{ inv.reference }} · {{ inv.supplier.legalName }}</h2>
        </div>
        <div class="card-body">
          <p class="mb-3 text-[13px] text-ink-soft">
            Montant dû {{ money(+inv.amount) }} · déjà réglé {{ money(+inv.paidAmount) }}
          </p>
          <div class="flex flex-wrap items-end gap-3">
            <div>
              <label class="label" for="mnt">Montant</label>
              <input id="mnt" class="field w-40 text-right font-mono" erpMontant [(ngModel)]="payAmount" />
            </div>
            <div>
              <label class="label" for="dt">Date de règlement</label>
              <input id="dt" type="date" class="field" [(ngModel)]="payDate" />
            </div>
            <div>
              <label class="label" for="vir">Référence bancaire</label>
              <input id="vir" class="field" [(ngModel)]="payReference" />
            </div>
            <button class="btn-primary" (click)="pay(inv)" [disabled]="state.busy()">
              Enregistrer le règlement
            </button>
            <button class="btn-ghost" (click)="paying.set(null)">Annuler</button>
          </div>
          <p class="mt-3 text-[11px] leading-relaxed text-ink-faint">
            Tant que la marchandise n’est pas reçue, ce règlement est une AVANCE : il pèse au
            besoin en fonds de roulement jusqu’à son apurement, qui se fera au chargement de
            l’opération ou à sa clôture.
          </p>
        </div>
      </section>
    }

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
          aria-label="Rechercher une facture fournisseur"
          [(ngModel)]="search"
          (ngModelChange)="onSearch()"
        />
      </div>
    </div>

    <div class="card mb-5 overflow-x-auto">
      <table class="table">
        <thead>
          <tr>
            <th>Référence</th>
            <th>Fournisseur</th>
            <th>Affaire</th>
            <th class="num">Montant</th>
            <th class="num">Dont TVA</th>
            <th class="num">Avance</th>
            <th class="num">Apuré</th>
            <th class="num">Reliquat</th>
            <th>Apuré par</th>
            <th>État</th>
          </tr>
        </thead>
        <tbody>
          @for (s of rows(); track s.id) {
            <tr [class]="rowClass(s)">
              <td>
                <button type="button" class="ref hover:underline" (click)="openPay(s)">
                  {{ s.reference }}
                </button>
              </td>
              <td class="font-medium text-ink">{{ s.supplier.legalName }}</td>
              <td>
                @if (s.deal) {
                  <a [routerLink]="['/affaires', s.deal.id]" class="link font-mono text-[12px]">{{
                    s.deal.reference
                  }}</a>
                } @else {
                  <span class="text-ink-faint">non rattachée</span>
                }
              </td>
              <td class="num font-mono font-semibold text-ink">
                {{ money(+s.amount) }}
                <span class="ml-1 text-[11px] font-normal text-ink-faint">{{ s.currencyCode }}</span>
              </td>
              <td class="num font-mono text-[12px] text-ink-muted">
                {{ +s.vatAmount > 0 ? money(+s.vatAmount) : '-' }}
              </td>
              <td class="num font-mono text-ink-soft">
                {{ +s.prepaidAmount > 0 ? money(+s.prepaidAmount) : '-' }}
              </td>
              <td class="num font-mono text-ink-soft">
                {{ +s.prepaidAmount > 0 ? money(+s.settledAmount) : '-' }}
              </td>
              <td class="num font-mono" [class]="advanceClass(s)">{{ remainderLabel(s) }}</td>
              <td class="text-[12px]" [class]="triggerClass(s)">
                {{ triggerLabel(s) }}
                @if (needsManualSettle(s)) {
                  <button class="link ml-1.5 text-[11px]" (click)="openSettle(s)">apurer</button>
                }
              </td>
              <td>
                <erp-status-badge [kind]="status(s.status).kind" [label]="status(s.status).label" />
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="10" class="empty">
                Aucune facture fournisseur enregistrée.<br />
                Sans elles, le coût porté par une affaire ne peut être confronté à aucune sortie
                d’argent.
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <erp-pagination [page]="page()" [totalPages]="totalPages()" [total]="total()"
                    libelle="factures fournisseurs" (allerA)="allerA($event)" />

    <!-- ============ Rapprochement ============ -->
    <section class="card overflow-hidden">
      <div class="card-header">
        <h2 class="card-title">Rapprochement du coût et des sorties d’argent</h2>
        <span class="text-[11px] text-ink-faint">montants en XOF</span>
      </div>
      @if (reconciliation().length === 0) {
        <p class="empty">
          Aucun écart. Chaque coût enregistré a sa facture fournisseur, et réciproquement.
        </p>
      } @else {
        <div class="overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>Affaire</th>
                <th>Client</th>
                <th class="num">Coût enregistré</th>
                <th class="num">Facturé</th>
                <th class="num">Payé</th>
                <th class="num">Non rapproché</th>
                <th class="num">Coût sans facture</th>
              </tr>
            </thead>
            <tbody>
              @for (r of reconciliation(); track r.reference) {
                <tr class="row-warn">
                  <td><span class="ref">{{ r.reference }}</span></td>
                  <td class="text-ink">{{ r.client }}</td>
                  <td class="num font-mono text-ink-soft">{{ money(+r.recorded_cost_xof) }}</td>
                  <td class="num font-mono text-ink-soft">{{ money(+r.supplier_billed_xof) }}</td>
                  <td class="num font-mono text-ink-soft">{{ money(+r.supplier_paid_xof) }}</td>
                  <td class="num font-mono font-semibold text-warn-ink">
                    {{ money(+r.unreconciled_xof) }}
                  </td>
                  <td class="num font-mono font-semibold text-crit">
                    {{ money(+r.cost_without_invoice_xof) }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      <p class="border-t border-rule px-[15px] py-2.5 text-[11px] leading-relaxed text-ink-faint">
        Un coût sans facture fournisseur derrière est le signal le plus fiable dont dispose
        l’entreprise : il ne repose sur aucune déclaration, seulement sur la confrontation de
        deux enregistrements indépendants.
      </p>
    </section>
  `,
})
export class SupplierInvoicesComponent implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly devises = signal<DeviseOption[]>([]);
  /** Cours du pivot vers le XOF — jamais le pivot lui-même n'atteint l'écran. */
  private readonly tauxPivotXof = signal(0);

  /**
   * La devise LOCALE de l'entreprise, lue au référentiel.
   *
   * ⚠️ `'XOF'` était écrit en dur ici. Une devise codée dans un écran survit à
   *    tout changement de paramétrage : le jour où l'entreprise travaillera en
   *    euros, il faudra retrouver l'écran. Et ce n'est jamais le PIVOT qu'on
   *    retient — il sert à comparer des engagements pris dans des monnaies
   *    différentes, il n'est la monnaie de personne.
   */
  protected deviseLocale(): string {
    return this.devises().find((d) => d.isLocal)?.code ?? this.devises()[0]?.code ?? '';
  }

  protected readonly rows = signal<SupplierInvoiceRow[]>([]);

  /**
   * Page demandée au serveur.
   *
   * L'écran lisait la page 1 et n'en sortait jamais : au-delà de la
   * cinquantième ligne, les données existaient sans s'afficher nulle part.
   */
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly totalPages = signal(1);

  protected allerA(p: number): void {
    this.page.set(p);
    this.load();
  }

  protected readonly commandes = signal<PurchaseOrderRow[]>([]);
  protected readonly commandesPage = signal(1);
  protected readonly commandesTotal = signal(0);
  protected readonly commandesTotalPages = signal(1);
  protected readonly activePo = signal('');
  protected readonly filtersPo = FILTERS_PO;

  protected allerACommandes(p: number): void {
    this.commandesPage.set(p);
    this.loadCommandes();
  }

  protected setFilterPo(status?: string): void {
    this.activePo.set(status ?? '');
    this.commandesPage.set(1);
    this.loadCommandes();
  }

  protected statusPo(code: string) {
    return STATUS_PO[code] ?? { label: code, kind: 'neutral' as StatusKind };
  }

  protected loadCommandes(): void {
    this.api
      .purchaseOrders(this.commandesPage(), { status: this.activePo() || undefined })
      .subscribe((page) => {
        this.commandes.set(page.items);
        this.commandesTotal.set(page.total);
        this.commandesTotalPages.set(page.totalPages);
      });
  }

  protected readonly reconciliation = signal<CostReconciliationRow[]>([]);
  protected readonly active = signal('');
  protected readonly filters = FILTERS;
  protected search = '';

  protected readonly totalBilled = computed(() =>
    this.rows().reduce((s, i) => s + Number(i.amountPivot) * this.tauxPivotXof(), 0),
  );

  /**
   * Une avance pèse au BFR pour son RELIQUAT, pas pour son montant d'origine.
   *
   * Le prorata est calculé EN BASE au chargement de l'opération, puis révisé
   * au relevé faisant autorité (§ 14.6). La console ne fait que soustraire :
   * refaire le calcul ici le ferait diverger de la règle réellement appliquée.
   */
  private readonly openAdvances = computed(() => this.rows().filter((i) => remainder(i) > 0.01));

  protected readonly totalPrepaid = computed(() =>
    this.rows().reduce(
      (s, i) => s + Number(i.prepaidAmount) * Number(i.fxRateToPivot) * this.tauxPivotXof(),
      0,
    ),
  );

  protected readonly outstandingPrepaid = computed(() =>
    this.openAdvances().reduce(
      (s, i) => s + remainder(i) * Number(i.fxRateToPivot) * this.tauxPivotXof(),
      0,
    ),
  );

  protected readonly oldestPrepaymentDays = computed(() => {
    const days = this.openAdvances()
      .map((i) => (i.prepaidAt ? daysSince(i.prepaidAt) : 0))
      .filter((d) => d > 0);
    return days.length === 0 ? '-' : String(Math.max(...days));
  });

  protected readonly state = new ActionState();
  /** Facture désignée pour règlement — agir suppose d'abord de choisir. */
  protected readonly paying = signal<SupplierInvoiceRow | null>(null);

  protected readonly settling = signal<SupplierInvoiceRow | null>(null);
  protected readonly suppliers = signal<Partner[]>([]);
  protected readonly dealOptions = signal<DealRow[]>([]);

  protected newReference = '';
  protected newSupplierId = '';
  protected newDealId = '';
  protected newPurchaseOrderId = '';
  protected readonly purchaseOrderOptions = signal<PurchaseOrderRow[]>([]);
  protected newAmount: number | null = null;
  protected newVatRate = 18;
  protected newInvoiceDate = new Date().toISOString().slice(0, 10);

  protected settleDate = new Date().toISOString().slice(0, 10);
  protected settleReason = '';

  protected payAmount: number | null = null;
  protected payDate = new Date().toISOString().slice(0, 10);
  protected payReference = '';

  private debounce?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.api.devises().subscribe((l) => this.devises.set(l));
    this.load();
    this.loadCommandes();
    this.api.costReconciliation().subscribe((r) => this.reconciliation.set(r));
    this.api.partners(1).subscribe((p) => this.suppliers.set(p.items));
    this.api.deals(1, {}).subscribe((p) => this.dealOptions.set(p.items));
    this.api.pivotLocalRate().subscribe((r) => this.tauxPivotXof.set(r.rate));
  }

  /** Aucun fait métier n'apurera cette avance : elle ne partira pas seule. */
  protected needsManualSettle(s: SupplierInvoiceRow): boolean {
    return remainder(s) > 0.01 && !s.purchaseOrderId && !s.deal;
  }

  protected openSettle(s: SupplierInvoiceRow): void {
    this.settling.set(this.settling()?.id === s.id ? null : s);
  }

  protected settle(inv: SupplierInvoiceRow): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api.settleSupplierInvoice(inv.id, this.settleDate, this.settleReason).subscribe({
      next: () => {
        this.state.succeed('Avance apurée.');
        this.settling.set(null);
        this.load();
      },
      error: (e: HttpFailure) => this.state.fail(e),
    });
  }

  /**
   * Le fournisseur qualifie « vendeur », l'affaire qualifie « opération »
   * (ticket #9) : les deux ensemble filtrent les commandes proposables,
   * jamais un identifiant technique saisi à la main.
   */
  protected onSupplierOuAffaireChange(): void {
    this.newPurchaseOrderId = '';
    // Vidée tout de suite, pas seulement au retour de l'appel : sinon la
    // liste du fournisseur précédent reste sélectionnable le temps que la
    // réponse arrive, et le serveur (seul juge en dernier ressort) refuserait
    // la facture — mais autant ne jamais proposer ce choix.
    this.purchaseOrderOptions.set([]);
    if (!this.newSupplierId) return;
    const supplierId = this.newSupplierId;
    const dealId = this.newDealId || undefined;
    this.api.purchaseOrders(1, { supplierId, dealId }).subscribe((page) => {
      // La sélection a pu changer pendant l'appel : n'applique la réponse
      // que si le filtre courant est toujours celui qui l'a demandée.
      if (this.newSupplierId === supplierId && (this.newDealId || undefined) === dealId) {
        this.purchaseOrderOptions.set(page.items);
      }
    });
  }

  protected record(): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api
      .recordSupplierInvoice({
        reference: this.newReference,
        supplierId: this.newSupplierId,
        dealId: this.newDealId || undefined,
        purchaseOrderId: this.newPurchaseOrderId || undefined,
        amount: Number(this.newAmount ?? 0),
        currencyCode: this.deviseLocale(),
        vatRatePct: Number(this.newVatRate),
        invoiceDate: this.newInvoiceDate,
      })
      .subscribe({
        next: () => {
          this.state.succeed('Facture fournisseur enregistrée.');
          this.newReference = '';
          this.newAmount = null;
          this.newPurchaseOrderId = '';
          this.purchaseOrderOptions.set([]);
          this.load();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }

  protected openPay(s: SupplierInvoiceRow): void {
    this.paying.set(this.paying()?.id === s.id ? null : s);
    this.payAmount = Math.max(0, Number(s.amount) - Number(s.paidAmount));
  }

  protected pay(inv: SupplierInvoiceRow): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api
      .paySupplierInvoice(inv.id, {
        amount: Number(this.payAmount ?? 0),
        paidAt: this.payDate,
        bankReference: this.payReference || undefined,
      })
      .subscribe({
        next: () => {
          this.state.succeed('Règlement enregistré.');
          this.paying.set(null);
          this.load();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
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
    return STATUS[code] ?? { label: code, kind: 'neutral' as StatusKind };
  }

  protected money(value: number): string {
    if (!Number.isFinite(value)) return '-';
    return grouper(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** Reliquat, avec la durée d'immobilisation qui le qualifie. */
  protected remainderLabel(s: SupplierInvoiceRow): string {
    if (Number(s.prepaidAmount) <= 0) return '-';
    const left = remainder(s);
    if (left <= 0.01) return 'soldée';
    return this.money(left) + (s.prepaidAt ? ` · ${daysSince(s.prepaidAt)} j` : '');
  }

  protected advanceClass(s: SupplierInvoiceRow): string {
    if (Number(s.prepaidAmount) <= 0) return 'text-ink-faint';
    return remainder(s) > 0.01 ? 'font-semibold text-warn-ink' : 'text-ink-soft';
  }

  /**
   * Ce qui apurera l'avance. L'afficher coupe court à la question qui vient
   * toujours : « pourquoi celle-ci pèse-t-elle encore ? »
   */
  protected triggerLabel(s: SupplierInvoiceRow): string {
    if (Number(s.prepaidAmount) <= 0) return '-';
    if (remainder(s) <= 0.01) return 'apurée';
    if (s.purchaseOrderId) return 'chargement de l’opération';
    if (s.deal) return 'clôture de l’opération';
    return 'apurement manuel : aucun dossier rattaché';
  }

  protected triggerClass(s: SupplierInvoiceRow): string {
    if (Number(s.prepaidAmount) <= 0 || remainder(s) <= 0.01) return 'text-ink-faint';
    // Une avance qu'aucun fait métier n'apurera doit se distinguer : elle ne
    // partira jamais d'elle-même.
    return s.purchaseOrderId || s.deal ? 'text-ink-soft' : 'font-medium text-crit';
  }

  protected prepaidClass(): string {
    return this.outstandingPrepaid() > 0 ? 'text-warn-ink' : 'text-ink';
  }

  /** Liseré de sévérité : la forme double la teinte (§ 17.2). */
  protected rowClass(s: SupplierInvoiceRow): string {
    if (s.status === 'DISPUTED') return 'row-crit';
    if (remainder(s) > 0.01) return 'row-warn';
    return '';
  }

  protected load(): void {
    this.api
      .supplierInvoices(1, {
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

/** Reliquat d'avance : ce qui pèse encore au BFR, prépayé moins apuré. */
function remainder(s: SupplierInvoiceRow): number {
  return Math.max(0, Number(s.prepaidAmount) - Number(s.settledAmount));
}

function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}
