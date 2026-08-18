import { Component, EventEmitter, Input, OnDestroy, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, DealRow, DeviseOption, InvoiceRow } from '../core/api.service';
import {
  ActionFeedbackComponent,
  ActionState,
  HttpFailure,
} from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';
import { grouper } from '../shared/format';
import { MontantDirective } from '../shared/montant.directive';

/**
 * Édition et cycle de vie d'une pièce de facturation (§ 9).
 *
 * LA TVA NE DÉPEND QUE DE LA CASE. La mention imprimée HT ou TTC n'entre dans
 * aucun calcul : elle figure en entête de la pièce, rien de plus. Et la TVA
 * est EXTRAITE du total, jamais ajoutée - le total dû par le client ne bouge
 * pas selon qu'elle s'applique ou non.
 *
 * Seules les affaires VALIDÉES (statut APPROVED) peuvent être facturées : une
 * affaire encore en instance de risque ou de DG n'a rien à porter en créance.
 *
 * Volume et prix ne se saisissent plus ici : ils sont PORTÉS PAR L'AFFAIRE
 * (arbitrage du 17/08) et affichés seuls, sans possibilité de modification.
 */
@Component({
  selector: 'erp-invoice-actions',
  standalone: true,
  imports: [FormsModule, IconComponent, ActionFeedbackComponent, MontantDirective],
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
              <option [ngValue]="''">Choisir une affaire</option>
              @for (d of deals(); track d.id) {
                <option [ngValue]="d.id">
                  {{ d.reference }} · {{ d.client.legalName }}
                </option>
              }
            </select>
            <p class="mt-1 text-[11px] text-ink-faint">
              Seules les affaires validées (circuit d’approbation complet) sont proposées : une
              affaire encore en instance ne peut pas être facturée.
            </p>
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
            <label class="label">Volume facturé</label>
            <p class="field flex items-center justify-end bg-gray-50 font-mono text-ink-soft">
              @if (selectedDeal(); as d) {
                {{ int(d.contractedVolume) }} {{ d.uom }}
              } @else {
                <span class="text-ink-faint">-</span>
              }
            </p>
            <p class="mt-1 text-[11px] text-ink-faint">Porté par l’affaire, non modifiable ici.</p>
          </div>
          <div>
            <label class="label">Prix unitaire</label>
            <p class="field flex items-center justify-end bg-gray-50 font-mono text-ink-soft">
              @if (selectedDeal(); as d) {
                {{ money(+d.unitSalePrice) }}
              } @else {
                <span class="text-ink-faint">-</span>
              }
            </p>
            <p class="mt-1 text-[11px] text-ink-faint">Porté par l’affaire, non modifiable ici.</p>
          </div>
          <div>
            <label class="label" for="dev">Devise d’émission</label>
            <select id="dev" class="field" [(ngModel)]="currencyCode">
              @for (d of devises(); track d.code) {
                <option [ngValue]="d.code">
                  {{ d.code }} · {{ d.name }}@if (d.isPivot) { · pivot }
                </option>
              }
            </select>
            <p class="mt-1 text-[11px] text-ink-faint">
              La monnaie dans laquelle la créance est due. Le pivot sert à comparer des
              engagements pris dans des monnaies différentes, il ne s’impose pas.
            </p>
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
, extraite par Total × {{ vatRatePct }} ÷ ({{ 100 + +vatRatePct }})
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

        <div class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label class="label" for="regime">Mention imprimée</label>
            <select id="regime" class="field" [(ngModel)]="printedTaxRegime">
              <option value="TTC">TTC</option>
              <option value="HT">HT</option>
            </select>
            <p class="mt-1 text-[11px] text-ink-faint">
              Purement documentaire : sans effet sur les montants.
            </p>
          </div>
          <div>
            <label class="label" for="docdev">Devise d’impression</label>
            <select id="docdev" class="field" [(ngModel)]="documentCurrencyCode">
              @for (d of devises(); track d.code) {
                <option [ngValue]="d.code">{{ d.code }} · {{ d.name }}</option>
              }
            </select>
            <p class="mt-1 text-[11px] text-ink-faint">
              Le taux employé est daté et conservé : la pièce reste reconstituable.
            </p>
          </div>
          <div>
            <label class="label" for="regl">Mode de règlement</label>
            <select id="regl" class="field" [(ngModel)]="paymentMethod">
              <option value="">Réglage par défaut</option>
              <option value="TRANSFER">Virement</option>
              <option value="DEFERRED">À terme</option>
              <option value="MOBILE_MONEY">Mobile money</option>
              <option value="CHECK">Chèque</option>
              <option value="CARD">Carte</option>
              <option value="CASH">Espèces</option>
            </select>
            <p class="mt-1 text-[11px] text-ink-faint">
              Requis par la DGI pour toute facture normalisée. « Réglage par défaut » applique
              FNE_DEFAULT_PAYMENT_METHOD si configuré.
            </p>
          </div>
        </div>

        @if (type === 'SIMPLE') {
          <div class="mt-3">
            <label class="label" for="motif-simple">Motif du recours à la facture simple *</label>
            <input id="motif-simple" class="field" [(ngModel)]="simpleInvoiceReason" />
            <p class="mt-1 text-[11px]" [class]="motifInvalide() && simpleInvoiceReason ? 'text-crit' : 'text-ink-faint'">
              @if (motifInvalide() && simpleInvoiceReason) {
                Encore trop court : dix caractères au moins.
              } @else {
                Décision interne : décideur (vous) et date sont enregistrés automatiquement. Sans ce
                motif, la pièce restera bloquée à l’émission - autant le donner maintenant.
              }
            </p>
          </div>
        }

        <button
          class="btn-primary mt-4"
          (click)="create()"
          [disabled]="state.busy() || !dealId || motifInvalide()"
        >
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
  /**
   * ⚠️ AUCUNE DEVISE N'EST ÉCRITE ICI.
   *
   *    `XOF` y était en dur, et `USD` l'était ailleurs. Une devise codée dans
   *    un écran survit à tout changement de paramétrage : le jour où
   *    l'entreprise facture en euros, il faut retrouver l'écran.
   *
   *    La valeur de départ est la devise déclarée LOCALE dans le référentiel.
   *    Ce n'est pas le pivot : le pivot sert à comparer des engagements pris
   *    dans des monnaies différentes, il n'est la monnaie de personne.
   */
  protected currencyCode = '';
  protected documentCurrencyCode = '';
  protected readonly devises = signal<DeviseOption[]>([]);
  protected isVatApplicable = false;
  protected vatRatePct = 18;
  protected printedTaxRegime = 'TTC';
  protected simpleInvoiceReason = '';
  /** Vide = laisse l'API appliquer FNE_DEFAULT_PAYMENT_METHOD. */
  protected paymentMethod = '';

  constructor() {
    // Seules les affaires VALIDÉES sont proposées : APPROVED est le seul
    // statut, dans l'implémentation actuelle du circuit, qui atteste que le
    // risque et - le cas échéant - le DG ont tranché.
    this.api.deals(1, { status: 'APPROVED' }).subscribe((p) => this.deals.set(p.items));
    this.api.devises().subscribe((liste) => {
      this.devises.set(liste);
      // La locale d'abord ; à défaut la première active. Jamais le pivot par
      // défaut — il s'affiche dans la liste, il ne se choisit pas tout seul.
      const defaut = liste.find((d) => d.isLocal) ?? liste[0];
      if (defaut && !this.currencyCode) {
        this.currencyCode = defaut.code;
        this.documentCurrencyCode = defaut.code;
      }
    });
  }

  /** Affaire choisie - source unique du volume et du prix, non ressaisis. */
  protected selectedDeal(): DealRow | undefined {
    return this.deals().find((d) => d.id === this.dealId);
  }

  protected total(): number {
    const d = this.selectedDeal();
    if (!d) return 0;
    return Number(d.contractedVolume) * Number(d.unitSalePrice);
  }

  /** TVA EXTRAITE du total, jamais ajoutée : Total × taux ÷ (100 + taux). */
  protected vat(): number {
    if (!this.isVatApplicable) return 0;
    const r = Number(this.vatRatePct);
    return (this.total() * r) / (100 + r);
  }

  protected money(v: number): string {
    return grouper(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected int(value: string): string {
    return grouper(Number(value), { maximumFractionDigits: 0 });
  }

  /** Motif exigé - dès dix caractères, seuil aligné sur la validation serveur. */
  protected motifInvalide(): boolean {
    return this.type === 'SIMPLE' && this.simpleInvoiceReason.trim().length < 10;
  }

  protected create(): void {
    if (this.state.busy()) return;
    const d = this.selectedDeal();
    if (!d) return;
    if (this.motifInvalide()) {
      this.state.fail({ error: { message: 'Le motif du recours à la facture simple est exigé (dix caractères au moins).' } });
      return;
    }
    this.state.start();

    this.api
      .createInvoice({
        dealId: this.dealId,
        type: this.type,
        billedVolume: Number(d.contractedVolume),
        uom: d.uom,
        unitPrice: Number(d.unitSalePrice),
        currencyCode: this.currencyCode,
        documentCurrencyCode: this.documentCurrencyCode,
        isVatApplicable: this.isVatApplicable,
        vatRatePct: this.isVatApplicable ? Number(this.vatRatePct) : undefined,
        printedTaxRegime: this.printedTaxRegime,
        simpleInvoiceReason: this.simpleInvoiceReason || undefined,
        paymentMethod: this.paymentMethod || undefined,
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
  imports: [FormsModule, IconComponent, ActionFeedbackComponent, MontantDirective],
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
              {{ invoice.isVatApplicable ? money(+invoice.vatAmount) : '-' }}
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
            <button
              class="btn-ghost ml-auto text-crit"
              (click)="showDeleteConfirm.set(!showDeleteConfirm())"
              [disabled]="state.busy()"
            >
              Supprimer le brouillon
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
          @if (peutTransmettreAvoir()) {
            <button class="btn-ghost" (click)="showAvoirForm.set(!showAvoirForm())" [disabled]="state.busy()">
              Émettre un avoir
            </button>
          }
          @if (peutReprendreFne()) {
            <button class="btn-ghost" (click)="retryFne()" [disabled]="state.busy()">
              Reprendre la transmission FNE
            </button>
          }
          @if (invoice.status !== 'DRAFT') {
            <button class="btn-ghost" (click)="generatePdf()" [disabled]="pdfBusy()">
              {{ pdfBusy() ? 'Génération…' : 'Générer le PDF' }}
            </button>
          }
          @if (peutAnnuler()) {
            <button class="btn-ghost text-crit" (click)="showCancelForm.set(!showCancelForm())" [disabled]="state.busy()">
              Annuler la pièce
            </button>
          }
        </div>

        @if (showDeleteConfirm()) {
          <div class="mt-4 rounded-[3px] border border-crit/30 bg-crit-wash px-3 py-3">
            <h3 class="mb-1 text-[13px] font-semibold text-crit">
              Supprimer {{ invoice.number }} ?
            </h3>
            <p class="mb-2 text-[12px] text-ink-soft">
              Un brouillon n’a encore rien engagé : ni numéro opposable, ni transmission fiscale.
              L’action est définitive.
            </p>
            <div class="flex gap-2">
              <button
                class="btn-ghost border-crit/50 text-crit"
                (click)="supprimer()"
                [disabled]="state.busy()"
              >
                Confirmer la suppression
              </button>
              <button class="btn-ghost" (click)="showDeleteConfirm.set(false)" [disabled]="state.busy()">
                Annuler
              </button>
            </div>
          </div>
        }

        @if (showCancelForm()) {
          <div class="mt-4 rounded-[3px] border border-crit/30 bg-crit-wash px-3 py-3">
            <h3 class="mb-2 text-[13px] font-semibold text-crit">Annuler {{ invoice.number }}</h3>
            <label class="label" for="cancel-reason">Motif (obligatoire)</label>
            <input id="cancel-reason" class="field" [(ngModel)]="cancelReason" placeholder="Pourquoi cette pièce est annulée" />
            <button class="btn-ghost mt-3 border-crit/50 text-crit" (click)="annuler()" [disabled]="state.busy()">
              Confirmer l'annulation
            </button>
            <p class="mt-2 text-[11px] leading-relaxed text-ink-faint">
              Fermée dès qu'un encaissement existe, même partiel : au-delà, seul un avoir corrige la
              pièce. Une FNE déjà certifiée par la DGI ne s'annule pas non plus en interne.
            </p>
          </div>
        }

        @if (invoice.fneTransmission) {
          <p class="mt-2 text-[11px] text-ink-faint">
            FNE : {{ invoice.fneTransmission.status }}
            @if (invoice.fneTransmission.fiscalReference) {
              · réf. {{ invoice.fneTransmission.fiscalReference }}
            }
          </p>
        }

        @if (pdfStatus(); as pdf) {
          <p class="mt-2 flex items-center gap-2 text-[11px]" [class]="pdf.state === 'failed' ? 'text-crit' : 'text-ink-faint'">
            @switch (pdf.state) {
              @case ('completed') {
                PDF généré : {{ pdf.reference }}
                <button class="link" (click)="telechargerPdf()" [disabled]="pdfDownloading()">
                  {{ pdfDownloading() ? 'Téléchargement…' : 'Télécharger →' }}
                </button>
              }
              @case ('failed') { Échec de la génération PDF : {{ pdf.error }} }
              @default { Génération PDF en cours… }
            }
          </p>
        }

        @if (showAvoirForm()) {
          <div class="mt-4 rounded-[3px] border border-rule px-3 py-3">
            <h3 class="mb-2 text-[13px] font-semibold text-ink">Avoir sur {{ invoice.number }}</h3>
            <div class="flex flex-wrap items-end gap-3">
              <div>
                <label class="label" for="av-vol">Volume corrigé</label>
                <input id="av-vol" class="field w-32 text-right font-mono" erpMontant [(ngModel)]="avoirVolume" />
              </div>
              <div>
                <label class="label" for="av-pu">Prix unitaire</label>
                <input id="av-pu" class="field w-32 text-right font-mono" [(ngModel)]="avoirUnitPrice" />
              </div>
              <button class="btn-primary" (click)="creerAvoir()" [disabled]="state.busy()">
                Créer l’avoir
              </button>
            </div>
            <p class="mt-2 text-[11px] leading-relaxed text-ink-faint">
              Crée une pièce distincte (avoir) référençant {{ invoice.number }}, au brouillon. Elle
              se corrige et s’émet séparément : un avoir qui dépasse ce qu’il corrige sera refusé.
            </p>
          </div>
        }

        @if (invoice.type !== 'PROFORMA' && invoice.status !== 'DRAFT') {
          <div class="mt-5 border-t border-rule pt-4">
            <h3 class="mb-2 text-[13px] font-semibold text-ink">Encaissement</h3>
            <div class="flex flex-wrap items-end gap-3">
              <div>
                <label class="label" for="montant">Montant</label>
                <input id="montant" class="field w-40 text-right font-mono" erpMontant [(ngModel)]="amount" />
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
            ne se transmet pas au dispositif fiscal.
          </p>
        }
      </div>
    </section>
  `,
})
export class InvoiceLifecycleComponent implements OnDestroy {
  private readonly api = inject(ApiService);

  @Input({ required: true }) invoice!: InvoiceRow;
  @Output() readonly changed = new EventEmitter<void>();
  @Output() readonly deleted = new EventEmitter<void>();

  protected readonly state = new ActionState();

  protected amount: number | null = null;
  protected valueDate = new Date().toISOString().slice(0, 10);
  protected bankReference = '';

  protected readonly showAvoirForm = signal(false);
  protected avoirVolume: number | null = null;
  protected avoirUnitPrice: number | null = null;

  protected readonly showCancelForm = signal(false);
  protected cancelReason = '';

  protected readonly showDeleteConfirm = signal(false);

  protected supprimer(): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api.deleteInvoice(this.invoice.id).subscribe({
      next: () => this.deleted.emit(),
      error: (e: HttpFailure) => this.state.fail(e),
    });
  }

  /** Fermée dès qu'un encaissement existe — même partiel (§ arbitrage 15/08). */
  protected peutAnnuler(): boolean {
    return (
      this.invoice.status !== 'DRAFT' &&
      this.invoice.status !== 'CANCELLED' &&
      Number(this.invoice.paidAmount) === 0
    );
  }

  protected annuler(): void {
    if (this.state.busy()) return;
    if (!this.cancelReason.trim()) {
      this.state.error.set('Le motif d’annulation est requis.');
      return;
    }
    this.state.start();
    this.api.cancelInvoice(this.invoice.id, this.cancelReason).subscribe({
      next: () => {
        this.state.succeed('Pièce annulée.');
        this.showCancelForm.set(false);
        this.cancelReason = '';
        this.changed.emit();
      },
      error: (e: HttpFailure) => this.state.fail(e),
    });
  }

  protected readonly pdfStatus = signal<{
    state: string;
    reference?: string;
    documentId?: string;
    error?: string;
  } | null>(null);
  protected readonly pdfDownloading = signal(false);
  private pdfPoll?: ReturnType<typeof setTimeout>;

  protected pdfBusy(): boolean {
    const s = this.pdfStatus();
    return !!s && s.state !== 'completed' && s.state !== 'failed';
  }

  /**
   * Génération PDF (§ 1.1) — mise en file côté API, jamais rendue en ligne.
   * Le bouton lance le job puis interroge son état toutes les 1,5 s : pas de
   * WebSocket ici, la génération se compte en centaines de millisecondes,
   * pas en minutes.
   */
  protected generatePdf(): void {
    if (this.pdfBusy()) return;
    this.pdfStatus.set({ state: 'queued' });
    this.api.queueInvoicePdf(this.invoice.id).subscribe({
      next: ({ jobId }) => this.pollPdf(jobId),
      error: () => this.pdfStatus.set({ state: 'failed', error: 'Mise en file impossible.' }),
    });
  }

  private pollPdf(jobId: string): void {
    clearTimeout(this.pdfPoll);
    this.api.documentPdfJobStatus(jobId).subscribe({
      next: (job) => {
        if (job.state === 'completed') {
          this.pdfStatus.set({
            state: 'completed',
            reference: job.result?.reference,
            documentId: job.result?.documentId,
          });
          this.changed.emit();
        } else if (job.state === 'failed') {
          this.pdfStatus.set({ state: 'failed', error: job.failedReason ?? 'Erreur inconnue.' });
        } else {
          this.pdfStatus.set({ state: job.state });
          this.pdfPoll = setTimeout(() => this.pollPdf(jobId), 1500);
        }
      },
      error: () => this.pdfStatus.set({ state: 'failed', error: 'Suivi de la tâche impossible.' }),
    });
  }

  protected telechargerPdf(): void {
    const documentId = this.pdfStatus()?.documentId;
    if (!documentId || this.pdfDownloading()) return;
    this.pdfDownloading.set(true);
    this.api.downloadDocument(documentId).subscribe({
      next: (blob) => {
        this.pdfDownloading.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.pdfStatus()?.reference ?? documentId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => {
        this.pdfDownloading.set(false);
        this.pdfStatus.set({ state: 'failed', error: 'Téléchargement impossible.' });
      },
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.pdfPoll);
  }

  /** Statuts pour lesquels une nouvelle tentative de transmission a un sens
   *  — une pièce déjà acceptée ou sans objet n'a rien à reprendre. */
  private static readonly FNE_RETRYABLE = new Set(['PENDING_TRANSMISSION', 'TO_CORRECT', 'REJECTED']);

  protected peutReprendreFne(): boolean {
    const statut = this.invoice.fneTransmission?.status;
    return !!statut && InvoiceLifecycleComponent.FNE_RETRYABLE.has(statut);
  }

  /** Un avoir ne se rapporte qu'à une pièce définitive déjà émise. */
  protected peutTransmettreAvoir(): boolean {
    return this.invoice.type !== 'PROFORMA' && this.invoice.type !== 'CREDIT_NOTE' && this.invoice.status !== 'DRAFT';
  }

  protected retryFne(): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api.retryFneTransmission(this.invoice.id).subscribe({
      next: () => {
        this.state.succeed('Transmission FNE relancée.');
        this.changed.emit();
      },
      error: (e: HttpFailure) => this.state.fail(e),
    });
  }

  protected creerAvoir(): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api
      .createInvoice({
        dealId: this.invoice.deal.id,
        type: 'CREDIT_NOTE',
        correctedInvoiceId: this.invoice.id,
        billedVolume: Number(this.avoirVolume ?? this.invoice.billedVolume),
        uom: this.invoice.uom,
        unitPrice: Number(this.avoirUnitPrice ?? this.invoice.unitPrice),
        currencyCode: this.invoice.currencyCode,
      })
      .subscribe({
        next: (r) => {
          this.state.succeed(`Avoir ${r.number} créé au brouillon.`);
          this.showAvoirForm.set(false);
          this.avoirVolume = null;
          this.avoirUnitPrice = null;
          this.changed.emit();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }

  protected due(): number {
    return Number(this.invoice.totalAmount) - Number(this.invoice.paidAmount);
  }

  protected dueClass(): string {
    return this.due() > 0.01 ? 'text-warn-ink' : 'text-ok';
  }

  protected money(v: number): string {
    return grouper(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
        dealId: this.invoice.deal.id,
        type,
        billedVolume: Number(this.invoice.billedVolume),
        uom: this.invoice.uom,
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
