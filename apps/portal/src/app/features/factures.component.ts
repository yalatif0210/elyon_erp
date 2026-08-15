import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService, InvoiceRow } from '../core/api.service';
import { IconComponent } from '../shared/icon.component';
import { dateOnly, grouper } from '../shared/format';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'En préparation',
  ISSUED: 'Émise',
  PARTIALLY_PAID: 'Partiellement réglée',
  PAID: 'Réglée',
  OVERDUE: 'Échue',
  DISPUTED: 'En litige',
  CANCELLED: 'Annulée',
};

const STATUS_BADGE: Record<string, string> = {
  ISSUED: 'badge-wait',
  PARTIALLY_PAID: 'badge-transit',
  PAID: 'badge-ok',
  OVERDUE: 'badge-blocked',
  DISPUTED: 'badge-blocked',
  CANCELLED: 'badge-neutral',
};

const TYPE_LABEL: Record<string, string> = {
  PROFORMA: 'Proforma',
  SIMPLE: 'Facture',
  FNE: 'Facture normalisée (FNE)',
  CREDIT_NOTE: 'Avoir',
};

/**
 * Factures — le PDF scellé se télécharge, jamais le brouillon (§ 9). Une
 * facture sans document scellé listé n'a rien à montrer : c'est attendu, la
 * génération de la pièce est asynchrone et peut ne pas être encore passée.
 */
@Component({
  selector: 'erp-portal-factures',
  standalone: true,
  imports: [IconComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Factures</h1>
      <p class="page-sub">Vos factures émises par Elyon Trading. Les avoirs n'apparaissent pas ici.</p>
    </header>

    @if (chargement()) {
      <p class="text-[13px] text-ink-muted">Lecture…</p>
    } @else if (factures().length === 0) {
      <div class="card px-[15px] py-4">
        <p class="text-[13px] text-ink-soft">Aucune facture émise pour le moment.</p>
      </div>
    } @else {
      <div class="card overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>Numéro</th>
              <th>Affaire</th>
              <th>Type</th>
              <th class="num">Volume</th>
              <th class="num">Montant</th>
              <th class="num">Réglé</th>
              <th>Échéance</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (f of factures(); track f.id) {
              <tr>
                <td class="ref">{{ f.number ?? '-' }}</td>
                <td class="text-ink-soft">{{ f.deal?.reference ?? '-' }}</td>
                <td class="text-ink-soft">{{ typeLabel(f.type) }}</td>
                <td class="num font-mono text-ink-soft">{{ grouper(+f.billedVolume) }} {{ f.uom }}</td>
                <td class="num font-mono text-ink-soft">{{ grouper(+f.totalAmount) }} {{ f.currencyCode }}</td>
                <td class="num font-mono text-ink-soft">{{ grouper(+f.paidAmount) }} {{ f.currencyCode }}</td>
                <td class="font-mono text-[12px] text-ink-soft">{{ dateOnly(f.dueDate) }}</td>
                <td><span [class]="badge(f.status)">{{ label(f.status) }}</span></td>
                <td>
                  @if (f.generatedDocuments.length > 0) {
                    <button
                      class="btn-ghost !h-7 !px-2.5 text-[12px]"
                      (click)="telecharger(f.generatedDocuments[0].id, f.generatedDocuments[0].reference)"
                      [disabled]="telechargement() === f.generatedDocuments[0].id"
                    >
                      <erp-icon name="file-text" [size]="12" />
                      {{ telechargement() === f.generatedDocuments[0].id ? '…' : 'PDF' }}
                    </button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    @if (erreur()) {
      <p class="mt-3 text-[13px] text-crit">{{ erreur() }}</p>
    }
  `,
})
export class FacturesComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly chargement = signal(true);
  protected readonly factures = signal<InvoiceRow[]>([]);
  protected readonly telechargement = signal<string | null>(null);
  protected readonly erreur = signal<string | null>(null);
  protected readonly grouper = (v: number) => grouper(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  protected readonly dateOnly = dateOnly;

  protected label(status: string): string {
    return STATUS_LABEL[status] ?? status;
  }
  protected badge(status: string): string {
    return STATUS_BADGE[status] ?? 'badge-neutral';
  }
  protected typeLabel(type: string): string {
    return TYPE_LABEL[type] ?? type;
  }

  ngOnInit(): void {
    this.api.invoices({ pageSize: 100 }).subscribe((p) => {
      this.factures.set(p.items);
      this.chargement.set(false);
    });
  }

  protected telecharger(documentId: string, reference: string): void {
    this.erreur.set(null);
    this.telechargement.set(documentId);
    this.api.downloadDocument(documentId).subscribe({
      next: (blob) => {
        this.telechargement.set(null);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${reference}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => {
        this.telechargement.set(null);
        this.erreur.set('Téléchargement impossible : réessayez dans un instant.');
      },
    });
  }
}
