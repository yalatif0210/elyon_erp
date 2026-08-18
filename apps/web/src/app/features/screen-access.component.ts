import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, ScreenAccessRow } from '../core/api.service';
import { ROLE_LABELS, UserRole } from '../core/auth.service';
import { IconComponent } from '../shared/icon.component';

const ROLES: UserRole[] = [
  'DG',
  'ASSISTANT_DG',
  'IT_ADMIN',
  'CCOO',
  'SALES_REP',
  'LOGISTICS_COORD',
  'FINANCE_CFO',
  'ACCOUNTANT',
];

/** Sigles courts pour l'en-tête de colonne — le libellé complet reste en `title`. */
const ROLE_SIGLE: Record<UserRole, string> = {
  DG: 'DG',
  ASSISTANT_DG: 'A.DG',
  IT_ADMIN: 'IT',
  CCOO: 'CCOO',
  SALES_REP: 'Comm.',
  LOGISTICS_COORD: 'Log.',
  FINANCE_CFO: 'CFO',
  ACCOUNTANT: 'Compt.',
};

/**
 * PARAMÉTRAGE DG — QUI VOIT QUEL ÉCRAN (§ paramétrage 17/08).
 *
 * ⚠️ CE N'EST PAS UN ÉCRAN DE PERMISSIONS D'ACTION.
 *
 *    Il règle la visibilité en LECTURE d'un écran par rôle — ce qui ouvre un
 *    menu et sa route. Les actions (créer, approuver, supprimer…) restent
 *    décidées par le code, route par route, et cet écran n'a AUCUNE prise
 *    dessus : un rôle rendu VISIBLE sur une affaire, par exemple, VOIT
 *    l'affaire, mais les boutons que son rôle ne permet pas restent bloqués
 *    exactement comme avant.
 *
 *    Un écran regroupe parfois plusieurs indicateurs distincts (Pilotage
 *    financier en porte six) : la dérogation s'applique à l'écran ENTIER, pas
 *    à un indicateur choisi dedans.
 *
 * Volontairement hors de la matrice qu'il édite (voir `app.routes.ts` :
 * `/acces-ecrans` reste sur un `roleGuard('DG')` fixe) — sans quoi un DG
 * pourrait se retirer l'accès au seul endroit qui permet de se le redonner.
 */
@Component({
  selector: 'erp-screen-access',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <header class="mb-5">
      <h1 class="page-title">Accès aux écrans</h1>
      <p class="page-sub">
        Qui voit quel menu, par rôle. Un réglage de visibilité, pas de droits d’action.
      </p>
    </header>

    <div
      class="mb-5 flex items-start gap-2.5 rounded-[3px] border border-rule bg-surface px-4 py-3"
    >
      <erp-icon name="alert-triangle" [size]="15" class="mt-0.5 shrink-0 text-ink-faint" />
      <p class="text-[12px] leading-relaxed text-ink-soft">
        « Hérité » suit le réglage du code, rappelé en clair sous chaque case. « Visible » et
        « Masqué » l’emportent dans les deux sens : ouvrir un écran à un rôle qui ne l’a pas
        nativement, ou le retirer à un rôle qui l’a. Les boutons d’action à l’intérieur d’un
        écran, eux, ne changent pas.
      </p>
    </div>

    @if (error()) {
      <p class="mb-4 rounded-[3px] bg-crit-wash px-3 py-2 text-[13px] text-crit" role="alert">
        {{ error() }}
      </p>
    }

    @for (group of groupes(); track group.nom) {
      <section class="card mb-5 overflow-hidden">
        <div class="card-header"><h2 class="card-title">{{ group.nom }}</h2></div>
        <div class="overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th class="min-w-[160px]">Écran</th>
                @for (role of roles; track role) {
                  <th class="text-center" [title]="roleLabel(role)">{{ roleSigle(role) }}</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (screen of group.ecrans; track screen.key) {
                <tr>
                  <td class="font-medium text-ink">{{ screen.label }}</td>
                  @for (role of roles; track role) {
                    <td class="text-center">
                      <select
                        class="field w-[104px] px-1.5 py-1 text-center text-[12px]"
                        [class]="cellClass(screen, role)"
                        [ngModel]="screen.roles[role].override ?? ''"
                        (ngModelChange)="changer(screen, role, $event)"
                        [disabled]="busyCell() === screen.key + ':' + role"
                        [attr.aria-label]="screen.label + ' · ' + roleLabel(role)"
                      >
                        <option value="">
                          Hérité ({{ screen.roles[role].defaultVisible ? 'visible' : 'masqué' }})
                        </option>
                        <option value="VISIBLE">Visible</option>
                        <option value="MASQUE">Masqué</option>
                      </select>
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
})
export class ScreenAccessComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly roles = ROLES;
  protected readonly matrix = signal<ScreenAccessRow[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busyCell = signal<string | null>(null);

  protected readonly groupes = computed(() => {
    const parGroupe = new Map<string, ScreenAccessRow[]>();
    for (const row of this.matrix()) {
      const liste = parGroupe.get(row.group) ?? [];
      liste.push(row);
      parGroupe.set(row.group, liste);
    }
    return Array.from(parGroupe.entries()).map(([nom, ecrans]) => ({ nom, ecrans }));
  });

  ngOnInit(): void {
    this.charger();
  }

  private charger(): void {
    this.api.screenAccessMatrix().subscribe({
      next: (rows) => this.matrix.set(rows),
      error: () => this.error.set('Chargement impossible.'),
    });
  }

  protected roleLabel(role: UserRole): string {
    return ROLE_LABELS[role];
  }

  protected roleSigle(role: UserRole): string {
    return ROLE_SIGLE[role];
  }

  protected cellClass(screen: ScreenAccessRow, role: UserRole): string {
    return screen.roles[role].effective ? 'bg-ok-wash' : 'bg-gray-100 text-ink-faint';
  }

  protected changer(screen: ScreenAccessRow, role: UserRole, valeur: string): void {
    const cellKey = `${screen.key}:${role}`;
    this.busyCell.set(cellKey);
    this.error.set(null);
    const override = valeur === '' ? null : (valeur as 'VISIBLE' | 'MASQUE');

    this.api.setScreenAccess(role, screen.key, override).subscribe({
      next: () => {
        this.busyCell.set(null);
        this.charger();
      },
      error: () => {
        this.busyCell.set(null);
        this.error.set(`Échec de l’enregistrement pour ${screen.label} · ${this.roleLabel(role)}.`);
      },
    });
  }
}
