import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, ContractRow, Partner, ReferentialSpec, SiteRequirement } from '../core/api.service';
import { ActionFeedbackComponent, ActionState, HttpFailure } from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';

/** Voir `operation-create.component.ts` : les valeurs admises d'une énumération
 *  se lisent dans le registre de paramétrage, jamais recopiées à la main. */
const SEGMENT_FIELDS = ['segment'];
const UOM_FIELDS = ['uom', 'defaultUom'];
const TRANSPORT_FIELDS = ['transportMode', 'applicableTransportModes'];

/**
 * Secours pour SALES_REP.
 *
 * `rolesDeLecture` (registre de paramétrage) dérive la lecture de qui peut
 * ÉCRIRE un référentiel — un commercial n'écrit ni seuils de marge ni barème
 * transporteur, les deux seuls référentiels qui portent `segment` et
 * `transportMode`. Il ne les lit donc pas non plus, par le même mécanisme qui
 * l'empêche de lire les prix d'achat (§ registry.ts, fuite déjà corrigée).
 * Recopier ici les valeurs de `CommercialSegment`/`TransportMode` — deux
 * énumérations petites et stables — sert de repli SI le registre ne rend
 * rien ; il reste prioritaire dès qu'il répond.
 */
const SEGMENT_FALLBACK = ['MARITIME', 'B2B', 'RETAIL'];
const TRANSPORT_FALLBACK = ['PIPELINE', 'BUNKERING', 'BARGE', 'TRUCK', 'RAIL'];

/** `discountMode` n'appartient à aucune table de référentiel : ses trois
 *  valeurs sont fixes et propres au Deal, sans source à interroger. */
const DISCOUNT_MODES = ['PER_UNIT', 'PERCENTAGE', 'FIXED_AMOUNT'];

interface ProductOption {
  id: string;
  code: string;
  name: string;
  defaultUom: string;
  /** Produit SERVICE (ex. barge) : ni transport, ni volume, ni unité —
   *  le prix unitaire porte directement le montant total de la prestation. */
  isService: boolean;
}

interface CurrencyOption {
  code: string;
  name: string;
}

interface SiteOption {
  id: string;
  label: string;
  deliveryLocation: string;
  /** Ce que ce site exige — saisi au référentiel des sites, lu ici (§ 6.2). */
  exigences: SiteRequirement[];
}

/**
 * Création d'affaire (§ 5.1, § 5.4).
 *
 * VOLONTAIREMENT LIMITÉE aux champs de base. Le chiffrage des coûts et le
 * rattachement d'un prix fournisseur exigent un `dealId` existant — ils vivent
 * déjà, tout construits, sur la fiche affaire (`erp-deal-costing`,
 * `erp-deal-actions`). Reconstruire ce chiffrage ici l'aurait dupliqué sans
 * raison : le brouillon créé renvoie directement vers cette fiche.
 *
 * Un contrat-cadre peut porter PLUSIEURS affaires — le choisir ici ne fait que
 * rattacher celle-ci à l'une d'elles, il n'en crée ni n'en modifie aucune.
 */
@Component({
  selector: 'erp-deal-create',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, ActionFeedbackComponent],
  template: `
    <nav class="mb-3 flex items-center gap-1.5 text-[12px] text-ink-muted">
      <a routerLink="/affaires" class="link">Affaires</a>
      <erp-icon name="chevron-right" [size]="12" />
      <span class="text-ink">Nouvelle affaire</span>
    </nav>

    <header class="mb-5">
      <h1 class="page-title">Nouvelle affaire</h1>
      <p class="page-sub">
        Client, produit et conditions de vente. Le chiffrage des coûts et le prix fournisseur se
        font ensuite, depuis la fiche affaire.
      </p>
    </header>

    <erp-action-feedback [error]="state.error()" [success]="state.done()" />

    <!-- ============ Client et rattachement ============ -->
    <section class="card mb-5 overflow-hidden">
      <div class="card-header"><h2 class="card-title">Client</h2></div>
      <div class="card-body grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="client">Client <span class="text-crit">*</span></label>
          <select id="client" class="field" [(ngModel)]="clientId" (ngModelChange)="onClientChange()">
            <option value="" disabled>Choisir…</option>
            @for (p of clients(); track p.id) {
              <option [ngValue]="p.id">{{ p.legalName }} ({{ p.code }})</option>
            }
          </select>
        </div>

        <div>
          <label class="label" for="contract">Contrat-cadre (facultatif)</label>
          <select id="contract" class="field" [(ngModel)]="contractId" [disabled]="contractsDuClient().length === 0">
            <option value="">Aucun</option>
            @for (c of contractsDuClient(); track c.id) {
              <option [ngValue]="c.id">{{ c.reference }} · {{ c.title }}</option>
            }
          </select>
          @if (clientId && contractsDuClient().length === 0) {
            <p class="mt-1 text-[11px] text-ink-faint">Aucun contrat-cadre pour ce client.</p>
          }
        </div>

        @if (clientId) {
          <div class="sm:col-span-2">
            <label class="label" for="site">
              Site de livraison
              @if (sitesDuClient().length > 0) {
                <span class="text-crit">*</span>
              }
            </label>
            @if (sitesDuClient().length > 0) {
              <select id="site" class="field" [(ngModel)]="siteId" (ngModelChange)="onSiteChange()">
                <option value="" disabled>Choisir…</option>
                @for (s of sitesDuClient(); track s.id) {
                  <option [ngValue]="s.id">{{ s.label }}</option>
                }
              </select>
            } @else {
              <input id="site" class="field" [(ngModel)]="deliveryLocation" maxlength="200" />
              <p class="mt-1 text-[11px] text-ink-faint">
                Ce client n’a aucun site enregistré : lieu saisi librement, sans exigence
                rattachée. Un site créé au référentiel des tiers apparaîtra ici au prochain
                choix de ce client.
              </p>
            }

            <!-- ============ Ce que ce site exige ============
                 Purement informatif à ce stade : ce n'est pas ici que
                 l'exigence bloque, mais au chargement de l'opération qui
                 livrera cette affaire. La rappeler maintenant évite au
                 commercial de la découvrir après coup (§ discussion 15/08). -->
            @if (exigencesDuSite(); as ex) {
              @if (ex.length > 0) {
                <div class="mt-3 rounded-[3px] border border-rule-strong bg-gray-100 px-3.5 py-3">
                  <p class="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                    <erp-icon name="shield" [size]="14" />
                    Ce que ce site exige
                  </p>
                  <ul class="mt-2 space-y-2">
                    @for (e of ex; track e.id) {
                      <li class="text-[12px] leading-snug">
                        <span class="font-medium text-ink">{{ e.type.label }}</span>
                        @if (e.isBlocking) {
                          <span
                            class="ml-1.5 inline-flex items-center gap-1 rounded-[3px] bg-crit px-1.5
                                   py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                          >
                            <erp-icon name="lock" [size]="10" />
                            Bloquant
                          </span>
                        }
                        <span class="block text-ink-soft">{{ e.detail }}</span>
                      </li>
                    }
                  </ul>
                  @if (bloquantes() > 0) {
                    <p class="mt-2 text-[11px] leading-snug text-crit">
                      {{ bloquantes() }} exigence(s) bloquante(s) : sans conséquence sur cette
                      affaire, mais l’opération qui la livrera ne pourra pas partir au
                      chargement tant qu’elles n’auront pas été levées et acquittées.
                    </p>
                  }
                </div>
              }
            }
          </div>
        }
      </div>
    </section>

    <!-- ============ Produit et volume ============ -->
    <section class="card mb-5 overflow-hidden">
      <div class="card-header"><h2 class="card-title">Produit et volume</h2></div>
      <div class="card-body grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label class="label" for="product">Produit <span class="text-crit">*</span></label>
          <select id="product" class="field" [(ngModel)]="productId" (ngModelChange)="onProductChange()">
            <option value="" disabled>Choisir…</option>
            @for (p of products(); track p.id) {
              <option [ngValue]="p.id">{{ p.name }}</option>
            }
          </select>
        </div>

        <div>
          <label class="label" for="segment">Segment <span class="text-crit">*</span></label>
          <select id="segment" class="field" [(ngModel)]="segment">
            @for (s of segments(); track s) {
              <option [ngValue]="s">{{ s }}</option>
            }
          </select>
        </div>

        @if (!produitService()) {
          <div>
            <label class="label" for="mode">Mode de transport <span class="text-crit">*</span></label>
            <select id="mode" class="field" [(ngModel)]="transportMode">
              <option value="" disabled>Choisir…</option>
              @for (m of transportModes(); track m) {
                <option [ngValue]="m">{{ m }}</option>
              }
            </select>
          </div>

          <div>
            <label class="label" for="volume">Volume contracté <span class="text-crit">*</span></label>
            <input id="volume" type="number" min="0" step="any" class="field text-right font-mono" [(ngModel)]="contractedVolume" />
          </div>

          <div>
            <label class="label" for="uom">Unité <span class="text-crit">*</span></label>
            @if (uoms().length > 0) {
              <select id="uom" class="field" [(ngModel)]="uom">
                @for (u of uoms(); track u) {
                  <option [ngValue]="u">{{ u }}</option>
                }
              </select>
            } @else {
              <input id="uom" class="field font-mono" [(ngModel)]="uom" />
            }
          </div>
        } @else {
          <div class="sm:col-span-3">
            <p class="text-[12px] text-ink-faint">
              Produit de service : ni mode de transport, ni volume, ni unité. Le prix ci-dessous
              porte le montant total de la prestation.
            </p>
          </div>
        }

        <div>
          <label class="label" for="target">Livraison cible souhaitée</label>
          <input id="target" type="date" class="field" [(ngModel)]="targetDeliveryDate" />
        </div>
      </div>
    </section>

    <!-- ============ Conditions de vente ============ -->
    <section class="card mb-5 overflow-hidden">
      <div class="card-header"><h2 class="card-title">Conditions de vente</h2></div>
      <div class="card-body grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label class="label" for="devise">Devise <span class="text-crit">*</span></label>
          <select id="devise" class="field" [(ngModel)]="currencyCode">
            <option value="" disabled>Choisir…</option>
            @for (c of currencies(); track c.code) {
              <option [ngValue]="c.code">{{ c.code }} · {{ c.name }}</option>
            }
          </select>
        </div>

        <div>
          <label class="label" for="prix">
            {{ produitService() ? 'Prix d’exploitation' : 'Prix de vente unitaire' }}
            <span class="text-crit">*</span>
          </label>
          <input id="prix" type="number" min="0" step="any" class="field text-right font-mono" [(ngModel)]="unitSalePrice" />
        </div>

        <div>
          <button type="button" class="btn-ghost mt-[22px]" (click)="showDiscount.set(!showDiscount())">
            {{ showDiscount() ? 'Retirer la remise' : 'Ajouter une remise' }}
          </button>
        </div>

        @if (showDiscount()) {
          <div>
            <label class="label" for="dmode">Mode de remise</label>
            <select id="dmode" class="field" [(ngModel)]="discountMode">
              @for (m of discountModes; track m) {
                <option [ngValue]="m">{{ m }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label" for="dval">Valeur</label>
            <input id="dval" type="number" min="0" step="any" class="field text-right font-mono" [(ngModel)]="discountValue" />
          </div>
        }
      </div>
    </section>

    <button class="btn-primary" (click)="submit()" [disabled]="state.busy() || !peutEnvoyer()">
      {{ state.busy() ? 'Création…' : 'Créer l’affaire' }}
    </button>
    <p class="mt-2 text-[11px] leading-relaxed text-ink-faint">
      L'affaire naît au brouillon. Chiffrage des coûts, prix fournisseur, puis soumission au
      contrôle du risque se font ensuite, depuis sa fiche.
    </p>
  `,
})
export class DealCreateComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  protected readonly state = new ActionState();

  protected readonly clients = signal<Partner[]>([]);
  protected readonly contracts = signal<ContractRow[]>([]);
  protected readonly products = signal<ProductOption[]>([]);
  protected readonly currencies = signal<CurrencyOption[]>([]);
  private readonly catalogue = signal<ReferentialSpec[]>([]);

  protected readonly segments = computed(() => {
    const lus = this.enumValues(SEGMENT_FIELDS);
    return lus.length > 0 ? lus : SEGMENT_FALLBACK;
  });
  protected readonly uoms = computed(() => this.enumValues(UOM_FIELDS));
  protected readonly transportModes = computed(() => {
    const lus = this.enumValues(TRANSPORT_FIELDS);
    return lus.length > 0 ? lus : TRANSPORT_FALLBACK;
  });
  protected readonly discountModes = DISCOUNT_MODES;

  protected readonly contractsDuClient = computed(() =>
    this.contracts().filter((c) => c.clientId === this.clientId),
  );
  protected readonly produitService = computed(
    () => this.products().find((p) => p.id === this.productId)?.isService ?? false,
  );
  protected readonly sitesDuClient = computed<SiteOption[]>(() => {
    const client = this.clients().find((p) => p.id === this.clientId);
    if (!client) return [];
    return client.sites.map((s) => ({
      id: s.id,
      label: `${s.name}${s.city ? ' (' + s.city + ')' : ''}`,
      deliveryLocation: s.site?.name ?? s.name,
      exigences: s.site?.requirements ?? [],
    }));
  });
  protected readonly exigencesDuSite = computed(
    () => this.sitesDuClient().find((s) => s.id === this.siteId)?.exigences ?? [],
  );
  protected readonly bloquantes = computed(
    () => this.exigencesDuSite().filter((e) => e.isBlocking).length,
  );

  protected clientId = '';
  protected contractId = '';
  protected siteId = '';
  protected productId = '';
  protected segment = '';
  protected contractedVolume: number | null = null;
  protected uom = '';
  protected transportMode = '';
  protected deliveryLocation = '';
  protected targetDeliveryDate = '';
  protected currencyCode = '';
  protected unitSalePrice: number | null = null;

  protected readonly showDiscount = signal(false);
  protected discountMode = DISCOUNT_MODES[0];
  protected discountValue: number | null = null;

  ngOnInit(): void {
    this.api.partners(1, undefined, 'CLIENT').subscribe((p) => this.clients.set(p.items));
    this.api.contracts().subscribe((c) => this.contracts.set(c));
    this.api.currencies().subscribe((rows) => this.currencies.set(rows as CurrencyOption[]));
    this.api.parameterCatalogue().subscribe((c) => this.catalogue.set(c));
    this.api.products().subscribe((rows) => this.products.set(rows as ProductOption[]));
  }

  /** Le segment par défaut du client est repris — geste par défaut, pas une
   *  contrainte : rien n'empêche de le changer ensuite. */
  protected onClientChange(): void {
    this.contractId = '';
    this.siteId = '';
    this.deliveryLocation = '';
    const client = this.clients().find((p) => p.id === this.clientId);
    if (client?.segment) this.segment = client.segment;
  }

  protected onSiteChange(): void {
    const site = this.sitesDuClient().find((s) => s.id === this.siteId);
    if (site) this.deliveryLocation = site.deliveryLocation;
  }

  protected onProductChange(): void {
    const product = this.products().find((p) => p.id === this.productId);
    if (product && !product.isService) this.uom = product.defaultUom;
  }

  protected peutEnvoyer(): boolean {
    const base = !!(
      this.clientId &&
      this.productId &&
      this.segment &&
      this.deliveryLocation.trim() &&
      this.currencyCode &&
      this.unitSalePrice !== null
    );
    if (this.produitService()) return base;
    return base && !!(this.contractedVolume && this.uom && this.transportMode);
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

    const service = this.produitService();

    this.api
      .createDeal({
        contractId: this.contractId || undefined,
        clientId: this.clientId,
        siteId: this.siteId || undefined,
        productId: this.productId,
        segment: this.segment,
        // Absents pour un produit service : le serveur applique 1/FORFAIT et
        // n'exige aucun mode de transport (§ discussion 15/08).
        contractedVolume: service ? undefined : Number(this.contractedVolume ?? 0),
        uom: service ? undefined : this.uom,
        transportMode: service ? undefined : this.transportMode,
        deliveryLocation: this.deliveryLocation.trim(),
        targetDeliveryDate: this.targetDeliveryDate || undefined,
        currencyCode: this.currencyCode,
        unitSalePrice: Number(this.unitSalePrice ?? 0),
        discountMode: this.showDiscount() ? this.discountMode : undefined,
        discountValue: this.showDiscount() && this.discountValue ? Number(this.discountValue) : undefined,
      })
      .subscribe({
        next: (d) => {
          this.state.succeed(`Affaire ${d.reference} créée.`);
          void this.router.navigate(['/affaires', d.id]);
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }
}
