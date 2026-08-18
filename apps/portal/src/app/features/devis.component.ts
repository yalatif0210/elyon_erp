import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, ProductRow, QuotationProformaRow, QuotationRequestRow } from '../core/api.service';
import { ActionFeedbackComponent, ActionState, HttpFailure } from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';
import { dateOnly, grouper } from '../shared/format';

const STATUS_LABEL: Record<string, string> = {
  NEW: 'Nouvelle',
  IN_REVIEW: 'En cours d’étude',
  PROFORMA_APPROVED: 'Proforma approuvée',
  CONVERTED: 'Convertie en affaire',
  DECLINED: 'Déclinée',
};

const STATUS_BADGE: Record<string, string> = {
  NEW: 'badge-wait',
  IN_REVIEW: 'badge-transit',
  PROFORMA_APPROVED: 'badge-ok',
  CONVERTED: 'badge-ok',
  DECLINED: 'badge-blocked',
};

/**
 * Demandes de cotation (§ 13, module 0).
 *
 * Volontairement LÉGER, à l'image de `QuotationRequest` côté serveur : le
 * client exprime un besoin, il ne chiffre rien et ne voit aucun prix. Un
 * commercial étudie la demande et y répond par une ou plusieurs proforma
 * (§ discussion 17/08) : c'est ICI que le client en approuve une - le geste
 * qui rend la conversion en affaire possible côté commercial.
 */
@Component({
  selector: 'erp-portal-devis',
  standalone: true,
  imports: [FormsModule, IconComponent, ActionFeedbackComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Demandes de cotation</h1>
      <p class="page-sub">
        Exprimez un besoin : produit, volume, échéance souhaitée. Un commercial l'étudie et revient
        vers vous : cette demande ne vaut ni prix ni engagement.
      </p>
    </header>

    <section class="card mb-6 max-w-xl overflow-hidden">
      <div class="card-header">
        <h2 class="card-title">Nouvelle demande</h2>
      </div>
      <div class="card-body">
        <erp-action-feedback [error]="state.error()" [success]="state.done()" />

        <form (ngSubmit)="submit()" novalidate>
          <div class="mb-3.5">
            <label class="label" for="product">Produit</label>
            <select id="product" name="product" class="field" [(ngModel)]="productId" (ngModelChange)="onProduct()" required>
              <option value="" disabled selected>Choisir…</option>
              @for (p of products(); track p.id) {
                <option [value]="p.id">{{ p.name }}</option>
              }
            </select>
          </div>

          <div class="mb-3.5 grid grid-cols-2 gap-3">
            <div>
              <label class="label" for="volume">Volume souhaité</label>
              <input
                id="volume"
                name="volume"
                type="number"
                min="0"
                step="any"
                class="field text-right font-mono"
                [(ngModel)]="volume"
                required
              />
            </div>
            <div>
              <label class="label" for="uom">Unité</label>
              <select id="uom" name="uom" class="field" [(ngModel)]="uom" required>
                <option value="L">Litre</option>
                <option value="M3">Mètre cube</option>
                <option value="MT">Tonne métrique</option>
                <option value="BBL">Baril</option>
              </select>
            </div>
          </div>

          <div class="mb-3.5">
            <label class="label" for="delivery">Échéance de livraison souhaitée (facultatif)</label>
            <input id="delivery" name="delivery" type="date" class="field" [(ngModel)]="desiredDeliveryDate" />
          </div>

          <div class="mb-4">
            <label class="label" for="message">Message (facultatif)</label>
            <textarea id="message" name="message" rows="3" class="field" [(ngModel)]="message"></textarea>
          </div>

          <button type="submit" class="btn-primary" [disabled]="state.busy() || !productId || !volume">
            {{ state.busy() ? 'Envoi…' : 'Envoyer la demande' }}
          </button>
        </form>
      </div>
    </section>

    @if (chargement()) {
      <p class="text-[13px] text-ink-muted">Lecture…</p>
    } @else if (demandes().length === 0) {
      <div class="card px-[15px] py-4">
        <p class="text-[13px] text-ink-soft">Aucune demande envoyée pour le moment.</p>
      </div>
    } @else {
      <erp-action-feedback [error]="stateApproval.error()" [success]="stateApproval.done()" />
      <div class="card overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>Déposée le</th>
              <th>Produit</th>
              <th class="num">Volume</th>
              <th>Échéance souhaitée</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            @for (d of demandes(); track d.id) {
              <tr>
                <td class="font-mono text-[12px] text-ink-soft">{{ dateOnly(d.createdAt) }}</td>
                <td class="text-ink-soft">{{ d.product.name }}</td>
                <td class="num font-mono text-ink-soft">{{ grouper(+d.desiredVolume) }} {{ d.uom }}</td>
                <td class="font-mono text-[12px] text-ink-soft">{{ dateOnly(d.desiredDeliveryDate) }}</td>
                <td><span [class]="badge(d.status)">{{ label(d.status) }}</span></td>
              </tr>
              @if (d.proformas.length > 0) {
                <tr>
                  <td colspan="5" class="!pt-0 !pb-3">
                    <div class="ml-2 border-l-2 border-rule pl-3">
                      <p class="mb-1.5 text-[11px] uppercase tracking-wide text-ink-faint">
                        Proforma reçue{{ d.proformas.length > 1 ? 's' : '' }}
                      </p>
                      @for (p of d.proformas; track p.id) {
                        <div class="mb-1.5 flex flex-wrap items-center gap-2 text-[13px]">
                          <span class="font-mono text-ink-muted">{{ p.number }}</span>
                          <span class="text-ink">
                            {{ grouper(+p.billedVolume) }} {{ p.uom }} à {{ grouper(+p.unitPrice) }}
                            {{ p.currencyCode }}
                          </span>
                          @if (p.acceptedAt) {
                            <span class="badge-ok">Approuvée</span>
                          } @else if (d.status === 'CONVERTED' || d.status === 'DECLINED') {
                            <span class="text-[11px] text-ink-faint">Non retenue</span>
                          } @else {
                            <button
                              class="btn-ghost !h-7 !px-2.5 text-[12px]"
                              (click)="approuver(d, p)"
                              [disabled]="stateApproval.busy()"
                            >
                              Approuver cette offre
                            </button>
                          }
                          @if (p.generatedDocuments.length > 0) {
                            <button
                              class="btn-ghost !h-7 !px-2.5 text-[12px]"
                              (click)="telecharger(p.generatedDocuments[0].id, p.generatedDocuments[0].reference)"
                              [disabled]="telechargement() === p.generatedDocuments[0].id"
                            >
                              <erp-icon name="file-text" [size]="12" />
                              {{ telechargement() === p.generatedDocuments[0].id ? '…' : 'PDF' }}
                            </button>
                          }
                        </div>
                      }
                    </div>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class DevisComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly state = new ActionState();
  protected readonly chargement = signal(true);
  protected readonly products = signal<ProductRow[]>([]);
  protected readonly demandes = signal<QuotationRequestRow[]>([]);

  protected productId = '';
  protected volume: number | null = null;
  protected uom = 'L';
  protected desiredDeliveryDate = '';
  protected message = '';

  protected readonly dateOnly = dateOnly;
  protected readonly grouper = (v: number) => grouper(v, { maximumFractionDigits: 3 });

  protected label(status: string): string {
    return STATUS_LABEL[status] ?? status;
  }
  protected badge(status: string): string {
    return STATUS_BADGE[status] ?? 'badge-neutral';
  }

  protected readonly stateApproval = new ActionState();
  protected readonly telechargement = signal<string | null>(null);

  protected approuver(d: QuotationRequestRow, p: QuotationProformaRow): void {
    if (this.stateApproval.busy()) return;
    this.stateApproval.start();
    this.api.approveProforma(d.id, p.id).subscribe({
      next: () => {
        this.stateApproval.succeed(`Offre ${p.number} approuvée.`);
        this.load();
      },
      error: (e: HttpFailure) => this.stateApproval.fail(e),
    });
  }

  /** Même format que partout dans l'ERP : le PDF scellé, jamais un brouillon (§ 9). */
  protected telecharger(documentId: string, reference: string): void {
    if (this.telechargement()) return;
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
        this.stateApproval.error.set('Téléchargement impossible : réessayez dans un instant.');
      },
    });
  }

  ngOnInit(): void {
    this.api.products().subscribe((p) => this.products.set(p));
    this.load();
  }

  protected onProduct(): void {
    const p = this.products().find((x) => x.id === this.productId);
    if (p) this.uom = p.defaultUom;
  }

  private load(): void {
    this.chargement.set(true);
    this.api.quotations().subscribe((rows) => {
      this.demandes.set(rows);
      this.chargement.set(false);
    });
  }

  protected submit(): void {
    if (!this.productId || !this.volume || this.state.busy()) return;
    this.state.start();
    this.api
      .createQuotation({
        productId: this.productId,
        desiredVolume: this.volume,
        uom: this.uom,
        desiredDeliveryDate: this.desiredDeliveryDate || undefined,
        message: this.message || undefined,
      })
      .subscribe({
        next: () => {
          this.state.succeed('Demande envoyée.');
          this.productId = '';
          this.volume = null;
          this.desiredDeliveryDate = '';
          this.message = '';
          this.load();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }
}
