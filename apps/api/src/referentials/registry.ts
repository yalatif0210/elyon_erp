import {
  AllocationBasis,
  ComplianceType,
  ContractStatus,
  CostBasis,
  DunningMethod,
  HseControlLevel,
  HseEventType,
  HsePhotoPolicy,
  HseRiskLevel,
  HseSeverity,
  InvoicePaymentMethod,
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
  | 'referenceList'
  /**
   * Numéro de version d'une donnée historisée.
   *
   * ⚠️ SA LISTE DE CHOIX DÉPEND DES AUTRES CHAMPS DU FORMULAIRE.
   *
   *    Les versions ne sont pas globales : elles se comptent PAR IDENTITÉ —
   *    par pool ET par exercice pour un budget de pool. Les numéros libres
   *    dépendent donc de ce qui vient d'être choisi juste au-dessus, ce qu'une
   *    liste statique ne sait pas exprimer.
   *
   *    Le dirigeant, le 9 août : « Si l'on vient à créer un nouveau réglage, la
   *    liste déroulante exclut la version déjà en base pour proposer celles
   *    libres. »
   *
   *    Un entier libre laissait écraser une version existante par simple faute
   *    de frappe — et une révision qui écrase ce qu'elle révise fait disparaître
   *    l'historique qu'on versionne justement pour le garder.
   */
  | 'version';

export interface FieldSpec {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Valeurs admises pour un `enum`. */
  values?: readonly string[];
  /**
   * Libellé français de chaque valeur admise.
   *
   * ⚠️ N'AFFECTE QUE L'AFFICHAGE : la valeur transmise reste le code stocké.
   *    Traduire la valeur elle-même la rendrait dépendante de la langue de
   *    l'écran, et un import de fichier rédigé en français ne serait plus
   *    relisible par le calcul.
   */
  valueLabels?: Readonly<Record<string, string>>;
  /** Référentiel visé par une `reference`, et champ servant de clé lisible. */
  refTable?: string;
  refKey?: string;
  /**
   * Restreint les choix proposés à ceux qui satisfont ce filtre exact.
   *
   * ⚠️ SANS LUI, LA LISTE DÉROULANTE PROPOSE TOUT LE RÉFÉRENTIEL, PAS SEULEMENT
   *    CE QUI Y A SA PLACE.
   *
   *    `partners` porte cinq natures (client, prospect, fournisseur,
   *    transporteur, inspecteur) dans une seule table. Un champ « Fournisseur »
   *    sans ce filtre proposait aussi bien un client qu'un inspecteur — rien à
   *    l'écran ne l'aurait empêché, et rien ne l'aurait signalé non plus : le
   *    prix se serait rattaché à un tiers du mauvais type, silencieusement.
   */
  refFilter?: Readonly<Record<string, string>>;
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
  /**
   * Champs à VIDER quand ce champ prend l'une des valeurs listées ici.
   *
   * ⚠️ SANS CELA, LE FORMULAIRE GÉNÉRIQUE LAISSE DES VALEURS INCOHÉRENTES
   *    VISIBLEMENT INVISIBLES.
   *
   *    La saisie ne masque ni ne réinitialise jamais un champ selon la valeur
   *    d'un autre — chaque référentiel resterait sinon à décrire une mise en
   *    page, pas des données. Un poste de coût saisi INDIRECT (pool + assiette
   *    renseignés) puis repassé en DIRECT sans y retoucher soumettait encore
   *    ce pool et cette assiette : la nature affichée disait DIRECT, la ligne
   *    heurtait `chk_cost_posts_allocation_coherence` sans que rien à l'écran
   *    ne le laisse deviner. Ce champ ne pilote pas l'affichage, seulement la
   *    valeur retenue à la prochaine écriture.
   */
  clearsOnValue?: Readonly<Record<string, readonly string[]>>;
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
 * QUI PEUT LIRE UN RÉFÉRENTIEL — DÉRIVÉ, JAMAIS TENU À LA MAIN.
 *
 * ⚠️ CE CALCUL CORRIGE UNE FUITE CONSTATÉE.
 *
 *    La lecture générique portait UNE seule liste de rôles pour les
 *    vingt-huit référentiels. Le coordinateur logistique lisait donc les prix
 *    d'achat fournisseurs — alors que la règle posée le 8 août veut qu'il ne
 *    voie pas les marges, et que l'affaire lui montre déjà le prix de vente.
 *    Les deux réunis donnent la marge de tête.
 *
 * ⚠️ LA RÈGLE EST CALCULÉE, ET C'EST TOUT L'INTÉRÊT.
 *
 *    Peut lire un référentiel :
 *      · qui peut l'écrire ;
 *      · qui peut écrire un référentiel qui le RÉFÉRENCE — sans quoi sa liste
 *        déroulante serait vide et le champ retomberait en saisie libre.
 *
 *    Une liste tenue en parallèle finirait par diverger de l'une ou l'autre :
 *    on n'oublie pas d'ajouter le référentiel, on oublie d'ajouter son rôle.
 *    Ici, déclarer une référence suffit.
 */
let CACHE_LECTURE: Map<string, Set<UserRole>> | null = null;

export function rolesDeLecture(key: string): UserRole[] {
  if (!CACHE_LECTURE) {
    const table = new Map<string, Set<UserRole>>();
    for (const r of REFERENTIALS) table.set(r.key, new Set(r.writeRoles));

    for (const source of REFERENTIALS) {
      for (const champ of source.fields) {
        if (champ.type !== 'reference' && champ.type !== 'referenceList') continue;
        const vise = table.get(champ.refTable ?? '');
        if (!vise) continue;
        for (const role of source.writeRoles) vise.add(role);
      }
    }
    CACHE_LECTURE = table;
  }
  return [...(CACHE_LECTURE.get(key) ?? new Set<UserRole>())];
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

/**
 * LIBELLÉS FRANÇAIS DES VALEURS DE LISTE.
 *
 * ⚠️ LA VALEUR ENVOYÉE RESTE LE CODE. SEUL L'AFFICHAGE CHANGE.
 *
 *    Les listes déroulantes présentaient les valeurs telles qu'elles sont
 *    stockées : « PER_VOLUME », « TANKER_TRUCK », « BLOCKING ». Un exploitant
 *    doit alors deviner, et deviner mal se paie : « PER_REVENUE » et
 *    « PER_VOLUME » se ressemblent, et le second est refusé par le système
 *    alors que le premier ne l'est pas.
 *
 * ⚠️ LES LIBELLÉS SONT RANGÉS PAR ÉNUMÉRATION, ET CE N'EST PAS DU ZÈLE.
 *
 *    La même valeur ne veut pas dire la même chose partout. « FIXED » est un
 *    FORFAIT sur une base de coût et une charge FIXE sur une variabilité ;
 *    « OPEN » est une opportunité EN COURS au pipeline et un exercice OUVERT
 *    en comptabilité. Un dictionnaire à plat aurait traduit l'un par l'autre.
 */
const FR = {
  AllocationBasis: {
    PER_VOLUME: 'Au volume',
    PER_OPERATION: 'À l’opération',
    PER_REVENUE: 'Au chiffre d’affaires',
  },
  CommercialSegment: {
    MARITIME: 'Maritime',
    B2B: 'Entreprises',
    RETAIL: 'Stations-service',
  },
  ComplianceType: {
    INSURANCE: 'Assurance',
    TECHNICAL_INSPECTION: 'Contrôle technique',
    DRIVER_LICENSE: 'Permis de conduire',
    DRIVER_TRAINING: 'Habilitation chauffeur',
    CUSTOMS_LICENSE: 'Agrément douanier',
    MINISTERIAL_APPROVAL: 'Agrément ministériel',
    IMPORT_EXPORT_LICENSE: 'Licence import/export',
    HSE_CERTIFICATION: 'Certification HSE',
    VESSEL_CERTIFICATE: 'Certificat de navire',
    SAFETY_DATA_SHEET: 'Fiche de données de sécurité',
    OTHER: 'Autre',
  },
  ContractStatus: {
    DRAFT: 'Brouillon',
    ACTIVE: 'Actif',
    SUSPENDED: 'Suspendu',
    EXPIRED: 'Échu',
    TERMINATED: 'Résilié',
  },
  CostBasis: {
    PER_UNIT: 'Au litre, proportionnel au volume',
    FIXED: 'Forfait pour l’affaire',
  },
  CostNature: { DIRECT: 'Directe', INDIRECT: 'Indirecte' },
  CostVariability: { VARIABLE: 'Variable', FIXED: 'Fixe' },
  CreditStatus: { ACTIVE: 'Normal', WATCH: 'Sous surveillance', BLOCKED: 'Bloqué' },
  CrmStageOutcome: {
    OPEN: 'En cours',
    WON: 'Gagnée',
    LOST: 'Perdue',
    DORMANT: 'En veille',
  },
  DunningMethod: {
    PHONE: 'Téléphone',
    EMAIL: 'E-mail',
    LETTER: 'Courrier',
    VISIT: 'Visite',
    OTHER: 'Autre',
  },
  FiscalYearStatus: { PLANNED: 'En préparation', OPEN: 'Ouvert', CLOSED: 'Clos' },
  ForecastKind: { BUDGET: 'Budget', REVISION: 'Révision' },
  FxRateType: {
    PEG: 'Parité fixe réglementaire',
    OFFICIAL: 'Officiel',
    BANK: 'Bancaire',
    CONTRACTUAL: 'Contractuel',
    INTERNAL: 'Interne',
    BUDGET: 'Budgétaire',
  },
  GuaranteeStatus: {
    PENDING: 'En attente',
    ACTIVE: 'Active',
    CONSUMED: 'Consommée',
    EXPIRED: 'Échue',
    CANCELLED: 'Annulée',
  },
  GuaranteeType: {
    LETTER_OF_CREDIT: 'Lettre de crédit',
    DOWN_PAYMENT: 'Acompte',
    BANK_GUARANTEE: 'Garantie bancaire',
  },
  HseControlLevel: {
    RECOMMENDED: 'Recommandé',
    MANDATORY: 'Obligatoire',
    CONDITIONAL: 'Conditionnel',
    BLOCKING: 'Bloquant, arrête l’opération',
  },
  HseEventType: {
    INCIDENT: 'Incident',
    ACCIDENT: 'Accident',
    SPILL: 'Déversement',
    NEAR_MISS: 'Quasi-accident',
    DANGEROUS_OBSERVATION: 'Observation dangereuse',
    NON_CONFORMITY: 'Non-conformité',
  },
  HsePhotoPolicy: { FORBIDDEN: 'Interdite', OPTIONAL: 'Facultative', REQUIRED: 'Exigée' },
  HseRiskLevel: { STANDARD: 'Standard', REINFORCED: 'Renforcé', CRITICAL: 'Critique' },
  HseSeverity: {
    MINOR: 'Mineure',
    MODERATE: 'Modérée',
    MAJOR: 'Majeure',
    CRITICAL: 'Critique',
  },
  InvoicePaymentMethod: {
    CASH: 'Espèces',
    CARD: 'Carte',
    CHECK: 'Chèque',
    MOBILE_MONEY: 'Mobile money',
    TRANSFER: 'Virement',
    DEFERRED: 'À terme',
  },
  OperationPhase: {
    PREPARATION: 'Préparation',
    PRE_CHARGEMENT: 'Avant chargement',
    CHARGEMENT: 'Chargement',
    POST_CHARGEMENT: 'Après chargement',
    TRANSPORT: 'Transport',
    PRE_DECHARGEMENT: 'Avant déchargement',
    DECHARGEMENT: 'Déchargement',
    POST_DECHARGEMENT: 'Après déchargement',
    CLOTURE: 'Clôture',
  },
  OperationHaltType: {
    INCIDENT: 'Incident',
    CANCELLED: 'Annulée',
  },
  PartnerType: {
    CLIENT: 'Client',
    PROSPECT: 'Prospect',
    SUPPLIER: 'Fournisseur',
    CARRIER: 'Transporteur',
    INSPECTOR: 'Inspecteur',
  },
  PriceReferenceType: {
    SIR: 'Publication SIR',
    PUMP: 'Prix à la pompe',
    SUPPLIER: 'Prix fournisseur',
    CONTRACTUAL: 'Prix contractuel',
  },
  // ⚠️ « LOADING » se dit APPROVISIONNEMENT, pas « chargement ».
  //    Un même site sert souvent aux deux : on y prend du produit et on y en
  //    livre. Nommer l'usage par ce qu'il APPORTE à Elyon lève l'ambiguïté que
  //    « site de livraison » entretenait.
  SiteUsage: { LOADING: 'Approvisionnement', DELIVERY: 'Livraison' },
  TransportMode: {
    PIPELINE: 'Pipeline',
    BUNKERING: 'Soutage',
    BARGE: 'Barge',
    TRUCK: 'Camion',
    RAIL: 'Rail',
  },
  UnitOfMeasure: { L: 'Litre', M3: 'Mètre cube', MT: 'Tonne', BBL: 'Baril' },
  VehicleType: {
    TANKER_TRUCK: 'Camion-citerne',
    RAIL_WAGON: 'Wagon-citerne',
    BUNKER_BARGE: 'Barge de soutage',
    PIPELINE_SECTION: 'Tronçon de pipeline',
    OTHER: 'Autre',
  },
  TypeDeValeur: {
    string: 'Texte',
    number: 'Nombre',
    boolean: 'Oui / non',
    json: 'Structure JSON',
  },
} as const;

const vocabulaire = <T extends Record<string, string>>(
  e: T,
  labels: Readonly<Record<string, string>>,
) => values(e).map((code) => ({ code, label: labels[code] ?? code }));

/**
 * VOCABULAIRES — libellés d'énumérations SANS référentiel administrable propre.
 *
 * ⚠️ CES CINQ ÉNUMÉRATIONS N'ONT PAS DE TABLE À ELLES.
 *
 *    Contrairement à un segment ou une unité de mesure, la nature d'un
 *    événement HSE, le mode de règlement d'une facture, la nature d'une pièce
 *    de conformité ou la méthode de relance ne décrivent pas une entité
 *    administrée : ce sont des colonnes d'énumération posées directement sur
 *    un enregistrement transactionnel, lues par des rôles opérationnels
 *    (agent terrain, contrôleur HSE, comptable) qui n'ont et n'ont pas à
 *    avoir de droit d'écriture sur un référentiel.
 *
 *    Les exposer par `parameterCatalogue()` les aurait rendues invisibles à
 *    ces rôles : ce catalogue ne rend que ce que l'appelant peut ÉCRIRE. D'où
 *    cette liste séparée, en lecture pour tout rôle interne authentifié — le
 *    même principe que « Procédures opérationnelles ».
 *
 *    La LISTE des valeurs reste celle de l'énumération PostgreSQL : elle ne
 *    change qu'avec une migration, comme n'importe quelle énumération de ce
 *    système. Ce qui est centralisé ici, c'est le LIBELLÉ français — avant
 *    cette déclaration, il était recopié séparément dans chacun des quatre
 *    écrans qui s'en servent, avec le risque de divergence que ça porte.
 */
export function vocabulaires() {
  return {
    hseEventType: vocabulaire(HseEventType, FR.HseEventType),
    hseSeverity: vocabulaire(HseSeverity, FR.HseSeverity),
    invoicePaymentMethod: vocabulaire(InvoicePaymentMethod, FR.InvoicePaymentMethod),
    complianceType: vocabulaire(ComplianceType, FR.ComplianceType),
    dunningMethod: vocabulaire(DunningMethod, FR.DunningMethod),
  };
}

export const REFERENTIALS: ReferentialSpec[] = [

  // ===========================================================================
  //  GROUPE — FONDATIONS TRANSVERSES
  //
  //  Ce que tout le reste vise : devises, pays, exercice, produits. Rien
  //  ici ne référence un autre référentiel du registre.
  // ===========================================================================

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
      'LA LISTE EST FERMÉE : ces réglages sont ceux que le système sait lire. En ajouter un n’a aucun effet, et l’onglet « Ce qui est enregistré » montre les vingt-six qui existent - posés par défaut sur tout environnement dès l’installation, réglables ensuite ligne par ligne - plus une ligne technique d’installation (PROOF_LOCK_INSTALLED_AT) à ne jamais modifier. Partez du bouton « Modifier » plutôt que de saisir une clé de mémoire. Ils gouvernent des calculs et des règles de sécurité, et s’appliquent dans les trente secondes, SAUF les deux plafonds de débit, qui exigent un redémarrage.',
    fields: [
      // ⚠️ UNE LISTE, ET NON UNE SAISIE LIBRE.
      //
      //    La clé se tapait de mémoire. Une faute de frappe créait un réglage
      //    que rien ne lit : il s'affichait comme les autres, se modifiait
      //    comme les autres, et n'avait aucun effet. Le seul symptôme était
      //    que la valeur « ne servait à rien », ce qui ne mène à rien.
      //
      //    La liste vise le référentiel lui-même : elle propose donc les clés
      //    RÉELLEMENT en place, celles que le code interroge.
      {
        name: 'key',
        label: 'Réglage',
        type: 'reference',
        refTable: 'settings',
        refKey: 'key',
        required: true,
        help: 'Les réglages que le système sait lire. En créer un autre resterait sans effet',
      },
      {
        name: 'value',
        label: 'Valeur',
        type: 'string',
        required: true,
        help: 'Selon le type : un nombre (18), un texte (XOF), oui/non (true ou false), une liste séparée par des virgules (DG,FINANCE_CFO)',
      },
      { name: 'valueType', label: 'Type', type: 'enum', required: true, values: ['string', 'number', 'boolean', 'json'], valueLabels: FR.TypeDeValeur },
      {
        name: 'description',
        label: 'Description',
        type: 'text',
        required: true,
        help: 'À quoi sert ce réglage et ce que sa modification entraîne. C’est ce texte qui sera lu par la personne suivante',
      },
    ],
  },

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
      'Une seule devise pivot et une seule devise fonctionnelle sont admises : la seconde est refusée.',
    fields: [
      { name: 'code', label: 'Code ISO', type: 'string', required: true, help: 'Trois lettres : XOF, USD, EUR' },
      { name: 'name', label: 'Libellé', type: 'string', required: true, help: 'Le nom lu à l’écran, ex. « Gasoil 50 ppm », « Fuel oil 180 CST »' },
      { name: 'symbol', label: 'Symbole', type: 'string', required: true, help: 'ex. F CFA, $, €' },
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
  //  Pays — FERMÉ (arbitrage du 15/08). Liste des pays d'activité réels, pas
  //  la liste ISO complète : Elyon n'opère pas partout.
  // =========================================================================
  {
    key: 'countries',
    label: 'Pays',
    model: 'country',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.CCOO],
    identity: ['code'],
    caution:
      'Liste fermée aux pays où Elyon a réellement une activité ou une contrepartie, pas la liste ISO complète. En ajouter un ici l’ouvre partout où le pays se choisit (tiers, sites) ; en retirer un que des tiers existants portent encore le rend introuvable pour un nouveau tiers sans le rendre invalide pour les anciens.',
    fields: [
      { name: 'code', label: 'Code ISO', type: 'string', required: true, help: 'Deux lettres : CI, BF, ML…' },
      { name: 'name', label: 'Nom', type: 'string', required: true, help: 'ex. « Côte d’Ivoire »' },
      { name: 'isActive', label: 'Actif', type: 'boolean' },
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
      'UN SEUL exercice peut être courant : le second est refusé au lieu d’être corrigé en silence. Clore un exercice FIGE ses valeurs budgétaires, c’est ce qui garantit qu’une affaire de 2026 reste évaluée aux conditions de 2026, et non à celles renégociées depuis.',
    fields: [
      { name: 'year', label: 'Millésime', type: 'integer', required: true },
      { name: 'label', label: 'Libellé', type: 'string', required: true, help: 'Le nom lu à l’écran, ex. « Exercice 2026 » ou « Exercice août-décembre 2026 »' },
      { name: 'startsOn', label: 'Début', type: 'date', required: true },
      { name: 'endsOn', label: 'Fin', type: 'date', required: true },
      {
        name: 'status',
        label: 'État',
        type: 'enum',
        required: true,
        values: values(FiscalYearStatus), valueLabels: FR.FiscalYearStatus,
        help: 'PLANNED : budget en construction. OPEN : les valeurs s’appliquent. CLOSED : plus modifiable.',
      },
      { name: 'isCurrent', label: 'Exercice courant', type: 'boolean' },
      { name: 'notes', label: 'Notes', type: 'text' },
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
      { name: 'code', label: 'Code', type: 'string', required: true, help: 'Sans espace ni accent, ex. GASOIL, SUPER_91, FUEL_180' },
      { name: 'name', label: 'Désignation', type: 'string', required: true, help: 'Le nom lu à l’écran et imprimé sur les pièces, ex. « Gasoil 50 ppm », « Fuel oil 180 CST »' },
      {
        name: 'isService',
        label: 'Produit service',
        type: 'boolean',
        help: 'Prestation (ex. barge) plutôt que produit physique : aucune densité, une affaire qui le retient n’exige ni transport ni volume.',
      },
      {
        name: 'referenceDensity15',
        label: 'Densité à 15 °C',
        type: 'number',
        decimals: 6,
        help: 'Requise pour un produit physique, sans objet pour un produit service.',
      },
      { name: 'defaultUom', label: 'Unité par défaut', type: 'enum', required: true, values: UOMS, valueLabels: FR.UnitOfMeasure },
      { name: 'viscosityCst', label: 'Viscosité (cSt)', type: 'number', decimals: 3 },
      { name: 'flashPointC', label: 'Point éclair (°C)', type: 'number', decimals: 2 },
      { name: 'maxSulphurPct', label: 'Soufre max (%)', type: 'number', decimals: 4 },
      { name: 'taxRegime', label: 'Régime fiscal', type: 'string' },
      {
        name: 'uiColorToken',
        label: 'Teinte d’affichage',
        type: 'string',
        required: true,
        help: 'Canal visuel distinct des statuts, teinte désaturée, ex. « violet-400 »',
      },
      { name: 'isActive', label: 'Actif', type: 'boolean' },
    ],
  },

  // ===========================================================================
  //  GROUPE — TIERS ET ENGAGEMENTS COMMERCIAUX
  //
  //  Un tiers d’abord (il porte le pays) ; ce qui l’engage ensuite —
  //  contrat-cadre, prix fournisseur, garantie — vise ensuite un tiers déjà
  //  enregistré.
  // ===========================================================================

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
      'Le PLAFOND DE CRÉDIT est opposé à l’approbation des affaires : le relever ouvre l’engagement, le baisser peut bloquer des affaires en cours. Les DÉLAIS de paiement et de règlement fournisseur commandent le coût de portage : les allonger dégrade la marge de toutes les affaires du tiers.',
    fields: [
      { name: 'code', label: 'Code', type: 'string', required: true, help: 'Votre référence interne du tiers, ex. CLI_TOTAL_CI, FRN_SIR, TRP_SOTRA' },
      { name: 'legalName', label: 'Raison sociale', type: 'string', required: true },
      {
        name: 'type',
        label: 'Nature',
        type: 'enum',
        required: true,
        values: values(PartnerType), valueLabels: FR.PartnerType,
        help: 'Un fret ne se rattache qu’à un TRANSPORTEUR, un prix d’achat qu’à un FOURNISSEUR, et c’est vérifié',
      },
      { name: 'countryCode', label: 'Pays', type: 'reference', refTable: 'countries', refKey: 'code', required: true, help: 'Liste fermée aux pays d’activité : voir le référentiel Pays.' },
      {
        name: 'segment',
        label: 'Segment',
        type: 'enum',
        values: SEGMENTS, valueLabels: FR.CommercialSegment,
        help: 'Vide = le segment se décide affaire par affaire',
      },
      { name: 'taxpayerAccountNumber', label: 'Compte contribuable', type: 'string' },
      { name: 'rccmNumber', label: 'RCCM', type: 'string' },
      { name: 'taxRegime', label: 'Régime fiscal', type: 'string' },
      {
        name: 'isGovernmentInstitution',
        label: 'Institution gouvernementale',
        type: 'boolean',
        help: 'Régie, collectivité, entreprise publique : détermine le gabarit B2G à la transmission FNE, distinct de B2B/B2C/B2F.',
      },
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
        help: 'OPPOSÉ à l’approbation. À 0, le client n’est pas encadré, ce n’est pas au verrou d’en décider.',
      },
      { name: 'creditLimitCurrencyCode', label: 'Devise du plafond', type: 'reference', refTable: 'currencies', refKey: 'code', required: true, help: 'Se choisit. Le pivot sert à comparer, il n’est la monnaie de personne' },
      {
        name: 'creditStatus',
        label: 'Statut de crédit',
        type: 'enum',
        values: values(CreditStatus), valueLabels: FR.CreditStatus,
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
      'Les conditions saisies ici sont HÉRITÉES PAR DÉFAUT par les affaires rattachées : le délai de paiement entre dans le coût de portage de chacune. Les modifier ne change PAS les affaires déjà chiffrées, leur marge a été calculée sur les conditions du moment, et la réécrire après coup effacerait ce sur quoi l’approbation a porté.',
    fields: [
      { name: 'reference', label: 'Référence', type: 'string', required: true },
      {
        name: 'clientId',
        label: 'Client',
        type: 'reference',
        refTable: 'partners',
        refKey: 'code',
        refFilter: { type: 'CLIENT' },
        required: true,
      },
      { name: 'title', label: 'Intitulé', type: 'string', required: true },
      { name: 'status', label: 'Statut', type: 'enum', values: values(ContractStatus), valueLabels: FR.ContractStatus },
      {
        name: 'segment',
        label: 'Segment',
        type: 'enum',
        required: true,
        values: SEGMENTS, valueLabels: FR.CommercialSegment,
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
      { name: 'volumeUom', label: 'Unité du volume', type: 'enum', values: values(UnitOfMeasure), valueLabels: FR.UnitOfMeasure },
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
      'Un prix saisi ici n’est PAS opposable tant que le DG ne l’a pas validé : la validation est un acte distinct, réservé au DG et vérifié automatiquement. Un prix validé devient IMMUABLE : il a servi à chiffrer des affaires, et le réécrire changerait leur marge après coup. Pour corriger, publiez une nouvelle ligne à une autre date.',
    fields: [
      {
        name: 'supplierId',
        label: 'Fournisseur',
        type: 'reference',
        refTable: 'partners',
        refKey: 'code',
        refFilter: { type: 'SUPPLIER' },
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
      { name: 'uom', label: 'Unité', type: 'enum', required: true, values: values(UnitOfMeasure), valueLabels: FR.UnitOfMeasure },
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
      { name: 'version', label: 'Version', type: 'version', help: 'Confort de lecture au tableau, n’intervient dans aucun calcul' },
      { name: 'isActive', label: 'Active', type: 'boolean', help: 'Une version inactive n’est jamais proposée pour une affaire nouvelle' },
      { name: 'effectiveFrom', label: 'En vigueur à partir du', type: 'date', required: true },
      { name: 'effectiveTo', label: 'Jusqu’au', type: 'date' },
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
      'Une garantie ACTIVE et non échue DÉDUIT l’exposition crédit du client, donc ouvre son plafond. Son montant en devise pivot est CALCULÉ au cours du jour : le laisser saisir permettrait d’ouvrir un plafond en écrivant un nombre, sans qu’aucune banque n’ait rien garanti.',
    fields: [
      { name: 'reference', label: 'Référence', type: 'string', required: true },
      {
        name: 'partnerId',
        label: 'Tiers garanti',
        type: 'reference',
        refTable: 'partners',
        refKey: 'code',
        refFilter: { type: 'CLIENT' },
        required: true,
      },
      { name: 'type', label: 'Type', type: 'enum', required: true, values: values(GuaranteeType), valueLabels: FR.GuaranteeType },
      {
        name: 'status',
        label: 'Statut',
        type: 'enum',
        values: values(GuaranteeStatus), valueLabels: FR.GuaranteeStatus,
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
        help: 'Une garantie échue cesse de déduire l’exposition, sans qu’aucune tâche n’ait à tourner',
      },
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
      'La PROBABILITÉ décide de la valeur pondérée du pipeline, qui alimente la prévision de vente, qui fournit l’assiette du taux d’absorption. Une probabilité optimiste ne reste donc pas un problème commercial : elle fait BAISSER le coût de revient calculé, et laisse passer des affaires qui ne couvrent pas leurs frais. Laissée vide, la valeur pondérée n’est pas calculée, c’est voulu. « Gagnée » vaut obligatoirement 100 et « Perdue » 0 : ce sont des faits, pas des estimations.',
    fields: [
      { name: 'code', label: 'Code', type: 'string', required: true, help: 'Sans espace ni accent, ex. NOUVEAU, OFFRE_ENVOYEE, NEGOCIATION' },
      { name: 'label', label: 'Libellé', type: 'string', required: true, help: 'Le nom lu à l’écran, ex. « Offre envoyée », « Négociation »' },
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
        values: values(CrmStageOutcome), valueLabels: FR.CrmStageOutcome,
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

  // ===========================================================================
  //  GROUPE — RÉFÉRENTIEL LOGISTIQUE
  //
  //  Un site avant ce qui s’y rattache (ses exigences), une flotte avant ce
  //  qui la tarife (un tarif de transport vise un site ET un tiers déjà
  //  posés).
  // ===========================================================================

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
      'Les consignes d’accès et de sécurité saisies ici sont celles que l’agent lira sur sa tablette avant d’entrer. Un même site servant plusieurs clients, les corriger ici les corrige pour tous, c’est précisément l’intérêt.',
    fields: [
      { name: 'code', label: 'Code', type: 'string', required: true, help: 'Sans espace ni accent, ex. DEPOT_VRIDI, STATION_YOPOUGON, SIR_ABIDJAN' },
      { name: 'name', label: 'Nom du site', type: 'string', required: true, help: 'Le nom lu à l’écran, ex. « Dépôt de Vridi », « Station Yopougon Ananeraie »' },
      {
        name: 'usages',
        label: 'Usages',
        type: 'enumList',
        required: true,
        values: values(SiteUsage), valueLabels: FR.SiteUsage,
        help: 'Approvisionnement, livraison, ou les deux : vous en décidez site par site. Rien n’est déduit de la nature du lieu, une station-service est un lieu d’approvisionnement dès lors qu’on y prend du produit. Un lieu qui fait les deux porte les DEUX ; le créer deux fois périmerait l’une des copies.',
      },
      { name: 'addressLine', label: 'Adresse', type: 'string', help: 'ex. « Zone portuaire de Vridi, boulevard de Petit Bassam »' },
      { name: 'city', label: 'Ville', type: 'string', help: 'ex. Abidjan, San Pédro, Bouaké' },
      { name: 'countryCode', label: 'Pays', type: 'reference', refTable: 'countries', refKey: 'code', required: true, help: 'Liste fermée aux pays d’activité : voir le référentiel Pays.' },
      { name: 'latitude', label: 'Latitude', type: 'number', help: 'En degrés décimaux, ex. 5,2540 pour Abidjan' },
      { name: 'longitude', label: 'Longitude', type: 'number', help: 'En degrés décimaux, ex. -3,9860 pour Abidjan' },
      {
        name: 'accessInstructions',
        label: 'Consignes d’accès',
        type: 'text',
        help: 'Comment entrer : poste de garde, itinéraire, restrictions de gabarit',
      },
      { name: 'openingHours', label: 'Horaires d’ouverture', type: 'string', help: 'ex. « lundi au samedi 6 h à 18 h, fermé les jours fériés »' },
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
        values: values(HseRiskLevel), valueLabels: FR.HseRiskLevel,
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
      'Une nature marquée bloquante par défaut le sera sur chaque site qui l’adopte. Le caractère bloquant reste réglable site par site : un badge d’accès est indispensable ici, une simple recommandation ailleurs.',
    fields: [
      { name: 'code', label: 'Code', type: 'string', required: true, help: 'Sans espace ni accent, ex. BADGE_ACCES, EPI_COMPLET, RENDEZ_VOUS' },
      { name: 'label', label: 'Libellé', type: 'string', required: true, help: 'Ce que l’agent lira sur sa tablette, ex. « Badge d’accès du dépôt »' },
      { name: 'description', label: 'Précision', type: 'text' },
      {
        name: 'defaultBlocking',
        label: 'Bloquante par défaut',
        type: 'boolean',
        help: 'Se présenter sans y satisfaire, c’est repartir à vide',
      },
      { name: 'displayOrder', label: 'Ordre d’affichage', type: 'integer', help: 'Rang dans les listes et les écrans : 10 apparaît avant 20. Numérotez de dix en dix pour pouvoir intercaler plus tard sans tout renuméroter. N’a aucun effet sur les calculs.' },
      { name: 'isActive', label: 'Actif', type: 'boolean' },
    ],
  },

  // =========================================================================
  //  Exigences portées par un site — mutable.
  // =========================================================================
  {
    key: 'site-requirements',
    label: 'Exigences des sites',
    model: 'siteRequirement',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD],
    identity: ['siteId', 'typeId'],
    caution:
      'C’est ce que le coordinateur lit en préparant l’opération, et l’agent avant d’entrer. Une exigence bloquante non satisfaite se solde par un camion qui repart à vide : le produit est déjà payé.',
    fields: [
      {
        name: 'siteId',
        label: 'Site',
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
      'La CAPACITÉ et les PRODUITS AUTORISÉS sont opposés à l’affectation : une opération dépassant la capacité, ou portant un produit non autorisé, est refusée. Le statut de conformité, lui, ne se saisit pas : il se déduit des pièces à échéance.',
    fields: [
      { name: 'registration', label: 'Immatriculation', type: 'string', required: true },
      {
        name: 'carrierId',
        label: 'Transporteur',
        type: 'reference',
        refTable: 'partners',
        refKey: 'code',
        refFilter: { type: 'CARRIER' },
        help: 'Vide = véhicule en propre',
      },
      { name: 'type', label: 'Type', type: 'enum', required: true, values: values(VehicleType), valueLabels: FR.VehicleType },
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
        values: values(UnitOfMeasure), valueLabels: FR.UnitOfMeasure,
        help: 'La comparaison ne se fait que si l’opération est dans la même unité : comparer des litres à des tonnes serait pire que ne rien comparer',
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
        refFilter: { type: 'CARRIER' },
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
      'Le tarif est OPPOSÉ à l’affectation des moyens : tout écart au-delà de la tolérance exige un motif écrit, sans quoi la saisie est refusée. Laisser la tolérance à 0 est la règle stricte retenue par la direction : un franc d’écart porté sur dix millions de litres crée un préjudice.',
    fields: [
      {
        name: 'carrierId',
        label: 'Transporteur',
        type: 'reference',
        refTable: 'partners',
        refKey: 'code',
        refFilter: { type: 'CARRIER' },
        required: true,
        help: 'Un tarif ne se négocie qu’avec un tiers enregistré comme TRANSPORTEUR',
      },
      {
        name: 'transportMode',
        label: 'Mode de transport',
        type: 'enum',
        values: TRANSPORT, valueLabels: FR.TransportMode,
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
        help: 'Vide = toutes destinations. Un tarif se négocie pour un TRAJET : « Abidjan → Man » et « San Pédro → Man » n’ont pas le même prix.',
      },
      {
        name: 'basis',
        label: 'Base',
        type: 'enum',
        required: true,
        values: values(CostBasis), valueLabels: FR.CostBasis,
        help: 'PER_UNIT = au litre transporté · FIXED = forfait par rotation',
      },
      { name: 'amount', label: 'Montant', type: 'number', required: true },
      {
        name: 'uom',
        label: 'Unité',
        type: 'enum',
        values: values(UnitOfMeasure), valueLabels: FR.UnitOfMeasure,
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
      { name: 'code', label: 'Code', type: 'string', required: true, help: 'Sans espace ni accent, ex. CHARGEMENT_DEPOT, TRANSPORT_ROUTE, SOUTAGE' },
      { name: 'label', label: 'Libellé', type: 'string', required: true, help: 'Le nom lu à l’écran, ex. « Chargement au dépôt », « Transport routier »' },
      { name: 'description', label: 'Précision opérationnelle', type: 'text' },
      {
        name: 'segments',
        label: 'Segments concernés',
        type: 'enumList',
        values: SEGMENTS, valueLabels: FR.CommercialSegment,
        help: 'Vide = tous les segments',
      },
      {
        name: 'defaultRiskLevel',
        label: 'Niveau de risque par défaut',
        type: 'enum',
        values: values(HseRiskLevel), valueLabels: FR.HseRiskLevel,
        help: 'Proposé à la création et modifiable. Une aide à la saisie, pas une contrainte',
      },
      { name: 'displayOrder', label: 'Ordre d’affichage', type: 'integer', help: 'Rang dans les listes et les écrans : 10 apparaît avant 20. Numérotez de dix en dix pour pouvoir intercaler plus tard sans tout renuméroter. N’a aucun effet sur les calculs.' },
      { name: 'isActive', label: 'Actif', type: 'boolean' },
    ],
  },

  // ===========================================================================
  //  GROUPE — HSE
  //
  //  Un modèle de checklist avant ses points de contrôle, qui le visent.
  // ===========================================================================

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
      { name: 'code', label: 'Code', type: 'string', required: true, help: 'Sans espace ni accent, ex. HSE_CHARGEMENT, HSE_ROUTE, HSE_SOUTAGE' },
      { name: 'label', label: 'Libellé', type: 'string', required: true, help: 'Le nom lu à l’écran, ex. « Contrôles avant chargement »' },
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
        values: SEGMENTS, valueLabels: FR.CommercialSegment,
        help: 'Affinage. Vide = tous',
      },
      {
        name: 'applicableTransportModes',
        label: 'Modes de transport',
        type: 'enumList',
        values: TRANSPORT, valueLabels: FR.TransportMode,
        help: 'Affinage. Vide = tous',
      },
      {
        name: 'applicableRiskLevels',
        label: 'Niveaux de risque',
        type: 'enumList',
        values: values(HseRiskLevel), valueLabels: FR.HseRiskLevel,
        help: 'Affinage. Vide = tous',
      },
      { name: 'version', label: 'Version', type: 'version' },
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
      { name: 'code', label: 'Code', type: 'string', required: true, help: 'Sans espace ni accent, ex. EXTINCTEUR_PRESENT, MISE_A_LA_TERRE, EPI_PORTES' },
      { name: 'label', label: 'Intitulé du contrôle', type: 'string', required: true, help: 'La question posée à l’agent, ex. « L’extincteur est-il présent et plombé ? »' },
      { name: 'guidance', label: 'Précision affichée sur la tablette', type: 'text' },
      {
        name: 'phase',
        label: 'Étape',
        type: 'enum',
        required: true,
        values: values(OperationPhase), valueLabels: FR.OperationPhase,
        help: 'Étape de l’opération à laquelle ce contrôle se fait',
      },
      {
        name: 'level',
        label: 'Niveau',
        type: 'enum',
        required: true,
        values: values(HseControlLevel), valueLabels: FR.HseControlLevel,
        help: 'BLOCKING empêche le chargement tant qu’il n’est pas satisfait',
      },
      {
        name: 'photoPolicy',
        label: 'Régime photographique',
        type: 'enum',
        values: values(HsePhotoPolicy), valueLabels: FR.HsePhotoPolicy,
        help: 'INTERDITE en zone ATEX ou chez un client qui la proscrit · FACULTATIVE la propose · EXIGÉE empêche l’enregistrement du point sans photo',
      },
      { name: 'requiresValue', label: 'Valeur exigée', type: 'boolean' },
      { name: 'valueLabel', label: 'Libellé de la valeur', type: 'string' },
      { name: 'requiresSignature', label: 'Signature exigée', type: 'boolean' },
      { name: 'displayOrder', label: 'Ordre d’affichage', type: 'integer', help: 'Rang dans les listes et les écrans : 10 apparaît avant 20. Numérotez de dix en dix pour pouvoir intercaler plus tard sans tout renuméroter. N’a aucun effet sur les calculs.' },
      { name: 'isActive', label: 'Actif', type: 'boolean' },
    ],
  },

  // ===========================================================================
  //  GROUPE — MARCHÉ ET PILOTAGE
  //
  //  Ce qu’on révise en cours d’exercice, pas ce qu’on pose une fois à la
  //  mise en route : cours de change, seuils de marge, prix administrés,
  //  taux de financement, prévision de vente.
  //
  //  ⚠️ VIENT AVANT « Coûts et absorption », ET C'EST OBLIGÉ.
  //
  //     `sales-forecasts` (prévision de vente) doit être saisie avant
  //     `absorption-rates` (budget des pools) : le déclencheur qui calcule
  //     le taux d'absorption lit directement la prévision de vente courante
  //     et REFUSE si elle manque. Ce n'est pas une référence de champ que ce
  //     registre pourrait suivre tout seul — c'est une règle métier en base,
  //     et le menu doit la respecter explicitement.
  // ===========================================================================

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
        values: values(FxRateType), valueLabels: FR.FxRateType,
      },
      { name: 'effectiveFrom', label: 'En vigueur depuis', type: 'date', required: true },
      { name: 'effectiveTo', label: 'Jusqu’au', type: 'date' },
      { name: 'notes', label: 'Note', type: 'text' },
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
      { name: 'segment', label: 'Segment', type: 'enum', required: true, values: SEGMENTS, valueLabels: FR.CommercialSegment },
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
      { name: 'uom', label: 'Unité', type: 'enum', required: true, values: UOMS, valueLabels: FR.UnitOfMeasure },
      { name: 'effectiveFrom', label: 'En vigueur depuis', type: 'date', required: true },
      { name: 'effectiveTo', label: 'Jusqu’au', type: 'date' },
      {
        name: 'isActive',
        label: 'Actif',
        type: 'boolean',
        help: 'Coupe le seuil sans le dater expiré, pour le réactiver sans nouvelle ligne. Un seuil inactif n’est jamais résolu, quelle que soit sa fenêtre de validité.',
      },
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
      'La tolérance appliquée est figée au moment du relevé : une grille révisée ne requalifie jamais un écart déjà acquitté. Ces seuils sont CONTRACTUELS, pas physiques : ils viennent de vos contrats de transport et de vos polices d’assurance.',
    fields: [
      { name: 'segment', label: 'Segment', type: 'enum', values: SEGMENTS, valueLabels: FR.CommercialSegment, help: 'Vide = tous' },
      { name: 'transportMode', label: 'Mode de transport', type: 'enum', values: TRANSPORT, valueLabels: FR.TransportMode, help: 'Vide = tous' },
      { name: 'productId', label: 'Produit', type: 'reference', refTable: 'products', refKey: 'code' },
      { name: 'normalThresholdPct', label: 'Seuil normal (%)', type: 'number', required: true, decimals: 6 },
      { name: 'alertThresholdPct', label: 'Seuil d’alerte (%)', type: 'number', required: true, decimals: 6 },
      { name: 'criticalThresholdPct', label: 'Seuil critique (%)', type: 'number', required: true, decimals: 6, help: 'Au-delà : non-conformité HSE ouverte d’office' },
      { name: 'absoluteFranchise', label: 'Franchise absolue', type: 'number', decimals: 6 },
      { name: 'franchiseUom', label: 'Unité de franchise', type: 'enum', values: UOMS, valueLabels: FR.UnitOfMeasure },
      { name: 'effectiveFrom', label: 'En vigueur depuis', type: 'date', required: true },
      { name: 'effectiveTo', label: 'Jusqu’au', type: 'date' },
      {
        name: 'isActive',
        label: 'Actif',
        type: 'boolean',
        help: 'Coupe la grille sans la dater expirée, pour la réactiver sans nouvelle ligne. Une grille inactive n’est jamais résolue, quelle que soit sa fenêtre de validité.',
      },
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
      'Ces prix sont une RÉFÉRENCE que le commercial consulte, jamais un moteur : le système ne dérive aucun prix de vente ni aucun coût d’achat à partir d’eux.',
    fields: [
      { name: 'referenceType', label: 'Nature', type: 'enum', required: true, values: values(PriceReferenceType), valueLabels: FR.PriceReferenceType },
      { name: 'productId', label: 'Produit', type: 'reference', refTable: 'products', refKey: 'code', required: true },
      { name: 'zone', label: 'Zone', type: 'string', help: 'Ressort géographique du prix publié, ex. « Abidjan », « intérieur du pays ». Vide = tout le pays' },
      { name: 'price', label: 'Prix', type: 'number', required: true, decimals: 4 },
      { name: 'currencyCode', label: 'Devise', type: 'reference', refTable: 'currencies', refKey: 'code', required: true },
      { name: 'uom', label: 'Unité', type: 'enum', required: true, values: UOMS, valueLabels: FR.UnitOfMeasure },
      { name: 'publishedBy', label: 'Publié par', type: 'string', required: true, help: 'DGH, SIR…' },
      { name: 'publicationReference', label: 'Référence de publication', type: 'string', help: 'Ce qui permet de retrouver la source, ex. « Arrêté DGH n° 2026-014 du 1er août »' },
      { name: 'effectiveFrom', label: 'En vigueur depuis', type: 'date', required: true },
      { name: 'effectiveTo', label: 'Jusqu’au', type: 'date' },
      { name: 'notes', label: 'Décomposition indicative', type: 'text', help: 'Champ libre, aucune contrainte ne le vérifie ni ne s’en sert' },
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
      'Le coût de portage des affaires en dépend. Tant qu’il n’est pas saisi pour l’exercice, le système emploie l’ancien paramètre global à titre PROVISOIRE et le signale : il ne devine pas vos conditions bancaires. La base de jours n’est pas neutre : 360 ou 365 déplacent le coût de portage de 1,4 %.',
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
        help: 'Convention de découvert, lettre de crédit, moyenne pondérée. Sans cette trace, le taux n’est ni contestable ni reproductible',
      },
      { name: 'version', label: 'Version', type: 'version' },
      { name: 'isCurrent', label: 'Version courante', type: 'boolean' },
    ],
  },

  // =========================================================================
  //  ⚠️ « BUDGET DE CHARGES FIXES » A ÉTÉ RETIRÉ DU PARAMÉTRAGE.
  //
  //     Il décrivait le MÊME ARGENT que les pools de charges indirectes : le
  //     budget administration se tapait une fois dans un pool, une seconde fois
  //     ici, et rien ne rapprochait les deux totaux. Le jour où ils
  //     divergeaient, le seuil de marge et le point mort racontaient deux
  //     histoires différentes, et ni l'un ni l'autre ne le disait.
  //
  //     Les charges fixes de l'exercice sont désormais DÉRIVÉES : somme des
  //     budgets des pools déclarés FIXES (voir `absorption-rates` et le champ
  //     « Nature des charges » de `cost-pools`). Une saisie, deux usages.
  //
  //     Conséquence pour l'exploitant : une charge fixe se déclare en créant un
  //     pool qui la porte. Il n'y a plus d'autre chemin — et c'est ce qui rend
  //     l'écart impossible.
  // =========================================================================

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
      'On prévoit un VOLUME et on en dérive le chiffre d’affaires : une prévision saisie en CA laisserait une hausse de prix DGH masquer une perte de volume. Le budget validé ne se modifie JAMAIS : une évolution se saisit comme RÉVISION, à côté, sinon l’écart au budget devient invisible et c’est lui qu’on pilote. Le mois est le rang dans l’exercice, pas le mois civil : un exercice ouvert en juillet a son mois 1 en juillet.',
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
        values: values(CommercialSegment), valueLabels: FR.CommercialSegment,
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
        help: 'RANG dans l’exercice, pas mois civil : un exercice ouvert en juillet a son mois 1 en juillet. La borne suit la durée réelle de l’exercice, 12 mois pour un exercice de 12 mois.',
      },
      { name: 'forecastVolume', label: 'Volume prévu', type: 'number', required: true },
      {
        name: 'uom',
        label: 'Unité',
        type: 'enum',
        required: true,
        values: values(UnitOfMeasure), valueLabels: FR.UnitOfMeasure,
      },
      {
        name: 'priceReferenceType',
        label: 'Prix publié suivi',
        type: 'enum',
        required: true,
        values: values(PriceReferenceType), valueLabels: FR.PriceReferenceType,
        help: 'La publication à laquelle ce segment vend. Le prix et la devise en sont tirés : ils ne se saisissent plus',
      },
      // ⚠️ « Prix de référence » et « Devise » ONT QUITTÉ CE FORMULAIRE.
      //    Ils sont publiés au référentiel des prix administrés, et les
      //    recopier ici garantissait qu'un jour les deux différeraient : la
      //    DGH publie, personne ne reprend la prévision, et le chiffre
      //    d'affaires prévisionnel reste calé sur un prix que plus personne
      //    ne pratique. Seule la publication SUIVIE se déclare.
      {
        name: 'kind',
        label: 'Nature',
        type: 'enum',
        required: true,
        values: values(ForecastKind), valueLabels: FR.ForecastKind,
        help: 'BUDGET : validé par le DG, figé. REVISION : révision trimestrielle, à côté du budget.',
      },
      { name: 'version', label: 'Version', type: 'version' },
      { name: 'isCurrent', label: 'Version courante', type: 'boolean' },
      { name: 'notes', label: 'Notes', type: 'text' },
    ],
  },

  // ===========================================================================
  //  GROUPE — COÛTS ET ABSORPTION
  //
  //  Un pool avant les postes qui s’y absorbent (§ le bug du 21 août : le
  //  formulaire des postes ne pouvait pas viser un pool qui n’existait pas
  //  encore dans l’ordre précédent) ; le barème et le budget d’absorption
  //  ferment la chaîne.
  //
  //  ⚠️ VIENT APRÈS « Marché et pilotage », ET C'EST OBLIGÉ.
  //
  //     Le budget d'un pool (`absorption-rates`) DÉRIVE son assiette de la
  //     prévision de vente courante sur les segments qu'il couvre — lue
  //     directement en base par le déclencheur qui calcule le taux, pas par
  //     un champ de référence que ce registre pourrait suivre tout seul.
  //     Saisir un budget de pool avant la prévision de vente est REFUSÉ (voir
  //     la mise en garde d'`absorption-rates` ci-dessous) : le menu doit donc
  //     présenter `sales-forecasts` avant, jamais après.
  // ===========================================================================

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
      'L’assiette d’absorption est un VOLUME budgété : « au prorata du chiffre d’affaires » est REFUSÉ sur un pool actif, à la saisie comme au calcul. Le volume est ce que l’entreprise pilote ; le prix suit les publications DGH et le change : une assiette en valeur ferait bouger la charge fixe unitaire à chaque publication, sans qu’aucune charge n’ait changé. Seule l’imputation au volume reste ouverte : l’assiette vient de la prévision de vente, qui prévoit des volumes et non des rotations.',
    fields: [
      { name: 'code', label: 'Code', type: 'string', required: true, help: 'Sans espace ni accent, ex. ADM, FIN, HSE, INFO' },
      { name: 'label', label: 'Libellé', type: 'string', required: true, help: 'Le nom lu à l’écran, ex. « Administration », « Structure HSE »' },
      {
        name: 'allocationBasis',
        label: 'Base d’imputation',
        type: 'enum',
        required: true,
        values: values(AllocationBasis), valueLabels: FR.AllocationBasis,
      },
      {
        name: 'segments',
        label: 'Segments concernés',
        type: 'enumList',
        values: SEGMENTS, valueLabels: FR.CommercialSegment,
        help: 'Vide = tous les segments',
      },
      {
        name: 'variability',
        label: 'Nature des charges',
        type: 'enum',
        required: true,
        values: values(CostVariability), valueLabels: FR.CostVariability,
        help: 'FIXED : le budget de ce pool entre dans les charges fixes du point mort. VARIABLE : il s’absorbe au litre mais reste hors du point mort',
      },
      { name: 'currencyCode', label: 'Devise', type: 'reference', refTable: 'currencies', refKey: 'code', required: true },
      { name: 'isActive', label: 'Actif', type: 'boolean' },
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
      { name: 'code', label: 'Code', type: 'string', required: true, help: 'Sans espace ni accent, ex. TRANSPORT, DOUANE, FRAIS_ROUTE' },
      { name: 'label', label: 'Libellé', type: 'string', required: true, help: 'Le nom lu à l’écran, ex. « Transport routier », « Droits de douane »' },
      { name: 'category', label: 'Catégorie', type: 'string', required: true, help: 'Regroupement libre pour la lecture, ex. « Logistique », « Douane », « Financier »' },
      {
        name: 'nature',
        label: 'Nature',
        type: 'enum',
        required: true,
        values: values(CostNature), valueLabels: FR.CostNature,
        // Un poste redevenu DIRECT ne doit plus porter le pool ni l'assiette
        // saisis pendant qu'il était INDIRECT — sans quoi la ligne heurte
        // `chk_cost_posts_allocation_coherence` alors que la nature affichée
        // dit DIRECT, sans rien à l'écran pour l'expliquer.
        clearsOnValue: { DIRECT: ['costPoolId', 'allocationBasis'] },
      },
      { name: 'variability', label: 'Variabilité', type: 'enum', required: true, values: values(CostVariability), valueLabels: FR.CostVariability },
      {
        name: 'costPoolId',
        label: 'Pool de charges indirectes',
        type: 'reference',
        refTable: 'cost-pools',
        refKey: 'code',
        help: 'Exigé pour un poste INDIRECT, exclu pour un poste DIRECT : vidé automatiquement si vous choisissez DIRECT.',
      },
      { name: 'allocationBasis', label: 'Assiette d’absorption', type: 'enum', values: values(AllocationBasis), valueLabels: FR.AllocationBasis, help: 'Exigée pour un poste INDIRECT' },
      { name: 'displayOrder', label: 'Ordre d’affichage', type: 'integer', help: 'Rang dans les listes et les écrans : 10 apparaît avant 20. Numérotez de dix en dix pour pouvoir intercaler plus tard sans tout renuméroter. N’a aucun effet sur les calculs.' },
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
      'La valeur peut être exprimée AU LITRE (proportionnelle au volume) ou en FORFAIT (montant fixe pour l’affaire) : le système ramène l’une et l’autre au litre. Le barème appliqué est figé au moment du chiffrage : une grille révisée ne requalifie jamais un écart déjà justifié.',
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
        values: values(CostBasis), valueLabels: FR.CostBasis,
        help: 'PER_UNIT = au litre, proportionnel au volume · FIXED = forfait pour l’affaire',
      },
      { name: 'amount', label: 'Valeur', type: 'number', required: true, decimals: 4 },
      {
        name: 'uom',
        label: 'Unité de référence',
        type: 'enum',
        values: UOMS, valueLabels: FR.UnitOfMeasure,
        help: 'Obligatoire si la base est au litre : une valeur au litre sans unité n’est pas interprétable',
      },
      {
        name: 'currencyCode',
        label: 'Devise',
        type: 'reference',
        refTable: 'currencies',
        refKey: 'code',
        required: true,
      },
      { name: 'segment', label: 'Segment', type: 'enum', values: SEGMENTS, valueLabels: FR.CommercialSegment, help: 'Vide = tous' },
      {
        name: 'transportMode',
        label: 'Mode de transport',
        type: 'enum',
        values: TRANSPORT, valueLabels: FR.TransportMode,
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
          'Un franc de trop sur dix millions de litres fait dix millions : un pourcentage de ' +
          'tolérance ne protège de rien à cette échelle. Ne relever qu’après décision explicite.',
      },
      { name: 'effectiveFrom', label: 'En vigueur depuis', type: 'date', required: true },
      { name: 'effectiveTo', label: 'Jusqu’au', type: 'date' },
      { name: 'notes', label: 'Note', type: 'text' },
    ],
  },

  // =========================================================================
  //  Taux d'absorption — mutable, par exercice.
  // =========================================================================
  {
    key: 'absorption-rates',
    label: 'Budget des pools de charges',
    model: 'absorptionRate',
    nature: 'mutable',
    writeRoles: [UserRole.DG, UserRole.FINANCE_CFO],
    identity: ['costPoolId', 'fiscalYearId'],
    caution:
      'UNE SEULE VALEUR SE SAISIT ICI : le budget annuel du pool. Tout le reste en découle. L’assiette est la somme de vos PRÉVISIONS DE VENTE BUDGÉTÉES sur les segments que le pool couvre. La saisir une seconde fois garantissait qu’un jour les deux divergeraient. Le taux est la division des deux. Et si le pool est de nature FIXE, ce même budget forme les charges fixes du point mort : une saisie, deux usages, aucun écart possible. Conséquence : la prévision de vente se saisit AVANT le budget du pool, et l’ordre inverse est refusé.',
    fields: [
      {
        name: 'costPoolId',
        label: 'Pool de charges',
        type: 'reference',
        refTable: 'cost-pools',
        refKey: 'code',
        required: true,
      },
      {
        name: 'fiscalYearId',
        label: 'Exercice',
        type: 'reference',
        refTable: 'fiscal-years',
        refKey: 'year',
        required: true,
      },
      {
        name: 'budgetedAmount',
        label: 'Budget de l’exercice',
        type: 'number',
        required: true,
        help: 'Ce que ce regroupement de charges coûtera sur l’exercice, dans la devise du pool',
      },
      // ⚠️ `budgetedBase` et `baseUom` NE FIGURENT PLUS ICI.
      //    Elles sont calculées par la base à partir de la prévision de vente.
      //    Les rouvrir à la saisie recréerait la double écriture qu’on vient de
      //    supprimer — et le jour où les deux divergeraient, la charge au litre
      //    resterait calée sur un volume que plus personne n’attend.
      {
        name: 'version',
        label: 'Version',
        type: 'version',
        help: 'Une révision crée une nouvelle ligne, jamais un écrasement',
      },
      { name: 'isCurrent', label: 'Version courante', type: 'boolean' },
      { name: 'notes', label: 'Notes', type: 'text' },
    ],
  },

];

/**
 * GROUPES DU MENU PARAMÉTRAGE — un seul endroit qui les nomme.
 *
 * ⚠️ L'ORDRE ICI DOIT SUIVRE CELUI DE `REFERENTIALS`, PAS L'INVENTER.
 *
 *    Les groupes eux-mêmes sont ordonnés en dépendance : un référentiel ne
 *    vise jamais qu'un groupe déjà posé plus haut — sites avant tarifs de
 *    transport, prévision de vente avant budget des pools (le déclencheur qui
 *    calcule le taux d'absorption lit la prévision directement, sans champ de
 *    référence que ce fichier pourrait suivre tout seul). Cette liste ne fait
 *    que NOMMER les groupes déjà matérialisés par les bandeaux `GROUPE —` au
 *    fil de `REFERENTIALS` ; elle ne les réordonne pas.
 */
const REFERENTIAL_GROUPS: { title: string; keys: readonly string[] }[] = [
  {
    title: 'Fondations transverses',
    keys: ['settings', 'currencies', 'countries', 'fiscal-years', 'products'],
  },
  {
    title: 'Tiers et engagements commerciaux',
    keys: ['partners', 'contracts', 'supplier-prices', 'guarantees', 'crm-pipeline-stages'],
  },
  {
    title: 'Référentiel logistique',
    keys: [
      'sites',
      'site-requirement-types',
      'site-requirements',
      'vehicles',
      'drivers',
      'carrier-tariffs',
      'operation-types',
    ],
  },
  {
    title: 'HSE',
    keys: ['hse-checklists', 'hse-check-items'],
  },
  {
    title: 'Marché et pilotage',
    keys: [
      'fx-rates',
      'margin-thresholds',
      'ullage-tolerances',
      'administered-prices',
      'financing-rates',
      'sales-forecasts',
    ],
  },
  {
    title: 'Coûts et absorption',
    keys: ['cost-pools', 'cost-posts', 'cost-standards', 'absorption-rates'],
  },
];

const GROUP_BY_KEY: Map<string, string> = new Map(
  REFERENTIAL_GROUPS.flatMap((g) => g.keys.map((k) => [k, g.title] as const)),
);

/** Nom du groupe d'un référentiel, pour l'écran de paramétrage. */
export function groupLabel(key: string): string {
  return GROUP_BY_KEY.get(key) ?? 'Autres';
}

export function findReferential(key: string): ReferentialSpec | undefined {
  return REFERENTIALS.find((r) => r.key === key);
}
