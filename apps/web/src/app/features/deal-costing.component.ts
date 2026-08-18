import { Component, Input, OnChanges, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  CostGuidance,
  DealCostLine,
  DealCostLineInput,
} from '../core/api.service';
import { IconComponent } from '../shared/icon.component';
import { grouper } from '../shared/format';

/** Une ligne en cours d'édition. */
interface Draft {
  costPostId: string;
  amount: number | null;
  description: string;
  varianceReason: string;
}

/**
 * Chiffrage des coûts d'une affaire (SPECIFICATIONS.md § 5.4).
 *
 * Le commercial SÉLECTIONNE un poste dans le référentiel — jamais un intitulé
 * libre, sans quoi le rapprochement avec les factures fournisseurs et
 * l'analyse par nature deviennent impossibles.
 *
 * LA VALEUR DU BARÈME LUI EST PROPOSÉE dès qu'il choisit le poste. Il la
 * conserve — geste par défaut — ou en saisit une autre, et doit alors la
 * justifier. Afficher la référence après coup n'oriente personne.
 *
 * LA BASE N'EST PAS UN CHOIX : elle vient du paramétrage. Un transport se
 * négocie au litre, une manutention à la rotation, et le barème l'a tranché
 * une fois pour toutes. La laisser libre permettrait de saisir 30 « en
 * forfait » sur un poste tarifé au litre : le total tomberait à 30 au lieu de
 * 900 000, sans qu'aucune règle ne soit violée.
 *
 * Le système fait le cumul et le ramène au litre : c'est ce total unitaire qui
 * entre dans la chaîne de marge.
 */
@Component({
  selector: 'erp-deal-costing',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <section class="card overflow-hidden">
      <div class="card-header">
        <h2 class="card-title">Chiffrage des coûts</h2>
        <span class="text-[11px] text-ink-faint">
          {{ volumeLabel() }} · {{ currency }}
        </span>
      </div>

      <div class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>Poste de coût</th>
              <th style="width: 150px">Base</th>
              <th class="num" style="width: 130px">Valeur saisie</th>
              <th class="num" style="width: 140px">Total affaire</th>
              <th class="num" style="width: 120px">Au litre</th>
              <th class="num" style="width: 130px">Barème</th>
              <th style="width: 40px"></th>
            </tr>
          </thead>
          <tbody>
            @for (l of drafts(); track $index) {
              <tr [class]="rowClass(l)">
                <td>
                  <select class="field" [(ngModel)]="l.costPostId" (ngModelChange)="onPostChange(l)" [disabled]="status !== 'DRAFT'">
                    <option [ngValue]="''">Choisir un poste</option>
                    @for (p of directPosts(); track p.costPostId) {
                      <option [ngValue]="p.costPostId">
                        {{ p.label }}{{ p.amount === null ? ' (non tarifé)' : '' }}
                      </option>
                    }
                  </select>
                </td>
                <td class="text-[12px] text-ink-soft">
                  <!-- La base n'est PAS un choix : elle vient du barème. La
                       laisser libre permettrait de saisir 30 « en forfait » sur
                       un poste tarifé au litre, et la marge deviendrait
                       fantaisiste sans qu'aucune règle ne soit violée. -->
                  {{ basisLabel(l) }}
                </td>
                <td>
                  <input
                    class="field text-right font-mono"
                    inputmode="decimal"
                    [(ngModel)]="l.amount"
                    (ngModelChange)="touch()"
                    [attr.aria-label]="'Valeur : ' + basisLabel(l)"
                    [disabled]="status !== 'DRAFT'"
                  />
                </td>
                <td class="num font-mono font-semibold text-ink">{{ money(total(l)) }}</td>
                <td class="num font-mono text-ink-soft">{{ money(perUnit(l)) }}</td>
                <td class="num font-mono text-[12px]" [class]="varianceClass(l)">
                  {{ standardLabel(l) }}
                  @if (isModified(l)) {
                    <button
                      type="button"
                      class="link ml-1.5 text-[11px]"
                      (click)="restore(l)"
                      title="Revenir à la valeur du barème"
                    >
                      rétablir
                    </button>
                  }
                </td>
                <td>
                  @if (status === 'DRAFT') {
                    <button
                      type="button"
                      class="text-ink-faint hover:text-crit"
                      aria-label="Retirer la ligne"
                      (click)="remove($index)"
                    >
                      <erp-icon name="ban" [size]="14" />
                    </button>
                  }
                </td>
              </tr>

              <!-- Le motif n'apparaît que s'il est exigé : un champ toujours
                   visible se remplit machinalement et ne veut plus rien dire. -->
              @if (needsReason(l)) {
                <tr>
                  <td colspan="7" class="bg-warn-wash">
                    <div class="flex items-center gap-2">
                      <erp-icon name="alert-triangle" [size]="13" class="shrink-0 text-warn-ink" />
                      <span class="shrink-0 text-[12px] text-warn-ink">
                        Valeur modifiée ({{ variancePct(l) }} d’écart), motif exigé :
                      </span>
                      <input
                        class="field"
                        [(ngModel)]="l.varianceReason"
                        (ngModelChange)="touch()"
                        placeholder="Pourquoi ce montant s’écarte-t-il du barème ?"
                        aria-label="Motif de l’écart au barème"
                      />
                    </div>
                  </td>
                </tr>
              }
            } @empty {
              <tr>
                <td colspan="7" class="empty">
                  Aucun coût chiffré. La marge affichée ignore alors transport, manutention et
                  inspection, elle est surévaluée d’autant. Ajoutez les postes qui concernent
                  cette affaire : les valeurs du barème vous seront proposées.
                </td>
              </tr>
            }
          </tbody>
          @if (drafts().length > 0) {
            <tfoot>
              <tr class="bg-gray-100">
                <td colspan="3" class="font-semibold text-ink">Cumul</td>
                <td class="num font-mono font-semibold text-ink">{{ money(grandTotal()) }}</td>
                <td class="num font-mono font-semibold text-ink">{{ money(grandPerUnit()) }}</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          }
        </table>
      </div>

      @if (status === 'DRAFT') {
        <div class="flex items-center gap-2 border-t border-rule px-[15px] py-3">
          <button class="btn-ghost" (click)="add()">
            <erp-icon name="plus" [size]="14" />
            Ajouter un poste
          </button>
          <button class="btn-primary ml-auto" (click)="save()" [disabled]="busy() || !dirty()">
            {{ busy() ? 'Enregistrement…' : 'Enregistrer le chiffrage' }}
          </button>
        </div>
      } @else {
        <p class="border-t border-rule px-[15px] py-3 text-[12px] text-ink-faint">
          Affaire soumise : le chiffrage ne se modifie plus depuis cet écran.
        </p>
      }

      @if (error()) {
        <p
          class="flex items-start gap-2 border-t border-rule bg-crit-wash px-[15px] py-2.5
                 text-[13px] text-crit"
          role="alert"
        >
          <erp-icon name="alert-triangle" [size]="14" class="mt-0.5 shrink-0" />
          {{ error() }}
        </p>
      }
      @if (saved()) {
        <p
          class="flex items-center gap-2 border-t border-rule bg-ok-wash px-[15px] py-2.5
                 text-[13px] text-ok"
          role="status"
        >
          <erp-icon name="check-circle" [size]="14" />
          Chiffrage enregistré : la chaîne de marge est recalculée.
        </p>
      }

      <p class="border-t border-rule px-[15px] py-2.5 text-[11px] leading-relaxed text-ink-faint">
        La valeur du barème vous est proposée dès que vous choisissez un poste. Vous pouvez la
        conserver ou en saisir une autre, dans ce cas un motif est exigé. La
        <strong>base</strong> vient du paramétrage : une valeur <strong>au litre</strong> est
        multipliée par le volume contracté, un <strong>forfait</strong> vaut pour l’affaire
        entière. Les charges indirectes ne se saisissent pas : elles sont absorbées par un taux
        sur assiette budgétée.
      </p>
    </section>
  `,
})
export class DealCostingComponent implements OnChanges {
  private readonly api = inject(ApiService);

  @Input({ required: true }) dealId!: string;
  @Input({ required: true }) currency!: string;
  @Input({ required: true }) uom!: string;
  /** Verrou d'édition (§ discussion 15/08) : seul le brouillon se chiffre. */
  @Input({ required: true }) status!: string;

  @Input({ required: true }) set volume(v: number) {
    this.volumeSignal.set(v);
  }
  @Input() set lines(existing: DealCostLine[]) {
    this.drafts.set(
      existing.map((l) => ({
        costPostId: '',
        amount: Number(l.inputAmount),
        description: l.description ?? '',
        varianceReason: l.varianceReason ?? '',
      })),
    );
    // Le poste est rattaché par son code : le détail ne rend pas l'identifiant.
    this.pendingCodes = existing.map((l) => l.costPost.code);
    this.bindPosts();
    this.dirty.set(false);
  }

  protected readonly posts = signal<CostGuidance[]>([]);
  protected readonly drafts = signal<Draft[]>([]);
  protected readonly busy = signal(false);
  protected readonly dirty = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly saved = signal(false);

  private readonly volumeSignal = signal(0);
  private pendingCodes: string[] = [];

  /** Seuls les postes DIRECTS se chiffrent : l'indirect est absorbé (§ 14.2). */
  protected readonly directPosts = computed(() => this.posts());

  private loaded = false;

  ngOnChanges(): void {
    // La guidance dépend de l'affaire : segment, mode de transport, produit.
    if (this.loaded || !this.dealId) return;
    this.loaded = true;
    this.api.costGuidance(this.dealId).subscribe((g) => {
      this.posts.set(g.postes);
      this.bindPosts();
    });
  }

  private bindPosts(): void {
    if (this.posts().length === 0 || this.pendingCodes.length === 0) return;
    const byCode = new Map(this.posts().map((p) => [p.code, p.costPostId]));
    this.drafts.update((d) =>
      d.map((line, i) => ({ ...line, costPostId: byCode.get(this.pendingCodes[i]) ?? '' })),
    );
  }

  /** Barème applicable à la ligne, ou null si le poste n'est pas tarifé. */
  protected standard(l: Draft): CostGuidance | null {
    return this.posts().find((p) => p.costPostId === l.costPostId) ?? null;
  }

  protected basisLabel(l: Draft): string {
    const b = this.standard(l)?.basis;
    if (b === 'PER_UNIT') return `Au ${(this.standard(l)?.uom ?? this.uom).toLowerCase()}`;
    if (b === 'FIXED') return 'Forfait';
    return 'non tarifé';
  }

  /**
   * À la sélection d'un poste, la valeur du barème est PROPOSÉE.
   * Conserver la proposition doit être le geste par défaut, pas un effort.
   */
  protected onPostChange(l: Draft): void {
    const std = this.standard(l);
    if (std?.amount !== null && std?.amount !== undefined) {
      l.amount = std.amount;
      l.varianceReason = '';
    }
    this.touch();
  }

  protected restore(l: Draft): void {
    const std = this.standard(l);
    if (std?.amount === null || std?.amount === undefined) return;
    l.amount = std.amount;
    l.varianceReason = '';
    this.touch();
  }

  protected isModified(l: Draft): boolean {
    return this.needsReason(l);
  }

  protected volumeLabel(): string {
    return `${grouper(this.volumeSignal())} ${this.uom}`;
  }

  protected touch(): void {
    this.dirty.set(true);
    this.saved.set(false);
  }

  protected add(): void {
    this.drafts.update((d) => [
      ...d,
      { costPostId: '', amount: null, description: '', varianceReason: '' },
    ]);
    this.touch();
  }

  protected remove(index: number): void {
    this.drafts.update((d) => d.filter((_, i) => i !== index));
    this.touch();
  }

  /** Forfait tel quel, valeur unitaire multipliée par le volume. */
  protected total(l: Draft): number {
    const a = Number(l.amount ?? 0);
    return this.standard(l)?.basis === 'PER_UNIT' ? a * this.volumeSignal() : a;
  }

  protected perUnit(l: Draft): number {
    const v = this.volumeSignal();
    return v > 0 ? this.total(l) / v : 0;
  }

  protected grandTotal(): number {
    return this.drafts().reduce((s, l) => s + this.total(l), 0);
  }

  protected grandPerUnit(): number {
    const v = this.volumeSignal();
    return v > 0 ? this.grandTotal() / v : 0;
  }

  protected standardLabel(l: Draft): string {
    const std = this.standard(l);
    if (std?.standardTotal === null || std?.standardTotal === undefined) return '-';
    return this.money(std.standardTotal);
  }

  /**
   * Les comparaisons vivent ici, jamais dans l'interpolation : le parseur de
   * template Angular lit « < » comme une ouverture de balise.
   */
  /**
   * Toute valeur différente de celle proposée doit être justifiée. La
   * tolérance du barème s'y ajoute si elle est renseignée — par défaut zéro :
   * conserver ou justifier, il n'y a pas de troisième voie.
   */
  protected needsReason(l: Draft): boolean {
    const std = this.standard(l);
    if (std?.standardTotal === null || std?.standardTotal === undefined) return false;
    return this.gap(l) > (std.tolerancePct ?? 0) / 100 + 0.0001;
  }

  private gap(l: Draft): number {
    const std = this.standard(l);
    if (!std?.standardTotal) return 0;
    return Math.abs(this.total(l) - std.standardTotal) / std.standardTotal;
  }

  protected variancePct(l: Draft): string {
    return `${(this.gap(l) * 100).toFixed(1)} %`;
  }

  protected varianceClass(l: Draft): string {
    const std = this.standard(l);
    if (std?.standardTotal === null || std?.standardTotal === undefined) return 'text-ink-faint';
    return this.needsReason(l) ? 'font-semibold text-warn-ink' : 'text-ok';
  }

  protected rowClass(l: Draft): string {
    return this.needsReason(l) && !l.varianceReason.trim() ? 'row-warn' : '';
  }

  protected money(v: number): string {
    if (!Number.isFinite(v)) return '-';
    return grouper(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected save(): void {
    if (this.busy()) return;
    const lines = this.drafts().filter((l) => l.costPostId && l.amount !== null);
    if (lines.length !== this.drafts().length) {
      this.error.set('Chaque ligne doit porter un poste et une valeur.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);

    const payload: DealCostLineInput[] = lines.map((l) => ({
      costPostId: l.costPostId,
      // La base est celle du barème : le serveur la réimpose de toute façon.
      basis: this.standard(l)?.basis ?? 'FIXED',
      amount: Number(l.amount),
      description: l.description || undefined,
      varianceReason: l.varianceReason || undefined,
    }));

    this.api.setDealCostLines(this.dealId, payload).subscribe({
      next: () => {
        this.busy.set(false);
        this.dirty.set(false);
        this.saved.set(true);
      },
      error: (e: { error?: { message?: string | string[] } }) => {
        this.busy.set(false);
        const m = e.error?.message;
        this.error.set(Array.isArray(m) ? m[0] : (m ?? 'Enregistrement impossible'));
      },
    });
  }
}
