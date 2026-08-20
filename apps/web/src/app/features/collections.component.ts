import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AgedReceivableLine,
  AgedReceivables,
  ApiService,
  DunningActionRow,
  VocabItem,
} from '../core/api.service';
import { ActionFeedbackComponent, ActionState, HttpFailure } from '../shared/action-panel.component';
import { grouper } from '../shared/format';
import { TableauControlesComponent, TableauPagine } from '../shared/tableau';

const BUCKET_LABEL: Record<string, string> = {
  A_VENIR: 'À venir',
  J1_30: '1-30 j',
  J31_60: '31-60 j',
  J61_90: '61-90 j',
  J90_PLUS: '90 j +',
  SANS_ECHEANCE: 'Sans échéance',
};

/**
 * RECOUVREMENT (§ 3.3, § 14.6, § 16).
 *
 * SPECIFICATIONS.md ne décrit aucun palier d'escalade ni canal automatisé —
 * cet écran trace une action humaine, il n'en invente pas la politique.
 */
@Component({
  selector: 'erp-collections',
  standalone: true,
  imports: [FormsModule, ActionFeedbackComponent, TableauControlesComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Recouvrement</h1>
      <p class="page-sub">
        Balance âgée des créances ouvertes, en francs CFA. Les proforma et les avoirs n'y figurent
        pas : ils ne créent ou n'annulent aucune créance.
      </p>
    </header>

    @if (chargement()) {
      <p class="text-[13px] text-ink-muted">Lecture…</p>
    } @else if (donnees()) {
      @let d = donnees()!;
      <!-- ============ Synthèse par client ============ -->
      <div class="card mb-5 overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>Client</th>
              <th class="num">À venir</th>
              <th class="num">1-30 j</th>
              <th class="num">31-60 j</th>
              <th class="num">61-90 j</th>
              <th class="num">90 j +</th>
              <th class="num">Total (XOF)</th>
            </tr>
          </thead>
          <tbody>
            @for (p of d.byPartner; track p.partner.id) {
              <tr>
                <td class="font-medium text-ink">{{ p.partner.legalName }}</td>
                <td class="num font-mono text-ink-soft">{{ montant(p.buckets.A_VENIR) }}</td>
                <td class="num font-mono text-ink-soft">{{ montant(p.buckets.J1_30) }}</td>
                <td class="num font-mono" [class]="p.buckets.J31_60 > 0 ? 'text-warn-ink' : 'text-ink-soft'">{{ montant(p.buckets.J31_60) }}</td>
                <td class="num font-mono" [class]="p.buckets.J61_90 > 0 ? 'text-crit' : 'text-ink-soft'">{{ montant(p.buckets.J61_90) }}</td>
                <td class="num font-mono" [class]="p.buckets.J90_PLUS > 0 ? 'text-crit font-semibold' : 'text-ink-soft'">{{ montant(p.buckets.J90_PLUS) }}</td>
                <td class="num font-mono font-semibold text-ink">{{ montant(p.total) }}</td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="empty">Aucune créance ouverte.</td></tr>
            }
          </tbody>
        </table>
      </div>

      <!-- ============ Détail par pièce ============ -->
      <div class="card overflow-x-auto">
        <erp-tableau-controles [tableau]="tableauLignes" libelle="les pièces" />
        <table class="table">
          <thead>
            <tr>
              <th>Pièce</th>
              <th>Client</th>
              <th>Échéance</th>
              <th class="num">Jours de retard</th>
              <th>Tranche</th>
              <th class="num">Solde dû</th>
              <th class="num">Relances</th>
            </tr>
          </thead>
          <tbody>
            @for (l of tableauLignes.lignes(); track l.invoiceId) {
              <tr class="cursor-pointer hover:bg-gray-50" (click)="select(l)">
                <td class="font-mono font-medium text-ink">{{ l.number }}</td>
                <td class="text-ink-soft">{{ l.partner.legalName }}</td>
                <td class="font-mono text-[12px] text-ink-soft">{{ l.dueDate?.slice(0, 10) ?? '-' }}</td>
                <td class="num font-mono" [class]="(l.daysOverdue ?? 0) > 0 ? 'text-warn-ink' : 'text-ink-soft'">
                  {{ l.daysOverdue !== null ? l.daysOverdue : '-' }}
                </td>
                <td class="text-[11px] text-ink-muted">{{ bucketLabel(l.bucket) }}</td>
                <td class="num font-mono font-semibold text-ink">{{ money(l.outstanding) }} {{ l.currencyCode }}</td>
                <td class="num font-mono text-ink-soft">{{ l.dunningCount }}</td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="empty">Aucune créance ouverte.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }

    @if (selectedLine(); as l) {
      <section class="card mt-5 overflow-hidden">
        <div class="card-header">
          <h2 class="card-title">Relances · {{ l.number }}</h2>
          <span class="text-[11px] text-ink-faint">{{ l.partner.legalName }}</span>
        </div>
        <div class="card-body">
          <erp-action-feedback [error]="state.error()" [success]="state.done()" />

          <div class="flex flex-wrap items-end gap-3">
            <div>
              <label class="label" for="dmethod">Moyen</label>
              <select id="dmethod" class="field" [(ngModel)]="dMethod">
                @for (m of methods(); track m.code) {
                  <option [value]="m.code">{{ m.label }}</option>
                }
              </select>
            </div>
            <div>
              <label class="label" for="ddate">Date du contact</label>
              <input id="ddate" type="date" class="field" [(ngModel)]="dContactedAt" />
            </div>
            <div class="min-w-[240px] flex-1">
              <label class="label" for="dnotes">Compte rendu</label>
              <input id="dnotes" class="field" [(ngModel)]="dNotes" placeholder="Ce qui a été dit, convenu…" />
            </div>
            <button class="btn-primary" (click)="enregistrerRelance()" [disabled]="state.busy()">
              Enregistrer
            </button>
          </div>

          <div class="mt-5 border-t border-rule pt-4">
            @if (historique().length === 0) {
              <p class="text-[12px] text-ink-faint">Aucune relance enregistrée sur cette pièce.</p>
            } @else {
              <ul class="flex flex-col gap-2">
                @for (h of historique(); track h.id) {
                  <li class="text-[13px] text-ink-soft">
                    <span class="font-mono text-[11px] text-ink-faint">{{ h.contactedAt.slice(0, 10) }}</span>
                    · <span class="font-medium text-ink">{{ methodLabel(h.method) }}</span>
                    @if (h.recordedBy) { · {{ h.recordedBy.fullName }} }
                    · {{ h.notes }}
                  </li>
                }
              </ul>
            }
          </div>
        </div>
      </section>
    }
  `,
})
export class CollectionsComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly state = new ActionState();
  protected readonly chargement = signal(true);
  protected readonly donnees = signal<AgedReceivables | null>(null);
  protected readonly tableauLignes = new TableauPagine<AgedReceivableLine>();
  protected readonly selectedLine = signal<AgedReceivableLine | null>(null);
  protected readonly historique = signal<DunningActionRow[]>([]);
  protected readonly methods = signal<VocabItem[]>([]);

  protected dMethod = 'PHONE';
  protected dContactedAt = new Date().toISOString().slice(0, 10);
  protected dNotes = '';

  ngOnInit(): void {
    this.load();
    this.api.vocabulaires().subscribe((v) => this.methods.set(v.dunningMethod));
  }

  private load(): void {
    this.chargement.set(true);
    this.api.agedReceivables().subscribe((d) => {
      this.donnees.set(d);
      this.tableauLignes.définir(d.lines);
      this.chargement.set(false);
    });
  }

  protected select(l: AgedReceivableLine): void {
    if (this.selectedLine()?.invoiceId === l.invoiceId) {
      this.selectedLine.set(null);
      return;
    }
    this.selectedLine.set(l);
    this.api.dunningHistory(l.invoiceId).subscribe((h) => this.historique.set(h));
  }

  protected enregistrerRelance(): void {
    const l = this.selectedLine();
    if (!l || this.state.busy()) return;
    if (!this.dNotes.trim()) {
      this.state.error.set('Le compte rendu de la relance est requis.');
      return;
    }
    this.state.start();
    this.api
      .recordDunning(l.invoiceId, { method: this.dMethod, notes: this.dNotes, contactedAt: this.dContactedAt })
      .subscribe({
        next: () => {
          this.state.succeed('Relance enregistrée.');
          this.dNotes = '';
          this.api.dunningHistory(l.invoiceId).subscribe((h) => this.historique.set(h));
          this.load();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }

  protected bucketLabel(b: string): string {
    return BUCKET_LABEL[b] ?? b;
  }
  protected methodLabel(m: string): string {
    return this.methods().find((v) => v.code === m)?.label ?? m;
  }
  protected montant(v: number): string {
    return grouper(v, { maximumFractionDigits: 0 });
  }
  protected money(v: number): string {
    return grouper(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
