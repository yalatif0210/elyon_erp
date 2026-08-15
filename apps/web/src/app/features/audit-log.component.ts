import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, AuditLogFilters, AuditLogRow } from '../core/api.service';
import { IconComponent } from '../shared/icon.component';
import { PaginationComponent } from '../shared/tableau';

const ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'STATUS_CHANGE',
  'APPROVE',
  'REJECT',
  'OVERRIDE',
  'DEROGATION_GRANTED',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'EXPORT',
  'PASSWORD_RESET',
];

const ACTOR_TYPES = ['INTERNAL_USER', 'PORTAL_USER', 'FIELD_USER', 'SYSTEM'];

const ACTOR_TYPE_LABEL: Record<string, string> = {
  INTERNAL_USER: 'Interne',
  PORTAL_USER: 'Portail',
  FIELD_USER: 'Terrain',
  SYSTEM: 'Système',
};

/**
 * JOURNAL D'AUDIT (§ 1.4) — DG et IT_ADMIN uniquement.
 *
 * ⚠️ CORRIGÉ (audit, axe C, S1) — CET ÉCRAN N'EXISTAIT PAS, PAS PLUS QUE LA
 *    ROUTE QU'IL CONSOMME.
 *
 *    Le journal était correctement alimenté (append-only, garanti par
 *    trigger PostgreSQL) mais totalement illisible depuis l'application —
 *    y compris pour le DG. Une route existe désormais
 *    (`GET /api/internal/audit-log`) ; cet écran est ce qui la rend
 *    réellement consultable, plutôt que réservée à qui sait faire un appel
 *    API à la main.
 */
@Component({
  selector: 'erp-audit-log',
  standalone: true,
  imports: [FormsModule, IconComponent, PaginationComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Journal d'audit</h1>
      <p class="page-sub">
        Toute action journalisée par l'application, tous réalms confondus. Append-only :
        rien ici ne peut être réécrit, y compris par ce compte.
      </p>
    </header>

    <section class="card mb-5 overflow-hidden">
      <div class="card-body grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <label class="label" for="f-actorType">Acteur</label>
          <select id="f-actorType" class="field" [(ngModel)]="filtreActorType" (ngModelChange)="appliquer()">
            <option value="">Tous</option>
            @for (t of actorTypes; track t) {
              <option [ngValue]="t">{{ actorTypeLabel(t) }}</option>
            }
          </select>
        </div>
        <div>
          <label class="label" for="f-action">Action</label>
          <select id="f-action" class="field" [(ngModel)]="filtreAction" (ngModelChange)="appliquer()">
            <option value="">Toutes</option>
            @for (a of actions; track a) {
              <option [ngValue]="a">{{ a }}</option>
            }
          </select>
        </div>
        <div>
          <label class="label" for="f-entityType">Type d'entité</label>
          <input id="f-entityType" class="field" placeholder="Deal, Invoice…" [(ngModel)]="filtreEntityType" (ngModelChange)="appliquerDifferee()" />
        </div>
        <div>
          <label class="label" for="f-entityId">Identifiant d'entité</label>
          <input id="f-entityId" class="field font-mono" [(ngModel)]="filtreEntityId" (ngModelChange)="appliquerDifferee()" />
        </div>
        <div>
          <label class="label" for="f-from">Depuis</label>
          <input id="f-from" type="date" class="field" [(ngModel)]="filtreFrom" (ngModelChange)="appliquer()" />
        </div>
        <div>
          <label class="label" for="f-to">Jusqu'au</label>
          <input id="f-to" type="date" class="field" [(ngModel)]="filtreTo" (ngModelChange)="appliquer()" />
        </div>
      </div>
    </section>

    @if (chargement()) {
      <p class="text-[13px] text-ink-muted">Lecture…</p>
    } @else if (lignes().length === 0) {
      <div class="card px-[15px] py-4">
        <p class="text-[13px] text-ink-soft">Aucune écriture ne correspond à ces filtres.</p>
      </div>
    } @else {
      <div class="card overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>Horodatage</th>
              <th>Acteur</th>
              <th>Action</th>
              <th>Entité</th>
              <th>Référence</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (l of lignes(); track l.id) {
              <tr class="cursor-pointer hover:bg-gray-50" (click)="basculer(l.id)">
                <td class="font-mono text-[12px] text-ink-soft">{{ horodatage(l.createdAt) }}</td>
                <td class="text-ink-soft">
                  {{ l.actorName ?? (l.actorId ? l.actorId.slice(0, 8) + '…' : actorTypeLabel(l.actorType)) }}
                  <span class="text-[11px] text-ink-faint">· {{ actorTypeLabel(l.actorType) }}</span>
                </td>
                <td><span class="badge-neutral">{{ l.action }}</span></td>
                <td class="text-ink-soft">{{ l.entityType }}</td>
                <td class="font-mono text-[12px] text-ink-faint">{{ l.entityId ? l.entityId.slice(0, 12) + '…' : '-' }}</td>
                <td class="text-right">
                  <erp-icon [name]="ouvert() === l.id ? 'chevron-right' : 'chevron-right'" [size]="12"
                            [class]="ouvert() === l.id ? 'rotate-90 transition-transform' : 'transition-transform'" />
                </td>
              </tr>
              @if (ouvert() === l.id) {
                <tr>
                  <td colspan="6" class="bg-gray-50 px-[15px] py-3">
                    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <p class="mb-1 text-[11px] font-semibold uppercase tracking-[0.5px] text-ink-muted">Avant</p>
                        <pre class="max-h-64 overflow-auto rounded-[3px] border border-rule bg-surface p-2 text-[11px] text-ink-soft">{{ formate(l.beforeState) }}</pre>
                      </div>
                      <div>
                        <p class="mb-1 text-[11px] font-semibold uppercase tracking-[0.5px] text-ink-muted">Après</p>
                        <pre class="max-h-64 overflow-auto rounded-[3px] border border-rule bg-surface p-2 text-[11px] text-ink-soft">{{ formate(l.afterState) }}</pre>
                      </div>
                    </div>
                    @if (l.ipAddress) {
                      <p class="mt-2 text-[11px] text-ink-faint">Adresse : {{ l.ipAddress }}</p>
                    }
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
      <erp-pagination [page]="page()" [totalPages]="totalPages()" [total]="total()"
                      libelle="écritures" (allerA)="allerA($event)" />
    }
  `,
})
export class AuditLogComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly chargement = signal(true);
  protected readonly lignes = signal<AuditLogRow[]>([]);
  protected readonly page = signal(1);
  protected readonly total = signal(0);
  protected readonly totalPages = signal(1);
  protected readonly ouvert = signal<string | null>(null);

  protected readonly actions = ACTIONS;
  protected readonly actorTypes = ACTOR_TYPES;

  protected filtreActorType = '';
  protected filtreAction = '';
  protected filtreEntityType = '';
  protected filtreEntityId = '';
  protected filtreFrom = '';
  protected filtreTo = '';

  private debounce?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.charger();
  }

  protected actorTypeLabel(t: string): string {
    return ACTOR_TYPE_LABEL[t] ?? t;
  }

  protected horodatage(iso: string): string {
    return iso.replace('T', ' ').slice(0, 19);
  }

  protected formate(valeur: unknown): string {
    if (valeur === null || valeur === undefined) return '-';
    return JSON.stringify(valeur, null, 2);
  }

  protected basculer(id: string): void {
    this.ouvert.set(this.ouvert() === id ? null : id);
  }

  protected appliquer(): void {
    this.page.set(1);
    this.charger();
  }

  /** Anti-rebond pour les champs texte : sans lui, chaque frappe interroge le serveur. */
  protected appliquerDifferee(): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.appliquer(), 300);
  }

  protected allerA(p: number): void {
    this.page.set(p);
    this.charger();
  }

  private charger(): void {
    this.chargement.set(true);
    const filtres: AuditLogFilters = {
      actorType: this.filtreActorType || undefined,
      action: this.filtreAction || undefined,
      entityType: this.filtreEntityType.trim() || undefined,
      entityId: this.filtreEntityId.trim() || undefined,
      from: this.filtreFrom || undefined,
      to: this.filtreTo || undefined,
    };
    this.api.auditLog(filtres, this.page()).subscribe((p) => {
      this.lignes.set(p.items);
      this.total.set(p.total);
      this.totalPages.set(p.totalPages);
      this.chargement.set(false);
    });
  }
}
