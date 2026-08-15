import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService, OperationRow } from '../core/api.service';
import { dateOnly, grouper } from '../shared/format';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'En préparation',
  SOURCING: 'Approvisionnement',
  HSE_PREPARATION: 'Préparation HSE',
  HSE_BLOCKED: 'Bloquée (contrôle HSE)',
  PLANNED: 'Planifiée',
  LOADING: 'Chargement',
  IN_TRANSIT: 'En transit',
  DELIVERING: 'Livraison en cours',
  FINAL_CHECK: 'Contrôle final',
  CLOSED: 'Clôturée',
  INCIDENT: 'Incident déclaré',
  CANCELLED: 'Annulée',
};

const STATUS_BADGE: Record<string, string> = {
  IN_TRANSIT: 'badge-transit',
  DELIVERING: 'badge-transit',
  LOADING: 'badge-transit',
  CLOSED: 'badge-ok',
  HSE_BLOCKED: 'badge-blocked',
  INCIDENT: 'badge-blocked',
  CANCELLED: 'badge-blocked',
};

/** Suivi des livraisons — lecture seule : aucune action côté client (§ 13). */
@Component({
  selector: 'erp-portal-livraisons',
  standalone: true,
  template: `
    <header class="mb-6">
      <h1 class="page-title">Livraisons</h1>
      <p class="page-sub">Avancement des opérations rattachées à vos affaires.</p>
    </header>

    @if (chargement()) {
      <p class="text-[13px] text-ink-muted">Lecture…</p>
    } @else if (operations().length === 0) {
      <div class="card px-[15px] py-4">
        <p class="text-[13px] text-ink-soft">Aucune livraison pour le moment.</p>
      </div>
    } @else {
      <div class="card overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>Opération</th>
              <th>Affaire</th>
              <th class="num">Volume</th>
              <th>Transport</th>
              <th>Destination</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            @for (o of operations(); track o.id) {
              <tr>
                <td class="ref">{{ o.reference }}</td>
                <td class="text-ink-soft">{{ o.deal.reference }}</td>
                <td class="num font-mono text-ink-soft">{{ grouper(+o.plannedVolume) }} {{ o.uom }}</td>
                <td class="text-ink-soft">{{ o.transportMode }}</td>
                <td class="text-ink-soft">{{ o.destinationLocation ?? '-' }}</td>
                <td><span [class]="badge(o.status)">{{ label(o.status) }}</span></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class LivraisonsComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly chargement = signal(true);
  protected readonly operations = signal<OperationRow[]>([]);
  protected readonly grouper = (v: number) => grouper(v, { maximumFractionDigits: 3 });
  protected readonly dateOnly = dateOnly;

  protected label(status: string): string {
    return STATUS_LABEL[status] ?? status;
  }
  protected badge(status: string): string {
    return STATUS_BADGE[status] ?? 'badge-neutral';
  }

  ngOnInit(): void {
    this.api.operations({ pageSize: 100 }).subscribe((p) => {
      this.operations.set(p.items);
      this.chargement.set(false);
    });
  }
}
