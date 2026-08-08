import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, DealRow, InvoiceRow } from '../core/api.service';
import {
  ActionFeedbackComponent,
  ActionState,
  HttpFailure,
} from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';

/**
 * Édition et cycle de vie d'une pièce de facturation (§ 9).
 *
 * LA TVA NE DÉPEND QUE DE LA CASE. La mention imprimée HT ou TTC n'entre dans
 * aucun calcul : elle figure en entête de la pièce, rien de plus. Et la TVA
 * est EXTRAITE du total, jamais ajoutée — le total dû par le client ne bouge
 * pas selon qu'elle s'applique ou non.
 *
 * Le volume et le prix sont SAISIS ici. Ils peuvent différer de l'affaire et
 * évoluer d'une proforma à la facture définitive : c'est le propre de la
 * facturation, et le relevé de mesure ne les détermine pas.
 */
@Component({
  selector: 'erp-invoice-actions',
  standalone: true,
  imports: [FormsModule, IconComponent, ActionFeedbackComponent],
  template: `
    <section class="card overflow-hidden">
      <div class="card-header">
        <h2 class="card-title">Éditer une pièce</h2>
      </div>
      <div class="card-body">
        <erp-action-feedback [error]="state.error()" [success]="state.done()" />

        <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div class="md:col-span-2">
            <label class="label" for="deal">Affaire</label>
            <select id="deal" class="field" [(ngModel)]="dealId">
              <option [ngValue]="''">— choisir une affaire —</option>
              @for (d of deals(); track d.id) {
                <option [ngValue]="d.id">
                  {{ d.reference }} · {{ d.client.legalName }}
                </option>
              }
            </select>
          </div>
          <div>
            <label class="label" for="type">Nature</label>
            <select id="type" class="field" [(ngModel)]="type">
              <option value="PROFORMA">Proforma</option>
              <option value="SIMPLE">Facture simple</option>
              <option value="FNE">Facture normalisée</option>
            </select>
          </div>

          <div>
            <label class="label" for="vol">Volume facturé</label>
            <input id="vol" class="field text-right font-mono" [(ngModel)]="billedVolume" />
          </div>
          <div>
            <label class="label" for="pu">Prix unitaire TTC</label>
            <input id="pu" class="field text-right font-mono" [(ngModel)]="unitPrice" />
          </div>
          <div>
            <label class="label" for="dev">Devise</label>
            <input id="dev" class="field font-mono" maxlength="3" [(ngModel)]="currencyCode" />
          </div>
        </div>

        <!-- ============ TVA ============ -->
        <div class="mt-4 rounded-[3px] border border-rule px-3 py-3">
          <label class="flex items-center gap-2 text-[13px] font-medium text-ink">
            <input
              type="checkbox"
              class="accent-[var(--primary)]"
              [(ngModel)]="isVatApplicable"
            />
            TVA applicable sur cette pièce
          </label>

          @if (isVatApplicable) {
            <div class="mt-3 flex flex-wrap items-end gap-4">
              <div>
                <label class="label" for="taux">Taux</label>
                <input id="taux" class="field w-24 text-right font-mono" [(ngModel)]="vatRatePct" />
              </div>
              <p class="pb-2 text-[12px] text-ink-soft">
                Total {{ money(total()) }} <strong>dont TVA {{ money(vat()) }}</strong>
                <span class="ml-1 text-ink-faint">
                  — extraite par Total × {{ vatRatePct }} ÷ ({{ 100 + +vatRatePct }})
                </span>
              </p>
            </div>
          } @else {
            <p class="mt-2 text-[12px] text-ink-faint">
              Aucune TVA ne sera portée ni calculée. Le total dû reste
              {{ money(total()) }}.
            </p>
          }
        </div>

        <div class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label class="label" for="regime">Mention imprimée</label>
            <select id="regime" class="field" [(ngModel)]="printedTaxRegime">
              <option value="TTC">TTC</option>
              <option value="HT">HT</option>
            </select>
            <p class="mt-1 text-[11px] text-ink-faint">
              Purement documentaire — sans effet sur les montants.
            </p>
          </div>
          <div>
            <label class="label" for="docdev">Devise d’impression</label>
            <input id="docdev" class="field font-mono" maxlength="3" [(ngModel)]="documentCurrencyCode" />
            <p class="mt-1 text-[11px] text-ink-faint">
              Le taux employé est daté et conservé : la pièce reste reconstituable.
            </p>
          </div>
        </div>

        @if (type === 'SIMPLE') {
          <div class="mt-3">
            <label class="label" for="motif-simple">Motif du recours à la facture simple</label>
            <input id="motif-simple" class="field" [(ngModel)]="simpleInvoiceReason" />
            <p class="mt-1 text-[11px] text-ink-faint">
              Décision interne : décideur, date et motif sont conservés (§ 9.3).
            </p>
          </div>
        }

        <button class="btn-primary mt-4" (click)="create()" [disabled]="state.busy() || !dealId">
          {{ state.busy() ? 'Édition…' : 'Éditer la pièce' }}
        </button>
      </div>
    </section>
  `,
})
export class InvoiceActionsComponent {
  private readonly api = inject(ApiService);

  @Output() readonly created = new EventEmitter<void>();

  protected readonly state = new ActionState();
  protected readonly deals = signal<DealRow[]>([]);

  protected dealId = '';
  protected type = 'PROFORMA';
  protected billedVolume: number | null = null;
  protected unitPrice: number | null = null;
  protected currencyCode = 'XOF';
  protected documentCurrencyCode = 'XOF';
  protected isVatApplicable = false;
  protected vatRatePct = 18;
  protected printedTaxRegime = 'TTC';
  protected simpleInvoiceReason = '';

  constructor() {
    this.api.deals(1, {}).subscribe((p) => this.deals.set(p.items));
  }

  protected total(): number {
    return Number(this.billedVolume ?? 0) * Number(this.unitPrice ?? 0);
  }

  /** TVA EXTRAITE du total, jamais ajoutée : Total × taux ÷ (100 + taux). */
  protected vat(): number {
    if (!this.isVatApplicable) return 0;
    const r = Number(this.vatRatePct);
    return (this.total() * r) / (100 + r);
  }

  protected money(v: number): string {
    return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected create(): void {
    if (this.state.busy()) return;
    this.state.start();

    this.api
      .createInvoice({
        dealId: this.dealId,
        type: this.type,
        billedVolume: Number(this.billedVolume ?? 0),
        uom: 'L',
        unitPrice: Number(this.unitPrice ?? 0),
        currencyCode: this.currencyCode,
        documentCurrencyCode: this.documentCurrencyCode,
        isVatApplicable: this.isVatApplicable,
        vatRatePct: this.isVatApplicable ? Number(this.vatRatePct) : undefined,
        printedTaxRegime: this.printedTaxRegime,
        simpleInvoiceReason: this.simpleInvoiceReason || undefined,
      })
      .subscribe({
        next: (r) => {
          this.state.succeed(`Pièce ${r.number} éditée.`);
          this.created.emit();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }
}

/**
 * Cycle de vie d'une pièce déjà éditée : émission, conversion, encaissement.
 *
 * Une proforma ne crée aucune créance et ne se transmet pas au dispositif
 * fiscal — elle ne porte donc ni échéance ni encaissement.
 */
@Component({
  selector: 'erp-invoice-lifecycle',
  standalone: true,
  imports: [FormsModule, IconComponent, ActionFeedbackComponent],
  template: `
    <section class="card overflow-hidden">
      <div class="card-header">
        <h2 class="card-title">Pièce {{ invoice.number }}</h2>
        <span class="text-[11px] text-ink-faint">{{ invoice.status }}</span>
      </div>
      <div class="card-body">
        <erp-action-feedback [error]="state.error()" [success]="state.done()" />

        <dl class="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] md:grid-cols-4">
          <div>
            <dt class="text-ink-muted">Total facture</dt>
            <dd class="font-mono font-semibold text-ink">{{ money(+invoice.totalAmount) }}</dd>
          </div>
          <div>
            <dt class="text-ink-muted">Dont TVA</dt>
            <dd class="font-mono text-ink-soft">
              {{ invoice.isVatApplicable ? money(+invoice.vatAmount) : '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-ink-muted">Encaissé</dt>
            <dd class="font-mono text-ink-soft">{{ money(+invoice.paidAmount) }}</dd>
          </div>
          <div>
            <dt class="text-ink-muted">Reste dû</dt>
            <dd class="font-mono font-semibold" [class]="dueClass()">{{ money(due()) }}</dd>
          </div>
        </dl>

        <div class="flex flex-wrap gap-2">
          @if (invoice.status === 'DRAFT') {
            <button class="btn-primary" (click)="issue()" [disabled]="state.busy()">
              Émettre
            </button>
          }
          @if (invoice.type === 'PROFORMA' && invoice.status !== 'DRAFT') {
            <button class="btn-ghost" (click)="convert('FNE')" [disabled]="state.busy()">
              Convertir en facture normalisée
            </button>
            <button class="btn-ghost" (click)="convert('SIMPLE')" [disabled]="state.busy()">
              Convertir en facture simple
            </button>
          }
        </div>

        @if (invoice.type !== 'PROFORMA' && invoice.status !== 'DRAFT') {
          <div class="mt-5 border-t border-rule pt-4">
            <h3 class="mb-2 text-[13px] font-semibold text-ink">Encaissement</h3>
            <div class="flex flex-wrap items-end gap-3">
              <div>
                <label class="label" for="montant">Montant</label>
                <input id="montant" class="field w-40 text-right font-mono" [(ngModel)]="amount" />
              </div>
              <div>
                <label class="label" for="valeur">Date de valeur</label>
                <input id="valeur" type="date" class="field" [(ngModel)]="valueDate" />
              </div>
              <div>
                <label class="label" for="ref">Référence bancaire</label>
                <input id="ref" class="field" [(ngModel)]="bankReference" />
              </div>
              <button class="btn-primary" (click)="pay()" [disabled]="state.busy()">
                Enregistrer
              </button>
            </div>
          </div>
        } @else if (invoice.type === 'PROFORMA') {
          <p class="mt-4 text-[11px] leading-relaxed text-ink-faint">
            Une proforma ne crée aucune créance : elle ne porte ni échéance, ni encaissement, et
            ne se transmet pas au dispositif fiscal (§ 9.3).
          </p>
        }
      </div>
    </section>
  `,
})
export class InvoiceLifecycleComponent {
  private readonly api = inject(ApiService);

  @Input({ required: true }) invoice!: InvoiceRow;
  @Output() readonly changed = new EventEmitter<void>();

  protected readonly state = new ActionState();

  protected amount: number | null = null;
  protected valueDate = new Date().toISOString().slice(0, 10);
  protected bankReference = '';

  protected due(): number {
    return Number(this.invoice.totalAmount) - Number(this.invoice.paidAmount);
  }

  protected dueClass(): string {
    return this.due() > 0.01 ? 'text-warn-ink' : 'text-ok';
  }

  protected money(v: number): string {
    return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected issue(): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api.issueInvoice(this.invoice.id).subscribe({
      next: () => {
        this.state.succeed('Pièce émise.');
        this.changed.emit();
      },
      error: (e: HttpFailure) => this.state.fail(e),
    });
  }

  protected convert(type: string): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api
      .convertProforma(this.invoice.id, {
        dealId: this.invoice.deal.reference,
        type,
        billedVolume: Number(this.invoice.billedVolume),
        uom: 'L',
        unitPrice: Number(this.invoice.unitPrice),
        currencyCode: this.invoice.currencyCode,
      })
      .subscribe({
        next: () => {
          this.state.succeed('Pièce définitive éditée depuis la proforma.');
          this.changed.emit();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }

  protected pay(): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api
      .recordInvoicePayment(this.invoice.id, {
        amount: Number(this.amount ?? 0),
        currencyCode: this.invoice.currencyCode,
        valueDate: this.valueDate,
        bankReference: this.bankReference || undefined,
      })
      .subscribe({
        next: () => {
          this.state.succeed('Encaissement enregistré.');
          this.amount = null;
          this.changed.emit();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }
}
