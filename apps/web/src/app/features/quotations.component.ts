import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, QuotationRequestInternalRow } from '../core/api.service';
import { ActionFeedbackComponent, ActionState, HttpFailure } from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';
import { dateOnly, grouper } from '../shared/format';

const STATUS_LABEL: Record<string, string> = {
  NEW: 'Nouvelle',
  IN_REVIEW: 'En étude',
  CONVERTED: 'Convertie',
  DECLINED: 'Déclinée',
};

const STATUS_BADGE: Record<string, string> = {
  NEW: 'badge-wait',
  IN_REVIEW: 'badge-transit',
  CONVERTED: 'badge-ok',
  DECLINED: 'badge-blocked',
};

/**
 * DEMANDES DE COTATION REÇUES DU PORTAIL (§ 13, module 0).
 *
 * Pas de bouton « convertir en affaire » : la création d'affaire — prix,
 * coûts, prix fournisseur — n'existe pas encore comme écran (constat de
 * clôture, à traiter séparément). Cet écran ouvre au moins la LECTURE : sans
 * lui, une demande envoyée depuis le portail ne ressortait nulle part.
 */
@Component({
  selector: 'erp-quotations',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, ActionFeedbackComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Demandes de cotation</h1>
      <p class="page-sub">Déposées depuis le portail client. Étudiez-les puis créez l'affaire par la voie habituelle.</p>
    </header>

    <erp-action-feedback [error]="state.error()" [success]="state.done()" />

    <div class="mb-4 flex gap-2">
      @for (f of filtres; track f.value) {
        <button
          class="btn-ghost !h-8 !px-3 text-[12px]"
          [class.border-primary]="filtre() === f.value"
          [class.text-primary]="filtre() === f.value"
          (click)="appliquerFiltre(f.value)"
        >
          {{ f.label }}
        </button>
      }
    </div>

    @if (chargement()) {
      <p class="text-[13px] text-ink-muted">Lecture…</p>
    } @else if (demandes().length === 0) {
      <div class="card px-[15px] py-4">
        <p class="text-[13px] text-ink-soft">Aucune demande dans ce filtre.</p>
      </div>
    } @else {
      <div class="card overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>Déposée le</th>
              <th>Client</th>
              <th>Contact</th>
              <th>Produit</th>
              <th class="num">Volume</th>
              <th>Échéance</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (d of demandes(); track d.id) {
              <tr>
                <td class="font-mono text-[12px] text-ink-soft">{{ dateOnly(d.createdAt) }}</td>
                <td class="ref">{{ d.partner.legalName }}</td>
                <td class="text-ink-soft">{{ d.submittedByPortalUser.email }}</td>
                <td class="text-ink-soft">{{ d.product.name }}</td>
                <td class="num font-mono text-ink-soft">{{ grouper(+d.desiredVolume) }} {{ d.uom }}</td>
                <td class="font-mono text-[12px] text-ink-soft">{{ dateOnly(d.desiredDeliveryDate) }}</td>
                <td><span [class]="badge(d.status)">{{ label(d.status) }}</span></td>
                <td class="whitespace-nowrap">
                  @if (d.status === 'NEW') {
                    <button class="link text-[12px]" (click)="enEtude(d)" [disabled]="state.busy()">En étude</button>
                  }
                  @if (d.status === 'NEW' || d.status === 'IN_REVIEW') {
                    <button class="link ml-3 text-[12px] text-crit" (click)="ouvrirDecline(d)" [disabled]="state.busy()">
                      Décliner
                    </button>
                  }
                  @if (d.convertedDeal) {
                    <a [routerLink]="['/affaires', d.convertedDeal.id]" class="link text-[12px]">
                      {{ d.convertedDeal.reference }} →
                    </a>
                  }
                </td>
              </tr>
              @if (d.message) {
                <tr>
                  <td colspan="8" class="!pt-0 !pb-3 text-[12px] italic text-ink-faint">« {{ d.message }} »</td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    }

    @if (declineCible(); as cible) {
      <div class="mt-4 max-w-md rounded-[3px] border border-crit/30 bg-crit-wash px-3 py-3">
        <h3 class="mb-2 text-[13px] font-semibold text-crit">Décliner la demande de {{ cible.partner.legalName }}</h3>
        <label class="label" for="motif">Motif (obligatoire)</label>
        <input id="motif" class="field" [(ngModel)]="declineReason" placeholder="Pourquoi cette demande n'est pas suivie" />
        <div class="mt-3 flex gap-2">
          <button class="btn-ghost border-crit/50 text-crit" (click)="confirmerDecline()" [disabled]="state.busy() || !declineReason.trim()">
            Confirmer
          </button>
          <button class="btn-ghost" (click)="declineCible.set(null)">Annuler</button>
        </div>
      </div>
    }
  `,
})
export class QuotationsComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly state = new ActionState();
  protected readonly chargement = signal(true);
  protected readonly demandes = signal<QuotationRequestInternalRow[]>([]);
  protected readonly filtre = signal<string | undefined>(undefined);
  protected readonly declineCible = signal<QuotationRequestInternalRow | null>(null);
  protected declineReason = '';

  protected readonly filtres = [
    { value: undefined, label: 'Toutes' },
    { value: 'NEW', label: 'Nouvelles' },
    { value: 'IN_REVIEW', label: 'En étude' },
    { value: 'CONVERTED', label: 'Converties' },
    { value: 'DECLINED', label: 'Déclinées' },
  ];

  protected readonly dateOnly = dateOnly;
  protected readonly grouper = (v: number) => grouper(v, { maximumFractionDigits: 3 });

  protected label(status: string): string {
    return STATUS_LABEL[status] ?? status;
  }
  protected badge(status: string): string {
    return STATUS_BADGE[status] ?? 'badge-neutral';
  }

  ngOnInit(): void {
    this.load();
  }

  protected appliquerFiltre(value: string | undefined): void {
    this.filtre.set(value);
    this.load();
  }

  private load(): void {
    this.chargement.set(true);
    this.api.quotations(this.filtre()).subscribe((rows) => {
      this.demandes.set(rows);
      this.chargement.set(false);
    });
  }

  protected enEtude(d: QuotationRequestInternalRow): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api.markQuotationInReview(d.id).subscribe({
      next: () => {
        this.state.succeed('Marquée en étude.');
        this.load();
      },
      error: (e: HttpFailure) => this.state.fail(e),
    });
  }

  protected ouvrirDecline(d: QuotationRequestInternalRow): void {
    this.declineReason = '';
    this.declineCible.set(d);
  }

  protected confirmerDecline(): void {
    const cible = this.declineCible();
    if (!cible || !this.declineReason.trim() || this.state.busy()) return;
    this.state.start();
    this.api.declineQuotation(cible.id, this.declineReason.trim()).subscribe({
      next: () => {
        this.state.succeed('Demande déclinée.');
        this.declineCible.set(null);
        this.load();
      },
      error: (e: HttpFailure) => this.state.fail(e),
    });
  }
}
