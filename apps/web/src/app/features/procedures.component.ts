import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, OperationalProcedureRow } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ActionFeedbackComponent, ActionState, HttpFailure } from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';
import { dateOnly } from '../shared/format';

/**
 * Procédures opérationnelles, par type d'opération (§ discussion 20/08).
 *
 * ⚠️ CET ÉCRAN N'EXISTAIT PAS — AUCUN MODE OPÉRATOIRE N'ÉTAIT ÉCRIT NULLE
 *    PART.
 *
 *    Un agent découvrait le déroulé d'un chargement, d'un soutage ou d'un
 *    transfert par pipeline en le vivant, jamais en le lisant avant.
 *
 * Éditée par l'Assistante de Direction, lue par tous : ce n'est pas une
 * donnée sensible, c'est un mode opératoire que l'entreprise entière doit
 * pouvoir consulter avant d'exécuter.
 */
@Component({
  selector: 'erp-procedures',
  standalone: true,
  imports: [FormsModule, IconComponent, ActionFeedbackComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Procédures opérationnelles</h1>
      <p class="page-sub">
        Un mode opératoire par type d'opération, consultable par tous, édité par l'Assistante
        de Direction.
      </p>
    </header>

    <erp-action-feedback [error]="state.error()" [success]="state.done()" />

    @if (chargement()) {
      <p class="text-[13px] text-ink-muted">Lecture…</p>
    } @else {
      <div class="space-y-3">
        @for (t of types(); track t.id) {
          <section class="card overflow-hidden">
            <div class="card-header cursor-pointer" (click)="basculer(t.id)">
              <div>
                <h2 class="card-title">{{ t.label }}</h2>
                <span class="font-mono text-[11px] text-ink-faint">{{ t.code }}</span>
              </div>
              <div class="flex items-center gap-3">
                @if (t.procedure) {
                  <span class="text-[11px] text-ink-faint">
                    à jour le {{ dateOnly(t.procedure.updatedAt) }}
                    @if (t.procedure.updatedBy) { · {{ t.procedure.updatedBy.fullName }} }
                  </span>
                } @else {
                  <span class="text-[11px] italic text-ink-faint">Aucune procédure écrite</span>
                }
                <erp-icon name="chevron-right" [size]="14" [class]="ouvert() === t.id ? 'rotate-90' : ''" />
              </div>
            </div>

            @if (ouvert() === t.id) {
              <div class="card-body">
                @if (t.description) {
                  <p class="mb-3 text-[12px] italic text-ink-faint">{{ t.description }}</p>
                }

                @if (peutEditer()) {
                  <textarea
                    class="field"
                    rows="10"
                    placeholder="Déroulé, points de vigilance, contacts : ce qu'un agent doit savoir avant d'exécuter ce type d'opération."
                    [ngModel]="brouillon(t.id)"
                    (ngModelChange)="majBrouillon(t.id, $event)"
                  ></textarea>
                  <div class="mt-2 flex gap-2">
                    <button
                      class="btn-primary"
                      [disabled]="state.busy() || brouillon(t.id).trim().length === 0"
                      (click)="enregistrer(t)"
                    >
                      {{ state.busy() ? 'Enregistrement…' : 'Enregistrer' }}
                    </button>
                    @if (t.procedure) {
                      <button class="btn-ghost" (click)="annuler(t)">Annuler</button>
                    }
                  </div>
                } @else if (t.procedure) {
                  <p class="whitespace-pre-line text-[14px] leading-relaxed text-ink">{{ t.procedure.content }}</p>
                } @else {
                  <p class="text-[13px] text-ink-faint">
                    Aucune procédure écrite pour ce type. L'Assistante de Direction peut la rédiger
                    depuis cet écran.
                  </p>
                }
              </div>
            }
          </section>
        } @empty {
          <p class="empty">Aucun type d'opération actif.</p>
        }
      </div>
    }
  `,
})
export class ProceduresComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  protected readonly state = new ActionState();
  protected readonly chargement = signal(true);
  protected readonly types = signal<OperationalProcedureRow[]>([]);
  protected readonly ouvert = signal<string | null>(null);

  private readonly brouillons = signal<Record<string, string>>({});

  ngOnInit(): void {
    this.reload();
  }

  private reload(): void {
    this.chargement.set(true);
    this.api.operationalProcedures().subscribe({
      next: (rows) => {
        this.types.set(rows);
        this.chargement.set(false);
      },
      error: () => this.chargement.set(false),
    });
  }

  protected peutEditer(): boolean {
    return this.auth.role() === 'ASSISTANT_DG';
  }

  protected basculer(id: string): void {
    this.ouvert.set(this.ouvert() === id ? null : id);
  }

  protected brouillon(operationTypeId: string): string {
    const existant = this.brouillons()[operationTypeId];
    if (existant !== undefined) return existant;
    return this.types().find((t) => t.id === operationTypeId)?.procedure?.content ?? '';
  }

  protected majBrouillon(operationTypeId: string, valeur: string): void {
    this.brouillons.update((etat) => ({ ...etat, [operationTypeId]: valeur }));
  }

  protected annuler(t: OperationalProcedureRow): void {
    this.brouillons.update((etat) => {
      const copie = { ...etat };
      delete copie[t.id];
      return copie;
    });
  }

  protected enregistrer(t: OperationalProcedureRow): void {
    if (this.state.busy()) return;
    const contenu = this.brouillon(t.id).trim();
    if (!contenu) return;
    this.state.start();
    this.api.setOperationalProcedure(t.id, contenu).subscribe({
      next: () => {
        this.state.succeed('Procédure enregistrée.');
        this.annuler(t);
        this.reload();
      },
      error: (e: HttpFailure) => this.state.fail(e),
    });
  }

  protected readonly dateOnly = dateOnly;
}
