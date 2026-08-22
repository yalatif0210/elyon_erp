import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

export interface AuditLogRow {
  id: string;
  actorType: 'INTERNAL_USER' | 'PORTAL_USER' | 'FIELD_USER' | 'SYSTEM';
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  beforeState: unknown;
  afterState: unknown;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditLogFilters {
  actorType?: string;
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Pièce jointe terrain — photo, signature ou document numérisé (§ 10.2). */
export interface AttachmentRow {
  id: string;
  /** PHOTO, SIGNATURE ou DOCUMENT — une capture de signature n'est pas une photo. */
  kind: string;
  mimeType: string;
  caption: string | null;
  createdAt: string;
  checkItem: {
    id: string;
    level: string;
    outcome: string;
    item: { code: string; label: string; phase: string };
  } | null;
  hseEvent: { id: string; reference: string; type: string; severity: string } | null;
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

/**
 * Détail d'un enregistrement de conformité (§ 6.4).
 *
 * ⚠️ CORRIGÉ — `GET /compliance/records/:id` n'avait aucun appelant : la liste
 *    de l'échéancier ne montre ni l'organisme émetteur ni la date d'émission,
 *    et ne donne aucun accès à la pièce numérisée elle-même.
 */
export interface ComplianceRecordDetail {
  id: string;
  type: string;
  reference: string;
  issuingBody: string | null;
  issueDate: string;
  expiryDate: string | null;
  status: string;
  isBlocking: boolean;
  partner: { code: string; legalName: string } | null;
  vehicle: { registration: string; brandModel: string | null } | null;
  driver: { fullName: string; employeeNumber: string | null } | null;
  document: { id: string; title: string } | null;
}

export interface Derogation {
  id: string;
  type: string;
  subjectType: string;
  subjectId: string | null;
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

/** Corps du POST /derogations — calqué sur `CreateDerogationDto` (§ 11.4). */
export interface CreateDerogationInput {
  type: string;
  subjectType: string;
  /** DOIT être la référence lisible du sujet (ex. DEAL-2026-08-001) : c'est
   *  elle, pas l'UUID, que `derogation_opposable()` confronte au sujet réel. */
  subjectId?: string;
  subjectLabel?: string;
  reason: string;
  expiresAt?: string;
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
  _count: { complianceRecords: number; vehicles: number; drivers: number };
}

/**
 * Un site sélectionnable comme lieu de livraison — le référentiel autonome
 * des sites, jamais une fiche tiers : un lieu peut servir plusieurs clients,
 * il n'appartient à aucun d'eux (§ 6.2).
 */
export interface DeliverySite {
  id: string;
  code: string;
  name: string;
  city: string | null;
  usages: string[];
  accessInstructions: string | null;
  openingHours: string | null;
  safetyInstructions: string | null;
  defaultHseRiskLevel: string;
  requirements: SiteRequirement[];
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

/** Corps du POST /deals — calqué sur `CreateDealDto` (§ 5.4). */
export interface CreateDealInput {
  contractId?: string;
  clientId: string;
  siteId?: string;
  productId: string;
  segment: string;
  /** Absents pour un produit SERVICE (barge) — voir `ProductOption.isService`. */
  contractedVolume?: number;
  uom?: string;
  transportMode?: string;
  deliveryLocation: string;
  targetDeliveryDate?: string;
  currencyCode: string;
  unitSalePrice: number;
  discountMode?: string;
  discountValue?: number;
}

export interface ContractRow {
  id: string;
  reference: string;
  clientId: string;
  title: string;
  status: string;
  segment: string;
  paymentTermsDays: number | null;
  currencyCode: string;
}

export interface DealDetail extends DealRow {
  deliveryLocation: string;
  /** Site référencé de l'affaire, le cas échéant — hérité par toute
   *  opération qui en découle (§ 6.2), jamais choisi indépendamment. */
  site: { name: string; city: string | null } | null;
  targetDeliveryDate: string | null;
  transportMode: string | null;
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
  invoices: {
    id: string;
    number: string | null;
    type: string;
    status: string;
    totalAmount: string;
    currencyCode: string;
    generatedDocuments: { id: string; reference: string }[];
  }[];
  /** Absent pour LOGISTICS_COORD — un prix d'achat visible livrerait la marge
   *  par soustraction avec les factures client, déjà visibles (§ 5.4). */
  supplierInvoices?: {
    id: string;
    reference: string;
    status: string;
    amount: string;
    currencyCode: string;
    supplier: { code: string; legalName: string };
    prepaidAt: string | null;
    settledAt: string | null;
  }[];
  margin: MarginBreakdown;
  thresholds: ThresholdVerdict;
}

export interface OperationalProcedureRow {
  id: string;
  code: string;
  label: string;
  description: string | null;
  procedure: {
    content: string;
    updatedAt: string;
    updatedBy: { fullName: string } | null;
  } | null;
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
 * Ligne de coût d'une opération — DISTINCTE de `DealCostLine` (le chiffrage
 * prévisionnel de l'affaire) : celle-ci porte le coût RÉEL, éventuellement
 * rattaché à la facture fournisseur qui le justifie (§ 14.6).
 */
export interface OperationCostLineRow {
  id: string;
  description: string | null;
  costPost: { code: string; label: string; nature: string };
  supplier: { code: string; legalName: string } | null;
  supplierId: string | null;
  supplierInvoiceId: string | null;
  estimatedAmount: string;
  actualAmount: string | null;
  currencyCode: string;
  isSystemComputed: boolean;
  incurredAt: string | null;
}

/**
 * Détail d'une opération.
 *
 * `operationTypes` n'est pas un ornement : c'est par ces types, et par eux
 * seuls, que les contrôles HSE de l'opération sont indexés. Les afficher, c'est
 * rendre lisible d'où vient la checklist — et pourquoi elle est vide quand
 * aucun type retenu n'en porte.
 */
export interface OperationDetail extends Omit<OperationRow, 'deal'> {
  /** `id` en plus de `OperationRow.deal` : la fiche affaire l'a, la liste ne l'a pas. */
  deal: OperationRow['deal'] & { id: string };
  hseGate: HseGate;
  measurements: MeasurementSummary[];
  operationTypes: CarriedOperationType[];
  /** ⚠️ Servie par le serveur depuis toujours ; jamais déclarée ici, donc
   *  jamais affichée : `_count.costLines` donnait un nombre, jamais le détail
   *  qui permet de le rattacher à une facture fournisseur (§ 14.6). */
  costLines: OperationCostLineRow[];

  /** Le site de livraison, directement, et ce qu'il exige (§ 6.2). */
  destinationSite: {
    id: string;
    code: string;
    name: string;
    city: string | null;
    usages: string[];
    accessInstructions: string | null;
    openingHours: string | null;
    safetyInstructions: string | null;
    requirements: SiteRequirement[];
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
  uom: string;
  unitPrice: string;
  paymentMethod: string | null;
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
  deal: { id: string; reference: string };
  fneTransmission: { status: string; fiscalReference: string | null } | null;
}

/**
 * Détail complet d'une facture — historique de règlement et filiation
 * (§ 9). Distinct d'`InvoiceRow` : la liste ne porte qu'un `paidAmount`
 * agrégé, jamais le détail par règlement, ni les avoirs qui s'y rattachent,
 * ni qui a émis ou décidé la pièce.
 *
 * ⚠️ CORRIGÉ — `GET /invoices/:id` N'AVAIT AUCUN APPELANT : pour toute
 *    facture partiellement réglée ou contestée, un comptable n'avait aucun
 *    moyen de voir le détail des règlements déjà reçus.
 */
export interface InvoiceDetail extends InvoiceRow {
  sourceProforma: { id: string; number: string } | null;
  correctedInvoice: { id: string; number: string } | null;
  creditNotes: { id: string; number: string; totalAmount: string }[];
  payments: {
    id: string;
    amount: string;
    currencyCode: string;
    valueDate: string;
    bankReference: string | null;
    notes: string | null;
  }[];
  issuedBy: { fullName: string; role: string } | null;
  simpleInvoiceDecidedBy: { fullName: string; role: string } | null;
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
  version: number;
  isActive: boolean;
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
  credit_limit_xof: string;
  receivables_xof: string;
  commitments_xof: string;
  guarantees_xof: string;
  exposure_xof: string;
  available_credit_xof: string;
  utilisation_pct: string | null;
}

export interface BargePnLRow {
  vehicleId: string;
  registration: string;
  brandModel: string | null;
  isActive: boolean;
  isCompliant: boolean;
  voyages: number;
  /** Par unité (L, M3, MT, BBL) : elles ne s'additionnent pas entre elles. */
  volumeParUnite: Record<string, number>;
  displayCurrency: string;
  revenueXof: number;
  operatingCostXof: number;
  maintenanceCostXof: number;
  marginXof: number;
  maintenanceEventCount: number;
  nextMaintenanceDue: string | null;
}

export interface VehicleMaintenanceRow {
  id: string;
  vehicleId: string;
  type: 'PREVENTIVE' | 'CORRECTIVE' | 'REGULATORY';
  description: string;
  cost: string;
  currencyCode: string;
  performedAt: string;
  nextDueAt: string | null;
  performedBy: string | null;
  recordedBy: { fullName: string } | null;
  createdAt: string;
}

export interface AgedReceivableLine {
  invoiceId: string;
  number: string;
  status: string;
  dueDate: string | null;
  currencyCode: string;
  outstanding: number;
  outstandingPivot: number;
  partner: { id: string; code: string; legalName: string };
  dunningCount: number;
  bucket: 'A_VENIR' | 'J1_30' | 'J31_60' | 'J61_90' | 'J90_PLUS' | 'SANS_ECHEANCE';
  daysOverdue: number | null;
}

export interface AgedReceivables {
  lines: AgedReceivableLine[];
  byPartner: {
    partner: { id: string; code: string; legalName: string };
    buckets: Record<'A_VENIR' | 'J1_30' | 'J31_60' | 'J61_90' | 'J90_PLUS' | 'SANS_ECHEANCE', number>;
    total: number;
  }[];
}

export interface DunningActionRow {
  id: string;
  invoiceId: string;
  method: 'PHONE' | 'EMAIL' | 'LETTER' | 'VISIT' | 'OTHER';
  notes: string;
  contactedAt: string;
  recordedBy: { fullName: string } | null;
  createdAt: string;
}

export interface QuotationProformaRow {
  id: string;
  number: string;
  status: string;
  billedVolume: string;
  uom: string;
  unitPrice: string;
  currencyCode: string;
  acceptedAt: string | null;
}

export interface QuotationRequestInternalRow {
  id: string;
  partnerId: string;
  productId: string;
  desiredVolume: string;
  uom: string;
  desiredDeliveryDate: string | null;
  message: string | null;
  status: 'NEW' | 'IN_REVIEW' | 'PROFORMA_APPROVED' | 'CONVERTED' | 'DECLINED';
  createdAt: string;
  partner: { code: string; legalName: string; segment: string | null };
  product: { code: string; name: string; isService: boolean };
  submittedByPortalUser: { fullName: string; email: string };
  convertedDeal: { id: string; reference: string } | null;
  approvedProforma: { id: string; number: string } | null;
  proformas: QuotationProformaRow[];
}

export interface OutstandingAdvanceRow {
  reference: string;
  supplier: string;
  deal: string | null;
  currency_code: string;
  prepaid_amount: string;
  settled_amount: string;
  outstanding_amount: string;
  outstanding_xof: string;
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
  /** Nombre de pools FIXES budgétés. Les charges fixes en sont la somme. */
  pools_de_charges_fixes: string;
  devise_charges: string | null;
  marge_unitaire: string | null;
  volume_realise: string | null;
  devise_marge: string | null;
  uom: string | null;
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
 * Ce que les charges devraient coûter au litre, et ce qu'elles coûtent.
 *
 * Trois assiettes pour un même budget. Une seule fait foi.
 *
 * ⚠️ SEUL `taux_applique` ENTRE DANS LE CALCUL DE MARGE.
 *
 *    Les deux autres sont un thermomètre. Si le taux révisé alimentait la
 *    marge, une année sous les prévisions ferait monter la charge au litre,
 *    davantage d'affaires passeraient sous le seuil, le volume baisserait
 *    encore — la spirale d'absorption du § 14.2.
 *
 * ⚠️ LE NUMÉRATEUR EST TOUJOURS LE BUDGET.
 *
 *    Aucune comptabilité de charges n'existe dans ce système. Ce tableau ne
 *    compare pas « budgété contre dépensé » mais « sur combien de litres
 *    j'espérais étaler » contre « sur combien je vais réellement les étaler ».
 *    La colonne `perimetre` le dit, et l'écran l'affiche.
 */
export interface AbsorptionReelle {
  pool: string;
  pool_libelle: string;
  nature: string;
  devise: string;
  exercice: number;
  budget: string;
  uom: string | null;
  assiette_budget: string;
  taux_applique: string;
  assiette_revisee: string | null;
  taux_si_revision: string | null;
  ecart_revision: string | null;
  ecart_revision_pct: string | null;
  mois_ecoules: number;
  mois_total: number;
  volume_realise: string | null;
  taux_a_date: string | null;
  ecart_a_date: string | null;
  ecart_a_date_pct: string | null;
  perimetre: string;
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

/** Bornes d'un découpage nommé, résolues EN BASE et non côté écran. */
export interface BornesPeriode {
  debut: string;
  fin: string;
  libelle: string;
  en_cours: boolean;
}

/**
 * Performance par commercial (§ 16).
 *
 * ⚠️ TROIS FAMILLES DE CHIFFRES, QU'UN INDICATEUR UNIQUE CONFONDRAIT.
 *
 *    Ce qui est ESPÉRÉ — le pipeline, qui dépend de probabilités déclarées.
 *    Ce qui est SIGNÉ — les affaires, qui ne dépendent d'aucune hypothèse.
 *    À QUEL PRIX — marge, et proximité du seuil.
 *
 *    Un commercial qui remplit son pipeline sans rien signer, et un autre qui
 *    signe tout au ras du seuil, ont tous deux un problème. Le tableau les
 *    distingue.
 */
export interface PerformanceCommerciale {
  owner_id: string;
  commercial: string;
  role: string;
  /** La période RÉELLEMENT agrégée — rendue avec les chiffres, jamais devinée. */
  periode_debut: string;
  periode_fin: string;
  periode_origine: string;
  opportunites_ouvertes: string;
  ca_previsionnel: string;
  valeur_ponderee: string | null;
  sans_probabilite: string;
  actions_en_retard: string;
  gagnees: string;
  perdues: string;
  conversion_pct: string | null;
  affaires: string;
  volume: string;
  chiffre_affaires: string;
  affaires_approuvees: string;
  marge_unitaire_moyenne: string | null;
  affaires_sur_derogation: string;
  affaires_dans_la_bande: string;
  part_dans_la_bande_pct: string | null;
  ecart_moyen_au_seuil_pct: string | null;
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

/**
 * Devise du référentiel (§ 9.2).
 *
 * ⚠️ `isPivot` N'EST PAS UN DÉFAUT, C'EST UNE ÉTIQUETTE.
 *
 *    Le pivot sert à COMPARER des engagements pris dans des monnaies
 *    différentes. Il n'est la monnaie de personne, et aucune saisie ne doit le
 *    proposer d'office. `isLocal` désigne la monnaie de l'entreprise : c'est
 *    elle, et elle seule, qui sert de valeur de départ.
 */
export interface DeviseOption {
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: number;
  isPivot: boolean;
  isLocal: boolean;
}

/** Une valeur d'énumération et son libellé français. */
export interface VocabItem {
  code: string;
  label: string;
}

export interface VocabulaireCatalogue {
  hseEventType: VocabItem[];
  hseSeverity: VocabItem[];
  invoicePaymentMethod: VocabItem[];
  complianceType: VocabItem[];
  dunningMethod: VocabItem[];
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
  recorded_cost_xof: string;
  supplier_billed_xof: string;
  supplier_paid_xof: string;
  prepaid_xof: string;
  unreconciled_xof: string;
  cost_without_invoice_xof: string;
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
    | 'referenceList'
    /** Numéro de version : liste dont les numéros déjà pris sont retirés. */
    | 'version';
  required?: boolean;
  values?: string[];
  /** Libellé français de chaque valeur : l'affichage seul, jamais la valeur. */
  valueLabels?: Record<string, string>;
  refTable?: string;
  refKey?: string;
  decimals?: number;
  help?: string;
}

/** Décrit une table administrable — l'écran de paramétrage en découle. */
export interface ReferentialSpec {
  key: string;
  label: string;
  /** Groupe du menu Paramétrage (§ ordre logique du registre), pour le sous-titre affiché. */
  group: string;
  /** `historised` : rien n'est réécrit, chaque évolution crée une ligne datée. */
  nature: 'mutable' | 'historised';
  identity: string[];
  caution: string | null;
  /**
   * Champ portant la date d'entrée en vigueur, sur une donnée historisée.
   *
   * L'écran en a besoin pour proposer une date NEUVE quand on repart d'une
   * ligne existante : reprendre l'ancienne heurterait la règle « une donnée
   * historisée ne se réécrit pas », au moment précis où l'on croit publier.
   */
  effectiveFrom?: string | null;
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

/** Une ligne de la matrice DG : un écran, avec l'état de chaque rôle. */
export interface ScreenAccessRow {
  key: string;
  label: string;
  group: string;
  roles: Record<
    string,
    { defaultVisible: boolean; override: 'VISIBLE' | 'MASQUE' | null; effective: boolean }
  >;
}

/** Un compte interne, tel que rendu par /users. */
export interface UserAdminRow {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Un compte terrain, tel que rendu par /field-users. */
export interface FieldUserAdminRow {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  assignedDeviceId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Un compte portail, tel que rendu par /partners/:id/portal-users. */
export interface PortalUserAdminRow {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
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

  complianceRecord(id: string): Observable<ComplianceRecordDetail> {
    return this.http.get<ComplianceRecordDetail>(`${this.base}/compliance/records/${id}`);
  }

  /** En `blob` : la pièce numérisée se regarde, l'en-tête d'autorisation ne
   *  traverse jamais un simple `<a href>`. */
  complianceDocumentBlob(recordId: string): Observable<Blob> {
    return this.http.get(`${this.base}/compliance/records/${recordId}/document`, {
      responseType: 'blob',
    });
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

  /**
   * Accorde une dérogation (§ 11.4).
   *
   * ⚠️ CORRIGÉ — CETTE ROUTE N'AVAIT AUCUN APPELANT.
   *
   *    `POST /derogations` existait depuis toujours, réservée à DG/DAF/CCOO et
   *    vérifiée en base par type. Mais aucun écran ne l'appelait : le registre
   *    savait lister, revoir et révoquer des dérogations, jamais en accorder
   *    une. Un DG ne pouvait lever AUCUN verrou — marge, conformité, HSE,
   *    encours — depuis l'application.
   */
  createDerogation(body: CreateDerogationInput): Observable<Derogation> {
    return this.http.post<Derogation>(`${this.base}/derogations`, body);
  }

  // --- Suppléance du contrôleur HSE (§ 3.4) --------------------------------
  //
  // ⚠️ CORRIGÉ — NI LA ROUTE NI L'ÉCRAN N'EXISTAIENT. Voir le commentaire de
  //    `DelegationService` (derogations.controller.ts) pour les trois
  //    endroits qui devaient bouger ensemble pour que la suppléance ait un
  //    effet réel, pas seulement une ligne de registre.

  fieldUsersForDelegation(): Observable<
    { id: string; fullName: string; email: string; role: string }[]
  > {
    return this.http.get<{ id: string; fullName: string; email: string; role: string }[]>(
      `${this.base}/delegations/field-users`,
    );
  }

  createDelegation(body: {
    delegateFieldUserId: string;
    reason: string;
    startsAt: string;
    endsAt: string;
  }): Observable<unknown> {
    return this.http.post(`${this.base}/delegations`, body);
  }

  // --- Référentiels --------------------------------------------------------

  partners(page = 1, search?: string, type?: string): Observable<Page<Partner>> {
    let params = new HttpParams().set('page', page).set('pageSize', 50);
    if (search) params = params.set('search', search);
    if (type) params = params.set('type', type);
    return this.http.get<Page<Partner>>(`${this.base}/referentials/partners`, { params });
  }

  /**
   * Contrats-cadres actifs — un contrat peut porter plusieurs affaires (§ 5.1).
   * Lecture dédiée à la création d'affaire, pas le référentiel générique : le
   * commercial peut créer une affaire sans avoir le droit de lire la fiche
   * contrat complète (`/referentials/contracts`, réservée DG/CCOO/CFO).
   */
  contracts(): Observable<ContractRow[]> {
    return this.http.get<ContractRow[]>(`${this.base}/deals/lookups/contracts`);
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
   * Sites actifs, filtrés par usage. Référentiel autonome : un lieu peut
   * servir plusieurs clients, il ne se choisit plus depuis une fiche tiers.
   */
  sites(usage?: 'LOADING' | 'DELIVERY'): Observable<DeliverySite[]> {
    let params = new HttpParams();
    if (usage) params = params.set('usage', usage);
    return this.http.get<DeliverySite[]>(`${this.base}/referentials/sites`, { params });
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

  /**
   * Cours courant du pivot vers la devise locale d'affichage.
   *
   * Sert à convertir en XOF, côté écran, un total agrégé à partir de lignes
   * déjà exprimées au pivot — jamais à afficher le pivot lui-même.
   */
  pivotLocalRate(): Observable<{ pivot: string; local: string; rate: number }> {
    return this.http.get<{ pivot: string; local: string; rate: number }>(
      `${this.base}/referentials/pivot-local-rate`,
    );
  }

  /**
   * Libellés français des énumérations sans référentiel propre : nature et
   * gravité HSE, mode de règlement, nature de pièce de conformité, méthode de
   * relance. Source unique - avant cette route, chacun des quatre écrans
   * recopiait sa propre liste.
   */
  vocabulaires(): Observable<VocabulaireCatalogue> {
    return this.http.get<VocabulaireCatalogue>(`${this.base}/referentials/vocabulaires`);
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

  /**
   * Création d'affaire — champs de base uniquement (SPECIFICATIONS.md § 5.4).
   * Le chiffrage des coûts et le rattachement d'un prix fournisseur se font
   * ENSUITE, depuis la fiche affaire (`erp-deal-costing`, `erp-deal-actions`) :
   * ils exigent un `dealId` existant, la création ne peut pas les porter.
   */
  createDeal(dto: CreateDealInput): Observable<DealRow> {
    return this.http.post<DealRow>(`${this.base}/deals`, dto);
  }

  /** Suppression d'une affaire encore au brouillon (seul statut supprimable). */
  deleteDeal(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/deals/${id}`);
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
    body: {
      marginDerogationId?: string;
      purchasePriceDerogationId?: string;
      creditDerogationId?: string;
      note?: string;
    } = {},
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

  /**
   * Rattache la dérogation qui lève un verrou HSE autrement définitif
   * (§ 11.2). Voir `erp-derogation-inline` pour l'octroi de la dérogation
   * elle-même.
   */
  attachHseDerogation(operationId: string, derogationId: string): Observable<unknown> {
    return this.http.patch(`${this.base}/operations/${operationId}/hse-derogation`, {
      derogationId,
    });
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

  /**
   * Rattache une ligne de coût à la facture fournisseur qui la justifie
   * (§ 14.6).
   *
   * ⚠️ CORRIGÉ — CETTE ROUTE N'AVAIT AUCUN APPELANT. La règle était écrite,
   *    réservée au DAF et au comptable, et impossible à exercer : un coût
   *    RÉEL enregistré sur une opération et une facture fournisseur reçue
   *    restaient deux enregistrements sans lien, alors même que le
   *    rapprochement (`costReconciliation()`) est le contrôle anti-détournement
   *    le plus solide dont dispose l'entreprise — précisément parce qu'il ne
   *    repose sur aucune déclaration.
   */
  attachCostLine(supplierInvoiceId: string, costLineId: string): Observable<unknown> {
    return this.http.patch(
      `${this.base}/supplier-invoices/${supplierInvoiceId}/cost-lines/${costLineId}`,
      {},
    );
  }

  // --- Actions sur une pièce de facturation (§ 9) --------------------------

  createInvoice(body: Record<string, unknown>): Observable<{ id: string; number: string }> {
    return this.http.post<{ id: string; number: string }>(`${this.base}/invoices`, body);
  }

  invoiceDetail(id: string): Observable<InvoiceDetail> {
    return this.http.get<InvoiceDetail>(`${this.base}/invoices/${id}`);
  }

  /** Suppression d'une pièce encore au brouillon (seul statut supprimable). */
  deleteInvoice(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/invoices/${id}`);
  }

  /**
   * Vérification d'authenticité par jeton - route PUBLIQUE, aucun jeton de
   * session n'est requis ni envoyé (§ le token du QR code EST l'accès).
   */
  verifyDocument(token: string): Observable<{
    valid: boolean;
    message: string;
    kind?: string;
    reference?: string;
    sha256?: string;
    generatedAt?: string;
    sealed?: boolean;
    sealedAt?: string | null;
    superseded?: string | null;
  }> {
    return this.http.get(`${this.base}/documents/verify/${token}`) as Observable<{
      valid: boolean;
      message: string;
      kind?: string;
      reference?: string;
      sha256?: string;
      generatedAt?: string;
      sealed?: boolean;
      sealedAt?: string | null;
      superseded?: string | null;
    }>;
  }

  convertProforma(id: string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/invoices/${id}/convert`, body);
  }

  issueInvoice(id: string, dueDate?: string): Observable<unknown> {
    return this.http.patch(`${this.base}/invoices/${id}/issue`, { dueDate });
  }

  /** Annulation directe — fermée dès qu'un encaissement existe (§ arbitrage 15/08). */
  cancelInvoice(id: string, reason: string): Observable<unknown> {
    return this.http.patch(`${this.base}/invoices/${id}/cancel`, { reason });
  }

  /** Reprise d'une transmission FNE restée en attente ou à corriger. */
  retryFneTransmission(id: string): Observable<unknown> {
    return this.http.patch(`${this.base}/invoices/${id}/fne/retry`, {});
  }

  /** Met en file la génération du PDF (§ 1.1) — jamais rendue en ligne. */
  queueInvoicePdf(id: string): Observable<{ jobId: string }> {
    return this.http.post<{ jobId: string }>(`${this.base}/invoices/${id}/pdf`, {});
  }

  documentPdfJobStatus(jobId: string): Observable<{
    state: string;
    attemptsMade: number;
    failedReason: string | null;
    result: { documentId: string; reference: string } | null;
  }> {
    return this.http.get<{
      state: string;
      attemptsMade: number;
      failedReason: string | null;
      result: { documentId: string; reference: string } | null;
    }>(`${this.base}/documents/jobs/${jobId}`);
  }

  /** En `blob` et non en `<a href>` nu : le jeton porté par l'intercepteur
   *  est un en-tête `Authorization`, que la navigation native ne pose jamais. */
  downloadDocument(documentId: string): Observable<Blob> {
    return this.http.get(`${this.base}/documents/${documentId}/download`, { responseType: 'blob' });
  }

  // --- Pièces jointes terrain, vues du bureau (§ 7.2) ----------------------
  //
  // ⚠️ CORRIGÉ — `InternalAttachmentsController` N'AVAIT AUCUN APPELANT.
  //
  //    Son propre commentaire dit que la validation à distance, sur photos,
  //    est le mode NORMAL de fonctionnement (l'entreprise ne compte qu'un
  //    contrôleur HSE). Sans ces deux méthodes, `hse.component.ts` validait
  //    des checklists à l'aveugle : le nombre de points bloquants, jamais la
  //    preuve photographique qui les documente.

  attachmentsForOperation(operationId: string): Observable<AttachmentRow[]> {
    const params = new HttpParams().set('operationId', operationId);
    return this.http.get<AttachmentRow[]>(`${this.base}/attachments`, { params });
  }

  /** En `blob`, comme `downloadDocument` : l'en-tête d'autorisation ne
   *  traverse jamais un simple `<img src>`. */
  attachmentBlob(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/attachments/${id}`, { responseType: 'blob' });
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

  documents(page = 1): Observable<Page<unknown>> {
    return this.http.get<Page<unknown>>(`${this.base}/documents`, {
      params: new HttpParams().set('page', page).set('pageSize', 50),
    });
  }

  signDocument(id: string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/documents/${id}/signatures`, body);
  }

  sealDocument(id: string): Observable<unknown> {
    return this.http.patch(`${this.base}/documents/${id}/seal`, {});
  }

  /**
   * `FormData` : le fichier voyage avec le reste des champs, et le serveur en
   * calcule lui-même la clé de stockage et l'empreinte — voir le commentaire
   * de `DocumentsController.register`. Angular pose lui-même l'en-tête
   * `Content-Type` avec la bonne frontière multipart.
   */
  supersedeDocument(id: string, file: File, body: Record<string, unknown>): Observable<unknown> {
    const corps = new FormData();
    corps.append('file', file);
    for (const [k, v] of Object.entries(body)) if (v !== undefined && v !== null) corps.append(k, String(v));
    return this.http.post(`${this.base}/documents/${id}/supersede`, corps);
  }

  registerDocument(file: File, body: Record<string, unknown>): Observable<unknown> {
    const corps = new FormData();
    corps.append('file', file);
    for (const [k, v] of Object.entries(body)) if (v !== undefined && v !== null) corps.append(k, String(v));
    return this.http.post(`${this.base}/documents`, corps);
  }

  // --- HSE et conformité ----------------------------------------------------

  hseChecks(operationId: string): Observable<unknown[]> {
    return this.http.get<unknown[]>(`${this.base}/hse/operations/${operationId}/checks`);
  }

  validateHseCheckAsDg(checkId: string): Observable<unknown> {
    return this.http.patch(`${this.base}/hse/checks/${checkId}/validate`, {});
  }

  rejectHseCheckAsDg(checkId: string, reason: string): Observable<unknown> {
    return this.http.patch(`${this.base}/hse/checks/${checkId}/reject`, { reason });
  }

  openHseEvent(body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/hse/events`, body);
  }

  addComplianceRecord(body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/compliance/records`, body);
  }

  /**
   * Dépôt du scan, AVANT l'enregistrement qui le référence (§ commentaire de
   * `ComplianceService.uploadDocument`). `FormData` : Angular pose lui-même
   * l'en-tête `Content-Type` avec la bonne frontière multipart, le poser à
   * la main casserait l'envoi.
   */
  uploadComplianceDocument(file: File, type: string): Observable<{ id: string; title: string }> {
    const corps = new FormData();
    corps.append('file', file);
    corps.append('type', type);
    return this.http.post<{ id: string; title: string }>(`${this.base}/compliance/documents`, corps);
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

  // --- Barge (§ 13 module 7) ------------------------------------------------

  bargePnL(): Observable<BargePnLRow[]> {
    return this.http.get<BargePnLRow[]>(`${this.base}/supervision/barges`);
  }

  vehicleMaintenance(vehicleId: string): Observable<VehicleMaintenanceRow[]> {
    return this.http.get<VehicleMaintenanceRow[]>(`${this.base}/vehicles/${vehicleId}/maintenance`);
  }

  recordMaintenance(vehicleId: string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/vehicles/${vehicleId}/maintenance`, body);
  }

  // --- Recouvrement (§ 3.3, § 14.6) -----------------------------------------

  agedReceivables(): Observable<AgedReceivables> {
    return this.http.get<AgedReceivables>(`${this.base}/supervision/aged-receivables`);
  }

  dunningHistory(invoiceId: string): Observable<DunningActionRow[]> {
    return this.http.get<DunningActionRow[]>(`${this.base}/invoices/${invoiceId}/dunning`);
  }

  recordDunning(invoiceId: string, body: Record<string, unknown>): Observable<unknown> {
    return this.http.post(`${this.base}/invoices/${invoiceId}/dunning`, body);
  }

  parametresRequis(): Observable<ParametreRequis[]> {
    return this.http.get<ParametreRequis[]>(`${this.base}/supervision/parametres-requis`);
  }

  // --- Journal d'audit (§ 1.4) — DG / IT_ADMIN uniquement --------------------

  auditLog(filters: AuditLogFilters = {}, page = 1): Observable<Page<AuditLogRow>> {
    let params = new HttpParams().set('page', page).set('pageSize', 50);
    for (const [k, v] of Object.entries(filters)) {
      if (v) params = params.set(k, v);
    }
    return this.http.get<Page<AuditLogRow>>(`${this.base}/audit-log`, { params });
  }

  // --- Demandes de cotation (portail → commercial) --------------------------

  quotations(status?: string): Observable<QuotationRequestInternalRow[]> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);
    return this.http.get<QuotationRequestInternalRow[]>(`${this.base}/quotations`, { params });
  }

  markQuotationInReview(id: string): Observable<unknown> {
    return this.http.patch(`${this.base}/quotations/${id}/en-etude`, {});
  }

  declineQuotation(id: string, reason: string): Observable<unknown> {
    return this.http.patch(`${this.base}/quotations/${id}/decliner`, { reason });
  }

  /**
   * Crée l'affaire à partir d'une demande APPROUVÉE et la relie (§ discussion
   * 17/08) - tiers, produit, volume, prix et devise viennent de la demande et
   * de la proforma retenue ; seuls transport/site restent à préciser.
   */
  convertQuotation(
    id: string,
    body: {
      segment: string;
      transportMode?: string;
      siteId?: string;
      deliveryLocation?: string;
    },
  ): Observable<unknown> {
    return this.http.patch(`${this.base}/quotations/${id}/convertir`, body);
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

  /**
   * Performance par commercial sur une période.
   *
   * `periode` : MOIS · TRIMESTRE · SEMESTRE · ANNEE_CIVILE · EXERCICE.
   * `ancre`   : un jour DANS la période voulue. Sans rien, la période par
   * défaut — exercice courant, ou année civile s'il n'y en a pas.
   */
  performanceCommerciale(periode?: string, ancre?: string): Observable<PerformanceCommerciale[]> {
    let params = new HttpParams();
    if (periode) params = params.set('periode', periode);
    if (ancre) params = params.set('ancre', ancre);
    return this.http.get<PerformanceCommerciale[]>(
      `${this.base}/supervision/performance-commerciale`,
      { params },
    );
  }

  bornesPeriode(periode?: string, ancre?: string): Observable<BornesPeriode[]> {
    let params = new HttpParams();
    if (periode) params = params.set('periode', periode);
    if (ancre) params = params.set('ancre', ancre);
    return this.http.get<BornesPeriode[]>(`${this.base}/supervision/periode-bornes`, { params });
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

  /** Devises actives, pour toute saisie monétaire. */
  devises(): Observable<DeviseOption[]> {
    return this.http
      .get<DeviseOption[]>(`${this.base}/referentials/currencies`)
      .pipe(map((l) => l.filter((d) => (d as unknown as { isActive?: boolean }).isActive !== false)));
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

  absorptionReelle(): Observable<AbsorptionReelle[]> {
    return this.http.get<AbsorptionReelle[]>(`${this.base}/supervision/absorption-reelle`);
  }

  previsionVente(): Observable<PrevisionVente[]> {
    return this.http.get<PrevisionVente[]>(`${this.base}/supervision/prevision-vente`);
  }

  // --- Procédures opérationnelles -------------------------------------------

  operationalProcedures(): Observable<OperationalProcedureRow[]> {
    return this.http.get<OperationalProcedureRow[]>(`${this.base}/operational-procedures`);
  }

  setOperationalProcedure(operationTypeId: string, content: string): Observable<unknown> {
    return this.http.patch(`${this.base}/operational-procedures/${operationTypeId}`, { content });
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

  /**
   * Ce qui est déjà enregistré pour un référentiel.
   *
   * Les références y sont doublées d'une clé lisible sous `_lisible` : l'écran
   * de consultation montre « ADM » là où la ligne porte un identifiant.
   */
  lignesReferentiel(
    key: string,
    options: { page?: number; pageSize?: number; search?: string } = {},
  ): Observable<Page<Record<string, unknown>>> {
    let params = new HttpParams();
    if (options.page) params = params.set('page', options.page);
    if (options.pageSize) params = params.set('pageSize', options.pageSize);
    if (options.search) params = params.set('search', options.search);
    return this.http.get<unknown>(`${this.base}/referentials/${key}/lignes`, { params }).pipe(
      map((payload) => {
        // ⚠️ DEUX FORMES DE RÉPONSE, ET IL FAUT LES DEUX.
        //
        //    La lecture générique rend désormais une page. Les routes dédiées
        //    — devises, produits, postes de coût — rendent toujours un tableau
        //    simple : ce sont des listes bornées qu'on charge d'un bloc pour
        //    alimenter des listes déroulantes.
        if (Array.isArray(payload)) {
          const items = payload as Record<string, unknown>[];
          return { items, page: 1, pageSize: items.length, total: items.length, totalPages: 1 };
        }
        return payload as Page<Record<string, unknown>>;
      }),
    );
  }

  /**
   * Numéros de version encore libres pour la combinaison d'identité donnée.
   *
   * L'identité passe en paramètres d'URL parce que la liste en DÉPEND : la
   * version 1 du pool Administration 2026 et celle du pool HSE 2026 coexistent
   * normalement, et les numéros pris ne sont pas les mêmes.
   */
  versionsLibres(
    key: string,
    identite: Record<string, string>,
  ): Observable<{ champ: string; prises: number[]; libres: number[]; suivant: number | null }> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(identite)) params = params.set(k, v);
    return this.http.get<{
      champ: string;
      prises: number[];
      libres: number[];
      suivant: number | null;
    }>(`${this.base}/referentials/${key}/versions-libres`, { params });
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

  // --- Accès aux écrans, paramétrage DG (§ paramétrage 17/08) --------------

  screenAccessMatrix(): Observable<ScreenAccessRow[]> {
    return this.http.get<ScreenAccessRow[]>(`${this.base}/screen-access`);
  }

  /** `override: null` rétablit l'hérité — supprime la dérogation. */
  setScreenAccess(
    role: string,
    screenKey: string,
    override: 'VISIBLE' | 'MASQUE' | null,
  ): Observable<unknown> {
    return this.http.patch(`${this.base}/screen-access`, { role, screenKey, override });
  }

  // --- Gestion des comptes — internes, terrain, portail ---------------------

  users(): Observable<UserAdminRow[]> {
    return this.http.get<UserAdminRow[]>(`${this.base}/users`);
  }

  createUser(dto: { email: string; fullName: string; role: string; password: string }) {
    return this.http.post<{ id: string; email: string }>(`${this.base}/users`, dto);
  }

  updateUser(id: string, dto: { role?: string; isActive?: boolean }) {
    return this.http.patch<{ id: string; role: string; isActive: boolean }>(
      `${this.base}/users/${id}`,
      dto,
    );
  }

  resetUserPassword(id: string, password: string) {
    return this.http.patch<{ id: string; mustChangePassword: boolean }>(
      `${this.base}/users/${id}/reset-password`,
      { password },
    );
  }

  fieldUsers(): Observable<FieldUserAdminRow[]> {
    return this.http.get<FieldUserAdminRow[]>(`${this.base}/field-users`);
  }

  createFieldUser(dto: { email: string; fullName: string; role: string; password: string }) {
    return this.http.post<{ id: string; email: string }>(`${this.base}/field-users`, dto);
  }

  updateFieldUser(id: string, dto: { role?: string; isActive?: boolean }) {
    return this.http.patch<{ id: string; role: string; isActive: boolean }>(
      `${this.base}/field-users/${id}`,
      dto,
    );
  }

  resetFieldUserPassword(id: string, password: string) {
    return this.http.patch<{ id: string; mustChangePassword: boolean }>(
      `${this.base}/field-users/${id}/reset-password`,
      { password },
    );
  }

  portalUsers(partnerId: string): Observable<PortalUserAdminRow[]> {
    return this.http.get<PortalUserAdminRow[]>(`${this.base}/partners/${partnerId}/portal-users`);
  }

  createPortalUser(partnerId: string, dto: { email: string; fullName: string; password: string }) {
    return this.http.post<{ id: string; email: string }>(
      `${this.base}/partners/${partnerId}/portal-users`,
      dto,
    );
  }

  updatePortalUser(partnerId: string, id: string, dto: { isActive?: boolean }) {
    return this.http.patch<{ id: string; isActive: boolean }>(
      `${this.base}/partners/${partnerId}/portal-users/${id}`,
      dto,
    );
  }

  resetPortalUserPassword(partnerId: string, id: string, password: string) {
    return this.http.patch<{ id: string; mustChangePassword: boolean }>(
      `${this.base}/partners/${partnerId}/portal-users/${id}/reset-password`,
      { password },
    );
  }
}
