import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService, DealDetail } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { DerogationInlineComponent } from '../shared/derogation-inline.component';
import { IconComponent } from '../shared/icon.component';

/** Refus renvoyé par l'API — la validation rend un tableau, le métier une chaîne. */
interface HttpFailure {
  error?: { message?: string | string[] };
}

/**
 * Circuit d'approbation d'une affaire (§ 11.2).
 *
 * Les boutons ne préjugent de rien. La base seule décide, et un refus revient
 * avec son motif — plancher de marge, prix hors bande, absence de prix
 * sourcé. Dupliquer la règle ici la rendrait affaiblissable par un futur
 * changement de code sans que personne ne s'en aperçoive.
 *
 * Dernière étape de la fiche affaire — après Fournisseur et prix d'achat et
 * Chiffrage des coûts.
 */
@Component({
  selector: 'erp-deal-approval',
  standalone: true,
  imports: [IconComponent, DerogationInlineComponent],
  template: `
    <section class="card overflow-hidden">
      <div class="card-header"><h2 class="card-title">Circuit d’approbation</h2></div>
      <div class="card-body">
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

        <!-- ============ Dérogations rattachées à l'approbation (§ 11.4) ============
             ⚠️ CORRIGÉ — SANS CE BLOC, LES TROIS DÉROGATIONS QUE approve() PEUT
                INVOQUER N'AVAIENT AUCUN CHEMIN POUR ÊTRE ACCORDÉES. La marge sous le
                plancher direct se détecte à l'avance (belowDirectFloor) ; le prix
                d'achat hors bande et le dépassement d'encours ne sont pas exposés ici
                à l'avance — le repli est de les proposer sous un bouton, pour le jour
                où l'approbation les réclame. -->
        @if (can('FINANCE_CFO', 'DG') && !deal.creditApprovedBy) {
          @if (can('DG') && deal.thresholds.belowDirectFloor && !marginDerogationId()) {
            <div class="mb-3">
              <erp-derogation-inline
                type="MARGIN_BELOW_DIRECT_FLOOR"
                subjectType="Deal"
                [subjectId]="deal.reference"
                [subjectLabel]="deal.reference"
                titre="Marge directe sous le plancher : dérogation du DG obligatoire"
                (accorde)="marginDerogationId.set($event)"
              />
            </div>
          }

          <button
            type="button"
            class="link mb-2 text-[12px]"
            (click)="showDerogationsComplementaires.set(!showDerogationsComplementaires())"
          >
            {{ showDerogationsComplementaires() ? 'Masquer' : 'Joindre' }} une dérogation de prix
            d’achat ou de plafond de crédit
          </button>
          @if (showDerogationsComplementaires()) {
            <div class="mb-3 space-y-2">
              @if (!purchasePriceDerogationId()) {
                <erp-derogation-inline
                  type="PURCHASE_PRICE_VARIANCE"
                  subjectType="Deal"
                  [subjectId]="deal.reference"
                  [subjectLabel]="deal.reference"
                  titre="Prix d’achat hors bande de tolérance"
                  (accorde)="purchasePriceDerogationId.set($event)"
                />
              } @else {
                <p class="flex items-center gap-2 rounded-[3px] bg-ok-wash px-3 py-2 text-[12px] text-ok">
                  <erp-icon name="check-circle" [size]="13" />
                  Dérogation de prix d’achat jointe.
                </p>
              }
              @if (!creditDerogationId()) {
                <erp-derogation-inline
                  type="CREDIT_LIMIT_OVERRIDE"
                  subjectType="Deal"
                  [subjectId]="deal.reference"
                  [subjectLabel]="deal.reference"
                  titre="Approbation au-delà du plafond de crédit du client"
                  (accorde)="creditDerogationId.set($event)"
                />
              } @else {
                <p class="flex items-center gap-2 rounded-[3px] bg-ok-wash px-3 py-2 text-[12px] text-ok">
                  <erp-icon name="check-circle" [size]="13" />
                  Dérogation de plafond de crédit jointe.
                </p>
              }
            </div>
          }
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
          @if (can('SALES_REP', 'CCOO') && deal.status === 'DRAFT') {
            <button
              class="btn-ghost ml-auto text-crit"
              (click)="showDeleteConfirm.set(!showDeleteConfirm())"
              [disabled]="busy()"
            >
              <erp-icon name="trash-2" [size]="14" />
              Supprimer le brouillon
            </button>
          }
        </div>

        @if (showDeleteConfirm()) {
          <div class="mt-4 rounded-[3px] border border-crit/30 bg-crit-wash px-3 py-3">
            <h3 class="mb-1 text-[13px] font-semibold text-crit">
              Supprimer {{ deal.reference }} ?
            </h3>
            <p class="mb-2 text-[12px] text-ink-soft">
              Cette affaire n’a encore engagé aucune décision : rien ne se supprime au-delà du
              brouillon lui-même. L’action est définitive.
            </p>
            <div class="flex gap-2">
              <button
                class="btn-ghost border-crit/50 text-crit"
                (click)="deleteDraft()"
                [disabled]="busy()"
              >
                Confirmer la suppression
              </button>
              <button class="btn-ghost" (click)="showDeleteConfirm.set(false)" [disabled]="busy()">
                Annuler
              </button>
            </div>
          </div>
        }

        <p class="mt-3 text-[11px] leading-relaxed text-ink-faint">
          Un bouton visible ne préjuge pas du résultat : les seuils, le sourçage du prix et la
          bande de tolérance sont appliqués au moment de l’écriture. Un refus
          revient avec son motif.
        </p>
      </div>
    </section>
  `,
})
export class DealApprovalComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  @Input({ required: true }) deal!: DealDetail;
  @Output() readonly changed = new EventEmitter<void>();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly done = signal<string | null>(null);
  protected readonly showDeleteConfirm = signal(false);

  /** Dérogations jointes à l'approbation en cours — vidées à chaque succès. */
  protected readonly marginDerogationId = signal<string | null>(null);
  protected readonly purchasePriceDerogationId = signal<string | null>(null);
  protected readonly creditDerogationId = signal<string | null>(null);
  protected readonly showDerogationsComplementaires = signal(false);

  protected can(...roles: string[]): boolean {
    const r = this.auth.role();
    return r !== null && roles.includes(r);
  }

  protected stepClass(done: boolean): string {
    return done ? 'text-ok' : 'text-ink-muted';
  }

  protected run(step: 'submit' | 'approve' | 'dg' | 'recompute'): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.done.set(null);

    const calls = {
      submit: () => this.api.submitDeal(this.deal.id),
      approve: () =>
        this.api.approveDeal(this.deal.id, {
          ...(this.marginDerogationId() ? { marginDerogationId: this.marginDerogationId()! } : {}),
          ...(this.purchasePriceDerogationId()
            ? { purchasePriceDerogationId: this.purchasePriceDerogationId()! }
            : {}),
          ...(this.creditDerogationId() ? { creditDerogationId: this.creditDerogationId()! } : {}),
        }),
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

  protected deleteDraft(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);

    this.api.deleteDeal(this.deal.id).subscribe({
      next: () => this.router.navigateByUrl('/affaires'),
      error: (e: HttpFailure) => this.fail(e),
    });
  }

  private fail(e: HttpFailure): void {
    this.busy.set(false);
    const m = e.error?.message;
    this.error.set(Array.isArray(m) ? m[0] : (m ?? 'Opération refusée.'));
  }
}
