import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  FieldApiService,
  FieldOperationHistoryEntry,
  FieldOperationSummary,
} from '../../core/field-api.service';
import { messageDeRefus } from '../../core/field-queue.service';
import { IconComponent } from '../../shared/icon.component';
import { MOTIF_PRESENCE, jour } from './terrain-libelles';

/**
 * LISTE DE TRAVAIL.
 *
 * Une carte par opération, cliquable en entier. Ce qui figure ici est
 * exactement ce que rend `GET /api/field/operations` : la vue terrain est une
 * liste blanche construite pour qu'aucun prix ni aucun encours n'atteigne la
 * tablette (§ 10.3). Aller chercher le complément par les routes internes
 * contournerait ce cloisonnement — c'est interdit, et de toute façon le jeton
 * terrain y serait refusé.
 *
 * Aucun tri ni regroupement n'est refait ici : le serveur ordonne déjà par
 * date de chargement prévue. Retrier afficherait un ordre de journée qui n'est
 * pas celui du planificateur.
 */
@Component({
  selector: 'terrain-worklist',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <div class="t-screen">
      <h1 class="t-title">Mes opérations</h1>

      <!-- Deux onglets, pas plus : « en cours » est ce qu'on vient exécuter,
           « historique » ce qu'on vient vérifier a posteriori — deux gestes
           différents, jamais mélangés dans une même liste. -->
      <div class="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          class="t-btn"
          [class]="vue() === 'encours' ? 'bg-primary text-white' : 'border border-rule-strong bg-surface text-ink'"
          (click)="afficherEnCours()"
        >
          En cours
        </button>
        <button
          type="button"
          class="t-btn"
          [class]="vue() === 'historique' ? 'bg-primary text-white' : 'border border-rule-strong bg-surface text-ink'"
          (click)="afficherHistorique()"
        >
          Historique
        </button>
      </div>

      @if (erreur()) {
        <div
          class="mt-4 flex items-start gap-2 rounded-[3px] border border-crit/30 bg-crit-wash
                 px-3.5 py-3 text-[15px] leading-relaxed text-crit"
          role="alert"
        >
          <erp-icon name="alert-triangle" [size]="18" class="mt-0.5" />
          <span>{{ erreur() }}</span>
        </div>
      }

      @if (vue() === 'encours') {
        <p class="t-sub mt-3">
          {{ operations().length }} opération(s), telles que le planning vous les attribue.
        </p>

        @if (chargement()) {
          <p class="mt-8 text-center text-[15px] text-ink-muted">Chargement…</p>
        } @else if (operations().length === 0 && !erreur()) {
          <div class="mt-8 rounded-[3px] border border-rule-strong bg-surface p-6 text-center">
            <p class="text-[16px] font-semibold text-ink">Aucune opération ne vous est affectée.</p>
            <p class="t-hint">
              Si une opération devrait vous revenir, contactez le coordinateur logistique : une
              opération qui ne figure pas dans votre affectation ne vous est pas accessible, même
              par son identifiant.
            </p>
          </div>
        }

        <div class="mt-4">
          @for (op of operations(); track op.id) {
            <a class="t-card" [routerLink]="['/terrain/operation', op.id]">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="font-mono text-[15px] font-bold text-gray-900">{{ op.reference }}</p>
                  <p class="mt-0.5 truncate text-[16px] font-semibold text-ink">
                    {{ op.clientLegalName }}
                  </p>
                </div>
                <erp-icon name="chevron-right" [size]="22" class="mt-1 text-ink-faint" />
              </div>

              <p class="mt-2 text-[15px] text-ink-soft">
                {{ op.productName }} ·
                <span class="tabular font-semibold text-ink">{{ op.plannedVolume }}</span>
                <span class="t-code ml-1">{{ op.uom }}</span>
              </p>

              <p class="mt-1 text-[15px] text-ink-soft">
                {{ op.siteName ?? op.destinationLocation }}
              </p>

              <div class="mt-3 flex flex-wrap items-center gap-2">
                <!-- Statut et niveau de risque : rendus TELS QUELS. Leur donner
                     un libellé français ici afficherait un libellé faux dès
                     qu'une valeur serait ajoutée côté serveur. -->
                <span class="rounded-[3px] bg-gray-100 px-2.5 py-1.5">
                  <span class="t-code">{{ op.phase }}</span>
                </span>
                <span class="rounded-[3px] bg-gray-100 px-2.5 py-1.5">
                  <span class="t-code">RISQUE {{ op.hseRiskLevel }}</span>
                </span>
                <span class="text-[14px] text-ink-muted">
                  Chargement prévu {{ dateDe(op.plannedLoadingDate) }}
                </span>
              </div>

              <p class="mt-2.5 text-[14px] font-medium text-primary">
                {{ motif(op) }}
              </p>

              @if (op.checksAwaitingValidation.length > 0) {
                <p class="mt-1.5 flex items-center gap-1.5 text-[14px] font-semibold text-warn-ink">
                  <erp-icon name="clock" [size]="15" />
                  Checklist renseignée, en attente du contrôleur :
                  @for (p of op.checksAwaitingValidation; track p) {
                    <span class="t-code">{{ p }}</span>
                  }
                </p>
              }
            </a>
          }
        </div>
      } @else {
        <p class="t-sub mt-3">Opérations clôturées qui vous ont été affectées.</p>

        @if (chargementHistorique() && historique().length === 0) {
          <p class="mt-8 text-center text-[15px] text-ink-muted">Chargement…</p>
        } @else if (historique().length === 0 && !erreur()) {
          <div class="mt-8 rounded-[3px] border border-rule-strong bg-surface p-6 text-center">
            <p class="text-[16px] font-semibold text-ink">Aucune opération clôturée pour l’instant.</p>
          </div>
        }

        <div class="mt-4">
          @for (op of historique(); track op.id) {
            <a class="t-card" [routerLink]="['/terrain/operation', op.id]">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="font-mono text-[15px] font-bold text-gray-900">{{ op.reference }}</p>
                  <p class="mt-0.5 truncate text-[16px] font-semibold text-ink">
                    {{ op.clientLegalName }}
                  </p>
                </div>
                <erp-icon name="chevron-right" [size]="22" class="mt-1 text-ink-faint" />
              </div>

              <p class="mt-2 text-[15px] text-ink-soft">
                {{ op.productName }} ·
                <span class="tabular font-semibold text-ink">{{ op.plannedVolume }}</span>
                <span class="t-code ml-1">{{ op.uom }}</span>
              </p>

              <p class="mt-1 text-[15px] text-ink-soft">
                {{ op.siteName ?? op.destinationLocation }}
              </p>

              <p class="mt-2 text-[14px] text-ink-muted">
                Livraison {{ dateDe(op.actualDischargeDate) }}
              </p>
            </a>
          }
        </div>

        @if (historiquePeutCharger()) {
          <button
            type="button"
            class="t-btn-ghost mt-4"
            [disabled]="chargementHistorique()"
            (click)="chargerPlusHistorique()"
          >
            {{ chargementHistorique() ? 'Chargement…' : 'Charger plus' }}
          </button>
        }
      }
    </div>
  `,
})
export class TerrainWorklistComponent implements OnInit {
  private readonly api = inject(FieldApiService);

  protected readonly vue = signal<'encours' | 'historique'>('encours');

  protected readonly operations = signal<FieldOperationSummary[]>([]);
  protected readonly chargement = signal(true);
  protected readonly erreur = signal<string | null>(null);

  protected readonly historique = signal<FieldOperationHistoryEntry[]>([]);
  protected readonly chargementHistorique = signal(false);
  protected readonly historiquePeutCharger = signal(false);
  private pageHistorique = 1;
  private historiqueChargeUneFois = false;

  protected readonly dateDe = jour;

  ngOnInit(): void {
    this.api.operations().subscribe({
      next: (lignes) => {
        this.operations.set(lignes);
        this.chargement.set(false);
      },
      error: (e: unknown) => {
        this.chargement.set(false);
        this.erreur.set(messageDeRefus(e, 'Liste de travail indisponible.'));
      },
    });
  }

  protected motif(op: FieldOperationSummary): string {
    return MOTIF_PRESENCE[op.listedBecause];
  }

  protected afficherEnCours(): void {
    this.vue.set('encours');
  }

  protected afficherHistorique(): void {
    this.vue.set('historique');
    // Chargé une seule fois à l'ouverture de l'onglet, pas à chaque bascule :
    // revenir sur « en cours » puis rouvrir « historique » ne doit pas
    // redemander au serveur ce qu'on a déjà sous les yeux.
    if (!this.historiqueChargeUneFois) {
      this.historiqueChargeUneFois = true;
      this.chargerHistorique();
    }
  }

  protected chargerPlusHistorique(): void {
    this.pageHistorique += 1;
    this.chargerHistorique();
  }

  private chargerHistorique(): void {
    this.chargementHistorique.set(true);
    this.api.historique(this.pageHistorique).subscribe({
      next: (page) => {
        this.chargementHistorique.set(false);
        this.historique.set([...this.historique(), ...page.items]);
        this.historiquePeutCharger.set(page.hasMore);
      },
      error: (e: unknown) => {
        this.chargementHistorique.set(false);
        this.erreur.set(messageDeRefus(e, 'Historique indisponible.'));
      },
    });
  }
}
