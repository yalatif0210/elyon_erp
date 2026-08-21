import { randomUUID } from 'node:crypto';
/**
 * ===========================================================================
 *  JEU DE DONNÉES — LOT 2 : CHAÎNE COMMERCIALE ET D'EXÉCUTION
 *
 *  Deux affaires qui couvrent les cas qui comptent :
 *
 *    DEAL-2026-08-001  marge complète 38,28 FCFA/L — au-dessus du seuil.
 *                      Approuvée par le CFO seul, exécutée jusqu'à la facture.
 *
 *    DEAL-2026-08-002  marge complète −1,72 FCFA/L — sous le seuil de 30.
 *                      Reste en attente de l'accord du DG : aucune opération
 *                      ne peut exister tant qu'elle n'est pas approuvée.
 *
 *  Ce jeu passe TOUS les invariants du lot 2 : prix d'achat sourcé, seuils de
 *  marge, verrou financier, verrou HSE avec séparation des tâches, verrou de
 *  conformité, arithmétique de facturation, extraction de TVA, calcul d'ullage.
 *  S'il passe, c'est que les règles ne se contredisent pas entre elles.
 *
 *  Idempotent : réexécutable sans dupliquer.
 * ===========================================================================
 */
import {
  AttachmentKind,
  ActorType,
  CommercialSegment,
  ContractStatus,
  DealStatus,
  DiscountMode,
  FieldRole,
  FiscalYearStatus,
  GeneratedDocumentKind,
  HseCheckOutcome,
  HseControlLevel,
  HseRiskLevel,
  InvoiceStatus,
  InvoiceType,
  MeasurementSource,
  OperationPhase,
  OperationStatus,
  PrismaClient,
  PurchaseOrderStatus,
  SignatoryKind,
  SourcingMode,
  SupplierInvoiceStatus,
  TaxRegime,
  TransportMode,
  UnitOfMeasure,
  UserRole,
} from '@prisma/client';

const prisma = new PrismaClient();

const USD_XOF = 605.42;
const XOF_TO_PIVOT = 1 / USD_XOF; // 1 FCFA en USD
const VAT_RATE = 18;

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const T = (iso: string) => new Date(iso);

/** Arrondi à 4 décimales, comme les colonnes Decimal(18,4). */
const r4 = (n: number) => Number(n.toFixed(4));

/**
 * TVA extraite d'un total toutes taxes — jamais ajoutée.
 *     TVA = Total × taux ÷ (100 + taux)
 */
const extractVat = (total: number, rate: number) => r4((total * rate) / (100 + rate));

async function main(): Promise<void> {
  console.log('\n→ Seed lot 2 — chaîne commerciale et exécution\n');

  // --- Références du lot 1 -------------------------------------------------
  const [dg, cfo, ccoo, sales, logistics] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { role: UserRole.DG } }),
    prisma.user.findFirstOrThrow({ where: { role: UserRole.FINANCE_CFO } }),
    prisma.user.findFirstOrThrow({ where: { role: UserRole.CCOO } }),
    prisma.user.findFirstOrThrow({ where: { role: UserRole.SALES_REP } }),
    prisma.user.findFirstOrThrow({ where: { role: UserRole.LOGISTICS_COORD } }),
  ]);
  const [agent, hseController] = await Promise.all([
    prisma.fieldUser.findFirstOrThrow({ where: { role: FieldRole.FIELD_AGENT } }),
    prisma.fieldUser.findFirstOrThrow({ where: { role: FieldRole.HSE_CONTROLLER } }),
  ]);
  const client = await prisma.partner.findUniqueOrThrow({ where: { code: 'CLI-002' } });
  const sir = await prisma.partner.findUniqueOrThrow({ where: { code: 'SUP-SIR' } });
  const carrier = await prisma.partner.findUniqueOrThrow({ where: { code: 'CAR-001' } });
  const diesel = await prisma.product.findUniqueOrThrow({ where: { code: 'DIESEL' } });
  const site = await prisma.site.findUniqueOrThrow({ where: { code: 'MINE-OUEST' } });
  const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { registration: 'CI-4821-AB' } });
  const driver = await prisma.driver.findFirstOrThrow({ where: { employeeNumber: 'CH-014' } });

  // =========================================================================
  //  0. EXERCICE COMPTABLE COURANT ET SON TAUX DE FINANCEMENT
  //
  //  ⚠️ SANS CET EXERCICE, TOUT CALCUL DE MARGE EST REFUSÉ (§ 14.2).
  //
  //     MarginService.conditionsDeLExercice() refuse de calculer plutôt que
  //     de porter le coût de portage à taux zéro — un choix délibéré, voir
  //     son en-tête. Semer cet exercice n'est pas la même chose que semer un
  //     taux d'absorption : l'un est une condition de financement que le
  //     directeur financier a réellement déclarée pour boucler ce jeu de
  //     données (la lettre de crédit à 12 %, D13 de l'audit du 9 août),
  //     l'autre serait une charge de pool qu'aucun budget ne fonde encore.
  //     Toujours 12 %, jamais 10 % : la valeur qui figure dans les scripts
  //     de recette (cloture_lot2.py, recette_dettes.py) après leur propre
  //     correction du même défaut D13.
  // =========================================================================
  const fiscalYear = await prisma.fiscalYear.upsert({
    where: { year: 2026 },
    update: {},
    create: {
      year: 2026,
      label: 'Exercice 2026',
      startsOn: D('2026-01-01'),
      endsOn: D('2026-12-31'),
      status: FiscalYearStatus.OPEN,
      isCurrent: true,
      authorId: cfo.id,
    },
  });
  const existingRate = await prisma.financingRate.findFirst({
    where: { fiscalYearId: fiscalYear.id, isCurrent: true },
  });
  if (!existingRate) {
    await prisma.financingRate.create({
      data: {
        fiscalYearId: fiscalYear.id,
        annualRatePct: '12.0000',
        carryingDaysPerYear: 360,
        source: 'Lettre de crédit bancaire, taux négocié pour l’exercice 2026',
        version: 1,
        isCurrent: true,
        authorId: cfo.id,
      },
    });
  }
  console.log('  ✓ Exercice 2026 courant — taux de financement 12 % l’an (lettre de crédit)');

  // =========================================================================
  //  1. PRIX FOURNISSEUR VALIDÉ PAR LE DG
  //     Le prix d'achat d'un deal ne peut venir que d'ici (§ 5.4).
  // =========================================================================
  let supplierPrice = await prisma.supplierPrice.findFirst({
    where: { supplierId: sir.id, productId: diesel.id, effectiveFrom: D('2026-08-01') },
  });
  if (!supplierPrice) {
    supplierPrice = await prisma.supplierPrice.create({
      data: {
        supplierId: sir.id,
        productId: diesel.id,
        unitPrice: '700.0000',
        currencyCode: 'XOF',
        uom: UnitOfMeasure.L,
        pricingMethod: 'Prix administré SIR',
        sourceLabel: 'SIR',
        effectiveFrom: D('2026-08-01'),
        validatedById: dg.id, // DG SEUL — vérifié par trigger
        validatedAt: T('2026-08-01T08:00:00Z'),
      },
    });
  }
  console.log(`  ✓ Prix fournisseur SIR validé par le DG : ${supplierPrice.unitPrice} FCFA/L`);

  // =========================================================================
  //  2. CONTRAT-CADRE  (facultatif — un deal peut exister sans)
  // =========================================================================
  const contract = await prisma.contract.upsert({
    where: { reference: 'CTR-2026-014' },
    update: {},
    create: {
      reference: 'CTR-2026-014',
      clientId: client.id,
      title: 'Approvisionnement gasoil, site minier de l’Ouest',
      status: ContractStatus.ACTIVE,
      segment: CommercialSegment.B2B,
      paymentTermsDays: 45,
      currencyCode: 'XOF',
      committedVolume: '360000.000000',
      volumeUom: UnitOfMeasure.L,
      startDate: D('2026-01-01'),
      endDate: D('2026-12-31'),
      ownerId: ccoo.id,
      notes: 'Douze rotations mensuelles de 30 000 litres.',
    },
  });
  console.log('  ✓ Contrat-cadre CTR-2026-014 — 12 rotations de 30 000 L');

  // =========================================================================
  //  3. DEAL 1 — au-dessus des deux seuils, exécuté jusqu'à la facture
  //
  //     Vente        800,00
  //     − Achat      700,00   ← prix fournisseur validé
  //     − Directes    44,72   ← transport 30 + manutention 5 + portage 9,72
  //     ─────────────────────
  //     Marge directe 55,28   → plancher 10   ✔
  //     − Indirectes  17,00   ← admin 15 + HSE 2
  //     ─────────────────────
  //     Marge complète 38,28  → seuil 30      ✔  approbation CFO seule
  // =========================================================================
  const VOLUME = 30_000;
  const SALE = 800;
  const PURCHASE = 700;
  const CARRY = r4((PURCHASE * 0.1 * 50) / 360); // 50 jours de cycle : 9,7222

  const directCharges = { transport: 30, handling: 5, carrying: CARRY };
  /**
   * Charges directes HORS PORTAGE — c'est ce que porte `estimatedDirectCharges`.
   * Le portage a sa propre colonne et son propre calcul : l'inclure ici le
   * ferait entrer deux fois dans la marge.
   */
  const directExCarryPerUnit = r4(directCharges.transport + directCharges.handling);
  const directPerUnit = r4(directExCarryPerUnit + CARRY);
  const indirectPerUnit = 17;
  const directMargin = r4(SALE - PURCHASE - directPerUnit);
  const fullMargin = r4(directMargin - indirectPerUnit);

  const deal1 = await prisma.deal.upsert({
    where: { reference: 'DEAL-2026-08-001' },
    // Les estimations sont réalignées à chaque passage : le seed reste la
    // référence du chiffrage même si une exécution antérieure les a laissées
    // dans un autre état.
    update: {
      estimatedDirectCharges: r4(directExCarryPerUnit * VOLUME).toFixed(4),
      estimatedIndirectCharges: r4(indirectPerUnit * VOLUME).toFixed(4),
      estimatedCarryingCost: r4(CARRY * VOLUME).toFixed(4),
    },
    create: {
      reference: 'DEAL-2026-08-001',
      contractId: contract.id,
      clientId: client.id,
      siteId: site.id,
      productId: diesel.id,
      ownerId: sales.id,
      status: DealStatus.IN_EXECUTION,
      segment: CommercialSegment.B2B,
      contractedVolume: `${VOLUME}.000000`,
      uom: UnitOfMeasure.L,
      transportMode: TransportMode.TRUCK,
      deliveryLocation: 'Site minier, Man',
      targetDeliveryDate: D('2026-08-12'),
      currencyCode: 'XOF',
      fxRateToPivot: XOF_TO_PIVOT.toFixed(8),
      fxRateDate: D('2026-08-01'),
      unitSalePrice: `${SALE}.0000`,
      saleAmount: (SALE * VOLUME).toFixed(4),
      saleAmountPivot: r4(SALE * VOLUME * XOF_TO_PIVOT).toFixed(4),
      supplierPriceId: supplierPrice.id,
      unitPurchasePrice: `${PURCHASE}.0000`,
      purchaseAmount: (PURCHASE * VOLUME).toFixed(4),
      estimatedDirectCharges: r4(directExCarryPerUnit * VOLUME).toFixed(4),
      estimatedIndirectCharges: r4(indirectPerUnit * VOLUME).toFixed(4),
      estimatedCarryingCost: r4(CARRY * VOLUME).toFixed(4),
      estimatedDirectMargin: directMargin.toFixed(4),
      estimatedFullMargin: fullMargin.toFixed(4),
      // Approbation par le CFO SEUL : les deux seuils sont franchis.
      creditApprovedById: cfo.id,
      creditApprovedAt: T('2026-08-03T09:00:00Z'),
      creditExposureAtApproval: '0.0000',
      documentaryRegime: 'PROFORMA_THEN_FNE',
    },
  });
  console.log(`  ✓ DEAL-2026-08-001 — marge directe ${directMargin} / complète ${fullMargin} FCFA/L`);
  console.log('      approuvée par le CFO seul, sans intervention du DG');

  // =========================================================================
  //  4. DEAL 2 — sous le seuil de 30 : bloqué en attente du DG
  // =========================================================================
  const SALE2 = 760;
  const directMargin2 = r4(SALE2 - PURCHASE - directPerUnit); // 15,28
  const fullMargin2 = r4(directMargin2 - indirectPerUnit); // −1,72

  await prisma.deal.upsert({
    where: { reference: 'DEAL-2026-08-002' },
    update: {
      estimatedDirectCharges: r4(directExCarryPerUnit * 15000).toFixed(4),
      estimatedIndirectCharges: r4(indirectPerUnit * 15000).toFixed(4),
      estimatedCarryingCost: r4(CARRY * 15000).toFixed(4),
    },
    create: {
      reference: 'DEAL-2026-08-002',
      clientId: client.id,
      productId: diesel.id,
      ownerId: sales.id,
      // NON approuvée : le trigger refuserait l'approbation sans accord du DG.
      status: DealStatus.PENDING_DG_APPROVAL,
      segment: CommercialSegment.B2B,
      contractedVolume: '15000.000000',
      uom: UnitOfMeasure.L,
      transportMode: TransportMode.TRUCK,
      deliveryLocation: 'Site minier, Man',
      currencyCode: 'XOF',
      fxRateToPivot: XOF_TO_PIVOT.toFixed(8),
      unitSalePrice: `${SALE2}.0000`,
      saleAmount: (SALE2 * 15000).toFixed(4),
      supplierPriceId: supplierPrice.id,
      unitPurchasePrice: `${PURCHASE}.0000`,
      purchaseAmount: (PURCHASE * 15000).toFixed(4),
      // Charges estimées au chiffrage : aucune opération n'existe encore.
      estimatedDirectCharges: r4(directExCarryPerUnit * 15000).toFixed(4),
      estimatedIndirectCharges: r4(indirectPerUnit * 15000).toFixed(4),
      estimatedCarryingCost: r4(CARRY * 15000).toFixed(4),
      estimatedDirectMargin: directMargin2.toFixed(4),
      estimatedFullMargin: fullMargin2.toFixed(4),
      documentaryRegime: 'PROFORMA_THEN_FNE',
    },
  });
  console.log(`  ✓ DEAL-2026-08-002 — marge complète ${fullMargin2} FCFA/L : en attente du DG`);

  // =========================================================================
  //  5. OPÉRATION — n'existe que parce que le deal 1 est approuvé
  // =========================================================================
  const operation = await prisma.operation.upsert({
    where: { reference: 'OP-2026-000001' },
    update: {},
    create: {
      reference: 'OP-2026-000001',
      dealId: deal1.id,
      status: OperationStatus.DRAFT,
      sourcingMode: SourcingMode.BACK_TO_BACK,
      plannedVolume: `${VOLUME}.000000`,
      uom: UnitOfMeasure.L,
      transportMode: TransportMode.TRUCK,
      originLocation: 'Dépôt SIR, Abidjan',
      destinationSiteId: site.id,
      destinationLocation: 'Site minier, Man',
      plannedLoadingDate: D('2026-08-10'),
      hseRiskLevel: HseRiskLevel.REINFORCED,
      fieldAgentId: agent.id,
      coordinatorId: logistics.id,
    },
  });

  // ⚠️ AMORCE LE COMPTEUR DE RÉFÉRENCE — SANS QUOI LA PREMIÈRE OPÉRATION
  //    CRÉÉE PAR L'API RENTRE EN COLLISION AVEC CELLE-CI.
  //
  //    La référence ci-dessus est écrite en dur, hors de ReferenceService : la
  //    séquence `number_sequences` (scope OP, année 2026) ignore donc qu'elle
  //    est prise. La première opération réellement créée ensuite calcule
  //    `last_value = 1` et retombe sur EXACTEMENT « OP-2026-000001 » -
  //    conflit d'unicité, trouvé en recette (tests/recette/recette_types_hse.py,
  //    section D). Idempotent comme le reste du seed : un second passage ne
  //    fait qu'écraser la même valeur.
  await prisma.numberSequence.upsert({
    where: { scope_year_month: { scope: 'OP', year: 2026, month: 0 } },
    update: { lastValue: 1 },
    create: { scope: 'OP', year: 2026, month: 0, lastValue: 1 },
  });

  // Le type porté est ce qui donne à l'opération ses contrôles HSE : sans lui,
  // aucune checklist ne s'y attache et la base refuse de la faire avancer.
  const typeRoute = await prisma.operationType.findUnique({ where: { code: 'ROUTE' } });
  if (!typeRoute) {
    throw new Error(
      'Type d’opération « ROUTE » absent : la migration types_operation n’a pas été appliquée.',
    );
  }
  await prisma.operationTypeAssignment.upsert({
    where: {
      operationId_operationTypeId: { operationId: operation.id, operationTypeId: typeRoute.id },
    },
    update: {},
    create: { operationId: operation.id, operationTypeId: typeRoute.id, sequence: 1 },
  });

  await prisma.purchaseOrder.upsert({
    where: { reference: 'PO-2026-08-001' },
    update: {},
    create: {
      reference: 'PO-2026-08-001',
      operationId: operation.id,
      supplierId: sir.id,
      status: PurchaseOrderStatus.CONFIRMED,
      orderedVolume: `${VOLUME}.000000`,
      uom: UnitOfMeasure.L,
      unitPrice: `${PURCHASE}.0000`,
      totalAmount: (PURCHASE * VOLUME).toFixed(4),
      currencyCode: 'XOF',
      supplierPriceId: supplierPrice.id,
      expectedDate: D('2026-08-10'),
      issuedById: logistics.id,
      issuedAt: T('2026-08-05T10:00:00Z'),
    },
  });

  // Affectation : véhicule et chauffeur CONFORMES — sinon le verrou refuse.
  const existingAssignment = await prisma.operationAssignment.findUnique({
    where: { operationId: operation.id },
  });
  if (!existingAssignment) {
    await prisma.operationAssignment.create({
      data: {
        operationId: operation.id,
        carrierId: carrier.id,
        vehicleId: vehicle.id,
        driverId: driver.id,
        freightCost: '900000.0000',
        currencyCode: 'XOF',
        assignedById: logistics.id,
        assignedAt: T('2026-08-06T08:00:00Z'),
      },
    });
  }
  console.log('  ✓ OP-2026-000001 — moyens conformes affectés');

  // =========================================================================
  //  6. CONTRÔLES HSE — séparation des tâches
  //
  //     L'AGENT renseigne, le CONTRÔLEUR valide. Un même utilisateur ne peut
  //     pas faire les deux sur un point bloquant : le trigger le refuse.
  // =========================================================================
  const template = await prisma.hseChecklistTemplate.findFirstOrThrow({
    where: { code: 'LIVRAISON_ROUTIERE_V1' },
  });

  let check = await prisma.operationHseCheck.findUnique({
    where: { operationId_phase: { operationId: operation.id, phase: OperationPhase.PRE_DEPARTURE } },
  });
  if (!check) {
    check = await prisma.operationHseCheck.create({
      data: {
        operationId: operation.id,
        templateId: template.id,
        templateVersion: template.version,
        phase: OperationPhase.PRE_DEPARTURE,
      },
    });

    // ⚠️ UN POINT EXIGEANT UNE PHOTO EN REÇOIT UNE.
    //
    //    Un verrou refuse d'enregistrer un tel point sans cliché : le
    //    contrôleur HSE valide à distance, sur pièces, et sans photo il n'a
    //    rien à examiner. Les écarter aurait laissé l'opération SANS AUCUN
    //    point de contrôle — que le verrou HSE refuse tout autant, et à juste
    //    titre : une validation qui ne s'appuie sur rien n'est pas une
    //    validation.
    //
    //    Le jeu de démonstration dépose donc une pièce jointe reconnaissable :
    //    empreinte nulle, clé de stockage préfixée « demo/ ». Elle ne prétend
    //    pas être une preuve, elle occupe la place de celle qu'un agent
    //    fournira.
    const items = await prisma.hseChecklistItem.findMany({
      where: { templateId: template.id, phase: OperationPhase.PRE_DEPARTURE },
      orderBy: { displayOrder: 'asc' },
    });

    for (const item of items) {
      // ⚠️ TROIS TEMPS, PARCE QUE C'EST L'ORDRE RÉEL DU TERRAIN.
      //
      //    Le point s'ouvre EN ATTENTE, la photo arrive, puis le point se
      //    conclut. Le verrou n'accepte un résultat définitif que si le cliché
      //    est déjà là — et il a raison : l'inverse permettrait de conclure
      //    d'abord et de fournir la preuve ensuite, ou jamais.
      //
      //    Écrire directement PASSED était impossible, et ce n'est pas une
      //    limite du jeu de données : c'est la règle qui s'applique à l'agent.
      const recorded = await prisma.operationHseCheckItem.create({
        data: {
          checkId: check.id,
          itemId: item.id,
          level: item.level,
          // ⚠️ LA PROVENANCE SE FIGE SUR LE POINT, PAS SUR LA CHECKLIST.
          //    Un modèle révisé plus tard ne doit pas réécrire ce qui a été
          //    opposé à l'agent ce jour-là. Le jeu de données ne la posait pas.
          sourceTemplateId: template.id,
          sourceTemplateVersion: template.version,
          outcome: HseCheckOutcome.PENDING,
          recordedByFieldUserId: agent.id, // renseigné par l'AGENT
          recordedAt: T('2026-08-10T06:30:00Z'),
          deviceTimestamp: T('2026-08-10T06:29:47Z'),
          latitude: '5.3200000',
          longitude: '-4.0100000',
          // Un point qui attend un relevé ne se conclut pas sans lui.
          recordedValue: item.requiresValue ? 'Conforme, jeu de démonstration' : null,
        },
      });

      if (item.requiresPhoto) {
        await prisma.operationAttachment.create({
          data: {
            clientUuid: randomUUID(),
            checkItemId: recorded.id,
            storageKey: `demo/hse/${recorded.id}.jpg`,
            mimeType: 'image/jpeg',
            sizeBytes: 1,
            sha256: '0'.repeat(64),
            caption: 'Jeu de démonstration, cliché non fourni',
            capturedAt: T('2026-08-10T06:30:00Z'),
            deviceTimestamp: T('2026-08-10T06:29:47Z'),
          },
        });
      }

      if (item.requiresSignature) {
        await prisma.operationAttachment.create({
          data: {
            clientUuid: randomUUID(),
            checkItemId: recorded.id,
            kind: AttachmentKind.SIGNATURE,
            storageKey: `demo/hse/${recorded.id}-signature.png`,
            mimeType: 'image/png',
            sizeBytes: 1,
            sha256: '0'.repeat(64),
            caption: 'Jeu de démonstration, signature non fournie',
            capturedAt: T('2026-08-10T06:30:00Z'),
            deviceTimestamp: T('2026-08-10T06:29:47Z'),
          },
        });
      }

      await prisma.operationHseCheckItem.update({
        where: { id: recorded.id },
        data: { outcome: HseCheckOutcome.PASSED },
      });
    }

    // Validation par le CONTRÔLEUR — à distance, mode normal (§ 7.2).
    await prisma.operationHseCheck.update({
      where: { id: check.id },
      data: {
        validatedByFieldUserId: hseController.id,
        validatedAt: T('2026-08-10T06:45:00Z'),
        validatedRemotely: true,
      },
    });
  }

  await prisma.operation.update({
    where: { id: operation.id },
    data: {
      hseValidatedById: hseController.id,
      hseValidatedAt: T('2026-08-10T06:45:00Z'),
    },
  });

  const blockingCount = await prisma.operationHseCheckItem.count({
    where: { check: { operationId: operation.id }, level: HseControlLevel.BLOCKING },
  });
  console.log(`  ✓ Checklist HSE validée à distance — ${blockingCount} contrôles bloquants satisfaits`);

  // =========================================================================
  //  DOCUMENTS ET SIGNATURES (§ 12) — AVANT LA CLÔTURE
  //
  //  Le verrou de clôture (prisma/sql/36_cloture_operation.sql) refuse toute
  //  opération qui passerait CLOSED sans un rapport d'exécution ET un bon de
  //  livraison, tous deux scellés — sans exception, y compris pour ce jeu de
  //  démonstration. D'où leur création ICI, avant l'écriture du statut, et
  //  non après comme un simple journal des pièces déjà closes le laisserait
  //  penser.
  //
  //  Le binaire n'est jamais en base : clé de stockage et empreinte SHA-256.
  //  Le bon de livraison est SIGNÉ par le chauffeur et le client puis SCELLÉ
  //  — à partir de là il ne se modifie plus, et sa correction passerait par
  //  une pièce « annule et remplace ».
  // =========================================================================
  const sha = (seed: string) => seed.padEnd(64, '0').slice(0, 64);

  const operationReport = await prisma.generatedDocument.upsert({
    where: { reference: 'RAP-2026-00001' },
    update: {},
    create: {
      kind: GeneratedDocumentKind.OPERATION_REPORT,
      reference: 'RAP-2026-00001',
      dealId: deal1.id,
      operationId: operation.id,
      storageKey: 'documents/2026/08/RAP-2026-00001.pdf',
      sizeBytes: BigInt(102_400),
      sha256: sha('r4pp0rtdex3cut10n'),
      authenticityToken: 'demo-rap-2026-00001-authenticity-token',
      generatedById: logistics.id,
    },
  });
  const existingReportSignature = await prisma.signature.count({
    where: { documentId: operationReport.id },
  });
  if (existingReportSignature === 0) {
    await prisma.signature.create({
      data: {
        documentId: operationReport.id,
        kind: SignatoryKind.FIELD_USER,
        fieldUserId: agent.id,
        signatoryName: agent.fullName,
        signatoryCapacity: 'Agent d’opération — clôture du chargement',
        deviceTimestamp: T('2026-08-12T16:50:00Z'),
        latitude: '7.4125000',
        longitude: '-7.5539000',
      },
    });
    // Scellé APRÈS signature, comme le bon de livraison ci-dessous.
    await prisma.generatedDocument.update({
      where: { id: operationReport.id },
      data: { isSealed: true, sealedAt: T('2026-08-12T16:55:00Z') },
    });
  }
  console.log('  ✓ Rapport d’exécution signé par l’agent terrain, puis scellé');

  const deliveryNote = await prisma.generatedDocument.upsert({
    where: { reference: 'BL-2026-00001' },
    update: {},
    create: {
      kind: GeneratedDocumentKind.DELIVERY_NOTE,
      reference: 'BL-2026-00001',
      dealId: deal1.id,
      operationId: operation.id,
      storageKey: 'documents/2026/08/BL-2026-00001.pdf',
      sizeBytes: BigInt(184_320),
      sha256: sha('a1b2c3d4e5f6'),
      authenticityToken: 'demo-bl-2026-00001-authenticity-token',
      generatedById: logistics.id,
    },
  });

  const existingSignatures = await prisma.signature.count({
    where: { documentId: deliveryNote.id },
  });
  if (existingSignatures === 0) {
    await prisma.signature.createMany({
      data: [
        {
          documentId: deliveryNote.id,
          kind: SignatoryKind.DRIVER,
          driverId: driver.id,
          signatoryName: driver.fullName,
          signatoryCapacity: 'Chauffeur — remise de la marchandise',
          deviceTimestamp: T('2026-08-12T14:32:11Z'),
          latitude: '7.4125000',
          longitude: '-7.5539000',
        },
        {
          documentId: deliveryNote.id,
          kind: SignatoryKind.CLIENT_REPRESENTATIVE,
          signatoryName: 'Koffi N’Guessan',
          signatoryCapacity: 'Chef de dépôt — réception pour le compte du client',
          idDocumentRef: 'CNI CI-0034128',
          signatureStorageKey: 'signatures/2026/08/BL-2026-00001-client.png',
          signatureSha256: sha('9f8e7d6c5b4a'),
          deviceTimestamp: T('2026-08-12T14:33:40Z'),
          latitude: '7.4125000',
          longitude: '-7.5539000',
        },
      ],
    });
    // Scellé APRÈS signature : un bon de livraison non signé n'est pas opposable.
    await prisma.generatedDocument.update({
      where: { id: deliveryNote.id },
      data: { isSealed: true, sealedAt: T('2026-08-12T14:35:00Z') },
    });
  }
  console.log('  ✓ Bon de livraison signé par le chauffeur et le client, puis scellé');

  // --- Les deux pièces étant scellées, la clôture est acceptée -------------
  await prisma.operation.update({
    where: { id: operation.id },
    data: {
      status: OperationStatus.CLOSED,
      actualLoadingDate: D('2026-08-10'),
      actualDischargeDate: D('2026-08-12'),
      billOfLadingDate: D('2026-08-10'),
      closedAt: T('2026-08-12T17:00:00Z'),
    },
  });

  await prisma.operationStatusTransition.createMany({
    data: [
      { operationId: operation.id, fromStatus: OperationStatus.DRAFT, toStatus: OperationStatus.HSE_PREPARATION, actorType: ActorType.FIELD_USER, actorId: agent.id },
      { operationId: operation.id, fromStatus: OperationStatus.HSE_PREPARATION, toStatus: OperationStatus.PLANNED, actorType: ActorType.FIELD_USER, actorId: hseController.id, reason: 'Contrôles HSE validés' },
      { operationId: operation.id, fromStatus: OperationStatus.PLANNED, toStatus: OperationStatus.LOADING, actorType: ActorType.FIELD_USER, actorId: agent.id },
      { operationId: operation.id, fromStatus: OperationStatus.LOADING, toStatus: OperationStatus.CLOSED, actorType: ActorType.FIELD_USER, actorId: agent.id },
    ],
    skipDuplicates: true,
  });

  // =========================================================================
  //  7. RELEVÉ DE MESURE — contrôle opérationnel et HSE (§ 8)
  //
  //     Chargé 30 000, livré 29 925 → écart 0,25 %, au-dessus du seuil
  //     d'alerte de 0,2 %. Acquitté par le CCOO avec motif.
  //     Ce relevé NE COMMANDE PAS la facturation : les volumes facturés
  //     sont saisis à l'édition de la pièce.
  // =========================================================================
  const LOADED = 30_000;
  const DISCHARGED = 29_925;
  const ullagePct = r4(((LOADED - DISCHARGED) / LOADED) * 100); // 0,25

  const existingMeasurement = await prisma.measurementRecord.findUnique({
    where: { reference: 'MR-2026-08-001' },
  });
  if (!existingMeasurement) {
    await prisma.measurementRecord.create({
      data: {
        reference: 'MR-2026-08-001',
        operationId: operation.id,
        source: MeasurementSource.CONTRADICTORY,
        isAuthoritative: true,
        measurementDate: D('2026-08-12'),
        loadedVolume15: `${LOADED}.000000`,
        dischargedVolume15: `${DISCHARGED}.000000`,
        observedVolume: '30120.000000',
        observedTempC: '31.40',
        uom: UnitOfMeasure.L,
        measuredDensity15: '0.841200',
        sulphurPct: '0.0043',
        waterAndSedimentPct: '0.0500',
        isOffSpec: false,
        ullageVariancePct: ullagePct.toFixed(6),
        alertThresholdPct: '0.200000',
        criticalThresholdPct: '0.400000',
        ullageAlertTriggered: true,
        ullageCriticalTriggered: false,
        ullageAckById: ccoo.id,
        ullageAckAt: T('2026-08-13T09:00:00Z'),
        ullageAckReason:
          'Écart de 0,25 % conforme aux pertes constatées sur cet axe en saison chaude. Scellés intacts au déchargement.',
        enteredByFieldUserId: agent.id,
        validatedAt: T('2026-08-12T18:00:00Z'),
      },
    });
  }
  console.log(`  ✓ Relevé contradictoire — écart ${ullagePct} % · alerte acquittée par le CCOO`);

  // =========================================================================
  //  8. COÛTS RÉELS
  // =========================================================================
  const costPosts = await prisma.costPost.findMany({
    where: { code: { in: ['ACHAT_PRODUIT', 'TRANSPORT', 'MANUTENTION', 'PORTAGE_FINANCIER'] } },
  });
  const byCode = Object.fromEntries(costPosts.map((c) => [c.code, c]));

  if ((await prisma.operationCostLine.count({ where: { operationId: operation.id } })) === 0) {
    await prisma.operationCostLine.createMany({
      data: [
        { operationId: operation.id, costPostId: byCode['ACHAT_PRODUIT'].id, description: 'Gasoil, SIR', supplierId: sir.id, estimatedAmount: (PURCHASE * VOLUME).toFixed(4), actualAmount: (PURCHASE * VOLUME).toFixed(4), currencyCode: 'XOF', fxRateToPivot: XOF_TO_PIVOT.toFixed(8), incurredAt: D('2026-08-10') },
        { operationId: operation.id, costPostId: byCode['TRANSPORT'].id, description: 'Transport routier Abidjan-Man', supplierId: carrier.id, estimatedAmount: '900000.0000', actualAmount: '900000.0000', currencyCode: 'XOF', fxRateToPivot: XOF_TO_PIVOT.toFixed(8), incurredAt: D('2026-08-12') },
        { operationId: operation.id, costPostId: byCode['MANUTENTION'].id, description: 'Manutention au chargement', estimatedAmount: '150000.0000', actualAmount: '150000.0000', currencyCode: 'XOF', fxRateToPivot: XOF_TO_PIVOT.toFixed(8), incurredAt: D('2026-08-10') },
        { operationId: operation.id, costPostId: byCode['PORTAGE_FINANCIER'].id, description: 'Portage, 50 jours à 10 % l’an', estimatedAmount: r4(CARRY * VOLUME).toFixed(4), actualAmount: r4(CARRY * VOLUME).toFixed(4), currencyCode: 'XOF', fxRateToPivot: XOF_TO_PIVOT.toFixed(8), isSystemComputed: true, incurredAt: D('2026-08-12') },
      ],
    });
  }

  // =========================================================================
  //  9. FACTURE FOURNISSEUR — prépayée AVANT livraison (§ 14.6)
  // =========================================================================
  const supplierTotal = PURCHASE * VOLUME;
  await prisma.supplierInvoice.upsert({
    where: { supplierId_reference: { supplierId: sir.id, reference: 'SIR-2026-08-4417' } },
    update: {},
    create: {
      reference: 'SIR-2026-08-4417',
      supplierId: sir.id,
      dealId: deal1.id, // rattachement direct au dossier
      status: SupplierInvoiceStatus.PAID,
      amount: supplierTotal.toFixed(4),
      currencyCode: 'XOF',
      fxRateToPivot: XOF_TO_PIVOT.toFixed(8),
      amountPivot: r4(supplierTotal * XOF_TO_PIVOT).toFixed(4),
      paidAmount: supplierTotal.toFixed(4),
      paidAmountPivot: r4(supplierTotal * XOF_TO_PIVOT).toFixed(4),
      prepaidAmount: supplierTotal.toFixed(4),
      prepaidAmountPivot: r4(supplierTotal * XOF_TO_PIVOT).toFixed(4),
      prepaidAt: D('2026-08-08'), // deux jours AVANT le chargement
      // ⚠️ APURER, C'EST CONSTATER LA CONTREPARTIE — PAS SEULEMENT DATER.
      //
      //    Une contrainte exige que le montant apuré couvre l'avance : une
      //    avance datée « soldée » sans montant constaté est précisément le
      //    trou par lequel de l'argent sort sans contrepartie. Le jeu de
      //    données posait la date et laissait le montant à zéro.
      settledAmount: supplierTotal.toFixed(4),
      settledAt: D('2026-08-10'),
      vatRatePct: VAT_RATE.toFixed(3),
      vatAmount: extractVat(supplierTotal, VAT_RATE).toFixed(4),
      invoiceDate: D('2026-08-08'),
      recordedById: cfo.id,
    },
  });
  console.log('  ✓ Facture fournisseur prépayée le 08/08, marchandise reçue le 10/08');

  // Seconde facture — AVANCE NON APURÉE. Argent sorti, prestation non encore
  // constatée : c'est ce poste qui pèse au BFR (§ 14.6), et il doit se voir.
  const freightTotal = 900_000;
  await prisma.supplierInvoice.upsert({
    where: { supplierId_reference: { supplierId: carrier.id, reference: 'TRP-2026-08-0219' } },
    update: {},
    create: {
      reference: 'TRP-2026-08-0219',
      supplierId: carrier.id,
      dealId: deal1.id,
      status: SupplierInvoiceStatus.RECEIVED,
      amount: freightTotal.toFixed(4),
      currencyCode: 'XOF',
      fxRateToPivot: XOF_TO_PIVOT.toFixed(8),
      amountPivot: r4(freightTotal * XOF_TO_PIVOT).toFixed(4),
      paidAmount: freightTotal.toFixed(4),
      paidAmountPivot: r4(freightTotal * XOF_TO_PIVOT).toFixed(4),
      prepaidAmount: freightTotal.toFixed(4),
      prepaidAmountPivot: r4(freightTotal * XOF_TO_PIVOT).toFixed(4),
      prepaidAt: D('2026-08-09'),
      settledAt: null, // ← non apurée : elle immobilise encore la trésorerie
      vatRatePct: VAT_RATE.toFixed(3),
      vatAmount: extractVat(freightTotal, VAT_RATE).toFixed(4),
      invoiceDate: D('2026-08-09'),
      recordedById: cfo.id,
    },
  });
  console.log('  ✓ Avance de fret non apurée — trésorerie immobilisée depuis le 09/08');

  // =========================================================================
  //  10. FACTURATION CLIENT
  //
  //      Volume et prix SAISIS à l'édition — ils peuvent différer du deal.
  //
  //      29 925 L × 800          =  23 940 000
  //      − remise commerciale 2 %=  −  478 800
  //      ─────────────────────────────────────
  //      TOTAL FACTURE            =  23 461 200
  //      dont TVA (18 % extraite) =   3 578 827
  // =========================================================================
  const billedVolume = DISCHARGED;
  const gross = billedVolume * SALE;
  const discount = r4(gross * 0.02);
  const total = r4(gross - discount);
  const vat = extractVat(total, VAT_RATE);

  await prisma.invoice.upsert({
    where: { number: 'PRO-2026-08-0001' },
    update: {},
    create: {
      number: 'PRO-2026-08-0001',
      type: InvoiceType.PROFORMA,
      status: InvoiceStatus.ISSUED,
      dealId: deal1.id,
      partnerId: client.id,
      billedVolume: `${VOLUME}.000000`,
      uom: UnitOfMeasure.L,
      unitPrice: `${SALE}.0000`,
      currencyCode: 'XOF',
      grossAmount: (SALE * VOLUME).toFixed(4),
      totalAmount: (SALE * VOLUME).toFixed(4),
      isVatApplicable: false,
      printedTaxRegime: TaxRegime.TTC,
      documentCurrencyCode: 'XOF',
      documentTotalAmount: (SALE * VOLUME).toFixed(4),
      issueDate: D('2026-08-04'),
      issuedById: sales.id,
      issuedAt: T('2026-08-04T11:00:00Z'),
    },
  });

  const proforma = await prisma.invoice.findUniqueOrThrow({ where: { number: 'PRO-2026-08-0001' } });

  await prisma.invoice.upsert({
    where: { number: 'FNE-2026-08-0001' },
    update: {},
    create: {
      number: 'FNE-2026-08-0001',
      type: InvoiceType.FNE,
      status: InvoiceStatus.ISSUED,
      dealId: deal1.id,
      partnerId: client.id,
      sourceProformaId: proforma.id,
      // Volume et prix saisis : le volume facturé suit le livré, mais rien
      // ne l'y oblige — c'est une saisie.
      billedVolume: `${billedVolume}.000000`,
      uom: UnitOfMeasure.L,
      unitPrice: `${SALE}.0000`,
      currencyCode: 'XOF',
      grossAmount: gross.toFixed(4),
      discountMode: DiscountMode.PERCENTAGE,
      discountValue: '2.0000',
      discountAmount: discount.toFixed(4),
      totalAmount: total.toFixed(4),
      isVatApplicable: true,
      vatRatePct: VAT_RATE.toFixed(3),
      vatAmount: vat.toFixed(4),
      printedTaxRegime: TaxRegime.TTC,
      fxRateToPivot: XOF_TO_PIVOT.toFixed(8),
      totalAmountPivot: r4(total * XOF_TO_PIVOT).toFixed(4),
      documentCurrencyCode: 'XOF',
      documentGrossAmount: gross.toFixed(4),
      documentTotalAmount: total.toFixed(4),
      documentVatAmount: vat.toFixed(4),
      issueDate: D('2026-08-13'),
      dueDate: D('2026-09-27'),
      authenticityToken: 'QR-FNE-2026-08-0001-B7E2',
      issuedById: cfo.id,
      issuedAt: T('2026-08-13T10:00:00Z'),
    },
  });
  console.log(`  ✓ Proforma puis FNE — total ${total.toLocaleString('fr-FR')} FCFA dont TVA ${vat.toLocaleString('fr-FR')}`);

  await prisma.dealStatusTransition.createMany({
    data: [
      { dealId: deal1.id, fromStatus: DealStatus.DRAFT, toStatus: DealStatus.QUOTED, actorType: ActorType.INTERNAL_USER, actorId: sales.id },
      { dealId: deal1.id, fromStatus: DealStatus.QUOTED, toStatus: DealStatus.PENDING_RISK, actorType: ActorType.INTERNAL_USER, actorId: sales.id },
      { dealId: deal1.id, fromStatus: DealStatus.PENDING_RISK, toStatus: DealStatus.APPROVED, actorType: ActorType.INTERNAL_USER, actorId: cfo.id, reason: 'Marge et encours conformes' },
      { dealId: deal1.id, fromStatus: DealStatus.APPROVED, toStatus: DealStatus.IN_EXECUTION, actorType: ActorType.INTERNAL_USER, actorId: logistics.id },
    ],
    skipDuplicates: true,
  });

  // =========================================================================
  //  Vérifications de sortie
  // =========================================================================
  console.log('\n  Chaîne de marge — DEAL-2026-08-001 (FCFA/L) :');
  console.table([
    { poste: 'Prix de vente', valeur: SALE },
    { poste: '− Prix d’achat', valeur: -PURCHASE },
    { poste: '− Charges directes', valeur: -directPerUnit },
    { poste: '= MARGE DIRECTE', valeur: directMargin },
    { poste: '− Charges indirectes', valeur: -indirectPerUnit },
    { poste: '= MARGE COMPLÈTE', valeur: fullMargin },
  ]);

  const exposure = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT partner_code, credit_limit_pivot, receivables_pivot, commitments_pivot,
            exposure_pivot, utilisation_pct
       FROM v_partner_credit_exposure WHERE exposure_pivot > 0 ORDER BY partner_code`,
  );
  console.log('\n  En-cours crédit (devise pivot) :');
  console.table(exposure);

  console.log('\n→ Seed lot 2 terminé.');
}

main()
  .catch((error: unknown) => {
    console.error('Échec du seed lot 2 :', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
