import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AllocationBasis,
  CommercialSegment,
  CostNature,
  Prisma,
} from '@prisma/client';
import { SettingsService } from '../common/config/settings.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { round4 } from '../common/money/money';

/**
 * Base annuelle du coût de portage — REPLI de `CARRYING_DAYS_PER_YEAR`.
 *
 * 360 est la base commerciale, celle des conditions bancaires locales. Une
 * banque qui facture en base 365 impose de changer ce paramètre, faute de
 * quoi le portage est sous-estimé de 1,4 % — invisible à l'unité, sensible
 * sur un an de volume.
 */
const CARRYING_DAYS_PER_YEAR_FALLBACK = 360;

export interface MarginBreakdown {
  /** Tout est unitaire, dans la devise et l'unité du deal. */
  unitSalePrice: number;
  unitPurchasePrice: number;
  directChargesPerUnit: number;
  carryingCostPerUnit: number;
  indirectChargesPerUnit: number;
  directMargin: number;
  fullMargin: number;
  /** Détail du cycle de trésorerie ayant servi au portage. */
  carryingCycleDays: number;
  financingRatePct: number;
  /** Vrai quand les charges viennent des opérations, faux quand elles
   *  proviennent encore du chiffrage de l'affaire. */
  chargesFromOperations: boolean;
  /** D'où viennent les charges retenues — à afficher, jamais à deviner. */
  chargesSource: 'operations' | 'devis' | 'agrege';
  /** Totaux, pour les montants portés par le Deal. */
  totals: {
    saleAmount: number;
    purchaseAmount: number;
    directCharges: number;
    indirectCharges: number;
    carryingCost: number;
  };
}

export interface ThresholdVerdict {
  configured: boolean;
  directFloor: number | null;
  minimumMargin: number | null;
  currencyCode: string | null;
  uom: string | null;
  /** Sous le plancher : blocage dur, dérogation du DG obligatoire. */
  belowDirectFloor: boolean;
  /** Sous le seuil : accord du DG requis, mais pas un refus. */
  belowMinimumMargin: boolean;
  message: string;
}

/**
 * Calcul de la chaîne de marge (SPECIFICATIONS.md § 5.4).
 *
 * Rien ici n'est saisi : tout se déduit du prix de vente, du prix d'achat et
 * des charges. Le service est la SEULE implémentation de ce calcul côté
 * application — les seuils, eux, sont appliqués en base.
 */
@Injectable()
export class MarginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Coût de portage financier (§ 5.4).
   *
   * Elyon paie ses fournisseurs AVANT livraison et encaisse après : le cycle
   * est intégralement financé. Sur une marge de l'ordre de 4 %, ce coût pèse
   * lourd — 45 jours de délai client consomment près d'un tiers du plancher.
   *
   *   Portage = coût d'achat × taux annuel × cycle ÷ base annuelle
   *
   * La base annuelle est paramétrée (`CARRYING_DAYS_PER_YEAR`) et passée en
   * argument plutôt que lue ici : le calcul reste une fonction pure, donc
   * vérifiable à la main face à un tableur, ce qu'une lecture base au milieu
   * de la formule rendrait impossible.
   */
  /**
   * Conditions financières de l'exercice courant.
   *
   * Une seule lecture, au même endroit, pour le taux, le millésime et la base
   * de jours. Les trois se répondent : un taux de 2026 employé avec la base de
   * jours d'un autre exercice donnerait un portage qu'aucun document ne
   * justifie.
   *
   * ⚠️ LE REPLI SUR LES RÉGLAGES GLOBAUX EST CONSERVÉ, MAIS IL VIENT APRÈS.
   *
   *    Il ne sert qu'aux bases où aucun exercice n'est encore déclaré. Dès
   *    qu'un exercice porte ses conditions, ce sont elles qui gouvernent —
   *    c'est tout l'objet du rattachement à l'exercice.
   */
  private async conditionsDeLExercice(): Promise<{
    financingRatePct: number;
    fiscalYear: number;
    daysPerYear: number;
  }> {
    const exercice = await this.prisma.fiscalYear.findFirst({
      where: { isCurrent: true },
      select: {
        year: true,
        financingRates: {
          where: { isCurrent: true },
          select: { annualRatePct: true, carryingDaysPerYear: true },
          take: 1,
        },
      },
    });

    const taux = exercice?.financingRates[0];

    // ⚠️ ON REFUSE DE CALCULER PLUTÔT QUE DE PORTER À TAUX ZÉRO.
    //
    //    Sans taux, le coût de portage vaudrait zéro et la marge affichée
    //    serait FLATTEUSE : sur un cycle de 45 jours et un prix d'achat de
    //    700 F, ce sont environ 10 F par litre qui disparaissent — l'ordre de
    //    grandeur du seuil lui-même. Une affaire à refuser passerait, et rien
    //    à l'écran ne dirait pourquoi.
    //
    //    Le refus nomme la donnée manquante et l'écran où la saisir. La file
    //    de tâches la réclame déjà au directeur financier.
    if (!exercice) {
      throw new BadRequestException(
        'Aucun exercice comptable n’est déclaré courant. La marge dépend des conditions de financement de l’exercice : déclarez-le au paramétrage, rubrique Exercices comptables.',
      );
    }
    if (!taux) {
      throw new BadRequestException(
        `Aucun taux de financement n’est saisi pour l’exercice ${exercice.year}. Le coût de portage en dépend, et le calculer à taux zéro donnerait une marge flatteuse : saisissez-le au paramétrage, rubrique Taux de financement.`,
      );
    }

    return {
      financingRatePct: Number(taux.annualRatePct),
      fiscalYear: exercice.year,
      daysPerYear: taux.carryingDaysPerYear,
    };
  }

  computeCarryingCost(
    unitPurchasePrice: number,
    clientPaymentTermsDays: number,
    supplierTermsDays: number,
    financingRatePct: number,
    daysPerYear: number = CARRYING_DAYS_PER_YEAR_FALLBACK,
  ): { perUnit: number; cycleDays: number } {
    // ⚠️ LE CYCLE VA DU DÉCAISSEMENT À L'ENCAISSEMENT.
    //
    //    § 5.4 : cycle = (paiement fournisseur → livraison) + (livraison →
    //    encaissement client). Un délai fournisseur NÉGATIF est un
    //    prépaiement : ces jours-là s'ajoutent. Un délai POSITIF est du crédit
    //    fournisseur : ces jours-là se RETRANCHENT — l'argent n'est pas encore
    //    sorti.
    //
    //    Le crédit fournisseur n'était pas retranché : un client à 45 jours et
    //    un fournisseur accordant 30 jours donnaient un cycle de 45 au lieu de
    //    15. Portage surestimé de 5,83 FCFA/L, soit 19 % du seuil minimum —
    //    dans le sens conservateur, donc on refusait de bonnes affaires sans
    //    savoir pourquoi.
    //
    //    Le cycle ne descend pas sous zéro : un fournisseur plus patient que
    //    le client ne RAPPORTE pas d'argent, il cesse simplement d'en coûter.
    const cycleDays = Math.max(0, Math.max(0, clientPaymentTermsDays) - supplierTermsDays);
    // Une base nulle ou négative rendrait un portage infini, et une marge
    // affichée à -Infinity sur tous les deals. Le paramètre aberrant ne doit
    // pas emporter le calcul avec lui.
    const base = daysPerYear > 0 ? daysPerYear : CARRYING_DAYS_PER_YEAR_FALLBACK;
    const perUnit = (unitPurchasePrice * (financingRatePct / 100) * cycleDays) / base;
    return { perUnit: round4(perUnit), cycleDays };
  }

  /**
   * Charge indirecte unitaire — somme des taux d'absorption applicables.
   *
   * ⚠️ Le taux repose sur une assiette BUDGÉTÉE, jamais réalisée (§ 14.2).
   *    Un dénominateur réalisé déclencherait la spirale d'absorption.
   *
   * ⚠️ L'ASSIETTE DE L'AFFAIRE A DISPARU DE LA SIGNATURE, ET C'EST NORMAL.
   *
   *    Elle ne servait qu'aux bases « par opération » et « au prorata du
   *    chiffre d'affaires », toutes deux refusées désormais : l'assiette se
   *    dérive de la prévision de vente, qui prévoit des VOLUMES. Un taux au
   *    litre est déjà par unité vendue — il n'y a rien à ramener.
   *
   *    La garder « au cas où » aurait laissé croire au lecteur suivant qu'elle
   *    influence le résultat.
   */
  async indirectChargesPerUnit(
    segment: CommercialSegment,
    fiscalYear: number,
  ): Promise<number> {
    // L'exercice est une RÉFÉRENCE, plus un entier libre : on le désigne par
    // son millésime — c'est ainsi qu'un humain le nomme — mais la jointure
    // garantit qu'il existe. Un taux saisi pour un exercice inexistant ne
    // pouvait auparavant être ni trouvé ni signalé : il disparaissait des
    // calculs sans rien dire.
    const rates = await this.prisma.absorptionRate.findMany({
      where: { fiscalYear: { year: fiscalYear }, isCurrent: true },
      include: { costPool: { select: { code: true, segments: true, allocationBasis: true } } },
    });

    const applicables = rates.filter(
      // Un regroupement sans segment déclaré s'applique à tous.
      (r) => r.costPool.segments.length === 0 || r.costPool.segments.includes(segment),
    );

    // ⚠️ L'ASSIETTE D'IMPUTATION EST APPLIQUÉE, PLUS SEULEMENT LUE.
    //
    //    `allocationBasis` était sélectionné dans la requête puis IGNORÉ : tous
    //    les taux étaient additionnés comme s'ils étaient au litre. Les trois
    //    pools existants le sont, donc le calcul était juste — et il serait
    //    devenu faux au premier pool créé depuis l'écran de paramétrage, sans
    //    aucun signal.
    //
    //    Ce que chaque base signifie, une fois ramenée au litre :
    //
    //      PER_VOLUME     le taux EST déjà par unité vendue.
    //      PER_OPERATION  un montant par rotation → × nombre d'opérations,
    //                     ÷ volume. Un pool à 250 000 F par opération valait
    //                     250 000 F PAR LITRE.
    //
    //    ⚠️ PER_REVENUE EST REFUSÉ, ET CE N'EST PAS UN OUBLI.
    //
    //       L'assiette d'absorption est un VOLUME budgété (§ 14.2). Le volume
    //       est ce que l'entreprise pilote ; le prix ne l'est pas — il suit les
    //       publications DGH et le taux de change. Imputer au prorata du
    //       chiffre d'affaires ferait bouger la charge fixe unitaire à chaque
    //       publication de prix, sans qu'aucune charge n'ait changé et sans que
    //       rien ne le signale.
    //
    //       J'avais implémenté cette base — × CA ÷ volume. Aucun pool actif ne
    //       l'employait, donc rien ne se voyait ; le premier pool créé depuis
    //       l'écran de paramétrage aurait suffi à faire dériver le seuil de
    //       marge au rythme des prix administrés.
    //
    //       La base est refusée en base de données aussi, sur les pools actifs.
    //       Ce refus-ci reste utile : il couvre les lignes historiques qui la
    //       portent encore.
    const perUnit = (r: (typeof applicables)[number]): number => {
      const taux = Number(r.ratePerUnit);
      switch (r.costPool.allocationBasis) {
        case AllocationBasis.PER_VOLUME:
          // Le taux EST déjà par unité vendue : budget ÷ volume budgété.
          return taux;
        // ⚠️ PER_OPERATION EST REFUSÉ À SON TOUR, ET C'EST UN CHOIX DE GESTION.
        //
        //    Le dirigeant, le 9 août : « Pools imputés à l'opération : non ».
        //    La raison de fond est que l'assiette se DÉRIVE désormais de la
        //    prévision de vente, qui prévoit des volumes et non des rotations.
        //    Un pool imputé à l'opération n'aurait aucun dénominateur à lire,
        //    et lui en faire saisir un rouvrirait la double saisie supprimée.
        case AllocationBasis.PER_OPERATION:
          throw new BadRequestException(
            `Le pool ${r.costPool.code} s'impute au nombre d'opérations, ce que l'assiette d'absorption n'admet plus : elle est la somme des volumes de prévision budgétée. Aucune prévision ne porte un nombre de rotations. Basculer ce pool en PER_VOLUME.`,
          );
        case AllocationBasis.PER_REVENUE:
          throw new BadRequestException(
            `Le pool ${r.costPool.code} s'impute au prorata du chiffre d'affaires, ce que l'assiette d'absorption n'admet pas : elle est un VOLUME budgété. Le volume est piloté, le prix ne l'est pas : une assiette en valeur ferait dériver la charge fixe unitaire à chaque publication DGH. Basculer ce pool en PER_VOLUME.`,
          );
        default:
          // Base inconnue — une valeur ajoutée à l'énumération sans que ce
          // calcul suive. On ne devine PAS : compter zéro sous-estimerait le
          // coût de revient en silence, ce qui est exactement le défaut qu'on
          // vient de corriger.
          throw new BadRequestException(
            `Base d'imputation « ${r.costPool.allocationBasis} » non prise en charge par le calcul de marge (pool ${r.costPool.code}). Le coût de revient serait faux : corrigez le paramétrage ou faites évoluer le calcul.`,
          );
      }
    };

    return round4(applicables.reduce((sum, r) => sum + perUnit(r), 0));
  }

  /**
   * Charges directes constatées sur les opérations du deal.
   *
   * ⚠️ DEUX POSTES SONT EXCLUS parce que la formule de marge les porte déjà
   *    explicitement. Les additionner ici les compterait DEUX FOIS :
   *
   *      ACHAT_PRODUIT      — déjà soustrait via unitPurchasePrice
   *      PORTAGE_FINANCIER  — déjà calculé par computeCarryingCost
   *
   *    Les lignes existent malgré tout : elles servent au rapprochement avec
   *    les factures fournisseurs (§ 14.6), qui a besoin du coût complet.
   *
   *    La liste est paramétrée (`MARGIN_EXCLUDED_COST_POSTS`) : le barème de
   *    coûts est administrable, un poste nouveau qui doublonnerait la formule
   *    doit pouvoir être exclu sans livraison.
   *
   * Retourne null tant qu'aucune ligne n'existe — le deal n'a pas encore
   * d'opération, et 0 serait un chiffre faux plutôt qu'une absence.
   */
  static readonly CHARGES_ALREADY_IN_FORMULA = ['ACHAT_PRODUIT', 'PORTAGE_FINANCIER'];

  /** Codes des postes que la formule porte déjà, tels que paramétrés. */
  private excludedCostPosts(): Promise<string[]> {
    return this.settings.list(
      'MARGIN_EXCLUDED_COST_POSTS',
      MarginService.CHARGES_ALREADY_IN_FORMULA,
    );
  }

  async directChargesForDeal(dealId: string): Promise<number | null> {
    const lines = await this.prisma.operationCostLine.findMany({
      where: {
        operation: { dealId },
        costPost: {
          nature: CostNature.DIRECT,
          code: { notIn: await this.excludedCostPosts() },
        },
      },
    });

    if (lines.length === 0) return null;

    // ⚠️ CHAQUE LIGNE EST RAMENÉE DANS LA DEVISE DE L'AFFAIRE.
    //
    //    Les montants étaient additionnés BRUTS, quelle que soit leur devise.
    //    Une inspection facturée 5 000 USD comptait donc pour 5 000 FCFA dans
    //    la marge d'une affaire en XOF : charge sous-estimée de 3 022 100 FCFA
    //    au cours de 605,42, et marge directe surestimée d'autant.
    //
    //    Le cours retenu est celui FIGÉ SUR LA LIGNE au moment de sa saisie,
    //    jamais celui du jour : une marge qui bouge parce que le dollar a
    //    bougé n'est plus une marge, c'est un résultat de change.
    return round4(
      lines.reduce(
        (sum, l) =>
          sum + Number(l.actualAmount ?? l.estimatedAmount) * Number(l.fxRateToDeal ?? 1),
        0,
      ),
    );
  }

  /**
   * Charges directes CHIFFRÉES sur l'affaire, par le commercial (§ 5.4).
   *
   * C'est la source du devis, celle sur laquelle le CFO approuve. Les mêmes
   * exclusions s'appliquent : achat et portage sont déjà portés par la
   * formule, les additionner ici les compterait deux fois.
   */
  async quotedChargesForDeal(dealId: string): Promise<number | null> {
    const lines = await this.prisma.dealCostLine.findMany({
      where: {
        dealId,
        costPost: {
          nature: CostNature.DIRECT,
          code: { notIn: await this.excludedCostPosts() },
        },
      },
    });

    if (lines.length === 0) return null;
    return round4(lines.reduce((sum, l) => sum + Number(l.estimatedAmount), 0));
  }

  /**
   * Recalcule intégralement la chaîne pour un deal.
   * Aucun montant n'est repris de l'existant : tout est dérivé.
   */
  /**
   * Cours entre deux devises, à l'instant présent.
   *
   * Exposé ici pour que TOUT ce qui alimente une marge fige son cours au même
   * endroit et de la même façon. Un second résolveur ailleurs finirait par
   * choisir une autre ligne de taux, et deux charges saisies le même jour ne
   * se compareraient plus.
   */
  async rateBetween(depuis: string, vers: string): Promise<number> {
    if (depuis === vers) return 1;
    const direct = await this.prisma.fxRate.findFirst({
      where: {
        baseCurrencyCode: depuis,
        quoteCurrencyCode: vers,
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (direct) return Number(direct.rate);

    // Paire absente : on inverse la paire opposée plutôt que d'échouer — un
    // cours USD/XOF publié vaut aussi pour XOF/USD.
    const inverse = await this.prisma.fxRate.findFirst({
      where: {
        baseCurrencyCode: vers,
        quoteCurrencyCode: depuis,
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (inverse && Number(inverse.rate) !== 0) return 1 / Number(inverse.rate);

    throw new BadRequestException(
      `Aucun cours de change entre ${depuis} et ${vers}. Saisissez-le au référentiel avant d'enregistrer une charge dans cette devise : sans lui, elle serait comptée à l'unité près comme si les deux monnaies se valaient.`,
    );
  }

  /**
   * Réécrit les agrégats de marge stockés sur l'affaire.
   *
   * Vit ICI, et non dans le service des affaires : c'est un calcul de marge,
   * et il doit pouvoir être déclenché par tout ce qui change une charge — y
   * compris une ligne de coût d'opération. L'y laisser aurait imposé une
   * dépendance circulaire entre les deux services.
   */
  async recompute(dealId: string) {
    const b = await this.computeForDeal(dealId);
    return this.prisma.deal.update({
      where: { id: dealId },
      data: {
        // ⚠️ L'AGRÉGAT SUIT TOUJOURS LA MARGE DE LA MÊME LIGNE.
        //
        //    Il n'était réécrit que si les charges venaient des opérations.
        //    Une affaire chiffrée au devis affichait donc `charges directes =
        //    0` à côté d'une marge calculée SUR ces charges : la colonne et la
        //    marge de la même ligne racontaient deux histoires incompatibles,
        //    et tout ce qui lit la colonne — reporting, coût complet, point
        //    mort — voyait une affaire sans charges.
        estimatedDirectCharges: b.totals.directCharges.toFixed(4),
        estimatedIndirectCharges: b.totals.indirectCharges.toFixed(4),
        estimatedCarryingCost: b.totals.carryingCost.toFixed(4),
        estimatedDirectMargin: b.directMargin.toFixed(4),
        estimatedFullMargin: b.fullMargin.toFixed(4),
      },
    });
  }

  async computeForDeal(dealId: string): Promise<MarginBreakdown> {
    const deal = await this.prisma.deal.findUniqueOrThrow({
      where: { id: dealId },
      include: {
        client: { select: { paymentTermsDays: true } },
        supplierPrice: { include: { supplier: { select: { supplierTermsDays: true } } } },
      },
    });

    // ⚠️ LES CONDITIONS DE L'EXERCICE, PAS LES PARAMÈTRES GLOBAUX.
    //
    //    Ces trois valeurs étaient lues dans les réglages système, avec des
    //    replis écrits en dur — 10 % l'an, l'année civile, 360 jours. Or elles
    //    se saisissent par EXERCICE depuis que l'exercice comptable existe :
    //    le directeur financier avait posé 12 % au titre d'une lettre de
    //    crédit, et le calcul de marge employait toujours 10 %.
    //
    //    Le coût de portage était donc sous-estimé d'un sixième, ce qui
    //    remonte dans la marge directe et dans le verdict du seuil. Une
    //    affaire refusée à raison pouvait passer.
    //
    //    C'est le défaut que tout ce module cherchait à empêcher : une valeur
    //    décidée par le CFO, écrasée en silence par une valeur d'illustration.
    //    Je l'avais posé dans la base sans jamais y brancher le calcul.
    const conditions = await this.conditionsDeLExercice();
    const { financingRatePct, fiscalYear, daysPerYear } = conditions;

    const volume = Number(deal.contractedVolume);
    const unitSalePrice = Number(deal.unitSalePrice);
    const unitPurchasePrice = Number(deal.unitPurchasePrice);

    const carrying = this.computeCarryingCost(
      unitPurchasePrice,
      deal.client.paymentTermsDays,
      deal.supplierPrice?.supplier.supplierTermsDays ?? 0,
      financingRatePct,
      daysPerYear,
    );

    // Tant qu'aucune opération n'existe, il n'y a pas de ligne de coût : on
    // retient l'estimation portée par le deal, saisie au chiffrage. La
    // remplacer par 0 produirait une marge flatteuse et fausse — exactement
    // le genre de chiffre sur lequel on approuve à tort.
    // TROIS SOURCES, par ordre de force probante décroissante :
    //   1. le CONSTATÉ des opérations   — ce qui a réellement été engagé
    //   2. le CHIFFRÉ de l'affaire      — ce que le commercial a prévu
    //   3. le montant agrégé du deal    — reprise de données ancienne
    // Retenir 0 en l'absence des trois produirait une marge flatteuse et
    // fausse : exactement le chiffre sur lequel on approuve à tort.
    const [actual, quoted] = await Promise.all([
      this.directChargesForDeal(dealId),
      this.quotedChargesForDeal(dealId),
    ]);
    const directTotal = actual ?? quoted ?? Number(deal.estimatedDirectCharges);
    const chargesFromOperations = actual !== null;
    const chargesSource: 'operations' | 'devis' | 'agrege' =
      actual !== null ? 'operations' : quoted !== null ? 'devis' : 'agrege';
    const directPerUnit = volume > 0 ? round4(directTotal / volume) : 0;
    // La charge indirecte ne dépend plus de l'assiette de CETTE affaire : les
    // pools s'imputent tous au litre, et un taux au litre est déjà par unité
    // vendue. Le décompte des opérations n'entre donc plus dans le calcul.
    const indirectPerUnit = await this.indirectChargesPerUnit(deal.segment, fiscalYear);

    // Une remise consentie diminue le produit : elle entre dans la marge.
    const discountPerUnit = volume > 0 ? round4(Number(deal.discountAmount) / volume) : 0;

    const directMargin = round4(
      unitSalePrice - discountPerUnit - unitPurchasePrice - directPerUnit - carrying.perUnit,
    );
    const fullMargin = round4(directMargin - indirectPerUnit);

    return {
      unitSalePrice,
      unitPurchasePrice,
      directChargesPerUnit: directPerUnit,
      carryingCostPerUnit: carrying.perUnit,
      indirectChargesPerUnit: indirectPerUnit,
      directMargin,
      fullMargin,
      carryingCycleDays: carrying.cycleDays,
      financingRatePct,
      chargesFromOperations,
      chargesSource,
      totals: {
        saleAmount: round4(unitSalePrice * volume),
        purchaseAmount: round4(unitPurchasePrice * volume),
        directCharges: directTotal,
        indirectCharges: round4(indirectPerUnit * volume),
        carryingCost: round4(carrying.perUnit * volume),
      },
    };
  }

  /**
   * Confronte une marge aux seuils applicables.
   *
   * Ne bloque rien : la base est seule juge au moment de l'approbation. Ce
   * verdict sert à AFFICHER la situation avant que l'utilisateur ne tente
   * l'approbation — un refus qu'on n'a pas vu venir est une mauvaise interface.
   */
  async evaluateThresholds(
    segment: CommercialSegment,
    productId: string,
    currencyCode: string,
    uom: string,
    breakdown: MarginBreakdown,
  ): Promise<ThresholdVerdict> {
    const rows = await this.prisma.$queryRaw<
      Array<{ direct_floor: Prisma.Decimal | null; minimum_margin: Prisma.Decimal | null; currency_code: string; uom: string }>
    >`SELECT direct_floor, minimum_margin, currency_code, uom
        FROM resolve_margin_threshold(${segment}::text, ${productId}::uuid, ${currencyCode}::char(3), ${uom}::text, CURRENT_DATE)`;

    const t = rows[0];
    if (!t) {
      return {
        configured: false,
        directFloor: null,
        minimumMargin: null,
        currencyCode: null,
        uom: null,
        belowDirectFloor: false,
        belowMinimumMargin: false,
        message: `Aucun seuil configuré pour le segment ${segment} en ${currencyCode}/${uom}. L'approbation sera refusée tant que ce seuil n'existe pas.`,
      };
    }

    const directFloor = t.direct_floor === null ? null : Number(t.direct_floor);
    const minimumMargin = t.minimum_margin === null ? null : Number(t.minimum_margin);
    const belowDirectFloor = directFloor !== null && breakdown.directMargin < directFloor;
    const belowMinimumMargin = minimumMargin !== null && breakdown.fullMargin < minimumMargin;

    let message: string;
    if (belowDirectFloor) {
      message = `Marge directe de ${breakdown.directMargin} sous le plancher de ${directFloor} ${t.currency_code}/${t.uom}. L'opération ne couvre pas ses coûts : une dérogation du DG est obligatoire.`;
    } else if (belowMinimumMargin) {
      message = `Marge complète de ${breakdown.fullMargin} sous le seuil de ${minimumMargin} ${t.currency_code}/${t.uom}. L'accord du DG est requis.`;
    } else {
      message = 'Marge conforme aux deux seuils.';
    }

    return {
      configured: true,
      directFloor,
      minimumMargin,
      currencyCode: t.currency_code,
      uom: t.uom,
      belowDirectFloor,
      belowMinimumMargin,
      message,
    };
  }
}

