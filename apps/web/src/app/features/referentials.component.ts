import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { IconComponent } from '../shared/icon.component';

interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: number;
  isPivot: boolean;
  isLocal: boolean;
  isFunctional: boolean;
  pegCurrencyCode: string | null;
  pegRate: string | null;
}

interface CostPost {
  code: string;
  label: string;
  category: string;
  nature: 'DIRECT' | 'INDIRECT';
  variability: 'VARIABLE' | 'FIXED';
  isSystemComputed: boolean;
  costPool: { code: string; label: string } | null;
}

interface Threshold {
  segment: string;
  directFloor: string | null;
  minimumMargin: string | null;
  currencyCode: string;
  uom: string;
  product: { code: string } | null;
}

interface Tolerance {
  normalThresholdPct: string;
  alertThresholdPct: string;
  criticalThresholdPct: string;
  segment: string | null;
  transportMode: string | null;
  product: { code: string } | null;
}

@Component({
  selector: 'erp-referentials',
  standalone: true,
  imports: [IconComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Référentiels</h1>
      <p class="page-sub">
        Paramétrage métier. Aucune de ces valeurs n'est codée en dur : elles se modifient
        sans redéploiement.
      </p>
    </header>

    <!-- Devises -->
    <section class="card mb-5">
      <div class="card-header"><h2 class="card-title">Devises</h2></div>
      <div class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr><th>Code</th><th>Libellé</th><th class="num">Décimales</th><th>Rôle</th><th>Parité fixe</th></tr>
          </thead>
          <tbody>
            @for (c of currencies(); track c.code) {
              <tr>
                <td class="font-mono text-ink">{{ c.code }}</td>
                <td class="text-ink-soft">{{ c.name }} <span class="text-ink-faint">{{ c.symbol }}</span></td>
                <td class="num" [class]="c.decimalPlaces === 0 ? 'font-semibold text-warn-ink' : 'text-ink-soft'">
                  {{ c.decimalPlaces }}
                </td>
                <td class="space-x-1">
                  @if (c.isPivot) {
                    <span class="rounded bg-primary-wash px-1.5 py-0.5 text-[11px] text-primary">pivot</span>
                  }
                  @if (c.isFunctional) {
                    <span class="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-ink-soft">fonctionnelle</span>
                  }
                  @if (c.isLocal) {
                    <span class="rounded bg-ok-wash px-1.5 py-0.5 text-[11px] text-ok">locale</span>
                  }
                </td>
                <td class="num text-ink-soft">
                  @if (c.pegCurrencyCode) {
                    1 {{ c.pegCurrencyCode }} = {{ c.pegRate }} {{ c.code }}
                  } @else { <span class="text-ink-faint">-</span> }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="border-t border-rule px-4 py-2 text-[11px] text-ink-faint">
        Le franc CFA n'a pas de subdivision en circulation : tout montant imprimé en XOF est un entier.
      </p>
    </section>

    <!-- Seuils de marge -->
    @if (canSeeFinance()) {
      <section class="card mb-5">
        <div class="card-header">
          <h2 class="card-title">Seuils de marge</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="table">
            <thead>
              <tr><th>Segment</th><th>Produit</th><th class="num">Plancher direct</th>
                  <th class="num">Seuil minimum</th><th>Unité</th></tr>
            </thead>
            <tbody>
              @for (t of thresholds(); track $index) {
                <tr>
                  <td class="text-ink">{{ t.segment }}</td>
                  <td class="text-ink-muted">{{ t.product?.code ?? 'tous' }}</td>
                  <td class="num text-crit">{{ t.directFloor ?? '-' }}</td>
                  <td class="num text-warn-ink">{{ t.minimumMargin ?? '-' }}</td>
                  <td class="text-ink-muted">{{ t.currencyCode }}/{{ t.uom }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="border-t border-rule px-4 py-2 text-[11px] text-ink-faint">
          Plancher direct : blocage dur, levée par le DG seul. Seuil minimum : accord DG requis, pas un refus.
          Le segment maritime reste à définir.
        </p>
      </section>
    }

    <!-- Tolérances d'ullage -->
    <section class="card mb-5">
      <div class="card-header">
        <h2 class="card-title">Tolérances d'écart de volume</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr><th>Segment</th><th>Mode</th><th>Produit</th>
                <th class="num">Normal</th><th class="num">Alerte</th><th class="num">Critique</th></tr>
          </thead>
          <tbody>
            @for (t of tolerances(); track $index) {
              <tr>
                <td class="text-ink-soft">{{ t.segment ?? 'tous' }}</td>
                <td class="text-ink-soft">{{ t.transportMode ?? 'tous' }}</td>
                <td class="text-ink-soft">{{ t.product?.code ?? 'tous' }}</td>
                <td class="num text-ink-soft">{{ t.normalThresholdPct }} %</td>
                <td class="num text-warn-ink">{{ t.alertThresholdPct }} %</td>
                <td class="num text-crit">{{ t.criticalThresholdPct }} %</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="border-t border-rule px-4 py-2 text-[11px] text-ink-faint">
        Au-delà du seuil critique, une non-conformité HSE est ouverte d'office : un écart important
        signifie que le produit est allé quelque part.
      </p>
    </section>

    <!-- Postes de coûts -->
    <section class="card">
      <div class="card-header">
        <h2 class="card-title">Répertoire des postes de coûts</h2>
        <span class="text-[11px] text-ink-faint">{{ costPosts().length }} postes</span>
      </div>
      <div class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr><th>Code</th><th>Libellé</th><th>Catégorie</th><th>Nature</th>
                <th>Variabilité</th><th>Regroupement</th></tr>
          </thead>
          <tbody>
            @for (c of costPosts(); track c.code) {
              <tr>
                <td class="font-mono text-[12px] text-ink-muted">{{ c.code }}</td>
                <td class="text-ink">
                  {{ c.label }}
                  @if (c.isSystemComputed) {
                    <span class="ml-2 rounded bg-primary-wash px-1.5 py-0.5 text-[10px] text-primary">calculé</span>
                  }
                </td>
                <td class="text-ink-muted">{{ c.category }}</td>
                <td>
                  <span class="rounded px-1.5 py-0.5 text-[11px]"
                        [class]="c.nature === 'DIRECT'
                          ? 'bg-ok-wash text-ok'
                          : 'bg-violet-500/15 text-violet-400'">
                    {{ c.nature === 'DIRECT' ? 'direct' : 'indirect' }}
                  </span>
                </td>
                <td>
                  <span class="rounded px-1.5 py-0.5 text-[11px]"
                        [class]="c.variability === 'VARIABLE'
                          ? 'bg-blue-500/15 text-blue-400'
                          : 'bg-gray-100 text-ink-soft'">
                    {{ c.variability === 'VARIABLE' ? 'variable' : 'fixe' }}
                  </span>
                </td>
                <td class="text-ink-muted">{{ c.costPool?.label ?? '-' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="border-t border-rule px-4 py-2 text-[11px] text-ink-faint">
        Nature et variabilité sont deux axes indépendants. Une location de dépôt dédiée est directe
        et fixe ; une commission bancaire proportionnelle est indirecte et variable. Sans ce second
        axe, le point mort n'est pas calculable.
      </p>
    </section>
  `,
})
export class ReferentialsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  protected readonly currencies = signal<Currency[]>([]);
  protected readonly costPosts = signal<CostPost[]>([]);
  protected readonly thresholds = signal<Threshold[]>([]);
  protected readonly tolerances = signal<Tolerance[]>([]);

  ngOnInit(): void {
    this.api.currencies().subscribe((rows) => this.currencies.set(rows as Currency[]));
    this.api.ullageTolerances().subscribe((rows) => this.tolerances.set(rows as Tolerance[]));

    // Ces deux référentiels sont réservés : on n'appelle pas l'endpoint pour
    // les rôles qui recevraient un 403.
    if (this.auth.hasRole('DG', 'FINANCE_CFO', 'ACCOUNTANT', 'CCOO', 'LOGISTICS_COORD')) {
      this.api.costPosts().subscribe((rows) => this.costPosts.set(rows as CostPost[]));
    }
    if (this.canSeeFinance()) {
      this.api.marginThresholds().subscribe((rows) => this.thresholds.set(rows as Threshold[]));
    }
  }

  protected canSeeFinance(): boolean {
    return this.auth.hasRole('DG', 'FINANCE_CFO', 'CCOO', 'ACCOUNTANT');
  }
}
