import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ComplianceSubject {
  subject_kind: 'CARRIER' | 'VEHICLE' | 'DRIVER';
  subject_id: string;
  subject_code: string;
  subject_label: string;
  expired_count: number;
  suspended_count: number;
  expiring_count: number;
  next_expiry: string | null;
  is_compliant: boolean;
}

export interface ExpiryItem {
  id: string;
  type: string;
  reference: string;
  expiry_date: string;
  days_remaining: number;
  status: 'VALID' | 'EXPIRING' | 'EXPIRED' | 'SUSPENDED';
  is_blocking: boolean;
  owner_kind: string;
  owner_label: string;
  owner_id: string;
}

export interface Derogation {
  id: string;
  type: string;
  subjectType: string;
  subjectLabel: string | null;
  reason: string;
  status: string;
  grantedAt: string;
  expiresAt: string | null;
  requiresMonthlyReview: boolean;
  reviewedAt: string | null;
  authority: { fullName: string; role: string } | null;
  requestedBy: { fullName: string; role: string } | null;
}

export interface Partner {
  id: string;
  code: string;
  legalName: string;
  type: string;
  segment: string | null;
  countryCode: string;
  creditStatus: string;
  paymentTermsDays: number;
  isCompliant: boolean;
  sites: {
    id: string;
    code: string;
    name: string;
    city: string | null;
    /**
     * Le LIEU que ce rattachement désigne, avec ses exigences.
     *
     * Elles appartiennent au lieu et non au client : plusieurs clients se font
     * livrer au même endroit, et une consigne recopiée se périme d'un côté.
     */
    deliverySite: {
      id: string;
      code: string;
      name: string;
      city: string | null;
      accessInstructions: string | null;
      openingHours: string | null;
      safetyInstructions: string | null;
      defaultHseRiskLevel: string;
      requirements: SiteRequirement[];
    } | null;
  }[];
  _count: { complianceRecords: number; vehicles: number; drivers: number };
}

// --- Lot 2 : chaîne commerciale et exécution --------------------------------

export interface DealRow {
  id: string;
  reference: string;
  status: string;
  segment: string;
  contractedVolume: string;
  uom: string;
  currencyCode: string;
  unitSalePrice: string;
  estimatedFullMargin: string;
  estimatedDirectMargin: string;
  client: { code: string; legalName: string };
  product: { code: string; name: string };
  owner: { fullName: string } | null;
  _count: { operations: number; invoices: number };
}

/** Chaîne de marge recalculée par le serveur — jamais reconstituée ici. */
export interface MarginBreakdown {
  unitSalePrice: number;
  unitPurchasePrice: number;
  directChargesPerUnit: number;
  carryingCostPerUnit: number;
  indirectChargesPerUnit: number;
  directMargin: number;
  fullMargin: number;
  carryingCycleDays: number;
  financingRatePct: number;
  chargesFromOperations: boolean;
}

export interface ThresholdVerdict {
  configured: boolean;
  directFloor: number | null;
  minimumMargin: number | null;
  currencyCode: string | null;
  uom: string | null;
  belowDirectFloor: boolean;
  belowMinimumMargin: boolean;
  message: string;
}

export interface DealDetail extends DealRow {
  deliveryLocation: string;
  targetDeliveryDate: string | null;
  transportMode: string;
  contract: { reference: string; title: string } | null;
  supplierPrice: {
    unitPrice: string;
    currencyCode: string;
    uom: string;
    sourceLabel: string | null;
    effectiveFrom: string;
    supplier: { code: string; legalName: string; supplierTermsDays: number };
    validatedBy: { fullName: string; role: string } | null;
  } | null;
  creditApprovedBy: { fullName: string; role: string } | null;
  dgApprovedBy: { fullName: string; role: string } | null;
  costLines: DealCostLine[];
  operations: { id: string; reference: string; status: string; plannedVolume: string }[];
  invoices: { id: string; number: string; type: string; status: string; totalAmount: string }[];
  margin: MarginBreakdown;
  thresholds: ThresholdVerdict;
}

export interface OperationRow {
  id: string;
  reference: string;
  status: string;
  plannedVolume: string;
  uom: string;
  transportMode: string;
  destinationLocation: string;
  plannedLoadingDate: string | null;
  deal: {
    reference: string;
    client: { code: string; legalName: string };
    product: { code: string; name: string };
  };
  assignment: { vehicleIdentifier: string | null; vehicle: { registration: string } | null } | null;
  fieldAgent: { fullName: string } | null;
  _count: { hseChecks: number; measurements: number; costLines: number };
}

/**
 * Type d'opération administrable (§ 7.1).
 *
 * `checklistCount` n'est pas décoratif : un type qui ne porte aucune checklist
 * courante n'apporte AUCUN contrôle à l'opération. Celui qui compose le déroulé
 * doit le voir en choisissant, pas au moment où la checklist s'ouvre vide.
 */
export interface OperationTypeRow {
  id: string;
  code: string;
  label: string;
  description: string | null;
  /** Segments où le type a un sens. Vide = tous. */
  segments: string[];
  defaultRiskLevel: string | null;
  displayOrder: number;
  isActive: boolean;
  checklistCount: number;
}

/**
 * Corps du POST /operations — calqué champ pour champ sur `CreateOperationDto`.
 *
 * L'ORDRE de `operationTypeIds` est le déroulé réel : le serveur en fait le
 * rang de séquence tel quel. Retrier la liste avant l'envoi — par ordre
 * alphabétique ou d'identifiant — présenterait le soutage avant le transport
 * qui l'amène.
 */
export interface CreateOperationInput {
  dealId: string;
  plannedVolume: number;
  uom: string;
  transportMode: string;
  sourcingMode?: string;
  operationTypeIds: string[];
  originLocation: string;
  destinationLocation: string;
  destinationSiteId?: string;
  plannedLoadingDate?: string;
  productOwnerId?: string;
  fieldAgentId?: string;
}

/**
 * Détail d'une opération.
 *
 * `operationTypes` n'est pas un ornement : c'est par ces types, et par eux
 * seuls, que les contrôles HSE de l'opération sont indexés. Les afficher, c'est
 * rendre lisible d'où vient la checklist — et pourquoi elle est vide quand
 * aucun type retenu n'en porte.
 */
export interface OperationDetail extends OperationRow {
  hseGate: HseGate;
  measurements: MeasurementSummary[];
  operationTypes: CarriedOperationType[];

  /** Le site de livraison et, par lui, ce qu'il exige (§ 6.2). */
  destinationSite: {
    id: string;
    code: string;
    name: string;
    city: string | null;
    deliverySite: {
      id: string;
      code: string;
      name: string;
      accessInstructions: string | null;
      openingHours: string | null;
      safetyInstructions: string | null;
      requirements: SiteRequirement[];
    } | null;
  } | null;

  /** Ce qui a déjà été levé, par qui et quand. */
  siteRequirementAcks: {
    requirementId: string;
    note: string | null;
    acknowledgedAt: string;
    acknowledgedBy: { fullName: string };
  }[];
}

/** Relevé de mesure, réduit à ce qu'un écran d'action doit en savoir. */
export interface MeasurementSummary {
  id: string;
  reference: string;
  ullageVariancePct: string;
  ullageAlertTriggered: boolean;
  ullageAckAt: string | null;
}

/**
 * Un type porté par une opération, à son rang dans le déroulé.
 *
 * Le serveur trie déjà par `sequence` : l'écran restitue cet ordre tel quel.
 * Le retrier — par code ou par libellé — afficherait le soutage avant le
 * transport qui l'amène, et donnerait à lire un déroulé qui n'a pas eu lieu.
 */
export interface CarriedOperationType {
  sequence: number;
  operationType: { id: string; code: string; label: string; description: string | null };
}

/** État du verrou HSE, tel que la base l'appliquera. */
export interface HseGate {
  open: boolean;
  validated: boolean;
  pendingBlockingItems: number;
  byDerogation: boolean;
  message: string;
}

export interface InvoiceRow {
  id: string;
  number: string;
  type: string;
  status: string;
  billedVolume: string;
  unitPrice: string;
  totalAmount: string;
  vatAmount: string;
  paidAmount: string;
  isVatApplicable: boolean;
  vatRatePct: string;
  currencyCode: string;
  documentCurrencyCode: string;
  documentTotalAmount: string;
  issueDate: string | null;
  dueDate: string | null;
  partner: { code: string; legalName: string };
  deal: { reference: string };
  fneTransmission: { status: string; fiscalReference: string | null } | null;
}

/** Poste de coût du référentiel, tel que proposé au chiffrage. */
export interface CostPostRow {
  id: string;
  code: string;
  label: string;
  nature: 'DIRECT' | 'INDIRECT';
  displayOrder: number;
}

/** Ligne de coût chiffrée sur une affaire. */
export interface DealCostLine {
  id: string;
  basis: 'PER_UNIT' | 'FIXED';
  /** Ce que le commercial a tapé, dans sa base. */
  inputAmount: string;
  /** Total pour l'affaire, dérivé de la base. */
  estimatedAmount: string;
  standardAmount: string | null;
  standardBasis: 'PER_UNIT' | 'FIXED' | null;
  varianceReason: string | null;
  description: string | null;
  costPost: { code: string; label: string; nature: string };
}

/** Barème applicable à un poste, dans le contexte d'une affaire donnée. */
export interface CostGuidance {
  costPostId: string;
  code: string;
  label: string;
  /** Nulle quand le poste n'a jamais été tarifé. */
  basis: 'PER_UNIT' | 'FIXED' | null;
  amount: number | null;
  uom: string | null;
  tolerancePct: number | null;
  standardTotal: number | null;
}

/** Prix fournisseur mobilisable pour une affaire. */
export interface SupplierPriceOption {
  supplierPriceId: string;
  supplierCode: string;
  supplierName: string;
  unitPrice: number;
  currencyCode: string;
  uom: string;
  sourceLabel: string | null;
  supplierTermsDays: number;
  validatedBy: string | null;
  /** Bornes dans lesquelles le prix retenu ne demande aucun motif. */
  bandMin: number;
  bandMax: number;
  /** Portage induit — deux fournisseurs au même prix ne coûtent pas pareil. */
  carryingPerUnit: number;
  carryingCycleDays: number;
}

/** Ce que l'écran envoie pour chiffrer. */
export interface DealCostLineInput {
  costPostId: string;
  /** Transmise pour un poste sans barème ; sinon celle du barème prime. */
  basis?: 'PER_UNIT' | 'FIXED';
  amount: number;
  description?: string;
  varianceReason?: string;
}

export interface SupplierInvoiceRow {
  id: string;
  reference: string;
  status: string;
  amount: string;
  amountPivot: string;
  paidAmount: string;
  prepaidAmount: string;
  prepaidAmountPivot: string;
  /** Part de l'avance apurée par une contrepartie constatée — dérivée en base. */
  settledAmount: string;
  fxRateToPivot: string;
  /** Sa présence dit ce qui apurera l'avance : chargement ou clôture. */
  purchaseOrderId: string | null;
  vatAmount: string;
  vatRatePct: string;
  currencyCode: string;
  invoiceDate: string;
  dueDate: string | null;
  prepaidAt: string | null;
  settledAt: string | null;
  supplier: { code: string; legalName: string; supplierTermsDays: number };
  deal: { id: string; reference: string; client: { legalName: string } } | null;
  recordedBy: { fullName: string } | null;
}

/** Ligne de la vue de rapprochement — coût enregistré vs argent sorti. */
/**
 * Analyses de surveillance (§ 5.4, § 9.1, § 14.6).
 *
 * ⚠️ LES MONTANTS SONT DES `string`, ET C'EST VOULU.
 *
 *    Ils viennent de colonnes `numeric` de PostgreSQL, que Prisma rend en
 *    décimal exact puis sérialise en chaîne. Les déclarer `number` inviterait à
 *    les additionner en virgule flottante côté navigateur — c'est-à-dire à
 *    réintroduire ici l'imprécision que le pivot monétaire écarte en base.
 *    On les affiche, on ne les recalcule pas.
 */
export interface MarginBandRow {
  reference: string;
  segment: string;
  status: string;
  client: string;
  owner: string | null;
  estimated_full_margin: string;
  minimum_margin: string;
  above_threshold: string;
  above_threshold_pct: string;
  currency_code: string;
  uom: string;
  credit_approved_at: string | null;
}

export interface MarginBandOwnerRow {
  owner: string | null;
  deals_in_band: string;
  deals_total: string;
  band_share_pct: string;
  avg_above_threshold_pct: string;
}

export interface MarginVarianceRow {
  reference: string;
  segment: string;
  client: string;
  owner: string | null;
  estimated_full_margin: string;
  realized_full_margin: string;
  variance: string;
  variance_pct: string;
  closed_at: string | null;
}

export interface CreditExposureRow {
  partner_code: string;
  partner_name: string;
  credit_status: string;
  credit_limit_pivot: string;
  receivables_pivot: string;
  commitments_pivot: string;
  guarantees_pivot: string;
  exposure_pivot: string;
  available_credit_pivot: string;
  utilisation_pct: string | null;
}

export interface OutstandingAdvanceRow {
  reference: string;
  supplier: string;
  deal: string | null;
  currency_code: string;
  prepaid_amount: string;
  settled_amount: string;
  outstanding_amount: string;
  outstanding_pivot: string;
  prepaid_at: string;
  days_outstanding: number;
  settlement_trigger: string;
  operation: string | null;
  operation_status: string | null;
}

/** Écart d'invariant (§ 11). Cette liste doit rester vide. */
export interface InvariantBreach {
  regle: string;
  relation: string;
  enregistrement: string;
  detail: string;
}

/**
 * Pilotage financier (§ 14.3, § 14.5, § 14.6).
 *
 * ⚠️ `calculable` N'EST PAS UNE COMMODITÉ D'AFFICHAGE.
 *
 *    Quand il vaut false, les colonnes de résultat sont nulles et `motif` dit
 *    ce qui manque. L'écran doit montrer le motif, pas un tiret : un point mort
 *    absent parce que le budget de charges fixes n'est pas saisi n'est pas la
 *    même chose qu'un point mort de zéro.
 */
export interface PointMort {
  exercice: number | null;
  label: string | null;
  charges_fixes: string;
  postes_de_charges: string;
  marge_unitaire: string | null;
  volume_realise: string | null;
  calculable: boolean;
  motif: string | null;
  point_mort_volume: string | null;
  reste_a_vendre: string | null;
}

export interface MargeCoutVariable {
  segment: string;
  affaires: string;
  volume: string;
  uom: string;
  currency_code: string;
  marge_variable_unitaire: string;
}

export interface Bfr {
  avances_fournisseurs: string;
  creances_clients: string;
  dettes_fournisseurs: string;
  stocks: string;
  stocks_suivis: boolean;
  bfr_exploitation: string;
  perimetre: string;
}

export interface CouvertureBudgetaire {
  exercice: number;
  label: string;
  statut: string;
  donnee: string;
  renseignee: boolean;
  sert_a: string;
}

/**
 * Assiette d'absorption saisie, comparée à la prévision de volumes (§ 14.2).
 *
 * `ecart_pct` nul ne veut PAS dire « d'accord » : il veut dire qu'aucune
 * prévision ne couvre ce pool, donc qu'il n'y a rien à comparer.
 */
export interface AssietteAbsorption {
  pool: string;
  label: string;
  base: string;
  fiscal_year: number;
  budgeted_amount: string;
  assiette_saisie: string;
  assiette_uom: string | null;
  rate_per_unit: string;
  volume_prevu: string | null;
  ecart_pct: string | null;
}

/**
 * Prévision contre réalisé (§ 14.3).
 *
 * ⚠️ DEUX RÉFÉRENCES, ET IL NE FAUT PAS LES CONFONDRE.
 *
 *    `volume_prevu` est la prévision EN VIGUEUR : la révision là où il y en a
 *    une, le budget ailleurs. `volume_budget` est l'engagement initial.
 *
 *    « Ai-je tenu ma prévision courante ? » et « de combien ai-je revu mon
 *    engagement ? » sont deux questions distinctes. Les confondre ferait
 *    passer une ambition revue à la baisse pour un objectif atteint.
 */
export interface PrevisionVente {
  exercice: number;
  segment: string;
  produit: string;
  uom: string;
  currency_code: string;
  volume_prevu: string;
  volume_budget: string | null;
  ecart_revision: string;
  volume_realise: string;
  ecart_volume: string;
  ca_prevu: string;
  ca_budget: string | null;
  ca_realise: string;
  ecart_prix: string | null;
}

/**
 * CRM (§ 15).
 *
 * ⚠️ `valeur_ponderee` NULLE NE VEUT PAS DIRE ZÉRO.
 *
 *    Elle vaut null quand la probabilité de l'étape n'a pas été décidée. Un
 *    zéro se lirait comme « affaire sans espoir », et c'est sur ce total qu'on
 *    engage des achats SIR et GESTOCI (§ 14.3).
 */
export interface CrmPipelineRow {
  id: string;
  reference: string;
  title: string;
  client_code: string;
  client: string;
  client_type: string;
  segment: string;
  produit: string | null;
  etape_code: string;
  etape: string;
  etape_rang: number;
  issue: string;
  responsable: string;
  estimated_volume: string;
  uom: string;
  reference_price: string;
  currency_code: string;
  ca_previsionnel: string;
  probabilite: string | null;
  probabilite_forcee: boolean;
  valeur_ponderee: string | null;
  expected_close_date: string | null;
  next_action: string;
  next_action_due: string;
  action_en_retard: boolean;
  derniere_interaction: string | null;
}

export interface CrmEtape {
  etape_code: string;
  etape: string;
  rang: number;
  issue: string;
  probabilite: string | null;
  opportunites: string;
  ca_previsionnel: string;
  valeur_ponderee: string | null;
  sans_probabilite: string;
  actions_en_retard: string;
}

export interface CrmAlerte {
  nature: string;
  opportunity_id: string;
  reference: string;
  objet: string;
  responsable: string;
  action: string;
  echeance: string;
  retard_jours: number;
}

/** Probabilité AFFICHÉE contre conversion OBSERVÉE — l'honnêteté du pipeline. */
export interface CrmConversion {
  etape_code: string;
  etape: string;
  rang: number;
  probabilite_affichee: string | null;
  passees_par_ici: string;
  gagnees: string;
  perdues: string;
  encore_ouvertes: string;
  conversion_observee_pct: string | null;
}

/** État opérationnel (§ 16). Chaque opération n'apparaît que dans UN état. */
export interface EtatOperationnel {
  etat: string;
  operations: string;
  volume: string;
  reste_a_encaisser: string;
  retard_max_jours: number | null;
}

export interface OperationParEtat {
  operation_id: string;
  reference: string;
  statut: string;
  affaire: string;
  client: string;
  produit: string;
  planned_volume: string;
  uom: string;
  planned_loading_date: string | null;
  etat: string;
  reste_a_encaisser: string;
  retard_encaissement_jours: number | null;
  retard_chargement_jours: number | null;
}

/** Paramètre interrogé par le SQL métier, et sa présence (§ 1.1 bis). */
export interface ParametreRequis {
  parametre: string;
  present: boolean;
  valeur: string | null;
  lu_par: string;
  objets: string;
}

export interface CostReconciliationRow {
  reference: string;
  status: string;
  client: string;
  recorded_cost_pivot: string;
  supplier_billed_pivot: string;
  supplier_paid_pivot: string;
  prepaid_pivot: string;
  unreconciled_pivot: string;
  cost_without_invoice_pivot: string;
}

// --- Paramétrage des référentiels (§ 1.1 bis) -------------------------------

export interface FieldSpec {
  name: string;
  label: string;
  type:
    | 'string'
    | 'text'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'date'
    | 'enum'
    | 'enumList'
    | 'reference'
    | 'referenceList';
  required?: boolean;
  values?: string[];
  refTable?: string;
  refKey?: string;
  decimals?: number;
  help?: string;
}

/** Décrit une table administrable — l'écran de paramétrage en découle. */
export interface ReferentialSpec {
  key: string;
  label: string;
  /** `historised` : rien n'est réécrit, chaque évolution crée une ligne datée. */
  nature: 'mutable' | 'historised';
  identity: string[];
  caution: string | null;
  fields: FieldSpec[];
}

/**
 * Une ligne de référentiel réduite à ce qu'une sélection demande : le code que
 * le serveur attend, et de quoi le reconnaître à l'œil.
 */
/**
 * Exigence d'un SITE de livraison (§ 6.2).
 *
 * Elle appartient au LIEU, pas au client : plusieurs clients se font livrer au
 * même endroit, et une consigne recopiée est une consigne qui se périme d'un
 * côté. Elle se saisit au référentiel des sites, et se LIT partout où le site
 * apparaît.
 */
/**
 * Ce que coûte un transporteur pour CETTE opération, avec sa conformité.
 *
 * Rendu par transporteur : le coordinateur choisit en connaissant le coût, au
 * lieu de choisir puis de découvrir au refus.
 */
export interface FreightGuidance {
  carrierId: string;
  code: string;
  name: string;
  isCompliant: boolean;
  tariff: {
    id: string;
    basis: string;
    unitAmount: number;
    uom: string | null;
    currencyCode: string;
    /** Ce que le tarif donne pour CETTE opération — le chiffre à comparer. */
    expectedAmount: number;
    tolerancePct: number;
  } | null;
}

/**
 * Une tâche — ce que je dois traiter (§ 3).
 *
 * Dérivée de l'état, jamais stockée : elle existe tant que sa cause existe et
 * disparaît d'elle-même. Il n'y a donc rien à « marquer comme lu ».
 */
export interface Tache {
  categorie: string;
  urgence: 'BLOQUANT' | 'ANOMALIE' | 'A_VENIR';
  objet: string;
  libelle: string;
  lien: string;
  depuis: string;
}

export interface CompteurTaches {
  total: number;
  bloquantes: number;
  anomalies: number;
  aVenir: number;
  /** Depuis quand quelqu'un attend — le chiffre qui compte, pas le total. */
  plusAncienne: string | null;
}

export interface SiteRequirement {
  id: string;
  detail: string;
  isBlocking: boolean;
  type: { code: string; label: string; description?: string | null };
}

export interface ReferenceOption {
  /** Valeur transmise — celle du `refKey` annoncé par le registre. */
  value: string;
  label: string;
}

/**
 * Normalise une ligne de référentiel, quelle que soit la table.
 *
 * Les référentiels ne nomment pas leur libellé de la même façon : `label` pour
 * un poste de coût, `name` pour un produit, `legalName` pour un tiers. On les
 * essaie dans cet ordre plutôt que de tenir une correspondance table par table,
 * qui se périmerait au premier référentiel ajouté côté serveur.
 */
function toReferenceOption(row: Record<string, unknown>, refKey: string): ReferenceOption {
  const value = String(row[refKey] ?? '');
  const label = ['label', 'name', 'legalName', 'title'].reduce<string>(
    (found, key) => found || (typeof row[key] === 'string' ? (row[key] as string) : ''),
    '',
  );
  return { value, label: label || value };
}

export interface ImportReport {
  referential: string;
  simulation: boolean;
  lues: number;
  creees: number;
  modifiees: number;
  rejetees: number;
  rejets: { line: number; field?: string; message: string }[];
  avertissements: { line: number; field?: string; message: string }[];
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/internal';

  // --- Conformité (§ 6.4) --------------------------------------------------

  complianceOverview(): Observable<ComplianceSubject[]> {
    return this.http.get<ComplianceSubject[]>(`${this.base}/compliance/overview`);
  }

  nonCompliant(): Observable<ComplianceSubject[]> {
    return this.http.get<ComplianceSubject[]>(`${this.base}/compliance/non-compliant`);
  }

  expiryWatch(withinDays = 90, blockingOnly = false): Observable<ExpiryItem[]> {
    const params = new HttpParams()
      .set('withinDays', withinDays)
      .set('blockingOnly', String(blockingOnly));
    return this.http.get<ExpiryItem[]>(`${this.base}/compliance/expiry-watch`, { params });
  }

  // --- Dérogations (§ 11.4) ------------------------------------------------

  derogations(page = 1, pageSize = 50): Observable<Page<Derogation>> {
    const params = new HttpParams().set('page', page).set('pageSize', pageSize);
    return this.http.get<Page<Derogation>>(`${this.base}/derogations`, { params });
  }

  derogationsPendingReview(): Observable<Derogation[]> {
    return this.http.get<Derogation[]>(`${this.base}/derogations/pending-review`);
  }

  markReviewed(id: string, note?: string): Observable<Derogation> {
    return this.http.patch<Derogation>(`${this.base}/derogations/${id}/reviewed`, { note });
  }

  revokeDerogation(id: string): Observable<Derogation> {
    return this.http.patch<Derogation>(`${this.base}/derogations/${id}/revoke`, {});
  }

  // --- Référentiels --------------------------------------------------------

  partners(page = 1, search?: string): Observable<Page<Partner>> {
    let params = new HttpParams().set('page', page).set('pageSize', 50);
    if (search) params = params.set('search', search);
    return this.http.get<Page<Partner>>(`${this.base}/referentials/partners`, { params });
  }

  currencies(): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${this.base}/referentials/currencies`);
  }

  products(): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${this.base}/referentials/products`);
  }

  costPosts(): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${this.base}/referentials/cost-posts`);
  }

  /**
   * Types d'opération actifs. Le segment est un FILTRE de confort : une liste
   * de segments vide vaut « tous », et le serveur en tient compte — restreindre
   * ici masquerait les types génériques, c'est-à-dire la majorité.
   */
  operationTypes(segment?: string): Observable<OperationTypeRow[]> {
    let params = new HttpParams();
    if (segment) params = params.set('segment', segment);
    return this.http.get<OperationTypeRow[]>(`${this.base}/referentials/operation-types`, {
      params,
    });
  }

  marginThresholds(): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${this.base}/referentials/margin-thresholds`);
  }

  ullageTolerances(): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${this.base}/referentials/ullage-tolerances`);
  }

  fxRates(): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${this.base}/referentials/fx-rates`);
  }

  // --- Affaires (§ 4, § 5.4) -----------------------------------------------

  deals(page = 1, filters: { status?: string; search?: string } = {}): Observable<Page<DealRow>> {
    let params = new HttpParams().set('page', page).set('pageSize', 50);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.search) params = params.set('search', filters.search);
    return this.http.get<Page<DealRow>>(`${this.base}/deals`, { params });
  }

  deal(id: string): Observable<DealDetail> {
    return this.http.get<DealDetail>(`${this.base}/deals/${id}`);
  }

  costPosts2(): Observable<CostPostRow[]> {
    return this.http.get<CostPostRow[]>(`${this.base}/referentials/cost-posts`);
  }

  /** Prix fournisseurs validés et en vigueur pour le produit de l'affaire. */
  dealSupplierPrices(dealId: string): Observable<{
    currencyCode: string;
    uom: string;
    bandPct: number;
    selectedSupplierPriceId: string | null;
    retainedUnitPrice: number;
    prix: SupplierPriceOption[];
  }> {
    return this.http.get<{
      currencyCode: string;
      uom: string;
      bandPct: number;
      selectedSupplierPriceId: string | null;
      retainedUnitPrice: number;
      prix: SupplierPriceOption[];
    }>(`${this.base}/deals/${dealId}/supplier-prices`);
  }

  attachSupplierPrice(
    dealId: string,
    body: { supplierPriceId: string; unitPurchasePrice?: number; varianceReason?: string },
  ): Observable<unknown> {
    return this.http.patch(`${this.base}/deals/${dealId}/supplier-price`, body);
  }

  // --- Étapes du circuit d'approbation d'une affaire -----------------------

  submitDeal(id: string): Observable<unknown> {
    return this.http.patch(`${this.base}/deals/${id}/submit`, {});
  }

  approveDeal(
    id: string,
    body: { marginDerogationId?: string; note?: string } = {},
  ): Observable<unknown> {
    return this.http.patch(`${this.base}/deals/${id}/approve`, body);
  }

  grantDgApproval(id: string, note?: string): Observable<unknown> {
    return this.http.patch(`${this.base}/deals/${id}/dg-approval`, { note });
  }

  recomputeDeal(id: string): Observable<unknown> {
    return this.http.patch(`${this.base}/deals/${id}/recompute`, {});
  }

  /**
   * Barème applicable à chaque poste pour CETTE affaire. Appelé à l'ouverture
   * de l'écran : la valeur de référence doit être visible avant la saisie,
   * pas après.
   */
  costGuidance(dealId: string): Observable<{
    currencyCode: string;
    contractedVolume: number;
    postes: CostGuidance[];
  }> {
    return this.http.get<{
      currencyCode: string;
      contractedVolume: number;
      postes: CostGuidance[];
    }>(`${this.base}/deals/${dealId}/cost-guidance`);
  }

  /** Reprise complète du chiffrage — un devis se reprend en entier. */
  setDealCostLines(id: string, costLines: DealCostLineInput[]): Observable<unknown> {
    return this.http.put(`${this.base}/deals/${id}/cost-lines`, { costLines });
  }

  // --- Opérations (§ 7, § 11.2) --------------------------------------------

  operations(
    page = 1,
    filters: { status?: string; search?: string } = {},
  ): Observable<Page<OperationRow>> {
    let params = new HttpParams().set('page', page).set('pageSize', 50);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.search) params = params.set('search', filters.search);
    return this.http.get<Page<OperationRow>>(`${this.base}/operations`, { params });
  }

  operation(id: string): Observable<OperationDetail> {
    return this.http.get<OperationDetail>(`${this.base}/operations/${id}`);
  }

  /**
   * Création d'une opération (§ 7.1).
   *
   * Aucun contrôle n'est doublé ici : l'affaire non approuvée, le type absent
   * ou le volume nul sont refusés par le serveur et par la base, avec un motif
   * déjà rédigé. Le rejouer côté client donnerait deux formulations pour une
   * même règle, et la version cliente finirait par diverger.
   */
  createOperation(body: CreateOperationInput): Observable<{ id: string; reference: string }> {
    return this.http.post<{ id: string; reference: string }>(`${this.base}/operations`, body);
  }

  // --- Actions sur une opération (§ 7, § 11.2) -----------------------------

  /** Tarifs proposés, un par transporteur, AVANT d'affecter. */
  /** MA file de tâches — le rôle vient du jeton, jamais d'un paramètre. */
  taches(): Observable<Tache[]> {
    return this.http.get<Tache[]>(`${this.base}/supervision/taches`);
  }

  compteurTaches(): Observable<CompteurTaches> {
    return this.http.get<CompteurTaches>(`${this.base}/supervision/taches/compteur`);
  }

  freightGuidance(operationId: string): Observable<FreightGuidance[]> {
    return this.http.get<FreightGuidance[]>(
      `${this.base}/operations/${operationId}/freight-guidance`,
    );
  }

  /** Acquittement d'une exigence bloquante du site de livraison. */
  acknowledgeSiteRequirement(operationId: string, requirementId: string, note?: string) {
    return this.http.post(
      `${this.base}/operations/${operationId}/site-requirements/${requirementId}/acknowledge`,
      { note },
    );
  }

  assignMeans(
    id: string,
    body: {
      carrierId?: string;
      vehicleId?: string;
      driverId?: string;
      vehicleIdentifier?: string;
      freightCost: number;
      currencyCode: string;
      complianceDerogationId?: string;
    },
  ): Observable<unknown> {
    return this.http.patch(`${this.base}/operations/${id}/assignment`, body);
  }

  moveOperation(id: string, to: string, reason?: string): Observable<unknown> {
    return this.http.patch(`${this.base}/operations/${id}/status`, { to, reason });
  }

  recordMeasurement(id: string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/operations/${id}/measurements`, body);
  }

  acknowledgeUllage(measurementId: string, reason: string): Observable<unknown> {
    return this.http.patch(
      `${this.base}/operations/measurements/${measurementId}/acknowledge`,
      { reason },
    );
  }

  addCostLine(id: string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/operations/${id}/cost-lines`, body);
  }

  // --- Actions sur une pièce de facturation (§ 9) --------------------------

  createInvoice(body: Record<string, unknown>): Observable<{ id: string; number: string }> {
    return this.http.post<{ id: string; number: string }>(`${this.base}/invoices`, body);
  }

  convertProforma(id: string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/invoices/${id}/convert`, body);
  }

  issueInvoice(id: string, dueDate?: string): Observable<unknown> {
    return this.http.patch(`${this.base}/invoices/${id}/issue`, { dueDate });
  }

  recordInvoicePayment(
    id: string,
    body: { amount: number; currencyCode: string; valueDate: string; bankReference?: string },
  ): Observable<unknown> {
    return this.http.post(`${this.base}/invoices/${id}/payments`, body);
  }

  paySupplierInvoice(
    id: string,
    body: { amount: number; paidAt: string; bankReference?: string },
  ): Observable<unknown> {
    return this.http.post(`${this.base}/supplier-invoices/${id}/payments`, body);
  }

  recordSupplierInvoice(body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/supplier-invoices`, body);
  }

  // --- Facturation (§ 9) ---------------------------------------------------

  invoices(
    page = 1,
    filters: { type?: string; status?: string; search?: string } = {},
  ): Observable<Page<InvoiceRow>> {
    let params = new HttpParams().set('page', page).set('pageSize', 50);
    if (filters.type) params = params.set('type', filters.type);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.search) params = params.set('search', filters.search);
    return this.http.get<Page<InvoiceRow>>(`${this.base}/invoices`, { params });
  }

  // --- Documents et signatures (§ 12) --------------------------------------

  documents(): Observable<Page<unknown>> {
    return this.http.get<Page<unknown>>(`${this.base}/documents`, {
      params: new HttpParams().set('pageSize', 100),
    });
  }

  signDocument(id: string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/documents/${id}/signatures`, body);
  }

  sealDocument(id: string): Observable<unknown> {
    return this.http.patch(`${this.base}/documents/${id}/seal`, {});
  }

  supersedeDocument(id: string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/documents/${id}/supersede`, body);
  }

  registerDocument(body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/documents`, body);
  }

  // --- HSE et conformité ----------------------------------------------------

  hseChecks(operationId: string): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${this.base}/hse/operations/${operationId}/checks`);
  }

  validateHseCheckAsDg(checkId: string): Observable<unknown> {
    return this.http.patch(`${this.base}/hse/checks/${checkId}/validate`, {});
  }

  openHseEvent(body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/hse/events`, body);
  }

  addComplianceRecord(body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/compliance/records`, body);
  }

  // --- Surveillance (§ 5.4, § 9.1) -----------------------------------------

  marginBand(): Observable<MarginBandRow[]> {
    return this.http.get<MarginBandRow[]>(`${this.base}/supervision/margin-band`);
  }

  /** Concentration par commercial — c'est le motif qui alerte, pas le cas isolé. */
  marginBandByOwner(): Observable<MarginBandOwnerRow[]> {
    return this.http.get<MarginBandOwnerRow[]>(`${this.base}/supervision/margin-band/by-owner`);
  }

  /**
   * Écart entre marge approuvée et marge réalisée.
   *
   * Le seuil est un PARAMÈTRE du serveur (`MARGIN_VARIANCE_ALERT_PCT`) ; on ne
   * le passe pas d'ici. Un écran qui porterait sa propre valeur ferait mentir
   * l'écran de paramétrage — le défaut déjà rencontré sur le préavis de
   * conformité, où trois seuils coexistaient pour un même réglage.
   */
  marginVariance(): Observable<MarginVarianceRow[]> {
    return this.http.get<MarginVarianceRow[]>(`${this.base}/supervision/margin-variance`);
  }

  creditExposure(): Observable<CreditExposureRow[]> {
    return this.http.get<CreditExposureRow[]>(`${this.base}/supervision/credit-exposure`);
  }

  outstandingPrepayments(): Observable<OutstandingAdvanceRow[]> {
    return this.http.get<OutstandingAdvanceRow[]>(
      `${this.base}/supervision/outstanding-prepayments`,
    );
  }

  invariants(): Observable<InvariantBreach[]> {
    return this.http.get<InvariantBreach[]>(`${this.base}/supervision/invariants`);
  }

  parametresRequis(): Observable<ParametreRequis[]> {
    return this.http.get<ParametreRequis[]>(`${this.base}/supervision/parametres-requis`);
  }

  // --- Pilotage financier (§ 14.3, § 14.5, § 14.6) -------------------------

  // --- CRM (§ 15) ----------------------------------------------------------

  crmStages(): Observable<Record<string, unknown>[]> {
    return this.http.get<Record<string, unknown>[]>(`${this.base}/crm/stages`);
  }

  crmPipeline(ouvertes = true): Observable<CrmPipelineRow[]> {
    const params = new HttpParams().set('ouvertes', ouvertes);
    return this.http.get<CrmPipelineRow[]>(`${this.base}/crm/pipeline`, { params });
  }

  crmParEtape(): Observable<CrmEtape[]> {
    return this.http.get<CrmEtape[]>(`${this.base}/crm/pipeline/par-etape`);
  }

  crmAlertes(): Observable<CrmAlerte[]> {
    return this.http.get<CrmAlerte[]>(`${this.base}/crm/alertes`);
  }

  crmConversion(): Observable<CrmConversion[]> {
    return this.http.get<CrmConversion[]>(`${this.base}/crm/conversion`);
  }

  crmOpportunite(id: string): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(`${this.base}/crm/opportunites/${id}`);
  }

  crmCreerOpportunite(body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/crm/opportunites`, body);
  }

  crmChangerEtape(id: string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.patch(`${this.base}/crm/opportunites/${id}/etape`, body);
  }

  crmJournaliser(id: string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/crm/opportunites/${id}/interactions`, body);
  }

  crmCloreAction(interactionId: string, done: boolean): Observable<unknown> {
    return this.http.patch(`${this.base}/crm/interactions/${interactionId}/action`, { done });
  }

  // --- Tableau de bord opérationnel (§ 16) ---------------------------------

  tableauOperationnel(): Observable<EtatOperationnel[]> {
    return this.http.get<EtatOperationnel[]>(`${this.base}/supervision/tableau-operationnel`);
  }

  operationsParEtat(etat: string): Observable<OperationParEtat[]> {
    return this.http.get<OperationParEtat[]>(
      `${this.base}/supervision/tableau-operationnel/${etat}`,
    );
  }

  couvertureBudgetaire(): Observable<CouvertureBudgetaire[]> {
    return this.http.get<CouvertureBudgetaire[]>(
      `${this.base}/supervision/couverture-budgetaire`,
    );
  }

  /** Rend toujours UNE ligne, même quand le point mort n'est pas calculable. */
  pointMort(): Observable<PointMort[]> {
    return this.http.get<PointMort[]>(`${this.base}/supervision/point-mort`);
  }

  margeCoutVariable(): Observable<MargeCoutVariable[]> {
    return this.http.get<MargeCoutVariable[]>(`${this.base}/supervision/marge-cout-variable`);
  }

  bfr(): Observable<Bfr[]> {
    return this.http.get<Bfr[]>(`${this.base}/supervision/bfr`);
  }

  assietteAbsorption(): Observable<AssietteAbsorption[]> {
    return this.http.get<AssietteAbsorption[]>(`${this.base}/supervision/assiette-absorption`);
  }

  previsionVente(): Observable<PrevisionVente[]> {
    return this.http.get<PrevisionVente[]>(`${this.base}/supervision/prevision-vente`);
  }

  // --- Paramétrage (§ 1.1 bis) ---------------------------------------------

  /**
   * Lecture d'un référentiel désigné par sa CLÉ DE REGISTRE (`refTable`).
   *
   * Le registre ne publie pas d'URL, seulement cette clé — et la convention de
   * routage la reprend telle quelle. On ne présume donc pas de la liste des
   * référentiels lisibles : on tente la lecture, et l'appelant se replie sur la
   * saisie libre si elle échoue. Une liste tenue à la main ici retirerait
   * silencieusement la sélection au premier référentiel ajouté côté serveur.
   *
   * Deux formes de réponse coexistent — tableau nu, ou page pour les tables
   * volumineuses comme les tiers. Les deux sont acceptées.
   */
  referenceOptions(refTable: string, refKey = 'code'): Observable<ReferenceOption[]> {
    return this.http.get<unknown>(`${this.base}/referentials/${refTable}`).pipe(
      map((payload) => {
        const rows = Array.isArray(payload)
          ? payload
          : ((payload as { items?: unknown[] })?.items ?? []);
        return (rows as Record<string, unknown>[])
          .map((row) => toReferenceOption(row, refKey))
          .filter((o) => o.value !== '');
      }),
    );
  }

  parameterCatalogue(): Observable<ReferentialSpec[]> {
    return this.http.get<ReferentialSpec[]>(`${this.base}/parameters`);
  }

  saveParameter(
    key: string,
    values: Record<string, unknown>,
    reason?: string,
  ): Observable<{ created: boolean; id: string }> {
    return this.http.post<{ created: boolean; id: string }>(`${this.base}/parameters/${key}`, {
      values,
      reason,
    });
  }

  importParameters(
    key: string,
    rows: Record<string, unknown>[],
    reason?: string,
    dryRun = false,
  ): Observable<ImportReport> {
    return this.http.post<ImportReport>(`${this.base}/parameters/${key}/import`, {
      rows,
      reason,
      dryRun,
    });
  }

  costReconciliation(): Observable<CostReconciliationRow[]> {
    return this.http.get<CostReconciliationRow[]>(`${this.base}/supervision/cost-reconciliation`);
  }

  // --- Registre fournisseurs et prépaiements (§ 14.6) ----------------------

  supplierInvoices(
    page = 1,
    filters: { status?: string; dealId?: string; search?: string } = {},
  ): Observable<Page<SupplierInvoiceRow>> {
    let params = new HttpParams().set('page', page).set('pageSize', 50);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.dealId) params = params.set('dealId', filters.dealId);
    if (filters.search) params = params.set('search', filters.search);
    return this.http.get<Page<SupplierInvoiceRow>>(`${this.base}/supplier-invoices`, { params });
  }

  /** Apurement MANUEL — voie d'exception, motif obligatoire (§ 14.6). */
  settleSupplierInvoice(
    id: string,
    settledAt: string,
    reason: string,
  ): Observable<SupplierInvoiceRow> {
    return this.http.patch<SupplierInvoiceRow>(`${this.base}/supplier-invoices/${id}/settle`, {
      settledAt,
      reason,
    });
  }
}
