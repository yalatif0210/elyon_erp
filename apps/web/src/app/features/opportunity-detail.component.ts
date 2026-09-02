import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { ActionFeedbackComponent, ActionState, HttpFailure } from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';
import { grouper } from '../shared/format';

interface Stage {
  id: string;
  code: string;
  label: string;
  rank: number;
  outcome: string;
}

interface Interaction {
  id: string;
  kind: string;
  occurredAt: string;
  summary: string;
  contactName: string | null;
  nextAction: string;
  nextActionDue: string;
  nextActionDone: boolean;
  author: { fullName: string };
}

interface Transition {
  id: string;
  occurredAt: string;
  note: string | null;
  fromStage: { code: string; label: string } | null;
  toStage: { code: string; label: string };
}

interface Opportunity {
  id: string;
  reference: string;
  title: string;
  segment: string;
  estimatedVolume: string;
  uom: string;
  referencePrice: string;
  currencyCode: string;
  expectedCloseDate: string | null;
  nextAction: string;
  nextActionDue: string;
  closedAt: string | null;
  lossReason: string | null;
  notes: string | null;
  partner: { code: string; legalName: string; type: string };
  product: { code: string; name: string } | null;
  stage: Stage;
  owner: { fullName: string; role: string };
  deal: { id: string; reference: string; status: string } | null;
  interactions: Interaction[];
  transitions: Transition[];
}

const KIND_LABELS: Record<string, string> = {
  CALL: 'Appel',
  EMAIL: 'Courriel',
  MEETING: 'Réunion',
  VISIT: 'Visite',
  MESSAGE: 'Message',
  OFFER: 'Offre',
  REPORT: 'Compte rendu',
  DOCUMENT: 'Document',
  COMPLAINT: 'Réclamation',
};

/**
 * Fiche opportunité (§ 15).
 *
 * ⚠️ CORRIGÉ — CET ÉCRAN N'EXISTAIT PAS.
 *
 *    `GET .../opportunites/:id`, le changement d'étape, la journalisation
 *    d'interaction et la clôture d'action étaient tous complets côté
 *    serveur, sans aucun appelant. Voir `opportunity-create.component.ts`
 *    pour le même constat sur la création.
 */
@Component({
  selector: 'erp-opportunity-detail',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, ActionFeedbackComponent],
  template: `
    @if (opp(); as o) {
      <nav class="mb-3 flex items-center gap-1.5 text-[12px] text-ink-muted">
        <a routerLink="/crm" class="link">Pipeline commercial</a>
        <erp-icon name="chevron-right" [size]="12" />
        <span class="font-mono text-ink">{{ o.reference }}</span>
      </nav>

      <header class="mb-5">
        <h1 class="page-title">{{ o.title }}</h1>
        <p class="page-sub">
          {{ o.partner.legalName }} · {{ o.segment }} · {{ o.stage.label }}
          @if (o.deal) {
            · <a [routerLink]="['/affaires', o.deal.id]" class="link">affaire {{ o.deal.reference }}</a>
          }
        </p>
      </header>

      <div class="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1fr]">
        <div class="flex flex-col gap-5">
          <!-- ============ Résumé ============ -->
          <section class="card overflow-hidden">
            <div class="card-header"><h2 class="card-title">Résumé</h2></div>
            <table class="table">
              <tbody>
                <tr>
                  <td class="text-ink-soft">Responsable</td>
                  <td class="num text-ink">{{ o.owner.fullName }}</td>
                </tr>
                <tr>
                  <td class="text-ink-soft">Produit envisagé</td>
                  <td class="num text-ink">{{ o.product ? o.product.name : 'Pas encore arrêté' }}</td>
                </tr>
                <tr>
                  <td class="text-ink-soft">Volume estimé</td>
                  <td class="num font-mono text-ink">{{ o.estimatedVolume }} {{ o.uom }}</td>
                </tr>
                <tr>
                  <td class="text-ink-soft">Prix de référence</td>
                  <td class="num font-mono text-ink">{{ money(+o.referencePrice) }} {{ o.currencyCode }}</td>
                </tr>
                <tr class="bg-gray-100">
                  <td class="font-semibold text-ink">CA prévisionnel</td>
                  <td class="num font-mono font-semibold text-ink">
                    {{ money(+o.estimatedVolume * +o.referencePrice) }} {{ o.currencyCode }}
                  </td>
                </tr>
                <tr>
                  <td class="text-ink-soft">Clôture espérée</td>
                  <td class="num text-ink">{{ o.expectedCloseDate ? jour(o.expectedCloseDate) : '-' }}</td>
                </tr>
                @if (o.closedAt) {
                  <tr>
                    <td class="text-ink-soft">Sortie du pipeline</td>
                    <td class="num text-ink">
                      {{ jour(o.closedAt) }}
                      @if (o.lossReason) { · {{ o.lossReason }} }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
            @if (o.notes) {
              <p class="border-t border-rule px-[15px] py-2.5 text-[12px] leading-relaxed text-ink-soft">
                {{ o.notes }}
              </p>
            }
          </section>

          <!-- ============ Prochaine action de l'étape ============ -->
          <section class="card overflow-hidden" [class.border-crit]="actionEnRetard(o)">
            <div class="card-header"><h2 class="card-title">Prochaine action</h2></div>
            <div class="card-body">
              <p class="text-[13px] text-ink">{{ o.nextAction }}</p>
              <p class="mt-1 text-[12px]" [class]="actionEnRetard(o) ? 'text-crit' : 'text-ink-faint'">
                Échéance {{ jour(o.nextActionDue) }}
                @if (actionEnRetard(o)) { · en retard }
              </p>
              <p class="mt-2 text-[11px] leading-relaxed text-ink-faint">
                Se met à jour en franchissant une étape (ci-contre), y compris en resélectionnant
                l’étape courante, pour la seule redéfinir sans faire progresser l’opportunité.
              </p>
            </div>
          </section>

          <!-- ============ Affaire reliée (§ 15) ============
               Geste humain assumé, jamais une création automatique : voir le
               commentaire de CrmService.lierAffaire côté serveur. -->
          @if (o.stage.outcome === 'WON') {
            <section class="card overflow-hidden">
              <div class="card-header"><h2 class="card-title">Affaire</h2></div>
              <div class="card-body">
                <erp-action-feedback [error]="stateDeal.error()" [success]="stateDeal.done()" />
                @if (o.deal) {
                  <p class="text-[13px] text-ink">
                    Reliée à
                    <a [routerLink]="['/affaires', o.deal.id]" class="link font-mono">{{ o.deal.reference }}</a>
                  </p>
                  <button
                    class="btn-ghost mt-2"
                    (click)="retirerAffaire()"
                    [disabled]="stateDeal.busy()"
                  >
                    Retirer le lien
                  </button>
                } @else {
                  <p class="text-[12px] text-ink-faint">
                    Aucune affaire reliée. Si l’affaire née de cette opportunité a déjà été créée
                    séparément, recherchez-la ici pour les relier.
                  </p>
                }
                <div class="mt-3 flex gap-2">
                  <input
                    class="field flex-1"
                    placeholder="Référence ou client…"
                    [(ngModel)]="dealSearch"
                    (keyup.enter)="rechercherAffaires()"
                  />
                  <button class="btn-ghost" (click)="rechercherAffaires()" [disabled]="stateDeal.busy()">
                    Rechercher
                  </button>
                </div>
                @if (dealResults().length > 0) {
                  <ul class="mt-2 divide-y divide-rule border border-rule">
                    @for (d of dealResults(); track d.id) {
                      <li class="flex items-center justify-between px-3 py-2 text-[12px]">
                        <span>
                          <span class="font-mono text-ink">{{ d.reference }}</span>
                          · {{ d.client.legalName }}
                        </span>
                        <button class="link" (click)="lierAffaire(d.id)" [disabled]="stateDeal.busy()">
                          Relier
                        </button>
                      </li>
                    }
                  </ul>
                } @else if (dealSearched()) {
                  <p class="mt-2 text-[12px] text-ink-faint">Aucune affaire trouvée pour cette recherche.</p>
                }
              </div>
            </section>
          }

          <!-- ============ Franchir une étape ============ -->
          @if (!o.closedAt) {
            <section class="card overflow-hidden">
              <div class="card-header"><h2 class="card-title">Changer d’étape</h2></div>
              <div class="card-body">
                <erp-action-feedback [error]="state.error()" [success]="state.done()" />
                <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label class="label" for="cible">Étape cible</label>
                    <select id="cible" class="field" [(ngModel)]="stageId" (change)="onStageChange()">
                      @for (s of stages(); track s.id) {
                        <option [ngValue]="s.id">{{ s.label }}</option>
                      }
                    </select>
                  </div>
                  @if (cibleEstPerte()) {
                    <div>
                      <label class="label" for="motif-perte">Motif de perte *</label>
                      <input id="motif-perte" class="field" [(ngModel)]="lossReason" />
                    </div>
                  }
                  <div>
                    <label class="label" for="nouvelle-action">Nouvelle prochaine action</label>
                    <input id="nouvelle-action" class="field" [(ngModel)]="moveNextAction" />
                  </div>
                  <div>
                    <label class="label" for="nouvelle-echeance">Nouvelle échéance</label>
                    <input id="nouvelle-echeance" type="date" class="field" [(ngModel)]="moveNextActionDue" />
                  </div>
                  <div class="md:col-span-2">
                    <label class="label" for="note-etape">Note</label>
                    <input id="note-etape" class="field" [(ngModel)]="moveNote" />
                  </div>
                </div>
                <button
                  class="btn-primary mt-3"
                  (click)="changerEtape()"
                  [disabled]="state.busy() || (cibleEstPerte() && !lossReason.trim())"
                >
                  Confirmer
                </button>
              </div>
            </section>
          }
        </div>

        <div class="flex flex-col gap-5">
          <!-- ============ Journaliser une interaction ============ -->
          <section class="card overflow-hidden">
            <div class="card-header"><h2 class="card-title">Journaliser un échange</h2></div>
            <div class="card-body">
              <erp-action-feedback [error]="stateInteraction.error()" [success]="stateInteraction.done()" />
              <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label class="label" for="nature">Nature</label>
                  <select id="nature" class="field" [(ngModel)]="kind">
                    @for (k of kinds; track k.code) {
                      <option [ngValue]="k.code">{{ k.label }}</option>
                    }
                  </select>
                </div>
                <div>
                  <label class="label" for="quand">Date</label>
                  <input id="quand" type="date" class="field" [(ngModel)]="occurredAt" />
                </div>
                <div class="md:col-span-2">
                  <label class="label" for="resume">Compte rendu *</label>
                  <textarea id="resume" class="field" rows="2" [(ngModel)]="summary"></textarea>
                </div>
                <div>
                  <label class="label" for="contact">Interlocuteur</label>
                  <input id="contact" class="field" [(ngModel)]="contactName" />
                </div>
                <div></div>
                <div>
                  <label class="label" for="action-i">Prochaine action *</label>
                  <input id="action-i" class="field" [(ngModel)]="interactionNextAction" />
                </div>
                <div>
                  <label class="label" for="echeance-i">Échéance *</label>
                  <input id="echeance-i" type="date" class="field" [(ngModel)]="interactionNextActionDue" />
                </div>
              </div>
              <button
                class="btn-primary mt-3"
                (click)="journaliser()"
                [disabled]="stateInteraction.busy() || !peutJournaliser()"
              >
                Enregistrer
              </button>
            </div>
          </section>

          <!-- ============ Historique des échanges ============ -->
          <section class="card overflow-hidden">
            <div class="card-header"><h2 class="card-title">Échanges ({{ o.interactions.length }})</h2></div>
            <div class="divide-y divide-rule">
              @for (i of o.interactions; track i.id) {
                <div class="px-4 py-3">
                  <div class="flex items-start justify-between gap-2">
                    <p class="text-[12px] font-medium text-ink">
                      {{ kindLabel(i.kind) }} · {{ jour(i.occurredAt) }}
                      @if (i.contactName) { · {{ i.contactName }} }
                    </p>
                    <span class="text-[11px] text-ink-faint">{{ i.author.fullName }}</span>
                  </div>
                  <p class="mt-1 text-[13px] text-ink-soft">{{ i.summary }}</p>
                  <p class="mt-1 flex items-center gap-2 text-[11px]"
                     [class]="!i.nextActionDone && enRetard(i.nextActionDue) ? 'text-crit' : 'text-ink-faint'">
                    Prochaine action : {{ i.nextAction }} · {{ jour(i.nextActionDue) }}
                    @if (i.nextActionDone) {
                      <erp-icon name="check-circle" [size]="12" class="text-ok" />
                      faite
                    } @else {
                      <button class="link" (click)="cloreAction(i)" [disabled]="closingId() === i.id">
                        Marquer faite
                      </button>
                    }
                  </p>
                </div>
              } @empty {
                <p class="px-4 py-6 text-center text-[12px] text-ink-faint">Aucun échange journalisé.</p>
              }
            </div>
          </section>

          <!-- ============ Historique des étapes ============ -->
          <section class="card overflow-hidden">
            <div class="card-header"><h2 class="card-title">Parcours dans le pipeline</h2></div>
            <div class="divide-y divide-rule">
              @for (t of o.transitions; track t.id) {
                <div class="px-4 py-2.5 text-[12px]">
                  <span class="text-ink">
                    {{ t.fromStage ? t.fromStage.label : 'Création' }} → {{ t.toStage.label }}
                  </span>
                  <span class="ml-2 text-ink-faint">{{ jour(t.occurredAt) }}</span>
                  @if (t.note) {
                    <p class="mt-0.5 text-ink-soft">{{ t.note }}</p>
                  }
                </div>
              } @empty {
                <p class="px-4 py-6 text-center text-[12px] text-ink-faint">Aucun passage enregistré.</p>
              }
            </div>
          </section>
        </div>
      </div>
    }
  `,
})
export class OpportunityDetailComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  protected readonly opp = signal<Opportunity | null>(null);
  protected readonly stages = signal<Stage[]>([]);
  protected readonly kinds = Object.entries(KIND_LABELS).map(([code, label]) => ({ code, label }));

  protected readonly state = new ActionState();
  protected readonly stateInteraction = new ActionState();
  protected readonly stateDeal = new ActionState();
  protected readonly closingId = signal<string | null>(null);

  protected dealSearch = '';
  protected readonly dealResults = signal<{ id: string; reference: string; client: { legalName: string } }[]>([]);
  protected readonly dealSearched = signal(false);

  protected stageId = '';
  protected lossReason = '';
  protected moveNextAction = '';
  protected moveNextActionDue = '';
  protected moveNote = '';

  protected kind = 'CALL';
  protected occurredAt = new Date().toISOString().slice(0, 10);
  protected summary = '';
  protected contactName = '';
  protected interactionNextAction = '';
  protected interactionNextActionDue = '';

  protected readonly cibleEstPerte = computed(
    () => this.stages().find((s) => s.id === this.stageId)?.outcome === 'LOST',
  );

  ngOnInit(): void {
    this.api.crmStages().subscribe((rows) => this.stages.set(rows as unknown as Stage[]));
    this.charger();
  }

  private charger(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.api.crmOpportunite(id).subscribe((o) => {
      const opp = o as unknown as Opportunity;
      this.opp.set(opp);
      this.stageId = opp.stage.id;
    });
  }

  protected onStageChange(): void {
    if (!this.cibleEstPerte()) this.lossReason = '';
  }

  protected actionEnRetard(o: Opportunity): boolean {
    return !o.closedAt && this.enRetard(o.nextActionDue);
  }

  protected enRetard(date: string): boolean {
    return new Date(date) < new Date(new Date().toDateString());
  }

  protected kindLabel(k: string): string {
    return KIND_LABELS[k] ?? k;
  }

  protected jour(d: string): string {
    return d.slice(0, 10);
  }

  protected money(v: number): string {
    return grouper(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected changerEtape(): void {
    const o = this.opp();
    if (!o || this.state.busy()) return;
    if (this.cibleEstPerte() && !this.lossReason.trim()) return;
    this.state.start();

    this.api
      .crmChangerEtape(o.id, {
        stageId: this.stageId,
        note: this.moveNote.trim() || undefined,
        lossReason: this.cibleEstPerte() ? this.lossReason.trim() : undefined,
        nextAction: this.moveNextAction.trim() || undefined,
        nextActionDue: this.moveNextActionDue || undefined,
      })
      .subscribe({
        next: () => {
          this.state.succeed('Étape mise à jour.');
          this.moveNote = '';
          this.charger();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }

  protected rechercherAffaires(): void {
    const terme = this.dealSearch.trim();
    if (!terme || this.stateDeal.busy()) return;
    this.stateDeal.start();
    this.api.deals(1, { search: terme }).subscribe({
      next: (page) => {
        this.dealResults.set(page.items);
        this.dealSearched.set(true);
        this.stateDeal.busy.set(false);
      },
      error: (e: HttpFailure) => this.stateDeal.fail(e),
    });
  }

  protected lierAffaire(dealId: string): void {
    const o = this.opp();
    if (!o || this.stateDeal.busy()) return;
    this.stateDeal.start();
    this.api.crmLierAffaire(o.id, dealId).subscribe({
      next: () => {
        this.stateDeal.succeed('Affaire reliée.');
        this.dealResults.set([]);
        this.dealSearched.set(false);
        this.dealSearch = '';
        this.charger();
      },
      error: (e: HttpFailure) => this.stateDeal.fail(e),
    });
  }

  protected retirerAffaire(): void {
    const o = this.opp();
    if (!o || this.stateDeal.busy()) return;
    this.stateDeal.start();
    this.api.crmLierAffaire(o.id, null).subscribe({
      next: () => {
        this.stateDeal.succeed('Lien retiré.');
        this.charger();
      },
      error: (e: HttpFailure) => this.stateDeal.fail(e),
    });
  }

  protected peutJournaliser(): boolean {
    return !!(
      this.summary.trim().length >= 3 &&
      this.interactionNextAction.trim().length >= 3 &&
      this.interactionNextActionDue
    );
  }

  protected journaliser(): void {
    const o = this.opp();
    if (!o || this.stateInteraction.busy() || !this.peutJournaliser()) return;
    this.stateInteraction.start();

    this.api
      .crmJournaliser(o.id, {
        kind: this.kind,
        occurredAt: this.occurredAt,
        summary: this.summary.trim(),
        contactName: this.contactName.trim() || undefined,
        nextAction: this.interactionNextAction.trim(),
        nextActionDue: this.interactionNextActionDue,
      })
      .subscribe({
        next: () => {
          this.stateInteraction.succeed('Échange journalisé.');
          this.summary = '';
          this.contactName = '';
          this.interactionNextAction = '';
          this.interactionNextActionDue = '';
          this.charger();
        },
        error: (e: HttpFailure) => this.stateInteraction.fail(e),
      });
  }

  protected cloreAction(i: Interaction): void {
    if (this.closingId()) return;
    this.closingId.set(i.id);
    this.api.crmCloreAction(i.id, true).subscribe({
      next: () => {
        this.closingId.set(null);
        this.charger();
      },
      error: () => this.closingId.set(null),
    });
  }
}
