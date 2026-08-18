import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, AttachmentRow, OperationRow } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import {
  ActionFeedbackComponent,
  ActionState,
  HttpFailure,
} from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';

interface HseCheckRow {
  id: string;
  phase: string;
  validatedAt: string | null;
  validatedByFieldUser: { fullName: string } | null;
  validatedByUser: { fullName: string } | null;
  template: { code: string; label: string };
  items: {
    id: string;
    level: string;
    outcome: string;
    comment: string | null;
    recordedValue: string | null;
    item: { label: string };
  }[];
}

const OUTCOME_LABEL: Record<string, string> = {
  PENDING: 'En attente',
  PASSED: 'Conforme',
  FAILED: 'Non conforme',
  NOT_APPLICABLE: 'Non applicable',
};

/**
 * Suivi HSE côté interne (§ 7, § 3.4).
 *
 * Les checklists se renseignent et se valident sur la TABLETTE, par l'agent et
 * le contrôleur HSE. Cet écran sert deux besoins qui ne relèvent pas du
 * terrain : la SUPPLÉANCE du contrôleur par le DG lorsqu'il est absent, et la
 * déclaration d'un événement par quelqu'un du bureau.
 *
 * La séparation des tâches reste entière : celui qui a renseigné un contrôle
 * bloquant ne peut pas le valider, et la base le refuse quel que soit le
 * chemin emprunté.
 */
@Component({
  selector: 'erp-hse',
  standalone: true,
  imports: [FormsModule, IconComponent, ActionFeedbackComponent],
  template: `
    <header class="mb-5">
      <h1 class="page-title">Contrôles HSE</h1>
      <p class="page-sub">Suppléance du contrôleur et déclaration d’événements</p>
    </header>

    <erp-action-feedback [error]="state.error()" [success]="state.done()" />

    <!-- ============ Déclarer un événement ============ -->
    <section class="card mb-5">
      <div class="card-header"><h2 class="card-title">Déclarer un événement</h2></div>
      <div class="card-body">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label class="label" for="type-ev">Nature</label>
            <select id="type-ev" class="field" [(ngModel)]="type">
              <option value="INCIDENT">Incident</option>
              <option value="ACCIDENT">Accident</option>
              <option value="SPILL">Déversement</option>
              <option value="NEAR_MISS">Quasi-accident</option>
              <option value="DANGEROUS_OBSERVATION">Observation dangereuse</option>
              <option value="NON_CONFORMITY">Non-conformité</option>
            </select>
          </div>
          <div>
            <label class="label" for="grav">Gravité</label>
            <select id="grav" class="field" [(ngModel)]="severity">
              <option value="MINOR">Mineure</option>
              <option value="MODERATE">Modérée</option>
              <option value="MAJOR">Majeure</option>
              <option value="CRITICAL">Critique</option>
            </select>
          </div>
          <div>
            <label class="label" for="quand">Survenu le</label>
            <input id="quand" type="datetime-local" class="field" [(ngModel)]="occurredAt" />
          </div>
          <div>
            <label class="label" for="ou">Lieu</label>
            <input id="ou" class="field" [(ngModel)]="location" />
          </div>
          <div class="md:col-span-2">
            <label class="label" for="titre">Intitulé</label>
            <input id="titre" class="field" [(ngModel)]="title" />
          </div>
          <div class="md:col-span-2">
            <label class="label" for="op-ev">Opération concernée</label>
            <select id="op-ev" class="field" [(ngModel)]="operationId">
              <option [ngValue]="''">Aucune</option>
              @for (o of operations(); track o.id) {
                <option [ngValue]="o.id">{{ o.reference }} · {{ o.deal.client.legalName }}</option>
              }
            </select>
          </div>
          <div class="md:col-span-4">
            <label class="label" for="desc">Description</label>
            <textarea id="desc" class="field" rows="3" [(ngModel)]="description"></textarea>
          </div>
        </div>
        <p class="mt-2 text-[11px] leading-relaxed text-ink-faint">
          Signaler ne demande aucune habilitation, seul le traitement en demande. Un écart de
          volume au-delà du seuil critique en ouvre un d’office : le produit est allé quelque
          part.
        </p>
        <button class="btn-primary mt-3" (click)="declare()" [disabled]="state.busy()">
          Déclarer
        </button>
      </div>
    </section>

    <!-- ============ Suppléance du contrôleur ============ -->
    <section class="card">
      <div class="card-header">
        <h2 class="card-title">Checklists en attente de validation</h2>
        <span class="text-[11px] text-ink-faint">suppléance réservée au DG</span>
      </div>

      @if (pending().length === 0) {
        <p class="empty">Aucune checklist en attente.</p>
      } @else {
        <div class="overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>Opération</th>
                <th>Phase</th>
                <th>Modèle</th>
                <th class="num">Points bloquants</th>
                <th style="width: 160px"></th>
              </tr>
            </thead>
            <tbody>
              @for (c of pending(); track c.check.id) {
                <tr>
                  <td><span class="ref">{{ c.operation }}</span></td>
                  <td class="text-ink-soft">{{ c.check.phase }}</td>
                  <td class="text-ink-soft">{{ c.check.template.label }}</td>
                  <td class="num font-mono" [class]="c.blocking > 0 ? 'text-crit' : 'text-ok'">
                    {{ c.blocking }}
                  </td>
                  <td class="whitespace-nowrap">
                    <button
                      type="button"
                      class="btn-ghost mr-1.5"
                      (click)="basculer(c)"
                    >
                      {{ estOuvert(c.check.id) ? 'Masquer' : 'Voir sur pièces' }}
                    </button>
                    @if (isDg()) {
                      <button
                        class="btn-ghost"
                        (click)="validateAsDg(c.check.id)"
                        [disabled]="state.busy()"
                      >
                        Valider en suppléance
                      </button>
                    } @else {
                      <span class="text-[11px] text-ink-faint">DG seul</span>
                    }
                  </td>
                </tr>
                @if (estOuvert(c.check.id)) {
                  <tr>
                    <td colspan="5" class="bg-gray-50 px-4 py-3">
                      <!-- ⚠️ CORRIGÉ — LA VALIDATION À DISTANCE SE FAISAIT SANS
                           JAMAIS VOIR LA PHOTO QU'ELLE ATTESTE. Le contrôleur
                           (ou le DG en suppléance) ne disposait que du
                           décompte des points bloquants — jamais de la pièce
                           qui prouve, ou pas, qu'un point est réellement
                           conforme. -->
                      <div class="space-y-2">
                        @for (i of c.check.items; track i.id) {
                          <div class="rounded-[3px] border border-rule-strong bg-surface px-3 py-2">
                            <div class="flex flex-wrap items-baseline gap-2">
                              <span class="text-[12px] font-medium text-ink">{{ i.item.label }}</span>
                              <span class="text-[10px] uppercase tracking-wide text-ink-faint">{{ i.level }}</span>
                              <span
                                class="text-[11px] font-semibold"
                                [class]="i.outcome === 'PASSED' ? 'text-ok' : i.outcome === 'FAILED' ? 'text-crit' : 'text-ink-muted'"
                              >
                                {{ outcomeLabel(i.outcome) }}
                              </span>
                              @if (i.recordedValue) {
                                <span class="text-[11px] text-ink-soft">· {{ i.recordedValue }}</span>
                              }
                            </div>
                            @if (i.comment) {
                              <p class="mt-1 text-[11px] italic text-ink-muted">{{ i.comment }}</p>
                            }

                            @if (photosDe(c, i.id); as photos) {
                              @if (photos.length > 0) {
                                <div class="mt-2 flex flex-wrap gap-2">
                                  @for (p of photos; track p.id) {
                                    <button
                                      type="button"
                                      class="block h-16 w-16 overflow-hidden rounded-[3px] border border-rule-strong"
                                      (click)="agrandir(p.id)"
                                      title="Ouvrir en plein écran"
                                    >
                                      @if (urlDe(p.id); as url) {
                                        <img [src]="url" class="h-full w-full object-cover" alt="" />
                                      } @else {
                                        <span class="flex h-full w-full items-center justify-center text-[9px] text-ink-faint">
                                          …
                                        </span>
                                      }
                                    </button>
                                  }
                                </div>
                              } @else {
                                <p class="mt-1 text-[11px] text-ink-faint">Aucune photo jointe à ce point.</p>
                              }
                            }
                          </div>
                        }
                      </div>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      }

      <p class="border-t border-rule px-[15px] py-2.5 text-[11px] leading-relaxed text-ink-faint">
        L’entreprise ne compte qu’un contrôleur HSE. En son absence, le DG valide à sa place, et
        la suppléance est tracée comme telle. La séparation des tâches reste appliquée
        automatiquement : celui qui a renseigné un contrôle bloquant ne peut pas le valider.
      </p>
    </section>
  `,
})
export class HseComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  protected readonly state = new ActionState();
  protected readonly operations = signal<OperationRow[]>([]);
  protected readonly pending = signal<
    { operation: string; operationId: string; check: HseCheckRow; blocking: number }[]
  >([]);

  /** Checklists dépliées pour consultation des pièces (§ 7.2). */
  private readonly ouverts = new Set<string>();
  /** Pièces jointes déjà chargées, par OPÉRATION — une requête par opération, pas par point. */
  private readonly attachmentsParOperation = new Map<string, AttachmentRow[]>();
  /** Objets-URL des images déjà téléchargées — un flux binaire n'a pas de sens à redemander. */
  private readonly urls = new Map<string, string>();
  protected readonly outcomeLabel = (o: string) => OUTCOME_LABEL[o] ?? o;

  protected type = 'INCIDENT';
  protected severity = 'MINOR';
  protected title = '';
  protected description = '';
  protected location = '';
  protected operationId = '';
  protected occurredAt = new Date().toISOString().slice(0, 16);

  ngOnInit(): void {
    this.api.operations(1, {}).subscribe((p) => {
      this.operations.set(p.items);
      this.loadChecks(p.items);
    });
  }

  protected isDg(): boolean {
    return this.auth.role() === 'DG';
  }

  private loadChecks(ops: OperationRow[]): void {
    const rows: { operation: string; operationId: string; check: HseCheckRow; blocking: number }[] =
      [];
    let remaining = ops.length;
    if (remaining === 0) return;

    for (const o of ops) {
      this.api.hseChecks(o.id).subscribe({
        next: (checks) => {
          for (const c of checks as HseCheckRow[]) {
            if (c.validatedAt) continue;
            rows.push({
              operation: o.reference,
              operationId: o.id,
              check: c,
              blocking: c.items.filter((i) => i.level === 'BLOCKING' && i.outcome !== 'PASSED')
                .length,
            });
          }
          if (--remaining === 0) this.pending.set(rows);
        },
        error: () => {
          if (--remaining === 0) this.pending.set(rows);
        },
      });
    }
  }

  // --- Consultation des pièces (§ 7.2) --------------------------------------

  protected estOuvert(checkId: string): boolean {
    return this.ouverts.has(checkId);
  }

  protected basculer(row: { operationId: string; check: HseCheckRow }): void {
    if (this.ouverts.has(row.check.id)) {
      this.ouverts.delete(row.check.id);
      return;
    }
    this.ouverts.add(row.check.id);
    if (!this.attachmentsParOperation.has(row.operationId)) {
      this.api.attachmentsForOperation(row.operationId).subscribe((liste) => {
        this.attachmentsParOperation.set(row.operationId, liste);
        // Les vignettes se chargent tout de suite : c'est la preuve qu'on est
        // venu voir, pas un lien de plus à cliquer avant de la trouver.
        //
        // ⚠️ `kind`, PAS SEULEMENT LE TYPE MIME. Une capture de signature est
        //    aussi souvent un image/png qu'une vraie photo — les mélanger
        //    montrerait la signature du client comme preuve du briefing
        //    sécurité, exactement l'amalgame que `AttachmentKind` existe pour
        //    empêcher (§ commentaire du modèle Prisma).
        for (const a of liste) {
          if (a.kind === 'PHOTO' && a.mimeType.startsWith('image/')) this.chargerImage(a.id);
        }
      });
    }
  }

  /** Photos (pas les signatures ni les documents) rattachées à CE point. */
  protected photosDe(
    row: { operationId: string },
    checkItemId: string,
  ): AttachmentRow[] {
    const liste = this.attachmentsParOperation.get(row.operationId);
    if (!liste) return [];
    return liste.filter(
      (a) => a.checkItem?.id === checkItemId && a.kind === 'PHOTO' && a.mimeType.startsWith('image/'),
    );
  }

  protected urlDe(attachmentId: string): string | null {
    return this.urls.get(attachmentId) ?? null;
  }

  private chargerImage(id: string): void {
    if (this.urls.has(id)) return;
    this.api.attachmentBlob(id).subscribe((blob) => {
      this.urls.set(id, URL.createObjectURL(blob));
    });
  }

  /** Plein écran : l'image est déjà en mémoire, un nouvel onglet suffit. */
  protected agrandir(attachmentId: string): void {
    const url = this.urls.get(attachmentId);
    if (url) window.open(url, '_blank');
  }

  protected validateAsDg(checkId: string): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api.validateHseCheckAsDg(checkId).subscribe({
      next: () => {
        this.state.succeed('Checklist validée en suppléance du contrôleur HSE.');
        this.ngOnInit();
      },
      error: (e: HttpFailure) => this.state.fail(e),
    });
  }

  protected declare(): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api
      .openHseEvent({
        type: this.type,
        severity: this.severity,
        title: this.title,
        description: this.description,
        occurredAt: new Date(this.occurredAt).toISOString(),
        location: this.location || undefined,
        operationId: this.operationId || undefined,
      })
      .subscribe({
        next: () => {
          this.state.succeed('Événement déclaré.');
          this.title = '';
          this.description = '';
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }
}
