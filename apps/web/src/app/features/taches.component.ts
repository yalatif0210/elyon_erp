import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, CompteurTaches, Tache } from '../core/api.service';
import { IconComponent } from '../shared/icon.component';

/**
 * MA FILE DE TÂCHES — ce que je dois traiter (§ 3).
 *
 * L'application est pleine de verrous et d'arbitrages : une affaire attend le
 * CFO, une checklist attend le contrôleur HSE, un prix fournisseur attend le
 * DG. Rien ne le DISAIT — chacun devait ouvrir son écran et chercher, et ce
 * qu'on ne cherche pas, on ne le trouve pas.
 *
 * ⚠️ IL N'Y A RIEN À MARQUER COMME LU, et c'est délibéré.
 *
 *    Les tâches sont DÉRIVÉES de l'état : une tâche existe tant que sa cause
 *    existe, et disparaît d'elle-même dès qu'on l'a traitée. Une file qu'on
 *    acquitte à la main finit par annoncer des choses déjà faites — et une
 *    file qu'on ne croit plus est pire que pas de file du tout.
 *
 * Trois natures, dans cet ordre, et l'ordre est le message :
 *
 *   BLOQUANT   quelqu'un est arrêté tant que ce n'est pas traité.
 *   ANOMALIE   c'est déjà passé, et il faut le regarder.
 *   À VENIR    rien n'est bloqué aujourd'hui, tout le sera bientôt.
 */
@Component({
  selector: 'erp-taches',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <header class="mb-5">
      <h1 class="page-title">Ce que j'ai à traiter</h1>
      <p class="page-sub">
        Établi à partir de l'état réel de l'application. Une tâche disparaît d'elle-même dès
        qu'elle est traitée : il n'y a rien à cocher.
      </p>
    </header>

    @if (compteur(); as c) {
      <!-- ============ Le décompte ============
           L'ancienneté en premier : un total de trois tâches dont la plus
           vieille date de trois semaines est plus grave qu'un total de trente
           arrivées ce matin. -->
      <div class="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div class="card px-[15px] py-3" [class.border-crit]="c.bloquantes > 0">
          <p class="text-[11px] uppercase tracking-wide text-ink-muted">Bloquantes</p>
          <p class="mt-0.5 text-[26px] font-semibold leading-none tabular"
             [class]="c.bloquantes > 0 ? 'text-crit' : 'text-ink'">{{ c.bloquantes }}</p>
          <p class="mt-1 text-[11px] leading-snug text-ink-faint">Quelqu'un est arrêté</p>
        </div>
        <div class="card px-[15px] py-3">
          <p class="text-[11px] uppercase tracking-wide text-ink-muted">Anomalies</p>
          <p class="mt-0.5 text-[26px] font-semibold leading-none tabular"
             [class]="c.anomalies > 0 ? 'text-warn-ink' : 'text-ink'">{{ c.anomalies }}</p>
          <p class="mt-1 text-[11px] leading-snug text-ink-faint">Déjà passé, à regarder</p>
        </div>
        <div class="card px-[15px] py-3">
          <p class="text-[11px] uppercase tracking-wide text-ink-muted">À venir</p>
          <p class="mt-0.5 text-[26px] font-semibold leading-none tabular text-ink">{{ c.aVenir }}</p>
          <p class="mt-1 text-[11px] leading-snug text-ink-faint">Rien n'est bloqué aujourd'hui</p>
        </div>
        <div class="card px-[15px] py-3">
          <p class="text-[11px] uppercase tracking-wide text-ink-muted">La plus ancienne</p>
          <p class="mt-0.5 text-[18px] font-semibold leading-tight text-ink">
            {{ c.plusAncienne ? attente(c.plusAncienne) : '-' }}
          </p>
          <p class="mt-1 text-[11px] leading-snug text-ink-faint">
            {{ c.plusAncienne ? 'que quelqu’un attend' : 'rien en attente' }}
          </p>
        </div>
      </div>
    }

    @if (chargement()) {
      <p class="text-[13px] text-ink-muted">Lecture…</p>
    } @else if (taches().length === 0) {
      <div class="card flex items-center gap-2.5 px-[15px] py-4">
        <erp-icon name="check-circle" [size]="18" class="text-ok" />
        <p class="text-[13px] leading-relaxed text-ink-soft">
          Rien ne vous attend. Cet écran se remplit tout seul dès qu'un arbitrage, une échéance
          ou une anomalie vous revient.
        </p>
      </div>
    } @else {
      @for (groupe of groupes(); track groupe.urgence) {
        <section class="mb-5">
          <div class="mb-2 flex items-center gap-2">
            <erp-icon [name]="icone(groupe.urgence)" [size]="15" [class]="teinte(groupe.urgence)" />
            <h2 class="text-[13px] font-semibold text-ink">{{ intitule(groupe.urgence) }}</h2>
            <span class="text-[12px] text-ink-faint">({{ groupe.lignes.length }})</span>
          </div>

          <div class="card overflow-hidden">
            @for (t of groupe.lignes; track $index) {
              <a
                [routerLink]="'/' + t.lien"
                class="flex items-start gap-3 border-b border-rule px-[15px] py-3 transition-colors
                       last:border-b-0 hover:bg-gray-100"
              >
                <span
                  class="mt-0.5 w-[3px] shrink-0 self-stretch rounded-full"
                  [class]="barre(t.urgence)"
                ></span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[13px] font-medium text-ink">{{ t.objet }}</span>
                  <span class="block text-[12px] leading-snug text-ink-soft">{{ t.libelle }}</span>
                </span>
                <span class="shrink-0 text-right">
                  <span class="block text-[11px] text-ink-faint">{{ attente(t.depuis) }}</span>
                  <span class="block text-[10px] uppercase tracking-wide text-ink-faint">
                    {{ t.categorie.replaceAll('_', ' ').toLowerCase() }}
                  </span>
                </span>
              </a>
            }
          </div>
        </section>
      }
    }
  `,
})
export class TachesComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly taches = signal<Tache[]>([]);
  protected readonly compteur = signal<CompteurTaches | null>(null);
  protected readonly chargement = signal(true);

  /**
   * Groupées par nature, dans l'ordre où elles comptent.
   *
   * Le serveur les rend déjà triées — on ne retrie pas, on regroupe : un tri
   * refait ici finirait par diverger de celui qui fait autorité.
   */
  protected readonly groupes = computed(() => {
    const ordre: Tache['urgence'][] = ['BLOQUANT', 'ANOMALIE', 'A_VENIR'];
    return ordre
      .map((urgence) => ({ urgence, lignes: this.taches().filter((t) => t.urgence === urgence) }))
      .filter((g) => g.lignes.length > 0);
  });

  ngOnInit(): void {
    this.api.compteurTaches().subscribe((c) => this.compteur.set(c));
    this.api.taches().subscribe({
      next: (t) => {
        this.taches.set(t);
        this.chargement.set(false);
      },
      error: () => this.chargement.set(false),
    });
  }

  /**
   * Depuis combien de temps ça attend, en clair.
   *
   * Une date brute ne dit rien : « 02/08 » oblige à calculer de tête. « depuis
   * 5 jours » se lit.
   */
  protected attente(iso: string): string {
    const jours = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (jours <= 0) return "aujourd'hui";
    if (jours === 1) return 'hier';
    if (jours < 31) return `depuis ${jours} jours`;
    const mois = Math.floor(jours / 30);
    return `depuis ${mois} mois`;
  }

  protected intitule(u: Tache['urgence']): string {
    return u === 'BLOQUANT'
      ? 'Bloquant : quelqu’un attend'
      : u === 'ANOMALIE'
        ? 'Anomalies : déjà passé'
        : 'À venir';
  }

  // Icône ET libellé, jamais la seule couleur (§ 17.2).
  protected icone(u: Tache['urgence']): 'lock' | 'alert-triangle' | 'clock' {
    return u === 'BLOQUANT' ? 'lock' : u === 'ANOMALIE' ? 'alert-triangle' : 'clock';
  }

  protected teinte(u: Tache['urgence']): string {
    return u === 'BLOQUANT' ? 'text-crit' : u === 'ANOMALIE' ? 'text-warn-ink' : 'text-ink-muted';
  }

  protected barre(u: Tache['urgence']): string {
    return u === 'BLOQUANT' ? 'bg-crit' : u === 'ANOMALIE' ? 'bg-warn' : 'bg-rule-strong';
  }
}
