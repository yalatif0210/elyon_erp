import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  CrmAlerte,
  CrmConversion,
  CrmEtape,
  CrmPipelineRow,
  PerformanceCommerciale,
} from '../core/api.service';
import { IconComponent } from '../shared/icon.component';
import { dateOnly } from '../shared/format';

/**
 * CRM — PIPELINE COMMERCIAL (§ 15).
 *
 * ⚠️ CE PIPELINE N'EST PAS UN TABLEAU DE SUIVI COMMERCIAL.
 *
 *    Sa valeur pondérée alimente la prévision de vente (§ 14.3), qui fournit
 *    l'assiette du taux d'absorption (§ 14.2), qui entre dans le coût complet,
 *    qui décide du seuil de marge (§ 5.4). Un pipeline optimiste fait donc
 *    BAISSER le coût de revient calculé, et laisse passer des affaires qui ne
 *    couvrent pas leurs frais. C'est pour cela que l'écran confronte la
 *    probabilité affichée à la conversion réellement observée.
 *
 * Les probabilités ne sont pas livrées avec des valeurs par défaut : elles se
 * décident. Tant qu'elles manquent, la valeur pondérée se tait — et l'écran
 * dit combien d'opportunités échappent au total.
 */
@Component({
  selector: 'erp-crm',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Pipeline commercial</h1>
      <p class="page-sub">
        De la prospection à l'affaire signée. La valeur pondérée alimente la prévision de vente —
        elle n'est donc pas qu'un indicateur d'équipe.
      </p>
    </header>

    <!-- ============ Ce qui attend une action ============ -->
    @if (alertes().length > 0) {
      <section class="card mb-5 px-[15px] py-4">
        <div class="mb-2 flex items-center gap-2">
          <erp-icon name="clock" [size]="16" [class]="enRetard() > 0 ? 'text-crit' : 'text-warn-ink'" />
          <h2 class="text-[13px] font-semibold text-ink">
            Relances et actions ({{ alertes().length }})
          </h2>
          @if (enRetard() > 0) {
            <span class="text-[12px] font-medium text-crit">{{ enRetard() }} en retard</span>
          }
        </div>
        <div class="flex flex-col gap-1.5">
          @for (a of alertes().slice(0, 12); track $index) {
            <div class="flex items-baseline gap-2 text-[12px]">
              <span class="font-mono text-ink-faint">{{ a.reference }}</span>
              <span class="min-w-0 flex-1 truncate text-ink">{{ a.objet }}</span>
              <span class="truncate text-ink-soft">{{ a.action }}</span>
              <span class="shrink-0 font-medium"
                    [class]="a.retard_jours > 0 ? 'text-crit' : 'text-ink-faint'">
                {{ echeance(a) }}
              </span>
            </div>
          }
        </div>
        @if (alertes().length > 12) {
          <p class="mt-2 text-[11px] text-ink-faint">
            et {{ alertes().length - 12 }} autres — la file de tâches les porte toutes.
          </p>
        }
      </section>
    }

    <!-- ============ Le pipeline par étape ============ -->
    <section class="mb-5">
      <div class="mb-2 flex items-center gap-2">
        <erp-icon name="layers" [size]="15" class="text-ink-muted" />
        <h2 class="text-[13px] font-semibold text-ink">Pipeline par étape</h2>
      </div>

      @if (sansProbabilite() > 0) {
        <p class="mb-2 text-[12px] leading-relaxed text-warn-ink">
          {{ sansProbabilite() }} opportunité(s) n'entrent pas dans la valeur pondérée : la
          probabilité de leur étape n'a pas été décidée. Elle se saisit dans le paramétrage —
          laissée vide, le total serait partiel sans le dire.
        </p>
      }

      <div class="card overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>Étape</th>
              <th class="num">Probabilité</th>
              <th class="num">Opportunités</th>
              <th class="num">CA prévisionnel</th>
              <th class="num">Valeur pondérée</th>
              <th class="num">Actions en retard</th>
            </tr>
          </thead>
          <tbody>
            @for (e of etapes(); track e.etape_code) {
              <tr>
                <td>
                  <span class="text-[13px] text-ink">{{ e.etape }}</span>
                  @if (e.issue !== 'OPEN') {
                    <span class="ml-1.5 text-[11px] uppercase tracking-wide text-ink-faint">
                      {{ issueLibelle(e.issue) }}
                    </span>
                  }
                </td>
                <td class="num tabular"
                    [class]="e.probabilite === null ? 'text-warn-ink' : 'text-ink-soft'">
                  {{ e.probabilite === null ? 'à décider' : e.probabilite + ' %' }}
                </td>
                <td class="num tabular text-ink">{{ e.opportunites }}</td>
                <td class="num tabular text-ink-soft">{{ nombre(e.ca_previsionnel) }}</td>
                <td class="num tabular font-medium text-ink">
                  {{ e.valeur_ponderee === null ? '—' : nombre(e.valeur_ponderee) }}
                  @if (nombreBrut(e.sans_probabilite) > 0) {
                    <span class="ml-1 text-[11px] font-normal text-warn-ink">
                      ({{ e.sans_probabilite }} hors total)
                    </span>
                  }
                </td>
                <td class="num tabular"
                    [class]="nombreBrut(e.actions_en_retard) > 0 ? 'text-crit' : 'text-ink-faint'">
                  {{ e.actions_en_retard }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    <!-- ============ Probabilité affichée contre conversion observée ============ -->
    @if (conversions().length > 0) {
      <section class="mb-5">
        <div class="mb-2 flex items-center gap-2">
          <erp-icon name="gauge" [size]="15" class="text-ink-muted" />
          <h2 class="text-[13px] font-semibold text-ink">
            Probabilité annoncée contre conversion observée
          </h2>
        </div>
        <p class="mb-2 text-[12px] leading-relaxed text-ink-faint">
          Le seul moyen de savoir si les probabilités sont honnêtes. Une étape qui annonce 70 % et
          convertit à 30 % ne se corrige pas d'elle-même — et son optimisme se propage jusqu'au
          coût de revient. Calculé sur les seules affaires tranchées.
        </p>
        <div class="card overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>Étape</th>
                <th class="num">Annoncée</th>
                <th class="num">Observée</th>
                <th class="num">Passées</th>
                <th class="num">Gagnées</th>
                <th class="num">Perdues</th>
                <th class="num">Ouvertes</th>
              </tr>
            </thead>
            <tbody>
              @for (c of conversions(); track c.etape_code) {
                <tr>
                  <td class="text-ink">{{ c.etape }}</td>
                  <td class="num tabular text-ink-faint">
                    {{ c.probabilite_affichee === null ? '—' : c.probabilite_affichee + ' %' }}
                  </td>
                  <td class="num tabular font-medium"
                      [class]="teinteEcart(c)">
                    {{ c.conversion_observee_pct === null
                       ? 'pas assez de recul'
                       : c.conversion_observee_pct + ' %' }}
                  </td>
                  <td class="num tabular text-ink-soft">{{ c.passees_par_ici }}</td>
                  <td class="num tabular text-ok">{{ c.gagnees }}</td>
                  <td class="num tabular text-ink-soft">{{ c.perdues }}</td>
                  <td class="num tabular text-ink-faint">{{ c.encore_ouvertes }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }

    <!-- ============ Performance par commercial (§ 16) ============ -->
    @if (performances().length > 0) {
      <section class="mb-5">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <erp-icon name="users" [size]="15" class="text-ink-muted" />
          <h2 class="text-[13px] font-semibold text-ink">Performance par commercial</h2>

          <!-- Le sélecteur est à côté du titre, pas en haut d'écran : il ne
               gouverne QUE ce tableau. Placé ailleurs, on croirait qu'il
               s'applique au pipeline au-dessus, qui est un état courant et
               n'a pas de période. -->
          <div class="ml-auto flex items-center gap-2">
            <select class="field h-7 py-0 text-[12px]" [(ngModel)]="periode" (change)="relire()">
              @for (p of PERIODES; track p.code) {
                <option [ngValue]="p.code">{{ p.label }}</option>
              }
            </select>
            <input
              type="date"
              class="field h-7 w-[150px] py-0 text-[12px]"
              [(ngModel)]="ancre"
              (change)="relire()"
              title="Un jour DANS la période voulue — le trimestre du 15 mai, par exemple"
            />
          </div>
        </div>

        @if (performances()[0]; as p) {
          <p class="mb-2 text-[12px] text-ink-faint">
            Période retenue : <strong class="text-ink-soft">{{ p.periode_origine }}</strong>
            — du {{ jour(p.periode_debut) }} au {{ jour(p.periode_fin) }}.
            @if (enCours(p)) {
              <span class="text-warn-ink">Période non close : les chiffres sont partiels.</span>
            }
          </p>
        }
        <p class="mb-2 text-[12px] leading-relaxed text-ink-faint">
          Trois familles de chiffres, et on ne les confond pas : ce qui est <strong>espéré</strong>
          — le pipeline, qui repose sur des probabilités déclarées —, ce qui est
          <strong>signé</strong>, qui ne repose sur aucune hypothèse, et <strong>à quel prix</strong>
          c'est signé. Un commercial qui remplit son pipeline sans rien signer et un autre qui
          signe tout au ras du seuil ont tous deux un problème ; un chiffre unique les
          confondrait.
        </p>
        <div class="card overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>Commercial</th>
                <th class="num">Opportunités</th>
                <th class="num">CA prévisionnel</th>
                <th class="num">Pondéré</th>
                <th class="num">Conversion</th>
                <th class="num">Affaires</th>
                <th class="num">Chiffre d'affaires</th>
                <th class="num">Marge moyenne</th>
                <th class="num">Dans la bande</th>
              </tr>
            </thead>
            <tbody>
              @for (p of performances(); track p.owner_id) {
                <tr>
                  <td>
                    <span class="block text-[13px] text-ink">{{ p.commercial }}</span>
                    @if (nombreBrut(p.actions_en_retard) > 0) {
                      <span class="block text-[11px] font-medium text-crit">
                        {{ p.actions_en_retard }} action(s) en retard
                      </span>
                    }
                  </td>
                  <td class="num tabular text-ink-soft">{{ p.opportunites_ouvertes }}</td>
                  <td class="num tabular text-ink-faint">{{ nombre(p.ca_previsionnel) }}</td>
                  <td class="num tabular text-ink">
                    {{ p.valeur_ponderee === null ? '—' : nombre(p.valeur_ponderee) }}
                    @if (nombreBrut(p.sans_probabilite) > 0) {
                      <span class="ml-1 text-[11px] font-normal text-warn-ink">
                        ({{ p.sans_probabilite }} hors total)
                      </span>
                    }
                  </td>
                  <td class="num tabular font-medium text-ink">
                    {{ p.conversion_pct === null ? 'pas de recul' : p.conversion_pct + ' %' }}
                    <span class="block text-[11px] font-normal text-ink-faint">
                      {{ p.gagnees }} gagnée(s) · {{ p.perdues }} perdue(s)
                    </span>
                  </td>
                  <td class="num tabular text-ink">{{ p.affaires }}</td>
                  <td class="num tabular text-ink">{{ nombre(p.chiffre_affaires) }}</td>
                  <td class="num tabular text-ink-soft">
                    {{ p.marge_unitaire_moyenne === null ? '—' : nombre(p.marge_unitaire_moyenne) }}
                  </td>
                  <!-- La part dans la bande est le signal qui compte : une affaire
                       à 31 est banale, un vendeur dont tout atterrit à 31 ne l'est
                       pas. -->
                  <td class="num tabular font-medium" [class]="teinteBande(p.part_dans_la_bande_pct)">
                    {{ p.part_dans_la_bande_pct === null
                       ? '—'
                       : p.affaires_dans_la_bande + ' (' + p.part_dans_la_bande_pct + ' %)' }}
                    @if (nombreBrut(p.affaires_sur_derogation) > 0) {
                      <span class="block text-[11px] font-normal text-warn-ink">
                        dont {{ p.affaires_sur_derogation }} sur dérogation
                      </span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }

    <!-- ============ Les opportunités ouvertes ============ -->
    <section class="mb-5">
      <div class="mb-2 flex items-center gap-2">
        <erp-icon name="briefcase" [size]="15" class="text-ink-muted" />
        <h2 class="text-[13px] font-semibold text-ink">Opportunités ouvertes</h2>
        <span class="text-[12px] text-ink-faint">({{ pipeline().length }})</span>
      </div>

      @if (pipeline().length === 0) {
        <div class="card px-[15px] py-4">
          <p class="text-[13px] leading-relaxed text-ink-soft">
            Aucune opportunité ouverte. Le pipeline se remplit depuis les prospects du
            référentiel Tiers — chaque opportunité porte une prochaine action et sa date, sans
            quoi elle dort jusqu'à ce qu'on la retrouve par hasard.
          </p>
        </div>
      } @else {
        <div class="card overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>Référence</th>
                <th>Objet</th>
                <th>Client</th>
                <th>Étape</th>
                <th class="num">CA prévisionnel</th>
                <th class="num">Pondérée</th>
                <th>Prochaine action</th>
              </tr>
            </thead>
            <tbody>
              @for (o of pipeline(); track o.id) {
                <tr>
                  <td class="ref">{{ o.reference }}</td>
                  <td class="text-ink">{{ o.title }}</td>
                  <td class="text-ink-soft">{{ o.client }}</td>
                  <td class="text-[12px] text-ink-soft">{{ o.etape }}</td>
                  <td class="num tabular text-ink-soft">{{ nombre(o.ca_previsionnel) }}</td>
                  <td class="num tabular text-ink">
                    {{ o.valeur_ponderee === null ? '—' : nombre(o.valeur_ponderee) }}
                  </td>
                  <td>
                    <span class="block truncate text-[12px] text-ink">{{ o.next_action }}</span>
                    <span class="block text-[11px]"
                          [class]="o.action_en_retard ? 'text-crit font-medium' : 'text-ink-faint'">
                      {{ jour(o.next_action_due) }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
})
export class CrmComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly pipeline = signal<CrmPipelineRow[]>([]);
  protected readonly etapes = signal<CrmEtape[]>([]);
  protected readonly alertes = signal<CrmAlerte[]>([]);
  protected readonly conversions = signal<CrmConversion[]>([]);
  protected readonly performances = signal<PerformanceCommerciale[]>([]);

  /**
   * Les cinq découpages, dans l'ordre du plus fin au plus large.
   *
   * Les bornes ne sont PAS calculées ici : l'écran envoie le nom du découpage,
   * la base rend les dates. Un trimestre calculé côté écran et un trimestre
   * calculé en SQL finiraient par diverger — sur un exercice décalé, ou sur un
   * fuseau.
   */
  protected readonly PERIODES = [
    { code: 'MOIS', label: 'Mois' },
    { code: 'TRIMESTRE', label: 'Trimestre' },
    { code: 'SEMESTRE', label: 'Semestre' },
    { code: 'ANNEE_CIVILE', label: 'Année civile' },
    { code: 'EXERCICE', label: 'Exercice comptable' },
  ];

  /** Vide = période par défaut, que la base choisit et renvoie. */
  protected periode = '';
  protected ancre = new Date().toISOString().slice(0, 10);

  protected readonly enRetard = computed(
    () => this.alertes().filter((a) => a.retard_jours > 0).length,
  );

  /** Combien d'opportunités échappent au total pondéré, toutes étapes confondues. */
  protected readonly sansProbabilite = computed(() =>
    this.etapes().reduce((n, e) => n + Number(e.sans_probabilite ?? 0), 0),
  );

  ngOnInit(): void {
    const vide = () => undefined;
    this.api.crmPipeline(true).subscribe({ next: (r) => this.pipeline.set(r), error: vide });
    this.api.crmParEtape().subscribe({ next: (r) => this.etapes.set(r), error: vide });
    this.api.crmAlertes().subscribe({ next: (r) => this.alertes.set(r), error: vide });
    this.api.crmConversion().subscribe({ next: (r) => this.conversions.set(r), error: vide });
    // Repli silencieux : un rôle sans accès à la performance garde le reste
    // de l'écran plutôt que de perdre le pipeline entier.
    this.relire();
  }

  protected nombre(v: string | null): string {
    if (v === null || v === '') return '—';
    const n = Number(v);
    return Number.isNaN(n) ? v : n.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  }

  protected nombreBrut(v: string | null): number {
    return Number(v ?? 0);
  }

  protected jour(iso: string | null): string {
    return iso ? dateOnly(iso) : '—';
  }

  protected echeance(a: CrmAlerte): string {
    if (a.retard_jours > 0) return `${a.retard_jours} j de retard`;
    return dateOnly(a.echeance);
  }

  /**
   * Un vendeur dont une affaire sur deux effleure le seuil.
   *
   * Le seuil de teinte porte sur la PART, pas sur le nombre : trois affaires
   * dans la bande sur trois est un motif, trois sur quarante ne l'est pas.
   */
  protected relire(): void {
    this.api.performanceCommerciale(this.periode || undefined, this.ancre || undefined).subscribe({
      next: (r) => this.performances.set(r),
      // Repli silencieux : un rôle sans accès garde le reste de l'écran.
      error: () => this.performances.set([]),
    });
  }

  protected enCours(p: PerformanceCommerciale): boolean {
    return new Date(p.periode_fin) > new Date();
  }

  protected teinteBande(part: string | null): string {
    if (part === null) return 'text-ink-faint';
    const n = Number(part);
    if (n >= 50) return 'text-crit';
    if (n >= 25) return 'text-warn-ink';
    return 'text-ink-soft';
  }

  protected issueLibelle(issue: string): string {
    return issue === 'WON' ? 'gagnée' : issue === 'LOST' ? 'perdue' : 'en veille';
  }

  /**
   * Rouge quand l'observé est nettement SOUS l'annoncé.
   *
   * Le sens compte : convertir mieux qu'annoncé est une bonne nouvelle qui
   * mérite qu'on relève la probabilité, pas une alerte. Convertir moins gonfle
   * la prévision, donc l'assiette d'absorption, donc fausse le coût de revient.
   */
  protected teinteEcart(c: CrmConversion): string {
    if (c.conversion_observee_pct === null || c.probabilite_affichee === null) {
      return 'text-ink-faint';
    }
    const ecart = Number(c.probabilite_affichee) - Number(c.conversion_observee_pct);
    if (ecart >= 20) return 'text-crit';
    if (ecart >= 10) return 'text-warn-ink';
    return 'text-ink';
  }
}
