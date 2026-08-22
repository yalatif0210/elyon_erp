import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  FieldSpec,
  ImportReport,
  ReferenceOption,
  ReferentialSpec,
} from '../core/api.service';
import { IconComponent } from '../shared/icon.component';
import { grouper } from '../shared/format';
import { MontantDirective } from '../shared/montant.directive';
import { TableauControlesComponent, TableauPagine } from '../shared/tableau';

/**
 * Paramétrage des référentiels (SPECIFICATIONS.md § 1.1 bis).
 *
 * L'écran est ENTIÈREMENT piloté par le registre servi par l'API : colonnes,
 * types, valeurs admises, obligations et mises en garde. Ajouter un
 * référentiel côté serveur le fait apparaître ici sans toucher à cet écran —
 * c'est la seule façon de tenir l'exigence « tout est paramétrable » au-delà
 * des premières tables.
 */
@Component({
  selector: 'erp-parameters',
  standalone: true,
  imports: [FormsModule, IconComponent, MontantDirective, TableauControlesComponent],
  template: `
    <header class="mb-5">
      <h1 class="page-title">Paramétrage</h1>
      <p class="page-sub">
        Saisie unitaire ou import de fichier, aucune donnée de fonctionnement n’est figée d’avance
      </p>
    </header>

    <div class="grid grid-cols-1 gap-5 lg:grid-cols-[240px_1fr]">
      <!-- ============ Choix du référentiel ============ -->
      <!-- La liste compte une trentaine de réglages, groupés dans l'ordre où
           on les configure (§ ordre logique du registre) : elle dépasse la
           hauteur de l'écran. Elle défile donc pour elle-même et reste en vue
           pendant qu'on lit le panneau de droite, sans quoi changer de réglage
           obligeait à remonter toute la page. Sur petit écran, la mise en page
           repasse sur une colonne et la liste redevient un bloc ordinaire. -->
      <nav
        class="card h-fit overflow-hidden lg:sticky lg:top-[84px]
               lg:max-h-[calc(100vh-104px)] lg:overflow-y-auto"
      >
        @for (r of catalogue(); track r.key; let i = $index) {
          @if (debutDeGroupe(i)) {
            <p class="nav-label px-[15px] font-bold text-primary" [class.pt-5]="i > 0">{{ r.group }}</p>
          }
          <button
            type="button"
            class="flex w-full items-center justify-between gap-2 border-b border-rule px-[15px]
                   py-2.5 text-left text-[13px] transition-colors last:border-b-0"
            [class]="
              selected()?.key === r.key
                ? 'bg-gray-100 font-medium text-primary'
                : 'text-ink-soft hover:bg-gray-100 hover:text-ink'
            "
            (click)="select(r)"
          >
            {{ r.label }}
            @if (r.nature === 'historised') {
              <erp-icon name="clock" [size]="12" class="shrink-0 text-ink-faint" />
            }
          </button>
        }
      </nav>

      @if (selected(); as spec) {
        <div class="min-w-0">
          <!-- Mise en garde propre au référentiel : elle vient du serveur. -->
          @if (spec.caution) {
            <div
              class="card mb-5 flex items-start gap-2.5 px-[15px] py-3 text-[13px]"
              [class]="spec.nature === 'historised' ? 'border-warn/40' : ''"
            >
              <erp-icon
                [name]="spec.nature === 'historised' ? 'clock' : 'alert-triangle'"
                [size]="15"
                class="mt-0.5 shrink-0"
                [class]="spec.nature === 'historised' ? 'text-warn-ink' : 'text-ink-muted'"
              />
              <p class="leading-relaxed text-ink-soft">{{ spec.caution }}</p>
            </div>
          }

          <div class="mb-4 flex gap-2">
            <button
              type="button"
              class="rounded-[3px] px-2.5 py-1 text-[12px] font-medium transition-colors"
              [class]="tabClass('saisie')"
              (click)="tab.set('saisie')"
            >
              Saisie unitaire
            </button>
            <button
              type="button"
              class="rounded-[3px] px-2.5 py-1 text-[12px] font-medium transition-colors"
              [class]="tabClass('import')"
              (click)="tab.set('import')"
            >
              Import de fichier
            </button>
            <button
              type="button"
              class="rounded-[3px] px-2.5 py-1 text-[12px] font-medium transition-colors"
              [class]="tabClass('consulter')"
              (click)="tab.set('consulter')"
            >
              Ce qui est enregistré
              @if (lignes()) {
                <span class="ml-1 opacity-70">({{ totalLignes() }})</span>
              }
            </button>
          </div>

          <!-- ============ Ce qui est enregistré ============ -->
          @if (tab() === 'consulter') {
            <section class="card">
              <div class="card-header">
                <h2 class="card-title">{{ spec.label }}</h2>
                <span class="text-[11px] text-ink-faint">
                  {{ lignes() === null ? 'lecture en cours' : totalLignes() + ' ligne(s)' }}
                </span>
              </div>

              <!-- Recherche et pagination : servies par le SERVEUR. Filtrer
                   dans le navigateur ne trouverait que ce qui y est déjà
                   arrivé, ce qui est précisément le défaut qu'on corrige. -->
              <div class="flex flex-wrap items-center justify-between gap-3 border-b border-rule
                          px-[15px] py-2.5">
                <div class="flex items-center gap-2">
                  <input
                    type="search"
                    class="field h-8 w-56 text-[13px]"
                    placeholder="Rechercher"
                    aria-label="Rechercher dans ce réglage"
                    [ngModel]="recherche"
                    (ngModelChange)="chercher($event)"
                  />
                  @if (recherche) {
                    <button type="button" class="link text-[12px]" (click)="chercher('')">
                      Effacer
                    </button>
                  }
                </div>
                <div class="flex items-center gap-3 text-[12px] text-ink-soft">
                  <select
                    class="field h-8 w-[92px] text-[12px]"
                    aria-label="Lignes par page"
                    [ngModel]="taillePage()"
                    (ngModelChange)="changerTaille(+$event)"
                  >
                    @for (n of taillesPage; track n) {
                      <option [ngValue]="n">{{ n }} / page</option>
                    }
                  </select>
                  <button
                    type="button"
                    class="btn-ghost h-8 px-2 text-[12px]"
                    [disabled]="pageCourante() <= 1"
                    (click)="allerA(pageCourante() - 1)"
                  >
                    Précédent
                  </button>
                  <span class="tabular">{{ pageCourante() }} / {{ totalPages() }}</span>
                  <button
                    type="button"
                    class="btn-ghost h-8 px-2 text-[12px]"
                    [disabled]="pageCourante() >= totalPages()"
                    (click)="allerA(pageCourante() + 1)"
                  >
                    Suivant
                  </button>
                </div>
              </div>

              @if (lignes() === null) {
                <div class="card-body">
                  <p class="text-[13px] text-ink-faint">Lecture en cours.</p>
                </div>
              } @else if (lignes()!.length === 0) {
                <div class="card-body">
                  @if (recherche) {
                    <p class="text-[13px] leading-relaxed text-ink-soft">
                      Aucune ligne ne correspond à «&nbsp;{{ recherche }}&nbsp;». Le réglage compte
                      d’autres lignes : effacez la recherche pour les revoir.
                    </p>
                  } @else {
                    <p class="text-[13px] leading-relaxed text-ink-soft">
                      Rien n’est encore enregistré pour ce réglage. Passez par la saisie unitaire
                      ou par l’import de fichier.
                    </p>
                  }
                </div>
              } @else {
                <div class="overflow-x-auto">
                  <table class="table">
                    <thead>
                      <tr>
                        @for (f of colonnes(spec); track f.name) {
                          <th [class.num]="alignerADroite(f)">{{ f.label }}</th>
                        }
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (l of lignes(); track $index) {
                        <tr>
                          @for (f of colonnes(spec); track f.name) {
                            <td
                              [class.num]="alignerADroite(f)"
                              [class.tabular]="alignerADroite(f)"
                              [class]="f.name === spec.identity[0] ? 'text-ink' : 'text-ink-soft'"
                            >
                              {{ afficher(l, f) }}
                            </td>
                          }
                          <td class="num">
                            <button type="button" class="link text-[12px]" (click)="reprendre(l)">
                              {{ spec.nature === 'historised' ? 'Repartir de là' : 'Modifier' }}
                            </button>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }

              @if (lecture()) {
                <div class="card-body border-t border-rule">
                  <p class="text-[12px] leading-relaxed text-warn-ink">{{ lecture() }}</p>
                </div>
              }
            </section>
          }

          <!-- ============ Saisie unitaire ============ -->
          @if (tab() === 'saisie') {
            <section class="card">
              <div class="card-header">
                <h2 class="card-title">{{ spec.label }}</h2>
                <span class="text-[11px] text-ink-faint">
                  {{ spec.nature === 'historised' ? 'donnée historisée' : 'correction sur place' }}
                </span>
              </div>
              <div class="card-body">
                <div class="grid grid-cols-1 gap-x-5 gap-y-3.5 md:grid-cols-2">
                  @for (f of spec.fields; track f.name) {
                    <div>
                      <label class="label" [attr.for]="'f-' + f.name">
                        {{ f.label }}
                        @if (f.required) {
                          <span class="text-crit">*</span>
                        }
                      </label>

                      @if (f.type === 'boolean') {
                        <label class="flex items-center gap-2 text-[13px] text-ink-soft">
                          <input
                            type="checkbox"
                            class="accent-[var(--primary)]"
                            [id]="'f-' + f.name"
                            [(ngModel)]="form[f.name]"
                          />
                          Activé
                        </label>
                      } @else if (f.type === 'enumList') {
                        <!-- Choix multiple : on montre toutes les valeurs, et
                             l'absence de sélection vaut « toutes ». Un champ
                             texte à virgules ferait deviner l'orthographe. -->
                        <div class="flex flex-wrap gap-x-4 gap-y-1 py-1">
                          @for (v of f.values ?? []; track v) {
                            <label class="flex items-center gap-1.5 text-[12px] text-ink-soft">
                              <input
                                type="checkbox"
                                class="accent-[var(--primary)]"
                                [checked]="hasValue(f.name, v)"
                                (change)="toggleValue(f.name, v)"
                              />
                              {{ libelle(f, v) }}
                            </label>
                          }
                        </div>
                      } @else if (refPickable(f)) {
                        <!-- Liste de références : mêmes cases que la liste
                             d'énumération, et même valeur — des codes séparés
                             par des virgules, c'est ce que le serveur attend.
                             Les codes viennent du référentiel visé, jamais
                             d'une liste recopiée ici : deviner leur orthographe
                             est le seul défaut que la saisie texte
                             garantissait. -->
                        @if (refChoices(f); as options) {
                          <div class="flex flex-wrap gap-x-4 gap-y-1 py-1">
                            @for (o of options; track o.value) {
                              <label class="flex items-center gap-1.5 text-[12px] text-ink-soft">
                                <input
                                  type="checkbox"
                                  class="accent-[var(--primary)]"
                                  [checked]="hasValue(f.name, o.value)"
                                  (change)="toggleValue(f.name, o.value)"
                                />
                                <span class="font-mono text-ink-muted">{{ o.value }}</span>
                                @if (o.label !== o.value) {
                                  <span>{{ o.label }}</span>
                                }
                              </label>
                            } @empty {
                              <p class="text-[12px] text-warn-ink">
                                Le référentiel «&nbsp;{{ f.refTable }}&nbsp;» ne contient encore
                                aucune ligne : il n’y a rien à rattacher.
                              </p>
                            }
                          </div>
                        } @else {
                          <p class="py-1 text-[12px] text-ink-faint">Lecture du référentiel…</p>
                        }
                      } @else if (refOnePickable(f)) {
                        <!-- Référence unique : une liste, pas une saisie. Le
                             code se tape sans faute une fois sur deux, et la
                             faute ne se voit pas — elle rattache l'objet à
                             rien, en silence. -->
                        @if (refChoices(f); as options) {
                          <select
                            class="field"
                            [id]="'f-' + f.name"
                            [(ngModel)]="form[f.name]"
                            (ngModelChange)="onFieldChange(f)"
                          >
                            <option [ngValue]="null">Choisir</option>
                            @for (o of options; track o.value) {
                              <option [ngValue]="o.value">
                                {{ o.value }}@if (o.label !== o.value) { · {{ o.label }} }
                              </option>
                            }
                          </select>
                          @if (options.length === 0) {
                            <p class="mt-1 text-[12px] text-warn-ink">
                              Le référentiel «&nbsp;{{ f.refTable }}&nbsp;» ne contient encore aucune
                              ligne : commencez par l’alimenter.
                            </p>
                          }
                        } @else {
                          <p class="py-1 text-[12px] text-ink-faint">Lecture du référentiel…</p>
                        }
                      } @else if (f.type === 'enum') {
                        <select
                          class="field"
                          [id]="'f-' + f.name"
                          [(ngModel)]="form[f.name]"
                          (ngModelChange)="onFieldChange(f)"
                        >
                          <option [ngValue]="null">Choisir</option>
                          @for (v of f.values ?? []; track v) {
                            <!-- Le libellé s'affiche, la valeur envoyée reste
                                 le code : traduire la valeur la rendrait
                                 dépendante de la langue de l'écran. -->
                            <option [ngValue]="v">{{ libelle(f, v) }}</option>
                          }
                        </select>
                      } @else if (f.type === 'version') {
                        <!-- Les numéros DÉJÀ PRIS sont retirés de la liste.
                             Un entier libre laissait écraser une version
                             existante sur une faute de frappe — et une
                             révision qui écrase ce qu'elle révise fait
                             disparaître l'historique qu'on versionne
                             justement pour le garder. -->
                        <select
                          class="field"
                          [id]="'f-' + f.name"
                          [disabled]="identiteIncomplete()"
                          [(ngModel)]="form[f.name]"
                        >
                          @for (v of versionChoices(); track v) {
                            <option [ngValue]="v">{{ v }}</option>
                          }
                        </select>
                        @if (identiteIncomplete()) {
                          <p class="mt-1 text-[11px] text-ink-faint">
                            Renseignez d’abord {{ champsIdentite(spec) }}&nbsp;: les versions se
                            comptent pour cette combinaison-là, pas pour la table entière.
                          </p>
                        } @else if (versionsPrises().length > 0) {
                          <p class="mt-1 text-[11px] text-ink-faint">
                            Déjà utilisées pour cette combinaison&nbsp;:
                            {{ versionsPrises().join(', ') }}
                          </p>
                        }
                      } @else if (f.type === 'text') {
                        <textarea class="field" rows="2" [id]="'f-' + f.name" [(ngModel)]="form[f.name]"></textarea>
                      } @else if (f.type === 'number' || f.type === 'integer') {
                        <!-- Séparateurs de milliers pendant la frappe : un
                             budget annuel se relit à l'œil, et une erreur d'un
                             facteur dix se voit au lieu de se recompter. -->
                        <input
                          class="field text-right font-mono"
                          erpMontant
                          [id]="'f-' + f.name"
                          [(ngModel)]="form[f.name]"
                          (ngModelChange)="onFieldChange(f)"
                        />
                      } @else {
                        <!-- Le clavier numérique est porté par la branche des
                             montants ci-dessus : ici il ne reste que du texte,
                             des dates et des références. -->
                        <input
                          class="field"
                          [id]="'f-' + f.name"
                          [type]="f.type === 'date' ? 'date' : 'text'"
                          [(ngModel)]="form[f.name]"
                          (ngModelChange)="onFieldChange(f)"
                        />
                      }

                      @if (f.help) {
                        <p class="mt-1 text-[11px] leading-snug text-ink-faint">{{ f.help }}</p>
                      }
                    </div>
                  }
                </div>

                @if (spec.nature === 'historised') {
                  <div class="mt-4">
                    <label class="label" for="motif">Motif <span class="text-crit">*</span></label>
                    <input class="field" id="motif" [(ngModel)]="reason" />
                    <p class="mt-1 text-[11px] text-ink-faint">
                      Cette donnée gouverne des calculs déjà produits. Le motif est conservé au
                      journal, aux côtés de l’auteur et de l’horodatage.
                    </p>
                  </div>
                }

                @if (errors().length > 0) {
                  <ul class="mt-4 space-y-1 rounded-[3px] bg-crit-wash px-3 py-2" role="alert">
                    @for (e of errors(); track e) {
                      <li class="flex items-start gap-2 text-[13px] text-crit">
                        <erp-icon name="alert-triangle" [size]="13" class="mt-0.5 shrink-0" />
                        {{ e }}
                      </li>
                    }
                  </ul>
                }
                @if (saved()) {
                  <p
                    class="mt-4 flex items-center gap-2 rounded-[3px] bg-ok-wash px-3 py-2
                           text-[13px] text-ok"
                    role="status"
                  >
                    <erp-icon name="check-circle" [size]="13" />
                    {{ saved() }}
                  </p>
                }

                <div class="mt-5 flex gap-2">
                  <button class="btn-primary" (click)="submit()" [disabled]="busy()">
                    {{ busy() ? 'Enregistrement…' : 'Enregistrer' }}
                  </button>
                  <button class="btn-ghost" (click)="resetForm()" [disabled]="busy()">
                    Vider
                  </button>
                </div>
              </div>
            </section>
          }

          <!-- ============ Import ============ -->
          @if (tab() === 'import') {
            <section class="card">
              <div class="card-header">
                <h2 class="card-title">Import : {{ spec.label }}</h2>
                <button class="link text-[12px]" (click)="downloadTemplate(spec)">
                  Télécharger le gabarit
                </button>
              </div>
              <div class="card-body">
                <p class="mb-4 text-[13px] leading-relaxed text-ink-soft">
                  Déposez un fichier <strong>CSV</strong> : c’est le format qu’Excel et LibreOffice
                  produisent par « Enregistrer sous ». La première ligne porte les noms de
                  colonnes du gabarit. Les nombres acceptent la virgule décimale, les dates le
                  format jour/mois/année.
                </p>

                <input
                  type="file"
                  accept=".csv,text/csv"
                  class="field h-auto py-2"
                  aria-label="Fichier à importer"
                  (change)="onFile($event)"
                />

                @if (parsed().length > 0) {
                  <p class="mt-3 text-[13px] text-ink-soft">
                    {{ parsed().length }} ligne(s) lue(s) ·
                    {{ parsedColumns().length }} colonne(s) : {{ parsedColumns().join(', ') }}
                  </p>

                  @if (spec.nature === 'historised') {
                    <div class="mt-3">
                      <label class="label" for="motif-import">Motif <span class="text-crit">*</span></label>
                      <input class="field" id="motif-import" [(ngModel)]="reason" />
                    </div>
                  }

                  <div class="mt-4 flex gap-2">
                    <button class="btn-ghost" (click)="runImport(true)" [disabled]="busy()">
                      Simuler
                    </button>
                    <button class="btn-primary" (click)="runImport(false)" [disabled]="busy()">
                      Importer
                    </button>
                  </div>
                  <p class="mt-2 text-[11px] text-ink-faint">
                    La simulation rend le rapport sans rien écrire. Utile pour corriger le
                    fichier avant d’engager quoi que ce soit.
                  </p>
                }

                <!-- Rapport de rejet ligne à ligne -->
                @if (report(); as rep) {
                  <div class="mt-5 border-t border-rule pt-4">
                    <div class="mb-3 flex flex-wrap items-center gap-4 text-[13px]">
                      @if (rep.simulation) {
                        <span class="badge-transit">
                          <erp-icon name="clock" [size]="11" />
                          Simulation
                        </span>
                      }
                      <span class="text-ink-soft">{{ rep.lues }} lue(s)</span>
                      <span class="font-medium text-ok">{{ rep.creees }} créée(s)</span>
                      <span class="font-medium text-ink">{{ rep.modifiees }} modifiée(s)</span>
                      <span [class]="rep.rejetees > 0 ? 'font-semibold text-crit' : 'text-ink-faint'">
                        {{ rep.rejetees }} rejetée(s)
                      </span>
                    </div>

                    @if (rep.rejets.length > 0) {
                      <erp-tableau-controles [tableau]="tableauRejets" libelle="les rejets" />
                      <div class="overflow-x-auto">
                        <table class="table">
                          <thead>
                            <tr><th class="num">Ligne</th><th>Colonne</th><th>Motif du rejet</th></tr>
                          </thead>
                          <tbody>
                            @for (r of tableauRejets.lignes(); track $index) {
                              <tr class="row-crit">
                                <td class="num font-mono">{{ r.line }}</td>
                                <td class="font-mono text-[12px] text-ink-muted">{{ r.field ?? '-' }}</td>
                                <td class="text-ink">{{ r.message }}</td>
                              </tr>
                            }
                          </tbody>
                        </table>
                      </div>
                      <p class="mt-2 text-[11px] text-ink-faint">
                        Les numéros correspondent aux lignes de votre tableur : l’entête occupe
                        la ligne 1. Les lignes valides ont été traitées ; seules celles-ci
                        restent à corriger.
                      </p>
                    } @else {
                      <p class="text-[13px] text-ok">Aucun rejet.</p>
                    }

                    @if (rep.avertissements.length > 0) {
                      <ul class="mt-3 space-y-1">
                        @for (a of rep.avertissements; track $index) {
                          <li class="text-[12px] text-warn-ink">{{ a.message }}</li>
                        }
                      </ul>
                    }
                  </div>
                }
              </div>
            </section>
          }
        </div>
      }
    </div>
  `,
})
export class ParametersComponent implements OnInit {
  private readonly api = inject(ApiService);

  protected readonly catalogue = signal<ReferentialSpec[]>([]);
  protected readonly selected = signal<ReferentialSpec | null>(null);
  protected readonly tab = signal<'saisie' | 'import' | 'consulter'>('saisie');

  /**
   * Ce qui est déjà enregistré pour le réglage choisi.
   *
   * `null` tant que la lecture n’a pas abouti : un tableau vide signifie
   * « rien d’enregistré », et confondre les deux ferait annoncer l’absence
   * avant même d’avoir regardé.
   */
  protected readonly lignes = signal<Record<string, unknown>[] | null>(null);
  protected readonly lecture = signal<string | null>(null);

  /**
   * Pagination SERVEUR de la consultation.
   *
   * ⚠️ ELLE N'EST PAS COSMÉTIQUE : LA LECTURE SE COUPAIT À 500 LIGNES EN
   *    SILENCE.
   *
   *    L'écran affichait « 500 ligne(s) » sans distinguer 500 d'« au moins
   *    500 ». Les prix publiés et les cours de change franchissent ce seuil en
   *    moins d'un an, et l'on aurait conclu qu'une ligne n'existe pas alors
   *    qu'elle était au-delà de la coupure. Filtrer dans le navigateur n'y
   *    aurait rien changé : les lignes manquantes n'y sont jamais arrivées.
   */
  protected readonly pageCourante = signal(1);
  protected readonly taillePage = signal(25);
  protected readonly totalLignes = signal(0);
  protected readonly totalPages = signal(1);
  protected recherche = '';
  protected readonly taillesPage = [10, 25, 50, 100];
  protected readonly busy = signal(false);
  protected readonly errors = signal<string[]>([]);
  protected readonly saved = signal<string | null>(null);
  protected readonly report = signal<ImportReport | null>(null);
  protected readonly tableauRejets = new TableauPagine<ImportReport['rejets'][number]>();
  protected readonly parsed = signal<Record<string, string>[]>([]);

  /**
   * Référentiels lus pour alimenter les champs `referenceList`, par clé de
   * registre. Trois états, et ils comptent : absent de la carte = jamais
   * demandé, `undefined` = lecture en cours, `null` = pas de route de lecture
   * ou rôle non autorisé, auquel cas le champ retombe sur la saisie texte.
   */
  protected readonly references = signal<
    Record<string, ReferenceOption[] | null | undefined>
  >({});

  protected form: Record<string, unknown> = {};
  protected reason = '';

  /**
   * Numéros de version disponibles pour la combinaison en cours de saisie.
   *
   * `null` tant qu'aucune lecture n'a abouti — la liste retombe alors sur 1 à
   * 100. C'est délibéré : privé de la lecture, l'écran doit rester utilisable,
   * et la base refusera de toute façon un doublon. Une liste vide, elle,
   * empêcherait toute saisie sans rien expliquer.
   */
  protected readonly versions = signal<{ libres: number[]; prises: number[] } | null>(null);

  /** Vrai tant que les champs qui identifient la ligne ne sont pas tous choisis. */
  protected readonly identiteIncomplete = signal(true);

  protected readonly parsedColumns = computed(() => Object.keys(this.parsed()[0] ?? {}));

  ngOnInit(): void {
    this.api.parameterCatalogue().subscribe((c) => {
      this.catalogue.set(c);
      if (c.length > 0) this.select(c[0]);
    });
  }

  /**
   * Vrai pour la première entrée d'un nouveau groupe — c'est là qu'un sous-titre
   * s'affiche. Le regroupement suit l'ordre déjà servi par l'API (§ ordre
   * logique du registre) : rien n'est retrié ici, seule la rupture entre deux
   * groupes consécutifs est détectée.
   */
  protected debutDeGroupe(index: number): boolean {
    if (index === 0) return true;
    return this.catalogue()[index].group !== this.catalogue()[index - 1].group;
  }

  protected select(spec: ReferentialSpec): void {
    this.selected.set(spec);
    this.resetForm();
    this.report.set(null);
    this.parsed.set([]);
    this.versions.set(null);
    this.pageCourante.set(1);
    this.recherche = '';
    this.loadReferences(spec);
    this.refreshVersions();
    this.chargerLignes(spec);
  }

  /** Après une écriture, ce qui est enregistré a changé : on le relit. */
  private rafraichir(): void {
    const spec = this.selected();
    if (spec) this.chargerLignes(spec);
  }

  /**
   * Charge les référentiels visés par les champs `referenceList` du formulaire.
   *
   * Au choix du référentiel, et non au démarrage : le registre en compte une
   * quinzaine, et pré-charger les tables de toutes les listes de références de
   * tous les référentiels ferait payer à l'ouverture ce dont un seul écran a
   * besoin. Le résultat est mémorisé par table, donc une seule lecture même
   * quand plusieurs champs visent la même.
   */
  private loadReferences(spec: ReferentialSpec): void {
    for (const field of spec.fields) {
      const table = field.refTable;
      // Les DEUX natures de référence, singulier et pluriel : elles se
      // présentent différemment à l'écran mais se lisent au même endroit.
      if ((field.type !== 'referenceList' && field.type !== 'reference') || !table) continue;

      // ⚠️ LA CLÉ DE CACHE PORTE LE FILTRE, PAS SEULEMENT LA TABLE.
      //
      //    « Transporteur » (vehicles) et « Client » (contracts) visent tous
      //    deux `partners`, mais avec des `refFilter` différents. Mémoriser
      //    par table seule aurait servi, au second écran ouvert, la liste
      //    déjà lue pour le premier — un client dans le choix du
      //    transporteur, ou l'inverse.
      const cle = this.cleReference(field);
      if (cle in this.references()) continue;

      // Marqué « en cours » AVANT l'appel : deux champs visant la même clé ne
      // doivent pas déclencher deux lectures.
      this.references.update((r) => ({ ...r, [cle]: undefined }));

      this.api.referenceOptions(table, field.refKey ?? 'code', field.refFilter).subscribe({
        next: (options) => this.references.update((r) => ({ ...r, [cle]: options })),
        // Pas de route de lecture, ou rôle non autorisé à la lire. On n'a alors
        // rien d'honnête à proposer : le champ retombe sur la saisie texte, qui
        // reste acceptée par le serveur — plutôt qu'une liste vide, qui ferait
        // croire qu'il n'y a rien à rattacher.
        error: () => this.references.update((r) => ({ ...r, [cle]: null })),
      });
    }
  }

  /**
   * Clé de mémorisation d'un champ de référence — DOIT rester identique à
   * celle posée par `loadReferences` : deux champs visant la même table avec
   * des `refFilter` différents (« Client » et « Transporteur » visent tous
   * deux `partners`) ne doivent jamais partager une entrée de cache.
   */
  private cleReference(f: FieldSpec): string {
    return f.refFilter ? `${f.refTable}::${JSON.stringify(f.refFilter)}` : (f.refTable ?? '');
  }

  /** Liste de références présentable en cases à cocher ? Sinon : saisie texte. */
  protected refPickable(f: FieldSpec): boolean {
    if (f.type !== 'referenceList' || !f.refTable) return false;
    return this.references()[this.cleReference(f)] !== null;
  }

  /** Référence unique présentable en liste déroulante ? Sinon : saisie texte. */
  protected refOnePickable(f: FieldSpec): boolean {
    if (f.type !== 'reference' || !f.refTable) return false;
    return this.references()[this.cleReference(f)] !== null;
  }

  /** Les choix lus, ou `undefined` tant que la lecture n'a pas abouti. */
  protected refChoices(f: FieldSpec): ReferenceOption[] | undefined {
    return this.references()[this.cleReference(f)] ?? undefined;
  }

  /**
   * Colonnes de consultation : celles du formulaire, les notes en moins.
   *
   * Une note tient parfois mille caractères et ferait déborder la ligne. Elle
   * se lit au moment où on modifie, pas au moment où on parcourt.
   */
  protected colonnes(spec: ReferentialSpec): FieldSpec[] {
    return spec.fields.filter((f) => f.type !== 'text');
  }

  protected alignerADroite(f: FieldSpec): boolean {
    return f.type === 'number' || f.type === 'integer' || f.type === 'version';
  }

  /**
   * Libellé français d'une valeur de liste, ou la valeur elle-même à défaut.
   *
   * Le repli n'est pas décoratif : une énumération qui gagne une valeur sans
   * qu'on ait pensé à la traduire s'affiche telle quelle, ce qui reste lisible.
   * Un libellé vide, lui, ferait disparaître le choix de la liste.
   */
  protected libelle(f: FieldSpec, valeur: string): string {
    return f.valueLabels?.[valeur] ?? valeur;
  }

  /** Valeur d’une cellule, dans la forme sous laquelle elle a été choisie. */
  protected afficher(ligne: Record<string, unknown>, f: FieldSpec): string {
    // Une référence se relit par sa clé LISIBLE, posée à côté de
    // l’identifiant : « ADM » et non « 6b7c54a9-a952… ».
    const lisible = ligne['_lisible'] as Record<string, unknown> | undefined;
    if (lisible && lisible[f.name] !== undefined && lisible[f.name] !== null) {
      return String(lisible[f.name]);
    }

    const v = ligne[f.name];
    if (v === null || v === undefined || v === '') return '-';
    if (typeof v === 'boolean') return v ? 'oui' : 'non';
    // Les listes se relisent dans la même langue que la saisie : afficher
    // « PER_VOLUME » ici et « Au volume » dans le formulaire ferait douter
    // qu'il s'agisse de la même chose.
    if (Array.isArray(v)) {
      return v.length === 0 ? 'tous' : v.map((x) => this.libelle(f, String(x))).join(', ');
    }
    if (f.type === 'enum') return this.libelle(f, String(v));
    if (f.type === 'date') return String(v).slice(0, 10);
    if (f.type === 'number' || f.type === 'integer') {
      const n = Number(v);
      return Number.isNaN(n) ? String(v) : grouper(n, { maximumFractionDigits: 6 });
    }
    return String(v);
  }

  /**
   * Ramène une ligne existante dans le formulaire de saisie.
   *
   * ⚠️ SANS CELA, MODIFIER UNE LIGNE ÉTAIT IMPRATICABLE.
   *
   *    Le formulaire s'ouvrait vide. Pour poser une probabilité sur une étape
   *    du pipeline, il fallait retaper le code, le libellé, le rang et l'issue
   *    de mémoire, et se tromper de rang heurtait une contrainte d'unicité
   *    avec un message qui ne parlait pas de l'étape voisine. Treize étapes,
   *    quatre champs obligatoires chacune : personne ne l'aurait fait deux
   *    fois.
   *
   *    Le dirigeant, le 9 août : « tu as inscrit des informations sans
   *    probabilité et il est impossible de les mettre à jour ».
   *
   * ⚠️ SUR UNE DONNÉE HISTORISÉE, CECI NE MODIFIE RIEN.
   *
   *    Une grille de seuils ou un prix publié ne se réécrit jamais : la
   *    validation le refuse, et c'est ce qui garantit qu'une marge approuvée
   *    l'a été sur des chiffres qu'on peut encore retrouver. On repart donc de
   *    la ligne existante pour en écrire une NOUVELLE, à une autre date. Le
   *    bouton le dit : « repartir de là », pas « modifier ».
   */
  protected reprendre(ligne: Record<string, unknown>): void {
    const spec = this.selected();
    if (!spec) return;

    const lisible = ligne['_lisible'] as Record<string, unknown> | undefined;
    const valeurs: Record<string, unknown> = {};

    for (const f of spec.fields) {
      // Une référence se repose par sa clé lisible : c'est ce que le
      // formulaire propose, et c'est ce que le serveur sait résoudre.
      if (lisible && lisible[f.name] !== undefined && lisible[f.name] !== null) {
        valeurs[f.name] = lisible[f.name];
        continue;
      }
      const v = ligne[f.name];
      if (v === null || v === undefined) continue;
      if (Array.isArray(v)) {
        valeurs[f.name] = v.join(',');
      } else if (f.type === 'date') {
        valeurs[f.name] = String(v).slice(0, 10);
      } else {
        valeurs[f.name] = v;
      }
    }

    // ⚠️ SUR UNE DONNÉE HISTORISÉE, LA DATE DE VALIDITÉ NE SE REPREND PAS.
    //
    //    Le bouton rechargeait la ligne AVEC sa date d'entrée en vigueur.
    //    Resoumettre sans y toucher heurtait la règle « une donnée historisée
    //    ne se réécrit pas » — et le seul geste naturel après avoir cliqué sur
    //    « repartir de là » est justement de modifier une valeur et de valider.
    //
    //    L'intention du bouton est de publier une NOUVELLE version, à une
    //    nouvelle date. On propose donc celle du jour, qui reste modifiable.
    if (spec.nature === 'historised' && spec.effectiveFrom) {
      valeurs[spec.effectiveFrom] = new Date().toISOString().slice(0, 10);
    }

    this.form = valeurs;
    this.reason = '';
    this.errors.set([]);
    this.saved.set(null);
    this.tab.set('saisie');
    this.refreshVersions();
  }

  private chargerLignes(spec: ReferentialSpec): void {
    this.lignes.set(null);
    this.lecture.set(null);
    this.api
      .lignesReferentiel(spec.key, {
        page: this.pageCourante(),
        pageSize: this.taillePage(),
        search: this.recherche.trim() || undefined,
      })
      .subscribe({
      next: (p) => {
        this.lignes.set(p.items);
        this.totalLignes.set(p.total);
        this.totalPages.set(p.totalPages);
      },
      // Une lecture refusée n’est pas une absence de données : le dire évite
      // de conclure que le réglage est vide alors qu’il ne l’est pas.
      error: () => {
        this.lignes.set([]);
        this.totalLignes.set(0);
        this.totalPages.set(1);
        this.lecture.set(
          'Ce réglage ne se relit pas depuis cet écran, ou votre profil n’y donne pas accès. Ce qui est enregistré reste en place.',
        );
      },
    });
  }

  /** Une recherche, un changement de taille ou de page relit le serveur. */
  protected chercher(q: string): void {
    this.recherche = q;
    this.pageCourante.set(1);
    this.rafraichir();
  }

  protected allerA(p: number): void {
    this.pageCourante.set(Math.min(Math.max(1, p), this.totalPages()));
    this.rafraichir();
  }

  protected changerTaille(n: number): void {
    this.taillePage.set(n);
    this.pageCourante.set(1);
    this.rafraichir();
  }

  /**
   * Numéros proposés.
   *
   * Aucun tant que l'identité est incomplète : proposer une liste calculée sur
   * la table entière reviendrait à écarter des numéros libres.
   */
  protected versionChoices(): number[] {
    if (this.identiteIncomplete()) return [];
    return this.versions()?.libres ?? Array.from({ length: 100 }, (_, i) => i + 1);
  }

  /** Les champs qui identifient la ligne, en toutes lettres. */
  protected champsIdentite(spec: ReferentialSpec): string {
    const noms = spec.identity
      .filter((n) => spec.fields.find((f) => f.name === n)?.type !== 'version')
      .map((n) => spec.fields.find((f) => f.name === n)?.label ?? n);
    return noms.join(', ').toLowerCase();
  }

  protected versionsPrises(): number[] {
    return this.versions()?.prises ?? [];
  }

  /**
   * Un champ d'IDENTITÉ vient de changer : les versions libres avec lui.
   *
   * ⚠️ LES VERSIONS SE COMPTENT PAR IDENTITÉ, PAS GLOBALEMENT.
   *
   *    La version 1 du pool Administration 2026 et la version 1 du pool HSE
   *    2026 coexistent normalement. La liste dépend donc de ce qui vient
   *    d'être choisi juste au-dessus — c'est ce qui la distingue d'une liste
   *    statique, et c'est tout le travail de ce champ.
   */
  protected onFieldChange(f: FieldSpec): void {
    this.viderChampsDependants(f);
    if (!this.selected()?.identity.includes(f.name)) return;
    this.refreshVersions();
  }

  /**
   * Vide les champs déclarés `clearsOnValue` pour la valeur qui vient d'être
   * choisie — sans quoi un poste repassé DIRECT après un essai INDIRECT
   * soumettait encore un pool et une assiette que rien à l'écran ne montrait
   * comme incohérents avec la nature affichée.
   */
  private viderChampsDependants(f: FieldSpec): void {
    const valeur = this.form[f.name];
    const aViderCombs = f.clearsOnValue?.[String(valeur)];
    if (!aViderCombs) return;
    for (const nom of aViderCombs) this.form[nom] = null;
  }

  private refreshVersions(): void {
    const spec = this.selected();
    const champ = spec?.fields.find((f) => f.type === 'version');
    if (!spec || !champ) {
      this.versions.set(null);
      return;
    }

    // ⚠️ TANT QUE L'IDENTITÉ EST INCOMPLÈTE, ON NE PROPOSE RIEN.
    //
    //    L'écran interrogeait dès l'ouverture, formulaire vide. Le serveur ne
    //    retenant que les champs renseignés, la recherche portait alors sur
    //    TOUTES les lignes : pour une prévision de vente, il rendait « version
    //    1 déjà prise » et présélectionnait 2, alors que la version 1 est libre
    //    pour toute combinaison neuve. On créait une version 2 sans version 1,
    //    et l'historique commençait à deux sans que rien ne le dise.
    //
    //    La liste ne vaut donc que sur une identité COMPLÈTE. Avant cela, elle
    //    reste vide et le champ affiche ce qu'il attend.
    const identite: Record<string, string> = {};
    for (const nom of spec.identity) {
      if (nom === champ.name) continue;
      const v = this.form[nom];
      if (v === null || v === undefined || v === '') {
        this.versions.set(null);
        this.identiteIncomplete.set(true);
        return;
      }
      identite[nom] = String(v);
    }
    this.identiteIncomplete.set(false);

    this.api.versionsLibres(spec.key, identite).subscribe({
      next: (r) => {
        this.versions.set(r);
        // On ne déplace le choix de l'utilisateur que s'il est devenu
        // indisponible : sinon, changer d'exercice remettrait sa version à 1
        // sous ses doigts.
        if (!r.libres.includes(Number(this.form[champ.name]))) {
          this.form[champ.name] = r.suivant;
        }
      },
      error: () => this.versions.set(null),
    });
  }

  protected tabClass(t: 'saisie' | 'import' | 'consulter'): string {
    return this.tab() === t
      ? 'bg-primary text-white'
      : 'border border-rule-strong bg-surface text-ink-soft hover:bg-gray-100 hover:text-ink';
  }

  /** Vrai si la valeur figure dans la liste multiple en cours de saisie. */
  protected hasValue(field: string, value: string): boolean {
    const raw = String(this.form[field] ?? '');
    return raw.split(',').map((v) => v.trim()).includes(value);
  }

  protected toggleValue(field: string, value: string): void {
    const current = String(this.form[field] ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    this.form[field] = next.join(',');
  }

  protected resetForm(): void {
    this.form = {};
    this.reason = '';
    this.errors.set([]);
    this.saved.set(null);
  }

  protected submit(): void {
    const spec = this.selected();
    if (!spec || this.busy()) return;

    this.busy.set(true);
    this.errors.set([]);
    this.saved.set(null);

    // Les champs laissés vides ne sont pas transmis : envoyer une chaîne vide
    // écraserait une valeur existante par du néant lors d'une correction.
    const values = Object.fromEntries(
      Object.entries(this.form).filter(([, v]) => v !== '' && v !== null && v !== undefined),
    );

    this.api.saveParameter(spec.key, values, this.reason || undefined).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.saved.set(r.created ? 'Ligne créée.' : 'Ligne modifiée.');
        this.form = {};
        // Ce qui est enregistré vient de changer : on le relit, et les numéros
        // de version libres avec lui. Sans cela, l'onglet de consultation
        // montrerait l'état d'avant la saisie qu'on vient de faire.
        this.rafraichir();
        this.refreshVersions();
      },
      error: (e: { error?: { message?: unknown; errors?: { message: string }[] } }) => {
        this.busy.set(false);
        this.errors.set(extractErrors(e));
      },
    });
  }

  /**
   * Lecture du fichier dans le navigateur.
   *
   * Le CSV est décomposé ici et transmis en lignes structurées : le serveur
   * n'a pas à connaître les dialectes de séparateur, et aucun fichier binaire
   * ne transite. Le point-virgule est reconnu au même titre que la virgule —
   * c'est ce qu'un Excel configuré en français produit.
   */
  protected onFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.report.set(null);

    const reader = new FileReader();
    reader.onload = () => {
      this.parsed.set(parseCsv(String(reader.result ?? '')));
    };
    reader.readAsText(file, 'utf-8');
  }

  protected runImport(dryRun: boolean): void {
    const spec = this.selected();
    if (!spec || this.busy()) return;

    this.busy.set(true);
    this.errors.set([]);
    this.api
      .importParameters(spec.key, this.parsed(), this.reason || undefined, dryRun)
      .subscribe({
        next: (r) => {
          this.busy.set(false);
          this.report.set(r);
          this.tableauRejets.définir(r.rejets);
          // Un import à blanc n'écrit rien : relire serait inutile, et laisser
          // croire qu'il a écrit.
          if (!dryRun) this.rafraichir();
        },
        error: (e: { error?: { message?: unknown } }) => {
          this.busy.set(false);
          this.errors.set(extractErrors(e));
        },
      });
  }

  /** Gabarit CSV : l'entête, plus une ligne d'exemple commentée. */
  protected downloadTemplate(spec: ReferentialSpec): void {
    const header = spec.fields.map((f) => f.name).join(';');
    const hint = spec.fields.map((f) => describe(f)).join(';');
    const csv = `﻿${header}\n${hint}\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `gabarit-${spec.key}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

function describe(f: FieldSpec): string {
  const parts = [f.required ? 'obligatoire' : 'facultatif', f.type];
  if (f.values?.length) parts.push(f.values.join('|'));
  return parts.join(' ');
}

function extractErrors(e: { error?: { message?: unknown; errors?: { message: string }[] } }): string[] {
  if (e.error?.errors?.length) return e.error.errors.map((x) => x.message);
  const m = e.error?.message;
  if (Array.isArray(m)) return m as string[];
  if (typeof m === 'string') return [m];
  return ['Enregistrement impossible'];
}

/**
 * Décomposition CSV, guillemets compris.
 *
 * Le séparateur est déduit de la première ligne : point-virgule s'il y en a
 * plus que de virgules. Un tableur francophone produit du point-virgule
 * précisément parce que la virgule sert de séparateur décimal.
 */
function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const firstLine = clean.slice(0, clean.indexOf('\n') === -1 ? undefined : clean.indexOf('\n'));
  const sep = (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? ';' : ',';

  const rows: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < clean.length; i += 1) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((r) => r.some((v) => v.trim() !== ''));
  if (!header) return [];
  const columns = header.map((h) => h.trim());

  return body.map((r) =>
    Object.fromEntries(columns.map((col, i) => [col, (r[i] ?? '').trim()])),
  );
}
