import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, DealRow, DeviseOption, GuaranteeRow, Partner } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ActionFeedbackComponent, ActionState, HttpFailure } from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';
import { PaginationComponent } from '../shared/tableau';
import { grouper, dateOnly } from '../shared/format';
import { MontantDirective } from '../shared/montant.directive';
import { StatusBadgeComponent, StatusKind } from '../shared/status-badge.component';

const STATUS: Record<string, { label: string; kind: StatusKind }> = {
  PENDING: { label: 'En attente', kind: 'wait' },
  ACTIVE: { label: 'Active', kind: 'ok' },
  CONSUMED: { label: 'Consommée', kind: 'neutral' },
  EXPIRED: { label: 'Échue', kind: 'blocked' },
  CANCELLED: { label: 'Annulée', kind: 'neutral' },
};

const TYPE_LABELS: Record<string, string> = {
  LETTER_OF_CREDIT: 'Lettre de crédit',
  DOWN_PAYMENT: 'Acompte',
  BANK_GUARANTEE: 'Garantie bancaire',
};

const FILTERS: { label: string; status?: string }[] = [
  { label: 'Toutes' },
  { label: 'En attente', status: 'PENDING' },
  { label: 'Actives', status: 'ACTIVE' },
  { label: 'Consommées', status: 'CONSUMED' },
  { label: 'Échues', status: 'EXPIRED' },
];

/**
 * Transitions acceptées côté écran — miroir de `TRANSITIONS` côté serveur
 * (`guarantees.controller.ts`). Le serveur reste la seule autorité : ceci
 * n'évite qu'un refus prévisible, jamais une vérification dupliquée.
 */
const TRANSITIONS: Record<string, { to: string; label: string }[]> = {
  PENDING: [
    { to: 'ACTIVE', label: 'Activer' },
    { to: 'CANCELLED', label: 'Annuler' },
  ],
  ACTIVE: [
    { to: 'CONSUMED', label: 'Marquer consommée' },
    { to: 'EXPIRED', label: 'Marquer échue' },
    { to: 'CANCELLED', label: 'Annuler' },
  ],
  CONSUMED: [],
  EXPIRED: [],
  CANCELLED: [],
};

/**
 * Garanties bancaires (ticket #6) — cycle de vie contrôlé, remplace la
 * saisie libre du statut qu'offrait auparavant l'écran générique de
 * paramétrage. Une garantie ACTIVE et non échue déduit l'exposition crédit
 * du client ; ce calcul n'est pas modifié par cet écran, seulement lu.
 */
@Component({
  selector: 'erp-guarantees',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    IconComponent,
    StatusBadgeComponent,
    ActionFeedbackComponent,
    MontantDirective,
    PaginationComponent,
  ],
  template: `
    <header class="mb-5 flex items-start justify-between gap-4">
      <div>
        <h1 class="page-title">Garanties bancaires</h1>
        <p class="page-sub">
          Une garantie active et non échue déduit l'exposition crédit du client rattaché
        </p>
      </div>
      @if (peutEcrire()) {
        <button class="btn-primary shrink-0" (click)="showCreate.set(!showCreate())">
          {{ showCreate() ? 'Fermer' : 'Nouvelle garantie' }}
        </button>
      }
    </header>

    <erp-action-feedback [error]="state.error()" [success]="state.done()" />

    @if (showCreate()) {
      <section class="card mb-5">
        <div class="card-header">
          <h2 class="card-title">Enregistrer une garantie</h2>
        </div>
        <div class="card-body">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <label class="label" for="ref-g">Référence</label>
              <input id="ref-g" class="field font-mono" [(ngModel)]="newReference" />
            </div>
            <div>
              <label class="label" for="tiers-g">Tiers garanti</label>
              <select id="tiers-g" class="field" [(ngModel)]="newPartnerId">
                <option [ngValue]="''">Choisir</option>
                @for (p of clients(); track p.id) {
                  <option [ngValue]="p.id">{{ p.legalName }}</option>
                }
              </select>
            </div>
            <div>
              <label class="label" for="deal-g">Affaire (doit appartenir au tiers garanti)</label>
              <select id="deal-g" class="field" [(ngModel)]="newDealId">
                <option [ngValue]="''">Non rattachée</option>
                @for (d of dealOptions(); track d.id) {
                  <option [ngValue]="d.id">{{ d.reference }} · {{ d.client.legalName }}</option>
                }
              </select>
            </div>
            <div>
              <label class="label" for="type-g">Type</label>
              <select id="type-g" class="field" [(ngModel)]="newType">
                @for (t of types; track t) {
                  <option [ngValue]="t">{{ typeLabel(t) }}</option>
                }
              </select>
            </div>
            <div>
              <label class="label" for="mnt-g">Montant</label>
              <input id="mnt-g" class="field text-right font-mono" erpMontant [(ngModel)]="newAmount" />
            </div>
            <div>
              <label class="label" for="dev-g">Devise</label>
              <select id="dev-g" class="field" [(ngModel)]="newCurrency">
                @for (d of devises(); track d.code) {
                  <option [ngValue]="d.code">{{ d.code }}</option>
                }
              </select>
            </div>
            <div>
              <label class="label" for="banque-g">Banque émettrice</label>
              <input id="banque-g" class="field" [(ngModel)]="newBank" />
            </div>
            <div>
              <label class="label" for="emis-g">Date d'émission</label>
              <input id="emis-g" type="date" class="field" [(ngModel)]="newIssueDate" />
            </div>
            <div>
              <label class="label" for="ech-g">Échéance</label>
              <input id="ech-g" type="date" class="field" [(ngModel)]="newExpiryDate" />
            </div>
          </div>
          <p class="mt-2 text-[11px] leading-relaxed text-ink-faint">
            La garantie est créée EN ATTENTE : elle ne réduit l'exposition crédit du client
            qu'une fois activée, la banque ayant confirmé l'émission.
          </p>
          <button class="btn-primary mt-3" (click)="creer()" [disabled]="state.busy()">
            Enregistrer
          </button>
        </div>
      </section>
    }

    <div class="mb-4 flex flex-wrap items-center gap-2">
      @for (f of filters; track f.label) {
        <button
          type="button"
          class="rounded-[3px] px-2.5 py-1 text-[12px] font-medium transition-colors"
          [class]="
            active() === (f.status ?? '')
              ? 'bg-primary text-white'
              : 'border border-rule-strong bg-surface text-ink-soft hover:bg-gray-100 hover:text-ink'
          "
          (click)="setFilter(f.status)"
        >
          {{ f.label }}
        </button>
      }

      <div class="relative ml-auto w-full max-w-xs">
        <erp-icon
          name="search"
          [size]="14"
          class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
        />
        <input
          class="field pl-8"
          placeholder="Rechercher une référence…"
          aria-label="Rechercher une garantie"
          [(ngModel)]="search"
          (ngModelChange)="onSearch()"
        />
      </div>
    </div>

    <div class="card overflow-x-auto">
      <table class="table">
        <thead>
          <tr>
            <th>Référence</th>
            <th>Tiers</th>
            <th>Affaire</th>
            <th>Type</th>
            <th class="num">Montant</th>
            <th>Banque</th>
            <th>Échéance</th>
            <th>État</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (g of rows(); track g.id) {
            <tr>
              <td><span class="ref">{{ g.reference }}</span></td>
              <td class="font-medium text-ink">{{ g.partner.legalName }}</td>
              <td>
                @if (g.deal) {
                  <a [routerLink]="['/affaires', g.deal.id]" class="link font-mono text-[12px]">{{
                    g.deal.reference
                  }}</a>
                } @else {
                  <span class="text-ink-faint">non rattachée</span>
                }
              </td>
              <td class="text-[12px] text-ink-soft">{{ typeLabel(g.type) }}</td>
              <td class="num font-mono font-semibold text-ink">
                {{ money(+g.amount) }}
                <span class="ml-1 text-[11px] font-normal text-ink-faint">{{ g.currencyCode }}</span>
              </td>
              <td class="text-[12px] text-ink-soft">{{ g.issuingBank ?? '-' }}</td>
              <td class="text-[12px] text-ink-soft">{{ dateOnly(g.expiryDate) }}</td>
              <td>
                <erp-status-badge [kind]="status(g.status).kind" [label]="status(g.status).label" />
              </td>
              <td>
                @if (peutEcrire()) {
                  <div class="flex flex-wrap gap-1.5">
                    @for (t of transitions(g.status); track t.to) {
                      <button
                        type="button"
                        class="link text-[11px]"
                        [disabled]="state.busy()"
                        (click)="transitionner(g, t.to)"
                      >
                        {{ t.label }}
                      </button>
                    }
                  </div>
                }
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="9" class="empty">
                Aucune garantie sur ce filtre.<br />
                Sans elle, l'exposition crédit du client ne peut jamais être réduite : elle vaut
                l'intégralité de ses créances et engagements en cours.
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <erp-pagination [page]="page()" [totalPages]="totalPages()" [total]="total()"
                    libelle="garanties" (allerA)="allerA($event)" />
  `,
})
export class GuaranteesComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  protected readonly rows = signal<GuaranteeRow[]>([]);
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly totalPages = signal(1);
  protected readonly active = signal('');
  protected readonly filters = FILTERS;
  protected readonly types = Object.keys(TYPE_LABELS);
  protected search = '';

  protected readonly state = new ActionState();
  protected readonly showCreate = signal(false);
  protected readonly clients = signal<Partner[]>([]);
  protected readonly dealOptions = signal<DealRow[]>([]);
  protected readonly devises = signal<DeviseOption[]>([]);

  protected newReference = '';
  protected newPartnerId = '';
  protected newDealId = '';
  protected newType = 'BANK_GUARANTEE';
  protected newAmount: number | null = null;
  protected newCurrency = '';
  protected newBank = '';
  protected newIssueDate = new Date().toISOString().slice(0, 10);
  protected newExpiryDate = '';

  private debounce?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.load();
    this.api.partners(1, undefined, 'CLIENT').subscribe((p) => this.clients.set(p.items));
    this.api.deals(1, {}).subscribe((p) => this.dealOptions.set(p.items));
    this.api.devises().subscribe((l) => {
      this.devises.set(l);
      this.newCurrency = l.find((d) => d.isLocal)?.code ?? l[0]?.code ?? '';
    });
  }

  protected peutEcrire(): boolean {
    return this.auth.hasRole('DG', 'FINANCE_CFO');
  }

  protected status(code: string) {
    return STATUS[code] ?? { label: code, kind: 'neutral' as StatusKind };
  }

  protected typeLabel(code: string): string {
    return TYPE_LABELS[code] ?? code;
  }

  protected transitions(status: string) {
    return TRANSITIONS[status] ?? [];
  }

  protected money(value: number): string {
    if (!Number.isFinite(value)) return '-';
    return grouper(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  protected dateOnly(iso: string | null): string {
    return dateOnly(iso);
  }

  protected setFilter(status?: string): void {
    this.active.set(status ?? '');
    this.load();
  }

  protected onSearch(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.load(), 300);
  }

  protected allerA(p: number): void {
    this.page.set(p);
    this.load();
  }

  protected creer(): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api
      .creerGarantie({
        reference: this.newReference,
        partnerId: this.newPartnerId,
        dealId: this.newDealId || undefined,
        type: this.newType,
        amount: Number(this.newAmount ?? 0),
        currencyCode: this.newCurrency,
        issuingBank: this.newBank || undefined,
        issueDate: this.newIssueDate,
        expiryDate: this.newExpiryDate || undefined,
      })
      .subscribe({
        next: () => {
          this.state.succeed('Garantie enregistrée, en attente d’activation.');
          this.newReference = '';
          this.newPartnerId = '';
          this.newDealId = '';
          this.newAmount = null;
          this.newBank = '';
          this.newExpiryDate = '';
          this.showCreate.set(false);
          this.load();
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }

  protected transitionner(g: GuaranteeRow, to: string): void {
    if (this.state.busy()) return;
    this.state.start();
    this.api.transitionGarantie(g.id, to).subscribe({
      next: () => {
        this.state.succeed(`Garantie ${g.reference} : ${this.status(to).label.toLowerCase()}.`);
        this.load();
      },
      error: (e: HttpFailure) => this.state.fail(e),
    });
  }

  protected load(): void {
    this.api
      .guarantees(this.page(), { status: this.active() || undefined, search: this.search.trim() || undefined })
      .subscribe((page) => {
        this.rows.set(page.items);
        this.total.set(page.total);
        this.totalPages.set(page.totalPages);
      });
  }
}
