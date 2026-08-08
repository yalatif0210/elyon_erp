import {
  AllocationBasis,
  ContractStatus,
  CostBasis,
  HseControlLevel,
  HsePhotoPolicy,
  HseRiskLevel,
  CreditStatus,
  GuaranteeStatus,
  GuaranteeType,
  PartnerType,
  VehicleType,
  OperationPhase,
  SiteUsage,
  CommercialSegment,
  CostNature,
  CostVariability,
  CrmStageOutcome,
  FiscalYearStatus,
  ForecastKind,
  FxRateType,
  PriceReferenceType,
  TransportMode,
  UnitOfMeasure,
  UserRole,
} from '@prisma/client';

/**
 * REGISTRE DES TABLES ADMINISTRABLES — SPECIFICATIONS.md § 1.1 bis
 *
 * « Toute donnée dont l'ERP a besoin pour fonctionner doit être administrable
 *   de deux façons : par une interface de saisie, et par import de fichier. »
 *
 * Plutôt que dix contrôleurs sur mesure, chaque référentiel se DÉCLARE ici.
 * L'API d'écriture, l'import de fichier, le rapport de rejet ligne à ligne et
 * l'écran de paramétrage en découlent tous. Ajouter un référentiel devient
 * une déclaration, pas un développement — ce qui est la seule façon de tenir
 * l'exigence dans la durée.
 *
 * DEUX NATURES, à ne pas confondre :
 *
 *   `mutable`      — l'objet se corrige sur place. Une devise mal orthographiée
 *                    est une erreur de saisie, pas un fait historique.
 *
 *   `historised`   — l'objet ne se modifie JAMAIS. Une évolution crée une
 *                    nouvelle ligne datée, et l'ancienne est close. Un taux de
 *                    change, un prix publié ou un seuil de marge gouvernent des
 *                    calculs passés : les réécrire falsifierait rétroactivement
 *                    des factures et des approbations déjà émises.
 */

export type FieldType =
  | 'string'
  | 'text'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'enum'
  /** Liste de valeurs d'une énumération, séparées par des virgules. */
  | 'enumList'
  | 'reference'
  /** Liste de références, par leur code lisible — « ROUTE, SOUTAGE ». */
  | 'referenceList';

export interface FieldSpec {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Valeurs admises pour un `enum`. */
  values?: readonly string[];
  /** Référentiel visé par une `reference`, et champ servant de clé lisible. */
  refTable?: string;
  refKey?: string;
  /**
   * Vrai lorsque la `referenceList` vise une COLONNE TABLEAU d'identifiants,
   * et non une relation.
   *
   * ⚠️ Les deux se saisissent pareil — des codes séparés par des virgules —
   *    mais s'écrivent différemment : une relation attend `{ set: [{id}] }`,
   *    un tableau scalaire attend `['uuid', …]`. Écrire l'un pour l'autre
   *    échoue au moment de l'écriture, pas à la déclaration.
   */
  scalarList?: boolean;

  /**
   * Nom de la relation Prisma, pour une `referenceList`. Le registre pose un
   * `set` : la liste fournie remplace l'ancienne. Y ajouter au lieu de
   * remplacer rendrait impossible le retrait d'un élément par import.
   */
  relation?: string;
  /** Précision de restitution pour les nombres. */
  decimals?: number;
  help?: string;
}

export interface ReferentialSpec {
  /** Segment d'URL et clé d'import. */
  key: string;
  label: string;
  /** Nom du modèle Prisma, tel qu'exposé sur le client. */
  model: string;
  nature: 'mutable' | 'historised';
  /** Rôles autorisés à écrire. La lecture reste régie par le contrôleur. */
  writeRoles: UserRole[];
  /** Champs formant l'identité métier — servent à détecter un doublon. */
  identity: string[];
  fields: FieldSpec[];
  /**
   * Champ portant la date d'ouverture de validité, pour les tables
   * historisées : c'est lui qui permet de clore la ligne précédente.
   */
  effectiveFrom?: string;
  effectiveTo?: string;
  /** Ce que l'utilisateur doit comprendre avant de modifier quoi que ce soit. */
  caution?: string;
}

/**
 * Les valeurs admises sont DÉRIVÉES des énumérations Prisma, jamais recopiées.
 *
 * Une liste tenue à la main diverge du schéma sans prévenir : la saisie
 * accepte une valeur que la base refuse, ou refuse une valeur qu'elle
 * accepte. Le défaut ne se voit qu'à l'écriture, sur la ligne d'un
 * utilisateur.
 */
const values = <T extends Record<string, string>>(e: T): readonly string[] => Object.values(e);

const SEGMENTS = values(CommercialSegment);
const UOMS = values(UnitOfMeasure);
const TRANSPORT = values(TransportMode);

export const REFERENTIALS: ReferentialSpec[] = [
  // =========================================================================
  //  Devises — mutable : une faute de frappe se corrige.
  // =========================================================================
  {
    key: 'currencies',
    label: 'Devises',
    model: 'currency',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.FINANCE_CFO],
    identity: ['code'],
    caution:
      'Une seule devise pivot et une seule devise fonctionnelle sont admises — la base refuse la seconde.',
    fields: [
      { name: 'code', label: 'Code ISO', type: 'string', required: true, help: 'Trois lettres : XOF, USD, EUR' },
      { name: 'name', label: 'Libellé', type: 'string', required: true },
      { name: 'symbol', label: 'Symbole', type: 'string', required: true },
      {
        name: 'decimalPlaces',
        label: 'Décimales',
        type: 'integer',
        required: true,
        help: 'XOF = 0 : le franc CFA n’a pas de subdivision en circulation',
      },
      { name: 'isPivot', label: 'Devise pivot', type: 'boolean' },
      { name: 'isFunctional', label: 'Devise fonctionnelle', type: 'boolean' },
      { name: 'isLocal', label: 'Devise locale', type: 'boolean' },
      { name: 'isDocumentEligible', label: 'Imprimable sur pièce', type: 'boolean' },
      {
        name: 'pegCurrencyCode',
        label: 'Arrimée à',
        type: 'reference',
        refTable: 'currencies',
        refKey: 'code',
        help: 'Renseignée, elle interdit toute saisie de taux divergent',
      },
      { name: 'pegRate', label: 'Parité fixe', type: 'number', decimals: 8 },
      { name: 'isActive', label: 'Active', type: 'boolean' },
    ],
  },

  // =========================================================================
  //  Taux de change — HISTORISÉ.
  // =========================================================================
  {
    key: 'fx-rates',
    label: 'Taux de change',
    model: 'fxRate',
    nature: 'historised',
    writeRoles: [UserRole.DG, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT],
    identity: ['baseCurrencyCode', 'quoteCurrencyCode', 'rateType', 'effectiveFrom'],
    effectiveFrom: 'effectiveFrom',
    effectiveTo: 'effectiveTo',
    caution:
      'Une facture émise reste reconstituable au taux qui l’a produite. Un cours ne se corrige pas : on en publie un nouveau.',
    fields: [
      { name: 'baseCurrencyCode', label: 'Devise de base', type: 'reference', refTable: 'currencies', refKey: 'code', required: true },
      { name: 'quoteCurrencyCode', label: 'Devise cotée', type: 'reference', refTable: 'currencies', refKey: 'code', required: true },
      {
        name: 'rate',
        label: 'Cours',
        type: 'number',
        required: true,
        decimals: 8,
        help: 'Unités de la devise cotée pour 1 unité de la devise de base',
      },
      {
        name: 'rateType',
        label: 'Nature',
        type: 'enum',
        required: true,
        values: values(FxRateType),
      },
      { name: 'effectiveFrom', label: 'En vigueur depuis', type: 'date', required: true },
      { name: 'effectiveTo', label: 'Jusqu’au', type: 'date' },
      { name: 'notes', label: 'Note', type: 'text' },
    ],
  },

  // =========================================================================
  //  Produits — mutable.
  // =========================================================================
  {
    key: 'products',
    label: 'Produits',
    model: 'product',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD],
    identity: ['code'],
    fields: [
      { name: 'code', label: 'Code', type: 'string', required: true },
      { name: 'name', label: 'Désignation', type: 'string', required: true },
      { name: 'referenceDensity15', label: 'Densité à 15 °C', type: 'number', required: true, decimals: 6 },
      { name: 'defaultUom', label: 'Unité par défaut', type: 'enum', required: true, values: UOMS },
      { name: 'viscosityCst', label: 'Viscosité (cSt)', type: 'number', decimals: 3 },
      { name: 'flashPointC', label: 'Point éclair (°C)', type: 'number', decimals: 2 },
      { name: 'maxSulphurPct', label: 'Soufre max (%)', type: 'number', decimals: 4 },
      { name: 'taxRegime', label: 'Régime fiscal', type: 'string' },
      {
        name: 'uiColorToken',
        label: 'Teinte d’affichage',
        type: 'string',
        required: true,
        help: 'Canal visuel distinct des statuts — teinte désaturée, ex. « violet-400 »',
      },
      { name: 'isActive', label: 'Actif', type: 'boolean' },
    ],
  },

  // =========================================================================
  //  Seuils de marge — HISTORISÉ, et paramétrable par devise ET par unité.
  // =========================================================================
  {
    key: 'margin-thresholds',
    label: 'Seuils de marge',
    model: 'marginThreshold',
    nature: 'historised',
    writeRoles: [UserRole.DG, UserRole.FINANCE_CFO],
    identity: ['segment', 'productId', 'currencyCode', 'uom', 'effectiveFrom'],
    effectiveFrom: 'effectiveFrom',
    effectiveTo: 'effectiveTo',
    caution:
      'Ces valeurs bloquent des affaires. La devise ET l’unité entrent dans la clé : un même segment peut porter un seuil en XOF/L et un autre en USD/MT sans que l’un chasse l’autre.',
    fields: [
      { name: 'segment', label: 'Segment', type: 'enum', required: true, values: SEGMENTS },
      { name: 'productId', label: 'Produit', type: 'reference', refTable: 'products', refKey: 'code', help: 'Vide = tous les produits du segment' },
      {
        name: 'directFloor',
        label: 'Plancher direct',
        type: 'number',
        decimals: 4,
        help: 'Blocage dur : l’opération ne couvre pas ses coûts. Dérogation du DG obligatoire.',
      },
      {
        name: 'minimumMargin',
        label: 'Seuil de marge',
        type: 'number',
        decimals: 4,
        help: 'Sur la marge complète. Appelle l’accord du DG, ce n’est pas un refus.',
      },
      { name: 'currencyCode', label: 'Devise', type: 'reference', refTable: 'currencies', refKey: 'code', required: true },
      { name: 'uom', label: 'Unité', type: 'enum', required: true, values: UOMS },
      { name: 'effectiveFrom', label: 'En vigueur depuis', type: 'date', required: true },
      { name: 'effectiveTo', label: 'Jusqu’au', type: 'date' },
    ],
  },

  // =========================================================================
  //  Tolérances d'ullage — HISTORISÉ.
  // =========================================================================
  {
    key: 'ullage-tolerances',
    label: 'Tolérances d’écart de volume',
    model: 'ullageTolerance',
    nature: 'historised',
    writeRoles: [UserRole.DG, UserRole.CCOO, UserRole.FINANCE_CFO],
    identity: ['segment', 'transportMode', 'productId', 'effectiveFrom'],
    effectiveFrom: 'effectiveFrom',
    effectiveTo: 'effectiveTo',
    caution:
      'La tolérance appliquée est figée au moment du relevé : une grille révisée ne requalifie jamais un écart déjà acquitté. Ces seuils sont CONTRACTUELS, pas physiques — ils viennent de vos contrats de transport et de vos polices d’assurance.',
    fields: [
      { name: 'segment', label: 'Segment', type: 'enum', values: SEGMENTS, help: 'Vide = tous' },
      { name: 'transportMode', label: 'Mode de transport', type: 'enum', values: TRANSPORT, help: 'Vide = tous' },
      { name: 'productId', label: 'Produit', type: 'reference', refTable: 'products', refKey: 'code' },
      { name: 'normalThresholdPct', label: 'Seuil normal (%)', type: 'number', required: true, decimals: 6 },
      { name: 'alertThresholdPct', label: 'Seuil d’alerte (%)', type: 'number', required: true, decimals: 6 },
      { name: 'criticalThresholdPct', label: 'Seuil critique (%)', type: 'number', required: true, decimals: 6, help: 'Au-delà : non-conformité HSE ouverte d’office' },
      { name: 'absoluteFranchise', label: 'Franchise absolue', type: 'number', decimals: 6 },
      { name: 'franchiseUom', label: 'Unité de franchise', type: 'enum', values: UOMS },
      { name: 'effectiveFrom', label: 'En vigueur depuis', type: 'date', required: true },
      { name: 'effectiveTo', label: 'Jusqu’au', type: 'date' },
    ],
  },

  // =========================================================================
  //  Prix administrés — HISTORISÉ. Référence, jamais moteur (§ 5.3).
  // =========================================================================
  {
    key: 'administered-prices',
    label: 'Prix administrés',
    model: 'administeredPrice',
    nature: 'historised',
    writeRoles: [UserRole.DG, UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.SALES_REP],
    identity: ['referenceType', 'productId', 'zone', 'effectiveFrom'],
    effectiveFrom: 'effectiveFrom',
    effectiveTo: 'effectiveTo',
    caution:
      'Ces prix sont une RÉFÉRENCE que le commercial consulte, jamais un moteur : le système ne dérive aucun prix de vente ni aucun coût d’achat à partir d’eux (§ 5.3).',
    fields: [
      { name: 'referenceType', label: 'Nature', type: 'enum', required: true, values: values(PriceReferenceType) },
      { name: 'productId', label: 'Produit', type: 'reference', refTable: 'products', refKey: 'code', required: true },
      { name: 'zone', label: 'Zone', type: 'string' },
      { name: 'price', label: 'Prix', type: 'number', required: true, decimals: 4 },
      { name: 'currencyCode', label: 'Devise', type: 'reference', refTable: 'currencies', refKey: 'code', required: true },
      { name: 'uom', label: 'Unité', type: 'enum', required: true, values: UOMS },
      { name: 'publishedBy', label: 'Publié par', type: 'string', required: true, help: 'DGH, SIR…' },
      { name: 'publicationReference', label: 'Référence de publication', type: 'string' },
      { name: 'effectiveFrom', label: 'En vigueur depuis', type: 'date', required: true },
      { name: 'effectiveTo', label: 'Jusqu’au', type: 'date' },
      { name: 'notes', label: 'Décomposition indicative', type: 'text', help: 'Champ libre — aucune contrainte ne le vérifie ni ne s’en sert' },
    ],
  },

  // =========================================================================
  //  Postes de coûts — mutable.
  // =========================================================================
  {
    key: 'cost-posts',
    label: 'Postes de coûts',
    model: 'costPost',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT],
    identity: ['code'],
    caution:
      'La nature détermine le traitement : un poste DIRECT s’impute à une opération, un poste INDIRECT s’absorbe par un taux et exige un regroupement.',
    fields: [
      { name: 'code', label: 'Code', type: 'string', required: true },
      { name: 'label', label: 'Libellé', type: 'string', required: true },
      { name: 'category', label: 'Catégorie', type: 'string', required: true },
      { name: 'nature', label: 'Nature', type: 'enum', required: true, values: values(CostNature) },
      { name: 'variability', label: 'Variabilité', type: 'enum', required: true, values: values(CostVariability) },
      { name: 'allocationBasis', label: 'Assiette d’absorption', type: 'enum', values: values(AllocationBasis), help: 'Exigée pour un poste INDIRECT' },
      { name: 'displayOrder', label: 'Ordre d’affichage', type: 'integer' },
      { name: 'isActive', label: 'Actif', type: 'boolean' },
    ],
  },

  // =========================================================================
  //  Tarifs de transport — HISTORISÉ.
  //
  //  Le fret est le poste de charge le plus lourd d'une opération de
  //  distribution. Il se saisissait librement, sans grille et sans
  //  transporteur obligatoire.
  // =========================================================================
  {
    key: 'carrier-tariffs',
    label: 'Tarifs de transport',
    model: 'carrierTariff',
    nature: 'historised',
    writeRoles: [UserRole.DG, UserRole.FINANCE_CFO, UserRole.LOGISTICS_COORD],
    identity: ['carrierId', 'transportMode', 'productId', 'originSiteId', 'destinationSiteId'],
    caution:
      'Le tarif est OPPOSÉ à l’affectation des moyens : tout écart au-delà de la tolérance exige un motif écrit, refusé par la base à défaut. Laisser la tolérance à 0 est la règle stricte retenue par la direction — un franc d’écart porté sur dix millions de litres crée un préjudice.',
    fields: [
      {
        name: 'carrierId',
        label: 'Transporteur',
        type: 'reference',
        refTable: 'partners',
        refKey: 'code',
        required: true,
        help: 'Un tarif ne se négocie qu’avec un tiers enregistré comme TRANSPORTEUR',
      },
      {
        name: 'transportMode',
        label: 'Mode de transport',
        type: 'enum',
        values: TRANSPORT,
        help: 'Vide = tous les modes de ce transporteur',
      },
      {
        name: 'productId',
        label: 'Produit',
        type: 'reference',
        refTable: 'products',
        refKey: 'code',
        help: 'Vide = tous les produits',
      },
      {
        name: 'originSiteId',
        label: 'Site d’origine',
        type: 'reference',
        refTable: 'sites',
        refKey: 'code',
        help: 'Vide = toutes origines',
      },
      {
        name: 'destinationSiteId',
        label: 'Site de destination',
        type: 'reference',
        refTable: 'sites',
        refKey: 'code',
        help: 'Vide = toutes destinations. Un tarif se négocie pour un TRAJET — « Abidjan → Man » et « San Pédro → Man » n’ont pas le même prix.',
      },
      {
        name: 'basis',
        label: 'Base',
        type: 'enum',
        required: true,
        values: values(CostBasis),
        help: 'PER_UNIT = au litre transporté · FIXED = forfait par rotation',
      },
      { name: 'amount', label: 'Montant', type: 'number', required: true },
      {
        name: 'uom',
        label: 'Unité',
        type: 'enum',
        values: values(UnitOfMeasure),
        help: 'Obligatoire si la base est au litre : « 12 » ne dit pas s’il s’agit de 12 par litre ou par m³',
      },
      { name: 'currencyCode', label: 'Devise', type: 'reference', refTable: 'currencies', refKey: 'code', required: true },
      {
        name: 'tolerancePct',
        label: 'Tolérance (%)',
        type: 'number',
        help: 'RÈGLE STRICTE : laisser à 0. Tout écart au tarif devra alors être motivé.',
      },
      { name: 'effectiveFrom', label: 'En vigueur à partir du', type: 'date', required: true },
      { name: 'effectiveTo', label: 'Jusqu’au', type: 'date' },
      { name: 'notes', label: 'Notes', type: 'text' },
      { name: 'isActive', label: 'Actif', type: 'boolean' },
    ],
  },

  // =========================================================================
  //  Tiers — mutable.
  //
  //  Clients, fournisseurs, transporteurs, inspecteurs. Sans écriture ici, on
  //  ne pouvait pas créer un client : l'application n'était pas déployable.
  // =========================================================================
  {
    key: 'partners',
    label: 'Tiers',
    model: 'partner',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.CCOO, UserRole.FINANCE_CFO, UserRole.ASSISTANT_DG],
    identity: ['code'],
    caution:
      'Le PLAFOND DE CRÉDIT est opposé à l’approbation des affaires : le relever ouvre l’engagement, le baisser peut bloquer des affaires en cours. Les DÉLAIS de paiement et de règlement fournisseur commandent le coût de portage — les allonger dégrade la marge de toutes les affaires du tiers.',
    fields: [
      { name: 'code', label: 'Code', type: 'string', required: true },
      { name: 'legalName', label: 'Raison sociale', type: 'string', required: true },
      {
        name: 'type',
        label: 'Nature',
        type: 'enum',
        required: true,
        values: values(PartnerType),
        help: 'Un fret ne se rattache qu’à un TRANSPORTEUR, un prix d’achat qu’à un FOURNISSEUR : la base le vérifie',
      },
      { name: 'countryCode', label: 'Pays (ISO 2)', type: 'string', required: true },
      {
        name: 'segment',
        label: 'Segment',
        type: 'enum',
        values: SEGMENTS,
        help: 'Vide = le segment se décide affaire par affaire',
      },
      { name: 'taxpayerAccountNumber', label: 'Compte contribuable', type: 'string' },
      { name: 'rccmNumber', label: 'RCCM', type: 'string' },
      { name: 'taxRegime', label: 'Régime fiscal', type: 'string' },
      {
        name: 'isVatExempt',
        label: 'Exonéré de TVA',
        type: 'boolean',
        help: 'L’exonération se justifie : renseignez la référence ci-dessous',
      },
      { name: 'vatExemptionReference', label: 'Référence d’exonération', type: 'string' },
      {
        name: 'creditLimit',
        label: 'Plafond de crédit',
        type: 'number',
        help: 'OPPOSÉ à l’approbation. À 0, le client n’est pas encadré — ce n’est pas au verrou d’en décider.',
      },
      { name: 'creditLimitCurrencyCode', label: 'Devise du plafond', type: 'reference', refTable: 'currencies', refKey: 'code', required: true, help: 'Se choisit — le pivot sert à comparer, il n’est la monnaie de personne' },
      {
        name: 'creditStatus',
        label: 'Statut de crédit',
        type: 'enum',
        values: values(CreditStatus),
      },
      {
        name: 'paymentTermsDays',
        label: 'Délai de paiement client (jours)',
        type: 'integer',
        help: 'Entre dans le cycle de portage : chaque jour de délai coûte du financement',
      },
      {
        name: 'supplierTermsDays',
        label: 'Délai accordé PAR le fournisseur (jours)',
        type: 'integer',
        help: 'Réduit le cycle de portage. Elyon paie ses fournisseurs AVANT livraison : ce délai est rare, et précieux.',
      },
      { name: 'isActive', label: 'Actif', type: 'boolean' },
    ],
  },

  // =========================================================================
  //  Contrats-cadres — mutable.
  //
  //  Dernier référentiel sans chemin d'écriture. Les affaires en héritent
  //  leurs conditions par défaut.
  // =========================================================================
  {
    key: 'contracts',
    label: 'Contrats-cadres',
    model: 'contract',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.CCOO, UserRole.FINANCE_CFO],
    identity: ['reference'],
    caution:
      'Les conditions saisies ici sont HÉRITÉES PAR DÉFAUT par les affaires rattachées : le délai de paiement entre dans le coût de portage de chacune. Les modifier ne change PAS les affaires déjà chiffrées — leur marge a été calculée sur les conditions du moment, et la réécrire après coup effacerait ce sur quoi l’approbation a porté.',
    fields: [
      { name: 'reference', label: 'Référence', type: 'string', required: true },
      {
        name: 'clientId',
        label: 'Client',
        type: 'reference',
        refTable: 'partners',
        refKey: 'code',
        required: true,
      },
      { name: 'title', label: 'Intitulé', type: 'string', required: true },
      { name: 'status', label: 'Statut', type: 'enum', values: values(ContractStatus) },
      {
        name: 'segment',
        label: 'Segment',
        type: 'enum',
        required: true,
        values: SEGMENTS,
      },
      {
        name: 'paymentTermsDays',
        label: 'Délai de paiement (jours)',
        type: 'integer',
        help: 'Entre dans le cycle de portage des affaires rattachées. Vide = celui du tiers.',
      },
      { name: 'currencyCode', label: 'Devise', type: 'reference', refTable: 'currencies', refKey: 'code', required: true },
      {
        name: 'committedVolume',
        label: 'Volume engagé',
        type: 'number',
        help: 'Indicatif : il n’est opposé à rien aujourd’hui',
      },
      { name: 'volumeUom', label: 'Unité du volume', type: 'enum', values: values(UnitOfMeasure) },
      { name: 'startDate', label: 'Début', type: 'date', required: true },
      { name: 'endDate', label: 'Fin', type: 'date' },
      { name: 'notes', label: 'Notes', type: 'text' },
    ],
  },

  // =========================================================================
  //  Prix fournisseurs — HISTORISÉ.
  //
  //  Toute la chaîne de marge repose dessus. On ne pouvait pas en saisir un.
  // =========================================================================
  {
    key: 'supplier-prices',
    label: 'Prix fournisseurs',
    model: 'supplierPrice',
    nature: 'historised',
    writeRoles: [UserRole.DG, UserRole.CCOO, UserRole.FINANCE_CFO],
    identity: ['supplierId', 'productId', 'currencyCode', 'uom'],
    caution:
      'Un prix saisi ici n’est PAS opposable tant que le DG ne l’a pas validé — la validation est un acte distinct, réservé au DG et vérifié en base. Un prix validé devient IMMUABLE : il a servi à chiffrer des affaires, et le réécrire changerait leur marge après coup. Pour corriger, publiez une nouvelle ligne à une autre date.',
    fields: [
      {
        name: 'supplierId',
        label: 'Fournisseur',
        type: 'reference',
        refTable: 'partners',
        refKey: 'code',
        required: true,
      },
      {
        name: 'productId',
        label: 'Produit',
        type: 'reference',
        refTable: 'products',
        refKey: 'code',
        required: true,
      },
      { name: 'unitPrice', label: 'Prix unitaire', type: 'number', required: true },
      { name: 'currencyCode', label: 'Devise', type: 'reference', refTable: 'currencies', refKey: 'code', required: true },
      { name: 'uom', label: 'Unité', type: 'enum', required: true, values: values(UnitOfMeasure) },
      {
        name: 'pricingMethod',
        label: 'Méthode de prix',
        type: 'string',
        required: true,
        help: 'Comment ce prix est construit : indexation Platts, prix ferme, formule contractuelle',
      },
      { name: 'sourceLabel', label: 'Source', type: 'string', required: true },
      { name: 'contractReference', label: 'Référence de contrat', type: 'string' },
      {
        name: 'minVolume',
        label: 'Volume minimum',
        type: 'number',
        help: 'OPPOSÉ à l’approbation : une affaire sous ce volume ne peut pas retenir ce prix',
      },
      { name: 'effectiveFrom', label: 'En vigueur à partir du', type: 'date', required: true },
      { name: 'effectiveTo', label: 'Jusqu’au', type: 'date' },
    ],
  },

  // =========================================================================
  //  Véhicules — mutable.
  // =========================================================================
  {
    key: 'vehicles',
    label: 'Véhicules',
    model: 'vehicle',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD],
    identity: ['registration'],
    caution:
      'La CAPACITÉ et les PRODUITS AUTORISÉS sont opposés à l’affectation : une opération dépassant la capacité, ou portant un produit non autorisé, est refusée. Le statut de conformité, lui, ne se saisit pas — il se déduit des pièces à échéance.',
    fields: [
      { name: 'registration', label: 'Immatriculation', type: 'string', required: true },
      {
        name: 'carrierId',
        label: 'Transporteur',
        type: 'reference',
        refTable: 'partners',
        refKey: 'code',
        help: 'Vide = véhicule en propre',
      },
      { name: 'type', label: 'Type', type: 'enum', required: true, values: values(VehicleType) },
      { name: 'brandModel', label: 'Marque et modèle', type: 'string' },
      { name: 'year', label: 'Année', type: 'integer' },
      {
        name: 'capacity',
        label: 'Capacité',
        type: 'number',
        required: true,
        help: 'OPPOSÉE à l’affectation : une opération qui la dépasse est refusée',
      },
      {
        name: 'capacityUom',
        label: 'Unité de la capacité',
        type: 'enum',
        required: true,
        values: values(UnitOfMeasure),
        help: 'La comparaison ne se fait que si l’opération est dans la même unité — comparer des litres à des tonnes serait pire que ne rien comparer',
      },
      { name: 'compartmentCount', label: 'Nombre de compartiments', type: 'integer' },
      {
        name: 'allowedProductIds',
        label: 'Produits autorisés',
        type: 'referenceList',
        refTable: 'products',
        refKey: 'code',
        scalarList: true,
        help: 'Vide = tous produits. Renseignés, ils sont OPPOSÉS : la citerne ne s’affecte pas à un chargement d’un autre produit.',
      },
      { name: 'isActive', label: 'Actif', type: 'boolean' },
    ],
  },

  // =========================================================================
  //  Chauffeurs — mutable.
  // =========================================================================
  {
    key: 'drivers',
    label: 'Chauffeurs',
    model: 'driver',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD],
    identity: ['carrierId', 'employeeNumber'],
    caution:
      'Le chauffeur est identifié par le couple TRANSPORTEUR + MATRICULE. Sans matricule, un import répété créerait un homonyme à chaque passage. Le statut de conformité ne se saisit pas : un permis échu rend le chauffeur inaffectable, tout seul.',
    fields: [
      {
        name: 'carrierId',
        label: 'Transporteur',
        type: 'reference',
        refTable: 'partners',
        refKey: 'code',
      },
      { name: 'employeeNumber', label: 'Matricule', type: 'string' },
      { name: 'fullName', label: 'Nom complet', type: 'string', required: true },
      { name: 'idDocumentType', label: 'Type de pièce d’identité', type: 'string' },
      { name: 'idDocumentRef', label: 'Référence de la pièce', type: 'string' },
      { name: 'phone', label: 'Téléphone', type: 'string' },
      { name: 'isActive', label: 'Actif', type: 'boolean' },
    ],
  },

  // =========================================================================
  //  Pools de charges indirectes — mutable.
  // =========================================================================
  {
    key: 'cost-pools',
    label: 'Pools de charges indirectes',
    model: 'costPool',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.FINANCE_CFO],
    identity: ['code'],
    caution:
      'L’assiette d’absorption est un VOLUME budgété (§ 14.2) : « au prorata du chiffre d’affaires » est REFUSÉ sur un pool actif, en base comme au calcul. Le volume est ce que l’entreprise pilote ; le prix suit les publications DGH et le change — une assiette en valeur ferait bouger la charge fixe unitaire à chaque publication, sans qu’aucune charge n’ait changé. Employer PER_VOLUME, ou PER_OPERATION pour un montant par rotation.',
    fields: [
      { name: 'code', label: 'Code', type: 'string', required: true },
      { name: 'label', label: 'Libellé', type: 'string', required: true },
      {
        name: 'allocationBasis',
        label: 'Base d’imputation',
        type: 'enum',
        required: true,
        values: values(AllocationBasis),
      },
      {
        name: 'segments',
        label: 'Segments concernés',
        type: 'enumList',
        values: SEGMENTS,
        help: 'Vide = tous les segments',
      },
      { name: 'currencyCode', label: 'Devise', type: 'reference', refTable: 'currencies', refKey: 'code', required: true },
      { name: 'isActive', label: 'Actif', type: 'boolean' },
    ],
  },

  // =========================================================================
  //  Taux d'absorption — mutable, par exercice.
  // =========================================================================
  {
    key: 'absorption-rates',
    label: 'Taux d’absorption',
    model: 'absorptionRate',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.FINANCE_CFO],
    identity: ['costPoolId', 'fiscalYear'],
    caution:
      'Le TAUX est CALCULÉ — budget ÷ assiette — et non saisi : le faire saisir reviendrait à demander une division à la main, puis à la refuser sur une décimale. L’assiette est BUDGÉTÉE, jamais réalisée : une assiette réalisée ferait monter le taux quand l’activité baisse, et l’absorption s’emballerait.',
    fields: [
      {
        name: 'costPoolId',
        label: 'Pool de charges',
        type: 'reference',
        refTable: 'cost-pools',
        refKey: 'code',
        required: true,
      },
      { name: 'fiscalYear', label: 'Exercice', type: 'integer', required: true },
      {
        name: 'budgetedAmount',
        label: 'Budget de l’exercice',
        type: 'number',
        required: true,
      },
      {
        name: 'budgetedBase',
        label: 'Assiette budgétée',
        type: 'number',
        required: true,
        help: 'Volume, nombre d’opérations ou chiffre d’affaires PRÉVU, selon la base du pool',
      },
      {
        name: 'baseUom',
        label: 'Unité de l’assiette',
        type: 'enum',
        values: values(UnitOfMeasure),
      },
      { name: 'version', label: 'Version', type: 'integer' },
      { name: 'isCurrent', label: 'Version courante', type: 'boolean' },
      { name: 'notes', label: 'Notes', type: 'text' },
    ],
  },

  // =========================================================================
  //  Garanties — mutable.
  // =========================================================================
  {
    key: 'guarantees',
    label: 'Garanties',
    model: 'guarantee',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.FINANCE_CFO],
    identity: ['reference'],
    caution:
      'Une garantie ACTIVE et non échue DÉDUIT l’exposition crédit du client, donc ouvre son plafond. Son montant en devise pivot est CALCULÉ au cours du jour — le laisser saisir permettrait d’ouvrir un plafond en écrivant un nombre, sans qu’aucune banque n’ait rien garanti.',
    fields: [
      { name: 'reference', label: 'Référence', type: 'string', required: true },
      {
        name: 'partnerId',
        label: 'Tiers garanti',
        type: 'reference',
        refTable: 'partners',
        refKey: 'code',
        required: true,
      },
      { name: 'type', label: 'Type', type: 'enum', required: true, values: values(GuaranteeType) },
      {
        name: 'status',
        label: 'Statut',
        type: 'enum',
        values: values(GuaranteeStatus),
        help: 'Seule une garantie ACTIVE déduit l’exposition',
      },
      { name: 'amount', label: 'Montant', type: 'number', required: true },
      { name: 'currencyCode', label: 'Devise', type: 'reference', refTable: 'currencies', refKey: 'code', required: true },
      { name: 'issuingBank', label: 'Banque émettrice', type: 'string' },
      { name: 'issueDate', label: 'Date d’émission', type: 'date', required: true },
      {
        name: 'expiryDate',
        label: 'Échéance',
        type: 'date',
        help: 'Une garantie échue cesse de déduire l’exposition — sans qu’aucune tâche n’ait à tourner',
      },
    ],
  },

  // =========================================================================
  //  Sites de livraison — mutable.
  //
  //  Le LIEU, indépendant de qui s'y fait livrer. Plusieurs clients exploitent
  //  couramment le même site ; ses consignes lui appartiennent, pas à eux.
  // =========================================================================
  {
    key: 'sites',
    label: 'Sites',
    model: 'site',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD],
    identity: ['code'],
    caution:
      'Les consignes d’accès et de sécurité saisies ici sont celles que l’agent lira sur sa tablette avant d’entrer. Un même site servant plusieurs clients, les corriger ici les corrige pour tous — c’est précisément l’intérêt.',
    fields: [
      { name: 'code', label: 'Code', type: 'string', required: true },
      { name: 'name', label: 'Nom du site', type: 'string', required: true },
      {
        name: 'usages',
        label: 'Usages',
        type: 'enumList',
        required: true,
        values: values(SiteUsage),
        help: 'CHARGEMENT et/ou LIVRAISON — vous en décidez, site par site. Rien n’est déduit de la nature du lieu : une station-service est un lieu de chargement dès lors qu’on y prend du produit. Un lieu qui fait les deux porte les DEUX ; le créer deux fois périmerait l’une des copies.',
      },
      { name: 'addressLine', label: 'Adresse', type: 'string' },
      { name: 'city', label: 'Ville', type: 'string' },
      { name: 'countryCode', label: 'Pays (ISO 2)', type: 'string', required: true },
      { name: 'latitude', label: 'Latitude', type: 'number' },
      { name: 'longitude', label: 'Longitude', type: 'number' },
      {
        name: 'accessInstructions',
        label: 'Consignes d’accès',
        type: 'text',
        help: 'Comment entrer : poste de garde, itinéraire, restrictions de gabarit',
      },
      { name: 'openingHours', label: 'Horaires d’ouverture', type: 'string' },
      {
        name: 'safetyInstructions',
        label: 'Consignes de sécurité',
        type: 'text',
        help: 'Lues par l’agent AVANT d’entrer sur le site',
      },
      {
        name: 'defaultHseRiskLevel',
        label: 'Niveau de risque par défaut',
        type: 'enum',
        values: values(HseRiskLevel),
        help: 'Sert à sélectionner la checklist HSE applicable aux opérations sur ce site',
      },
      { name: 'isActive', label: 'Actif', type: 'boolean' },
    ],
  },

  // =========================================================================
  //  Natures d'exigence de site — mutable.
  // =========================================================================
  {
    key: 'site-requirement-types',
    label: 'Natures d’exigence de site',
    model: 'siteRequirementType',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD],
    identity: ['code'],
    caution:
      'Une nature marquée bloquante par défaut le sera sur chaque site qui l’adopte — le caractère bloquant reste réglable site par site : un badge d’accès est indispensable ici, une simple recommandation ailleurs.',
    fields: [
      { name: 'code', label: 'Code', type: 'string', required: true },
      { name: 'label', label: 'Libellé', type: 'string', required: true },
      { name: 'description', label: 'Précision', type: 'text' },
      {
        name: 'defaultBlocking',
        label: 'Bloquante par défaut',
        type: 'boolean',
        help: 'Se présenter sans y satisfaire, c’est repartir à vide',
      },
      { name: 'displayOrder', label: 'Ordre d’affichage', type: 'integer' },
      { name: 'isActive', label: 'Actif', type: 'boolean' },
    ],
  },

  // =========================================================================
  //  Exigences portées par un site — mutable.
  // =========================================================================
  {
    key: 'site-requirements',
    label: 'Exigences des sites de livraison',
    model: 'siteRequirement',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD],
    identity: ['siteId', 'typeId'],
    caution:
      'C’est ce que le coordinateur lit en préparant l’opération, et l’agent avant d’entrer. Une exigence bloquante non satisfaite se solde par un camion qui repart à vide — le produit est déjà payé.',
    fields: [
      {
        name: 'siteId',
        label: 'Site de livraison',
        type: 'reference',
        refTable: 'sites',
        refKey: 'code',
        required: true,
      },
      {
        name: 'typeId',
        label: 'Nature de l’exigence',
        type: 'reference',
        refTable: 'site-requirement-types',
        refKey: 'code',
        required: true,
      },
      {
        name: 'detail',
        label: 'Détail concret',
        type: 'text',
        required: true,
        help: 'Ce qu’il faut faire, précisément : « badge retiré au poste de garde, 24 h à l’avance »',
      },
      { name: 'isBlocking', label: 'Bloquante', type: 'boolean' },
      { name: 'isActive', label: 'Active', type: 'boolean' },
    ],
  },

  // =========================================================================
  //  Types d'opération — mutable.
  //
  //  Ils indexent les contrôles HSE. Une opération en porte plusieurs : route
  //  puis soutage à quai, et les checklists s'additionnent.
  // =========================================================================
  {
    key: 'operation-types',
    label: 'Types d’opération',
    model: 'operationType',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD],
    identity: ['code'],
    caution:
      'Une opération sans type ne reçoit AUCUN contrôle HSE : le verrou serait vide de contenu et laisserait tout passer. La base refuse de faire avancer une opération non typée.',
    fields: [
      { name: 'code', label: 'Code', type: 'string', required: true },
      { name: 'label', label: 'Libellé', type: 'string', required: true },
      { name: 'description', label: 'Précision opérationnelle', type: 'text' },
      {
        name: 'segments',
        label: 'Segments concernés',
        type: 'enumList',
        values: SEGMENTS,
        help: 'Vide = tous les segments',
      },
      {
        name: 'defaultRiskLevel',
        label: 'Niveau de risque par défaut',
        type: 'enum',
        values: values(HseRiskLevel),
        help: 'Proposé à la création, et modifiable — une aide à la saisie, pas une contrainte',
      },
      { name: 'displayOrder', label: 'Ordre d’affichage', type: 'integer' },
      { name: 'isActive', label: 'Actif', type: 'boolean' },
    ],
  },

  // =========================================================================
  //  Modèles de checklist HSE — mutable.
  // =========================================================================
  {
    key: 'hse-checklists',
    label: 'Modèles de checklist HSE',
    model: 'hseChecklistTemplate',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD],
    identity: ['code'],
    caution:
      'La version du modèle est FIGÉE sur chaque opération au moment du contrôle : une checklist révisée ensuite ne réécrit jamais ce qui a été effectivement vérifié sur le terrain.',
    fields: [
      { name: 'code', label: 'Code', type: 'string', required: true },
      { name: 'label', label: 'Libellé', type: 'string', required: true },
      {
        name: 'operationTypes',
        label: 'Types d’opération couverts',
        type: 'referenceList',
        refTable: 'operation-types',
        refKey: 'code',
        relation: 'operationTypes',
        help: 'Séparés par des virgules. C’est l’axe principal : une opération reçoit l’union des checklists de ses types.',
      },
      {
        name: 'applicableSegments',
        label: 'Segments',
        type: 'enumList',
        values: SEGMENTS,
        help: 'Affinage. Vide = tous',
      },
      {
        name: 'applicableTransportModes',
        label: 'Modes de transport',
        type: 'enumList',
        values: TRANSPORT,
        help: 'Affinage. Vide = tous',
      },
      {
        name: 'applicableRiskLevels',
        label: 'Niveaux de risque',
        type: 'enumList',
        values: values(HseRiskLevel),
        help: 'Affinage. Vide = tous',
      },
      { name: 'version', label: 'Version', type: 'integer' },
      { name: 'isCurrent', label: 'Version courante', type: 'boolean' },
      { name: 'isActive', label: 'Actif', type: 'boolean' },
    ],
  },

  // =========================================================================
  //  Points de contrôle HSE — mutable.
  //
  //  C'est ici que se décide ce qui BLOQUE. « Un contrôle HSE est bloquant
  //  quand la configuration l'établit comme tel » — décision du 5 août 2026.
  // =========================================================================
  {
    key: 'hse-check-items',
    label: 'Points de contrôle HSE',
    model: 'hseChecklistItem',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD],
    identity: ['templateId', 'code'],
    caution:
      'Le niveau BLOQUANT empêche le chargement tant que le point n’est pas satisfait. Il est recopié sur l’opération au moment du contrôle : rendre un point non bloquant plus tard ne requalifie jamais un contrôle déjà effectué.',
    fields: [
      {
        name: 'templateId',
        label: 'Modèle de checklist',
        type: 'reference',
        refTable: 'hse-checklists',
        refKey: 'code',
        required: true,
      },
      { name: 'code', label: 'Code', type: 'string', required: true },
      { name: 'label', label: 'Intitulé du contrôle', type: 'string', required: true },
      { name: 'guidance', label: 'Précision affichée sur la tablette', type: 'text' },
      {
        name: 'phase',
        label: 'Étape',
        type: 'enum',
        required: true,
        values: values(OperationPhase),
        help: 'Étape de l’opération à laquelle ce contrôle se fait',
      },
      {
        name: 'level',
        label: 'Niveau',
        type: 'enum',
        required: true,
        values: values(HseControlLevel),
        help: 'BLOCKING empêche le chargement tant qu’il n’est pas satisfait',
      },
      {
        name: 'photoPolicy',
        label: 'Régime photographique',
        type: 'enum',
        values: values(HsePhotoPolicy),
        help: 'INTERDITE en zone ATEX ou chez un client qui la proscrit · FACULTATIVE la propose · EXIGÉE empêche l’enregistrement du point sans photo',
      },
      { name: 'requiresValue', label: 'Valeur exigée', type: 'boolean' },
      { name: 'valueLabel', label: 'Libellé de la valeur', type: 'string' },
      { name: 'requiresSignature', label: 'Signature exigée', type: 'boolean' },
      { name: 'displayOrder', label: 'Ordre d’affichage', type: 'integer' },
      { name: 'isActive', label: 'Actif', type: 'boolean' },
    ],
  },

  // =========================================================================
  //  Barème de coûts standards — HISTORISÉ.
  //
  //  La valeur pré-paramétrée d'un poste. C'est elle qui donne un sens à
  //  l'écart : sans référence, un transport chiffré à 45 au lieu de 30 ne se
  //  voit pas.
  // =========================================================================
  {
    key: 'cost-standards',
    label: 'Barème de coûts',
    model: 'costStandard',
    nature: 'historised',
    writeRoles: [UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO],
    identity: ['costPostId', 'segment', 'transportMode', 'productId', 'effectiveFrom'],
    effectiveFrom: 'effectiveFrom',
    effectiveTo: 'effectiveTo',
    caution:
      'La valeur peut être exprimée AU LITRE (proportionnelle au volume) ou en FORFAIT (montant fixe pour l’affaire) : le système ramène l’une et l’autre au litre. Le barème appliqué est figé au moment du chiffrage — une grille révisée ne requalifie jamais un écart déjà justifié.',
    fields: [
      {
        name: 'costPostId',
        label: 'Poste de coût',
        type: 'reference',
        refTable: 'cost-posts',
        refKey: 'code',
        required: true,
      },
      {
        name: 'basis',
        label: 'Base',
        type: 'enum',
        required: true,
        values: values(CostBasis),
        help: 'PER_UNIT = au litre, proportionnel au volume · FIXED = forfait pour l’affaire',
      },
      { name: 'amount', label: 'Valeur', type: 'number', required: true, decimals: 4 },
      {
        name: 'uom',
        label: 'Unité de référence',
        type: 'enum',
        values: UOMS,
        help: 'Obligatoire si la base est PER_UNIT — une valeur au litre sans unité n’est pas interprétable',
      },
      {
        name: 'currencyCode',
        label: 'Devise',
        type: 'reference',
        refTable: 'currencies',
        refKey: 'code',
        required: true,
      },
      { name: 'segment', label: 'Segment', type: 'enum', values: SEGMENTS, help: 'Vide = tous' },
      {
        name: 'transportMode',
        label: 'Mode de transport',
        type: 'enum',
        values: TRANSPORT,
        help: 'Vide = tous',
      },
      { name: 'productId', label: 'Produit', type: 'reference', refTable: 'products', refKey: 'code' },
      {
        name: 'tolerancePct',
        label: 'Écart toléré (%)',
        type: 'number',
        decimals: 3,
        help:
          'RÈGLE STRICTE : laisser à 0. Toute valeur différente du barème doit être justifiée. ' +
          'Un franc de trop sur dix millions de litres fait dix millions — un pourcentage de ' +
          'tolérance ne protège de rien à cette échelle. Ne relever qu’après décision explicite.',
      },
      { name: 'effectiveFrom', label: 'En vigueur depuis', type: 'date', required: true },
      { name: 'effectiveTo', label: 'Jusqu’au', type: 'date' },
      { name: 'notes', label: 'Note', type: 'text' },
    ],
  },

  // =========================================================================
  //  Paramètres système — mutable.
  // =========================================================================
  {
    key: 'settings',
    label: 'Paramètres système',
    model: 'systemSetting',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.IT_ADMIN, UserRole.FINANCE_CFO],
    identity: ['key'],
    caution:
      'Ces valeurs gouvernent des calculs et des règles de sécurité : taux de financement du portage, base annuelle du portage, délai d’alerte sur les pièces à échéance, exercice courant, verrouillage après échecs de connexion, rôles soumis au second facteur. Elles s’appliquent dans les trente secondes — SAUF les deux plafonds de débit (LOGIN_RATE_PER_MINUTE, API_RATE_PER_MINUTE), qui exigent un redémarrage de l’API. Lisez la description avant de modifier.',
    fields: [
      { name: 'key', label: 'Clé', type: 'string', required: true },
      { name: 'value', label: 'Valeur', type: 'string', required: true },
      { name: 'valueType', label: 'Type', type: 'enum', required: true, values: ['string', 'number', 'boolean', 'json'] },
      { name: 'description', label: 'Description', type: 'text', required: true },
    ],
  },

  // =========================================================================
  //  EXERCICE COMPTABLE — mutable.
  //
  //  Tout le pilotage financier s'y rattache. Ni l'année civile ni une
  //  constante : une entreprise peut clôturer en juin.
  // =========================================================================
  {
    key: 'fiscal-years',
    label: 'Exercices comptables',
    model: 'fiscalYear',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.FINANCE_CFO],
    identity: ['year'],
    caution:
      'UN SEUL exercice peut être courant : la base refuse le second au lieu de le corriger en silence. Clore un exercice FIGE ses valeurs budgétaires — c’est ce qui garantit qu’une affaire de 2026 reste évaluée aux conditions de 2026, et non à celles renégociées depuis.',
    fields: [
      { name: 'year', label: 'Millésime', type: 'integer', required: true },
      { name: 'label', label: 'Libellé', type: 'string', required: true },
      { name: 'startsOn', label: 'Début', type: 'date', required: true },
      { name: 'endsOn', label: 'Fin', type: 'date', required: true },
      {
        name: 'status',
        label: 'État',
        type: 'enum',
        required: true,
        values: values(FiscalYearStatus),
        help: 'PLANNED : budget en construction. OPEN : les valeurs s’appliquent. CLOSED : plus modifiable.',
      },
      { name: 'isCurrent', label: 'Exercice courant', type: 'boolean' },
      { name: 'notes', label: 'Notes', type: 'text' },
    ],
  },

  // =========================================================================
  //  TAUX DE FINANCEMENT — historisé, par exercice.
  // =========================================================================
  {
    key: 'financing-rates',
    label: 'Taux de financement',
    model: 'financingRate',
    nature: 'historised',
    writeRoles: [UserRole.DG, UserRole.FINANCE_CFO],
    identity: ['fiscalYearId', 'version'],
    caution:
      'Le coût de portage des affaires en dépend (§ 5.4). Tant qu’il n’est pas saisi pour l’exercice, le système emploie l’ancien paramètre global à titre PROVISOIRE et le signale — il ne devine pas vos conditions bancaires. La base de jours n’est pas neutre : 360 ou 365 déplacent le coût de portage de 1,4 %.',
    fields: [
      {
        name: 'fiscalYearId',
        label: 'Exercice',
        type: 'reference',
        refTable: 'fiscal-years',
        refKey: 'year',
        required: true,
      },
      {
        name: 'annualRatePct',
        label: 'Taux annuel (%)',
        type: 'number',
        required: true,
        help: 'Taux effectif, en pourcentage : 11.75 pour 11,75 % l’an',
      },
      {
        name: 'carryingDaysPerYear',
        label: 'Base de jours',
        type: 'integer',
        help: '360 en usage bancaire, 365 en exact/exact',
      },
      {
        name: 'source',
        label: 'Origine du taux',
        type: 'string',
        help: 'Convention de découvert, lettre de crédit, moyenne pondérée — sans cette trace, le taux n’est ni contestable ni reproductible',
      },
      { name: 'version', label: 'Version', type: 'integer' },
      { name: 'isCurrent', label: 'Version courante', type: 'boolean' },
    ],
  },

  // =========================================================================
  //  CHARGES FIXES — historisé, par exercice. Dénominateur du point mort.
  // =========================================================================
  {
    key: 'fixed-cost-budgets',
    label: 'Budget de charges fixes',
    model: 'fixedCostBudget',
    nature: 'historised',
    writeRoles: [UserRole.DG, UserRole.FINANCE_CFO],
    identity: ['fiscalYearId', 'label', 'version'],
    caution:
      'Le point mort en découle directement (§ 14.5). Le segment reste VIDE dans le cas normal : le § 14.5 retient un seul bloc au niveau entreprise, et ne l’attribue à un segment que lorsque la charge lui est réellement imputable — la barge au maritime. Un segment renseigné à tort fait porter à un segment des frais que toute l’entreprise supporte.',
    fields: [
      {
        name: 'fiscalYearId',
        label: 'Exercice',
        type: 'reference',
        refTable: 'fiscal-years',
        refKey: 'year',
        required: true,
      },
      {
        name: 'label',
        label: 'Poste de charge',
        type: 'string',
        required: true,
        help: 'Loyers, salaires de structure, assurances, amortissements',
      },
      {
        name: 'segment',
        label: 'Segment',
        type: 'enum',
        values: values(CommercialSegment),
        help: 'À laisser VIDE sauf charge réellement attribuable au segment',
      },
      { name: 'annualAmount', label: 'Montant annuel', type: 'number', required: true },
      {
        name: 'currencyCode',
        label: 'Devise',
        type: 'reference',
        refTable: 'currencies',
        refKey: 'code',
        required: true,
      },
      { name: 'version', label: 'Version', type: 'integer' },
      { name: 'isCurrent', label: 'Version courante', type: 'boolean' },
      { name: 'notes', label: 'Notes', type: 'text' },
    ],
  },

  // =========================================================================
  //  PRÉVISION DE VENTE — historisé. Maille segment × produit × mois.
  // =========================================================================
  {
    key: 'sales-forecasts',
    label: 'Prévision de vente',
    model: 'salesForecast',
    nature: 'historised',
    writeRoles: [UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO],
    identity: ['fiscalYearId', 'segment', 'productId', 'monthIndex', 'kind', 'version'],
    caution:
      'On prévoit un VOLUME et on en dérive le chiffre d’affaires : une prévision saisie en CA laisserait une hausse de prix DGH masquer une perte de volume. Le budget validé ne se modifie JAMAIS — une évolution se saisit comme RÉVISION, à côté, sinon l’écart au budget devient invisible et c’est lui qu’on pilote. Le mois est le rang dans l’exercice, pas le mois civil : un exercice ouvert en juillet a son mois 1 en juillet.',
    fields: [
      {
        name: 'fiscalYearId',
        label: 'Exercice',
        type: 'reference',
        refTable: 'fiscal-years',
        refKey: 'year',
        required: true,
      },
      {
        name: 'segment',
        label: 'Segment',
        type: 'enum',
        required: true,
        values: values(CommercialSegment),
      },
      {
        name: 'productId',
        label: 'Produit',
        type: 'reference',
        refTable: 'products',
        refKey: 'code',
        required: true,
      },
      {
        name: 'monthIndex',
        label: 'Mois de l’exercice',
        type: 'integer',
        required: true,
        help: 'RANG dans l’exercice, pas mois civil : un exercice ouvert en juillet a son mois 1 en juillet. La borne suit la durée réelle de l’exercice — 12 mois pour un exercice de 12 mois.',
      },
      { name: 'forecastVolume', label: 'Volume prévu', type: 'number', required: true },
      {
        name: 'uom',
        label: 'Unité',
        type: 'enum',
        required: true,
        values: values(UnitOfMeasure),
      },
      {
        name: 'referencePrice',
        label: 'Prix de référence',
        type: 'number',
        required: true,
        help: 'Sert à dériver le CA prévisionnel — et à isoler l’écart de prix de l’écart de volume',
      },
      {
        name: 'currencyCode',
        label: 'Devise',
        type: 'reference',
        refTable: 'currencies',
        refKey: 'code',
        required: true,
      },
      {
        name: 'kind',
        label: 'Nature',
        type: 'enum',
        required: true,
        values: values(ForecastKind),
        help: 'BUDGET : validé par le DG, figé. REVISION : révision trimestrielle, à côté du budget.',
      },
      { name: 'version', label: 'Version', type: 'integer' },
      { name: 'isCurrent', label: 'Version courante', type: 'boolean' },
      { name: 'notes', label: 'Notes', type: 'text' },
    ],
  },

  // =========================================================================
  //  ÉTAPES DU PIPELINE COMMERCIAL — mutable (§ 15).
  // =========================================================================
  {
    key: 'crm-pipeline-stages',
    label: 'Étapes du pipeline',
    model: 'crmPipelineStage',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.CCOO],
    identity: ['code'],
    caution:
      'La PROBABILITÉ décide de la valeur pondérée du pipeline (§ 15), qui alimente la prévision de vente (§ 14.3), qui fournit l’assiette du taux d’absorption (§ 14.2). Une probabilité optimiste ne reste donc pas un problème commercial : elle fait BAISSER le coût de revient calculé, et laisse passer des affaires qui ne couvrent pas leurs frais. Laissée vide, la valeur pondérée n’est pas calculée — c’est voulu. « Gagnée » vaut obligatoirement 100 et « Perdue » 0 : ce sont des faits, pas des estimations.',
    fields: [
      { name: 'code', label: 'Code', type: 'string', required: true },
      { name: 'label', label: 'Libellé', type: 'string', required: true },
      {
        name: 'rank',
        label: 'Rang',
        type: 'integer',
        required: true,
        help: 'Ordre dans le pipeline. Unique : deux étapes au même rang rendraient l’ordre imprévisible.',
      },
      {
        name: 'outcome',
        label: 'Issue',
        type: 'enum',
        required: true,
        values: values(CrmStageOutcome),
        help: 'OPEN : l’affaire progresse. WON / LOST : elle sort du pipeline. DORMANT : mise en veille.',
      },
      {
        name: 'probabilityPct',
        label: 'Probabilité (%)',
        type: 'number',
        help: 'Laissée vide, la valeur pondérée n’est pas calculée plutôt que d’être fausse',
      },
      {
        name: 'stalledAfterDays',
        label: 'Veille sans activité (jours)',
        type: 'integer',
        help: 'Au-delà, l’opportunité est signalée comme dormante. Une offre envoyée s’essouffle en deux semaines ; une qualification peut dormir deux mois.',
      },
      { name: 'description', label: 'Description', type: 'text' },
      { name: 'isActive', label: 'Active', type: 'boolean' },
    ],
  },
];

export function findReferential(key: string): ReferentialSpec | undefined {
  return REFERENTIALS.find((r) => r.key === key);
}
