import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, DealDetail, DealRow } from '../core/api.service';
import { ActionFeedbackComponent, ActionState, HttpFailure } from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';
import { dateOnly, grouper } from '../shared/format';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'En préparation',
  FEASIBILITY_STUDY: 'À l’étude',
  QUOTED: 'Chiffrée',
  PENDING_RISK: 'En instruction',
  CREDIT_BLOCKED: 'En instruction',
  PENDING_DG_APPROVAL: 'En instruction',
  APPROVED: 'Approuvée',
  PROFORMA_SENT: 'Proforma envoyée',
  CUSTOMER_ACCEPTED: 'Acceptée',
  REJECTED_BY_CLIENT: 'Déclinée',
  IN_EXECUTION: 'En cours d’exécution',
  DELIVERED: 'Livrée',
  PARTIALLY_DELIVERED: 'Partiellement livrée',
  QUALITY_CLAIM: 'Réclamation qualité en cours',
  INVOICED: 'Facturée',
  DISPUTED: 'Litige en cours',
  CLOSED: 'Clôturée',
  CANCELLED: 'Annulée',
};

const STATUS_BADGE: Record<string, string> = {
  PROFORMA_SENT: 'badge-wait',
  CUSTOMER_ACCEPTED: 'badge-ok',
  APPROVED: 'badge-transit',
  IN_EXECUTION: 'badge-transit',
  DELIVERED: 'badge-ok',
  PARTIALLY_DELIVERED: 'badge-transit',
  INVOICED: 'badge-ok',
  CLOSED: 'badge-neutral',
  REJECTED_BY_CLIENT: 'badge-blocked',
  DISPUTED: 'badge-blocked',
  QUALITY_CLAIM: 'badge-blocked',
  CANCELLED: 'badge-blocked',
};

function label(status: string): string {
  return STATUS_LABEL[status] ?? status;
}
function badge(status: string): string {
  return STATUS_BADGE[status] ?? 'badge-neutral';
}

@Component({
  selector: 'erp-portal-affaires',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Affaires</h1>
      <p class="page-sub">L'ensemble de vos affaires auprès d'Elyon Trading.</p>
    </header>

    @if (chargement()) {
      <p class="text-[13px] text-ink-muted">Lecture…</p>
    } @else if (deals().length === 0) {
      <div class="card px-[15px] py-4">
        <p class="text-[13px] text-ink-soft">Aucune affaire pour le moment.</p>
      </div>
    } @else {
      <div class="card overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>Affaire</th>
              <th>Produit</th>
              <th class="num">Volume</th>
              <th>Incoterm</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (d of deals(); track d.id) {
              <tr>
                <td class="ref">{{ d.reference }}</td>
                <td class="text-ink-soft">{{ d.product.name }}</td>
                <td class="num font-mono text-ink-soft">{{ grouper(+d.contractedVolume) }} {{ d.uom }}</td>
                <td class="text-ink-soft">{{ d.incoterm }}</td>
                <td><span [class]="badge(d.status)">{{ label(d.status) }}</span></td>
                <td>
                  <a [routerLink]="[d.id]" class="link text-[12px]">Consulter →</a>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class AffairesComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly chargement = signal(true);
  protected readonly deals = signal<DealRow[]>([]);
  protected readonly grouper = (v: number) => grouper(v, { maximumFractionDigits: 3 });
  protected readonly label = label;
  protected readonly badge = badge;

  ngOnInit(): void {
    this.api.deals({ pageSize: 100 }).subscribe((p) => {
      this.deals.set(p.items);
      this.chargement.set(false);
    });
  }
}

const OP_STATUS_LABEL: Record<string, string> = {
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

@Component({
  selector: 'erp-portal-affaire-detail',
  standalone: true,
  imports: [RouterLink, IconComponent, ActionFeedbackComponent],
  template: `
    @if (deal(); as d) {
      <header class="mb-6 flex items-start justify-between gap-4">
        <div>
          <p class="mb-1 text-[12px] text-ink-faint">
            <a routerLink="/affaires" class="link">Affaires</a> / {{ d.reference }}
          </p>
          <h1 class="page-title">{{ d.reference }}</h1>
          <p class="page-sub">{{ d.product.name }} · {{ d.incoterm }} · {{ d.transportMode }}</p>
        </div>
        <span [class]="badge(d.status)">{{ label(d.status) }}</span>
      </header>

      <erp-action-feedback [error]="state.error()" [success]="state.done()" />

      @if (d.status === 'PROFORMA_SENT') {
        <div class="card mb-6 border-l-4 !border-l-primary px-[15px] py-4">
          <p class="mb-3 text-[13px] text-ink-soft">
            La proforma de cette affaire vous a été envoyée et attend votre acceptation.
          </p>
          <button class="btn-primary" (click)="accepter()" [disabled]="state.busy()">
            <erp-icon name="check-circle" [size]="14" />
            {{ state.busy() ? 'Envoi…' : 'Accepter la proforma' }}
          </button>
        </div>
      }

      <section class="card overflow-hidden">
        <div class="card-header">
          <h2 class="card-title">Détail</h2>
        </div>
        <div class="card-body">
          <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-3">
            <div>
              <dt class="text-[11px] uppercase tracking-[0.5px] text-ink-muted">Volume contracté</dt>
              <dd class="font-mono text-ink">{{ grouper(+d.contractedVolume) }} {{ d.uom }}</dd>
            </div>
            <div>
              <dt class="text-[11px] uppercase tracking-[0.5px] text-ink-muted">Devise</dt>
              <dd class="text-ink">{{ d.currencyCode }}</dd>
            </div>
            <div>
              <dt class="text-[11px] uppercase tracking-[0.5px] text-ink-muted">Créée le</dt>
              <dd class="text-ink">{{ dateOnly(d.createdAt) }}</dd>
            </div>
            @if (d.acceptedAt) {
              <div>
                <dt class="text-[11px] uppercase tracking-[0.5px] text-ink-muted">Acceptée le</dt>
                <dd class="text-ink">{{ dateOnly(d.acceptedAt) }}</dd>
              </div>
            }
          </dl>
        </div>
      </section>

      <section class="card mt-5 overflow-hidden">
        <div class="card-header">
          <h2 class="card-title">Livraisons</h2>
        </div>
        @if (d.operations.length === 0) {
          <p class="empty">Aucune opération planifiée pour le moment.</p>
        } @else {
          <table class="table">
            <thead>
              <tr>
                <th>Opération</th>
                <th class="num">Volume</th>
                <th>Statut</th>
                <th>Créée le</th>
              </tr>
            </thead>
            <tbody>
              @for (o of d.operations; track o.id) {
                <tr>
                  <td class="ref">{{ o.reference }}</td>
                  <td class="num font-mono text-ink-soft">{{ grouper(+o.plannedVolume) }} {{ o.uom }}</td>
                  <td class="text-ink-soft">{{ opLabel(o.status) }}</td>
                  <td class="font-mono text-[12px] text-ink-soft">{{ dateOnly(o.createdAt) }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    } @else if (chargement()) {
      <p class="text-[13px] text-ink-muted">Lecture…</p>
    } @else {
      <div class="card px-[15px] py-4">
        <p class="text-[13px] text-crit">Affaire introuvable.</p>
      </div>
    }
  `,
})
export class DealDetailComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  protected readonly state = new ActionState();
  protected readonly chargement = signal(true);
  protected readonly deal = signal<DealDetail | null>(null);

  protected readonly grouper = (v: number) => grouper(v, { maximumFractionDigits: 3 });
  protected readonly dateOnly = dateOnly;
  protected readonly label = label;
  protected readonly badge = badge;
  protected opLabel(status: string): string {
    return OP_STATUS_LABEL[status] ?? status;
  }

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.chargement.set(true);
    this.api.deal(id).subscribe({
      next: (d) => {
        this.deal.set(d);
        this.chargement.set(false);
      },
      error: () => this.chargement.set(false),
    });
  }

  protected accepter(): void {
    const d = this.deal();
    if (!d || this.state.busy()) return;
    this.state.start();
    this.api.acceptDeal(d.id).subscribe({
      next: () => {
        this.state.succeed('Proforma acceptée.');
        this.load();
      },
      error: (e: HttpFailure) => this.state.fail(e),
    });
  }
}
