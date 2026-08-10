import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

/**
 * PAGINATION ET RECHERCHE, EN UNE SEULE PIÈCE.
 *
 * ⚠️ TRENTE-SEPT TABLEAUX, DIX-SEPT ÉCRANS, AUCUNE PAGINATION.
 *
 *    Chaque écran affichait sa liste entière. Tant que la base contient
 *    quelques dizaines de lignes, cela ne se voit pas ; à mille factures, la
 *    page devient illisible et lente, et chercher une référence précise se
 *    fait à la molette.
 *
 *    Écrire trente-sept paginations serait la mauvaise réponse : elles
 *    diveregeraient — ici vingt lignes par page, là cinquante ; ici la
 *    recherche sensible à la casse, là non. Une seule mécanique, partagée.
 *
 * ⚠️ ELLE NE TOUCHE PAS AU RENDU DES CELLULES.
 *
 *    Les tableaux de cette application portent des pastilles d'état, des
 *    teintes de sévérité, des liens. Une grille générique qui les remplacerait
 *    perdrait tout cela. Ici, l'écran garde son gabarit : il itère sur
 *    `page()` au lieu de sa liste, et pose la barre de contrôle au-dessus.
 */
/**
 * Ce dont la barre de navigation a besoin, et rien de plus.
 *
 * ⚠️ UN CONTRAT, PAS UNE CLASSE GÉNÉRIQUE.
 *
 *    `TableauPagine<T>` est invariant en T : passer un `TableauPagine<Facture>`
 *    là où un `TableauPagine<Ligne>` est attendu ne compile pas. Chaque écran
 *    aurait dû convertir son tableau pour le donner à la barre — et une
 *    conversion posée pour satisfaire un type finit par en masquer une vraie.
 *
 *    La barre ne lit jamais une ligne : elle compte et elle navigue. Ce
 *    contrat dit exactement cela, et n'importe quel tableau le remplit.
 */
export interface TableauNavigable {
  recherche(): string;
  chercher(q: string): void;
  page(): number;
  pages(): number;
  taille(): number;
  total(): number;
  premier(): number;
  dernier(): number;
  allerA(p: number): void;
  taillePage(n: number): void;
}

export class TableauPagine<T> implements TableauNavigable {
  private readonly source = signal<T[]>([]);
  readonly recherche = signal('');
  readonly page = signal(1);
  readonly taille = signal(25);

  /**
   * Champs sur lesquels la recherche porte.
   *
   * Vide = toutes les valeurs de la ligne, converties en texte. C'est le
   * comportement attendu d'une barre de recherche : on tape ce qu'on voit à
   * l'écran, sans se demander dans quelle colonne cela tombe.
   */
  constructor(private readonly champs: (keyof T | string)[] = []) {}

  définir(lignes: T[]): void {
    this.source.set(lignes ?? []);
    // Revenir en première page : rester en page 7 d'une liste qui vient d'en
    // compter deux afficherait un tableau vide sans rien expliquer.
    this.page.set(1);
  }

  readonly filtrées = computed(() => {
    const q = this.recherche().trim().toLowerCase();
    if (!q) return this.source();
    return this.source().filter((l) => this.texteDe(l).includes(q));
  });

  readonly total = computed(() => this.filtrées().length);
  readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.taille())));

  readonly lignes = computed(() => {
    // La page courante peut dépasser après un filtrage : on la borne à la
    // lecture plutôt que de laisser un tableau vide.
    const p = Math.min(this.page(), this.pages());
    const debut = (p - 1) * this.taille();
    return this.filtrées().slice(debut, debut + this.taille());
  });

  readonly premier = computed(() => (this.total() === 0 ? 0 : (Math.min(this.page(), this.pages()) - 1) * this.taille() + 1));
  readonly dernier = computed(() => Math.min(this.premier() + this.taille() - 1, this.total()));

  chercher(q: string): void {
    this.recherche.set(q);
    this.page.set(1);
  }

  allerA(p: number): void {
    this.page.set(Math.min(Math.max(1, p), this.pages()));
  }

  taillePage(n: number): void {
    this.taille.set(n);
    this.page.set(1);
  }

  private texteDe(ligne: T): string {
    const valeurs =
      this.champs.length > 0
        ? this.champs.map((c) => (ligne as Record<string, unknown>)[c as string])
        : Object.values(ligne as Record<string, unknown>);
    return valeurs
      .map((v) => {
        if (v === null || v === undefined) return '';
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
      })
      .join(' ')
      .toLowerCase();
  }
}

/**
 * Barre de recherche et de pagination.
 *
 * Se pose au-dessus ou au-dessous d'un tableau, et pilote un `TableauPagine`.
 * Elle affiche toujours le décompte, y compris quand il tient sur une page :
 * savoir qu'on voit « 12 sur 12 » vaut mieux que de le supposer.
 */
@Component({
  selector: 'erp-tableau-controles',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3 px-[15px] py-2.5">
      <div class="flex items-center gap-2">
        <input
          type="search"
          class="field h-8 w-56 text-[13px]"
          [attr.aria-label]="'Rechercher dans ' + libelle"
          [placeholder]="'Rechercher dans ' + libelle"
          [ngModel]="tableau.recherche()"
          (ngModelChange)="tableau.chercher($event)"
        />
        @if (tableau.recherche()) {
          <button type="button" class="link text-[12px]" (click)="tableau.chercher('')">
            Effacer
          </button>
        }
      </div>

      <div class="flex items-center gap-3 text-[12px] text-ink-soft">
        <span class="tabular">
          @if (tableau.total() === 0) {
            Aucune ligne
          } @else {
            {{ tableau.premier() }} à {{ tableau.dernier() }} sur {{ tableau.total() }}
          }
        </span>

        <select
          class="field h-8 w-[92px] text-[12px]"
          aria-label="Lignes par page"
          [ngModel]="tableau.taille()"
          (ngModelChange)="tableau.taillePage(+$event)"
        >
          @for (n of tailles; track n) {
            <option [ngValue]="n">{{ n }} / page</option>
          }
        </select>

        <div class="flex items-center gap-1">
          <button
            type="button"
            class="btn-ghost h-8 px-2 text-[12px]"
            [disabled]="tableau.page() <= 1"
            (click)="tableau.allerA(tableau.page() - 1)"
          >
            Précédent
          </button>
          <span class="tabular px-1">{{ tableau.page() }} / {{ tableau.pages() }}</span>
          <button
            type="button"
            class="btn-ghost h-8 px-2 text-[12px]"
            [disabled]="tableau.page() >= tableau.pages()"
            (click)="tableau.allerA(tableau.page() + 1)"
          >
            Suivant
          </button>
        </div>
      </div>
    </div>
  `,
})
export class TableauControlesComponent {
  /**
   * Le tableau piloté.
   *
   * ⚠️ TYPÉ `unknown`, ET NON `Record<string, unknown>`.
   *
   *    Chaque écran a ses propres lignes — `ExpiryItem`, `CrmPipelineRow`. Un
   *    paramètre plus étroit obligeait chacun à convertir son tableau pour le
   *    passer ici, et une conversion posée pour satisfaire un type finit par
   *    en masquer une vraie. La barre n'a besoin que de compter et de
   *    naviguer : elle n'ouvre jamais une ligne.
   */
  @Input({ required: true }) tableau!: TableauNavigable;

  /** Ce qu'on cherche, en toutes lettres — « Rechercher dans les affaires ». */
  @Input() libelle = 'la liste';

  protected readonly tailles = [10, 25, 50, 100];
}

/**
 * Barre de navigation d'une liste PAGINÉE PAR LE SERVEUR.
 *
 * ⚠️ CINQ ÉCRANS PERDAIENT DES DONNÉES EN SILENCE.
 *
 *    Factures, opérations, achats, documents et tiers appellent une API déjà
 *    paginée, lisent la première page, et n'affichaient aucune commande. La
 *    taille de page valant 50, tout ce qui suivait la cinquantième ligne
 *    existait en base et ne s'affichait nulle part — sans compteur, sans
 *    message, sans rien.
 *
 *    On aurait découvert le défaut en cherchant une facture « qui n'existe
 *    pas ». C'est la même famille que la coupure muette à 500 lignes du
 *    paramétrage : une liste tronquée qui se présente comme complète.
 *
 * Distincte de la barre client : ici la page est demandée au serveur, et le
 * total vient de lui. Mélanger les deux mécaniques dans un seul composant
 * aurait obligé chaque écran à savoir laquelle il utilise.
 */
@Component({
  selector: 'erp-pagination',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (total > 0) {
      <div
        class="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-[15px] py-2.5
               text-[12px] text-ink-soft"
      >
        <span class="tabular">
          {{ premier() }} à {{ dernier() }} sur {{ total }} {{ libelle }}
        </span>
        @if (totalPages > 1) {
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="btn-ghost h-8 px-2 text-[12px]"
              [disabled]="page <= 1"
              (click)="allerA.emit(page - 1)"
            >
              Précédent
            </button>
            <span class="tabular px-1">{{ page }} / {{ totalPages }}</span>
            <button
              type="button"
              class="btn-ghost h-8 px-2 text-[12px]"
              [disabled]="page >= totalPages"
              (click)="allerA.emit(page + 1)"
            >
              Suivant
            </button>
          </div>
        }
      </div>
    }
  `,
})
export class PaginationComponent {
  @Input({ required: true }) page = 1;
  @Input({ required: true }) totalPages = 1;
  @Input({ required: true }) total = 0;
  @Input() pageSize = 50;
  /** Ce qu'on compte, au pluriel : « factures », « opérations ». */
  @Input() libelle = 'lignes';

  @Output() readonly allerA = new EventEmitter<number>();

  protected premier(): number {
    return this.total === 0 ? 0 : (this.page - 1) * this.pageSize + 1;
  }

  protected dernier(): number {
    return Math.min(this.page * this.pageSize, this.total);
  }
}


/**
 * RECHERCHE SEULE, POUR LES TABLEAUX D'ANALYSE.
 *
 * ⚠️ CES TABLEAUX-LÀ N'ONT PAS BESOIN DE PAGINATION.
 *
 *    Point mort, marge par segment, performance par commercial, couverture
 *    budgétaire : ils sont bornés par construction — une ligne par segment,
 *    par pool, par personne. Les paginer n'apporterait rien.
 *
 *    Ce qui manque, c'est de retrouver une ligne sans parcourir des yeux :
 *    un pool parmi quinze, un commercial parmi douze. Un champ, au-dessus du
 *    tableau, qui cherche dans TOUT ce que la ligne contient.
 */
export interface FiltreNavigable {
  terme(): string;
  chercher(q: string): void;
  total(): number;
  retenues(): number;
}

export class FiltreTexte<T> implements FiltreNavigable {
  private readonly source = signal<T[]>([]);
  readonly terme = signal('');

  définir(lignes: T[]): void {
    this.source.set(lignes ?? []);
  }

  readonly lignes = computed(() => {
    const q = this.terme().trim().toLowerCase();
    if (!q) return this.source();
    return this.source().filter((l) => this.texteDe(l).includes(q));
  });

  readonly total = computed(() => this.source().length);
  readonly retenues = computed(() => this.lignes().length);

  chercher(q: string): void {
    this.terme.set(q);
  }

  /**
   * Tout ce que la ligne porte, mis à plat.
   *
   * On cherche dans les valeurs imbriquées aussi : le nom du client d'une
   * opportunité, le code d'un produit. Se limiter au premier niveau
   * obligerait à savoir comment la donnée est rangée pour la retrouver.
   */
  private texteDe(ligne: T): string {
    const morceaux: string[] = [];
    const parcourir = (v: unknown, profondeur = 0): void => {
      if (v === null || v === undefined || profondeur > 3) return;
      if (typeof v === 'object') {
        for (const x of Object.values(v as Record<string, unknown>)) parcourir(x, profondeur + 1);
        return;
      }
      morceaux.push(String(v));
    };
    parcourir(ligne);
    return morceaux.join(' ').toLowerCase();
  }
}

@Component({
  selector: 'erp-recherche',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="flex flex-wrap items-center gap-2 px-[15px] py-2.5">
      <input
        type="search"
        class="field h-8 w-64 text-[13px]"
        [attr.aria-label]="'Rechercher dans ' + libelle"
        [placeholder]="'Rechercher dans ' + libelle"
        [ngModel]="filtre.terme()"
        (ngModelChange)="filtre.chercher($event)"
      />
      @if (filtre.terme()) {
        <span class="text-[12px] tabular text-ink-soft">
          {{ filtre.retenues() }} sur {{ filtre.total() }}
        </span>
        <button type="button" class="link text-[12px]" (click)="filtre.chercher('')">
          Effacer
        </button>
      }
    </div>
  `,
})
export class RechercheComponent {
  @Input({ required: true }) filtre!: FiltreNavigable;
  /** Ce qu'on parcourt, en toutes lettres — « les pools », « les segments ». */
  @Input() libelle = 'le tableau';
}
