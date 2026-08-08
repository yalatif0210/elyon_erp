import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService, Derogation } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { IconComponent } from '../shared/icon.component';
import { StatusBadgeComponent } from '../shared/status-badge.component';
import { dateOnly } from '../shared/format';

const TYPE_LABELS: Record<string, string> = {
  MARGIN_BELOW_THRESHOLD: 'Marge sous le seuil',
  MARGIN_BELOW_DIRECT_FLOOR: 'Plancher direct franchi',
  HSE_BLOCKING_OVERRIDE: 'Levée de contrôle HSE',
  TRANSPORT_NON_COMPLIANCE: 'Moyen non conforme',
  HSE_DELEGATION: 'Suppléance HSE',
  ULLAGE_ACKNOWLEDGEMENT: "Acquittement d'écart de volume",
  OTHER: 'Autre',
};

/**
 * Registre des dérogations — SPECIFICATIONS.md § 11.4.
 *
 * Registre unique pour les trois verrous et la suppléance HSE. C'est la pièce
 * qu'un auditeur ou un assureur demandera à consulter après un incident : elle
 * doit être lisible, complète, et montrer qui a autorisé quoi et pourquoi.
 */
@Component({
  selector: 'erp-derogations',
  standalone: true,
  imports: [IconComponent, StatusBadgeComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Registre des dérogations</h1>
      <p class="page-sub">
        Verrous financier, HSE et conformité — toute levée y figure, avec son autorité et son motif.
      </p>
    </header>

    <!-- Revue mensuelle : les dérogations exceptionnelles ne doivent pas
         se perdre dans la masse. -->
    @if (pending().length > 0) {
      <section class="card mb-5 border-warn/40">
        <div class="card-header border-warn/30">
          <h2 class="card-title flex items-center gap-2 text-warn-ink">
            <erp-icon name="alert-triangle" [size]="15" />
            En attente de revue mensuelle
          </h2>
          <span class="text-[12px] text-warn-ink/70">{{ pending().length }}</span>
        </div>
        <div class="overflow-x-auto">
          <table class="table">
            <thead>
              <tr><th>Type</th><th>Objet</th><th>Autorité</th><th class="num">Accordée le</th><th></th></tr>
            </thead>
            <tbody>
              @for (d of pending(); track d.id) {
                <tr>
                  <td class="text-ink">{{ typeLabel(d.type) }}</td>
                  <td class="text-ink-soft">{{ d.subjectLabel ?? d.subjectType }}</td>
                  <td class="text-ink-soft">{{ d.authority?.fullName }}</td>
                  <td class="num text-ink-muted">{{ dateOnly(d.grantedAt) }}</td>
                  <td class="text-right">
                    @if (isDg()) {
                      <button class="btn-ghost px-2 py-1 text-[12px]" (click)="review(d)">Marquer revue</button>
                <button class="link ml-2 text-[12px]" (click)="revoke(d.id)">Révoquer</button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }

    <div class="card overflow-x-auto">
      <div class="card-header">
        <h2 class="card-title">Toutes les dérogations</h2>
        <span class="text-[12px] text-ink-faint">{{ total() }} enregistrée(s)</span>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Type</th><th>Objet</th><th>Motif</th><th>Autorité</th>
            <th class="num">Accordée le</th><th>État</th>
          </tr>
        </thead>
        <tbody>
          @for (d of rows(); track d.id) {
            <tr>
              <td>
                <span class="text-ink">{{ typeLabel(d.type) }}</span>
                @if (d.requiresMonthlyReview) {
                  <span class="ml-2 rounded bg-warn-wash px-1.5 py-0.5 text-[10px] text-warn-ink">
                    exceptionnelle
                  </span>
                }
              </td>
              <td class="text-ink-soft">{{ d.subjectLabel ?? d.subjectType }}</td>
              <td class="max-w-xs truncate text-ink-muted" [title]="d.reason">{{ d.reason }}</td>
              <td class="text-ink-soft">
                {{ d.authority?.fullName }}
                <span class="ml-1 text-[11px] text-ink-faint">{{ d.authority?.role }}</span>
              </td>
              <td class="num text-ink-muted">{{ dateOnly(d.grantedAt) }}</td>
              <td>
                @if (d.status === 'ACTIVE') {
                  <erp-status-badge kind="wait" label="Active" />
                } @else if (d.status === 'REVOKED') {
                  <erp-status-badge kind="blocked" label="Révoquée" />
                } @else {
                  <erp-status-badge kind="neutral" [label]="d.status" />
                }
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="6" class="empty">
                Aucune dérogation enregistrée. Les verrous n'ont jamais eu besoin d'être levés.
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class DerogationsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  protected readonly rows = signal<Derogation[]>([]);
  protected readonly pending = signal<Derogation[]>([]);
  protected readonly total = signal(0);

  ngOnInit(): void {
    this.load();
  }

  protected readonly dateOnly = dateOnly;

  protected isDg(): boolean {
    return this.auth.hasRole('DG');
  }

  protected typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  protected review(d: Derogation): void {
    this.api.markReviewed(d.id).subscribe(() => this.load());
  }

  /**
   * Révocation d'une dérogation.
   *
   * Une exception devenue injustifiée doit pouvoir être retirée : la laisser
   * courir reviendrait à maintenir une entorse que plus personne n'assume.
   */
  protected revoke(id: string): void {
    this.api.revokeDerogation(id).subscribe({
      next: () => this.load(),
      error: () => this.load(),
    });
  }

  private load(): void {
    this.api.derogations().subscribe((page) => {
      this.rows.set(page.items);
      this.total.set(page.total);
    });
    // La revue mensuelle est réservée au DG et au CFO : on n'appelle pas
    // l'endpoint pour les autres, qui recevraient un 403 inutile.
    if (this.auth.hasRole('DG', 'FINANCE_CFO')) {
      this.api.derogationsPendingReview().subscribe((rows) => this.pending.set(rows));
    }
  }
}
