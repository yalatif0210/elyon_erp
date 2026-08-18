import {
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import {
  DocumentType,
  FieldRole,
  GeneratedDocumentKind,
  HseCheckOutcome,
  HseControlLevel,
  HseEventType,
  HseRiskLevel,
  HseSeverity,
  OperationPhase,
  OperationStatus,
  Prisma,
  SignatoryKind,
  TransportMode,
  UnitOfMeasure,
} from '@prisma/client';
import { FieldRoles, Realm, RequireRealm } from '../common/auth/realm';
import { PrismaService } from '../common/prisma/prisma.service';
import { FieldScopeService } from './field-scope.service';

// ===========================================================================
//  VUE TERRAIN — OBJET DE TRANSPORT DÉDIÉ (SPECIFICATIONS.md § 10.3)
//
//  POURQUOI UN OBJET DÉDIÉ PLUTÔT QU'UN FILTRAGE
//
//  La tablette part sur site. Elle se perd, se vole, se déverrouille par
//  dessus l'épaule de son porteur. Ce qui la protège n'est pas ce qu'elle
//  affiche : c'est ce que le serveur lui a envoyé. Un masquage — champ retiré
//  à l'affichage, `delete` sur l'objet, `omit` avant sérialisation — laisse la
//  donnée traverser le réseau, atterrir dans le cache HTTP, le journal de
//  requêtes et le stockage local. Elle est alors sur l'appareil, quoi qu'en
//  dise l'écran.
//
//  Un filtrage a posteriori a un second défaut, plus grave parce qu'il est
//  silencieux : il DÉFAILLE PAR OUVERTURE. Le jour où `Operation` gagne un
//  champ `realizedMargin`, un `{ ...operation }` l'expose sans que personne
//  n'ait rien écrit ; une liste de champs interdits, elle, ne connaît pas le
//  nouveau venu. La règle s'inverse ici :
//
//    1. les interfaces ci-dessous énumèrent les champs AUTORISÉS — un champ
//       ajouté au modèle demain n'y figure pas, donc ne sort pas ;
//    2. l'objet est construit CHAMP PAR CHAMP — jamais de spread d'un objet
//       Prisma, qui rendrait la promesse du point 1 purement décorative ;
//    3. les `select` ne demandent que ce qui est rendu — ce qui n'est pas
//       chargé ne peut fuiter ni par erreur de code, ni par journal, ni par
//       message d'exception.
//
//  Le cloisonnement par agent obéit à la même logique : l'affectation est une
//  condition du `WHERE`, jamais une vérification après lecture. Une opération
//  qui n'est pas la sienne n'est pas « lue puis refusée » — elle n'existe pas
//  pour lui, et deviner un identifiant ne mène nulle part.
//
//  CE QUI N'EST JAMAIS DANS CE FICHIER : prix, marges, coûts d'achat, coût de
//  transport, plafond de crédit, encours, impayés, factures, statut
//  d'encaissement, fournisseur, prix fournisseur, référence de l'affaire.
//  Aucun `select` ne les demande. Aucune interface ne les déclare.
// ===========================================================================

// ---------------------------------------------------------------------------
//  Objets de transport
// ---------------------------------------------------------------------------

/** Pourquoi l'opération figure dans MA liste — l'écran ne doit pas le deviner. */
export type FieldListingReason = 'ASSIGNED' | 'AWAITING_HSE_VALIDATION';

/** Ligne de la liste de travail. Rien d'autre que de quoi choisir et se rendre. */
export interface FieldOperationSummary {
  id: string;
  reference: string;
  status: OperationStatus;
  transportMode: TransportMode;
  plannedVolume: number;
  uom: UnitOfMeasure;
  plannedLoadingDate: Date | null;
  actualLoadingDate: Date | null;
  originLocation: string;
  destinationLocation: string;
  clientLegalName: string;
  siteName: string | null;
  productName: string;
  hseRiskLevel: HseRiskLevel;
  listedBecause: FieldListingReason;
  /** Phases dont la checklist est renseignée et attend le contrôleur HSE. */
  checksAwaitingValidation: OperationPhase[];
}

/** Spécifications produit — ce que l'agent confronte au relevé, pas un tarif. */
export interface FieldProductView {
  code: string;
  name: string;
  /** Nulle pour un produit SERVICE (barge) — sans objet hors mesure volumétrique. */
  referenceDensity15: number | null;
  viscosityCst: number | null;
  flashPointC: number | null;
  maxSulphurPct: number | null;
}

/**
 * Moyens affectés. L'agent contrôle physiquement le camion et le chauffeur
 * qui se présentent : sans ces trois identifiants, la checklist d'accès n'a
 * rien à confronter. Le coût du fret, lui, reste hors de l'objet.
 */
export interface FieldMeansView {
  carrierName: string | null;
  vehicleRegistration: string | null;
  vehicleIdentifier: string | null;
  driverName: string | null;
  driverPhone: string | null;
}

/** Avancement d'une checklist. Le détail des points reste sur /api/field/hse. */
export interface FieldChecklistView {
  id: string;
  phase: OperationPhase;
  validatedAt: Date | null;
  itemsTotal: number;
  itemsPending: number;
  blockingPending: number;
}

export interface FieldMeasurementView {
  measurementDate: Date;
  loadedVolume15: number;
  dischargedVolume15: number;
  uom: UnitOfMeasure;
  /** La température est obligatoire à la saisie (§ 10.4) : elle est rendue. */
  observedTempC: number | null;
  isOffSpec: boolean;
}

export interface FieldIncidentView {
  reference: string;
  type: HseEventType;
  severity: HseSeverity;
  occurredAt: Date;
  title: string;
}

/** Pièce produite pour l'opération — ordre de mission, BL, relevé, rapport. */
export interface FieldDocumentView {
  id: string;
  kind: GeneratedDocumentKind;
  reference: string;
  mimeType: string;
  generatedAt: Date;
  isSealed: boolean;
  /**
   * Natures de signataires déjà enregistrées — pas leur identité.
   *
   * Sert à l'écran de clôture à savoir QUI reste à faire signer sans devoir
   * ouvrir la pièce : un bon de livraison qui porte déjà `FIELD_USER` n'a
   * plus besoin que du représentant du client (§ 12.2).
   */
  signatureKinds: SignatoryKind[];
}

/** Pièce du client visible du terrain — FDS, agrément, autorisation. */
export interface FieldReferenceDocumentView {
  id: string;
  type: DocumentType;
  title: string;
  mimeType: string;
  expiryDate: Date | null;
}

export interface FieldOperationDetail {
  id: string;
  reference: string;
  status: OperationStatus;
  transportMode: TransportMode;
  plannedVolume: number;
  uom: UnitOfMeasure;
  plannedLoadingDate: Date | null;
  actualLoadingDate: Date | null;
  actualDischargeDate: Date | null;
  originLocation: string;
  destinationLocation: string;
  /** Raison sociale seule : ni code tiers, ni segment, ni régime, ni crédit. */
  clientLegalName: string;
  site: { id: string; name: string; city: string | null } | null;
  product: FieldProductView;
  means: FieldMeansView | null;
  hse: {
    riskLevel: HseRiskLevel;
    validatedAt: Date | null;
    checks: FieldChecklistView[];
  };
  measurements: FieldMeasurementView[];
  incidents: FieldIncidentView[];
  documents: FieldDocumentView[];
  referenceDocuments: FieldReferenceDocumentView[];
}

/** Contact sur place. Seuls ceux explicitement marqués visibles du terrain. */
export interface FieldSiteContactView {
  fullName: string;
  role: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * Une ligne de l'historique du site. Date, volume, incidents — la trilogie du
 * § 10.3. Aucun montant : ce qui s'est passé ici, pas ce qu'on l'a facturé.
 */
export interface FieldSiteHistoryEntry {
  reference: string;
  status: OperationStatus;
  /** Livraison, à défaut chargement, à défaut date prévue. */
  date: Date | null;
  plannedVolume: number;
  /** Volume du relevé faisant autorité, quand il existe. */
  deliveredVolume: number | null;
  uom: UnitOfMeasure;
  incidents: FieldIncidentView[];
}

export interface FieldSiteRequirementView {
  label: string;
  description: string | null;
  detail: string;
  /** Bloquant : l'opération ne peut pas partir tant qu'il n'est pas levé. */
  isBlocking: boolean;
}

export interface FieldSiteSheet {
  operationId: string;
  clientLegalName: string;
  site: {
    id: string;
    code: string;
    name: string;
    addressLine: string | null;
    city: string | null;
    countryCode: string;
    latitude: number | null;
    longitude: number | null;
    accessInstructions: string | null;
    openingHours: string | null;
    safetyInstructions: string | null;
    defaultHseRiskLevel: HseRiskLevel;
  };
  /**
   * Ce que le site EXIGE, à connaître AVANT de s'y présenter (§ 6.2).
   *
   * Badge d'accès, créneau réservé, permis de travail, escorte : ce sont les
   * points qui font repartir un camion à vide quand on les ignore. Ils
   * appartiennent au LIEU — plusieurs clients s'y font livrer — et se
   * saisissent au référentiel des sites.
   */
  requirements: FieldSiteRequirementView[];
  contacts: FieldSiteContactView[];
  history: FieldSiteHistoryEntry[];
}

// ---------------------------------------------------------------------------
//  Constantes de cadrage
// ---------------------------------------------------------------------------

/**
 * Statuts portés à la liste de travail. LISTE BLANCHE délibérée : un statut
 * ajouté demain à l'énumération n'apparaîtra pas tant qu'on ne l'aura pas
 * classé ici. Une exclusion (`notIn`) ferait l'inverse et le laisserait entrer
 * de lui-même.
 */
const FIELD_ACTIVE_STATUSES: OperationStatus[] = [
  OperationStatus.DRAFT,
  OperationStatus.SOURCING,
  OperationStatus.HSE_PREPARATION,
  OperationStatus.HSE_BLOCKED,
  OperationStatus.PLANNED,
  OperationStatus.LOADING,
  OperationStatus.IN_TRANSIT,
  OperationStatus.DELIVERING,
  OperationStatus.FINAL_CHECK,
  OperationStatus.INCIDENT,
];

/**
 * Statuts retenus dans l'historique du site — l'inverse du précédent : ici on
 * veut ce qui a EU LIEU, donc les clôturées. Une opération annulée ou encore
 * en brouillon n'est jamais venue sur le site : l'inscrire à son historique
 * décrirait un passage qui n'a pas eu lieu.
 */
const SITE_HISTORY_STATUSES: OperationStatus[] = [
  OperationStatus.LOADING,
  OperationStatus.IN_TRANSIT,
  OperationStatus.DELIVERING,
  OperationStatus.FINAL_CHECK,
  OperationStatus.INCIDENT,
  OperationStatus.CLOSED,
];

/**
 * Natures de pièces exposables au terrain.
 *
 * ⚠️ `GeneratedDocument` porte AUSSI les proformas, factures et avoirs de
 *    l'opération. Les remonter toutes livrerait les montants par la bande —
 *    la vue terrain interdit les factures (§ 10.3). Liste blanche, donc.
 */
const FIELD_DOCUMENT_KINDS: GeneratedDocumentKind[] = [
  GeneratedDocumentKind.TRANSPORT_ORDER,
  GeneratedDocumentKind.DELIVERY_NOTE,
  GeneratedDocumentKind.MEASUREMENT_REPORT,
  GeneratedDocumentKind.OPERATION_REPORT,
];

/**
 * Natures de pièces du client jamais exposables, quel que soit le drapeau.
 *
 * `isFieldVisible` est une décision humaine ; le type du document est une
 * donnée. Quand les deux se contredisent — une facture PDF cochée « visible
 * terrain » par mégarde — c'est la donnée qui tranche.
 */
const NEVER_FIELD_VISIBLE_TYPES: DocumentType[] = [
  DocumentType.INVOICE_PDF,
  DocumentType.PROFORMA_PDF,
];

/**
 * Une checklist « en attente » est renseignée de bout en bout mais non
 * validée. La définition est celle qu'applique `HseService.validateCheck` :
 * un point encore PENDING rend la validation impossible, donc la checklist
 * n'attend pas le contrôleur — elle attend l'agent.
 */
const AWAITING_HSE_VALIDATION: Prisma.OperationHseCheckWhereInput = {
  validatedAt: null,
  items: { none: { outcome: HseCheckOutcome.PENDING } },
};

/**
 * Borne dure de la liste de travail. Pas de pagination : la collection est
 * déjà bornée par l'affectation, et la tablette doit emporter son périmètre
 * complet pour travailler hors connexion (§ 10.4). Le plafond reste là comme
 * garde-fou — une requête ne doit jamais pouvoir saigner la base.
 */
const FIELD_LIST_CAP = 100;

/** Profondeur de l'historique de site imposée par le § 10.3. */
const SITE_HISTORY_DEPTH = 10;

// ===========================================================================
//  Service
// ===========================================================================

/** Ce que le jeton terrain dit de son porteur — rien de plus n'est utilisé. */
interface FieldActor {
  id: string;
  role: string | undefined;
}

@Injectable()
export class FieldOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perimetre: FieldScopeService,
  ) {}

  /**
   * Périmètre de l'agent, exprimé en clause `WHERE`.
   *
   * C'est LE point de cloisonnement. Il est passé à chaque lecture, y compris
   * aux accès par identifiant : sans lui, deviner un UUID suffirait à lire
   * l'opération d'un autre agent — donc d'un autre client (§ 10.3).
   *
   * Le contrôleur HSE voit en plus les opérations dont une checklist attend sa
   * validation : elles ne lui sont pas affectées, et il ne peut pas valider ce
   * qu'il ne peut pas ouvrir.
   */
  private scope(actor: FieldActor): Prisma.OperationWhereInput {
    const assignedToMe: Prisma.OperationWhereInput = { fieldAgentId: actor.id };
    if (actor.role !== FieldRole.HSE_CONTROLLER) return assignedToMe;
    return { OR: [assignedToMe, { hseChecks: { some: AWAITING_HSE_VALIDATION } }] };
  }

  /**
   * Liste de travail.
   *
   * L'agent authentifié est pris du jeton, jamais d'un paramètre : un
   * `?agentId=` transformerait le cloisonnement en suggestion.
   */
  async list(actor: FieldActor): Promise<FieldOperationSummary[]> {
    // Suppléance HSE comprise (§ 3.4) : voir `FieldScopeService.effectiveActor`.
    const effectif = await this.perimetre.effectiveActor(actor);
    const rows = await this.prisma.operation.findMany({
      where: { ...this.scope(effectif), status: { in: FIELD_ACTIVE_STATUSES } },
      orderBy: [{ plannedLoadingDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: FIELD_LIST_CAP,
      select: {
        id: true,
        reference: true,
        status: true,
        transportMode: true,
        plannedVolume: true,
        uom: true,
        plannedLoadingDate: true,
        actualLoadingDate: true,
        originLocation: true,
        destinationLocation: true,
        hseRiskLevel: true,
        // Sert à dire POURQUOI la ligne est là ; n'est pas rendu tel quel —
        // l'identifiant d'un autre agent n'a rien à faire sur la tablette.
        fieldAgentId: true,
        deal: {
          select: {
            client: { select: { legalName: true } },
            product: { select: { name: true } },
          },
        },
        destinationSite: { select: { name: true } },
        hseChecks: { where: AWAITING_HSE_VALIDATION, select: { phase: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      status: row.status,
      transportMode: row.transportMode,
      plannedVolume: toNumber(row.plannedVolume),
      uom: row.uom,
      plannedLoadingDate: row.plannedLoadingDate,
      actualLoadingDate: row.actualLoadingDate,
      originLocation: row.originLocation,
      destinationLocation: row.destinationLocation,
      clientLegalName: row.deal.client.legalName,
      siteName: row.destinationSite?.name ?? null,
      productName: row.deal.product.name,
      hseRiskLevel: row.hseRiskLevel,
      listedBecause: row.fieldAgentId === actor.id ? 'ASSIGNED' : 'AWAITING_HSE_VALIDATION',
      checksAwaitingValidation: row.hseChecks.map((check) => check.phase),
    }));
  }

  /** Détail d'une opération, dans la vue terrain et rien d'autre. */
  async findOne(id: string, actor: FieldActor): Promise<FieldOperationDetail> {
    const effectif = await this.perimetre.effectiveActor(actor);
    const operation = await this.prisma.operation.findFirst({
      where: { id, ...this.scope(effectif) },
      select: {
        id: true,
        reference: true,
        status: true,
        transportMode: true,
        plannedVolume: true,
        uom: true,
        plannedLoadingDate: true,
        actualLoadingDate: true,
        actualDischargeDate: true,
        originLocation: true,
        destinationLocation: true,
        hseRiskLevel: true,
        hseValidatedAt: true,
        deal: {
          select: {
            // Du deal on ne prend QUE l'identité du client et le produit. Ni
            // sa référence, ni son statut, ni son segment : ces champs voisinent
            // en base avec les prix et les marges, et n'ont aucun usage sur site.
            client: {
              select: {
                legalName: true,
                documents: {
                  where: {
                    isFieldVisible: true,
                    type: { notIn: NEVER_FIELD_VISIBLE_TYPES },
                  },
                  select: {
                    id: true,
                    type: true,
                    title: true,
                    mimeType: true,
                    expiryDate: true,
                  },
                  orderBy: { type: 'asc' },
                },
              },
            },
            product: {
              select: {
                code: true,
                name: true,
                referenceDensity15: true,
                viscosityCst: true,
                flashPointC: true,
                maxSulphurPct: true,
              },
            },
          },
        },
        destinationSite: { select: { id: true, name: true, city: true } },
        assignment: {
          select: {
            vehicleIdentifier: true,
            carrier: { select: { legalName: true } },
            vehicle: { select: { registration: true } },
            driver: { select: { fullName: true, phone: true } },
          },
        },
        hseChecks: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            phase: true,
            validatedAt: true,
            items: { select: { outcome: true, level: true } },
          },
        },
        measurements: {
          orderBy: { measurementDate: 'desc' },
          select: {
            measurementDate: true,
            loadedVolume15: true,
            dischargedVolume15: true,
            uom: true,
            observedTempC: true,
            isOffSpec: true,
          },
        },
        hseEvents: {
          orderBy: { occurredAt: 'desc' },
          select: {
            reference: true,
            type: true,
            severity: true,
            occurredAt: true,
            title: true,
          },
        },
        generatedDocuments: {
          where: { kind: { in: FIELD_DOCUMENT_KINDS } },
          orderBy: { generatedAt: 'desc' },
          select: {
            id: true,
            kind: true,
            reference: true,
            mimeType: true,
            generatedAt: true,
            isSealed: true,
            signatures: { select: { kind: true } },
          },
        },
      },
    });

    // Inexistante ou hors périmètre : même réponse. Distinguer les deux cas
    // apprendrait à qui sonde les identifiants lesquels existent.
    if (!operation) throw new NotFoundException(notFoundMessage(id));

    const assignment = operation.assignment;
    const product = operation.deal.product;

    return {
      id: operation.id,
      reference: operation.reference,
      status: operation.status,
      transportMode: operation.transportMode,
      plannedVolume: toNumber(operation.plannedVolume),
      uom: operation.uom,
      plannedLoadingDate: operation.plannedLoadingDate,
      actualLoadingDate: operation.actualLoadingDate,
      actualDischargeDate: operation.actualDischargeDate,
      originLocation: operation.originLocation,
      destinationLocation: operation.destinationLocation,
      clientLegalName: operation.deal.client.legalName,
      site: operation.destinationSite
        ? {
            id: operation.destinationSite.id,
            name: operation.destinationSite.name,
            city: operation.destinationSite.city,
          }
        : null,
      product: {
        code: product.code,
        name: product.name,
        referenceDensity15: toNumberOrNull(product.referenceDensity15),
        viscosityCst: toNumberOrNull(product.viscosityCst),
        flashPointC: toNumberOrNull(product.flashPointC),
        maxSulphurPct: toNumberOrNull(product.maxSulphurPct),
      },
      means: assignment
        ? {
            carrierName: assignment.carrier?.legalName ?? null,
            vehicleRegistration: assignment.vehicle?.registration ?? null,
            vehicleIdentifier: assignment.vehicleIdentifier,
            driverName: assignment.driver?.fullName ?? null,
            driverPhone: assignment.driver?.phone ?? null,
          }
        : null,
      hse: {
        riskLevel: operation.hseRiskLevel,
        validatedAt: operation.hseValidatedAt,
        checks: operation.hseChecks.map((check) => ({
          id: check.id,
          phase: check.phase,
          validatedAt: check.validatedAt,
          itemsTotal: check.items.length,
          itemsPending: check.items.filter((i) => i.outcome === HseCheckOutcome.PENDING).length,
          blockingPending: check.items.filter(
            (i) =>
              i.level === HseControlLevel.BLOCKING && i.outcome !== HseCheckOutcome.PASSED,
          ).length,
        })),
      },
      measurements: operation.measurements.map((m) => ({
        measurementDate: m.measurementDate,
        loadedVolume15: toNumber(m.loadedVolume15),
        dischargedVolume15: toNumber(m.dischargedVolume15),
        uom: m.uom,
        observedTempC: toNumberOrNull(m.observedTempC),
        isOffSpec: m.isOffSpec,
      })),
      incidents: operation.hseEvents.map(toIncident),
      documents: operation.generatedDocuments.map((doc) => ({
        id: doc.id,
        kind: doc.kind,
        reference: doc.reference,
        mimeType: doc.mimeType,
        generatedAt: doc.generatedAt,
        isSealed: doc.isSealed,
        signatureKinds: doc.signatures.map((s) => s.kind),
      })),
      referenceDocuments: operation.deal.client.documents.map((doc) => ({
        id: doc.id,
        type: doc.type,
        title: doc.title,
        mimeType: doc.mimeType,
        expiryDate: doc.expiryDate,
      })),
    };
  }

  /**
   * Fiche du site de livraison.
   *
   * L'historique est celui du SITE, pas du client : deux dépôts d'un même
   * groupe n'ont ni les mêmes consignes ni les mêmes incidents, et rien ne
   * justifie qu'un agent envoyé sur l'un lise le passé de l'autre. Le site est
   * lui-même dérivé de l'opération affectée — il n'est jamais pris du chemin,
   * donc jamais choisi par l'appelant.
   */
  async siteSheet(operationId: string, actor: FieldActor): Promise<FieldSiteSheet> {
    const operation = await this.prisma.operation.findFirst({
      where: { id: operationId, ...this.scope(actor) },
      select: {
        id: true,
        destinationSite: {
          select: {
            id: true,
            code: true,
            name: true,
            addressLine: true,
            city: true,
            countryCode: true,
            latitude: true,
            longitude: true,
            accessInstructions: true,
            openingHours: true,
            safetyInstructions: true,
            defaultHseRiskLevel: true,
            // Les exigences du LIEU, telles que l'agent doit les connaître
            // AVANT de se présenter. Elles ne sont pas commerciales : c'est
            // du badge, du créneau, du permis de travail — exactement ce qui
            // fait repartir un camion à vide quand on l'ignore.
            site: {
              select: {
                requirements: {
                  where: { isActive: true },
                  orderBy: { type: { displayOrder: 'asc' } },
                  select: {
                    detail: true,
                    isBlocking: true,
                    type: { select: { label: true, description: true } },
                  },
                },
              },
            },
            partner: {
              select: {
                legalName: true,
                // Un contact n'est pas visible du terrain parce qu'il est
                // contact : il l'est parce que quelqu'un l'a décidé.
                contacts: {
                  where: { isFieldVisible: true },
                  orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }],
                  select: { fullName: true, role: true, phone: true, email: true },
                },
              },
            },
          },
        },
      },
    });

    if (!operation) throw new NotFoundException(notFoundMessage(operationId));

    const site = operation.destinationSite;
    if (!site) {
      throw new NotFoundException(
        'Cette opération ne désigne aucun site de livraison référencé : il n’y a pas de fiche de site à consulter. La destination figure en clair sur le détail de l’opération.',
      );
    }

    const previous = await this.prisma.operation.findMany({
      where: {
        destinationSiteId: site.id,
        status: { in: SITE_HISTORY_STATUSES },
        // L'opération en cours n'est pas son propre historique.
        id: { not: operation.id },
      },
      orderBy: [
        { plannedLoadingDate: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      take: SITE_HISTORY_DEPTH,
      select: {
        reference: true,
        status: true,
        plannedVolume: true,
        uom: true,
        plannedLoadingDate: true,
        actualLoadingDate: true,
        actualDischargeDate: true,
        // Le volume qui compte est celui du relevé faisant autorité (§ 8.1).
        // Un seul par opération, garanti par index unique partiel en base.
        measurements: {
          where: { isAuthoritative: true },
          take: 1,
          select: { dischargedVolume15: true },
        },
        hseEvents: {
          orderBy: { occurredAt: 'desc' },
          select: {
            reference: true,
            type: true,
            severity: true,
            occurredAt: true,
            title: true,
          },
        },
      },
    });

    return {
      operationId: operation.id,
      clientLegalName: site.partner.legalName,
      site: {
        id: site.id,
        code: site.code,
        name: site.name,
        addressLine: site.addressLine,
        city: site.city,
        countryCode: site.countryCode,
        latitude: toNumberOrNull(site.latitude),
        longitude: toNumberOrNull(site.longitude),
        accessInstructions: site.accessInstructions,
        openingHours: site.openingHours,
        safetyInstructions: site.safetyInstructions,
        defaultHseRiskLevel: site.defaultHseRiskLevel,
      },
      requirements: (site.site?.requirements ?? []).map((r) => ({
        label: r.type.label,
        description: r.type.description,
        detail: r.detail,
        isBlocking: r.isBlocking,
      })),
      contacts: site.partner.contacts.map((contact) => ({
        fullName: contact.fullName,
        role: contact.role,
        phone: contact.phone,
        email: contact.email,
      })),
      history: previous.map((row) => ({
        reference: row.reference,
        status: row.status,
        // Ce qui s'est réellement passé prime sur ce qui était prévu.
        date: row.actualDischargeDate ?? row.actualLoadingDate ?? row.plannedLoadingDate,
        plannedVolume: toNumber(row.plannedVolume),
        deliveredVolume: row.measurements[0]
          ? toNumber(row.measurements[0].dischargedVolume15)
          : null,
        uom: row.uom,
        incidents: row.hseEvents.map(toIncident),
      })),
    };
  }
}

// ---------------------------------------------------------------------------
//  Utilitaires locaux
// ---------------------------------------------------------------------------

/**
 * Message unique pour « n'existe pas » et « pas la vôtre ».
 * Deux messages distincts feraient de la route un oracle d'existence.
 */
function notFoundMessage(id: string): string {
  return `Aucune opération ${id} ne vous est accessible.`;
}

function toIncident(event: {
  reference: string;
  type: HseEventType;
  severity: HseSeverity;
  occurredAt: Date;
  title: string;
}): FieldIncidentView {
  return {
    reference: event.reference,
    type: event.type,
    severity: event.severity,
    occurredAt: event.occurredAt,
    title: event.title,
  };
}

/** Les Decimal de Prisma sortiraient en objet : on les rend en nombre. */
function toNumber(value: Prisma.Decimal): number {
  return Number(value);
}

function toNumberOrNull(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}

// ===========================================================================
//  Contrôleur TERRAIN
// ===========================================================================

@Controller('api/field/operations')
@RequireRealm(Realm.FIELD)
@FieldRoles(FieldRole.FIELD_AGENT, FieldRole.HSE_CONTROLLER)
export class FieldOperationsController {
  constructor(private readonly service: FieldOperationsService) {}

  /**
   * Mes opérations. Aucun filtre d'appelant n'est accepté : le périmètre sort
   * du jeton, et lui seul.
   */
  @Get()
  @FieldRoles(FieldRole.FIELD_AGENT, FieldRole.HSE_CONTROLLER)
  list(@Req() req: { auth: { sub: string; role?: string } }): Promise<FieldOperationSummary[]> {
    return this.service.list({ id: req.auth.sub, role: req.auth.role });
  }

  @Get(':id')
  @FieldRoles(FieldRole.FIELD_AGENT, FieldRole.HSE_CONTROLLER)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { auth: { sub: string; role?: string } },
  ): Promise<FieldOperationDetail> {
    return this.service.findOne(id, { id: req.auth.sub, role: req.auth.role });
  }

  /** Adresse, accès, consignes, contacts sur place et passé du site. */
  @Get(':id/site')
  @FieldRoles(FieldRole.FIELD_AGENT, FieldRole.HSE_CONTROLLER)
  site(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { auth: { sub: string; role?: string } },
  ): Promise<FieldSiteSheet> {
    return this.service.siteSheet(id, { id: req.auth.sub, role: req.auth.role });
  }
}
