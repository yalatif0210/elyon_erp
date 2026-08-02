/**
 * ===========================================================================
 *  JEU DE DONNÉES — LOT 1 : SOCLE & RÉFÉRENTIELS
 *  Réf. SPECIFICATIONS.md § 18
 *  Côte d'Ivoire · pivot USD · locale XOF (0 décimale)
 *
 *  Il ne s'agit pas de données décoratives : le jeu exerce les contraintes
 *  du lot — décomposition du prix à la pompe, cohérence du taux d'absorption,
 *  ordonnancement des seuils, dérivation du statut de conformité.
 *
 *  Idempotent : réexécutable sans dupliquer les données.
 * ===========================================================================
 */
import { hash } from '@node-rs/argon2';
import {
  AllocationBasis,
  CommercialSegment,
  ComplianceType,
  CostNature,
  CostVariability,
  CreditStatus,
  DocumentaryRegime,
  FieldRole,
  FxRateType,
  HseControlLevel,
  HseRiskLevel,
  OperationPhase,
  PartnerType,
  PriceReferenceType,
  PrismaClient,
  TransportMode,
  UnitOfMeasure,
  UserRole,
  VehicleType,
} from '@prisma/client';

const prisma = new PrismaClient();

const PIVOT = 'USD';
const LOCAL = 'XOF';
const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'ChangeMe!2026';

/** Argon2id aux paramètres OWASP (19 MiB, t=2, p=1). */
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** Cours USD/XOF retenu pour la démonstration. Calibrable et historisé. */
const USD_XOF = 605.42;

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function main(): Promise<void> {
  console.log('→ Seed lot 1 — socle & référentiels\n');
  const passwordHash = await hash(DEFAULT_PASSWORD, ARGON2);

  // =========================================================================
  //  1. RÉFÉRENTIEL MONÉTAIRE  (§ 9.2)
  //
  //  USD est pivot ET fonctionnelle : le sourcing, le fret et les cotations
  //  sont en dollars, c'est là que la marge se forme. XOF est la devise
  //  légale, sans subdivision en circulation (0 décimale) et arrimée à l'euro
  //  au taux fixe réglementaire de 655,957.
  // =========================================================================
  const currencies = [
    { code: 'USD', name: 'Dollar des États-Unis', symbol: '$', decimalPlaces: 2, isPivot: true, isFunctional: true, isLocal: false },
    { code: 'EUR', name: 'Euro', symbol: '€', decimalPlaces: 2, isPivot: false, isFunctional: false, isLocal: false },
    { code: 'XOF', name: 'Franc CFA (BCEAO)', symbol: 'FCFA', decimalPlaces: 0, isPivot: false, isFunctional: false, isLocal: true },
  ];
  for (const c of currencies) {
    await prisma.currency.upsert({ where: { code: c.code }, update: {}, create: c });
  }
  await prisma.currency.update({
    where: { code: 'XOF' },
    data: { pegCurrencyCode: 'EUR', pegRate: '655.95700000' },
  });
  console.log(`  ✓ ${currencies.length} devises — pivot ${PIVOT}, locale ${LOCAL} (0 décimale, arrimée EUR)`);

  // =========================================================================
  //  2. PARAMÈTRES SYSTÈME
  // =========================================================================
  const settings = [
    { key: 'PIVOT_CURRENCY', value: PIVOT, valueType: 'string', description: 'Devise pivot — dénominateur commun du risque et de la marge consolidée (§ 9.2).' },
    { key: 'LOCAL_CURRENCY', value: LOCAL, valueType: 'string', description: 'Devise légale du pays d\'exploitation.' },
    { key: 'FISCAL_COUNTRY', value: 'CI', valueType: 'string', description: 'Pays dont le régime fiscal s\'applique aux pièces émises (§ 9.4).' },
    { key: 'VAT_STANDARD_RATE', value: '18', valueType: 'number', description: 'Taux de TVA de droit commun, en pourcentage. À confirmer avec le conseil fiscal pour chaque régime produit.' },
    { key: 'FINANCING_RATE_ANNUAL_PCT', value: '10', valueType: 'number', description: 'Taux de financement annuel servant au calcul du coût de portage (§ 5.4). À CALER SUR LES CONDITIONS BANCAIRES RÉELLES.' },
    { key: 'DOC_EXPIRY_ALERT_DAYS', value: '60', valueType: 'number', description: 'Préavis d\'alerte avant expiration d\'une pièce de conformité (§ 6.6).' },
    { key: 'FISCAL_NORMALIZED_INVOICING', value: 'false', valueType: 'boolean', description: 'Transmission FNE à la DGI. À activer une fois l\'API communiquée (§ 9.5).' },
    { key: 'CURRENT_FISCAL_YEAR', value: '2026', valueType: 'number', description: 'Exercice courant — sélection du taux d\'absorption applicable (§ 14.2).' },
  ];
  for (const s of settings) {
    await prisma.systemSetting.upsert({ where: { key: s.key }, update: {}, create: s });
  }
  console.log(`  ✓ ${settings.length} paramètres système`);

  // =========================================================================
  //  3. UTILISATEURS — trois réalms distincts (§ 1.4)
  // =========================================================================
  const userDefs: Array<{ email: string; fullName: string; role: UserRole }> = [
    { email: 'dg@elyon-trading.example', fullName: 'Direction Générale', role: UserRole.DG },
    { email: 'assistante@elyon-trading.example', fullName: 'Assistante de Direction', role: UserRole.ASSISTANT_DG },
    { email: 'it@elyon-trading.example', fullName: 'Ingénieur Informatique', role: UserRole.IT_ADMIN },
    { email: 'ccoo@elyon-trading.example', fullName: 'Directeur Commercial & Opérations', role: UserRole.CCOO },
    { email: 'commercial@elyon-trading.example', fullName: 'Chargé de Clientèle & Devis', role: UserRole.SALES_REP },
    { email: 'logistique@elyon-trading.example', fullName: 'Coordinateur Logistique & Sourcing', role: UserRole.LOGISTICS_COORD },
    { email: 'cfo@elyon-trading.example', fullName: 'Directeur Financier', role: UserRole.FINANCE_CFO },
    { email: 'comptable@elyon-trading.example', fullName: 'Comptable / Chargé Recouvrement', role: UserRole.ACCOUNTANT },
  ];
  const users: Record<string, string> = {};
  for (const u of userDefs) {
    const created = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash, mustChangePassword: true },
    });
    users[u.role] = created.id;
  }

  // Terrain — réalm séparé, aucun accès aux données commerciales (§ 10.3).
  const fieldDefs = [
    { email: 'agent.terrain@elyon-trading.example', fullName: 'Agent d\'opération', role: FieldRole.FIELD_AGENT },
    { email: 'hse@elyon-trading.example', fullName: 'Contrôleur HSE', role: FieldRole.HSE_CONTROLLER },
  ];
  for (const f of fieldDefs) {
    await prisma.fieldUser.upsert({
      where: { email: f.email },
      update: {},
      create: { ...f, passwordHash, mustChangePassword: true },
    });
  }
  console.log(`  ✓ ${userDefs.length} comptes internes · ${fieldDefs.length} comptes terrain`);

  // =========================================================================
  //  4. TAUX DE CHANGE — historisés, jamais écrasés
  // =========================================================================
  const fxDefs = [
    { baseCurrencyCode: 'USD', quoteCurrencyCode: 'XOF', rate: String(USD_XOF), rateType: FxRateType.OFFICIAL, effectiveFrom: D('2026-07-01'), notes: 'Cours de référence — juillet 2026.' },
    { baseCurrencyCode: 'EUR', quoteCurrencyCode: 'XOF', rate: '655.95700000', rateType: FxRateType.PEG, effectiveFrom: D('2000-01-01'), notes: 'Parité fixe réglementaire — non révisable, protégée par trigger.' },
    { baseCurrencyCode: 'USD', quoteCurrencyCode: 'EUR', rate: '0.92300000', rateType: FxRateType.OFFICIAL, effectiveFrom: D('2026-07-01'), notes: null },
  ];
  for (const f of fxDefs) {
    await prisma.fxRate.upsert({
      where: {
        baseCurrencyCode_quoteCurrencyCode_rateType_effectiveFrom: {
          baseCurrencyCode: f.baseCurrencyCode,
          quoteCurrencyCode: f.quoteCurrencyCode,
          rateType: f.rateType,
          effectiveFrom: f.effectiveFrom,
        },
      },
      update: {},
      create: { ...f, enteredById: users[UserRole.FINANCE_CFO] },
    });
  }
  console.log(`  ✓ ${fxDefs.length} taux de change (dont 1 parité fixe protégée en écriture)`);

  // =========================================================================
  //  5. COTATIONS PLATTS  (§ 5.6)
  // =========================================================================
  const indexDefs = [
    { code: 'PLATTS_FOB_ROT_GASOIL_10PPM', name: 'Platts FOB Rotterdam Barges Gasoil 10 ppm', provider: 'PLATTS', location: 'ROTTERDAM', currencyCode: 'USD', uom: UnitOfMeasure.MT },
    { code: 'PLATTS_CIF_MED_HSFO_380', name: 'Platts CIF Med Cargoes HSFO 380 cSt', provider: 'PLATTS', location: 'MED', currencyCode: 'USD', uom: UnitOfMeasure.MT },
    { code: 'PLATTS_FOB_ROT_GASOLINE', name: 'Platts FOB Rotterdam Barges Premium Unleaded', provider: 'PLATTS', location: 'ROTTERDAM', currencyCode: 'USD', uom: UnitOfMeasure.MT },
  ];
  const indices: Record<string, string> = {};
  for (const i of indexDefs) {
    const created = await prisma.priceIndex.upsert({ where: { code: i.code }, update: {}, create: i });
    indices[i.code] = created.id;
  }

  const quotes = [
    { date: '2026-07-20', low: 672.5, high: 674.5 },
    { date: '2026-07-21', low: 675.0, high: 677.0 },
    { date: '2026-07-22', low: 679.25, high: 681.25 },
    { date: '2026-07-23', low: 676.75, high: 678.75 },
    { date: '2026-07-24', low: 680.0, high: 682.0 },
  ];
  for (const q of quotes) {
    await prisma.priceAssessment.upsert({
      where: {
        priceIndexId_quoteDate: {
          priceIndexId: indices['PLATTS_FOB_ROT_GASOIL_10PPM'],
          quoteDate: D(q.date),
        },
      },
      update: {},
      create: {
        priceIndexId: indices['PLATTS_FOB_ROT_GASOIL_10PPM'],
        quoteDate: D(q.date),
        low: q.low.toFixed(4),
        high: q.high.toFixed(4),
        // Le « mean of Platts » est la moyenne de la fourchette — vérifié par CHECK.
        mean: ((q.low + q.high) / 2).toFixed(4),
        sourceReference: 'Platts European Marketscan',
      },
    });
  }
  console.log(`  ✓ ${indexDefs.length} cotations Platts · ${quotes.length} relevés`);

  // =========================================================================
  //  6. PRODUITS
  // =========================================================================
  const productDefs = [
    { code: 'FUEL_180', name: 'Fuel Oil 180 cSt', referenceDensity15: '0.985000', viscosityCst: '180.000', flashPointC: '66.00', maxSulphurPct: '3.5000', uiColorToken: 'violet-400/70', defaultUom: UnitOfMeasure.MT, defaultPriceIndexId: indices['PLATTS_CIF_MED_HSFO_380'] },
    { code: 'MGO', name: 'Marine Gas Oil', referenceDensity15: '0.860000', viscosityCst: '4.500', flashPointC: '60.00', maxSulphurPct: '0.1000', uiColorToken: 'cyan-400/70', defaultUom: UnitOfMeasure.MT, defaultPriceIndexId: indices['PLATTS_FOB_ROT_GASOIL_10PPM'] },
    { code: 'DIESEL', name: 'Gasoil / Diesel', referenceDensity15: '0.840000', viscosityCst: '3.200', flashPointC: '55.00', maxSulphurPct: '0.0050', uiColorToken: 'amber-400/70', defaultUom: UnitOfMeasure.L, defaultPriceIndexId: indices['PLATTS_FOB_ROT_GASOIL_10PPM'] },
    { code: 'GASOLINE', name: 'Essence Super', referenceDensity15: '0.745000', viscosityCst: '0.600', flashPointC: '-43.00', maxSulphurPct: '0.0010', uiColorToken: 'emerald-400/70', defaultUom: UnitOfMeasure.L, defaultPriceIndexId: indices['PLATTS_FOB_ROT_GASOLINE'] },
  ];
  const products: Record<string, string> = {};
  for (const p of productDefs) {
    const created = await prisma.product.upsert({ where: { code: p.code }, update: {}, create: p });
    products[p.code] = created.id;
  }
  console.log(`  ✓ ${productDefs.length} produits`);

  // =========================================================================
  //  7. PRIX ADMINISTRÉS  (§ 5.3)
  //
  //  Simple référence consultable au moment de fixer un prix de vente.
  //  Aucune décomposition, aucune dérivation automatique : seuls comptent
  //  le prix de vente fixé et le prix d'achat réel.
  // =========================================================================
  const administeredDefs = [
    { referenceType: PriceReferenceType.PUMP, productCode: 'DIESEL', price: '815.0000', zone: 'ABIDJAN', publishedBy: 'DGH' },
    { referenceType: PriceReferenceType.PUMP, productCode: 'GASOLINE', price: '875.0000', zone: 'ABIDJAN', publishedBy: 'DGH' },
    { referenceType: PriceReferenceType.SIR, productCode: 'DIESEL', price: '700.0000', zone: null, publishedBy: 'SIR' },
  ];
  for (const a of administeredDefs) {
    const existing = await prisma.administeredPrice.findFirst({
      where: { referenceType: a.referenceType, productId: products[a.productCode], effectiveFrom: D('2026-07-01') },
    });
    if (existing) continue;
    await prisma.administeredPrice.create({
      data: {
        referenceType: a.referenceType,
        productId: products[a.productCode],
        zone: a.zone,
        price: a.price,
        currencyCode: 'XOF',
        uom: UnitOfMeasure.L,
        effectiveFrom: D('2026-07-01'),
        publishedBy: a.publishedBy,
        publicationReference: 'Publication de juillet 2026',
        recordedById: users[UserRole.FINANCE_CFO],
      },
    });
  }
  console.log(`  ✓ ${administeredDefs.length} prix administrés de référence (DGH, SIR)`);

  // =========================================================================
  //  8. TIERS  (§ 6.1, § 6.3, § 6.4)
  // =========================================================================
  const partnerDefs = [
    // --- Clients, par segment ---
    { code: 'CLI-001', legalName: 'Compagnie Maritime Atlantique SA', type: PartnerType.CLIENT, segment: CommercialSegment.MARITIME, countryCode: 'CI', creditLimit: '2500000.0000', paymentTermsDays: 45, creditStatus: CreditStatus.ACTIVE, taxpayerAccountNumber: 'CI-1804521 X', rccmNumber: 'CI-ABJ-2018-B-14027', taxRegime: 'Réel normal', isVatExempt: false, documentaryRegime: DocumentaryRegime.PROFORMA_THEN_FNE, billingCurrencyCode: 'XOF' },
    { code: 'CLI-002', legalName: 'Société Minière de l\'Ouest', type: PartnerType.CLIENT, segment: CommercialSegment.B2B, countryCode: 'CI', creditLimit: '5000000.0000', paymentTermsDays: 45, creditStatus: CreditStatus.ACTIVE, taxpayerAccountNumber: 'CI-0902117 W', rccmNumber: 'CI-ABJ-2009-B-03318', taxRegime: 'Réel normal', isVatExempt: false, documentaryRegime: DocumentaryRegime.PROFORMA_THEN_FNE, billingCurrencyCode: 'XOF' },
    { code: 'CLI-003', legalName: 'Station Service Cocody', type: PartnerType.CLIENT, segment: CommercialSegment.RETAIL, countryCode: 'CI', creditLimit: '400000.0000', paymentTermsDays: 0, creditStatus: CreditStatus.ACTIVE, taxpayerAccountNumber: 'CI-2011884 K', taxRegime: 'Réel simplifié', isVatExempt: false, documentaryRegime: DocumentaryRegime.SIMPLE_DIRECT, billingCurrencyCode: 'XOF' },
    { code: 'CLI-004', legalName: 'Coopérative des Pêcheurs de Sassandra', type: PartnerType.CLIENT, segment: CommercialSegment.MARITIME, countryCode: 'CI', creditLimit: '150000.0000', paymentTermsDays: 0, creditStatus: CreditStatus.WATCH, isVatExempt: true, vatExemptionReference: 'Attestation DGI n° 2026/EXO/0451 — navires de pêche', documentaryRegime: DocumentaryRegime.PROFORMA_THEN_SIMPLE, billingCurrencyCode: 'XOF' },
    // --- Fournisseurs — prépaiement avant livraison (§ 14.6) ---
    { code: 'SUP-SIR', legalName: 'Société Ivoirienne de Raffinage', type: PartnerType.SUPPLIER, segment: null, countryCode: 'CI', creditLimit: '0', paymentTermsDays: 0, supplierTermsDays: -5, creditStatus: CreditStatus.ACTIVE, billingCurrencyCode: 'XOF' },
    { code: 'SUP-GESTOCI', legalName: 'GESTOCI', type: PartnerType.SUPPLIER, segment: null, countryCode: 'CI', creditLimit: '0', paymentTermsDays: 0, supplierTermsDays: -3, creditStatus: CreditStatus.ACTIVE, billingCurrencyCode: 'XOF' },
    { code: 'SUP-MKT-01', legalName: 'Marketeur Agréé Côte d\'Ivoire', type: PartnerType.SUPPLIER, segment: null, countryCode: 'CI', creditLimit: '0', paymentTermsDays: 0, supplierTermsDays: -2, creditStatus: CreditStatus.ACTIVE, billingCurrencyCode: 'XOF' },
    // --- Transporteurs ---
    { code: 'CAR-001', legalName: 'Transports Routiers Ivoiriens', type: PartnerType.CARRIER, segment: null, countryCode: 'CI', creditLimit: '0', paymentTermsDays: 0, supplierTermsDays: 30, creditStatus: CreditStatus.ACTIVE, billingCurrencyCode: 'XOF' },
    { code: 'CAR-002', legalName: 'Bunker Barge Services', type: PartnerType.CARRIER, segment: null, countryCode: 'CI', creditLimit: '0', paymentTermsDays: 0, supplierTermsDays: 30, creditStatus: CreditStatus.ACTIVE, billingCurrencyCode: 'USD' },
    // --- Inspecteur ---
    { code: 'INS-001', legalName: 'SGS Inspection Services', type: PartnerType.INSPECTOR, segment: null, countryCode: 'CH', creditLimit: '0', paymentTermsDays: 0, supplierTermsDays: 30, creditStatus: CreditStatus.ACTIVE, billingCurrencyCode: 'USD' },
  ];
  const partners: Record<string, string> = {};
  for (const p of partnerDefs) {
    const created = await prisma.partner.upsert({
      where: { code: p.code },
      update: {},
      create: { ...p, creditLimitCurrencyCode: PIVOT },
    });
    partners[p.code] = created.id;
  }
  console.log(`  ✓ ${partnerDefs.length} tiers — 4 clients (3 segments), 3 fournisseurs, 2 transporteurs, 1 inspecteur`);

  // --- Sites : ce que voit l'application terrain (§ 10.3) ---
  const siteDefs = [
    { partnerCode: 'CLI-001', code: 'ABJ-TERM', name: 'Port d\'Abidjan — Terminal pétrolier', city: 'Abidjan', countryCode: 'CI', accessInstructions: 'Entrée porte 3. Badge portuaire obligatoire. Se présenter au poste de garde.', openingHours: 'Lun-Sam 06h00-18h00', safetyInstructions: 'EPI complet. Interdiction de téléphoner sur le quai. Point de rassemblement : quai nord.', defaultHseRiskLevel: HseRiskLevel.CRITICAL },
    { partnerCode: 'CLI-002', code: 'MINE-OUEST', name: 'Site minier — Ouest', city: 'Man', countryCode: 'CI', accessInstructions: 'Piste non revêtue sur 12 km. Prévenir 24 h à l\'avance.', openingHours: 'Lun-Ven 07h00-16h00', safetyInstructions: 'Induction sécurité site obligatoire. Vitesse limitée à 30 km/h.', defaultHseRiskLevel: HseRiskLevel.REINFORCED },
    { partnerCode: 'CLI-003', code: 'STA-COCODY', name: 'Station Cocody — Boulevard Latrille', city: 'Abidjan', countryCode: 'CI', accessInstructions: 'Livraison hors heures de pointe.', openingHours: '24h/24', safetyInstructions: 'Balisage de la zone de dépotage. Extincteur à portée.', defaultHseRiskLevel: HseRiskLevel.STANDARD },
  ];
  for (const s of siteDefs) {
    const { partnerCode, ...rest } = s;
    await prisma.partnerSite.upsert({
      where: { partnerId_code: { partnerId: partners[partnerCode], code: s.code } },
      update: {},
      create: { ...rest, partnerId: partners[partnerCode] },
    });
  }
  console.log(`  ✓ ${siteDefs.length} sites de livraison, avec consignes terrain`);

  // --- Comptes portail client — réalm séparé, cloisonné par partner_id ------
  const portalDefs = [
    { email: 'achats@maritime-atlantique.example', fullName: 'Responsable Achats CMA', partnerCode: 'CLI-001' },
    { email: 'approvisionnement@smo.example', fullName: 'Direction Approvisionnement SMO', partnerCode: 'CLI-002' },
  ];
  for (const p of portalDefs) {
    await prisma.portalUser.upsert({
      where: { email: p.email },
      update: {},
      create: {
        email: p.email,
        fullName: p.fullName,
        partnerId: partners[p.partnerCode],
        passwordHash,
        mustChangePassword: true,
      },
    });
  }
  console.log(`  ✓ ${portalDefs.length} comptes portail client`);

  // =========================================================================
  //  9. PRIX FOURNISSEURS — historisés, validés  (§ 6.3)
  // =========================================================================
  const supplierPriceDefs = [
    { supplierCode: 'SUP-SIR', productCode: 'DIESEL', unitPrice: '700.0000', pricingMethod: 'Prix administré SIR', sourceLabel: 'SIR', uom: UnitOfMeasure.L },
    { supplierCode: 'SUP-MKT-01', productCode: 'DIESEL', unitPrice: '755.0000', discountPct: '2.500000', pricingMethod: 'Prix de vente marketeur avec réduction négociée', sourceLabel: 'Marketeur', uom: UnitOfMeasure.L },
    { supplierCode: 'SUP-MKT-01', productCode: 'GASOLINE', unitPrice: '755.0000', discountPct: '2.000000', pricingMethod: 'Prix de vente marketeur avec réduction négociée', sourceLabel: 'Marketeur', uom: UnitOfMeasure.L },
  ];
  for (const sp of supplierPriceDefs) {
    const exists = await prisma.supplierPrice.findFirst({
      where: { supplierId: partners[sp.supplierCode], productId: products[sp.productCode], effectiveFrom: D('2026-07-01') },
    });
    if (exists) continue;
    await prisma.supplierPrice.create({
      data: {
        supplierId: partners[sp.supplierCode],
        productId: products[sp.productCode],
        unitPrice: sp.unitPrice,
        discountPct: sp.discountPct ?? null,
        currencyCode: 'XOF',
        uom: sp.uom,
        pricingMethod: sp.pricingMethod,
        sourceLabel: sp.sourceLabel,
        effectiveFrom: D('2026-07-01'),
        validatedById: users[UserRole.FINANCE_CFO],
        validatedAt: new Date('2026-07-01T09:00:00Z'),
      },
    });
  }
  console.log(`  ✓ ${supplierPriceDefs.length} prix fournisseurs validés et historisés`);

  // =========================================================================
  //  10. RÉPERTOIRE DES POSTES DE COÛTS  (§ 6.5)
  //
  //  NATURE et VARIABILITÉ sont deux axes indépendants. Noter les cas qui
  //  brisent la corrélation attendue : location de dépôt dédiée (directe et
  //  fixe), commissions bancaires (indirectes et variables).
  // =========================================================================
  const poolDefs = [
    { code: 'POOL_ADMIN', label: 'Administration et structure', allocationBasis: AllocationBasis.PER_VOLUME, segments: [], budget: 180_000_000, base: 12_000_000 },
    { code: 'POOL_HSE', label: 'HSE et conformité', allocationBasis: AllocationBasis.PER_VOLUME, segments: [], budget: 24_000_000, base: 12_000_000 },
    { code: 'POOL_MARITIME', label: 'Exploitation maritime et barge', allocationBasis: AllocationBasis.PER_VOLUME, segments: [CommercialSegment.MARITIME], budget: 96_000_000, base: 3_000_000 },
  ];
  const pools: Record<string, string> = {};
  for (const p of poolDefs) {
    const created = await prisma.costPool.upsert({
      where: { code: p.code },
      update: {},
      create: { code: p.code, label: p.label, allocationBasis: p.allocationBasis, segments: p.segments, currencyCode: 'XOF' },
    });
    pools[p.code] = created.id;

    // Taux d'absorption — dénominateur BUDGÉTÉ, jamais réalisé glissant (§ 14.2).
    const rate = p.budget / p.base;
    await prisma.absorptionRate.upsert({
      where: { costPoolId_fiscalYear_version: { costPoolId: created.id, fiscalYear: 2026, version: 1 } },
      update: {},
      create: {
        costPoolId: created.id,
        fiscalYear: 2026,
        budgetedAmount: p.budget.toFixed(4),
        budgetedBase: p.base.toFixed(6),
        baseUom: UnitOfMeasure.L,
        ratePerUnit: rate.toFixed(6),
        isCurrent: true,
        authorId: users[UserRole.FINANCE_CFO],
        notes: 'Budget initial 2026. Assiette issue de la prévision de vente (§ 14.3).',
      },
    });
  }

  const costPostDefs = [
    // --- Directs et variables : le gros du bataillon ---
    { code: 'ACHAT_PRODUIT', label: 'Achat produit', category: 'Approvisionnement', nature: CostNature.DIRECT, variability: CostVariability.VARIABLE, displayOrder: 10 },
    { code: 'CHARGEMENT', label: 'Chargement', category: 'Logistique', nature: CostNature.DIRECT, variability: CostVariability.VARIABLE, displayOrder: 20 },
    { code: 'DECHARGEMENT', label: 'Déchargement', category: 'Logistique', nature: CostNature.DIRECT, variability: CostVariability.VARIABLE, displayOrder: 21 },
    { code: 'MANUTENTION', label: 'Manutention', category: 'Logistique', nature: CostNature.DIRECT, variability: CostVariability.VARIABLE, displayOrder: 22 },
    { code: 'TRANSIT', label: 'Transit', category: 'Logistique', nature: CostNature.DIRECT, variability: CostVariability.VARIABLE, displayOrder: 23 },
    { code: 'FRAIS_PORTUAIRES', label: 'Frais portuaires', category: 'Logistique', nature: CostNature.DIRECT, variability: CostVariability.VARIABLE, displayOrder: 24 },
    { code: 'THROUGHPUT', label: 'Throughput', category: 'Logistique', nature: CostNature.DIRECT, variability: CostVariability.VARIABLE, displayOrder: 25 },
    { code: 'TRANSPORT', label: 'Transport', category: 'Logistique', nature: CostNature.DIRECT, variability: CostVariability.VARIABLE, displayOrder: 26 },
    { code: 'PEAGES', label: 'Péages', category: 'Logistique', nature: CostNature.DIRECT, variability: CostVariability.VARIABLE, displayOrder: 27 },
    { code: 'FRAIS_ROUTE', label: 'Frais de route', category: 'Logistique', nature: CostNature.DIRECT, variability: CostVariability.VARIABLE, displayOrder: 28 },
    { code: 'ATTENTE', label: 'Immobilisation / attente', category: 'Logistique', nature: CostNature.DIRECT, variability: CostVariability.VARIABLE, displayOrder: 29 },
    { code: 'INSPECTION', label: 'Inspection et contrôle', category: 'Qualité', nature: CostNature.DIRECT, variability: CostVariability.VARIABLE, displayOrder: 30 },
    { code: 'DOUANE', label: 'Droits de douane', category: 'Fiscal', nature: CostNature.DIRECT, variability: CostVariability.VARIABLE, displayOrder: 40 },
    { code: 'TAXES', label: 'Taxes sur produits', category: 'Fiscal', nature: CostNature.DIRECT, variability: CostVariability.VARIABLE, displayOrder: 41 },
    { code: 'PENALITES', label: 'Pénalités et demurrage', category: 'Exceptionnel', nature: CostNature.DIRECT, variability: CostVariability.VARIABLE, displayOrder: 50 },
    { code: 'PERTE_CHANGE', label: 'Perte de change', category: 'Financier', nature: CostNature.DIRECT, variability: CostVariability.VARIABLE, displayOrder: 60 },
    // --- Calculés par le système, non saisissables ---
    { code: 'PERTE_VOLUME', label: 'Perte de volume (ullage)', category: 'Exceptionnel', nature: CostNature.DIRECT, variability: CostVariability.VARIABLE, isSystemComputed: true, displayOrder: 51 },
    { code: 'PORTAGE_FINANCIER', label: 'Portage financier', category: 'Financier', nature: CostNature.DIRECT, variability: CostVariability.VARIABLE, isSystemComputed: true, displayOrder: 61 },
    // --- Direct MAIS fixe : brise la corrélation attendue ---
    { code: 'DEPOT_DEDIE', label: 'Location de dépôt dédié à un client', category: 'Logistique', nature: CostNature.DIRECT, variability: CostVariability.FIXED, displayOrder: 70 },
    // --- Indirects fixes : absorbés ---
    { code: 'ADMINISTRATION', label: 'Administration générale', category: 'Structure', nature: CostNature.INDIRECT, variability: CostVariability.FIXED, pool: 'POOL_ADMIN', allocationBasis: AllocationBasis.PER_VOLUME, displayOrder: 80 },
    { code: 'ASSURANCES', label: 'Assurances', category: 'Structure', nature: CostNature.INDIRECT, variability: CostVariability.FIXED, pool: 'POOL_ADMIN', allocationBasis: AllocationBasis.PER_VOLUME, displayOrder: 81 },
    { code: 'HSE_STRUCTURE', label: 'HSE — structure et équipements', category: 'HSE', nature: CostNature.INDIRECT, variability: CostVariability.FIXED, pool: 'POOL_HSE', allocationBasis: AllocationBasis.PER_VOLUME, displayOrder: 82 },
    { code: 'BARGE_EXPLOITATION', label: 'Barge — exploitation et amortissement', category: 'Maritime', nature: CostNature.INDIRECT, variability: CostVariability.FIXED, pool: 'POOL_MARITIME', allocationBasis: AllocationBasis.PER_VOLUME, displayOrder: 83 },
    // --- Indirect MAIS variable : brise la corrélation dans l'autre sens ---
    { code: 'COMMISSIONS_BANCAIRES', label: 'Commissions bancaires proportionnelles', category: 'Financier', nature: CostNature.INDIRECT, variability: CostVariability.VARIABLE, pool: 'POOL_ADMIN', allocationBasis: AllocationBasis.PER_REVENUE, displayOrder: 84 },
  ];
  for (const c of costPostDefs) {
    const { pool, ...rest } = c;
    await prisma.costPost.upsert({
      where: { code: c.code },
      update: {},
      create: { ...rest, costPoolId: pool ? pools[pool] : null },
    });
  }
  console.log(`  ✓ ${poolDefs.length} regroupements de charges · ${costPostDefs.length} postes de coûts`);
  console.log('      dont 2 calculés par le système (ullage, portage) et 2 cas hors corrélation nature/variabilité');

  // =========================================================================
  //  11. GRILLES DE SEUILS  (§ 5.4, § 8.3)
  // =========================================================================
  const thresholdDefs = [
    { segment: CommercialSegment.B2B, directFloor: '10.0000', minimumMargin: '30.0000' },
    { segment: CommercialSegment.RETAIL, directFloor: '10.0000', minimumMargin: '30.0000' },
    // MARITIME : volontairement absent — seuils à définir plutôt qu'inventés (§ 19).
  ];
  for (const t of thresholdDefs) {
    const exists = await prisma.marginThreshold.findFirst({
      where: { segment: t.segment, productId: null, effectiveFrom: D('2026-01-01') },
    });
    if (exists) continue;
    await prisma.marginThreshold.create({
      data: {
        segment: t.segment,
        directFloor: t.directFloor,
        minimumMargin: t.minimumMargin,
        currencyCode: 'XOF',
        uom: UnitOfMeasure.L,
        effectiveFrom: D('2026-01-01'),
        authorId: users[UserRole.DG],
      },
    });
  }
  console.log('  ✓ Seuils de marge : plancher direct 10 FCFA/L · seuil minimum 30 FCFA/L (B2B, Retail)');
  console.log('      MARITIME laissé vide — à définir (§ 19)');

  // Tolérance d'ullage — une ligne globale par défaut.
  // ⚠️ Le seuil critique est un PLACEHOLDER : à caler sur vos contrats de
  //    transport et votre police d'assurance (§ 8.3). Seuls les 0,2 % sont
  //    votre valeur actuelle.
  const ullageExists = await prisma.ullageTolerance.findFirst({
    where: { segment: null, transportMode: null, productId: null },
  });
  if (!ullageExists) {
    await prisma.ullageTolerance.create({
      data: {
        normalThresholdPct: '0.200000',
        alertThresholdPct: '0.200000',
        criticalThresholdPct: '0.400000',
        effectiveFrom: D('2026-01-01'),
        authorId: users[UserRole.DG],
      },
    });
  }
  console.log('  ✓ Tolérance d\'ullage : alerte > 0,2 % · critique > 0,4 % (placeholder à caler)');

  // =========================================================================
  //  12. TRANSPORT ET CONFORMITÉ  (§ 6.4)
  //  Une pièce expirée fait basculer le porteur en non conforme —
  //  statut DÉRIVÉ par trigger, jamais saisi.
  // =========================================================================
  const vehicleDefs = [
    { registration: 'CI-4821-AB', type: VehicleType.TANKER_TRUCK, carrierCode: 'CAR-001', brandModel: 'Renault Kerax citerne', year: 2019, capacity: '38000.000000', capacityUom: UnitOfMeasure.L, compartmentCount: 4 },
    { registration: 'CI-7734-CD', type: VehicleType.TANKER_TRUCK, carrierCode: 'CAR-001', brandModel: 'Mercedes Actros citerne', year: 2022, capacity: '42000.000000', capacityUom: UnitOfMeasure.L, compartmentCount: 5 },
    { registration: 'IMO-9284517', type: VehicleType.BUNKER_BARGE, carrierCode: 'CAR-002', brandModel: 'MT Atlantic Provider', year: 2015, capacity: '5000.000000', capacityUom: UnitOfMeasure.MT, compartmentCount: 6 },
  ];
  const vehicles: Record<string, string> = {};
  for (const v of vehicleDefs) {
    const { carrierCode, ...rest } = v;
    const created = await prisma.vehicle.upsert({
      where: { registration: v.registration },
      update: {},
      create: { ...rest, carrierId: partners[carrierCode], allowedProductIds: [products['DIESEL'], products['GASOLINE']] },
    });
    vehicles[v.registration] = created.id;
  }

  const driverDefs = [
    { fullName: 'Kouassi Aboubakar', employeeNumber: 'CH-014', carrierCode: 'CAR-001', idDocumentType: 'CNI', idDocumentRef: 'CI0114582736' },
    { fullName: 'Traoré Souleymane', employeeNumber: 'CH-027', carrierCode: 'CAR-001', idDocumentType: 'CNI', idDocumentRef: 'CI0209914471' },
  ];
  const drivers: Record<string, string> = {};
  for (const d of driverDefs) {
    const existing = await prisma.driver.findFirst({ where: { employeeNumber: d.employeeNumber } });
    const { carrierCode, ...rest } = d;
    const created = existing ?? (await prisma.driver.create({ data: { ...rest, carrierId: partners[carrierCode] } }));
    drivers[d.employeeNumber] = created.id;
  }

  const complianceDefs = [
    { type: ComplianceType.INSURANCE, reference: 'POL-2026-118842', issuingBody: 'NSIA Assurances', issueDate: D('2026-01-01'), expiryDate: D('2026-12-31'), vehicle: 'CI-4821-AB' },
    { type: ComplianceType.TECHNICAL_INSPECTION, reference: 'CT-2026-77120', issuingBody: 'SICTA', issueDate: D('2026-03-15'), expiryDate: D('2026-09-15'), vehicle: 'CI-4821-AB' },
    // Contrôle technique EXPIRÉ → véhicule non conforme, affectation refusée
    // sans dérogation du DG (invariant § 11.3).
    { type: ComplianceType.TECHNICAL_INSPECTION, reference: 'CT-2025-41008', issuingBody: 'SICTA', issueDate: D('2025-06-01'), expiryDate: D('2025-12-01'), vehicle: 'CI-7734-CD' },
    { type: ComplianceType.INSURANCE, reference: 'POL-2026-118843', issuingBody: 'NSIA Assurances', issueDate: D('2026-01-01'), expiryDate: D('2026-12-31'), vehicle: 'CI-7734-CD' },
    { type: ComplianceType.VESSEL_CERTIFICATE, reference: 'CLASS-2026-3391', issuingBody: 'Bureau Veritas', issueDate: D('2026-02-01'), expiryDate: D('2027-02-01'), vehicle: 'IMO-9284517' },
    { type: ComplianceType.DRIVER_LICENSE, reference: 'PC-CI-884120', issuingBody: 'Ministère des Transports', issueDate: D('2022-05-10'), expiryDate: D('2027-05-10'), driver: 'CH-014' },
    { type: ComplianceType.DRIVER_TRAINING, reference: 'ADR-2026-0071', issuingBody: 'Centre de formation ADR', issueDate: D('2026-01-20'), expiryDate: D('2029-01-20'), driver: 'CH-014' },
    { type: ComplianceType.DRIVER_LICENSE, reference: 'PC-CI-771904', issuingBody: 'Ministère des Transports', issueDate: D('2021-09-03'), expiryDate: D('2026-09-03'), driver: 'CH-027' },
    { type: ComplianceType.CUSTOMS_LICENSE, reference: 'AGR-CI-2024-118', issuingBody: 'Direction Générale des Douanes', issueDate: D('2024-01-01'), expiryDate: D('2027-01-01'), partner: 'CAR-001' },
  ];
  for (const c of complianceDefs) {
    const { vehicle, driver, partner, ...rest } = c;
    const exists = await prisma.complianceRecord.findFirst({ where: { reference: c.reference } });
    if (exists) continue;
    await prisma.complianceRecord.create({
      data: {
        ...rest,
        vehicleId: vehicle ? vehicles[vehicle] : null,
        driverId: driver ? drivers[driver] : null,
        partnerId: partner ? partners[partner] : null,
        recordedById: users[UserRole.LOGISTICS_COORD],
      },
    });
  }
  console.log(`  ✓ ${vehicleDefs.length} véhicules · ${driverDefs.length} chauffeurs · ${complianceDefs.length} pièces de conformité`);

  // =========================================================================
  //  13. MODÈLE DE CHECKLIST HSE  (§ 7.4)
  //  Extensible par paramétrage — aucun développement pour ajouter un point.
  // =========================================================================
  const tpl = await prisma.hseChecklistTemplate.upsert({
    where: { code: 'LIVRAISON_ROUTIERE_V1' },
    update: {},
    create: {
      code: 'LIVRAISON_ROUTIERE_V1',
      label: 'Livraison routière — checklist standard',
      applicableSegments: [CommercialSegment.B2B, CommercialSegment.RETAIL],
      applicableTransportModes: [TransportMode.TRUCK],
      applicableRiskLevels: [HseRiskLevel.STANDARD, HseRiskLevel.REINFORCED],
    },
  });

  const items = [
    { code: 'PREP_ORDRE', label: 'Ordre de mission, client, produit et volume confirmés', phase: OperationPhase.PREPARATION, level: HseControlLevel.MANDATORY, displayOrder: 1 },
    { code: 'PREP_MOYENS', label: 'Transporteur, véhicule et chauffeur confirmés et conformes', phase: OperationPhase.PREPARATION, level: HseControlLevel.BLOCKING, displayOrder: 2 },
    { code: 'HSE_PERMIS', label: 'Permis, assurance et contrôle technique en cours de validité', phase: OperationPhase.PRE_DEPARTURE, level: HseControlLevel.BLOCKING, requiresPhoto: true, displayOrder: 10 },
    { code: 'HSE_EPI', label: 'EPI complets portés par l\'équipe', phase: OperationPhase.PRE_DEPARTURE, level: HseControlLevel.BLOCKING, requiresPhoto: true, displayOrder: 11 },
    { code: 'HSE_EXTINCTEURS', label: 'Extincteurs présents, accessibles et vérifiés', phase: OperationPhase.PRE_DEPARTURE, level: HseControlLevel.BLOCKING, requiresPhoto: true, displayOrder: 12 },
    { code: 'HSE_KIT_DEVERSEMENT', label: 'Kit anti-déversement à bord', phase: OperationPhase.PRE_DEPARTURE, level: HseControlLevel.MANDATORY, requiresPhoto: true, displayOrder: 13 },
    { code: 'HSE_FUITE', label: 'Absence de fuite constatée', phase: OperationPhase.PRE_DEPARTURE, level: HseControlLevel.BLOCKING, displayOrder: 14 },
    { code: 'HSE_BRIEFING', label: 'Briefing sécurité réalisé', phase: OperationPhase.PRE_DEPARTURE, level: HseControlLevel.MANDATORY, requiresSignature: true, displayOrder: 15 },
    { code: 'CHG_AUTORISATION', label: 'Autorisation de chargement obtenue', phase: OperationPhase.LOADING, level: HseControlLevel.BLOCKING, displayOrder: 20 },
    { code: 'CHG_COMPARTIMENTS', label: 'Contrôle du produit et des compartiments', phase: OperationPhase.LOADING, level: HseControlLevel.BLOCKING, requiresPhoto: true, displayOrder: 21 },
    { code: 'CHG_JAUGEAGE', label: 'Jaugeage initial — volume et température relevés', phase: OperationPhase.LOADING, level: HseControlLevel.BLOCKING, requiresValue: true, valueLabel: 'Volume chargé (L) et température (°C)', displayOrder: 22 },
    { code: 'CHG_SCELLES', label: 'Scellés posés et numéros enregistrés', phase: OperationPhase.LOADING, level: HseControlLevel.BLOCKING, requiresPhoto: true, requiresValue: true, valueLabel: 'Numéros de scellés', displayOrder: 23 },
    { code: 'TRA_DEPART', label: 'Départ confirmé', phase: OperationPhase.TRANSPORT, level: HseControlLevel.MANDATORY, displayOrder: 30 },
    { code: 'TRA_ARRIVEE', label: 'Arrivée confirmée', phase: OperationPhase.TRANSPORT, level: HseControlLevel.MANDATORY, displayOrder: 31 },
    { code: 'LIV_SECURISATION', label: 'Site sécurisé et balisé', phase: OperationPhase.DELIVERY, level: HseControlLevel.BLOCKING, requiresPhoto: true, displayOrder: 40 },
    { code: 'LIV_SCELLES', label: 'Contrôle des scellés à l\'arrivée', phase: OperationPhase.DELIVERY, level: HseControlLevel.BLOCKING, requiresPhoto: true, displayOrder: 41 },
    { code: 'LIV_VOLUME', label: 'Volume livré et température relevés contradictoirement', phase: OperationPhase.DELIVERY, level: HseControlLevel.BLOCKING, requiresValue: true, valueLabel: 'Volume livré (L) et température (°C)', displayOrder: 42 },
    { code: 'LIV_BON', label: 'Bon de livraison signé par le client', phase: OperationPhase.DELIVERY, level: HseControlLevel.BLOCKING, requiresSignature: true, displayOrder: 43 },
    { code: 'CLO_HSE_FINAL', label: 'Contrôle HSE final', phase: OperationPhase.CLOSING, level: HseControlLevel.BLOCKING, displayOrder: 50 },
    { code: 'CLO_INCIDENT', label: 'Incident ou quasi-accident à déclarer ?', phase: OperationPhase.CLOSING, level: HseControlLevel.MANDATORY, displayOrder: 51 },
  ];
  for (const it of items) {
    await prisma.hseChecklistItem.upsert({
      where: { templateId_code: { templateId: tpl.id, code: it.code } },
      update: {},
      create: { ...it, templateId: tpl.id },
    });
  }
  console.log(`  ✓ 1 modèle de checklist HSE · ${items.length} points de contrôle`);

  // =========================================================================
  //  14. SÉQUENCES DE NUMÉROTATION
  //  month = 0 → séquence annuelle (OP-2026-000154)
  //  month 1-12 → séquence mensuelle (DEAL-2026-08-001)
  // =========================================================================
  const sequences = [
    { scope: 'OPERATION', month: 0 },
    { scope: 'CONTRACT', month: 0 },
    { scope: 'DEAL', month: 8 },
    { scope: 'PROFORMA', month: 8 },
    { scope: 'INVOICE_SIMPLE', month: 8 },
    { scope: 'INVOICE_FNE', month: 8 },
    { scope: 'CREDIT_NOTE', month: 8 },
    { scope: 'PO', month: 8 },
    { scope: 'MEASUREMENT', month: 8 },
  ];
  for (const s of sequences) {
    await prisma.numberSequence.upsert({
      where: { scope_year_month: { scope: s.scope, year: 2026, month: s.month } },
      update: {},
      create: { scope: s.scope, year: 2026, month: s.month, lastValue: 0 },
    });
  }
  console.log(`  ✓ ${sequences.length} séquences de numérotation\n`);

  // =========================================================================
  //  VÉRIFICATIONS DE SORTIE
  // =========================================================================
  const compliance = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT subject_kind, subject_code, subject_label, expired_count, expiring_count, is_compliant
       FROM v_transport_compliance
      WHERE subject_kind <> 'CARRIER' OR expired_count > 0
      ORDER BY is_compliant, subject_kind`,
  );
  console.log('  Conformité des moyens — v_transport_compliance :');
  console.table(compliance);

  const absorption = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT cp.code, cp.label, ar.budgeted_amount, ar.budgeted_base, ar.rate_per_unit
       FROM absorption_rates ar JOIN cost_pools cp ON cp.id = ar.cost_pool_id
      WHERE ar.is_current ORDER BY cp.code`,
  );
  console.log('\n  Taux d\'absorption 2026 (FCFA/L) — dénominateur BUDGÉTÉ :');
  console.table(absorption);

  const pump = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM resolve_administered_price('PUMP', $1::uuid, 'ABIDJAN', CURRENT_DATE)`,
    products['DIESEL'],
  );
  console.log('\n  Prix de référence gasoil — resolve_administered_price :');
  console.table(pump);

  console.log('\n→ Seed terminé.');
  console.log(`  Comptes créés avec le mot de passe « ${DEFAULT_PASSWORD} » — changement imposé à la 1re connexion.`);
}

main()
  .catch((error: unknown) => {
    console.error('Échec du seed :', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
