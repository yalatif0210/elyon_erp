import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, DeviseOption, Partner, ReferentialSpec } from '../core/api.service';
import { ActionFeedbackComponent, ActionState, HttpFailure } from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';

/** Voir `deal-create.component.ts` : les valeurs d'énumération se lisent au
 *  registre de paramétrage, jamais recopiées à la main. */
const SEGMENT_FIELDS = ['segment'];
const UOM_FIELDS = ['uom', 'defaultUom'];
const SEGMENT_FALLBACK = ['MARITIME', 'B2B', 'RETAIL'];

interface ProductOption {
  id: string;
  code: string;
  name: string;
  defaultUom: string;
}

interface StageOption {
  id: string;
  code: string;
  label: string;
  rank: number;
}

/**
 * Nouvelle opportunité (§ 15).
 *
 * ⚠️ CORRIGÉ — CET ÉCRAN N'EXISTAIT PAS.
 *
 *    `POST /api/internal/crm/opportunites` était complet côté serveur (DTO,
 *    validation, référence séquentielle) mais aucune porte d'entrée ne
 *    l'appelait : le pipeline commercial ne pouvait matériellement pas être
 *    alimenté. `crm_opportunities` comptait zéro ligne.
 *
 * La prochaine action est OBLIGATOIRE (§ 15) : une opportunité sans
 * prochaine action dort jusqu'à ce qu'on la retrouve par hasard.
 */
@Component({
  selector: 'erp-opportunity-create',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, ActionFeedbackComponent],
  template: `
    <nav class="mb-3 flex items-center gap-1.5 text-[12px] text-ink-muted">
      <a routerLink="/crm" class="link">Pipeline commercial</a>
      <erp-icon name="chevron-right" [size]="12" />
      <span class="text-ink">Nouvelle opportunité</span>
    </nav>

    <header class="mb-5">
      <h1 class="page-title">Nouvelle opportunité</h1>
      <p class="page-sub">Un prospect ou un client déjà établi, une estimation, une prochaine action</p>
    </header>

    <erp-action-feedback [error]="state.error()" [success]="state.done()" />

    <section class="card mb-5 overflow-hidden">
      <div class="card-header"><h2 class="card-title">Objet</h2></div>
      <div class="card-body grid grid-cols-1 gap-3 md:grid-cols-3">
        <div class="md:col-span-2">
          <label class="label" for="titre">Titre *</label>
          <input id="titre" class="field" [(ngModel)]="title" placeholder="Ce qui identifie l’opportunité" />
        </div>
        <div>
          <label class="label" for="etape">Étape de départ *</label>
          <select id="etape" class="field" [(ngModel)]="stageId">
            <option [ngValue]="''">Choisir</option>
            @for (s of stages(); track s.id) {
              <option [ngValue]="s.id">{{ s.label }}</option>
            }
          </select>
        </div>
        <div class="md:col-span-2">
          <label class="label" for="tiers">Tiers (prospect ou client) *</label>
          <select id="tiers" class="field" [(ngModel)]="partnerId" (change)="onPartnerChange()">
            <option [ngValue]="''">Choisir</option>
            @for (p of partners(); track p.id) {
              <option [ngValue]="p.id">{{ p.code }} · {{ p.legalName }}</option>
            }
          </select>
        </div>
        <div>
          <label class="label" for="segment">Segment *</label>
          <select id="segment" class="field" [(ngModel)]="segment">
            <option [ngValue]="''">Choisir</option>
            @for (s of segments(); track s) {
              <option [ngValue]="s">{{ s }}</option>
            }
          </select>
        </div>
        <div class="md:col-span-2">
          <label class="label" for="produit">Produit envisagé</label>
          <select id="produit" class="field" [(ngModel)]="productId" (change)="onProductChange()">
            <option [ngValue]="''">Pas encore arrêté</option>
            @for (p of products(); track p.id) {
              <option [ngValue]="p.id">{{ p.code }} · {{ p.name }}</option>
            }
          </select>
        </div>
      </div>
    </section>

    <section class="card mb-5 overflow-hidden">
      <div class="card-header"><h2 class="card-title">Estimation</h2></div>
      <div class="card-body grid grid-cols-1 gap-3 md:grid-cols-4">
        <div>
          <label class="label" for="vol">Volume estimé *</label>
          <input id="vol" type="number" min="0" step="any" class="field text-right font-mono" [(ngModel)]="estimatedVolume" />
        </div>
        <div>
          <label class="label" for="uom">Unité *</label>
          <select id="uom" class="field" [(ngModel)]="uom">
            <option [ngValue]="''">Choisir</option>
            @for (u of uoms(); track u) {
              <option [ngValue]="u">{{ u }}</option>
            }
          </select>
        </div>
        <div>
          <label class="label" for="prix">Prix de référence *</label>
          <input id="prix" type="number" min="0" step="any" class="field text-right font-mono" [(ngModel)]="referencePrice" />
        </div>
        <div>
          <label class="label" for="dev">Devise *</label>
          <select id="dev" class="field" [(ngModel)]="currencyCode">
            <option [ngValue]="''">Choisir</option>
            @for (d of devises(); track d.code) {
              <option [ngValue]="d.code">{{ d.code }}</option>
            }
          </select>
        </div>
        <div>
          <label class="label" for="cloture">Clôture espérée</label>
          <input id="cloture" type="date" class="field" [(ngModel)]="expectedCloseDate" />
        </div>
      </div>
      <p class="px-4 pb-3 text-[11px] leading-relaxed text-ink-faint">
        CA prévisionnel = volume × prix de référence. C’est une estimation, pas un prix vendu :
        elle sert au pipeline, jamais à la facturation.
      </p>
    </section>

    <section class="card mb-5 overflow-hidden">
      <div class="card-header"><h2 class="card-title">Prochaine action</h2></div>
      <div class="card-body grid grid-cols-1 gap-3 md:grid-cols-3">
        <div class="md:col-span-2">
          <label class="label" for="action">Prochaine action *</label>
          <input id="action" class="field" [(ngModel)]="nextAction" placeholder="Ce qu’il faut faire ensuite" />
        </div>
        <div>
          <label class="label" for="echeance">Échéance *</label>
          <input id="echeance" type="date" class="field" [(ngModel)]="nextActionDue" />
        </div>
        <div class="md:col-span-3">
          <label class="label" for="notes">Notes</label>
          <textarea id="notes" class="field" rows="3" [(ngModel)]="notes"></textarea>
        </div>
      </div>
      <p class="px-4 pb-3 text-[11px] leading-relaxed text-ink-faint">
        Obligatoire : une opportunité sans prochaine action dort jusqu’à ce qu’on la
        retrouve par hasard. C’est la première cause de pipeline mort.
      </p>
    </section>

    <button class="btn-primary" (click)="submit()" [disabled]="state.busy() || !peutEnvoyer()">
      {{ state.busy() ? 'Création…' : 'Créer l’opportunité' }}
    </button>
  `,
})
export class OpportunityCreateComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  protected readonly state = new ActionState();

  protected readonly partners = signal<Partner[]>([]);
  protected readonly products = signal<ProductOption[]>([]);
  protected readonly devises = signal<DeviseOption[]>([]);
  protected readonly stages = signal<StageOption[]>([]);
  private readonly catalogue = signal<ReferentialSpec[]>([]);

  protected readonly segments = computed(() => {
    const lus = this.enumValues(SEGMENT_FIELDS);
    return lus.length > 0 ? lus : SEGMENT_FALLBACK;
  });
  protected readonly uoms = computed(() => this.enumValues(UOM_FIELDS));

  protected title = '';
  protected partnerId = '';
  protected segment = '';
  protected productId = '';
  protected estimatedVolume: number | null = null;
  protected uom = '';
  protected referencePrice: number | null = null;
  protected currencyCode = '';
  protected stageId = '';
  protected expectedCloseDate = '';
  protected nextAction = '';
  protected nextActionDue = '';
  protected notes = '';

  ngOnInit(): void {
    this.api.partners(1).subscribe((p) => this.partners.set(p.items));
    this.api.products().subscribe((rows) => this.products.set(rows as ProductOption[]));
    this.api.devises().subscribe((rows) => this.devises.set(rows));
    this.api.crmStages().subscribe((rows) => this.stages.set(rows as unknown as StageOption[]));
    this.api.parameterCatalogue().subscribe((c) => this.catalogue.set(c));
  }

  /** Le segment du tiers est repris par défaut — un geste, pas une contrainte. */
  protected onPartnerChange(): void {
    const p = this.partners().find((x) => x.id === this.partnerId);
    if (p?.segment) this.segment = p.segment;
  }

  protected onProductChange(): void {
    const p = this.products().find((x) => x.id === this.productId);
    if (p) this.uom = p.defaultUom;
  }

  protected peutEnvoyer(): boolean {
    return !!(
      this.title.trim().length >= 3 &&
      this.partnerId &&
      this.segment &&
      this.estimatedVolume &&
      this.uom &&
      this.referencePrice !== null &&
      this.currencyCode &&
      this.stageId &&
      this.nextAction.trim().length >= 3 &&
      this.nextActionDue
    );
  }

  private enumValues(names: string[]): string[] {
    for (const spec of this.catalogue()) {
      for (const field of spec.fields) {
        if (names.includes(field.name) && field.values?.length) return field.values;
      }
    }
    return [];
  }

  protected submit(): void {
    if (this.state.busy() || !this.peutEnvoyer()) return;
    this.state.start();

    this.api
      .crmCreerOpportunite({
        title: this.title.trim(),
        partnerId: this.partnerId,
        segment: this.segment,
        productId: this.productId || undefined,
        estimatedVolume: Number(this.estimatedVolume),
        uom: this.uom,
        referencePrice: Number(this.referencePrice),
        currencyCode: this.currencyCode,
        stageId: this.stageId,
        expectedCloseDate: this.expectedCloseDate || undefined,
        nextAction: this.nextAction.trim(),
        nextActionDue: this.nextActionDue,
        notes: this.notes.trim() || undefined,
      })
      .subscribe({
        next: (o) => {
          const id = (o as { id: string }).id;
          this.state.succeed('Opportunité créée.');
          void this.router.navigate(['/crm', id]);
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }
}
