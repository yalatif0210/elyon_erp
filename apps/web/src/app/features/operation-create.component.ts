import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  ApiService,
  DealRow,
  OperationTypeRow,
  Partner,
  ReferentialSpec,
  SiteRequirement,
} from '../core/api.service';
import {
  ActionFeedbackComponent,
  ActionState,
  HttpFailure,
} from '../shared/action-panel.component';
import { IconComponent } from '../shared/icon.component';
import { dealStatus } from './deals.component';

/**
 * Site de livraison, aplati depuis les tiers.
 *
 * Un site n'a de sens qu'accompagné de son propriétaire : deux dépôts
 * s'appellent « Vridi » chez deux clients différents.
 */
interface SiteOption {
  id: string;
  label: string;
  /**
   * Ce que le site EXIGE, tel qu'il est paramétré au référentiel.
   *
   * Exposé au moment du choix, et non plus tard : celui qui prépare
   * l'opération doit voir le badge d'accès et le créneau réservé quand il
   * décide, pas quand le camion est devant la barrière. Une exigence
   * bloquante non levée empêchera d'ailleurs le départ.
   */
  exigences: SiteRequirement[];
}

/**
 * Noms de champs du registre où lire les valeurs admises d'une énumération.
 *
 * Les énumérations Prisma — unité de mesure, mode de transport — n'ont pas de
 * route de lecture propre. Le registre de paramétrage est la SEULE surface
 * d'API qui les publie, parce qu'il en dérive lui-même ses champs `enum` du
 * schéma. On les y lit donc plutôt que de recopier une liste dans cet écran :
 * une liste tenue à la main diverge du schéma sans prévenir, et le défaut ne
 * se voit qu'à l'écriture, sur la ligne d'un utilisateur.
 */
const UOM_FIELDS = ['uom', 'defaultUom', 'franchiseUom'];
const TRANSPORT_FIELDS = ['transportMode', 'applicableTransportModes'];

/**
 * Création d'une opération (§ 7.1).
 *
 * LE DÉROULÉ EST UNE SÉQUENCE, PAS UN ENSEMBLE. Une opération peut commencer
 * par un transport routier et se terminer par un soutage à quai ; l'ordre dans
 * lequel les types sont retenus est transmis tel quel au serveur, qui en fait
 * le rang de séquence. C'est pourquoi les types choisis ne sont pas de simples
 * cases à cocher : ils forment une liste numérotée, que l'on monte, descend ou
 * retire. Une sélection implicite — cases cochées, ordre d'affichage du
 * référentiel — présenterait le soutage avant le transport qui l'amène, et
 * l'agent terrain recevrait ses checklists dans le désordre.
 *
 * Rien n'est arbitré ici : l'affaire non approuvée, le type manquant et le
 * volume nul sont refusés par le serveur et par la base, avec leur motif
 * rédigé. C'est ce motif qui est affiché, intégralement.
 */
@Component({
  selector: 'erp-operation-create',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, ActionFeedbackComponent],
  template: `
    <nav class="mb-3 flex items-center gap-1.5 text-[12px] text-ink-muted">
      <a routerLink="/operations" class="link">Opérations</a>
      <erp-icon name="chevron-right" [size]="12" />
      <span class="text-ink">Nouvelle opération</span>
    </nav>

    <header class="mb-5">
      <h1 class="page-title">Nouvelle opération</h1>
      <p class="page-sub">
        Rattachement à une affaire, déroulé des types portés, et acheminement
      </p>
    </header>

    <erp-action-feedback [error]="state.error()" [success]="state.done()" />

    <!-- ============ Affaire de rattachement ============ -->
    <section class="card mb-5 overflow-hidden">
      <div class="card-header"><h2 class="card-title">Affaire de rattachement</h2></div>
      <div class="card-body">
        <label class="label" for="deal">Affaire <span class="text-crit">*</span></label>
        <select id="deal" class="field" [(ngModel)]="dealId" (ngModelChange)="onDealChange()">
          <option [ngValue]="''">Choisir une affaire</option>
          @for (d of deals(); track d.id) {
            <option [ngValue]="d.id">
              {{ d.reference }} · {{ d.client.legalName }} · {{ d.product.name }} ·
              {{ statusLabel(d.status) }}
            </option>
          }
        </select>
        <p class="mt-1 text-[11px] leading-relaxed text-ink-faint">
          L’état de l’affaire est rappelé pour information. L’exigence d’approbation est tenue
          automatiquement : une affaire qui n’y satisfait pas est refusée à l’enregistrement, avec
          son motif.
        </p>
      </div>
    </section>

    <!-- ============ Déroulé : les types portés, DANS L'ORDRE ============ -->
    <section class="card mb-5 overflow-hidden">
      <div class="card-header">
        <h2 class="card-title">Déroulé de l’opération</h2>
        <span class="text-[11px] text-ink-faint">
          {{ sequence().length }} type(s) · {{ totalChecklists() }} checklist(s) au total
        </span>
      </div>
      <div class="card-body">
        <p class="mb-3 text-[11px] leading-relaxed text-ink-faint">
          Les contrôles HSE de l’opération sont l’union dédoublonnée des checklists de tous ses
          types. L’ordre retenu est le déroulé réel : le rang 1 est la première étape.
        </p>

        @if (sansControle().length > 0) {
          <div
            class="mb-3 flex items-start gap-2 rounded-[3px] bg-warn-wash px-3 py-2 text-[13px]
                   text-warn-ink"
            role="status"
          >
            <erp-icon name="alert-triangle" [size]="14" class="mt-0.5 shrink-0" />
            <span>
              Aucun contrôle n’est rattaché à
              {{ sansControleCodes() }}. Ces étapes n’apporteront rien à la checklist de
              l’opération.
            </span>
          </div>
        }

        <div class="grid grid-cols-1 gap-5 md:grid-cols-2">
          <!-- Types offerts -->
          <div>
            <h3 class="mb-2 text-[13px] font-semibold text-ink">Types disponibles</h3>
            @if (segment()) {
              <p class="mb-2 text-[11px] text-ink-faint">
                Restreints au segment {{ segment() }} de l’affaire. Les types sans segment
                déclaré valent pour tous et restent proposés.
              </p>
            }
            <div class="divide-y divide-rule border border-rule">
              @for (t of types(); track t.id) {
                <button
                  type="button"
                  class="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors
                         disabled:cursor-not-allowed disabled:opacity-45"
                  [class]="retenu(t) ? 'bg-gray-100' : 'hover:bg-gray-100'"
                  [disabled]="retenu(t)"
                  (click)="ajouter(t)"
                >
                  <erp-icon name="plus" [size]="13" class="mt-1 shrink-0 text-ink-faint" />
                  <span class="min-w-0 flex-1">
                    <span class="font-mono text-[12px] text-ink-muted">{{ t.code }}</span>
                    <span class="ml-1.5 text-[13px] font-medium text-ink">{{ t.label }}</span>
                    @if (t.description) {
                      <span class="mt-0.5 block text-[11px] leading-snug text-ink-faint">
                        {{ t.description }}
                      </span>
                    }
                  </span>
                  <span class="shrink-0 text-[11px] font-medium" [class]="countClass(t)">
                    {{ t.checklistCount }} checklist(s)
                  </span>
                </button>
              } @empty {
                <p class="empty px-3 py-3 text-[13px]">
                  Aucun type d’opération actif. Ils s’administrent dans Paramétrage.
                </p>
              }
            </div>
          </div>

          <!-- Séquence retenue -->
          <div>
            <h3 class="mb-2 text-[13px] font-semibold text-ink">Déroulé retenu</h3>
            <p class="mb-2 text-[11px] text-ink-faint">
              Le rang est celui qui sera enregistré. Corrigez-le tant que l’opération n’est pas
              créée.
            </p>
            <ol class="divide-y divide-rule border border-rule">
              @for (t of sequence(); track t.id; let i = $index) {
                <li class="flex items-center gap-2 px-3 py-2">
                  <span
                    class="flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px]
                           bg-primary font-mono text-[11px] font-semibold text-white"
                  >
                    {{ i + 1 }}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="font-mono text-[12px] text-ink-muted">{{ t.code }}</span>
                    <span class="ml-1.5 text-[13px] text-ink">{{ t.label }}</span>
                  </span>
                  <span class="shrink-0 text-[11px] font-medium" [class]="countClass(t)">
                    {{ t.checklistCount }}
                  </span>
                  <button
                    type="button"
                    class="shrink-0 p-1 text-ink-faint hover:text-primary disabled:opacity-30"
                    [disabled]="i === 0"
                    [attr.aria-label]="'Monter ' + t.label"
                    title="Monter d’un rang"
                    (click)="monter(i)"
                  >
                    <erp-icon name="arrow-up" [size]="13" />
                  </button>
                  <button
                    type="button"
                    class="shrink-0 p-1 text-ink-faint hover:text-primary disabled:opacity-30"
                    [disabled]="i === sequence().length - 1"
                    [attr.aria-label]="'Descendre ' + t.label"
                    title="Descendre d’un rang"
                    (click)="descendre(i)"
                  >
                    <erp-icon name="arrow-down" [size]="13" />
                  </button>
                  <button
                    type="button"
                    class="shrink-0 p-1 text-ink-faint hover:text-crit"
                    [attr.aria-label]="'Retirer ' + t.label"
                    title="Retirer du déroulé"
                    (click)="retirer(i)"
                  >
                    <erp-icon name="x" [size]="13" />
                  </button>
                </li>
              } @empty {
                <li class="empty px-3 py-3 text-[13px]">
                  Aucun type retenu. Sans type, aucun contrôle HSE ne s’oppose à l’opération et
                  l'opération ne pourra pas avancer.
                </li>
              }
            </ol>
          </div>
        </div>
      </div>
    </section>

    <!-- ============ Acheminement ============ -->
    <section class="card mb-5 overflow-hidden">
      <div class="card-header"><h2 class="card-title">Acheminement</h2></div>
      <div class="card-body">
        <div class="grid grid-cols-1 gap-x-5 gap-y-3.5 md:grid-cols-2">
          <div>
            <label class="label" for="volume">Volume prévu <span class="text-crit">*</span></label>
            <input
              id="volume"
              class="field text-right font-mono"
              inputmode="decimal"
              [(ngModel)]="plannedVolume"
            />
          </div>
          <div>
            <label class="label" for="uom">Unité <span class="text-crit">*</span></label>
            @if (uoms().length > 0) {
              <select id="uom" class="field" [(ngModel)]="uom">
                @for (u of uoms(); track u) {
                  <option [ngValue]="u">{{ u }}</option>
                }
              </select>
            } @else {
              <input id="uom" class="field font-mono" [(ngModel)]="uom" />
            }
          </div>

          <div>
            <label class="label" for="mode">
              Mode de transport <span class="text-crit">*</span>
            </label>
            @if (transportModes().length > 0) {
              <select id="mode" class="field" [(ngModel)]="transportMode">
                @for (m of transportModes(); track m) {
                  <option [ngValue]="m">{{ m }}</option>
                }
              </select>
            } @else {
              <input id="mode" class="field font-mono" [(ngModel)]="transportMode" />
            }
            <p class="mt-1 text-[11px] text-ink-faint">
              Le moyen physique. Il ne remplace pas le type : c’est le type qui indexe les
              contrôles.
            </p>
          </div>
          <div>
            <label class="label" for="chargement">Chargement prévu</label>
            <input id="chargement" type="date" class="field" [(ngModel)]="plannedLoadingDate" />
          </div>

          <div>
            <label class="label" for="origine">Origine <span class="text-crit">*</span></label>
            <input id="origine" class="field" maxlength="200" [(ngModel)]="originLocation" />
          </div>
          <div>
            <label class="label" for="dest">
              Destination <span class="text-crit">*</span>
            </label>
            <input id="dest" class="field" maxlength="200" [(ngModel)]="destinationLocation" />
          </div>

          <div>
            <label class="label" for="site">Site de livraison</label>
            <select id="site" class="field" [(ngModel)]="destinationSiteId">
              <option [ngValue]="''">Choisir</option>
              @for (s of sites(); track s.id) {
                <option [ngValue]="s.id">{{ s.label }}</option>
              }
            </select>
            <p class="mt-1 text-[11px] text-ink-faint">
              Site référencé du tiers, lorsque la livraison s’y fait. La destination reste
              saisie : toutes les livraisons ne se font pas sur un site connu.
            </p>

            <!-- ============ Ce que ce site exige ============
                 Affiché dès que le site est choisi. Les exigences se
                 saisissent au référentiel des sites ; ici on les LIT. Le
                 bloquant est distingué du reste par l'icône ET le mot, jamais
                 par la seule couleur (§ 17.2). -->
            @if (exigencesDuSite(); as ex) {
              @if (ex.length > 0) {
                <div class="mt-3 rounded-[3px] border border-rule-strong bg-gray-100 px-3.5 py-3">
                  <p class="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                    <erp-icon name="shield" [size]="14" />
                    Ce que ce site exige
                  </p>
                  <ul class="mt-2 space-y-2">
                    @for (e of ex; track e.id) {
                      <li class="text-[12px] leading-snug">
                        <span class="font-medium text-ink">{{ e.type.label }}</span>
                        @if (e.isBlocking) {
                          <span
                            class="ml-1.5 inline-flex items-center gap-1 rounded-[3px] bg-crit px-1.5
                                   py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                          >
                            <erp-icon name="lock" [size]="10" />
                            Bloquant
                          </span>
                        }
                        <span class="block text-ink-soft">{{ e.detail }}</span>
                      </li>
                    }
                  </ul>
                  @if (bloquantes() > 0) {
                    <p class="mt-2 text-[11px] leading-snug text-crit">
                      {{ bloquantes() }} exigence(s) bloquante(s) : l’opération ne pourra pas partir
                      au chargement tant qu’elles n’auront pas été levées et acquittées. S’y
                      présenter sans elles, c’est repartir à vide avec un produit déjà payé.
                    </p>
                  }
                </div>
              }
            }
          </div>
          <div>
            <label class="label" for="owner">Propriétaire du produit</label>
            <select id="owner" class="field" [(ngModel)]="productOwnerId">
              <option [ngValue]="''">Choisir</option>
              @for (p of partners(); track p.id) {
                <option [ngValue]="p.id">{{ p.code }} · {{ p.legalName }}</option>
              }
            </select>
            <p class="mt-1 text-[11px] text-ink-faint">
              À renseigner pour un transport pour compte de tiers, où le produit ne nous
              appartient pas.
            </p>
          </div>
        </div>

        <div class="mt-5 flex gap-2">
          <button class="btn-primary" (click)="submit()" [disabled]="state.busy() || !dealId">
            {{ state.busy() ? 'Création…' : 'Créer l’opération' }}
          </button>
          <a routerLink="/operations" class="btn-ghost">Annuler</a>
        </div>
      </div>
    </section>
  `,
})
export class OperationCreateComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  protected readonly state = new ActionState();

  protected readonly deals = signal<DealRow[]>([]);
  protected readonly types = signal<OperationTypeRow[]>([]);
  protected readonly sequence = signal<OperationTypeRow[]>([]);
  protected readonly partners = signal<Partner[]>([]);
  protected readonly sites = signal<SiteOption[]>([]);
  protected readonly segment = signal<string | null>(null);

  /** Registre de paramétrage — seule source d'API pour les énumérations. */
  private readonly catalogue = signal<ReferentialSpec[]>([]);
  protected readonly uoms = computed(() => this.enumValues(UOM_FIELDS));
  protected readonly transportModes = computed(() => this.enumValues(TRANSPORT_FIELDS));

  protected dealId = '';
  protected plannedVolume: number | null = null;
  protected uom = '';
  protected transportMode = '';
  protected originLocation = '';
  protected destinationLocation = '';
  protected destinationSiteId = '';

  /** Exigences du site actuellement choisi — vide tant qu'aucun n'est retenu. */
  protected readonly exigencesDuSite = computed(
    () => this.sites().find((s) => s.id === this.destinationSiteId)?.exigences ?? [],
  );
  protected readonly bloquantes = computed(
    () => this.exigencesDuSite().filter((e) => e.isBlocking).length,
  );
  protected plannedLoadingDate = '';
  protected productOwnerId = '';

  /** Types retenus n'apportant aucun contrôle — signalés avant l'envoi. */
  protected readonly sansControle = computed(() =>
    this.sequence().filter((t) => t.checklistCount === 0),
  );

  protected readonly sansControleCodes = computed(() =>
    this.sansControle()
      .map((t) => t.label)
      .join(', '),
  );

  /**
   * Somme des checklists rattachées, et non le compte de l'union : deux types
   * peuvent partager un modèle, et le dédoublonnage se fait au montage de la
   * checklist, côté serveur. Le nombre affiché est un ordre de grandeur.
   */
  protected readonly totalChecklists = computed(() =>
    this.sequence().reduce((n, t) => n + t.checklistCount, 0),
  );

  ngOnInit(): void {
    this.api.deals(1, {}).subscribe((p) => this.deals.set(p.items));
    this.api.parameterCatalogue().subscribe((c) => this.catalogue.set(c));
    this.loadTypes(null);
    this.api.partners(1).subscribe((p) => {
      this.partners.set(p.items);
      this.sites.set(
        p.items.flatMap((partner) =>
          partner.sites.map((s) => ({
            id: s.id,
            label: `${partner.legalName} · ${s.name}${s.city ? ' (' + s.city + ')' : ''}`,
            // Les exigences viennent du LIEU que ce rattachement désigne.
            // ⚠️ CORRIGÉ — `deliverySite` n'existe pas côté serveur (`site`) :
            //    cette liste était TOUJOURS vide, le bandeau ne s'affichait
            //    jamais (§ api.service.ts).
            exigences: s.site?.requirements ?? [],
          })),
        ),
      );
    });
  }

  protected statusLabel(code: string): string {
    return dealStatus(code).label;
  }

  /**
   * Choix de l'affaire : elle porte le contexte de l'opération.
   *
   * Volume, unité, mode et lieu de livraison en sont préremplis — ce sont les
   * valeurs contractées, celles qu'on reprend neuf fois sur dix. Elles restent
   * modifiables : une affaire s'exécute souvent en plusieurs opérations.
   */
  protected onDealChange(): void {
    if (!this.dealId) {
      this.segment.set(null);
      this.loadTypes(null);
      return;
    }
    this.api.deal(this.dealId).subscribe((d) => {
      this.segment.set(d.segment);
      this.plannedVolume = Number(d.contractedVolume);
      this.uom = d.uom;
      // Nul pour une affaire sur produit service (barge) : rien à reprendre,
      // l'opération porte alors son propre mode de transport.
      if (d.transportMode) this.transportMode = d.transportMode;
      if (!this.destinationLocation) this.destinationLocation = d.deliveryLocation;
      this.loadTypes(d.segment);
    });
  }

  /**
   * Les types déjà retenus ne sont PAS purgés au changement d'affaire.
   *
   * Ils restent dans le déroulé avec leurs données, visibles et retirables.
   * Les écarter en silence parce que le segment a changé ferait disparaître un
   * choix délibéré sans que personne ne l'ait demandé.
   */
  private loadTypes(segment: string | null): void {
    this.api.operationTypes(segment ?? undefined).subscribe((t) => this.types.set(t));
  }

  protected retenu(t: OperationTypeRow): boolean {
    return this.sequence().some((s) => s.id === t.id);
  }

  protected countClass(t: OperationTypeRow): string {
    return t.checklistCount === 0 ? 'text-warn-ink' : 'text-ink-faint';
  }

  /** L'ajout se fait EN FIN de déroulé : on compose dans l'ordre du terrain. */
  protected ajouter(t: OperationTypeRow): void {
    if (this.retenu(t)) return;
    this.sequence.update((s) => [...s, t]);
  }

  protected retirer(index: number): void {
    this.sequence.update((s) => s.filter((_, i) => i !== index));
  }

  protected monter(index: number): void {
    this.echanger(index, index - 1);
  }

  protected descendre(index: number): void {
    this.echanger(index, index + 1);
  }

  private echanger(a: number, b: number): void {
    this.sequence.update((s) => {
      if (a < 0 || b < 0 || a >= s.length || b >= s.length) return s;
      const next = [...s];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
  }

  /**
   * Valeurs admises d'une énumération, lues dans le registre de paramétrage.
   *
   * On retient le premier champ trouvé qui porte l'un des noms attendus : le
   * registre dérive ces listes du schéma Prisma, elles sont donc identiques
   * d'un référentiel à l'autre.
   */
  private enumValues(names: string[]): string[] {
    for (const spec of this.catalogue()) {
      for (const field of spec.fields) {
        if (names.includes(field.name) && field.values?.length) return field.values;
      }
    }
    return [];
  }

  /**
   * Envoi. Les champs facultatifs vides ne sont PAS transmis : une chaîne vide
   * n'est ni un identifiant ni une date, et le serveur la rejetterait comme
   * telle alors que l'utilisateur n'a simplement rien renseigné.
   */
  protected submit(): void {
    if (this.state.busy()) return;
    this.state.start();

    this.api
      .createOperation({
        dealId: this.dealId,
        plannedVolume: Number(this.plannedVolume ?? 0),
        uom: this.uom,
        transportMode: this.transportMode,
        // L'ordre du tableau EST le déroulé : aucun tri ne s'intercale ici.
        operationTypeIds: this.sequence().map((t) => t.id),
        originLocation: this.originLocation,
        destinationLocation: this.destinationLocation,
        destinationSiteId: this.destinationSiteId || undefined,
        plannedLoadingDate: this.plannedLoadingDate || undefined,
        productOwnerId: this.productOwnerId || undefined,
      })
      .subscribe({
        next: (o) => {
          this.state.succeed(`Opération ${o.reference} créée.`);
          void this.router.navigate(['/operations', o.id]);
        },
        error: (e: HttpFailure) => this.state.fail(e),
      });
  }
}
