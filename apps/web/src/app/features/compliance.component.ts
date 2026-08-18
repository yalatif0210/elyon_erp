import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, ComplianceRecordDetail, ComplianceSubject, ExpiryItem } from '../core/api.service';
import {
  ActionFeedbackComponent,
  ActionState,
  HttpFailure,
} from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';
import { TableauPagine, TableauControlesComponent } from '../shared/tableau';
import { StatusBadgeComponent } from '../shared/status-badge.component';
import { TYPE_LABELS } from './dashboard.component';
import { dateOnly, daysClass, remainingLabel } from '../shared/format';

const KIND_LABELS: Record<string, string> = {
  CARRIER: 'Transporteur',
  VEHICLE: 'Véhicule',
  DRIVER: 'Chauffeur',
};

/** Natures de pièce, telles que l'énumération de la base les définit. */
const COMPLIANCE_TYPES: { code: string; label: string }[] = [
  { code: 'INSURANCE', label: 'Assurance' },
  { code: 'TECHNICAL_INSPECTION', label: 'Contrôle technique' },
  { code: 'DRIVER_LICENSE', label: 'Permis de conduire' },
  { code: 'DRIVER_TRAINING', label: 'Habilitation chauffeur' },
  { code: 'CUSTOMS_LICENSE', label: 'Agrément douanier' },
  { code: 'MINISTERIAL_APPROVAL', label: 'Agrément ministériel' },
  { code: 'IMPORT_EXPORT_LICENSE', label: 'Licence import/export' },
  { code: 'HSE_CERTIFICATION', label: 'Certification HSE' },
  { code: 'VESSEL_CERTIFICATE', label: 'Certificat de navire' },
  { code: 'SAFETY_DATA_SHEET', label: 'Fiche de données de sécurité' },
  { code: 'OTHER', label: 'Autre' },
];

@Component({
  selector: 'erp-compliance',
  standalone: true,
  imports: [FormsModule, IconComponent, StatusBadgeComponent, ActionFeedbackComponent, TableauControlesComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Conformité des moyens</h1>
      <p class="page-sub">
        Statut déduit des pièces à échéance, jamais saisi. Un moyen non conforme ne peut être
        affecté sans dérogation du Directeur Général.
      </p>
    </header>

    <erp-action-feedback [error]="state.error()" [success]="state.done()" />

    <!-- ============ Enregistrer une pièce de conformité ============ -->
    <section class="card mb-5">
      <div class="card-header"><h2 class="card-title">Enregistrer une pièce</h2></div>
      <div class="card-body">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label class="label" for="type-c">Nature</label>
            <select id="type-c" class="field" [(ngModel)]="newType">
              @for (t of types; track t.code) {
                <option [ngValue]="t.code">{{ t.label }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label" for="porteur">Porteur</label>
            <select id="porteur" class="field" [(ngModel)]="newSubject">
              <option [ngValue]="''">Choisir</option>
              @for (o of rows(); track o.subject_id) {
                <option [ngValue]="o.subject_kind + ':' + o.subject_id">
                  {{ kindLabel(o.subject_kind) }} · {{ o.subject_label }}
                </option>
              }
            </select>
          </div>
          <div>
            <label class="label" for="ref-c">Référence de la pièce</label>
            <input id="ref-c" class="field font-mono" [(ngModel)]="newReference" />
          </div>
          <div>
            <label class="label" for="emet">Organisme émetteur</label>
            <input id="emet" class="field" [(ngModel)]="newIssuingBody" />
          </div>
          <div>
            <label class="label" for="del">Délivrée le</label>
            <input id="del" type="date" class="field" [(ngModel)]="newIssueDate" />
          </div>
          <div>
            <label class="label" for="exp">Expire le</label>
            <input id="exp" type="date" class="field" [(ngModel)]="newExpiryDate" />
          </div>
        </div>
        <p class="mt-2 text-[11px] leading-relaxed text-ink-faint">
          Le statut de conformité n’est pas saisi : il se DÉRIVE de l’échéance. Une pièce
          expirée rend son porteur non affectable, sauf dérogation du DG.
        </p>
        <button class="btn-primary mt-3" (click)="addRecord()" [disabled]="state.busy()">
          Enregistrer la pièce
        </button>
      </div>
    </section>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      @for (f of filters; track f.value) {
        <button
          class="rounded-md px-3 py-1.5 text-[12px] font-medium transition-all"
          [class]="active() === f.value
            ? 'bg-primary text-white'
            : 'border border-rule-strong bg-surface text-ink-soft hover:bg-gray-100 hover:text-ink'"
          (click)="active.set(f.value)"
        >
          {{ f.label }}
        </button>
      }
      <span class="ml-auto text-[12px] text-ink-faint">{{ filtered().length }} résultat(s)</span>
    </div>

    <div class="card overflow-hidden">
      <erp-tableau-controles [tableau]="tableauSujets" libelle="les porteurs" />
      <div class="overflow-x-auto">
      <table class="table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Identification</th>
            <th class="num">Expirées</th>
            <th class="num">À échoir</th>
            <th class="num">Prochaine échéance</th>
            <th>État</th>
          </tr>
        </thead>
        <tbody>
          @for (row of tableauSujets.lignes(); track row.subject_id) {
            <tr>
              <td class="text-ink-muted">{{ kindLabel(row.subject_kind) }}</td>
              <td>
                <span class="ref">{{ row.subject_code }}</span>
                <span class="ml-2 text-ink">{{ row.subject_label }}</span>
              </td>
              <td class="num" [class]="row.expired_count > 0 ? 'font-semibold text-crit' : 'text-ink-faint'">
                {{ row.expired_count }}
              </td>
              <td class="num" [class]="row.expiring_count > 0 ? 'font-semibold text-warn-ink' : 'text-ink-faint'">
                {{ row.expiring_count }}
              </td>
              <td class="num text-ink-soft">{{ row.next_expiry ? dateOnly(row.next_expiry) : '-' }}</td>
              <td>
                @if (row.is_compliant) {
                  <erp-status-badge kind="ok" label="Conforme" />
                } @else {
                  <erp-status-badge kind="blocked" label="Non conforme" />
                }
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="6" class="empty">Aucun moyen dans ce filtre.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    </div>
  `,
})
export class ComplianceComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly state = new ActionState();
  protected readonly types = COMPLIANCE_TYPES;

  protected newType = 'INSURANCE';
  /** Porteur encodé « TYPE:identifiant » — un seul sélecteur pour trois cibles. */
  protected newSubject = '';
  protected newReference = '';
  protected newIssuingBody = '';
  protected newIssueDate = new Date().toISOString().slice(0, 10);
  protected newExpiryDate = '';

  protected readonly rows = signal<ComplianceSubject[]>([]);

  /** Recherche et pagination des porteurs de pièces. */
  protected readonly tableauSujets = new TableauPagine<ComplianceSubject>();

  /**
   * Le tableau suit le filtre existant.
   *
   * `filtered()` porte déjà le filtre par nature et par conformité : la
   * recherche et la pagination viennent PAR-DESSUS, elles ne le remplacent
   * pas. Les brancher sur la liste brute aurait fait réapparaître ce que le
   * filtre venait d'écarter.
   */
  private readonly suitLeFiltre = effect(() => this.tableauSujets.définir(this.filtered()));

  protected readonly active = signal<'all' | 'blocked' | 'VEHICLE' | 'DRIVER' | 'CARRIER'>('all');

  protected readonly filters = [
    { label: 'Tous', value: 'all' as const },
    { label: 'Non conformes', value: 'blocked' as const },
    { label: 'Véhicules', value: 'VEHICLE' as const },
    { label: 'Chauffeurs', value: 'DRIVER' as const },
    { label: 'Transporteurs', value: 'CARRIER' as const },
  ];

  protected readonly filtered = computed(() => {
    const filter = this.active();
    const all = this.rows();
    if (filter === 'all') return all;
    if (filter === 'blocked') return all.filter((r) => !r.is_compliant);
    return all.filter((r) => r.subject_kind === filter);
  });

  ngOnInit(): void {
    this.reload();
  }

  protected reload(): void {
    this.api.complianceOverview().subscribe((rows) => this.rows.set(rows));
  }

  protected addRecord(): void {
    if (this.state.busy()) return;
    const [kind, id] = this.newSubject.split(':');
    if (!id) {
      this.state.error.set('Choisir le porteur de la pièce.');
      return;
    }
    this.state.start();

    this.api
      .addComplianceRecord({
        type: this.newType,
        reference: this.newReference,
        issuingBody: this.newIssuingBody || undefined,
        issueDate: this.newIssueDate,
        expiryDate: this.newExpiryDate || undefined,
        partnerId: kind === 'CARRIER' ? id : undefined,
        vehicleId: kind === 'VEHICLE' ? id : undefined,
        driverId: kind === 'DRIVER' ? id : undefined,
      })
      .subscribe({
        next: () => {
          this.state.succeed('Pièce enregistrée : le statut de conformité est recalculé.');
          this.newReference = '';
          this.reload();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }

  protected kindLabel(kind: string): string {
    return KIND_LABELS[kind] ?? kind;
  }

  protected readonly dateOnly = dateOnly;
}

// ===========================================================================

@Component({
  selector: 'erp-expiry',
  standalone: true,
  imports: [FormsModule, IconComponent, StatusBadgeComponent, TableauControlesComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Échéancier réglementaire</h1>
      <p class="page-sub">
        Agréments, assurances, contrôles techniques et habilitations, par ordre d'échéance.
      </p>
    </header>

    <div class="mb-4 flex flex-wrap items-center gap-3">
      <label class="flex items-center gap-2 text-[12px] text-ink-soft">
        Horizon
        <select class="field w-auto py-1.5 text-[12px]" [(ngModel)]="horizon" (ngModelChange)="load()">
          <option [value]="30">30 jours</option>
          <option [value]="90">90 jours</option>
          <option [value]="180">180 jours</option>
          <option [value]="365">1 an</option>
        </select>
      </label>

      <label class="flex items-center gap-2 text-[12px] text-ink-soft">
        <input type="checkbox" class="accent-[var(--primary)]" [(ngModel)]="blockingOnly" (ngModelChange)="load()" />
        Pièces bloquantes seulement
      </label>

      <span class="ml-auto text-[12px] text-ink-faint">{{ items().length }} pièce(s)</span>
    </div>

    <div class="card overflow-hidden">
      <!-- Recherche et pagination : la liste couvre un horizon entier et
           dépasse vite l'écran. Chercher une immatriculation à la molette
           n'est pas une méthode. -->
      <erp-tableau-controles [tableau]="tableau" libelle="les pièces" />
      <div class="overflow-x-auto">
      <table class="table">
        <thead>
          <tr>
            <th>Pièce</th><th>Référence</th><th>Porteur</th>
            <th class="num">Expiration</th><th class="num">Reste</th><th>État</th><th>Bloquante</th>
          </tr>
        </thead>
        <tbody>
          @for (item of tableau.lignes(); track item.id) {
            <tr class="cursor-pointer hover:bg-gray-50" (click)="basculer(item.id)">
              <td class="text-ink">{{ typeLabel(item.type) }}</td>
              <td class="font-mono text-[12px] text-ink-muted">{{ item.reference }}</td>
              <td class="text-ink-soft">
                <span class="text-[11px] uppercase text-ink-faint">{{ kindLabel(item.owner_kind) }}</span>
                <span class="ml-2">{{ item.owner_label }}</span>
              </td>
              <td class="num text-ink-soft">{{ dateOnly(item.expiry_date) }}</td>
              <td class="num" [class]="daysClass(item.days_remaining)">
                {{ remainingLabel(item.days_remaining) }}
              </td>
              <td>
                @if (item.status === 'EXPIRED') {
                  <erp-status-badge kind="blocked" label="Expirée" />
                } @else if (item.status === 'EXPIRING') {
                  <erp-status-badge kind="wait" label="À renouveler" />
                } @else {
                  <erp-status-badge kind="ok" label="Valide" />
                }
              </td>
              <td>
                @if (item.is_blocking) {
                  <span class="inline-flex items-center gap-1 text-[12px] text-crit">
                    <erp-icon name="lock" [size]="12" /> Oui
                  </span>
                } @else {
                  <span class="text-[12px] text-ink-faint">Non</span>
                }
              </td>
            </tr>
            <!-- ⚠️ CORRIGÉ — GET /compliance/records/:id N'AVAIT AUCUN
                 APPELANT : la liste ne montrait ni l'organisme émetteur, ni la
                 date d'émission, ni la pièce numérisée elle-même. -->
            @if (ouvert() === item.id) {
              <tr>
                <td colspan="7" class="bg-gray-50 px-4 py-3">
                  @if (detail(); as d) {
                    <dl class="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px] md:grid-cols-4">
                      <div><dt class="text-ink-faint">Organisme émetteur</dt><dd class="text-ink">{{ d.issuingBody ?? '-' }}</dd></div>
                      <div><dt class="text-ink-faint">Émise le</dt><dd class="text-ink">{{ dateOnly(d.issueDate) }}</dd></div>
                      <div><dt class="text-ink-faint">Enregistrée pour</dt>
                        <dd class="text-ink">
                          {{ d.partner?.legalName ?? d.vehicle?.registration ?? d.driver?.fullName ?? '-' }}
                        </dd>
                      </div>
                      <div>
                        <dt class="text-ink-faint">Pièce numérisée</dt>
                        <dd>
                          @if (d.document) {
                            <button type="button" class="link" (click)="voirDocument(d.id)">
                              {{ d.document.title }} ↗
                            </button>
                          } @else {
                            <span class="text-ink-faint">Aucune pièce jointe</span>
                          }
                        </dd>
                      </div>
                    </dl>
                  } @else {
                    <p class="text-[12px] text-ink-faint">Chargement…</p>
                  }
                </td>
              </tr>
            }
          } @empty {
            <tr>
              <td colspan="7" class="empty">
                Aucune pièce n'arrive à échéance sur cet horizon.
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    </div>
  `,
})
export class ExpiryComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly items = signal<ExpiryItem[]>([]);

  /**
   * Pagination et recherche, côté navigateur.
   *
   * La liste est chargée en entier — c'est ce que veut l'écran, qui affiche un
   * horizon complet. Ce qui manquait, c'était de pouvoir la parcourir et y
   * chercher une référence sans faire défiler des centaines de lignes.
   */
  protected readonly tableau = new TableauPagine<ExpiryItem>();

  /** Une seule porte d'entrée : le signal ET le tableau restent en phase. */
  private remplir(rows: ExpiryItem[]): void {
    this.items.set(rows);
    this.tableau.définir(rows);
  }

  protected horizon = 90;
  protected blockingOnly = false;

  protected readonly ouvert = signal<string | null>(null);
  protected readonly detail = signal<ComplianceRecordDetail | null>(null);

  ngOnInit(): void {
    this.load();
  }

  protected basculer(id: string): void {
    if (this.ouvert() === id) {
      this.ouvert.set(null);
      return;
    }
    this.ouvert.set(id);
    this.detail.set(null);
    this.api.complianceRecord(id).subscribe((d) => this.detail.set(d));
  }

  protected voirDocument(recordId: string): void {
    this.api.complianceDocumentBlob(recordId).subscribe((blob) => {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    });
  }

  protected load(): void {
    this.api.expiryWatch(Number(this.horizon), this.blockingOnly).subscribe((rows) => this.remplir(rows));
  }

  protected typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  protected kindLabel(kind: string): string {
    return { PARTNER: 'Tiers', VEHICLE: 'Véhicule', DRIVER: 'Chauffeur' }[kind] ?? kind;
  }

  protected readonly dateOnly = dateOnly;
  protected readonly remainingLabel = remainingLabel;
  protected readonly daysClass = daysClass;
}
