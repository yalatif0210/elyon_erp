import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, ComplianceSubject, ExpiryItem } from '../core/api.service';
import { IconComponent } from '../shared/icon.component';
import { StatusBadgeComponent } from '../shared/status-badge.component';
import { TYPE_LABELS } from './dashboard.component';
import { dateOnly, daysClass, remainingLabel } from '../shared/format';

const KIND_LABELS: Record<string, string> = {
  CARRIER: 'Transporteur',
  VEHICLE: 'Véhicule',
  DRIVER: 'Chauffeur',
};

@Component({
  selector: 'erp-compliance',
  standalone: true,
  imports: [FormsModule, IconComponent, StatusBadgeComponent],
  template: `
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-slate-100">Conformité des moyens</h1>
      <p class="mt-1 text-sm text-slate-500">
        Statut déduit des pièces à échéance — jamais saisi. Un moyen non conforme ne peut être
        affecté sans dérogation du Directeur Général.
      </p>
    </header>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      @for (f of filters; track f.value) {
        <button
          class="rounded-md px-3 py-1.5 text-xs font-medium transition-all"
          [class]="active() === f.value
            ? 'bg-sky-500 text-slate-950'
            : 'border border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'"
          (click)="active.set(f.value)"
        >
          {{ f.label }}
        </button>
      }
      <span class="ml-auto text-xs text-slate-600">{{ filtered().length }} résultat(s)</span>
    </div>

    <div class="card overflow-x-auto">
      <table class="table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Identification</th>
            <th class="num">Expirées</th>
            <th class="num">À échoir</th>
            <th class="num">Prochaine échéance</th>
            <th>État</th>
          </tr>
        </thead>
        <tbody>
          @for (row of filtered(); track row.subject_id) {
            <tr>
              <td class="text-slate-500">{{ kindLabel(row.subject_kind) }}</td>
              <td>
                <span class="font-mono text-xs text-slate-400">{{ row.subject_code }}</span>
                <span class="ml-2 text-slate-200">{{ row.subject_label }}</span>
              </td>
              <td class="num" [class]="row.expired_count > 0 ? 'text-rose-400' : 'text-slate-600'">
                {{ row.expired_count }}
              </td>
              <td class="num" [class]="row.expiring_count > 0 ? 'text-amber-400' : 'text-slate-600'">
                {{ row.expiring_count }}
              </td>
              <td class="num text-slate-400">{{ row.next_expiry ? dateOnly(row.next_expiry) : '—' }}</td>
              <td>
                @if (row.is_compliant) {
                  <erp-status-badge kind="ok" label="Conforme" />
                } @else {
                  <erp-status-badge kind="blocked" label="Non conforme" />
                }
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="6" class="py-10 text-center text-sm text-slate-500">Aucun moyen dans ce filtre.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class ComplianceComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly rows = signal<ComplianceSubject[]>([]);
  protected readonly active = signal<'all' | 'blocked' | 'VEHICLE' | 'DRIVER' | 'CARRIER'>('all');

  protected readonly filters = [
    { label: 'Tous', value: 'all' as const },
    { label: 'Non conformes', value: 'blocked' as const },
    { label: 'Véhicules', value: 'VEHICLE' as const },
    { label: 'Chauffeurs', value: 'DRIVER' as const },
    { label: 'Transporteurs', value: 'CARRIER' as const },
  ];

  protected readonly filtered = computed(() => {
    const filter = this.active();
    const all = this.rows();
    if (filter === 'all') return all;
    if (filter === 'blocked') return all.filter((r) => !r.is_compliant);
    return all.filter((r) => r.subject_kind === filter);
  });

  ngOnInit(): void {
    this.api.complianceOverview().subscribe((rows) => this.rows.set(rows));
  }

  protected kindLabel(kind: string): string {
    return KIND_LABELS[kind] ?? kind;
  }

  protected readonly dateOnly = dateOnly;
}

// ===========================================================================

@Component({
  selector: 'erp-expiry',
  standalone: true,
  imports: [FormsModule, IconComponent, StatusBadgeComponent],
  template: `
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-slate-100">Échéancier réglementaire</h1>
      <p class="mt-1 text-sm text-slate-500">
        Agréments, assurances, contrôles techniques et habilitations, par ordre d'échéance.
      </p>
    </header>

    <div class="mb-4 flex flex-wrap items-center gap-3">
      <label class="flex items-center gap-2 text-xs text-slate-400">
        Horizon
        <select class="field w-auto py-1.5 text-xs" [(ngModel)]="horizon" (ngModelChange)="load()">
          <option [value]="30">30 jours</option>
          <option [value]="90">90 jours</option>
          <option [value]="180">180 jours</option>
          <option [value]="365">1 an</option>
        </select>
      </label>

      <label class="flex items-center gap-2 text-xs text-slate-400">
        <input type="checkbox" class="accent-sky-500" [(ngModel)]="blockingOnly" (ngModelChange)="load()" />
        Pièces bloquantes seulement
      </label>

      <span class="ml-auto text-xs text-slate-600">{{ items().length }} pièce(s)</span>
    </div>

    <div class="card overflow-x-auto">
      <table class="table">
        <thead>
          <tr>
            <th>Pièce</th><th>Référence</th><th>Porteur</th>
            <th class="num">Expiration</th><th class="num">Reste</th><th>État</th><th>Bloquante</th>
          </tr>
        </thead>
        <tbody>
          @for (item of items(); track item.id) {
            <tr>
              <td class="text-slate-200">{{ typeLabel(item.type) }}</td>
              <td class="font-mono text-xs text-slate-500">{{ item.reference }}</td>
              <td class="text-slate-400">
                <span class="text-[11px] uppercase text-slate-600">{{ kindLabel(item.owner_kind) }}</span>
                <span class="ml-2">{{ item.owner_label }}</span>
              </td>
              <td class="num text-slate-400">{{ dateOnly(item.expiry_date) }}</td>
              <td class="num" [class]="daysClass(item.days_remaining)">
                {{ remainingLabel(item.days_remaining) }}
              </td>
              <td>
                @if (item.status === 'EXPIRED') {
                  <erp-status-badge kind="blocked" label="Expirée" />
                } @else if (item.status === 'EXPIRING') {
                  <erp-status-badge kind="wait" label="À renouveler" />
                } @else {
                  <erp-status-badge kind="ok" label="Valide" />
                }
              </td>
              <td>
                @if (item.is_blocking) {
                  <span class="inline-flex items-center gap-1 text-xs text-rose-400">
                    <erp-icon name="lock" [size]="12" /> Oui
                  </span>
                } @else {
                  <span class="text-xs text-slate-600">Non</span>
                }
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="7" class="py-10 text-center text-sm text-slate-500">
                Aucune pièce n'arrive à échéance sur cet horizon.
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class ExpiryComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly items = signal<ExpiryItem[]>([]);
  protected horizon = 90;
  protected blockingOnly = false;

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.api.expiryWatch(Number(this.horizon), this.blockingOnly).subscribe((rows) => this.items.set(rows));
  }

  protected typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  protected kindLabel(kind: string): string {
    return { PARTNER: 'Tiers', VEHICLE: 'Véhicule', DRIVER: 'Chauffeur' }[kind] ?? kind;
  }

  protected readonly dateOnly = dateOnly;
  protected readonly remainingLabel = remainingLabel;
  protected readonly daysClass = daysClass;
}
