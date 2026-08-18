import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ApiService,
  DeviseOption,
  Partner,
  QuotationRequestInternalRow,
  ReferentialSpec,
  SiteRequirement,
} from '../core/api.service';
import { ActionFeedbackComponent, ActionState, HttpFailure } from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';
import { dateOnly, grouper } from '../shared/format';

/** Voir `deal-create.component.ts` : les valeurs d'énumération se lisent au
 *  registre de paramétrage, jamais recopiées à la main. */
const SEGMENT_FIELDS = ['segment'];
const TRANSPORT_FIELDS = ['transportMode', 'applicableTransportModes'];
const SEGMENT_FALLBACK = ['MARITIME', 'B2B', 'RETAIL'];
const TRANSPORT_FALLBACK = ['PIPELINE', 'BUNKERING', 'BARGE', 'TRUCK', 'RAIL'];

interface SiteOption {
  id: string;
  label: string;
  deliveryLocation: string;
  exigences: SiteRequirement[];
}

const STATUS_LABEL: Record<string, string> = {
  NEW: 'Nouvelle',
  IN_REVIEW: 'En étude',
  PROFORMA_APPROVED: 'Proforma approuvée',
  CONVERTED: 'Convertie',
  DECLINED: 'Déclinée',
};

const STATUS_BADGE: Record<string, string> = {
  NEW: 'badge-wait',
  IN_REVIEW: 'badge-transit',
  PROFORMA_APPROVED: 'badge-ok',
  CONVERTED: 'badge-ok',
  DECLINED: 'badge-blocked',
};

const PROFORMA_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Brouillon - pas encore envoyée',
  ISSUED: 'Envoyée',
  CANCELLED: 'Annulée',
};

/**
 * DEMANDES DE COTATION REÇUES DU PORTAIL (§ 13, module 0).
 *
 * ⚠️ CORRIGÉ (§ discussion 17/08) — LA CONVERSION EST DÉSORMAIS GUIDÉE.
 *
 *    Avant : aucun lien entre une demande et l'affaire éventuellement créée
 *    ailleurs, à la main, sans trace. Maintenant : une demande produit une ou
 *    plusieurs PROFORMA (une par variante négociée), soumises au client par
 *    son portail. Quand il en approuve une, la demande devient convertible -
 *    « Convertir » ne fait alors que RELIER une affaire déjà créée par la
 *    voie normale (`/affaires/nouvelle`), reporter la proforma gagnante
 *    dessus et annuler ses sœurs. La création de l'affaire elle-même reste
 *    un geste commercial, jamais mécanique.
 */
@Component({
  selector: 'erp-quotations',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, ActionFeedbackComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Demandes de cotation</h1>
      <p class="page-sub">
        Déposées depuis le portail client. Soumettez une ou plusieurs proforma, le client en
        approuve une, puis reliez l'affaire créée par la voie habituelle.
      </p>
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
                  @if (d.status !== 'CONVERTED' && d.status !== 'DECLINED') {
                    <button class="link ml-3 text-[12px]" (click)="basculerDetail(d)">
                      {{ detailOuvert() === d.id ? 'Fermer' : 'Proforma' }}
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
              @if (detailOuvert() === d.id) {
                <tr>
                  <td colspan="8" class="bg-gray-50 px-4 py-3">
                    <!-- ============ Proforma déjà soumises ============ -->
                    @if (d.proformas.length > 0) {
                      <table class="table mb-3">
                        <thead>
                          <tr>
                            <th>Pièce</th>
                            <th class="num">Volume</th>
                            <th class="num">Prix unitaire</th>
                            <th>État</th>
                            <th>Approuvée par le client</th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (p of d.proformas; track p.id) {
                            <tr [class.row-crit]="p.status === 'CANCELLED'">
                              <td class="font-mono text-[12px]">{{ p.number }}</td>
                              <td class="num font-mono text-ink-soft">{{ grouper(+p.billedVolume) }} {{ p.uom }}</td>
                              <td class="num font-mono text-ink-soft">
                                {{ grouper(+p.unitPrice) }} {{ p.currencyCode }}
                              </td>
                              <td class="text-[12px] text-ink-soft">{{ proformaStatusLabel(p.status) }}</td>
                              <td class="text-[12px]">
                                @if (p.acceptedAt) {
                                  <span class="text-ok">Oui, le {{ dateOnly(p.acceptedAt) }}</span>
                                } @else {
                                  <span class="text-ink-faint">Pas encore</span>
                                }
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    } @else {
                      <p class="mb-3 text-[12px] text-ink-faint">Aucune proforma soumise pour l’instant.</p>
                    }

                    <!-- ============ Soumettre une nouvelle proforma ============ -->
                    <div class="flex flex-wrap items-end gap-3">
                      <div>
                        <label class="label" for="pv-{{ d.id }}">Volume</label>
                        <input
                          id="pv-{{ d.id }}"
                          type="number"
                          min="0"
                          step="any"
                          class="field w-32 text-right font-mono"
                          [(ngModel)]="proformaVolume"
                        />
                      </div>
                      <div>
                        <label class="label" for="pu-{{ d.id }}">Unité</label>
                        <input id="pu-{{ d.id }}" class="field w-20" [(ngModel)]="proformaUom" />
                      </div>
                      <div>
                        <label class="label" for="pp-{{ d.id }}">Prix unitaire</label>
                        <input
                          id="pp-{{ d.id }}"
                          type="number"
                          min="0"
                          step="any"
                          class="field w-32 text-right font-mono"
                          [(ngModel)]="proformaPrice"
                        />
                      </div>
                      <div>
                        <label class="label" for="pd-{{ d.id }}">Devise</label>
                        <select id="pd-{{ d.id }}" class="field w-24" [(ngModel)]="proformaCurrency">
                          @for (c of devises(); track c.code) {
                            <option [ngValue]="c.code">{{ c.code }}</option>
                          }
                        </select>
                      </div>
                      <button
                        class="btn-primary"
                        (click)="soumettreProforma(d)"
                        [disabled]="stateProforma.busy() || !proformaValide()"
                      >
                        Soumettre au client
                      </button>
                    </div>
                    <erp-action-feedback [error]="stateProforma.error()" [success]="stateProforma.done()" />

                    <!-- ============ Convertir en affaire ============ -->
                    @if (d.status === 'PROFORMA_APPROVED') {
                      <div class="mt-4 rounded-[3px] border border-ok/30 bg-ok-wash px-3 py-3">
                        <p class="mb-2 text-[13px] text-ink">
                          Le client a approuvé
                          <strong class="font-mono">{{ d.approvedProforma?.number }}</strong>. L’affaire
                          reprend tiers, produit, volume, prix et devise de cette proforma - il ne
                          manque que la livraison.
                        </p>
                        <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div>
                            <label class="label" for="seg-{{ d.id }}">Segment</label>
                            <select id="seg-{{ d.id }}" class="field" [(ngModel)]="convSegment">
                              <option [ngValue]="''">Choisir</option>
                              @for (s of segments(); track s) {
                                <option [ngValue]="s">{{ s }}</option>
                              }
                            </select>
                          </div>
                          @if (!d.product.isService) {
                            <div>
                              <label class="label" for="tm-{{ d.id }}">Mode de transport</label>
                              <select id="tm-{{ d.id }}" class="field" [(ngModel)]="convTransportMode">
                                <option [ngValue]="''">Choisir</option>
                                @for (t of transportModes(); track t) {
                                  <option [ngValue]="t">{{ t }}</option>
                                }
                              </select>
                            </div>
                            <div>
                              <label class="label" for="site-{{ d.id }}">Site de livraison</label>
                              @if (sitesDuTiers().length > 0) {
                                <select
                                  id="site-{{ d.id }}"
                                  class="field"
                                  [(ngModel)]="convSiteId"
                                  (change)="onConvSiteChange()"
                                >
                                  <option [ngValue]="''">Choisir</option>
                                  @for (s of sitesDuTiers(); track s.id) {
                                    <option [ngValue]="s.id">{{ s.label }}</option>
                                  }
                                </select>
                              } @else {
                                <input
                                  class="field"
                                  [(ngModel)]="convDeliveryLocation"
                                  placeholder="Ce tiers n’a aucun site enregistré : lieu en texte libre"
                                />
                              }
                            </div>
                            @if (exigencesDuSite().length > 0) {
                              <div class="md:col-span-3 rounded-[3px] border border-warn/30 bg-warn-wash px-3 py-2">
                                <p class="mb-1 text-[12px] font-semibold text-warn-ink">Ce que ce site exige</p>
                                <ul class="space-y-0.5 text-[12px] text-ink-soft">
                                  @for (e of exigencesDuSite(); track e.id) {
                                    <li class="flex items-center gap-1.5">
                                      <erp-icon
                                        [name]="e.isBlocking ? 'lock' : 'clipboard-check'"
                                        [size]="12"
                                        [class]="e.isBlocking ? 'text-crit' : 'text-ink-faint'"
                                      />
                                      <span class="font-medium">{{ e.type.label }}</span>
                                      <span class="text-ink-soft">- {{ e.detail }}</span>
                                      @if (e.isBlocking) {
                                        <span class="text-[11px] font-medium text-crit">bloquant</span>
                                      }
                                    </li>
                                  }
                                </ul>
                              </div>
                            }
                          }
                        </div>
                        <button
                          class="btn-primary mt-3"
                          (click)="convertir(d)"
                          [disabled]="stateProforma.busy() || !peutConvertir(d)"
                        >
                          Convertir en affaire
                        </button>
                      </div>
                    }
                  </td>
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
    { value: 'PROFORMA_APPROVED', label: 'Proforma approuvée' },
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
  protected proformaStatusLabel(status: string): string {
    return PROFORMA_STATUS_LABEL[status] ?? status;
  }

  // --- Proforma en réponse à une demande (§ discussion 17/08) -------------

  protected readonly detailOuvert = signal<string | null>(null);
  protected readonly stateProforma = new ActionState();
  protected readonly devises = signal<DeviseOption[]>([]);
  protected readonly partners = signal<Partner[]>([]);
  private readonly catalogue = signal<ReferentialSpec[]>([]);

  protected proformaVolume: number | null = null;
  protected proformaUom = '';
  protected proformaPrice: number | null = null;
  protected proformaCurrency = '';

  protected convSegment = '';
  protected convTransportMode = '';
  protected convSiteId = '';
  protected convDeliveryLocation = '';

  protected readonly segments = computed(() => {
    const lus = this.enumValues(SEGMENT_FIELDS);
    return lus.length > 0 ? lus : SEGMENT_FALLBACK;
  });
  protected readonly transportModes = computed(() => {
    const lus = this.enumValues(TRANSPORT_FIELDS);
    return lus.length > 0 ? lus : TRANSPORT_FALLBACK;
  });

  protected readonly sitesDuTiers = computed<SiteOption[]>(() => {
    const id = this.detailOuvert();
    const d = this.demandes().find((x) => x.id === id);
    if (!d) return [];
    const partner = this.partners().find((p) => p.id === d.partnerId);
    if (!partner) return [];
    return partner.sites.map((s) => ({
      id: s.id,
      label: `${s.name}${s.city ? ' (' + s.city + ')' : ''}`,
      deliveryLocation: s.site?.name ?? s.name,
      exigences: s.site?.requirements ?? [],
    }));
  });
  protected readonly exigencesDuSite = computed(
    () => this.sitesDuTiers().find((s) => s.id === this.convSiteId)?.exigences ?? [],
  );

  protected onConvSiteChange(): void {
    const site = this.sitesDuTiers().find((s) => s.id === this.convSiteId);
    if (site) this.convDeliveryLocation = site.deliveryLocation;
  }

  protected peutConvertir(d: QuotationRequestInternalRow): boolean {
    if (!this.convSegment) return false;
    if (d.product.isService) return true;
    return !!(this.convTransportMode && this.convDeliveryLocation.trim());
  }

  private enumValues(names: string[]): string[] {
    for (const spec of this.catalogue()) {
      for (const field of spec.fields) {
        if (names.includes(field.name) && field.values?.length) return field.values;
      }
    }
    return [];
  }

  protected basculerDetail(d: QuotationRequestInternalRow): void {
    if (this.detailOuvert() === d.id) {
      this.detailOuvert.set(null);
      return;
    }
    this.detailOuvert.set(d.id);
    this.proformaVolume = Number(d.desiredVolume);
    this.proformaUom = d.uom;
    this.proformaPrice = null;
    this.convSegment = d.partner.segment ?? '';
    this.convTransportMode = '';
    this.convSiteId = '';
    this.convDeliveryLocation = '';
    this.stateProforma.error.set(null);
    this.stateProforma.done.set(null);
  }

  protected proformaValide(): boolean {
    return !!(this.proformaVolume && this.proformaUom.trim() && this.proformaPrice !== null && this.proformaCurrency);
  }

  protected soumettreProforma(d: QuotationRequestInternalRow): void {
    if (this.stateProforma.busy() || !this.proformaValide()) return;
    this.stateProforma.start();
    this.api
      .createInvoice({
        quotationRequestId: d.id,
        type: 'PROFORMA',
        billedVolume: Number(this.proformaVolume),
        uom: this.proformaUom.trim(),
        unitPrice: Number(this.proformaPrice),
        currencyCode: this.proformaCurrency,
      })
      .subscribe({
        next: () => {
          this.stateProforma.succeed('Proforma envoyée au client, PDF en cours de génération.');
          this.proformaPrice = null;
          this.load();
        },
        error: (e: HttpFailure) => this.stateProforma.fail(e),
      });
  }

  protected convertir(d: QuotationRequestInternalRow): void {
    if (this.stateProforma.busy() || !this.peutConvertir(d)) return;
    this.stateProforma.start();
    this.api
      .convertQuotation(d.id, {
        segment: this.convSegment,
        transportMode: d.product.isService ? undefined : this.convTransportMode,
        siteId: d.product.isService ? undefined : this.convSiteId || undefined,
        deliveryLocation: d.product.isService ? undefined : this.convDeliveryLocation.trim(),
      })
      .subscribe({
        next: () => {
          this.stateProforma.succeed('Affaire créée et reliée à la demande.');
          this.detailOuvert.set(null);
          this.load();
        },
        error: (e: HttpFailure) => this.stateProforma.fail(e),
      });
  }

  ngOnInit(): void {
    this.load();
    this.api.devises().subscribe((rows) => {
      this.devises.set(rows);
      const defaut = rows.find((r) => r.isLocal) ?? rows[0];
      if (defaut) this.proformaCurrency = defaut.code;
    });
    this.api.partners(1).subscribe((p) => this.partners.set(p.items));
    this.api.parameterCatalogue().subscribe((c) => this.catalogue.set(c));
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
