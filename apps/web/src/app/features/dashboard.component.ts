import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ApiService,
  ComplianceSubject,
  EtatOperationnel,
  ExpiryItem,
  OperationParEtat,
} from '../core/api.service';
import { IconComponent } from '../shared/icon.component';
import { StatusBadgeComponent } from '../shared/status-badge.component';

/**
 * Tableau de bord du lot 1 — la conformité des moyens.
 *
 * C'est la valeur immédiate de ce lot : avant même qu'une opération existe,
 * savoir quel véhicule est immobilisable et quelle pièce arrive à échéance
 * justifie le déploiement.
 */
@Component({
  selector: 'erp-dashboard',
  standalone: true,
  imports: [RouterLink, IconComponent, StatusBadgeComponent],
  template: `
    <header class="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 class="page-title">Tableau de bord</h1>
        <p class="page-sub">Où en sont les opérations, et quels moyens sont immobilisables</p>
      </div>
      <a routerLink="/conformite" class="btn-ghost">
        Ouvrir la conformité
        <erp-icon name="arrow-right" [size]="14" />
      </a>
    </header>

    <!-- ================= Où en sont les opérations (§ 16) =================
         En tête du tableau de bord : c'est l'état de l'entreprise aujourd'hui,
         la conformité vient ensuite.

         Deux de ces états ne sont pas des statuts d'opération mais des TROUS
         ENTRE MODULES — livrée non facturée, facturée non encaissée. Ce sont
         eux qui coûtent : une opération close disparaît de la liste des
         opérations, et une facture émise ne dit pas qu'elle attend. -->
    @if (operationnel().length > 0) {
      <section class="mb-6">
        <div class="mb-2 flex items-center gap-2">
          <erp-icon name="truck" [size]="15" class="text-ink-muted" />
          <h2 class="text-[13px] font-semibold text-ink">Où en sont les opérations</h2>
        </div>
        <div class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          @for (e of operationnel(); track e.etat) {
            <button
              type="button"
              class="card px-[15px] py-3 text-left transition-shadow hover:shadow-soft"
              [class.border-crit]="etatGrave(e.etat)"
              [class.ring-2]="etatSelectionne() === e.etat"
              (click)="basculerDetail(e.etat)"
            >
              <p class="text-[11px] uppercase tracking-wide text-ink-muted">
                {{ etatLibelle(e.etat) }}
              </p>
              <p class="mt-0.5 text-[24px] font-semibold leading-none tabular"
                 [class]="etatGrave(e.etat) ? 'text-crit' : 'text-ink'">
                {{ e.operations }}
              </p>
              <p class="mt-1 text-[11px] leading-snug text-ink-faint">
                {{ etatExplication(e.etat) }}
                @if (e.retard_max_jours) {
                  · jusqu'à {{ e.retard_max_jours }} j
                }
              </p>
            </button>
          }
        </div>

        <!-- ⚠️ CORRIGÉ — LES CARTES ÉTAIENT MUETTES.
             operationsParEtat() existait déjà côté service, appelée par
             rien : un « 12 en retard » ne menait nulle part, il fallait
             rouvrir /operations et deviner le bon filtre à la main. -->
        @if (etatSelectionne(); as etat) {
          <div class="card mt-3 overflow-hidden">
            <div class="card-header">
              <h3 class="card-title">{{ etatLibelle(etat) }}</h3>
              <button class="link text-[12px]" (click)="etatSelectionne.set(null)">Fermer</button>
            </div>
            <div class="overflow-x-auto">
              <table class="table">
                <thead>
                  <tr>
                    <th>Opération</th>
                    <th>Affaire</th>
                    <th>Client</th>
                    <th>Produit</th>
                    <th class="num">Volume</th>
                    <th class="num">Reste à encaisser</th>
                  </tr>
                </thead>
                <tbody>
                  @for (o of detailEtat(); track o.operation_id) {
                    <tr>
                      <td>
                        <a [routerLink]="['/operations', o.operation_id]" class="ref hover:underline">
                          {{ o.reference }}
                        </a>
                      </td>
                      <td class="font-mono text-[12px] text-ink-muted">{{ o.affaire }}</td>
                      <td class="text-ink-soft">{{ o.client }}</td>
                      <td class="text-ink-soft">{{ o.produit }}</td>
                      <td class="num font-mono text-ink-soft">
                        {{ o.planned_volume }} {{ o.uom }}
                      </td>
                      <td class="num font-mono text-ink-soft">
                        {{ +o.reste_a_encaisser > 0 ? o.reste_a_encaisser : '-' }}
                      </td>
                    </tr>
                  } @empty {
                    <tr><td colspan="6" class="empty">Chargement…</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
      </section>
    }

    <!--
      Bandeau de synthèse : un seul bloc, séparé par des filets plutôt que par
      quatre cartes flottantes. Les chiffres se comparent d'un balayage, ce que
      des cartes espacées empêchent.
    -->
    <div class="card mb-5 grid grid-cols-2 gap-px overflow-hidden bg-rule lg:grid-cols-4">
      <div class="stat bg-surface">
        <span class="stat-label">Moyens suivis</span>
        <span class="stat-value">{{ overview().length }}</span>
        <span class="stat-note">Transporteurs, véhicules et chauffeurs</span>
      </div>

      <div class="stat bg-surface" [class.bg-crit-wash]="hasBlocked()">
        <span class="stat-label">Non conformes</span>
        <span class="stat-value flex items-center gap-2" [class]="countClass(blocked().length)">
          {{ blocked().length }}
          @if (hasBlocked()) {
            <erp-icon name="lock" [size]="16" />
          }
        </span>
        <span class="stat-note">Affectation bloquée sans dérogation du DG</span>
      </div>

      <div class="stat bg-surface">
        <span class="stat-label">Échéances proches</span>
        <span class="stat-value flex items-center gap-2" [class]="warnClass(expiringSoon().length)">
          {{ expiringSoon().length }}
          @if (hasExpiringSoon()) {
            <erp-icon name="clock" [size]="16" />
          }
        </span>
        <span class="stat-note">Sous 90 jours</span>
      </div>

      <div class="stat bg-surface">
        <span class="stat-label">Pièces expirées</span>
        <span class="stat-value" [class]="countClass(expired().length)">{{ expired().length }}</span>
        <span class="stat-note">À renouveler sans délai</span>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <!-- Moyens non conformes -->
      <section class="card overflow-hidden">
        <div class="card-header">
          <h2 class="card-title">Moyens non conformes</h2>
          <a routerLink="/conformite" class="link text-[12px]">Tout voir</a>
        </div>
        <div class="overflow-x-auto">
          @if (blocked().length === 0) {
            <p class="empty">
              Aucun moyen bloqué.<br />
              Agréments, assurances et contrôles techniques sont à jour.
            </p>
          } @else {
            <table class="table">
              <thead>
                <tr>
                  <th>Moyen</th><th>Identification</th>
                  <th class="num">Pièces échues</th><th>État</th>
                </tr>
              </thead>
              <tbody>
                @for (row of blocked(); track row.subject_id) {
                  <tr class="row-crit">
                    <td class="text-ink-muted">{{ kindLabel(row.subject_kind) }}</td>
                    <td>
                      <span class="ref">{{ row.subject_code }}</span>
                      <span class="ml-2 text-ink">{{ row.subject_label }}</span>
                    </td>
                    <td class="num font-mono font-semibold text-crit">{{ row.expired_count }}</td>
                    <td><erp-status-badge kind="blocked" label="Non conforme" /></td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      </section>

      <!-- Échéancier -->
      <section class="card overflow-hidden">
        <div class="card-header">
          <h2 class="card-title">Prochaines échéances</h2>
          <a routerLink="/echeancier" class="link text-[12px]">Tout voir</a>
        </div>
        <div class="overflow-x-auto">
          @if (upcoming().length === 0) {
            <p class="empty">Aucune échéance sous 90 jours.</p>
          } @else {
            <table class="table">
              <thead>
                <tr><th>Pièce</th><th>Porteur</th><th class="num">Reste</th><th>État</th></tr>
              </thead>
              <tbody>
                @for (item of upcoming(); track item.id) {
                  <tr [class]="rowClass(item.days_remaining)">
                    <td>
                      <span class="text-ink">{{ typeLabel(item.type) }}</span>
                      <span class="ml-2 font-mono text-[11px] text-ink-faint">{{ item.reference }}</span>
                    </td>
                    <td class="text-ink-soft">{{ item.owner_label }}</td>
                    <td class="num font-mono" [class]="daysClass(item.days_remaining)">
                      {{ remainingLabel(item.days_remaining) }}
                    </td>
                    <td>
                      <erp-status-badge
                        [kind]="item.status === 'EXPIRED' ? 'blocked' : 'wait'"
                        [label]="item.status === 'EXPIRED' ? 'Expirée' : 'À renouveler'" />
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      </section>
    </div>
  `,
})
export class DashboardComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly overview = signal<ComplianceSubject[]>([]);
  protected readonly expiry = signal<ExpiryItem[]>([]);
  protected readonly operationnel = signal<EtatOperationnel[]>([]);

  protected readonly etatSelectionne = signal<string | null>(null);
  protected readonly detailEtat = signal<OperationParEtat[]>([]);

  /** Referme si on reclique le même état ; sinon charge son détail. */
  protected basculerDetail(etat: string): void {
    if (this.etatSelectionne() === etat) {
      this.etatSelectionne.set(null);
      return;
    }
    this.etatSelectionne.set(etat);
    this.detailEtat.set([]);
    this.api.operationsParEtat(etat).subscribe({
      next: (rows) => this.detailEtat.set(rows),
      error: () => this.detailEtat.set([]),
    });
  }

  protected readonly blocked = computed(() => this.overview().filter((s) => !s.is_compliant));
  protected readonly expired = computed(() => this.expiry().filter((e) => e.days_remaining < 0));
  protected readonly expiringSoon = computed(() =>
    this.expiry().filter((e) => e.days_remaining >= 0 && e.days_remaining <= 90),
  );
  protected readonly upcoming = computed(() => this.expiry().slice(0, 8));
  protected readonly hasBlocked = computed(() => this.blocked().length > 0);
  protected readonly hasExpiringSoon = computed(() => this.expiringSoon().length > 0);

  /**
   * Libellés des états opérationnels.
   *
   * Écrits pour celui qui lit, pas pour la base : « Livrées non facturées » dit
   * ce qu'il faut faire, `LIVREE_NON_FACTUREE` dit comment c'est stocké.
   */
  private static readonly ETATS: Record<string, [string, string]> = {
    INCIDENT: ['Incidents', 'à traiter en priorité'],
    BLOQUEE_HSE: ['Bloquées HSE', 'ne peuvent pas partir'],
    NON_CONFORME: ['Moyens non conformes', 'pièce expirée après affectation'],
    EN_RETARD: ['En retard', 'chargement prévu, non fait'],
    LIVREE_NON_FACTUREE: ['Livrées non facturées', 'prestation faite, rien émis'],
    FACTUREE_NON_ENCAISSEE: ['Facturées non encaissées', 'argent dû'],
    EN_COURS: ['En cours', 'en exécution'],
    A_VENIR: ['À venir', 'préparation'],
  };

  protected etatLibelle(etat: string): string {
    return DashboardComponent.ETATS[etat]?.[0] ?? etat;
  }

  protected etatExplication(etat: string): string {
    return DashboardComponent.ETATS[etat]?.[1] ?? '';
  }

  /** Les quatre états où quelqu'un est arrêté ou de l'argent est en jeu. */
  protected etatGrave(etat: string): boolean {
    return ['INCIDENT', 'BLOQUEE_HSE', 'NON_CONFORME', 'EN_RETARD'].includes(etat);
  }

  /**
   * Les classes conditionnelles se calculent ici, pas dans le template :
   * un « > » dans une valeur d'attribut et un « / » dans un nom de binding
   * (`[class.ring-rose-500/40]`) cassent le parseur de template Angular.
   */
  protected countClass(count: number): string {
    return count > 0 ? 'text-crit' : 'text-ink';
  }

  protected warnClass(count: number): string {
    return count > 0 ? 'text-warn-ink' : 'text-ink';
  }

  /** Liseré de sévérité : la forme double la teinte. */
  protected rowClass(days: number): string {
    if (days < 0) return 'row-crit';
    if (days <= 30) return 'row-warn';
    return '';
  }

  ngOnInit(): void {
    this.api.complianceOverview().subscribe((rows) => this.overview.set(rows));
    this.api.expiryWatch(90).subscribe((rows) => this.expiry.set(rows));
    // Repli silencieux : un rôle sans accès au tableau opérationnel garde le
    // reste du tableau de bord plutôt que de perdre l'écran entier.
    this.api.tableauOperationnel().subscribe({
      next: (rows) => this.operationnel.set(rows),
      error: () => undefined,
    });
  }

  protected kindLabel(kind: string): string {
    return { CARRIER: 'Transporteur', VEHICLE: 'Véhicule', DRIVER: 'Chauffeur' }[kind] ?? kind;
  }

  protected typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  /**
   * Les comparaisons vivent dans le composant, jamais dans l'interpolation :
   * le parseur de template lit « < » comme une ouverture de balise.
   */
  protected remainingLabel(days: number): string {
    return days < 0 ? 'échue' : `${days} j`;
  }

  protected daysClass(days: number): string {
    if (days < 0) return 'font-semibold text-crit';
    if (days <= 30) return 'font-semibold text-warn-ink';
    return 'text-ink-soft';
  }
}

export const TYPE_LABELS: Record<string, string> = {
  CUSTOMS_LICENSE: 'Agrément douanier',
  MINISTERIAL_APPROVAL: 'Agrément ministériel',
  IMPORT_EXPORT_LICENSE: "Licence d'import/export",
  INSURANCE: 'Assurance',
  TECHNICAL_INSPECTION: 'Contrôle technique',
  DRIVER_LICENSE: 'Permis de conduire',
  DRIVER_TRAINING: 'Habilitation chauffeur',
  HSE_CERTIFICATION: 'Certification HSE',
  VESSEL_CERTIFICATE: 'Certificat de navire',
  SAFETY_DATA_SHEET: 'Fiche de données de sécurité',
  OTHER: 'Autre',
};
