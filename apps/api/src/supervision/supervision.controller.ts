import { Controller, Get, Injectable, Param, Query, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Realm, RequireRealm, Roles, SkipAudit } from '../common/auth/realm';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Surveillance et pilotage (SPECIFICATIONS.md § 5.4, § 9.1, § 14.6).
 *
 * Les seuils empêchent de vendre trop bas. Ils n'empêchent PAS de se placer
 * juste au-dessus. Ces écrans servent l'autre menace : le détournement de
 * valeur par ajustement des prix, qu'aucun plancher ne peut arrêter.
 *
 * Toutes les données viennent de vues PostgreSQL : le calcul n'est jamais
 * refait ici, sous peine de diverger de la règle appliquée en base.
 */
@Injectable()
export class SupervisionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ce que CE rôle doit traiter, du plus bloquant au plus ancien.
   *
   * Le DG voit tout : sa fonction est de savoir où l'entreprise est bloquée,
   * y compris chez les autres. Les autres ne voient que leur file — leur
   * montrer celle des autres noierait la leur.
   */
  taches(role: UserRole | undefined): Promise<Tache[]> {
    const tout = role === UserRole.DG;
    return this.prisma.$queryRaw<Tache[]>`
      SELECT categorie, urgence, objet, libelle, lien, depuis
        FROM v_taches
       WHERE ${tout}::boolean OR role_attendu = ${role ?? ''}::text
       ORDER BY CASE urgence
                  WHEN 'BLOQUANT' THEN 1
                  WHEN 'ANOMALIE' THEN 2
                  ELSE 3 END,
                depuis ASC
       LIMIT 200`;
  }

  /**
   * Le décompte, pour la pastille du bandeau.
   *
   * `plus_ancienne` est le chiffre qui compte : un total de trois tâches dont
   * la plus vieille date de trois semaines est plus grave qu'un total de
   * trente arrivées ce matin.
   */
  async compteurTaches(role: UserRole | undefined) {
    const tout = role === UserRole.DG;
    const [ligne] = await this.prisma.$queryRaw<
      { total: bigint; bloquantes: bigint; anomalies: bigint; a_venir: bigint; plus_ancienne: Date | null }[]
    >`
      SELECT count(*)                                     AS total,
             count(*) FILTER (WHERE urgence = 'BLOQUANT') AS bloquantes,
             count(*) FILTER (WHERE urgence = 'ANOMALIE') AS anomalies,
             count(*) FILTER (WHERE urgence = 'A_VENIR')  AS a_venir,
             min(depuis)                                  AS plus_ancienne
        FROM v_taches
       WHERE ${tout}::boolean OR role_attendu = ${role ?? ''}::text`;
    return {
      total: Number(ligne?.total ?? 0),
      bloquantes: Number(ligne?.bloquantes ?? 0),
      anomalies: Number(ligne?.anomalies ?? 0),
      aVenir: Number(ligne?.a_venir ?? 0),
      plusAncienne: ligne?.plus_ancienne ?? null,
    };
  }

  /** Affaires dont la marge effleure le seuil minimum. */
  marginBand() {
    return this.prisma.$queryRawUnsafe(
      `SELECT reference, segment, status, client, owner, estimated_full_margin,
              minimum_margin, above_threshold, above_threshold_pct, currency_code, uom,
              credit_approved_at
         FROM v_margin_band_watch
        ORDER BY above_threshold_pct ASC`,
    );
  }

  /**
   * Concentration par commercial — c'est le motif qui alerte, pas le cas isolé.
   * Une affaire à 31 FCFA est banale ; un vendeur dont 80 % des affaires
   * atterrissent dans la bande ne l'est pas.
   */
  marginBandByOwner() {
    return this.prisma.$queryRawUnsafe(
      `SELECT owner, deals_in_band, deals_total, band_share_pct, avg_above_threshold_pct
         FROM v_margin_band_by_owner`,
    );
  }

  /**
   * Performance par commercial (§ 16).
   *
   * Trois familles de chiffres qu'on ne mélange pas : ce qui est ESPÉRÉ (le
   * pipeline, qui dépend de probabilités déclarées), ce qui est SIGNÉ (les
   * affaires, qui ne dépendent d'aucune hypothèse), et À QUEL PRIX c'est signé
   * (marge, proximité du seuil). Un commercial qui remplit son pipeline sans
   * rien signer et un autre qui signe tout au ras du seuil ont tous deux un
   * problème — un indicateur unique les confondrait.
   */
  performanceCommerciale(p: {
    periode?: string;
    ancre?: string;
    debut?: string;
    fin?: string;
  }) {
    // ⚠️ LA PÉRIODE EST RÉSOLUE EN BASE, PAS ICI.
    //
    //    Calculer les bornes d'un trimestre côté application les ferait
    //    diverger de celles du SQL au premier fuseau ou au premier exercice
    //    décalé. La fonction rend la période retenue AVEC les chiffres : ce que
    //    l'écran affiche est exactement ce qui a été agrégé.
    return this.prisma.$queryRawUnsafe(
      `SELECT * FROM performance_commerciale($1::date, $2::date, $3::text, $4::date)
        ORDER BY chiffre_affaires DESC NULLS LAST, commercial`,
      p.debut ?? null,
      p.fin ?? null,
      p.periode ?? null,
      p.ancre ?? null,
    );
  }

  /** Bornes d'un découpage nommé, pour que l'écran sache ce qu'il demande. */
  bornesPeriode(periode?: string, ancre?: string) {
    return this.prisma.$queryRawUnsafe(
      `SELECT * FROM periode_bornes($1::text, $2::date)`,
      periode ?? null,
      ancre ?? null,
    );
  }

  /** Écart entre marge approuvée et marge réalisée, dans les deux sens. */
  marginVariance(thresholdPct: number) {
    return this.prisma.$queryRawUnsafe(
      `SELECT reference, segment, client, owner, estimated_full_margin,
              realized_full_margin, variance, variance_pct, closed_at
         FROM v_margin_variance
        WHERE abs(variance_pct) >= $1
        ORDER BY abs(variance_pct) DESC`,
      thresholdPct,
    );
  }

  /**
   * Rapprochement du coût enregistré avec l'argent réellement sorti.
   * Le contrôle le plus solide : il ne repose pas sur une déclaration.
   */
  costReconciliation() {
    return this.prisma.$queryRawUnsafe(
      `SELECT reference, status, client, recorded_cost_pivot, supplier_billed_pivot,
              supplier_paid_pivot, prepaid_pivot, unreconciled_pivot,
              cost_without_invoice_pivot
         FROM v_cost_reconciliation
        WHERE abs(unreconciled_pivot) > 0.01 OR cost_without_invoice_pivot > 0.01
        ORDER BY abs(unreconciled_pivot) DESC`,
    );
  }

  /** En-cours crédit par client — source unique du contrôle (§ 9.1). */
  creditExposure() {
    return this.prisma.$queryRawUnsafe(
      `SELECT partner_code, partner_name, credit_status, credit_limit_pivot,
              receivables_pivot, commitments_pivot, guarantees_pivot,
              exposure_pivot, available_credit_pivot, utilisation_pct
         FROM v_partner_credit_exposure
        ORDER BY utilisation_pct DESC NULLS LAST`,
    );
  }

  /**
   * Trésorerie immobilisée par les prépaiements fournisseurs (§ 14.6).
   *
   * Elyon paie avant livraison : ce sont les AVANCES qui pèsent au BFR, pas
   * les dettes. Argent sorti, contrepartie non encore constatée.
   *
   * La vue ne rend que le RELIQUAT. Une avance apurée aux deux tiers y figure
   * pour le tiers restant — jamais pour son montant d'origine, qui donnerait
   * une immobilisation surestimée.
   */
  outstandingPrepayments() {
    return this.prisma.$queryRawUnsafe(
      `SELECT reference, supplier, deal, currency_code,
              prepaid_amount, settled_amount, outstanding_amount, outstanding_pivot,
              prepaid_at, days_outstanding, settlement_trigger,
              operation, operation_status
         FROM v_outstanding_advances`,
    );
  }

  /**
   * Écarts d'invariant (§ 11). CETTE LISTE DOIT RESTER VIDE.
   *
   * Elle existait en base depuis la reprise du lot 2, et la file de tâches y
   * renvoyait — mais aucune route ne la servait et aucun écran ne l'affichait.
   * Le lien tombait sur le tableau de bord, silencieusement, au moment précis
   * où quelque chose ne va pas.
   */
  invariants() {
    return this.prisma.$queryRawUnsafe(
      `SELECT regle, relation, enregistrement, detail
         FROM v_invariant_breaches
        ORDER BY regle, enregistrement`,
    );
  }

  /**
   * Paramètres que le SQL métier interroge, et leur présence (§ 1.1 bis).
   *
   * Un paramètre absent ne casse rien : le verrou tourne sur son repli, donc
   * sur une valeur que personne n'a choisie. C'est lisible ici avant de l'être
   * dans les conséquences.
   */
  parametresRequis() {
    return this.prisma.$queryRawUnsafe(
      `SELECT parametre, present, valeur, lu_par, objets
         FROM v_parametres_requis
        ORDER BY present ASC, parametre`,
    );
  }

  // =========================================================================
  //  PILOTAGE FINANCIER (§ 14.3, § 14.5, § 14.6)
  //
  //  Ces lectures ne calculent rien : les vues portent déjà le refus de
  //  calculer quand une donnée manque. L'API ne fait que transporter — y
  //  ajouter un repli ici ferait réapparaître, côté serveur, le chiffre
  //  inventé que la base a refusé de produire.
  // =========================================================================

  /** Ce que le CFO doit saisir pour que le pilotage soit calculable (§ 19). */
  couvertureBudgetaire() {
    return this.prisma.$queryRawUnsafe(
      `SELECT exercice, label, statut, donnee, renseignee, sert_a
         FROM v_couverture_budgetaire
        ORDER BY exercice, renseignee ASC, donnee`,
    );
  }

  /** Point mort en VOLUME. Rend toujours une ligne, même non calculable. */
  pointMort() {
    return this.prisma.$queryRawUnsafe(
      `SELECT exercice, label, charges_fixes, pools_de_charges_fixes, devise_charges,
              marge_unitaire, volume_realise, devise_marge, uom,
              calculable, motif, point_mort_volume, reste_a_vendre
         FROM v_point_mort`,
    );
  }

  /** Marge sur coût variable par segment, base du point mort. */
  margeCoutVariable() {
    return this.prisma.$queryRawUnsafe(
      `SELECT segment, affaires, volume, uom, currency_code, marge_variable_unitaire
         FROM v_marge_cout_variable
        ORDER BY segment`,
    );
  }

  /** BFR d'exploitation — périmètre restreint et affiché comme tel. */
  bfr() {
    return this.prisma.$queryRawUnsafe(
      `SELECT avances_fournisseurs, creances_clients, dettes_fournisseurs,
              stocks, stocks_suivis, bfr_exploitation, perimetre
         FROM v_bfr_exploitation`,
    );
  }

  /**
   * Ce que les charges devraient coûter au litre, et ce qu'elles coûtent.
   *
   * Trois assiettes pour un même budget : BUDGÉTÉE — celle qui fait foi et la
   * seule qui entre dans la marge —, RÉVISÉE, et RÉALISÉE au prorata des mois
   * écoulés.
   *
   * ⚠️ INDICATEUR SEUL. Si le taux révisé alimentait le calcul de marge, une
   *    année sous les prévisions ferait monter la charge au litre, davantage
   *    d'affaires passeraient sous le seuil, le volume baisserait encore —
   *    c'est la spirale d'absorption du § 14.2, et elle s'emballe vite sur une
   *    marge de l'ordre de 4 %.
   *
   * ⚠️ LE NUMÉRATEUR EST TOUJOURS LE BUDGET : aucune comptabilité de charges
   *    n'existe dans ce système. La vue porte une colonne `perimetre` qui le
   *    dit, et l'écran l'affiche — c'est le genre de précision qu'on ne peut
   *    pas laisser au lecteur.
   */
  absorptionReelle() {
    return this.prisma.$queryRawUnsafe(
      `SELECT pool, pool_libelle, nature, devise, exercice, budget, uom,
              assiette_budget, taux_applique,
              assiette_revisee, taux_si_revision, ecart_revision, ecart_revision_pct,
              mois_ecoules, mois_total, volume_realise, taux_a_date,
              ecart_a_date, ecart_a_date_pct, perimetre
         FROM v_absorption_reelle
        ORDER BY exercice DESC, pool`,
    );
  }

  /** Charges fixes de l'exercice, DÉRIVÉES de la somme des pools FIXES. */
  chargesFixes() {
    return this.prisma.$queryRawUnsafe(
      `SELECT exercice, label, statut, pools, charges_fixes, devises, devise
         FROM v_charges_fixes_exercice
        ORDER BY exercice DESC`,
    );
  }

  /**
   * Tableau de bord opérationnel (§ 16).
   *
   * Sept états, dont deux ne sont pas des statuts d'opération mais des TROUS
   * ENTRE MODULES : livrée non facturée, facturée non encaissée. Ce sont ceux
   * qui coûtent, parce qu'aucun écran ne les portait — une opération close
   * disparaît de la liste des opérations, et une facture émise ne dit pas
   * qu'elle attend.
   */
  tableauOperationnel() {
    return this.prisma.$queryRawUnsafe(
      `SELECT etat, operations, volume, reste_a_encaisser, retard_max_jours
         FROM v_tableau_operationnel_compte
        ORDER BY operations DESC`,
    );
  }

  /** Le détail derrière un pavé : sans lui, le chiffre est sans recours. */
  operationsParEtat(etat: string) {
    return this.prisma.$queryRawUnsafe(
      `SELECT operation_id, reference, statut, affaire, client, produit,
              planned_volume, uom, planned_loading_date, actual_discharge_date,
              etat, facture_pivot, encaisse_pivot, reste_a_encaisser,
              retard_encaissement_jours, retard_chargement_jours
         FROM v_tableau_operationnel
        WHERE etat = $1
        ORDER BY COALESCE(retard_encaissement_jours, retard_chargement_jours) DESC NULLS LAST,
                 reference
        LIMIT 200`,
      etat,
    );
  }

  /** Prévision contre réalisé, écart de volume et écart de prix séparés. */
  previsionVente() {
    return this.prisma.$queryRawUnsafe(
      `SELECT exercice, segment, produit, uom, currency_code,
              volume_prevu, volume_budget, ecart_revision,
              volume_realise, ecart_volume,
              ca_prevu, ca_budget, ca_realise, ecart_prix
         FROM v_prevision_vente
        ORDER BY exercice, segment, produit`,
    );
  }
}

/**
 * FILE DE TÂCHES — ce que l'utilisateur connecté doit traiter (§ 3).
 *
 * ⚠️ FILTRÉE PAR LE RÔLE DU JETON, jamais par un paramètre.
 *
 *    Un `?role=` transformerait le cloisonnement en suggestion : le
 *    coordinateur logistique lirait la file du DG, et y verrait les affaires
 *    sous le seuil de marge. Le rôle vient du jeton, point.
 *
 *    Le DG voit TOUT : c'est le seul rôle dont la fonction est de savoir où
 *    l'entreprise est bloquée, y compris chez les autres.
 */
export interface Tache {
  categorie: string;
  urgence: 'BLOQUANT' | 'ANOMALIE' | 'A_VENIR';
  objet: string;
  libelle: string;
  lien: string;
  depuis: Date;
}

@Controller('api/internal/supervision')
@RequireRealm(Realm.INTERNAL)
@SkipAudit()
export class SupervisionController {
  constructor(private readonly service: SupervisionService) {}

  /**
   * MA file de tâches. Aucun paramètre de rôle : il vient du jeton.
   *
   * Toute route est ouverte à tout rôle interne — la vue filtre elle-même, et
   * un rôle sans tâche reçoit une liste vide. Restreindre l'accès à la route
   * reviendrait à cacher à quelqu'un qu'on l'attend.
   */
  @Get('taches')
  taches(@Req() req: { auth: { role?: UserRole } }) {
    return this.service.taches(req.auth.role);
  }

  @Get('taches/compteur')
  compteurTaches(@Req() req: { auth: { role?: UserRole } }) {
    return this.service.compteurTaches(req.auth.role);
  }

  @Get('margin-band')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO)
  marginBand() {
    return this.service.marginBand();
  }

  /**
   * Concentration par commercial.
   *
   * ⚠️ LE CCOO EN EST LE PREMIER DESTINATAIRE, ET IL EN ÉTAIT EXCLU.
   *
   *    Cette lecture révèle un vendeur dont toutes les affaires effleurent le
   *    seuil — un motif, pas un cas isolé. Le CCOO encadre ces vendeurs ; le
   *    laisser dehors revenait à confier le signal à ceux qui ne peuvent rien
   *    en faire au quotidien.
   *
   *    Les commerciaux, eux, restent exclus : un tableau comparatif de leurs
   *    collègues contredirait la règle qui veut que chacun ne voie que ses
   *    propres affaires.
   */
  @Get('margin-band/by-owner')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO)
  byOwner() {
    return this.service.marginBandByOwner();
  }

  /** Performance par commercial (§ 16) — pipeline, conversion, réalisé, qualité. */
  /**
   * Performance par commercial sur une PÉRIODE (§ 16).
   *
   * `periode` : MOIS · TRIMESTRE · SEMESTRE · ANNEE_CIVILE · EXERCICE.
   * `ancre`   : un jour DANS la période voulue — « le trimestre du 15 mai ».
   * `debut` / `fin` : bornes libres, qui l'emportent sur le découpage nommé.
   *
   * Sans rien : l'exercice comptable courant, ou l'année civile tant qu'aucun
   * exercice n'est déclaré. La période retenue est rendue avec les chiffres.
   */
  @Get('performance-commerciale')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO)
  performanceCommerciale(
    @Query('periode') periode?: string,
    @Query('ancre') ancre?: string,
    @Query('debut') debut?: string,
    @Query('fin') fin?: string,
  ) {
    return this.service.performanceCommerciale({ periode, ancre, debut, fin });
  }

  @Get('periode-bornes')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO, UserRole.ACCOUNTANT)
  bornesPeriode(@Query('periode') periode?: string, @Query('ancre') ancre?: string) {
    return this.service.bornesPeriode(periode, ancre);
  }

  @Get('margin-variance')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO, UserRole.ACCOUNTANT)
  variance(@Query('minPct') minPct?: string) {
    return this.service.marginVariance(Number(minPct) || 0);
  }

  @Get('cost-reconciliation')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
  reconciliation() {
    return this.service.costReconciliation();
  }

  @Get('credit-exposure')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT, UserRole.CCOO)
  exposure() {
    return this.service.creditExposure();
  }

  @Get('outstanding-prepayments')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
  prepayments() {
    return this.service.outstandingPrepayments();
  }

  /**
   * Santé des invariants et des paramètres.
   *
   * Ouvert à l'IT_ADMIN autant qu'au DG : un écart d'invariant est aussi
   * souvent un défaut technique qu'une dérive métier, et celui qui peut le
   * corriger doit pouvoir le voir.
   */
  @Get('invariants')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.IT_ADMIN)
  invariants() {
    return this.service.invariants();
  }

  @Get('parametres-requis')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.IT_ADMIN)
  parametresRequis() {
    return this.service.parametresRequis();
  }

  // --- Pilotage financier (§ 14.3, § 14.5, § 14.6) -------------------------
  //
  // La couverture est ouverte plus largement que les indicateurs : savoir
  // QU'UNE donnée manque n'apprend rien de confidentiel, et le coordinateur
  // qui attend un plan d'approvisionnement a le droit de savoir pourquoi il
  // n'en a pas.

  @Get('couverture-budgetaire')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO, UserRole.ACCOUNTANT, UserRole.LOGISTICS_COORD)
  couvertureBudgetaire() {
    return this.service.couvertureBudgetaire();
  }

  @Get('point-mort')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO, UserRole.ACCOUNTANT)
  pointMort() {
    return this.service.pointMort();
  }

  @Get('marge-cout-variable')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO, UserRole.ACCOUNTANT)
  margeCoutVariable() {
    return this.service.margeCoutVariable();
  }

  @Get('bfr')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
  bfr() {
    return this.service.bfr();
  }

  /**
   * ⚠️ NI LE COMPTABLE NI LE COORDINATEUR N'Y ONT ACCÈS.
   *
   *    Cette lecture expose le budget de structure pool par pool — ce que
   *    coûtent l'administration, la finance, le HSE. C'est une donnée de
   *    direction. Le dirigeant l'a demandée pour lui, le CCOO et, par nature
   *    de sa fonction, le CFO qui répond des marges.
   */
  @Get('absorption-reelle')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO)
  absorptionReelle() {
    return this.service.absorptionReelle();
  }

  @Get('charges-fixes')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO)
  chargesFixes() {
    return this.service.chargesFixes();
  }

  @Get('tableau-operationnel')
  tableauOperationnel() {
    return this.service.tableauOperationnel();
  }

  @Get('tableau-operationnel/:etat')
  operationsParEtat(@Param('etat') etat: string) {
    return this.service.operationsParEtat(etat);
  }

  @Get('prevision-vente')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO, UserRole.ACCOUNTANT, UserRole.LOGISTICS_COORD)
  previsionVente() {
    return this.service.previsionVente();
  }
}
