import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, Derogation } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { HttpFailure, failureMessage } from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';
import { PaginationComponent } from '../shared/tableau';
import { StatusBadgeComponent } from '../shared/status-badge.component';
import { dateOnly } from '../shared/format';

const TYPE_LABELS: Record<string, string> = {
  MARGIN_BELOW_THRESHOLD: 'Marge sous le seuil',
  MARGIN_BELOW_DIRECT_FLOOR: 'Plancher direct franchi',
  HSE_BLOCKING_OVERRIDE: 'Levée de contrôle HSE',
  TRANSPORT_NON_COMPLIANCE: 'Moyen non conforme',
  HSE_DELEGATION: 'Suppléance HSE',
  ULLAGE_ACKNOWLEDGEMENT: "Acquittement d'écart de volume",
  PURCHASE_PRICE_VARIANCE: "Prix d'achat hors bande",
  CREDIT_LIMIT_OVERRIDE: 'Dépassement de plafond de crédit',
  OTHER: 'Autre',
};

/**
 * Types qu'on peut accorder DEPUIS CE FORMULAIRE GÉNÉRAL, et le rôle minimal
 * requis — vérifié en base de toute façon (`trg_derogation_authority`), ceci
 * n'est qu'un confort d'affichage qui évite un refus prévisible.
 *
 * ⚠️ `HSE_DELEGATION` RESTE VOLONTAIREMENT ABSENTE D'ICI.
 *
 *    Pas parce qu'elle serait sans effet — elle en a un, désormais (§ 3.4,
 *    voir `DelegationService`) — mais parce qu'elle ne se limite pas à une
 *    dérogation : elle est TOUJOURS accompagnée d'une `Delegation` (le
 *    suppléant, la fenêtre de dates), que ce formulaire générique ne sait pas
 *    saisir. Elle a son propre encart plus bas, seul chemin qui pose les deux
 *    ensemble. `HSE_BLOCKING_OVERRIDE`, elle, ne demande qu'un motif et un
 *    sujet — elle a toute sa place ici.
 */
const TYPES_ACCORDABLES: { type: string; roles: string[] }[] = [
  { type: 'MARGIN_BELOW_DIRECT_FLOOR', roles: ['DG'] },
  { type: 'TRANSPORT_NON_COMPLIANCE', roles: ['DG'] },
  { type: 'HSE_BLOCKING_OVERRIDE', roles: ['DG', 'FINANCE_CFO', 'CCOO'] },
  { type: 'PURCHASE_PRICE_VARIANCE', roles: ['DG', 'FINANCE_CFO', 'CCOO'] },
  { type: 'CREDIT_LIMIT_OVERRIDE', roles: ['DG', 'FINANCE_CFO', 'CCOO'] },
  { type: 'ULLAGE_ACKNOWLEDGEMENT', roles: ['DG', 'FINANCE_CFO', 'CCOO'] },
  { type: 'OTHER', roles: ['DG', 'FINANCE_CFO', 'CCOO'] },
];

/**
 * Registre des dérogations — SPECIFICATIONS.md § 11.4.
 *
 * Registre unique pour les trois verrous et la suppléance HSE. C'est la pièce
 * qu'un auditeur ou un assureur demandera à consulter après un incident : elle
 * doit être lisible, complète, et montrer qui a autorisé quoi et pourquoi.
 */
@Component({
  selector: 'erp-derogations',
  standalone: true,
  imports: [FormsModule, IconComponent, StatusBadgeComponent, PaginationComponent],
  template: `
    <header class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="page-title">Registre des dérogations</h1>
        <p class="page-sub">
          Verrous financier, HSE et conformité, toute levée y figure, avec son autorité et son
          motif.
        </p>
      </div>
      @if (peutAccorder()) {
        <button class="btn-primary shrink-0" (click)="showCreate.set(!showCreate())">
          {{ showCreate() ? 'Fermer' : 'Accorder une dérogation' }}
        </button>
      }
    </header>

    <!-- ============ Octroi d'une dérogation (§ 11.4) ============
         ⚠️ CORRIGÉ — CE REGISTRE NE SAVAIT QUE LISTER, REVOIR ET RÉVOQUER.
            Rien ne permettait d'en ACCORDER une : la route existait depuis
            toujours (POST /derogations), réservée à DG/DAF/CCOO, mais aucun
            écran ne l'appelait. Un DG ne pouvait lever aucun verrou. -->
    @if (showCreate()) {
      <section class="card mb-5">
        <div class="card-header"><h2 class="card-title">Accorder une dérogation</h2></div>
        <div class="card-body">
          @if (createError()) {
            <div
              class="mb-3 flex items-start gap-2 rounded-[3px] bg-crit-wash px-3 py-2
                     text-[13px] text-crit"
              role="alert"
            >
              <erp-icon name="alert-triangle" [size]="14" class="mt-0.5 shrink-0" />
              <span>{{ createError() }}</span>
            </div>
          }
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label class="label" for="d-type">Type</label>
              <select id="d-type" class="field" [(ngModel)]="creType">
                <option value="">Choisir</option>
                @for (t of typesAccordablesPourMoi(); track t) {
                  <option [value]="t">{{ typeLabel(t) }}</option>
                }
              </select>
            </div>
            <div>
              <label class="label" for="d-sujet-type">Nature du sujet</label>
              <input
                id="d-sujet-type"
                class="field"
                maxlength="64"
                placeholder="Deal, Operation, OperationAssignment…"
                [(ngModel)]="creSubjectType"
              />
            </div>
            <div>
              <label class="label" for="d-sujet-id">Référence du sujet</label>
              <input
                id="d-sujet-id"
                class="field font-mono"
                maxlength="64"
                placeholder="DEAL-2026-08-001"
                [(ngModel)]="creSubjectId"
              />
              <p class="mt-1 text-[11px] leading-relaxed text-ink-faint">
                La RÉFÉRENCE lisible, pas l’identifiant technique — c’est elle que le verrou
                confronte au sujet réel. Laissez vide pour une dérogation générale.
              </p>
            </div>
            <div>
              <label class="label" for="d-echeance">Échéance (facultative)</label>
              <input id="d-echeance" type="date" class="field" [(ngModel)]="creExpiresAt" />
            </div>
            <div class="md:col-span-2">
              <label class="label" for="d-motif">Motif</label>
              <textarea
                id="d-motif"
                class="field"
                rows="2"
                maxlength="2000"
                placeholder="Circonstancié — 10 caractères minimum"
                [(ngModel)]="creReason"
              ></textarea>
            </div>
          </div>
          <button
            class="btn-primary mt-3"
            [disabled]="creBusy() || !creComplet()"
            (click)="creer()"
          >
            {{ creBusy() ? 'Envoi…' : 'Accorder' }}
          </button>
        </div>
      </section>
    }

    <!-- ============ Suppléance du contrôleur HSE (§ 3.4) ============
         ⚠️ CORRIGÉ — NI LA SUPPLÉANCE NI SON EFFET N'EXISTAIENT. Voir
            DelegationService (derogations.controller.ts) pour les trois
            endroits qui devaient bouger ensemble. -->
    @if (isDg()) {
      <section class="card mb-5">
        <div class="card-header">
          <h2 class="card-title">Suppléance du contrôleur HSE</h2>
          <button class="btn-ghost" (click)="toggleDelegation()">
            {{ showDelegation() ? 'Fermer' : 'Nommer un suppléant' }}
          </button>
        </div>
        @if (showDelegation()) {
          <div class="card-body">
            <p class="mb-3 text-[12px] leading-relaxed text-ink-faint">
              Le suppléant reste un agent terrain sur sa fiche — seule la fenêtre ci-dessous lui
              donne, le temps qu'elle dure, les prérogatives du contrôleur HSE : voir les
              checklists en attente d'un autre agent, et les valider à sa place.
            </p>
            @if (delegError()) {
              <div
                class="mb-3 flex items-start gap-2 rounded-[3px] bg-crit-wash px-3 py-2
                       text-[13px] text-crit"
                role="alert"
              >
                <erp-icon name="alert-triangle" [size]="14" class="mt-0.5 shrink-0" />
                <span>{{ delegError() }}</span>
              </div>
            }
            @if (delegDone()) {
              <p
                class="mb-3 flex items-center gap-2 rounded-[3px] bg-ok-wash px-3 py-2
                       text-[13px] text-ok"
                role="status"
              >
                <erp-icon name="check-circle" [size]="14" />
                {{ delegDone() }}
              </p>
            }
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label class="label" for="deleg-agent">Agent suppléant</label>
                <select id="deleg-agent" class="field" [(ngModel)]="delegAgentId">
                  <option value="">Choisir</option>
                  @for (a of agentsTerrain(); track a.id) {
                    <option [value]="a.id">{{ a.fullName }} · {{ a.email }}</option>
                  }
                </select>
              </div>
              <div></div>
              <div>
                <label class="label" for="deleg-debut">Début</label>
                <input id="deleg-debut" type="datetime-local" class="field" [(ngModel)]="delegStartsAt" />
              </div>
              <div>
                <label class="label" for="deleg-fin">Fin</label>
                <input id="deleg-fin" type="datetime-local" class="field" [(ngModel)]="delegEndsAt" />
              </div>
              <div class="md:col-span-2">
                <label class="label" for="deleg-motif">Motif</label>
                <textarea
                  id="deleg-motif"
                  class="field"
                  rows="2"
                  maxlength="1000"
                  placeholder="Congé, formation, indisponibilité — 10 caractères minimum"
                  [(ngModel)]="delegReason"
                ></textarea>
              </div>
            </div>
            <button
              class="btn-primary mt-3"
              [disabled]="delegBusy() || !delegComplet()"
              (click)="creerDelegation()"
            >
              {{ delegBusy() ? 'Envoi…' : 'Nommer' }}
            </button>
          </div>
        }
      </section>
    }

    <!-- Revue mensuelle : les dérogations exceptionnelles ne doivent pas
         se perdre dans la masse. -->
    @if (pending().length > 0) {
      <section class="card mb-5 border-warn/40">
        <div class="card-header border-warn/30">
          <h2 class="card-title flex items-center gap-2 text-warn-ink">
            <erp-icon name="alert-triangle" [size]="15" />
            En attente de revue mensuelle
          </h2>
          <span class="text-[12px] text-warn-ink/70">{{ pending().length }}</span>
        </div>
        <div class="overflow-x-auto">
          <table class="table">
            <thead>
              <tr><th>Type</th><th>Objet</th><th>Autorité</th><th class="num">Accordée le</th><th></th></tr>
            </thead>
            <tbody>
              @for (d of pending(); track d.id) {
                <tr>
                  <td class="text-ink">{{ typeLabel(d.type) }}</td>
                  <td class="text-ink-soft">{{ d.subjectLabel ?? d.subjectType }}</td>
                  <td class="text-ink-soft">{{ d.authority?.fullName }}</td>
                  <td class="num text-ink-muted">{{ dateOnly(d.grantedAt) }}</td>
                  <td class="text-right">
                    @if (isDg()) {
                      <button class="btn-ghost px-2 py-1 text-[12px]" (click)="review(d)">Marquer revue</button>
                <button class="link ml-2 text-[12px]" (click)="revoke(d.id)">Révoquer</button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }

    <div class="card overflow-x-auto">
      <div class="card-header">
        <h2 class="card-title">Toutes les dérogations</h2>
        <span class="text-[12px] text-ink-faint">{{ total() }} enregistrée(s)</span>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Type</th><th>Objet</th><th>Motif</th><th>Autorité</th>
            <th class="num">Accordée le</th><th>État</th>
          </tr>
        </thead>
        <tbody>
          @for (d of rows(); track d.id) {
            <tr>
              <td>
                <span class="text-ink">{{ typeLabel(d.type) }}</span>
                @if (d.requiresMonthlyReview) {
                  <span class="ml-2 rounded bg-warn-wash px-1.5 py-0.5 text-[10px] text-warn-ink">
                    exceptionnelle
                  </span>
                }
              </td>
              <td class="text-ink-soft">{{ d.subjectLabel ?? d.subjectType }}</td>
              <td class="max-w-xs truncate text-ink-muted" [title]="d.reason">{{ d.reason }}</td>
              <td class="text-ink-soft">
                {{ d.authority?.fullName }}
                <span class="ml-1 text-[11px] text-ink-faint">{{ d.authority?.role }}</span>
              </td>
              <td class="num text-ink-muted">{{ dateOnly(d.grantedAt) }}</td>
              <td>
                @if (d.status === 'ACTIVE') {
                  <erp-status-badge kind="wait" label="Active" />
                } @else if (d.status === 'REVOKED') {
                  <erp-status-badge kind="blocked" label="Révoquée" />
                } @else {
                  <erp-status-badge kind="neutral" [label]="d.status" />
                }
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="6" class="empty">
                Aucune dérogation enregistrée. Les verrous n'ont jamais eu besoin d'être levés.
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <erp-pagination [page]="page()" [totalPages]="totalPages()" [total]="total()"
                    libelle="dérogations" (allerA)="allerA($event)" />
  `,
})
export class DerogationsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  protected readonly rows = signal<Derogation[]>([]);

  // --- Octroi d'une dérogation ---------------------------------------------
  protected readonly showCreate = signal(false);
  protected readonly creBusy = signal(false);
  protected readonly createError = signal<string | null>(null);
  protected creType = '';
  protected creSubjectType = '';
  protected creSubjectId = '';
  protected creReason = '';
  protected creExpiresAt = '';

  protected peutAccorder(): boolean {
    return this.auth.hasRole('DG', 'FINANCE_CFO', 'CCOO');
  }

  protected typesAccordablesPourMoi(): string[] {
    const r = this.auth.role();
    if (!r) return [];
    return TYPES_ACCORDABLES.filter((t) => t.roles.includes(r)).map((t) => t.type);
  }

  protected creComplet(): boolean {
    return (
      this.creType !== '' &&
      this.creSubjectType.trim() !== '' &&
      this.creReason.trim().length >= 10
    );
  }

  protected creer(): void {
    if (this.creBusy() || !this.creComplet()) return;
    this.creBusy.set(true);
    this.createError.set(null);
    this.api
      .createDerogation({
        type: this.creType,
        subjectType: this.creSubjectType.trim(),
        subjectId: this.creSubjectId.trim() || undefined,
        subjectLabel: this.creSubjectId.trim() || undefined,
        reason: this.creReason.trim(),
        expiresAt: this.creExpiresAt || undefined,
      })
      .subscribe({
        next: () => {
          this.creBusy.set(false);
          this.showCreate.set(false);
          this.creType = '';
          this.creSubjectType = '';
          this.creSubjectId = '';
          this.creReason = '';
          this.creExpiresAt = '';
          this.load();
        },
        error: (e: HttpFailure) => {
          this.creBusy.set(false);
          this.createError.set(failureMessage(e, 'Dérogation refusée.'));
        },
      });
  }

  /**
   * Page demandée au serveur.
   *
   * L'écran lisait la page 1 et n'en sortait jamais : au-delà de la
   * cinquantième ligne, les données existaient sans s'afficher nulle part.
   */
  protected readonly page = signal(1);
  protected readonly totalPages = signal(1);

  protected allerA(p: number): void {
    this.page.set(p);
    this.load();
  }

  protected readonly pending = signal<Derogation[]>([]);
  protected readonly total = signal(0);

  // --- Suppléance du contrôleur HSE ----------------------------------------
  protected readonly showDelegation = signal(false);
  protected readonly agentsTerrain = signal<{ id: string; fullName: string; email: string }[]>([]);
  protected readonly delegBusy = signal(false);
  protected readonly delegError = signal<string | null>(null);
  protected readonly delegDone = signal<string | null>(null);
  protected delegAgentId = '';
  protected delegStartsAt = '';
  protected delegEndsAt = '';
  protected delegReason = '';

  ngOnInit(): void {
    this.load();
    if (this.isDg()) {
      this.api.fieldUsersForDelegation().subscribe((rows) => this.agentsTerrain.set(rows));
    }
  }

  protected toggleDelegation(): void {
    this.showDelegation.set(!this.showDelegation());
  }

  protected delegComplet(): boolean {
    return (
      this.delegAgentId !== '' &&
      this.delegStartsAt !== '' &&
      this.delegEndsAt !== '' &&
      this.delegEndsAt > this.delegStartsAt &&
      this.delegReason.trim().length >= 10
    );
  }

  protected creerDelegation(): void {
    if (this.delegBusy() || !this.delegComplet()) return;
    this.delegBusy.set(true);
    this.delegError.set(null);
    this.delegDone.set(null);
    this.api
      .createDelegation({
        delegateFieldUserId: this.delegAgentId,
        reason: this.delegReason.trim(),
        startsAt: new Date(this.delegStartsAt).toISOString(),
        endsAt: new Date(this.delegEndsAt).toISOString(),
      })
      .subscribe({
        next: () => {
          this.delegBusy.set(false);
          this.delegDone.set('Suppléance accordée.');
          this.delegAgentId = '';
          this.delegStartsAt = '';
          this.delegEndsAt = '';
          this.delegReason = '';
          this.load();
        },
        error: (e: HttpFailure) => {
          this.delegBusy.set(false);
          this.delegError.set(failureMessage(e, 'Suppléance refusée.'));
        },
      });
  }

  protected readonly dateOnly = dateOnly;

  protected isDg(): boolean {
    return this.auth.hasRole('DG');
  }

  protected typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  protected review(d: Derogation): void {
    this.api.markReviewed(d.id).subscribe(() => this.load());
  }

  /**
   * Révocation d'une dérogation.
   *
   * Une exception devenue injustifiée doit pouvoir être retirée : la laisser
   * courir reviendrait à maintenir une entorse que plus personne n'assume.
   */
  protected revoke(id: string): void {
    this.api.revokeDerogation(id).subscribe({
      next: () => this.load(),
      error: () => this.load(),
    });
  }

  private load(): void {
    this.api.derogations(this.page()).subscribe((page) => {
      this.rows.set(page.items);
      this.total.set(page.total);
      this.totalPages.set(page.totalPages);
    });
    // La revue mensuelle est réservée au DG et au CFO : on n'appelle pas
    // l'endpoint pour les autres, qui recevraient un 403 inutile.
    if (this.auth.hasRole('DG', 'FINANCE_CFO')) {
      this.api.derogationsPendingReview().subscribe((rows) => this.pending.set(rows));
    }
  }
}
