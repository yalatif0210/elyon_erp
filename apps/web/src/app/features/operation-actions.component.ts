import { Component, computed, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  DeviseOption,
  ComplianceSubject,
  CostPostRow,
  HseGate,
  MeasurementSummary,
  OperationRow,
  OperationDetail,
} from '../core/api.service';
import { AuthService } from '../core/auth.service';
import {
  ActionFeedbackComponent,
  ActionState,
  HttpFailure,
} from '../shared/action-panel.component';
import { DerogationInlineComponent } from '../shared/derogation-inline.component';
import { IconComponent } from '../shared/icon.component';
import { MontantDirective } from '../shared/montant.directive';

/** Étapes offertes, dans l'ordre où elles se présentent réellement. */
const NEXT_STEPS: { to: string; label: string }[] = [
  { to: 'SOURCING', label: 'Mettre en sourcing' },
  { to: 'HSE_PREPARATION', label: 'Préparation HSE' },
  { to: 'PLANNED', label: 'Planifier' },
  { to: 'LOADING', label: 'Chargement' },
  { to: 'IN_TRANSIT', label: 'Départ en transit' },
  { to: 'DELIVERING', label: 'Livraison' },
  { to: 'FINAL_CHECK', label: 'Contrôle final' },
  { to: 'CLOSED', label: 'Clôturer' },
];

/**
 * Conduite d'une opération (§ 7, § 11.2).
 *
 * Trois gestes : affecter les moyens, faire avancer l'opération, enregistrer
 * le relevé de volume. Aucun n'est arbitré ici — le verrou HSE, le verrou de
 * conformité et le calcul d'ullage sont appliqués par la base. L'écran montre
 * l'état du verrou AVANT la tentative, ce qui évite un refus incompris.
 */
@Component({
  selector: 'erp-operation-actions',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    ActionFeedbackComponent,
    MontantDirective,
    DerogationInlineComponent,
  ],
  template: `
    <section class="card overflow-hidden">
      <div class="card-header">
        <h2 class="card-title">Conduite de l’opération</h2>
        <span class="text-[11px] text-ink-faint">{{ operation.status }}</span>
      </div>

      <div class="card-body">
        <erp-action-feedback [error]="state.error()" [success]="state.done()" />

        <!-- CORRIGÉ : les formulaires restaient affichés sur une opération
             clôturée ou annulée, sans aucune condition de statut.
             L'affectation des moyens et le relevé de volume proposaient leurs
             boutons comme si l'opération était encore en cours ; le serveur
             aurait refusé l'écriture, mais rien à l'écran ne le laissait
             deviner avant d'essayer. -->
        @if (estTerminee()) {
          <p class="rounded-[3px] border border-rule-strong bg-gray-50 px-3.5 py-3 text-[13px] text-ink-soft">
            Opération {{ operation.status === 'CANCELLED' ? 'annulée' : 'clôturée' }} : elle ne
            reçoit plus d’affectation, de relevé ni de changement d’état.
          </p>
        } @else {

        <!-- ============ Affectation des moyens ============ -->
        <h3 class="mb-2 text-[13px] font-semibold text-ink">Moyens affectés</h3>
        <p class="mb-3 text-[11px] leading-relaxed text-ink-faint">
          Le statut de conformité est dérivé des pièces à échéance : il ne se saisit pas. Un
          moyen non conforme est refusé, sauf dérogation du DG.
        </p>

        <!-- ============ Transporteur : lecture seule ============
             Retenu au chiffrage de l'affaire, avec son coût comparé au tarif
             négocié (§ 5.4, revu le 22/08/2026) — plus choisi ni modifiable
             ici.

             ⚠️ CORRIGÉ — operation.assignment?.carrier reste NUL tant que
                le coordinateur n'a pas affecté véhicule et chauffeur : ce
                geste est ce qui COPIE le transporteur sur l'affectation. Le
                lire uniquement là annonçait « aucun » pour une affaire dont
                le chiffrage avait pourtant retenu un transporteur, simplement
                parce que les moyens n'avaient pas encore été affectés. -->
        <p class="mb-3 text-[13px]">
          <span class="text-ink-muted">Transporteur retenu au chiffrage : </span>
          <span class="font-semibold text-ink">
            {{ carrierRetenu() ?? 'aucun (voir le chiffrage de l’affaire)' }}
          </span>
        </p>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label class="label" for="vehicle">Véhicule</label>
            <select id="vehicle" class="field" [(ngModel)]="vehicleId">
              <option [ngValue]="''">Choisir</option>
              @for (v of subjects('VEHICLE'); track v.subject_id) {
                <option [ngValue]="v.subject_id">
                  {{ v.subject_code }} · {{ v.subject_label
                  }}{{ v.is_compliant ? '' : ' (non conforme)' }}
                </option>
              }
            </select>
          </div>
          <div>
            <label class="label" for="driver">Chauffeur</label>
            <select id="driver" class="field" [(ngModel)]="driverId">
              <option [ngValue]="''">Choisir</option>
              @for (d of subjects('DRIVER'); track d.subject_id) {
                <option [ngValue]="d.subject_id">
                  {{ d.subject_label }}{{ d.is_compliant ? '' : ' (non conforme)' }}
                </option>
              }
            </select>
          </div>
        </div>

        <!-- ============ Dérogation de conformité (§ 11.2, § 11.4) ============
             ⚠️ CORRIGÉ — complianceDerogationId existait sur le DTO d'affectation
                depuis toujours, sans aucun chemin pour le renseigner : un moyen non
                conforme sélectionné ci-dessus était refusé par la base, sans que
                le DG puisse jamais lever le verrou depuis l'écran. -->
        @if (moyenNonConforme(); as label) {
          @if (isDg()) {
            <div class="mt-3">
              <erp-derogation-inline
                type="TRANSPORT_NON_COMPLIANCE"
                subjectType="OperationAssignment"
                [subjectId]="operation.reference"
                [subjectLabel]="operation.reference"
                [titre]="label + ' n’est pas conforme : dérogation du DG obligatoire'"
                (accorde)="complianceDerogationId.set($event)"
              />
            </div>
          } @else if (!complianceDerogationId()) {
            <p class="mt-3 rounded-[3px] bg-crit-wash px-3 py-2 text-[12px] text-crit">
              {{ label }} n’est pas conforme. Seul le DG peut accorder la dérogation qui permet de
              l’affecter malgré tout.
            </p>
          }
        }

        <button class="btn-primary mt-3" (click)="assign()" [disabled]="state.busy()">
          Affecter les moyens
        </button>

        <!-- ============ Exigences du site de livraison ============
             Elles se saisissent au référentiel des SITES ; ici on les lève.
             Une exigence bloquante non acquittée empêche le départ — et le
             refus tombe au moment du chargement, c'est-à-dire trop tard pour
             retirer un badge. -->
        @if (exigences().length > 0) {
          <h3 class="mb-2 mt-6 text-[13px] font-semibold text-ink">Exigences du site</h3>
          <p class="mb-3 text-[11px] leading-relaxed text-ink-faint">
            Portées par le site de livraison, pas par le client : plusieurs clients s’y font
            livrer. Elles se saisissent au paramétrage des sites ; ici on atteste qu’elles sont
            levées.
          </p>

          @for (e of exigences(); track e.id) {
            <div
              class="mb-2 rounded-[3px] border px-3.5 py-3"
              [class]="
                acquittee(e.id)
                  ? 'border-ok/40 bg-ok-wash'
                  : e.isBlocking
                    ? 'border-crit/40 bg-crit-wash'
                    : 'border-rule-strong bg-surface'
              "
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-[13px] font-semibold text-ink">
                    {{ e.type.label }}
                    @if (e.isBlocking) {
                      <span
                        class="ml-1.5 inline-flex items-center gap-1 rounded-[3px] bg-crit px-1.5
                               py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                      >
                        <erp-icon name="lock" [size]="10" />
                        Bloquant
                      </span>
                    }
                  </p>
                  <p class="mt-0.5 text-[12px] leading-snug text-ink-soft">{{ e.detail }}</p>
                </div>
                @if (acquittee(e.id); as a) {
                  <span class="flex shrink-0 items-center gap-1 text-[12px] font-medium text-ok">
                    <erp-icon name="check-circle" [size]="14" />
                    Levée
                  </span>
                }
              </div>

              @if (acquittee(e.id); as a) {
                <p class="mt-1.5 text-[11px] text-ink-muted">
                  {{ a.acknowledgedBy.fullName }} · {{ a.acknowledgedAt.slice(0, 10) }}
                  @if (a.note) { · {{ a.note }} }
                </p>
              } @else {
                <div class="mt-2 flex gap-2">
                  <input
                    class="field flex-1 text-[12px]"
                    maxlength="500"
                    placeholder="Ce qui a été fait : « badge n° 4471 retiré le 06/08 »"
                    [(ngModel)]="notesExigence[e.id]"
                  />
                  <button
                    class="btn-secondary shrink-0"
                    [disabled]="state.busy()"
                    (click)="acquitter(e.id)"
                  >
                    Attester
                  </button>
                </div>
              }
            </div>
          }
        }

        <!-- ============ Avancement ============ -->
        <h3 class="mb-2 mt-6 text-[13px] font-semibold text-ink">Avancement</h3>

        <div
          class="mb-3 flex items-start gap-2 rounded-[3px] px-3 py-2 text-[13px]"
          [class]="gate.open ? 'bg-ok-wash text-ok' : 'bg-crit-wash text-crit'"
        >
          <erp-icon [name]="gate.open ? 'check-circle' : 'lock'" [size]="14" class="mt-0.5" />
          <span>{{ gate.message }}</span>
        </div>

        <!-- ============ Dérogation HSE_BLOCKING_OVERRIDE (§ 11.2) ============
             ⚠️ CORRIGÉ — hseDerogationId n'était écrit nulle part : un point
                bloquant réellement irrattrapable sur site (équipement absent
                qu'on ne peut pas faire apparaître) n'avait AUCUNE issue. Le
                trigger sait depuis toujours lever le verrou sur une dérogation
                opposable — il lui manquait un geste pour la recevoir. -->
        @if (!gate.open && !gate.byDerogation && peutLeverVerrouHse()) {
          <div class="mb-3">
            <erp-derogation-inline
              type="HSE_BLOCKING_OVERRIDE"
              subjectType="Operation"
              [subjectId]="operation.reference"
              [subjectLabel]="operation.reference"
              titre="Aucun rattrapage possible sur site : lever le verrou par dérogation"
              (accorde)="leverVerrouHse($event)"
            />
          </div>
        }

        <div class="flex flex-wrap gap-2">
          @for (s of steps; track s.to) {
            <button
              class="btn-ghost"
              [disabled]="state.busy() || s.to === operation.status"
              (click)="move(s.to, s.label)"
            >
              {{ s.label }}
            </button>
          }
        </div>

        <!-- ============ Relevé de volume ============ -->
        <h3 class="mb-2 mt-6 text-[13px] font-semibold text-ink">Relevé de volume</h3>
        <p class="mb-3 text-[11px] leading-relaxed text-ink-faint">
          Volumes corrigés à 15 °C. L’écart est CALCULÉ par le système, jamais déclaré. La
          température est exigée : sans elle, un écart peut n’être qu’un ullage fantôme dû à la
          dilatation.
        </p>

        <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <label class="label" for="loaded">Volume chargé</label>
            <input id="loaded" class="field text-right font-mono" erpMontant [(ngModel)]="loaded" />
          </div>
          <div>
            <label class="label" for="discharged">Volume livré</label>
            <input id="discharged" class="field text-right font-mono" erpMontant [(ngModel)]="discharged" />
          </div>
          <div>
            <label class="label" for="density">Densité 15 °C</label>
            <input id="density" class="field text-right font-mono" [(ngModel)]="density" />
          </div>
          <div>
            <label class="label" for="temp">Température °C</label>
            <input id="temp" class="field text-right font-mono" [(ngModel)]="tempC" />
          </div>
          <div>
            <label class="label" for="source">Source</label>
            <select id="source" class="field" [(ngModel)]="source">
              <option value="CONTRADICTORY">Contradictoire</option>
              <option value="INDEPENDENT_INSPECTION">Inspection indépendante</option>
              <option value="SELF_MEASURED">Auto-mesure</option>
            </select>
          </div>
          <div>
            <label class="label" for="mdate">Date du relevé</label>
            <input id="mdate" type="date" class="field" [(ngModel)]="measurementDate" />
          </div>
        </div>

        <button class="btn-primary mt-3" (click)="measure()" [disabled]="state.busy()">
          Enregistrer le relevé
        </button>

        <!-- Acquittement d'un écart : réservé au CCOO, au CFO et au DG. -->
        @if (measurements.length > 0) {
          <div class="mt-4 space-y-2">
            @for (m of measurements; track m.id) {
              <div
                class="flex flex-wrap items-center gap-2 rounded-[3px] px-3 py-2 text-[13px]"
                [class]="m.ullageAckAt ? 'bg-gray-100 text-ink-soft' : 'bg-warn-wash text-warn-ink'"
              >
                <erp-icon [name]="m.ullageAckAt ? 'check-circle' : 'alert-triangle'" [size]="13" />
                <span class="font-mono">{{ m.reference }}</span>
                <span>écart {{ m.ullageVariancePct }} %</span>
                @if (m.ullageAckAt) {
                  <span class="text-ink-faint">acquitté</span>
                } @else if (canAcknowledge()) {
                  <input
                    class="field ml-auto max-w-sm"
                    [(ngModel)]="ackReason"
                    placeholder="Motif de l’acquittement (10 caractères minimum)"
                    [attr.aria-label]="'Motif pour ' + m.reference"
                  />
                  <button class="btn-ghost" (click)="acknowledge(m.id)" [disabled]="state.busy()">
                    Acquitter
                  </button>
                }
              </div>
            }
          </div>
        }

        }

        <!-- ============ Coûts constatés ============
             Reste accessible même après clôture : une facture fournisseur du
             coût réel peut arriver bien après la livraison physique, et le
             rapprochement de marge en a besoin. -->
        <h3 class="mb-2 mt-6 text-[13px] font-semibold text-ink">Coût constaté</h3>
        <p class="mb-3 text-[11px] leading-relaxed text-ink-faint">
          Dès qu’une ligne existe ici, elle prend le pas sur le chiffrage de l’affaire dans le
          calcul de marge. L’écart entre les deux mesure la fiabilité du devis.
        </p>
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="label" for="poste-op">Poste</label>
            <select id="poste-op" class="field" [(ngModel)]="costPostId">
              <option [ngValue]="''">Choisir</option>
              @for (c of costPosts(); track c.id) {
                <option [ngValue]="c.id">{{ c.label }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label" for="mnt-op">Montant constaté</label>
            <input id="mnt-op" class="field w-40 text-right font-mono" erpMontant [(ngModel)]="costAmount" />
          </div>
          <button class="btn-ghost" (click)="addCost()" [disabled]="state.busy() || !costPostId">
            Ajouter
          </button>
        </div>
      </div>
    </section>
  `,
})
export class OperationActionsComponent {
  private readonly api = inject(ApiService);
  protected readonly devises = signal<DeviseOption[]>([]);

  constructor() {
    this.api.devises().subscribe((l) => this.devises.set(l));
  }
  private readonly auth = inject(AuthService);

  /**
   * Le DOSSIER complet, pas la ligne de liste : cet écran a besoin du site de
   * livraison et de ses exigences, que la liste ne porte pas.
   */
  @Input({ required: true }) operation!: OperationDetail;
  @Input({ required: true }) gate!: HseGate;
  /** Relevés déjà enregistrés — pour proposer l'acquittement au bon rôle. */
  @Input() measurements: MeasurementSummary[] = [];
  @Output() readonly changed = new EventEmitter<void>();

  protected readonly state = new ActionState();
  protected readonly steps = NEXT_STEPS;
  protected readonly compliance = signal<ComplianceSubject[]>([]);

  protected vehicleId = '';
  protected driverId = '';
  protected readonly complianceDerogationId = signal<string | null>(null);

  /** Note de levée, par exigence — saisie avant d'attester. */
  protected notesExigence: Record<string, string> = {};

  protected readonly exigences = computed(() => this.operation.destinationSite?.requirements ?? []);

  /** L'acquittement d'une exigence, s'il existe. */
  protected acquittee(requirementId: string) {
    return (this.operation.siteRequirementAcks ?? []).find(
      (a) => a.requirementId === requirementId,
    );
  }

  protected acquitter(requirementId: string): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api
      .acknowledgeSiteRequirement(
        this.operation.id,
        requirementId,
        this.notesExigence[requirementId]?.trim() || undefined,
      )
      .subscribe({
        next: () => {
          this.state.succeed('Exigence levée.');
          this.changed.emit();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }

  protected loaded: number | null = null;
  protected discharged: number | null = null;
  protected density = 0.84;
  protected tempC: number | null = null;
  protected source = 'CONTRADICTORY';
  protected measurementDate = new Date().toISOString().slice(0, 10);

  protected ackReason = '';
  protected costPostId = '';
  protected costAmount: number | null = null;
  protected readonly costPosts = signal<CostPostRow[]>([]);

  private loadedOnce = false;

  ngOnChanges(): void {
    if (this.loadedOnce) return;
    this.loadedOnce = true;
    // Les moyens proposés viennent de la vue de conformité : leur statut y est
    // dérivé des pièces à échéance, jamais stocké sur le moyen lui-même.
    this.api.complianceOverview().subscribe((c) => this.compliance.set(c));
    this.api.costPosts2().subscribe((c) => this.costPosts.set(c));
  }

  /** L'acquittement d'un écart est réservé au CCOO, au CFO et au DG (§ 8.3). */
  protected canAcknowledge(): boolean {
    const r = this.auth.role();
    return r === 'CCOO' || r === 'FINANCE_CFO' || r === 'DG';
  }

  protected acknowledge(measurementId: string): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api.acknowledgeUllage(measurementId, this.ackReason).subscribe({
      next: () => {
        this.state.succeed('Écart acquitté.');
        this.ackReason = '';
        this.changed.emit();
      },
      error: (e: HttpFailure) => this.state.fail(e),
    });
  }

  protected addCost(): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api
      .addCostLine(this.operation.id, {
        costPostId: this.costPostId,
        estimatedAmount: Number(this.costAmount ?? 0),
        actualAmount: Number(this.costAmount ?? 0),
        currencyCode: this.deviseLocale(),
      })
      .subscribe({
        next: () => {
          this.state.succeed('Coût constaté enregistré.');
          this.costPostId = '';
          this.costAmount = null;
          this.changed.emit();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }

  protected subjects(kind: 'CARRIER' | 'VEHICLE' | 'DRIVER'): ComplianceSubject[] {
    return this.compliance().filter((c) => c.subject_kind === kind);
  }

  protected isDg(): boolean {
    return this.auth.role() === 'DG';
  }

  /** Statuts terminaux : plus d'affectation, de relevé ni de changement d'état. */
  protected estTerminee(): boolean {
    return this.operation.status === 'CLOSED' || this.operation.status === 'CANCELLED';
  }

  /** Qui peut lever le verrou HSE par dérogation — même liste que la route serveur. */
  protected peutLeverVerrouHse(): boolean {
    const r = this.auth.role();
    return r === 'DG' || r === 'CCOO' || r === 'FINANCE_CFO';
  }

  protected leverVerrouHse(derogationId: string): void {
    this.state.start();
    this.api.attachHseDerogation(this.operation.id, derogationId).subscribe({
      next: () => {
        this.state.succeed('Dérogation rattachée : le verrou HSE est levé.');
        this.changed.emit();
      },
      error: (e: HttpFailure) => this.state.fail(e),
    });
  }

  /**
   * Le transporteur retenu au chiffrage de l'affaire (§ 5.4), qu'il ait déjà
   * été copié sur une affectation de moyens ou non — l'affectation ne fait
   * que le reprendre, elle ne le choisit jamais.
   */
  private carrierChiffrage(): { id: string; legalName: string } | null {
    return this.operation.deal.costLines.find((l) => l.supplier)?.supplier ?? null;
  }

  protected carrierRetenu(): string | null {
    return (this.operation.assignment?.carrier ?? this.carrierChiffrage())?.legalName ?? null;
  }

  /**
   * Le premier moyen non conforme, désigné par son libellé.
   *
   * Le transporteur n'est plus SÉLECTIONNÉ ici : il vient du chiffrage de
   * l'affaire (§ 5.4). Sa conformité se vérifie donc sur celui déjà retenu,
   * pas sur un choix fait à cet écran — et ce, dès le chiffrage, avant même
   * qu'une affectation de moyens existe sur l'opération.
   */
  protected moyenNonConforme(): string | null {
    if (this.complianceDerogationId()) return null;
    const selection = [
      { id: (this.operation.assignment?.carrier ?? this.carrierChiffrage())?.id ?? null, kind: 'CARRIER' as const },
      { id: this.vehicleId, kind: 'VEHICLE' as const },
      { id: this.driverId, kind: 'DRIVER' as const },
    ];
    for (const s of selection) {
      if (!s.id) continue;
      const sujet = this.compliance().find((c) => c.subject_kind === s.kind && c.subject_id === s.id);
      if (sujet && !sujet.is_compliant) return sujet.subject_label;
    }
    return null;
  }

  protected assign(): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api
      .assignMeans(this.operation.id, {
        vehicleId: this.vehicleId || undefined,
        driverId: this.driverId || undefined,
        ...(this.complianceDerogationId()
          ? { complianceDerogationId: this.complianceDerogationId()! }
          : {}),
      })
      .subscribe({
        next: () => {
          this.state.succeed('Moyens affectés.');
          this.complianceDerogationId.set(null);
          this.changed.emit();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }

  protected move(to: string, label: string): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api.moveOperation(this.operation.id, to).subscribe({
      next: () => {
        this.state.succeed(`${label} : état enregistré.`);
        this.changed.emit();
      },
      error: (e: HttpFailure) => this.state.fail(e),
    });
  }

  protected measure(): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api
      .recordMeasurement(this.operation.id, {
        source: this.source,
        measurementDate: this.measurementDate,
        uom: this.operation.uom,
        loadedVolume15: Number(this.loaded ?? 0),
        dischargedVolume15: Number(this.discharged ?? 0),
        measuredDensity15: Number(this.density),
        observedTempC: this.tempC === null ? undefined : Number(this.tempC),
      })
      .subscribe({
        next: () => {
          this.state.succeed('Relevé enregistré : l’écart a été calculé.');
          this.changed.emit();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }

  /**
   * La devise LOCALE de l'entreprise, lue au référentiel.
   *
   * ⚠️ `'XOF'` était écrit en dur ici. Une devise codée dans un écran survit à
   *    tout changement de paramétrage : le jour où l'entreprise travaille en
   *    euros, il faut retrouver l'écran. Et ce n'est jamais le PIVOT qu'on
   *    prend — il sert à comparer, il n'est la monnaie de personne.
   */
  protected deviseLocale(): string {
    return this.devises().find((d) => d.isLocal)?.code ?? this.devises()[0]?.code ?? '';
  }

}
