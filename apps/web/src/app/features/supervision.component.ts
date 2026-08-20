import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ApiService,
  CreditExposureRow,
  InvariantBreach,
  MarginBandOwnerRow,
  MarginBandRow,
  MarginVarianceRow,
  OutstandingAdvanceRow,
  ParametreRequis,
} from '../core/api.service';
import { IconComponent } from '../shared/icon.component';
import { TableauControlesComponent, TableauPagine } from '../shared/tableau';
import { dateOnly, grouper } from '../shared/format';

/**
 * SURVEILLANCE (§ 5.4, § 9.1, § 11, § 14.6).
 *
 * Le moteur calculait déjà tout cela : huit routes d'analyse existaient côté
 * serveur, dont UNE SEULE était consommée par un écran. Les sept autres
 * répondaient 200 à personne.
 *
 * Pire, la file de tâches renvoyait ici pour les écarts d'invariant, et la
 * route `/supervision` n'existait pas : le lien retombait en silence sur le
 * tableau de bord. Ça ne se voyait pas — `v_invariant_breaches` est vide — et
 * ça se serait vu le jour où elle ne l'est plus, c'est-à-dire au pire moment.
 *
 * ⚠️ CET ÉCRAN NE CALCULE RIEN.
 *
 *    Tout vient de vues PostgreSQL. Refaire ici le moindre calcul le ferait
 *    diverger de la règle réellement appliquée en base — et c'est la version
 *    affichée qu'on croirait.
 *
 * Les seuils empêchent de vendre trop bas. Ils n'empêchent PAS de se placer
 * juste au-dessus : c'est l'autre menace, celle qu'aucun plancher n'arrête.
 */
@Component({
  selector: 'erp-supervision',
  standalone: true,
  imports: [RouterLink, IconComponent, TableauControlesComponent],
  template: `
    <header class="mb-6">
      <h1 class="page-title">Surveillance</h1>
      <p class="page-sub">
        Ce que les verrous ne peuvent pas arrêter : le placement juste au-dessus du seuil, l'écart
        entre marge promise et marge réalisée, la trésorerie immobilisée. Tout est lu à la source,
        rien n'est recalculé ici.
      </p>
    </header>

    <!-- ================= Santé des invariants (§ 11) ================= -->
    <section class="mb-5">
      <div class="mb-2 flex items-center gap-2">
        <erp-icon
          [name]="invariants().length === 0 ? 'check-circle' : 'alert-triangle'"
          [size]="15"
          [class]="invariants().length === 0 ? 'text-ok' : 'text-crit'"
        />
        <h2 class="text-[13px] font-semibold text-ink">Invariants</h2>
      </div>

      @if (chargement()) {
        <p class="text-[13px] text-ink-muted">Lecture…</p>
      } @else if (invariants().length === 0) {
        <div class="card px-[15px] py-4">
          <p class="text-[13px] leading-relaxed text-ink-soft">
            Aucun écart. Cette liste doit rester vide : toute ligne y est une règle métier que des
            données violent déjà, et qu'aucun verrou n'a pu arrêter parce qu'elles étaient là
            avant lui.
          </p>
        </div>
      } @else {
        <div class="card overflow-hidden">
          <erp-tableau-controles [tableau]="fInvariants" libelle="les écarts" />
          <div class="overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>Règle enfreinte</th>
                <th>Relation</th>
                <th>Enregistrement</th>
                <th>Détail</th>
              </tr>
            </thead>
            <tbody>
              @for (b of fInvariants.lignes(); track $index) {
                <tr>
                  <td class="font-medium text-crit">{{ b.regle }}</td>
                  <td class="font-mono text-[12px] text-ink-muted">{{ b.relation }}</td>
                  <td class="font-mono text-[12px] text-ink-soft">{{ b.enregistrement }}</td>
                  <td class="text-ink-soft">{{ b.detail }}</td>
                </tr>
              }
            </tbody>
          </table>
          </div>
        </div>
      }
    </section>

    <!-- ================= Paramètres dont les verrous dépendent ================= -->
    <section class="mb-5">
      <div class="mb-2 flex items-center gap-2">
        <erp-icon name="gauge" [size]="15" class="text-ink-muted" />
        <h2 class="text-[13px] font-semibold text-ink">Paramètres dont les verrous dépendent</h2>
      </div>
      <p class="mb-2 text-[12px] leading-snug text-ink-faint">
        Ce qui est paramétrable est supprimable. Un paramètre absent ne fait pas échouer le
        contrôle : il le fait tourner sur sa valeur de secours, que personne n'a choisie. La liste
        est établie automatiquement, pas tenue à la main.
      </p>
      <div class="card overflow-x-auto">
        <erp-tableau-controles [tableau]="fParametres" libelle="les paramètres" />
        <table class="table">
          <thead>
            <tr>
              <th>Paramètre</th>
              <th>Valeur</th>
              <th class="num">Lu par</th>
              <th>Où</th>
              <th>État</th>
            </tr>
          </thead>
          <tbody>
            @for (p of fParametres.lignes(); track p.parametre) {
              <tr>
                <td class="font-mono text-[12px] text-ink">{{ p.parametre }}</td>
                <td class="tabular text-ink-soft">{{ p.valeur ?? '-' }}</td>
                <td class="num tabular text-ink-soft">{{ p.lu_par }}</td>
                <td class="text-[12px] text-ink-faint">{{ p.objets }}</td>
                <td>
                  <span [class]="p.present ? 'text-ok' : 'text-crit font-medium'">
                    {{ p.present ? 'défini' : 'ABSENT, repli en vigueur' }}
                  </span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    <!-- ================= Bande de marge (§ 5.4) ================= -->
    <section class="mb-5">
      <div class="mb-2 flex items-center gap-2">
        <erp-icon name="alert-triangle" [size]="15" class="text-warn-ink" />
        <h2 class="text-[13px] font-semibold text-ink">Affaires effleurant le seuil</h2>
        <span class="text-[12px] text-ink-faint">({{ bande().length }})</span>
      </div>
      <p class="mb-2 text-[12px] leading-snug text-ink-faint">
        Une affaire juste au-dessus du seuil minimum n'est pas anormale. Un commercial dont toutes
        les affaires y atterrissent l'est : c'est le tableau suivant qui le dit.
      </p>
      @if (bande().length === 0) {
        <div class="card px-[15px] py-3">
          <p class="text-[13px] text-ink-soft">Aucune affaire dans la bande de surveillance.</p>
        </div>
      } @else {
        <div class="card overflow-x-auto">
          <erp-tableau-controles [tableau]="fBande" libelle="les affaires" />
          <table class="table">
            <thead>
              <tr>
                <th>Affaire</th>
                <th>Client</th>
                <th>Commercial</th>
                <th class="num">Marge</th>
                <th class="num">Seuil</th>
                <th class="num">Au-dessus de</th>
              </tr>
            </thead>
            <tbody>
              @for (d of fBande.lignes(); track d.reference) {
                <tr>
                  <td>
                    <a class="ref hover:underline"
                       [routerLink]="['/affaires']">{{ d.reference }}</a>
                  </td>
                  <td class="text-ink-soft">{{ d.client }}</td>
                  <td class="text-ink-soft">{{ d.owner ?? '-' }}</td>
                  <td class="num tabular text-ink">{{ nombre(d.estimated_full_margin) }}</td>
                  <td class="num tabular text-ink-faint">{{ nombre(d.minimum_margin) }}</td>
                  <td class="num tabular font-medium text-warn-ink">
                    +{{ nombre(d.above_threshold) }} ({{ d.above_threshold_pct }} %)
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>

    <!-- ================= Concentration par commercial ================= -->
    @if (parCommercial().length > 0) {
      <section class="mb-5">
        <div class="mb-2 flex items-center gap-2">
          <erp-icon name="users" [size]="15" class="text-ink-muted" />
          <h2 class="text-[13px] font-semibold text-ink">Concentration par commercial</h2>
        </div>
        <div class="card overflow-x-auto">
          <erp-tableau-controles [tableau]="fParCommercial" libelle="les commerciaux" />
          <table class="table">
            <thead>
              <tr>
                <th>Commercial</th>
                <th class="num">Dans la bande</th>
                <th class="num">Total</th>
                <th class="num">Part</th>
                <th class="num">Écart moyen au seuil</th>
              </tr>
            </thead>
            <tbody>
              @for (o of fParCommercial.lignes(); track $index) {
                <tr>
                  <td class="text-ink">{{ o.owner ?? '-' }}</td>
                  <td class="num tabular text-ink-soft">{{ o.deals_in_band }}</td>
                  <td class="num tabular text-ink-faint">{{ o.deals_total }}</td>
                  <td class="num tabular font-medium"
                      [class]="alerte(o.band_share_pct) ? 'text-crit' : 'text-ink'">
                    {{ o.band_share_pct }} %
                  </td>
                  <td class="num tabular text-ink-soft">{{ o.avg_above_threshold_pct }} %</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }

    <!-- ================= Marge promise contre marge réalisée ================= -->
    <section class="mb-5">
      <div class="mb-2 flex items-center gap-2">
        <erp-icon name="layers" [size]="15" class="text-ink-muted" />
        <h2 class="text-[13px] font-semibold text-ink">Marge approuvée contre marge réalisée</h2>
        <span class="text-[12px] text-ink-faint">({{ ecarts().length }})</span>
      </div>
      <p class="mb-2 text-[12px] leading-snug text-ink-faint">
        Dans les deux sens : une affaire qui rapporte bien plus que promis mérite autant d'être
        regardée qu'une qui rapporte moins. Le seuil de déclenchement est paramétrable.
      </p>
      @if (ecarts().length === 0) {
        <div class="card px-[15px] py-3">
          <p class="text-[13px] text-ink-soft">
            Aucun écart au-delà du seuil. Il faut des affaires clôturées pour que cette liste se
            remplisse.
          </p>
        </div>
      } @else {
        <div class="card overflow-x-auto">
          <erp-tableau-controles [tableau]="fEcarts" libelle="les écarts" />
          <table class="table">
            <thead>
              <tr>
                <th>Affaire</th>
                <th>Client</th>
                <th>Commercial</th>
                <th class="num">Approuvée</th>
                <th class="num">Réalisée</th>
                <th class="num">Écart</th>
                <th class="num">Clôturée</th>
              </tr>
            </thead>
            <tbody>
              @for (v of fEcarts.lignes(); track v.reference) {
                <tr>
                  <td class="font-mono text-[12px] text-ink">{{ v.reference }}</td>
                  <td class="text-ink-soft">{{ v.client }}</td>
                  <td class="text-ink-soft">{{ v.owner ?? '-' }}</td>
                  <td class="num tabular text-ink-faint">{{ nombre(v.estimated_full_margin) }}</td>
                  <td class="num tabular text-ink">{{ nombre(v.realized_full_margin) }}</td>
                  <td class="num tabular font-medium"
                      [class]="signe(v.variance) < 0 ? 'text-crit' : 'text-ok'">
                    {{ signe(v.variance) > 0 ? '+' : '' }}{{ nombre(v.variance) }}
                    ({{ v.variance_pct }} %)
                  </td>
                  <td class="num text-ink-faint">{{ jour(v.closed_at) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>

    <!-- ================= En-cours crédit (§ 9.1) ================= -->
    <section class="mb-5">
      <div class="mb-2 flex items-center gap-2">
        <erp-icon name="briefcase" [size]="15" class="text-ink-muted" />
        <h2 class="text-[13px] font-semibold text-ink">En-cours crédit par client</h2>
      </div>
      <p class="mb-2 text-[12px] leading-snug text-ink-faint">
        Source unique du contrôle de crédit, en francs CFA. L'engagement comprend les créances
        et les commandes en cours, diminuées des garanties.
      </p>
      <div class="card overflow-x-auto">
        <erp-tableau-controles [tableau]="fEncours" libelle="les tiers" />
        <table class="table">
          <thead>
            <tr>
              <th>Client</th>
              <th>État</th>
              <th class="num">Plafond (XOF)</th>
              <th class="num">Créances (XOF)</th>
              <th class="num">Engagements (XOF)</th>
              <th class="num">Garanties (XOF)</th>
              <th class="num">Disponible (XOF)</th>
              <th class="num">Utilisation</th>
            </tr>
          </thead>
          <tbody>
            @for (c of fEncours.lignes(); track c.partner_code) {
              <tr>
                <td>
                  <span class="block text-[13px] text-ink">{{ c.partner_name }}</span>
                  <span class="block font-mono text-[11px] text-ink-faint">{{ c.partner_code }}</span>
                </td>
                <td class="text-[12px] text-ink-soft">{{ c.credit_status }}</td>
                <td class="num tabular text-ink-faint">{{ nombre(c.credit_limit_xof) }}</td>
                <td class="num tabular text-ink-soft">{{ nombre(c.receivables_xof) }}</td>
                <td class="num tabular text-ink-soft">{{ nombre(c.commitments_xof) }}</td>
                <td class="num tabular text-ink-soft">{{ nombre(c.guarantees_xof) }}</td>
                <td class="num tabular text-ink">{{ nombre(c.available_credit_xof) }}</td>
                <td class="num tabular font-medium"
                    [class]="teinteUtilisation(c.utilisation_pct)">
                  {{ c.utilisation_pct ?? '-' }}{{ c.utilisation_pct ? ' %' : '' }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    <!-- ================= Avances fournisseurs (§ 14.6) ================= -->
    <section class="mb-5">
      <div class="mb-2 flex items-center gap-2">
        <erp-icon name="clock" [size]="15" class="text-ink-muted" />
        <h2 class="text-[13px] font-semibold text-ink">Avances fournisseurs non apurées</h2>
        <span class="text-[12px] text-ink-faint">({{ avances().length }})</span>
      </div>
      <p class="mb-2 text-[12px] leading-snug text-ink-faint">
        Elyon paie avant livraison : ce sont les avances qui pèsent au besoin en fonds de
        roulement, pas les dettes. Seul le reliquat figure ici : une avance apurée aux deux tiers
        n'y pèse que pour le tiers restant.
      </p>
      @if (avances().length === 0) {
        <div class="card px-[15px] py-3">
          <p class="text-[13px] text-ink-soft">Aucune avance en attente d'apurement.</p>
        </div>
      } @else {
        <div class="card overflow-x-auto">
          <erp-tableau-controles [tableau]="fAvances" libelle="les avances" />
          <table class="table">
            <thead>
              <tr>
                <th>Pièce</th>
                <th>Fournisseur</th>
                <th>Affaire</th>
                <th class="num">Versé</th>
                <th class="num">Apuré</th>
                <th class="num">Reliquat</th>
                <th class="num">Immobilisé</th>
                <th>Apurement par</th>
              </tr>
            </thead>
            <tbody>
              @for (a of fAvances.lignes(); track a.reference) {
                <tr>
                  <td class="font-mono text-[12px] text-ink">{{ a.reference }}</td>
                  <td class="text-ink-soft">{{ a.supplier }}</td>
                  <td class="font-mono text-[12px] text-ink-faint">{{ a.deal ?? '-' }}</td>
                  <td class="num tabular text-ink-faint">{{ nombre(a.prepaid_amount) }}</td>
                  <td class="num tabular text-ink-faint">{{ nombre(a.settled_amount) }}</td>
                  <td class="num tabular font-medium text-ink">
                    {{ nombre(a.outstanding_amount) }} {{ a.currency_code }}
                  </td>
                  <td class="num tabular" [class]="teinteAnciennete(a.days_outstanding)">
                    {{ anciennete(a.days_outstanding) }}
                  </td>
                  <td class="text-[12px] text-ink-soft">{{ a.settlement_trigger }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
})
export class SupervisionComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly invariants = signal<InvariantBreach[]>([]);
  protected readonly parametres = signal<ParametreRequis[]>([]);
  protected readonly bande = signal<MarginBandRow[]>([]);
  protected readonly parCommercial = signal<MarginBandOwnerRow[]>([]);
  protected readonly ecarts = signal<MarginVarianceRow[]>([]);
  protected readonly encours = signal<CreditExposureRow[]>([]);
  protected readonly avances = signal<OutstandingAdvanceRow[]>([]);

  // Un tableau paginé et cherchable par jeu de données : chaque instance suit
  // son propre signal, la lecture ne change pas.
  protected readonly fInvariants = new TableauPagine<InvariantBreach>();
  protected readonly fParametres = new TableauPagine<ParametreRequis>();
  protected readonly fBande = new TableauPagine<MarginBandRow>();
  protected readonly fParCommercial = new TableauPagine<MarginBandOwnerRow>();
  protected readonly fEcarts = new TableauPagine<MarginVarianceRow>();
  protected readonly fEncours = new TableauPagine<CreditExposureRow>();
  protected readonly fAvances = new TableauPagine<OutstandingAdvanceRow>();

  protected readonly chargement = signal(true);

  /**
   * Sept lectures indépendantes, chacune avec son propre repli.
   *
   * Une seule requête groupée serait plus économe, mais un rôle qui n'a pas
   * accès à l'une des routes perdrait alors TOUT l'écran. Le CCOO voit la
   * bande de marge et l'en-cours crédit, pas le rapprochement des coûts :
   * l'échec d'une lecture doit rester local à sa section.
   */
  ngOnInit(): void {
    const vide = () => undefined;
    this.api.invariants().subscribe({
      next: (r) => {
        this.invariants.set(r);
        this.fInvariants.définir(r);
      },
      error: vide,
    });
    this.api.parametresRequis().subscribe({
      next: (r) => {
        this.parametres.set(r);
        this.fParametres.définir(r);
      },
      error: vide,
    });
    this.api.marginBandByOwner().subscribe({
      next: (r) => {
        this.parCommercial.set(r);
        this.fParCommercial.définir(r);
      },
      error: vide,
    });
    this.api.marginVariance().subscribe({
      next: (r) => {
        this.ecarts.set(r);
        this.fEcarts.définir(r);
      },
      error: vide,
    });
    this.api.creditExposure().subscribe({
      next: (r) => {
        this.encours.set(r);
        this.fEncours.définir(r);
      },
      error: vide,
    });
    this.api.outstandingPrepayments().subscribe({
      next: (r) => {
        this.avances.set(r);
        this.fAvances.définir(r);
      },
      error: vide,
    });
    this.api.marginBand().subscribe({
      next: (r) => {
        this.bande.set(r);
        this.fBande.définir(r);
        this.chargement.set(false);
      },
      error: () => this.chargement.set(false),
    });
  }

  /**
   * Affichage seulement : la valeur reste la chaîne exacte rendue par la base.
   * On ne réinjecte jamais le résultat de ce formatage dans un calcul.
   */
  protected nombre(v: string | null): string {
    if (v === null || v === '') return '-';
    const n = Number(v);
    if (Number.isNaN(n)) return v;
    return grouper(n, { maximumFractionDigits: 2 });
  }

  protected signe(v: string | null): number {
    return Math.sign(Number(v ?? 0));
  }

  protected jour(iso: string | null): string {
    return iso ? dateOnly(iso) : '-';
  }

  /** Un commercial dont plus de la moitié des affaires effleurent le seuil. */
  protected alerte(part: string | null): boolean {
    return Number(part ?? 0) >= 50;
  }

  protected teinteUtilisation(pct: string | null): string {
    const n = Number(pct ?? 0);
    if (n >= 100) return 'text-crit';
    if (n >= 80) return 'text-warn-ink';
    return 'text-ink';
  }

  protected anciennete(jours: number): string {
    if (jours <= 0) return "aujourd'hui";
    if (jours === 1) return '1 jour';
    return jours + ' jours';
  }

  protected teinteAnciennete(jours: number): string {
    if (jours >= 90) return 'text-crit font-medium';
    if (jours >= 30) return 'text-warn-ink';
    return 'text-ink-soft';
  }
}
