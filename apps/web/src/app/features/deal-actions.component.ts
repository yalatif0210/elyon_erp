import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, DealDetail, SupplierPriceOption } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { IconComponent } from '../shared/icon.component';
import { grouper } from '../shared/format';

/** Refus renvoyé par l'API — la validation rend un tableau, le métier une chaîne. */
interface HttpFailure {
  error?: { message?: string | string[] };
}

/**
 * Choix du fournisseur et étapes d'approbation d'une affaire (§ 5.4, § 11.2).
 *
 * LE PRIX D'ACHAT SE CHOISIT, IL NE SE SAISIT PAS. Ne sont proposés que les
 * prix validés par le DG, portant le bon produit et en vigueur ce jour. Chaque
 * ligne montre le portage induit : deux fournisseurs au même prix ne coûtent
 * pas la même chose si l'un est payé d'avance et l'autre à trente jours.
 *
 * Les boutons d'approbation ne préjugent de rien. La base seule décide, et un
 * refus revient avec son motif — plancher de marge, prix hors bande, absence
 * de prix sourcé. Dupliquer la règle ici la rendrait affaiblissable par un
 * futur changement de code sans que personne ne s'en aperçoive.
 */
@Component({
  selector: 'erp-deal-actions',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <section class="card overflow-hidden">
      <div class="card-header">
        <h2 class="card-title">Fournisseur et prix d’achat</h2>
        @if (bandPct() !== null) {
          <span class="text-[11px] text-ink-faint">bande ±{{ bandPct() }} %</span>
        }
      </div>

      @if (prices().length === 0) {
        <p class="empty">
          Aucun prix fournisseur validé par le DG pour ce produit.<br />
          L’affaire ne pourra pas être approuvée tant qu’un prix n’est pas publié.
        </p>
      } @else {
        <div class="overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th style="width: 34px"></th>
                <th>Fournisseur</th>
                <th class="num">Prix validé</th>
                <th class="num">Bande admise</th>
                <th class="num">Délai</th>
                <th class="num">Portage</th>
                <th>Validé par</th>
              </tr>
            </thead>
            <tbody>
              @for (p of prices(); track p.supplierPriceId) {
                <tr [class]="chosen() === p.supplierPriceId ? 'bg-primary-wash' : ''">
                  <td>
                    <input
                      type="radio"
                      name="fournisseur"
                      class="accent-[var(--primary)]"
                      [value]="p.supplierPriceId"
                      [checked]="chosen() === p.supplierPriceId"
                      [attr.aria-label]="'Retenir ' + p.supplierName"
                      (change)="choose(p)"
                    />
                  </td>
                  <td class="font-medium text-ink">
                    {{ p.supplierName }}
                    @if (p.sourceLabel) {
                      <span class="ml-1.5 text-[11px] text-ink-faint">{{ p.sourceLabel }}</span>
                    }
                  </td>
                  <td class="num font-mono font-semibold text-ink">{{ n(p.unitPrice) }}</td>
                  <td class="num font-mono text-[12px] text-ink-muted">
                    {{ n(p.bandMin) }} – {{ n(p.bandMax) }}
                  </td>
                  <td class="num font-mono text-[12px] text-ink-soft">{{ terms(p) }}</td>
                  <td class="num font-mono text-[12px] text-ink-soft">
                    {{ n(p.carryingPerUnit) }}
                  </td>
                  <td class="text-[12px] text-ink-soft">{{ p.validatedBy ?? '-' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (chosen()) {
          <div class="border-t border-rule px-[15px] py-3">
            <div class="flex flex-wrap items-end gap-4">
              <div>
                <label class="label" for="retenu">Prix retenu</label>
                <input
                  id="retenu"
                  class="field w-40 text-right font-mono"
                  inputmode="decimal"
                  [(ngModel)]="retained"
                  (ngModelChange)="onPriceChange()"
                />
              </div>
              <p class="pb-2 text-[12px]" [class]="outOfBand() ? 'text-warn-ink' : 'text-ok'">
                @if (outOfBand()) {
                  <erp-icon name="alert-triangle" [size]="12" class="mr-1 inline" />
                  Hors bande : motif exigé, et dérogation du DG pour approuver.
                } @else {
                  <erp-icon name="check-circle" [size]="12" class="mr-1 inline" />
                  Dans la bande admise.
                }
              </p>
            </div>

            @if (outOfBand()) {
              <div class="mt-3">
                <label class="label" for="motif-prix">Motif de l’écart</label>
                <input
                  id="motif-prix"
                  class="field"
                  [(ngModel)]="varianceReason"
                  placeholder="Pourquoi retenir un prix différent de celui validé ?"
                />
              </div>
            }

            <button class="btn-primary mt-3" (click)="attach()" [disabled]="busy()">
              {{ busy() ? 'Enregistrement…' : 'Retenir ce fournisseur' }}
            </button>
          </div>
        }
      }

      <!-- ================= Étapes d'approbation ================= -->
      <div class="border-t border-rule px-[15px] py-3">
        <h3 class="mb-2 text-[13px] font-semibold text-ink">Circuit d’approbation</h3>

        <ol class="mb-4 space-y-1.5 text-[13px]">
          <li class="flex items-center gap-2" [class]="stepClass(deal.status !== 'DRAFT')">
            <erp-icon
              [name]="deal.status !== 'DRAFT' ? 'check-circle' : 'clock'"
              [size]="13"
            />
            Soumission au contrôle du risque : <em>chargé d’affaire</em>
          </li>
          <li class="flex items-center gap-2" [class]="stepClass(!!deal.creditApprovedBy)">
            <erp-icon [name]="deal.creditApprovedBy ? 'check-circle' : 'clock'" [size]="13" />
            Approbation financière : <em>directeur financier</em>
            @if (deal.creditApprovedBy) {
              <span class="text-ink-muted">· {{ deal.creditApprovedBy.fullName }}</span>
            }
          </li>
          @if (deal.thresholds.belowMinimumMargin || deal.dgApprovedBy) {
            <li class="flex items-center gap-2" [class]="stepClass(!!deal.dgApprovedBy)">
              <erp-icon [name]="deal.dgApprovedBy ? 'check-circle' : 'lock'" [size]="13" />
              Accord du DG : marge sous le seuil
              @if (deal.dgApprovedBy) {
                <span class="text-ink-muted">· {{ deal.dgApprovedBy.fullName }}</span>
              }
            </li>
          }
        </ol>

        @if (error()) {
          <div
            class="mb-3 flex items-start gap-2 rounded-[3px] bg-crit-wash px-3 py-2
                   text-[13px] text-crit"
            role="alert"
          >
            <erp-icon name="alert-triangle" [size]="14" class="mt-0.5 shrink-0" />
            <span>{{ error() }}</span>
          </div>
        }
        @if (done()) {
          <p
            class="mb-3 flex items-center gap-2 rounded-[3px] bg-ok-wash px-3 py-2
                   text-[13px] text-ok"
            role="status"
          >
            <erp-icon name="check-circle" [size]="14" />
            {{ done() }}
          </p>
        }

        <div class="flex flex-wrap gap-2">
          @if (can('SALES_REP', 'CCOO') && deal.status === 'DRAFT') {
            <button class="btn-primary" (click)="run('submit')" [disabled]="busy()">
              Soumettre au risque
            </button>
          }
          @if (can('FINANCE_CFO', 'DG') && !deal.creditApprovedBy) {
            <button class="btn-primary" (click)="run('approve')" [disabled]="busy()">
              Approuver
            </button>
          }
          @if (can('DG') && deal.thresholds.belowMinimumMargin && !deal.dgApprovedBy) {
            <button class="btn-ghost" (click)="run('dg')" [disabled]="busy()">
              Donner l’accord du DG
            </button>
          }
          <button class="btn-ghost" (click)="run('recompute')" [disabled]="busy()">
            <erp-icon name="gauge" [size]="14" />
            Recalculer la marge
          </button>
        </div>

        <p class="mt-3 text-[11px] leading-relaxed text-ink-faint">
          Un bouton visible ne préjuge pas du résultat : les seuils, le sourçage du prix et la
          bande de tolérance sont appliqués au moment de l’écriture. Un refus
          revient avec son motif.
        </p>
      </div>
    </section>
  `,
})
export class DealActionsComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  @Input({ required: true }) deal!: DealDetail;
  @Output() readonly changed = new EventEmitter<void>();

  protected readonly prices = signal<SupplierPriceOption[]>([]);
  protected readonly bandPct = signal<number | null>(null);
  protected readonly chosen = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly done = signal<string | null>(null);

  protected retained: number | null = null;
  protected varianceReason = '';

  private loaded = false;

  ngOnChanges(): void {
    if (this.loaded || !this.deal?.id) return;
    this.loaded = true;
    this.api.dealSupplierPrices(this.deal.id).subscribe((r) => {
      this.prices.set(r.prix);
      this.bandPct.set(r.bandPct);
      this.chosen.set(r.selectedSupplierPriceId);
      if (r.retainedUnitPrice > 0) this.retained = r.retainedUnitPrice;
    });
  }

  protected can(...roles: string[]): boolean {
    const r = this.auth.role();
    return r !== null && roles.includes(r);
  }

  /** Retenir le prix du fournisseur doit être le geste par défaut. */
  protected choose(p: SupplierPriceOption): void {
    this.chosen.set(p.supplierPriceId);
    this.retained = p.unitPrice;
    this.varianceReason = '';
    this.error.set(null);
  }

  protected onPriceChange(): void {
    this.error.set(null);
  }

  private current(): SupplierPriceOption | null {
    return this.prices().find((p) => p.supplierPriceId === this.chosen()) ?? null;
  }

  /**
   * Les comparaisons vivent ici, jamais dans l'interpolation : le parseur de
   * template Angular lit « < » comme une ouverture de balise.
   */
  protected outOfBand(): boolean {
    const p = this.current();
    if (!p || this.retained === null) return false;
    return this.retained < p.bandMin || this.retained > p.bandMax;
  }

  protected terms(p: SupplierPriceOption): string {
    if (p.supplierTermsDays < 0) return `prépaie ${Math.abs(p.supplierTermsDays)} j`;
    if (p.supplierTermsDays === 0) return 'comptant';
    return `${p.supplierTermsDays} j`;
  }

  protected n(v: number): string {
    return grouper(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected stepClass(done: boolean): string {
    return done ? 'text-ok' : 'text-ink-muted';
  }

  protected attach(): void {
    const p = this.current();
    if (!p || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.done.set(null);

    this.api
      .attachSupplierPrice(this.deal.id, {
        supplierPriceId: p.supplierPriceId,
        unitPurchasePrice: this.retained ?? undefined,
        varianceReason: this.varianceReason || undefined,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.done.set('Fournisseur retenu : la marge est recalculée.');
          this.changed.emit();
        },
        error: (e: HttpFailure) => this.fail(e),
      });
  }

  protected run(step: 'submit' | 'approve' | 'dg' | 'recompute'): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.done.set(null);

    const calls = {
      submit: () => this.api.submitDeal(this.deal.id),
      approve: () => this.api.approveDeal(this.deal.id),
      dg: () => this.api.grantDgApproval(this.deal.id),
      recompute: () => this.api.recomputeDeal(this.deal.id),
    };
    const labels = {
      submit: 'Affaire soumise au contrôle du risque.',
      approve: 'Affaire approuvée.',
      dg: 'Accord du DG enregistré.',
      recompute: 'Marge recalculée.',
    };

    calls[step]().subscribe({
      next: () => {
        this.busy.set(false);
        this.done.set(labels[step]);
        this.changed.emit();
      },
      error: (e: HttpFailure) => this.fail(e),
    });
  }

  private fail(e: HttpFailure): void {
    this.busy.set(false);
    const m = e.error?.message;
    this.error.set(Array.isArray(m) ? m[0] : (m ?? 'Opération refusée.'));
  }
}
