import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, FiscalYearRow } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ActionFeedbackComponent, ActionState, HttpFailure } from '../shared/action-panel.component';
import { dateOnly } from '../shared/format';
import { StatusBadgeComponent, StatusKind } from '../shared/status-badge.component';

const STATUS: Record<string, { label: string; kind: StatusKind }> = {
  PLANNED: { label: 'En préparation', kind: 'wait' },
  OPEN: { label: 'Ouvert', kind: 'ok' },
  CLOSED: { label: 'Clos', kind: 'neutral' },
};

interface Action {
  to: string;
  label: string;
  /** Un motif est exigé pour rouvrir un exercice clos — jamais pour les autres transitions. */
  reasonRequired: boolean;
  /** Rouvrir est réservé au DG (décision prise avec le Directeur Financier, ticket #7). */
  dgOnly: boolean;
}

const ACTIONS: Record<string, Action[]> = {
  PLANNED: [{ to: 'OPEN', label: 'Ouvrir', reasonRequired: false, dgOnly: false }],
  OPEN: [{ to: 'CLOSED', label: 'Clôturer', reasonRequired: false, dgOnly: false }],
  CLOSED: [{ to: 'OPEN', label: 'Rouvrir', reasonRequired: true, dgOnly: true }],
};

/**
 * Exercices fiscaux (ticket #7) — cycle de vie contrôlé : PLANNED → OPEN →
 * CLOSED, réouverture réservée au DG avec motif tracé. Remplace la saisie
 * libre du statut qu'offrait l'écran générique de paramétrage.
 */
@Component({
  selector: 'erp-fiscal-years',
  standalone: true,
  imports: [FormsModule, StatusBadgeComponent, ActionFeedbackComponent],
  template: `
    <header class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="page-title">Exercices fiscaux</h1>
        <p class="page-sub">
          Clôture possible après la date de fin, dans l'ordre chronologique. Réouverture réservée
          au DG, avec un motif tracé.
        </p>
      </div>
      @if (peutTransitionner()) {
        <button class="btn-primary shrink-0" (click)="showCreate.set(!showCreate())">
          {{ showCreate() ? 'Fermer' : 'Nouvel exercice' }}
        </button>
      }
    </header>

    <erp-action-feedback [error]="state.error()" [success]="state.done()" />

    @if (showCreate()) {
      <section class="card mb-5">
        <div class="card-header">
          <h2 class="card-title">Créer un exercice fiscal</h2>
        </div>
        <div class="card-body">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <label class="label" for="year-c">Millésime</label>
              <input id="year-c" type="number" class="field font-mono" [(ngModel)]="newYear" />
            </div>
            <div>
              <label class="label" for="label-c">Libellé</label>
              <input id="label-c" class="field" [(ngModel)]="newLabel" />
            </div>
            <div>
              <label class="label" for="starts-c">Début</label>
              <input id="starts-c" type="date" class="field" [(ngModel)]="newStartsOn" />
            </div>
            <div>
              <label class="label" for="ends-c">Fin</label>
              <input id="ends-c" type="date" class="field" [(ngModel)]="newEndsOn" />
            </div>
          </div>
          <p class="mt-2 text-[11px] leading-relaxed text-ink-faint">
            Créé EN PRÉPARATION : ses valeurs budgétaires ne s'appliquent qu'une fois ouvert.
          </p>
          <button class="btn-primary mt-3" (click)="creer()" [disabled]="state.busy()">
            Créer
          </button>
        </div>
      </section>
    }

    @if (confirming(); as c) {
      <section class="card mb-5 border-warn/40">
        <div class="card-header">
          <h2 class="card-title">
            {{ c.action.label }} l'exercice {{ c.row.year }} ({{ c.row.label }})
          </h2>
        </div>
        <div class="card-body">
          @if (c.action.reasonRequired) {
            <p class="mb-3 text-[13px] text-ink-soft">
              Rouvrir un exercice clos n'est jamais un effet de bord d'une saisie : le motif est
              exigé et reste au journal d'audit.
            </p>
            <div class="mb-3">
              <label class="label" for="motif-ex">Motif</label>
              <input id="motif-ex" class="field" [(ngModel)]="reason" />
            </div>
          }
          <div class="flex gap-3">
            <button class="btn-primary" (click)="confirmer()" [disabled]="state.busy()">
              Confirmer
            </button>
            <button class="btn-ghost" (click)="annuler()">Annuler</button>
          </div>
        </div>
      </section>
    }

    <div class="card overflow-x-auto">
      <table class="table">
        <thead>
          <tr>
            <th>Millésime</th>
            <th>Libellé</th>
            <th>Début</th>
            <th>Fin</th>
            <th>Courant</th>
            <th>État</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (fy of rows(); track fy.id) {
            <tr>
              <td class="font-mono font-semibold text-ink">{{ fy.year }}</td>
              <td class="text-ink">{{ fy.label }}</td>
              <td class="text-[12px] text-ink-soft">{{ dateOnly(fy.startsOn) }}</td>
              <td class="text-[12px] text-ink-soft">{{ dateOnly(fy.endsOn) }}</td>
              <td class="text-[12px] text-ink-soft">{{ fy.isCurrent ? 'Oui' : '-' }}</td>
              <td>
                <erp-status-badge [kind]="status(fy.status).kind" [label]="status(fy.status).label" />
              </td>
              <td>
                <div class="flex flex-wrap gap-1.5">
                  @for (a of actions(fy); track a.to) {
                    <button type="button" class="link text-[11px]" (click)="demander(fy, a)">
                      {{ a.label }}
                    </button>
                  }
                </div>
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="7" class="empty">Aucun exercice fiscal enregistré.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class FiscalYearsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  protected readonly rows = signal<FiscalYearRow[]>([]);
  protected readonly state = new ActionState();
  protected readonly confirming = signal<{ row: FiscalYearRow; action: Action } | null>(null);
  protected reason = '';

  protected readonly showCreate = signal(false);
  protected newYear: number | null = null;
  protected newLabel = '';
  protected newStartsOn = '';
  protected newEndsOn = '';

  ngOnInit(): void {
    this.load();
  }

  protected status(code: string) {
    return STATUS[code] ?? { label: code, kind: 'neutral' as StatusKind };
  }

  protected dateOnly(iso: string): string {
    return dateOnly(iso);
  }

  /** Même autorité pour créer un exercice que pour le faire évoluer (DG, FINANCE_CFO). */
  protected peutTransitionner(): boolean {
    return this.auth.hasRole('DG', 'FINANCE_CFO');
  }

  /**
   * Filtre les actions dont le rôle courant n'a pas l'autorité — le serveur
   * reste seul juge en dernier ressort. Un CCOO/ACCOUNTANT peut consulter cet
   * écran (§ screen-registry.ts) sans jamais pouvoir transitionner : sans ce
   * premier filtre, ses boutons seraient toujours voués au 403.
   */
  protected actions(fy: FiscalYearRow): Action[] {
    if (!this.peutTransitionner()) return [];
    return (ACTIONS[fy.status] ?? []).filter((a) => !a.dgOnly || this.auth.hasRole('DG'));
  }

  protected creer(): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api
      .creerExerciceFiscal({
        year: Number(this.newYear ?? 0),
        label: this.newLabel,
        startsOn: this.newStartsOn,
        endsOn: this.newEndsOn,
      })
      .subscribe({
        next: () => {
          this.state.succeed('Exercice créé, en préparation.');
          this.newYear = null;
          this.newLabel = '';
          this.newStartsOn = '';
          this.newEndsOn = '';
          this.showCreate.set(false);
          this.load();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }

  protected demander(row: FiscalYearRow, action: Action): void {
    this.reason = '';
    this.confirming.set({ row, action });
  }

  protected annuler(): void {
    this.confirming.set(null);
  }

  protected confirmer(): void {
    const c = this.confirming();
    if (!c || this.state.busy()) return;
    this.state.start();
    this.api.transitionExerciceFiscal(c.row.id, c.action.to, this.reason || undefined).subscribe({
      next: () => {
        this.state.succeed(`Exercice ${c.row.year} : ${this.status(c.action.to).label.toLowerCase()}.`);
        this.confirming.set(null);
        this.load();
      },
      error: (e: HttpFailure) => this.state.fail(e),
    });
  }

  private load(): void {
    this.api.exercicesFiscaux().subscribe((rows) => this.rows.set(rows));
  }
}
