import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, ComplianceSubject, ExpiryItem } from '../core/api.service';
import { IconComponent } from '../shared/icon.component';
import { StatusBadgeComponent } from '../shared/status-badge.component';

/**
 * Tableau de bord du lot 1 — la conformité des moyens.
 *
 * C'est la valeur immédiate de ce lot : avant même qu'une opération existe,
 * savoir quel véhicule est immobilisable et quelle pièce arrive à échéance
 * justifie le déploiement.
 */
@Component({
  selector: 'erp-dashboard',
  standalone: true,
  imports: [RouterLink, IconComponent, StatusBadgeComponent],
  template: `
    <header class="mb-6">
      <h1 class="text-xl font-semibold text-slate-100">Tableau de bord</h1>
      <p class="mt-1 text-sm text-slate-500">Conformité des moyens et échéances réglementaires</p>
    </header>

    <!-- Indicateurs -->
    <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div class="card p-4">
        <p class="text-xs uppercase tracking-wide text-slate-500">Moyens suivis</p>
        <p class="tabular mt-1.5 text-2xl font-semibold text-slate-100">{{ overview().length }}</p>
      </div>

      <div [class]="blockedCardClass()">
        <p class="text-xs uppercase tracking-wide text-slate-500">Non conformes</p>
        <div class="mt-1.5 flex items-center gap-2">
          <span class="tabular text-2xl font-semibold" [class]="countClass(blocked().length)">
            {{ blocked().length }}
          </span>
          @if (hasBlocked()) {
            <erp-icon name="lock" [size]="17" class="text-rose-400" />
          }
        </div>
        <p class="mt-1 text-[11px] text-slate-600">Affectation bloquée sans dérogation DG</p>
      </div>

      <div class="card p-4">
        <p class="text-xs uppercase tracking-wide text-slate-500">Échéances proches</p>
        <div class="mt-1.5 flex items-center gap-2">
          <span class="tabular text-2xl font-semibold" [class]="warnClass(expiringSoon().length)">
            {{ expiringSoon().length }}
          </span>
          @if (hasExpiringSoon()) {
            <erp-icon name="clock" [size]="17" class="text-amber-400" />
          }
        </div>
        <p class="mt-1 text-[11px] text-slate-600">Sous 90 jours</p>
      </div>

      <div class="card p-4">
        <p class="text-xs uppercase tracking-wide text-slate-500">Pièces expirées</p>
        <div class="mt-1.5 flex items-center gap-2">
          <span class="tabular text-2xl font-semibold" [class]="countClass(expired().length)">
            {{ expired().length }}
          </span>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <!-- Moyens non conformes -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">Moyens non conformes</h2>
          <a routerLink="/conformite" class="text-xs text-sky-400 hover:text-sky-300">Tout voir</a>
        </div>
        <div class="overflow-x-auto">
          @if (blocked().length === 0) {
            <p class="px-4 py-8 text-center text-sm text-slate-500">
              Aucun moyen bloqué. Tous les agréments, assurances et contrôles sont à jour.
            </p>
          } @else {
            <table class="table">
              <thead>
                <tr><th>Type</th><th>Identification</th><th class="num">Expirées</th><th>État</th></tr>
              </thead>
              <tbody>
                @for (row of blocked(); track row.subject_id) {
                  <tr>
                    <td class="text-slate-500">{{ kindLabel(row.subject_kind) }}</td>
                    <td>
                      <span class="font-mono text-xs text-slate-400">{{ row.subject_code }}</span>
                      <span class="ml-2 text-slate-200">{{ row.subject_label }}</span>
                    </td>
                    <td class="num text-rose-400">{{ row.expired_count }}</td>
                    <td><erp-status-badge kind="blocked" label="Non conforme" /></td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      </section>

      <!-- Échéancier -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">Prochaines échéances</h2>
          <a routerLink="/echeancier" class="text-xs text-sky-400 hover:text-sky-300">Tout voir</a>
        </div>
        <div class="overflow-x-auto">
          @if (upcoming().length === 0) {
            <p class="px-4 py-8 text-center text-sm text-slate-500">Aucune échéance sous 90 jours.</p>
          } @else {
            <table class="table">
              <thead>
                <tr><th>Pièce</th><th>Porteur</th><th class="num">Échéance</th><th>État</th></tr>
              </thead>
              <tbody>
                @for (item of upcoming(); track item.id) {
                  <tr>
                    <td>
                      <span class="text-slate-200">{{ typeLabel(item.type) }}</span>
                      <span class="ml-2 font-mono text-[11px] text-slate-500">{{ item.reference }}</span>
                    </td>
                    <td class="text-slate-400">{{ item.owner_label }}</td>
                    <td class="num" [class]="daysClass(item.days_remaining)">
                      {{ remainingLabel(item.days_remaining) }}
                    </td>
                    <td>
                      <erp-status-badge
                        [kind]="item.status === 'EXPIRED' ? 'blocked' : 'wait'"
                        [label]="item.status === 'EXPIRED' ? 'Expirée' : 'À renouveler'" />
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      </section>
    </div>
  `,
})
export class DashboardComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly overview = signal<ComplianceSubject[]>([]);
  protected readonly expiry = signal<ExpiryItem[]>([]);

  protected readonly blocked = computed(() => this.overview().filter((s) => !s.is_compliant));
  protected readonly expired = computed(() => this.expiry().filter((e) => e.days_remaining < 0));
  protected readonly expiringSoon = computed(() =>
    this.expiry().filter((e) => e.days_remaining >= 0 && e.days_remaining <= 90),
  );
  protected readonly upcoming = computed(() => this.expiry().slice(0, 8));
  protected readonly hasBlocked = computed(() => this.blocked().length > 0);
  protected readonly hasExpiringSoon = computed(() => this.expiringSoon().length > 0);

  /**
   * Les classes conditionnelles se calculent ici, pas dans le template :
   * un « > » dans une valeur d'attribut et un « / » dans un nom de binding
   * (`[class.ring-rose-500/40]`) cassent le parseur de template Angular.
   */
  protected blockedCardClass(): string {
    return this.hasBlocked() ? 'card p-4 ring-1 ring-rose-500/40' : 'card p-4';
  }

  protected countClass(count: number): string {
    return count > 0 ? 'text-rose-400' : 'text-slate-100';
  }

  protected warnClass(count: number): string {
    return count > 0 ? 'text-amber-400' : 'text-slate-100';
  }

  ngOnInit(): void {
    this.api.complianceOverview().subscribe((rows) => this.overview.set(rows));
    this.api.expiryWatch(90).subscribe((rows) => this.expiry.set(rows));
  }

  protected kindLabel(kind: string): string {
    return { CARRIER: 'Transporteur', VEHICLE: 'Véhicule', DRIVER: 'Chauffeur' }[kind] ?? kind;
  }

  protected typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  /**
   * Les comparaisons vivent dans le composant, jamais dans l'interpolation :
   * le parseur de template lit « < » comme une ouverture de balise.
   */
  protected remainingLabel(days: number): string {
    return days < 0 ? 'échue' : `${days} j`;
  }

  protected daysClass(days: number): string {
    if (days < 0) return 'text-rose-400';
    if (days <= 30) return 'text-amber-400';
    return 'text-slate-300';
  }
}

export const TYPE_LABELS: Record<string, string> = {
  CUSTOMS_LICENSE: 'Agrément douanier',
  MINISTERIAL_APPROVAL: 'Agrément ministériel',
  IMPORT_EXPORT_LICENSE: "Licence d'import/export",
  INSURANCE: 'Assurance',
  TECHNICAL_INSPECTION: 'Contrôle technique',
  DRIVER_LICENSE: 'Permis de conduire',
  DRIVER_TRAINING: 'Habilitation chauffeur',
  HSE_CERTIFICATION: 'Certification HSE',
  VESSEL_CERTIFICATE: 'Certificat de navire',
  SAFETY_DATA_SHEET: 'Fiche de données de sécurité',
  OTHER: 'Autre',
};
