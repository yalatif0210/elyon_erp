import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, InvoiceRow } from '../core/api.service';
import { IconComponent } from '../shared/icon.component';
import { PaginationComponent } from '../shared/tableau';
import { grouper } from '../shared/format';
import { StatusBadgeComponent, StatusKind } from '../shared/status-badge.component';
import {
  InvoiceActionsComponent,
  InvoiceLifecycleComponent,
} from './invoice-actions.component';

const TYPE_LABELS: Record<string, string> = {
  PROFORMA: 'Proforma',
  SIMPLE: 'Facture simple',
  FNE: 'Facture normalisée',
  CREDIT_NOTE: 'Avoir',
};

const INVOICE_STATUS: Record<string, { label: string; kind: StatusKind }> = {
  DRAFT: { label: 'Brouillon', kind: 'neutral' },
  ISSUED: { label: 'Émise', kind: 'transit' },
  PARTIALLY_PAID: { label: 'Partiellement réglée', kind: 'wait' },
  PAID: { label: 'Réglée', kind: 'ok' },
  OVERDUE: { label: 'Échue', kind: 'blocked' },
  DISPUTED: { label: 'Contestée', kind: 'blocked' },
  CANCELLED: { label: 'Annulée', kind: 'neutral' },
};

const FNE_LABELS: Record<string, string> = {
  NOT_APPLICABLE: 'sans objet',
  DRAFT: 'brouillon',
  TO_VALIDATE: 'à valider',
  PENDING_TRANSMISSION: 'à transmettre',
  TRANSMITTED: 'transmise',
  ACCEPTED: 'acceptée',
  REJECTED: 'rejetée',
  TO_CORRECT: 'à corriger',
  CANCELLED: 'annulée',
};

const FILTERS: { label: string; type?: string }[] = [
  { label: 'Toutes' },
  { label: 'Proforma', type: 'PROFORMA' },
  { label: 'Factures simples', type: 'SIMPLE' },
  { label: 'Normalisées', type: 'FNE' },
  { label: 'Avoirs', type: 'CREDIT_NOTE' },
];

/**
 * Registre de facturation.
 *
 * La colonne qui compte est le TOTAL FACTURE : c'est ce que doit le client.
 * La TVA figure à côté, en gris et précédée de « dont », parce qu'elle est
 * COMPRISE dans ce total et non ajoutée — l'afficher comme une colonne de
 * même poids laisserait croire qu'elle s'additionne.
 */
@Component({
  selector: 'erp-invoices',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    StatusBadgeComponent,
    InvoiceActionsComponent,
    InvoiceLifecycleComponent,
    PaginationComponent,
  ],
  template: `
    <header class="mb-5">
      <h1 class="page-title">Facturation</h1>
      <p class="page-sub">Proforma, factures simples, factures normalisées et avoirs</p>
    </header>

    <!-- Synthèse : encaissé et reste dû, la seule question du recouvrement. -->
    <div class="card mb-5 grid grid-cols-2 gap-px overflow-hidden bg-rule lg:grid-cols-4">
      <div class="stat bg-surface">
        <span class="stat-label">Pièces</span>
        <span class="stat-value">{{ rows().length }}</span>
        <span class="stat-note">Sur le filtre courant</span>
      </div>
      <div class="stat bg-surface">
        <span class="stat-label">Total facturé</span>
        <span class="stat-value text-[20px]">{{ money(totalBilled()) }}</span>
        <span class="stat-note">Hors proforma, elles ne créent aucune créance</span>
      </div>
      <div class="stat bg-surface">
        <span class="stat-label">Encaissé</span>
        <span class="stat-value text-[20px] text-ok">{{ money(totalPaid()) }}</span>
        <span class="stat-note">Règlements rapprochés</span>
      </div>
      <div class="stat bg-surface" [class.bg-warn-wash]="outstanding() > 0">
        <span class="stat-label">Reste dû</span>
        <span class="stat-value text-[20px]" [class]="outstandingClass()">{{
          money(outstanding())
        }}</span>
        <span class="stat-note">En-cours client</span>
      </div>
    </div>

    <erp-invoice-actions class="mb-5 block" (created)="load()" />

    @if (selected(); as inv) {
      <erp-invoice-lifecycle class="mb-5 block" [invoice]="inv" (changed)="load()" />
    }

    <div class="mb-4 flex flex-wrap items-center gap-2">
      @for (f of filters; track f.label) {
        <button
          type="button"
          class="rounded-[3px] px-2.5 py-1 text-[12px] font-medium transition-colors"
          [class]="
            active() === (f.type ?? '')
              ? 'bg-primary text-white'
              : 'border border-rule-strong bg-surface text-ink-soft hover:bg-gray-100 hover:text-ink'
          "
          (click)="setFilter(f.type)"
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
          placeholder="Rechercher un numéro…"
          aria-label="Rechercher une pièce"
          [(ngModel)]="search"
          (ngModelChange)="onSearch()"
        />
      </div>
    </div>

    <div class="card overflow-x-auto">
      <table class="table">
        <thead>
          <tr>
            <th>Numéro</th>
            <th>Nature</th>
            <th>Client</th>
            <th>Affaire</th>
            <th class="num">Volume</th>
            <th class="num">Prix TTC</th>
            <th class="num">Total facture</th>
            <th class="num">Dont TVA</th>
            <th class="num">Échéance</th>
            <th>État</th>
            <th>FNE</th>
          </tr>
        </thead>
        <tbody>
          @for (i of rows(); track i.id) {
            <tr [class]="rowClass(i)">
              <td>
                <button type="button" class="ref hover:underline" (click)="select(i)">
                  {{ i.number }}
                </button>
              </td>
              <td class="text-ink-soft">{{ typeLabel(i.type) }}</td>
              <td class="font-medium text-ink">{{ i.partner.legalName }}</td>
              <td class="font-mono text-[12px] text-ink-muted">{{ i.deal.reference }}</td>
              <td class="num font-mono text-ink-soft">{{ int(i.billedVolume) }}</td>
              <td class="num font-mono text-ink-soft">{{ money(+i.unitPrice) }}</td>
              <td class="num font-mono font-semibold text-ink">
                {{ money(+i.totalAmount) }}
                <span class="ml-1 text-[11px] font-normal text-ink-faint">{{ i.currencyCode }}</span>
              </td>
              <td class="num font-mono text-[12px] text-ink-muted">
                @if (i.isVatApplicable) {
                  {{ money(+i.vatAmount) }}
                  <span class="ml-0.5 text-[11px]">({{ rate(i.vatRatePct) }} %)</span>
                } @else {
                  <span class="text-ink-faint">-</span>
                }
              </td>
              <td class="num font-mono text-ink-soft">{{ i.dueDate?.slice(0, 10) ?? '-' }}</td>
              <td>
                <erp-status-badge [kind]="status(i.status).kind" [label]="status(i.status).label" />
              </td>
              <td class="text-[12px] text-ink-muted">
                {{ i.fneTransmission ? fneLabel(i.fneTransmission.status) : '-' }}
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="11" class="empty">Aucune pièce ne correspond à ce filtre.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <erp-pagination
      [page]="page()"
      [totalPages]="totalPages()"
      [total]="total()"
      libelle="factures"
      (allerA)="allerA($event)"
    />

    <p class="mt-3 text-[11px] leading-relaxed text-ink-faint">
      La TVA est <strong class="font-semibold">comprise</strong> dans le total facture, jamais
      ajoutée : elle en est extraite par la formule Total × taux ÷ (100 + taux) et n’est portée
      sur la pièce qu’à titre d’information. Une proforma ne crée aucune créance et ne se
      transmet pas au dispositif fiscal.
    </p>
  `,
})
export class InvoicesComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly rows = signal<InvoiceRow[]>([]);

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

  /** Les proforma sont exclues : elles ne portent aucune créance (§ 9.3). */
  private readonly billable = computed(() => this.rows().filter((i) => i.type !== 'PROFORMA'));

  protected readonly totalBilled = computed(() =>
    this.billable().reduce((s, i) => s + Number(i.totalAmount), 0),
  );
  protected readonly totalPaid = computed(() =>
    this.billable().reduce((s, i) => s + Number(i.paidAmount), 0),
  );
  protected readonly outstanding = computed(() => this.totalBilled() - this.totalPaid());

  /** Pièce désignée pour action — agir suppose d'abord de choisir. */
  protected readonly selected = signal<InvoiceRow | null>(null);

  private debounce?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.load();
  }

  protected select(i: InvoiceRow): void {
    this.selected.set(this.selected()?.id === i.id ? null : i);
  }

  protected setFilter(type?: string): void {
    this.active.set(type ?? '');
    this.load();
  }

  protected onSearch(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.load(), 300);
  }

  protected typeLabel(code: string): string {
    return TYPE_LABELS[code] ?? code;
  }

  protected fneLabel(code: string): string {
    return FNE_LABELS[code] ?? code;
  }

  protected status(code: string) {
    return INVOICE_STATUS[code] ?? { label: code, kind: 'neutral' as StatusKind };
  }

  protected money(value: number): string {
    if (!Number.isFinite(value)) return '-';
    return grouper(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected int(value: string): string {
    return grouper(Number(value), { maximumFractionDigits: 0 }).replace(/ /g, ' ');
  }

  protected rate(value: string): string {
    return String(Number(value));
  }

  protected outstandingClass(): string {
    return this.outstanding() > 0 ? 'text-warn-ink' : 'text-ink';
  }

  /** Liseré de sévérité : la forme double la teinte (§ 17.2). */
  protected rowClass(i: InvoiceRow): string {
    if (i.status === 'OVERDUE' || i.status === 'DISPUTED') return 'row-crit';
    if (i.fneTransmission?.status === 'REJECTED') return 'row-crit';
    if (i.status === 'PARTIALLY_PAID') return 'row-warn';
    return '';
  }

  protected load(): void {
    this.api
      .invoices(this.page(), {
        type: this.active() || undefined,
        search: this.search.trim() || undefined,
      })
      .subscribe((page) => {
        this.rows.set(page.items);
        this.total.set(page.total);
        this.totalPages.set(page.totalPages);
        // La pièce désignée est rafraîchie avec la liste : ses montants ont
        // pu changer sous l'effet d'une émission ou d'un encaissement.
        const current = this.selected();
        if (current) {
          this.selected.set(page.items.find((i) => i.id === current.id) ?? null);
        }
      });
  }
}
