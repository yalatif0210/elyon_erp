import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  ComplianceRecordDetail,
  ComplianceSubject,
  ExpiryItem,
  VocabItem,
} from '../core/api.service';
import {
  ActionFeedbackComponent,
  ActionState,
  failureMessage,
  HttpFailure,
} from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';
import { TableauPagine, TableauControlesComponent } from '../shared/tableau';
import { StatusBadgeComponent } from '../shared/status-badge.component';
import { dateOnly, daysClass, remainingLabel } from '../shared/format';

const KIND_LABELS: Record<string, string> = {
  CARRIER: 'Transporteur',
  VEHICLE: 'Véhicule',
  DRIVER: 'Chauffeur',
  ENTREPRISE: 'Elyon Trading',
};

/**
 * Conformité des moyens (§ discussion 20/08).
 *
 * ⚠️ FUSION DE DEUX ÉCRANS QUI MONTRAIENT LA MÊME INFORMATION SOUS DEUX
 *    ANGLES, JAMAIS RAPPROCHÉS.
 *
 *    « Conformité des moyens » répondait à « ce véhicule est-il affectable ? »
 *    (une ligne par moyen). « Échéancier réglementaire » répondait à « qu'est-
 *    ce qui expire bientôt ? » (une ligne par pièce). Un moyen non conforme
 *    l'est TOUJOURS parce qu'une pièce de l'échéancier a expiré — deux menus,
 *    deux routes, deux écrans d'administration pour la même donnée.
 *
 *    Un seul écran désormais, deux onglets. Le dépôt d'une pièce vit sous
 *    l'onglet « Par pièce » — c'est la vue centrée sur la pièce elle-même,
 *    celle où l'enregistrer a un sens, pas celle centrée sur le moyen.
 */
@Component({
  selector: 'erp-compliance',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    StatusBadgeComponent,
    ActionFeedbackComponent,
    TableauControlesComponent,
  ],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Conformité</h1>
      <p class="page-sub">
        Un moyen non conforme ne peut être affecté sans dérogation du Directeur Général : le
        statut se déduit des pièces à échéance, il ne se saisit jamais.
      </p>
    </header>

    <div class="mb-5 flex gap-2">
      <button
        type="button"
        class="rounded-md px-3.5 py-2 text-[13px] font-medium transition-all"
        [class]="vue() === 'moyen'
          ? 'bg-primary text-white'
          : 'border border-rule-strong bg-surface text-ink-soft hover:bg-gray-100 hover:text-ink'"
        (click)="vue.set('moyen')"
      >
        Par moyen
      </button>
      <button
        type="button"
        class="rounded-md px-3.5 py-2 text-[13px] font-medium transition-all"
        [class]="vue() === 'piece'
          ? 'bg-primary text-white'
          : 'border border-rule-strong bg-surface text-ink-soft hover:bg-gray-100 hover:text-ink'"
        (click)="vue.set('piece')"
      >
        Par pièce
      </button>
    </div>

    <!-- ============================= PAR MOYEN ============================= -->
    @if (vue() === 'moyen') {
      @if (rowsError()) {
        <p class="mb-4 rounded-[3px] bg-crit-wash px-3 py-2 text-[12px] text-crit" role="alert">
          {{ rowsError() }}
        </p>
      }
      <div class="mb-4 flex flex-wrap items-center gap-2">
        @for (f of filters; track f.value) {
          <button
            class="rounded-md px-3 py-1.5 text-[12px] font-medium transition-all"
            [class]="active() === f.value
              ? 'bg-primary text-white'
              : 'border border-rule-strong bg-surface text-ink-soft hover:bg-gray-100 hover:text-ink'"
            (click)="filtrer(f.value)"
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
    }

    <!-- ============================= PAR PIÈCE ============================= -->
    @if (vue() === 'piece') {
      <erp-action-feedback [error]="state.error()" [success]="state.done()" />

      <!-- ============ Enregistrer une pièce de conformité ============ -->
      <section class="card mb-5">
        <div class="card-header"><h2 class="card-title">Enregistrer une pièce</h2></div>
        <div class="card-body">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label class="label" for="type-c">Nature</label>
              <select id="type-c" class="field" [(ngModel)]="newType">
                @for (t of types(); track t.code) {
                  <option [ngValue]="t.code">{{ t.label }}</option>
                }
              </select>
            </div>
            <div>
              <label class="label" for="porteur">Porteur</label>
              <select id="porteur" class="field" [(ngModel)]="newSubject">
                <option [ngValue]="''">Choisir</option>
                <!-- Sentinel sans tiers, véhicule ni chauffeur : l'agrément
                     porte sur l'entreprise elle-même, pas un sous-traitant ni
                     l'un de ses moyens (§ discussion 22/08). -->
                <option [ngValue]="'ENTREPRISE:entreprise'">Elyon Trading : agrément d’entreprise</option>
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
            @if (!estPorteurEntreprise()) {
              <div class="flex items-end pb-2.5">
                <label class="flex items-center gap-2 text-[13px] text-ink-soft">
                  <input type="checkbox" class="accent-[var(--primary)]" [(ngModel)]="newIsBlocking" />
                  Bloque l’affectation si expirée ou suspendue
                </label>
              </div>
            }
            <div class="md:col-span-3">
              <label class="label" for="scan">Pièce numérisée (facultatif)</label>
              <input
                id="scan"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                class="field h-auto py-2"
                [disabled]="uploadBusy()"
                (change)="onFile($event)"
              />
              @if (uploadBusy()) {
                <p class="mt-1 text-[11px] text-ink-muted">Envoi du scan…</p>
              } @else if (uploadedTitle()) {
                <p class="mt-1 flex items-center gap-1.5 text-[11px] text-ok">
                  <erp-icon name="check-circle" [size]="12" />
                  {{ uploadedTitle() }} déposé, sera rattaché à l’enregistrement.
                </p>
              } @else if (uploadError()) {
                <p class="mt-1 text-[11px] text-crit">{{ uploadError() }}</p>
              }
            </div>
          </div>
          <p class="mt-2 text-[11px] leading-relaxed text-ink-faint">
            Le statut de conformité n’est pas saisi : il se DÉRIVE de l’échéance. Une pièce
            expirée et bloquante rend son porteur non affectable, sauf dérogation du DG ; une
            pièce facultative (une formation, par exemple) peut être décochée sans bloquer.
          </p>
          <button class="btn-primary mt-3" (click)="addRecord()" [disabled]="state.busy() || uploadBusy()">
            Enregistrer la pièce
          </button>
        </div>
      </section>

      <!-- ============ Échéancier ============ -->
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
    }
  `,
})
export class ComplianceComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly vue = signal<'moyen' | 'piece'>('moyen');

  protected readonly state = new ActionState();
  protected readonly types = signal<VocabItem[]>([]);

  protected newType = 'INSURANCE';
  /** Porteur encodé « TYPE:identifiant » — un seul sélecteur pour trois cibles. */
  protected newSubject = '';
  protected newReference = '';
  protected newIssuingBody = '';
  protected newIssueDate = new Date().toISOString().slice(0, 10);
  protected newExpiryDate = '';
  /** Repli à `true` : décochée explicitement pour une pièce facultative. */
  protected newIsBlocking = true;

  protected readonly uploadBusy = signal(false);
  protected readonly uploadError = signal<string | null>(null);
  protected readonly uploadedTitle = signal<string | null>(null);
  private uploadedDocumentId: string | null = null;

  protected readonly rows = signal<ComplianceSubject[]>([]);
  protected readonly rowsError = signal<string | null>(null);

  /** Recherche et pagination des porteurs de pièces. */
  protected readonly tableauSujets = new TableauPagine<ComplianceSubject>();

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

  /**
   * Le tableau suit le filtre existant.
   *
   * `filtered()` porte déjà le filtre par nature et par conformité : la
   * recherche et la pagination viennent PAR-DESSUS, elles ne le remplacent
   * pas. Les brancher sur la liste brute aurait fait réapparaître ce que le
   * filtre venait d'écarter.
   *
   * Appelée explicitement (au chargement et à chaque clic de filtre), pas via
   * un `effect()` comme la version précédente : `TableauPagine.définir` écrit
   * sur ses propres signaux, et un `effect()` qui écrit ainsi en cascade est
   * un candidat plausible à un tableau qui reste vide sans la moindre erreur
   * visible. L'appel direct est en tout cas le même schéma déjà éprouvé pour
   * l'échéancier plus bas (`remplir`) et pour les autres écrans (`dashboard`,
   * `collections`) - jamais suspecté de ce défaut.
   */
  private actualiserTableauSujets(): void {
    this.tableauSujets.définir(this.filtered());
  }

  protected filtrer(valeur: 'all' | 'blocked' | 'VEHICLE' | 'DRIVER' | 'CARRIER'): void {
    this.active.set(valeur);
    this.actualiserTableauSujets();
  }

  // --- Échéancier -----------------------------------------------------------

  protected readonly items = signal<ExpiryItem[]>([]);
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
    this.reload();
    this.load();
    this.api.vocabulaires().subscribe((v) => this.types.set(v.complianceType));
  }

  protected reload(): void {
    this.rowsError.set(null);
    this.api.complianceOverview().subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.actualiserTableauSujets();
      },
      error: (e: HttpFailure) => this.rowsError.set(failureMessage(e, 'Lecture des moyens refusée.')),
    });
  }

  protected load(): void {
    this.api.expiryWatch(Number(this.horizon), this.blockingOnly).subscribe({
      next: (rows) => this.remplir(rows),
      error: (e: HttpFailure) => this.state.error.set(failureMessage(e, 'Lecture de l’échéancier refusée.')),
    });
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

  /**
   * Dépôt du scan, déclenché au choix du fichier — pas à l'enregistrement.
   *
   * L'agent qui a le document en main mais pas encore tous les autres champs
   * (référence exacte, date d'expiration à vérifier) ne doit pas perdre le
   * scan parce qu'il quitte l'écran entre-temps.
   */
  protected onFile(evenement: Event): void {
    const champ = evenement.target as HTMLInputElement;
    const fichier = champ.files?.[0];
    if (!fichier) return;

    this.uploadBusy.set(true);
    this.uploadError.set(null);
    this.uploadedTitle.set(null);
    // ⚠️ Un échec sur un SECOND essai doit aussi vider l'identifiant du
    //    PREMIER. Sans ça, un dépôt réussi puis un remplacement raté laissent
    //    un identifiant orphelin qui partirait quand même à l'enregistrement,
    //    pendant que l'écran affiche un refus qui laisse croire que rien
    //    n'est rattaché.
    this.uploadedDocumentId = null;
    this.api.uploadComplianceDocument(fichier, this.newType).subscribe({
      next: (doc) => {
        this.uploadBusy.set(false);
        this.uploadedDocumentId = doc.id;
        this.uploadedTitle.set(doc.title);
      },
      error: (e: HttpFailure) => {
        this.uploadBusy.set(false);
        this.uploadError.set(failureMessage(e, 'Dépôt du scan refusé.'));
        champ.value = '';
      },
    });
  }

  /** Vrai quand le porteur choisi est l'entreprise elle-même, pas un tiers/moyen. */
  protected estPorteurEntreprise(): boolean {
    return this.newSubject.startsWith('ENTREPRISE:');
  }

  protected addRecord(): void {
    if (this.state.busy()) return;
    const [kind, id] = this.newSubject.split(':');
    if (!id) {
      this.state.error.set('Choisir le porteur de la pièce.');
      return;
    }
    this.state.start();

    // Deux tables distinctes derrière un seul formulaire : un agrément
    // d'entreprise n'a ni tiers, ni véhicule, ni chauffeur, et
    // `chk_compliance_single_owner` refuserait de toute façon une ligne sans
    // porteur dans `compliance_records` — d'où la route séparée.
    const requete =
      kind === 'ENTREPRISE'
        ? this.api.addCompanyAccreditation({
            type: this.newType,
            reference: this.newReference,
            issuingBody: this.newIssuingBody || undefined,
            issueDate: this.newIssueDate,
            expiryDate: this.newExpiryDate || undefined,
            documentId: this.uploadedDocumentId ?? undefined,
          })
        : this.api.addComplianceRecord({
            type: this.newType,
            reference: this.newReference,
            issuingBody: this.newIssuingBody || undefined,
            issueDate: this.newIssueDate,
            expiryDate: this.newExpiryDate || undefined,
            partnerId: kind === 'CARRIER' ? id : undefined,
            vehicleId: kind === 'VEHICLE' ? id : undefined,
            driverId: kind === 'DRIVER' ? id : undefined,
            documentId: this.uploadedDocumentId ?? undefined,
            isBlocking: this.newIsBlocking,
          });

    requete.subscribe({
      next: () => {
        this.state.succeed('Pièce enregistrée : le statut de conformité est recalculé.');
        this.newReference = '';
        this.newIsBlocking = true;
        this.uploadedDocumentId = null;
        this.uploadedTitle.set(null);
        this.reload();
        this.load();
      },
      error: (e: HttpFailure) => this.state.fail(e),
    });
  }

  protected typeLabel(type: string): string {
    return this.types().find((v) => v.code === type)?.label ?? type;
  }

  protected kindLabel(kind: string): string {
    return KIND_LABELS[kind] ?? { PARTNER: 'Tiers' }[kind] ?? kind;
  }

  protected readonly dateOnly = dateOnly;
  protected readonly remainingLabel = remainingLabel;
  protected readonly daysClass = daysClass;
}
