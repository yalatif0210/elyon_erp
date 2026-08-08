import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ApiService,
  AssietteAbsorption,
  Bfr,
  CouvertureBudgetaire,
  MargeCoutVariable,
  PointMort,
  PrevisionVente,
} from '../core/api.service';
import { IconComponent } from '../shared/icon.component';

/**
 * PILOTAGE FINANCIER (§ 14.3, § 14.5, § 14.6).
 *
 * ⚠️ CET ÉCRAN MONTRE CE QU'IL NE SAIT PAS.
 *
 *    Trois valeurs relevaient du CFO et manquaient : taux de financement réel,
 *    budget de charges fixes, prévision de volumes. La tentation était de les
 *    illustrer — 10 % l'an, un budget plausible — pour que l'écran ait l'air
 *    fini. Un point mort affiché sans budget de charges fixes vaut zéro litre,
 *    donc « déjà atteint » : personne ne remet en cause un chiffre qui
 *    s'affiche, et le premier à s'en apercevoir serait le CFO, en réunion.
 *
 *    Les vues refusent donc de calculer et disent pourquoi. Cet écran relaie ce
 *    refus sans le maquiller en tiret.
 *
 * Tout est rattaché à un EXERCICE : un taux sans exercice réécrit le passé à
 * chaque renégociation bancaire.
 */
@Component({
  selector: 'erp-pilotage',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Pilotage financier</h1>
      <p class="page-sub">
        Point mort, besoin en fonds de roulement et écart à la prévision. Les valeurs
        budgétaires se saisissent par exercice — rien n'est calculé sur une valeur devinée.
      </p>
    </header>

    <!-- ============ Ce qui manque, avant tout le reste ============ -->
    @if (manquantes().length > 0) {
      <section class="card mb-5 px-[15px] py-4">
        <div class="mb-2 flex items-center gap-2">
          <erp-icon name="alert-triangle" [size]="16" class="text-warn-ink" />
          <h2 class="text-[13px] font-semibold text-ink">
            Données budgétaires à saisir ({{ manquantes().length }})
          </h2>
        </div>
        <p class="mb-3 text-[12px] leading-relaxed text-ink-soft">
          Ces valeurs relèvent du Directeur Financier. Tant qu'elles manquent, les indicateurs
          qui en dépendent restent muets plutôt que d'afficher un chiffre que personne n'a
          décidé.
        </p>
        <ul class="flex flex-col gap-1.5">
          @for (m of manquantes(); track $index) {
            <li class="flex items-baseline gap-2 text-[12px]">
              <span class="font-mono text-ink-faint">{{ m.exercice }}</span>
              <span class="font-medium text-ink">{{ m.donnee }}</span>
              <span class="text-ink-faint">— sert à {{ m.sert_a }}</span>
            </li>
          }
        </ul>
        <a routerLink="/parametrage" class="link mt-3 inline-block text-[12px]">
          Saisir dans le paramétrage
        </a>
      </section>
    }

    <!-- ============ Point mort (§ 14.5) ============ -->
    @if (pointMort(); as p) {
      <section class="mb-5">
        <div class="mb-2 flex items-center gap-2">
          <erp-icon name="gauge" [size]="15" [class]="p.calculable ? 'text-ok' : 'text-ink-muted'" />
          <h2 class="text-[13px] font-semibold text-ink">Point mort</h2>
          @if (p.exercice) {
            <span class="text-[12px] text-ink-faint">exercice {{ p.exercice }}</span>
          }
        </div>

        @if (!p.calculable) {
          <div class="card px-[15px] py-4">
            <p class="text-[13px] leading-relaxed text-ink-soft">{{ p.motif }}</p>
          </div>
        } @else {
          <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div class="card px-[15px] py-3">
              <p class="text-[11px] uppercase tracking-wide text-ink-muted">Charges fixes</p>
              <p class="mt-0.5 text-[20px] font-semibold leading-none tabular text-ink">
                {{ nombre(p.charges_fixes) }}
              </p>
              <p class="mt-1 text-[11px] text-ink-faint">{{ p.postes_de_charges }} poste(s)</p>
            </div>
            <div class="card px-[15px] py-3">
              <p class="text-[11px] uppercase tracking-wide text-ink-muted">
                Marge sur coût variable
              </p>
              <p class="mt-0.5 text-[20px] font-semibold leading-none tabular text-ink">
                {{ nombre(p.marge_unitaire) }}
              </p>
              <p class="mt-1 text-[11px] text-ink-faint">par unité, pondérée</p>
            </div>
            <div class="card px-[15px] py-3">
              <p class="text-[11px] uppercase tracking-wide text-ink-muted">Point mort</p>
              <p class="mt-0.5 text-[20px] font-semibold leading-none tabular text-ink">
                {{ nombre(p.point_mort_volume) }}
              </p>
              <p class="mt-1 text-[11px] text-ink-faint">en volume, pas en francs</p>
            </div>
            <div class="card px-[15px] py-3" [class.border-warn]="reste(p) > 0">
              <p class="text-[11px] uppercase tracking-wide text-ink-muted">Reste à vendre</p>
              <p class="mt-0.5 text-[20px] font-semibold leading-none tabular"
                 [class]="reste(p) > 0 ? 'text-warn-ink' : 'text-ok'">
                {{ reste(p) > 0 ? nombre(p.reste_a_vendre) : 'atteint' }}
              </p>
              <p class="mt-1 text-[11px] text-ink-faint">
                {{ nombre(p.volume_realise) }} déjà vendus
              </p>
            </div>
          </div>
        }
      </section>
    }

    <!-- ============ Marge sur coût variable par segment ============ -->
    @if (marges().length > 0) {
      <section class="mb-5">
        <div class="mb-2 flex items-center gap-2">
          <erp-icon name="layers" [size]="15" class="text-ink-muted" />
          <h2 class="text-[13px] font-semibold text-ink">Marge sur coût variable par segment</h2>
        </div>
        <p class="mb-2 text-[12px] leading-snug text-ink-faint">
          Marge DIRECTE, sur le réalisé. Les charges indirectes absorbées sont précisément les
          charges fixes qu'on cherche à couvrir : les compter ici les compterait deux fois.
        </p>
        <div class="card overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>Segment</th>
                <th class="num">Affaires</th>
                <th class="num">Volume</th>
                <th class="num">Marge unitaire</th>
              </tr>
            </thead>
            <tbody>
              @for (m of marges(); track m.segment) {
                <tr>
                  <td class="text-ink">{{ m.segment }}</td>
                  <td class="num tabular text-ink-soft">{{ m.affaires }}</td>
                  <td class="num tabular text-ink-soft">
                    {{ nombre(m.volume) }} {{ m.uom }}
                  </td>
                  <td class="num tabular font-medium text-ink">
                    {{ nombre(m.marge_variable_unitaire) }} {{ m.currency_code }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }

    <!-- ============ Besoin en fonds de roulement (§ 14.6) ============ -->
    @if (bfr(); as b) {
      <section class="mb-5">
        <div class="mb-2 flex items-center gap-2">
          <erp-icon name="briefcase" [size]="15" class="text-ink-muted" />
          <h2 class="text-[13px] font-semibold text-ink">Besoin en fonds de roulement</h2>
        </div>
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div class="card px-[15px] py-3">
            <p class="text-[11px] uppercase tracking-wide text-ink-muted">Avances fournisseurs</p>
            <p class="mt-0.5 text-[18px] font-semibold leading-none tabular text-ink">
              {{ nombre(b.avances_fournisseurs) }}
            </p>
            <p class="mt-1 text-[11px] leading-snug text-ink-faint">
              Argent sorti, marchandise non reçue
            </p>
          </div>
          <div class="card px-[15px] py-3">
            <p class="text-[11px] uppercase tracking-wide text-ink-muted">Créances clients</p>
            <p class="mt-0.5 text-[18px] font-semibold leading-none tabular text-ink">
              {{ nombre(b.creances_clients) }}
            </p>
            <p class="mt-1 text-[11px] leading-snug text-ink-faint">Livré, pas encore encaissé</p>
          </div>
          <div class="card px-[15px] py-3">
            <p class="text-[11px] uppercase tracking-wide text-ink-muted">Dettes fournisseurs</p>
            <p class="mt-0.5 text-[18px] font-semibold leading-none tabular text-ink">
              {{ nombre(b.dettes_fournisseurs) }}
            </p>
            <p class="mt-1 text-[11px] leading-snug text-ink-faint">
              Proche de zéro : on paie avant livraison
            </p>
          </div>
          <div class="card px-[15px] py-3">
            <p class="text-[11px] uppercase tracking-wide text-ink-muted">BFR d'exploitation</p>
            <p class="mt-0.5 text-[18px] font-semibold leading-none tabular text-ink">
              {{ nombre(b.bfr_exploitation) }}
            </p>
            <p class="mt-1 text-[11px] leading-snug text-ink-faint">en devise pivot</p>
          </div>
        </div>
        <p class="mt-2 text-[11px] leading-relaxed text-ink-faint">
          {{ b.perimetre }}
          @if (!b.stocks_suivis) {
            Le poste stocks vaut zéro parce qu'aucun module de stock n'existe — c'est une absence,
            pas un stock constaté nul.
          }
        </p>
      </section>
    }

    <!-- ============ Assiette d'absorption (§ 14.2) ============ -->
    @if (assiettes().length > 0) {
      <section class="mb-5">
        <div class="mb-2 flex items-center gap-2">
          <erp-icon name="receipt" [size]="15" class="text-ink-muted" />
          <h2 class="text-[13px] font-semibold text-ink">Assiette d'absorption</h2>
        </div>
        <p class="mb-2 text-[12px] leading-relaxed text-ink-faint">
          La charge fixe unitaire se calcule sur le <strong>volume</strong> prévisionnel, jamais
          sur le chiffre d'affaires : le volume est ce que l'entreprise pilote, le prix suit les
          publications DGH et le change. Une assiette en valeur ferait bouger la charge unitaire à
          chaque publication, sans qu'aucune charge n'ait changé.
        </p>
        <div class="card overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>Pool</th>
                <th class="num">Budget</th>
                <th class="num">Assiette saisie</th>
                <th class="num">Volume prévu</th>
                <th class="num">Écart</th>
                <th class="num">Taux</th>
              </tr>
            </thead>
            <tbody>
              @for (a of assiettes(); track a.pool) {
                <tr>
                  <td>
                    <span class="block text-[13px] text-ink">{{ a.label }}</span>
                    <span class="block font-mono text-[11px] text-ink-faint">{{ a.pool }}</span>
                  </td>
                  <td class="num tabular text-ink-faint">{{ nombre(a.budgeted_amount) }}</td>
                  <td class="num tabular text-ink">
                    {{ nombre(a.assiette_saisie) }} {{ a.assiette_uom }}
                  </td>
                  <td class="num tabular text-ink-soft">
                    {{ a.volume_prevu ? nombre(a.volume_prevu) : 'aucune prévision' }}
                  </td>
                  <td class="num tabular font-medium"
                      [class]="ecartFort(a.ecart_pct) ? 'text-warn-ink' : 'text-ink-faint'">
                    {{ a.ecart_pct === null ? '—' : a.ecart_pct + ' %' }}
                  </td>
                  <td class="num tabular text-ink">{{ nombre(a.rate_per_unit) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="mt-2 text-[11px] leading-relaxed text-ink-faint">
          Un écart n'est pas forcément une erreur : le § 14.2 veut le budget FIGÉ pendant que la
          prévision se révise, sinon la charge unitaire monterait quand l'activité baisse. Un tiret
          signifie qu'aucune prévision ne couvre ce pool — pas que les deux concordent.
        </p>
      </section>
    }

    <!-- ============ Prévision contre réalisé (§ 14.3) ============ -->
    <section class="mb-5">
      <div class="mb-2 flex items-center gap-2">
        <erp-icon name="clipboard-check" [size]="15" class="text-ink-muted" />
        <h2 class="text-[13px] font-semibold text-ink">Prévision contre réalisé</h2>
      </div>
      @if (previsions().length === 0) {
        <div class="card px-[15px] py-3">
          <p class="text-[13px] leading-relaxed text-ink-soft">
            Aucune prévision saisie. Elle se construit par segment, produit et mois — et sert
            d'assiette au taux d'absorption autant que de plan d'approvisionnement.
          </p>
        </div>
      } @else {
        <p class="mb-2 text-[12px] leading-snug text-ink-faint">
          Une révision REMPLACE le budget sur son mois, elle ne s'y ajoute pas. La colonne
          « Prévu » est donc ce qui fait foi aujourd'hui ; « Budget initial » reste affiché à
          côté, parce que l'écart entre les deux dit de combien l'ambition a été revue — et
          qu'une ambition revue à la baisse ne doit pas se lire comme un objectif atteint.
          L'écart de PRIX, lui, est isolé de l'écart de VOLUME : un chiffre d'affaires conforme
          peut cacher du volume perdu, compensé par une hausse que l'entreprise n'a pas décidée.
        </p>
        <div class="card overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>Segment</th>
                <th>Produit</th>
                <th class="num">Budget initial</th>
                <th class="num">Prévu (en vigueur)</th>
                <th class="num">Révision</th>
                <th class="num">Réalisé</th>
                <th class="num">Écart volume</th>
                <th class="num">Écart prix</th>
              </tr>
            </thead>
            <tbody>
              @for (p of previsions(); track $index) {
                <tr>
                  <td class="text-ink">{{ p.segment }}</td>
                  <td class="text-ink-soft">{{ p.produit }}</td>
                  <td class="num tabular text-ink-faint">{{ nombre(p.volume_budget) }}</td>
                  <td class="num tabular text-ink">{{ nombre(p.volume_prevu) }}</td>
                  <td class="num tabular"
                      [class]="signe(p.ecart_revision) < 0 ? 'text-warn-ink' : 'text-ink-faint'">
                    {{ signe(p.ecart_revision) === 0
                       ? '—'
                       : (signe(p.ecart_revision) > 0 ? '+' : '') + nombre(p.ecart_revision) }}
                  </td>
                  <td class="num tabular text-ink">{{ nombre(p.volume_realise) }}</td>
                  <td class="num tabular font-medium"
                      [class]="signe(p.ecart_volume) < 0 ? 'text-crit' : 'text-ok'">
                    {{ signe(p.ecart_volume) > 0 ? '+' : '' }}{{ nombre(p.ecart_volume) }}
                  </td>
                  <td class="num tabular"
                      [class]="signe(p.ecart_prix) < 0 ? 'text-warn-ink' : 'text-ink-soft'">
                    {{ signe(p.ecart_prix) > 0 ? '+' : '' }}{{ nombre(p.ecart_prix) }}
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
export class PilotageComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly couverture = signal<CouvertureBudgetaire[]>([]);
  protected readonly pointMort = signal<PointMort | null>(null);
  protected readonly marges = signal<MargeCoutVariable[]>([]);
  protected readonly bfr = signal<Bfr | null>(null);
  protected readonly previsions = signal<PrevisionVente[]>([]);
  protected readonly assiettes = signal<AssietteAbsorption[]>([]);

  /** Ce qui manque, en tête d'écran : c'est l'action, le reste est la lecture. */
  protected readonly manquantes = computed(() =>
    this.couverture().filter((c) => !c.renseignee),
  );

  ngOnInit(): void {
    const vide = () => undefined;
    this.api.couvertureBudgetaire().subscribe({ next: (r) => this.couverture.set(r), error: vide });
    this.api.margeCoutVariable().subscribe({ next: (r) => this.marges.set(r), error: vide });
    this.api.previsionVente().subscribe({ next: (r) => this.previsions.set(r), error: vide });
    this.api.assietteAbsorption().subscribe({ next: (r) => this.assiettes.set(r), error: vide });
    // Ces deux vues rendent toujours une ligne : on prend la première, et son
    // absence signalerait un défaut de lecture, pas une absence de donnée.
    this.api.pointMort().subscribe({ next: (r) => this.pointMort.set(r[0] ?? null), error: vide });
    this.api.bfr().subscribe({ next: (r) => this.bfr.set(r[0] ?? null), error: vide });
  }

  /** Affichage seulement — la valeur exacte reste celle rendue par la base. */
  protected nombre(v: string | null): string {
    if (v === null || v === '') return '—';
    const n = Number(v);
    if (Number.isNaN(n)) return v;
    return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  }

  protected signe(v: string | null): number {
    return Math.sign(Number(v ?? 0));
  }

  /**
   * Le seuil au-delà duquel l'écart mérite un regard.
   *
   * Dix pour cent : au-delà, l'assiette figée et la prévision courante ne
   * racontent plus la même année. En deçà, c'est le jeu normal des révisions
   * que le § 14.2 assume — le budget reste figé pendant que la prévision bouge.
   */
  protected ecartFort(pct: string | null): boolean {
    return pct !== null && Number(pct) >= 10;
  }

  protected reste(p: PointMort): number {
    return Number(p.reste_a_vendre ?? 0);
  }
}
