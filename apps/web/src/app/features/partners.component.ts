import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, Partner } from '../core/api.service';
import { IconComponent } from '../shared/icon.component';
import { StatusBadgeComponent } from '../shared/status-badge.component';

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
  imports: [FormsModule, IconComponent, StatusBadgeComponent],
  template: `
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-slate-100">Tiers</h1>
      <p class="mt-1 text-sm text-slate-500">
        Clients, fournisseurs, transporteurs et inspecteurs.
      </p>
    </header>

    <div class="mb-4 flex items-center gap-3">
      <div class="relative max-w-xs flex-1">
        <erp-icon name="search" [size]="15"
                  class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
        <input class="field pl-9" placeholder="Rechercher un tiers…"
               [(ngModel)]="search" (ngModelChange)="onSearch()" />
      </div>
      <span class="ml-auto text-xs text-slate-600">{{ total() }} tiers</span>
    </div>

    <div class="card overflow-x-auto">
      <table class="table">
        <thead>
          <tr>
            <th>Code</th><th>Raison sociale</th><th>Type</th><th>Segment</th>
            <th>Pays</th><th class="num">Délai</th><th class="num">Sites</th>
            <th class="num">Moyens</th><th>Crédit</th>
          </tr>
        </thead>
        <tbody>
          @for (p of rows(); track p.id) {
            <tr>
              <td class="font-mono text-xs text-slate-400">{{ p.code }}</td>
              <td class="text-slate-100">{{ p.legalName }}</td>
              <td class="text-slate-400">{{ typeLabel(p.type) }}</td>
              <td>
                @if (p.segment) {
                  <span class="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300">
                    {{ segmentLabel(p.segment) }}
                  </span>
                } @else {
                  <span class="text-slate-700">—</span>
                }
              </td>
              <td class="font-mono text-xs text-slate-500">{{ p.countryCode }}</td>
              <td class="num text-slate-400">
                {{ p.paymentTermsDays === 0 ? 'comptant' : p.paymentTermsDays + ' j' }}
              </td>
              <td class="num text-slate-400">{{ p.sites.length }}</td>
              <td class="num text-slate-400">{{ p._count.vehicles + p._count.drivers }}</td>
              <td>
                @if (p.creditStatus === 'ACTIVE') {
                  <erp-status-badge kind="ok" label="Actif" />
                } @else if (p.creditStatus === 'WATCH') {
                  <erp-status-badge kind="wait" label="Surveillé" />
                } @else {
                  <erp-status-badge kind="blocked" label="Bloqué" />
                }
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="9" class="py-10 text-center text-sm text-slate-500">Aucun tiers trouvé.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class PartnersComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly rows = signal<Partner[]>([]);
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
    this.api.partners(1, this.search.trim() || undefined).subscribe((page) => {
      this.rows.set(page.items);
      this.total.set(page.total);
    });
  }
}
