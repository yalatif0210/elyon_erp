import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, BargePnLRow, VehicleMaintenanceRow } from '../core/api.service';
import { ActionFeedbackComponent, ActionState, HttpFailure } from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';
import { grouper } from '../shared/format';

const MAINTENANCE_LABEL: Record<string, string> = {
  PREVENTIVE: 'Préventive',
  CORRECTIVE: 'Corrective',
  REGULATORY: 'Réglementaire',
};

/**
 * BARGE — actif, maintenance, compte d'exploitation (§ 13, module 7).
 *
 * Générique côté API : une barge est un `Vehicle` de type `BUNKER_BARGE`,
 * pas une table à part — voir `barge.controller.ts`. Le chiffre d'affaires
 * par barge est une APPROXIMATION assumée : la somme des pièces émises sur
 * les affaires ayant eu au moins une opération confiée à elle, pas une
 * répartition au prorata (une affaire à cheval sur deux barges compte pour
 * chacune). Documenté ici comme côté serveur : un chiffre qui a l'air exact
 * finit par être cru exact.
 */
@Component({
  selector: 'erp-barge',
  standalone: true,
  imports: [FormsModule, IconComponent, ActionFeedbackComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Barge</h1>
      <p class="page-sub">
        Compte d'exploitation par barge et maintenance. Le chiffre d'affaires est approché par
        affaire ayant utilisé la barge : il n'est pas réparti au prorata entre plusieurs moyens.
      </p>
    </header>

    <erp-action-feedback [error]="state.error()" [success]="state.done()" />

    @if (chargement()) {
      <p class="text-[13px] text-ink-muted">Lecture…</p>
    } @else if (barges().length === 0) {
      <div class="card px-[15px] py-4">
        <p class="text-[13px] text-ink-soft">Aucun moyen de type barge dans le référentiel véhicules.</p>
      </div>
    } @else {
      <div class="card overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>Immatriculation</th>
              <th>Modèle</th>
              <th class="num">Voyages</th>
              <th class="num">Volume total</th>
              <th class="num">Revenus</th>
              <th class="num">Coûts opérationnels</th>
              <th class="num">Maintenance</th>
              <th class="num">Marge</th>
              <th>Conformité</th>
            </tr>
          </thead>
          <tbody>
            @for (b of barges(); track b.vehicleId) {
              <tr class="cursor-pointer hover:bg-gray-50" (click)="select(b)">
                <td class="font-mono font-medium text-ink">{{ b.registration }}</td>
                <td class="text-ink-soft">{{ b.brandModel ?? '-' }}</td>
                <td class="num font-mono text-ink-soft">{{ b.voyages }}</td>
                <td class="num font-mono text-ink-soft">
                  @for (u of uoms(b.volumeParUnite); track u) {
                    <div>{{ grouper(b.volumeParUnite[u]) }} {{ u }}</div>
                  }
                </td>
                <td class="num font-mono text-ink-soft">{{ money(b.revenuePivot) }} {{ b.pivotCurrency }}</td>
                <td class="num font-mono text-ink-soft">{{ money(b.operatingCostPivot) }}</td>
                <td class="num font-mono text-ink-soft">{{ money(b.maintenanceCostPivot) }}</td>
                <td class="num font-mono font-semibold" [class]="b.marginPivot >= 0 ? 'text-ok' : 'text-crit'">
                  {{ money(b.marginPivot) }}
                </td>
                <td>
                  @if (!b.isCompliant) {
                    <span class="inline-flex items-center gap-1 text-[11px] text-crit">
                      <erp-icon name="alert-triangle" [size]="12" /> Non conforme
                    </span>
                  } @else {
                    <span class="text-[11px] text-ok">Conforme</span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    @if (selected(); as barge) {
      <section class="card mt-5 overflow-hidden">
        <div class="card-header">
          <h2 class="card-title">Maintenance · {{ barge.registration }}</h2>
          @if (barge.nextMaintenanceDue) {
            <span class="text-[11px] text-ink-faint">Prochaine échéance : {{ barge.nextMaintenanceDue.slice(0, 10) }}</span>
          }
        </div>
        <div class="card-body">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label class="label" for="mtype">Nature</label>
              <select id="mtype" class="field" [(ngModel)]="mType">
                <option value="PREVENTIVE">Préventive</option>
                <option value="CORRECTIVE">Corrective</option>
                <option value="REGULATORY">Réglementaire</option>
              </select>
            </div>
            <div>
              <label class="label" for="mdate">Date d'intervention</label>
              <input id="mdate" type="date" class="field" [(ngModel)]="mPerformedAt" />
            </div>
            <div>
              <label class="label" for="mnext">Prochaine échéance</label>
              <input id="mnext" type="date" class="field" [(ngModel)]="mNextDueAt" />
            </div>
          </div>
          <div class="mt-3">
            <label class="label" for="mdesc">Description</label>
            <input id="mdesc" class="field" [(ngModel)]="mDescription" placeholder="Nature des travaux" />
          </div>
          <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label class="label" for="mcost">Coût</label>
              <input id="mcost" class="field text-right font-mono" [(ngModel)]="mCost" />
            </div>
            <div>
              <label class="label" for="mcur">Devise</label>
              <input id="mcur" class="field" [(ngModel)]="mCurrency" maxlength="3" placeholder="USD" />
            </div>
            <div>
              <label class="label" for="mby">Réalisée par</label>
              <input id="mby" class="field" [(ngModel)]="mPerformedBy" placeholder="Atelier, prestataire…" />
            </div>
          </div>
          <button class="btn-primary mt-4" (click)="enregistrerMaintenance()" [disabled]="state.busy()">
            Enregistrer l'intervention
          </button>

          <div class="mt-5 border-t border-rule pt-4">
            @if (historique().length === 0) {
              <p class="text-[12px] text-ink-faint">Aucune intervention enregistrée.</p>
            } @else {
              <table class="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Nature</th>
                    <th>Description</th>
                    <th class="num">Coût</th>
                    <th>Réalisée par</th>
                    <th>Prochaine échéance</th>
                  </tr>
                </thead>
                <tbody>
                  @for (m of historique(); track m.id) {
                    <tr>
                      <td class="font-mono text-[12px] text-ink-soft">{{ m.performedAt.slice(0, 10) }}</td>
                      <td class="text-ink-soft">{{ label(m.type) }}</td>
                      <td class="text-ink-soft">{{ m.description }}</td>
                      <td class="num font-mono text-ink-soft">{{ money(+m.cost) }} {{ m.currencyCode }}</td>
                      <td class="text-ink-soft">{{ m.performedBy ?? '-' }}</td>
                      <td class="font-mono text-[12px] text-ink-soft">{{ m.nextDueAt?.slice(0, 10) ?? '-' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
        </div>
      </section>
    }
  `,
})
export class BargeComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly state = new ActionState();
  protected readonly chargement = signal(true);
  protected readonly barges = signal<BargePnLRow[]>([]);
  protected readonly selected = signal<BargePnLRow | null>(null);
  protected readonly historique = signal<VehicleMaintenanceRow[]>([]);

  protected mType = 'PREVENTIVE';
  protected mDescription = '';
  protected mCost = '';
  protected mCurrency = 'USD';
  protected mPerformedAt = new Date().toISOString().slice(0, 10);
  protected mNextDueAt = '';
  protected mPerformedBy = '';

  protected readonly grouper = (v: number) => grouper(v, { maximumFractionDigits: 0 });
  protected uoms(v: Record<string, number>): string[] {
    return Object.keys(v);
  }
  protected money(v: number): string {
    return grouper(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  protected label(code: string): string {
    return MAINTENANCE_LABEL[code] ?? code;
  }

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.chargement.set(true);
    this.api.bargePnL().subscribe((rows) => {
      this.barges.set(rows);
      this.chargement.set(false);
    });
  }

  protected select(b: BargePnLRow): void {
    if (this.selected()?.vehicleId === b.vehicleId) {
      this.selected.set(null);
      return;
    }
    this.selected.set(b);
    this.api.vehicleMaintenance(b.vehicleId).subscribe((h) => this.historique.set(h));
  }

  protected enregistrerMaintenance(): void {
    const barge = this.selected();
    if (!barge || this.state.busy()) return;
    if (!this.mDescription.trim()) {
      this.state.error.set('La description de l’intervention est requise.');
      return;
    }
    this.state.start();
    this.api
      .recordMaintenance(barge.vehicleId, {
        type: this.mType,
        description: this.mDescription,
        cost: Number(this.mCost || 0),
        currencyCode: this.mCurrency,
        performedAt: this.mPerformedAt,
        nextDueAt: this.mNextDueAt || undefined,
        performedBy: this.mPerformedBy || undefined,
      })
      .subscribe({
        next: () => {
          this.state.succeed('Intervention enregistrée.');
          this.mDescription = '';
          this.mCost = '';
          this.mPerformedBy = '';
          this.mNextDueAt = '';
          this.api.vehicleMaintenance(barge.vehicleId).subscribe((h) => this.historique.set(h));
          this.load();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }
}
