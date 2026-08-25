import {
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
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
  phase: OperationPhase;
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

/**
 * Une ligne d'historique. Pas `FieldOperationSummary` — celui-ci porte
 * `listedBecause`/`checksAwaitingValidation`, deux notions de liste de
 * travail EN COURS qui n'ont aucun sens pour une opération déjà clôturée.
 */
export interface FieldOperationHistoryEntry {
  id: string;
  reference: string;
  transportMode: TransportMode;
  plannedVolume: number;
  uom: UnitOfMeasure;
  actualLoadingDate: Date | null;
  actualDischargeDate: Date | null;
  originLocation: string;
  destinationLocation: string;
  clientLegalName: string;
  siteName: string | null;
  productName: string;
}

export interface FieldOperationHistoryPage {
  items: FieldOperationHistoryEntry[];
  hasMore: boolean;
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

/** Un relevé = un seul bout (§ 25/08/2026) — `phase` dit lequel. */
export interface FieldMeasurementView {
  measurementDate: Date;
  phase: OperationPhase;
  observedVolume: number;
  volume15: number;
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
  phase: OperationPhase;
  /**
   * Étape suivante, déjà calculée (§ 25/08/2026) — la séquence est stricte
   * et connue du serveur seul : l'agent n'a plus à la choisir, il l'exécute.
   * `null` à l'arrêt (haltedAt) ou déjà en CLOTURE : rien à avancer.
   */
  nextPhase: OperationPhase | null;
  /**
   * Les 9 étapes, dans l'ordre (§ 25/08/2026) — pour que l'écran d'un
   * dossier les présente toutes (accordéon), sans jamais faire deviner ou
   * saisir une phase que le serveur connaît déjà.
   */
  phaseSequence: OperationPhase[];
  /**
   * TYPES portés, DANS L'ORDRE DU DÉROULÉ (§ 25/08/2026) — c'est par eux que
   * les contrôles HSE de l'opération sont indexés (comme côté desk interne,
   * `operations.controller.ts`). Sans cet affichage, une checklist qui
   * apparaît vide ne dit pas pourquoi : aucun type retenu n'en porte.
   */
  types: { sequence: number; code: string; label: string }[];
  haltedAt: Date | null;
  haltType: string | null;
  haltReason: string | null;
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
  /** Un véhicule par ligne — plusieurs quand la capacité d'un seul ne couvre pas le volume prévu. */
  means: FieldMeansView[];
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
  phase: OperationPhase;
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
 * Portées à la liste de travail : pas encore clôturées, ni arrêtées
 * (§ 22/08/2026 — un seul champ d'état, plus de liste blanche de 10 valeurs
 * à tenir à jour : tout ce qui n'est ni CLOTURE ni à l'arrêt est actif).
 */
const FIELD_ACTIVE_WHERE = {
  haltedAt: null,
  phase: { not: OperationPhase.CLOTURE },
} as const;

/**
 * Étapes retenues dans l'historique du site — l'inverse du précédent : ici on
 * veut ce qui a EU LIEU, donc au moins le chargement. Une opération encore en
 * préparation, ou annulée avant, n'est jamais venue sur le site : l'inscrire
 * à son historique décrirait un passage qui n'a pas eu lieu. Un INCIDENT
 * compte : l'opération était bien là quand il est survenu.
 */
const SITE_HISTORY_PHASES: OperationPhase[] = [
  OperationPhase.CHARGEMENT,
  OperationPhase.POST_CHARGEMENT,
  OperationPhase.TRANSPORT,
  OperationPhase.PRE_DECHARGEMENT,
  OperationPhase.DECHARGEMENT,
  OperationPhase.POST_DECHARGEMENT,
  OperationPhase.CLOTURE,
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

/**
 * Taille de page de l'historique PERSONNEL de l'agent (à distinguer de
 * l'historique de SITE ci-dessus, borné à une profondeur fixe). Celui-ci
 * s'accumule sans fin au fil des mois — une vraie pagination, pas un plafond
 * dur, est nécessaire pour qu'un agent en poste depuis longtemps puisse
 * toujours remonter au-delà des dix dernières.
 */
const FIELD_HISTORY_PAGE_SIZE = 20;

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
      where: { ...this.scope(effectif), ...FIELD_ACTIVE_WHERE },
      orderBy: [{ plannedLoadingDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: FIELD_LIST_CAP,
      select: {
        id: true,
        reference: true,
        phase: true,
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
      phase: row.phase,
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

  /**
   * Historique personnel — opérations clôturées qui lui ont été affectées.
   *
   * Volontairement `fieldAgentId: effectif.id` seul, jamais `this.scope()` :
   * ce dernier élargit au contrôleur HSE les opérations en attente de SA
   * validation, une notion de travail EN COURS sans objet ici — l'historique
   * ne montre que ce que l'agent a lui-même réalisé, pas ce qu'il a contrôlé.
   */
  async history(actor: FieldActor, page: number): Promise<FieldOperationHistoryPage> {
    const effectif = await this.perimetre.effectiveActor(actor);
    const rows = await this.prisma.operation.findMany({
      where: { fieldAgentId: effectif.id, phase: OperationPhase.CLOTURE },
      orderBy: [
        { actualDischargeDate: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      skip: (page - 1) * FIELD_HISTORY_PAGE_SIZE,
      // Une ligne de plus que la page : sa seule présence dit s'il reste une
      // page suivante, sans recompter le total séparément.
      take: FIELD_HISTORY_PAGE_SIZE + 1,
      select: {
        id: true,
        reference: true,
        transportMode: true,
        plannedVolume: true,
        uom: true,
        actualLoadingDate: true,
        actualDischargeDate: true,
        originLocation: true,
        destinationLocation: true,
        deal: {
          select: {
            client: { select: { legalName: true } },
            product: { select: { name: true } },
          },
        },
        destinationSite: { select: { name: true } },
      },
    });

    const hasMore = rows.length > FIELD_HISTORY_PAGE_SIZE;
    const items = rows.slice(0, FIELD_HISTORY_PAGE_SIZE).map((row) => ({
      id: row.id,
      reference: row.reference,
      transportMode: row.transportMode,
      plannedVolume: toNumber(row.plannedVolume),
      uom: row.uom,
      actualLoadingDate: row.actualLoadingDate,
      actualDischargeDate: row.actualDischargeDate,
      originLocation: row.originLocation,
      destinationLocation: row.destinationLocation,
      clientLegalName: row.deal.client.legalName,
      siteName: row.destinationSite?.name ?? null,
      productName: row.deal.product.name,
    }));

    return { items, hasMore };
  }

  /** Détail d'une opération, dans la vue terrain et rien d'autre. */
  async findOne(id: string, actor: FieldActor): Promise<FieldOperationDetail> {
    const effectif = await this.perimetre.effectiveActor(actor);
    const operation = await this.prisma.operation.findFirst({
      where: { id, ...this.scope(effectif) },
      select: {
        id: true,
        reference: true,
        phase: true,
        haltedAt: true,
        haltType: true,
        haltReason: true,
        transportMode: true,
        plannedVolume: true,
        uom: true,
        plannedLoadingDate: true,
        actualLoadingDate: true,
        actualDischargeDate: true,
        originLocation: true,
        destinationLocation: true,
        hseRiskLevel: true,
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
        // TYPES portés, DANS L'ORDRE DU DÉROULÉ (§ 25/08/2026, comme le
        // desk interne, operations.controller.ts) — c'est par eux que les
        // contrôles HSE sont indexés. Sans eux affichés, l'agent découvre
        // une checklist sans savoir d'où elle vient ni pourquoi elle est
        // vide quand aucun type retenu n'en porte.
        operationTypes: {
          orderBy: { sequence: 'asc' },
          select: {
            sequence: true,
            operationType: { select: { code: true, label: true } },
          },
        },
        // Un véhicule par ligne (§ 22/08/2026) — plusieurs quand la capacité
        // d'un seul ne couvre pas le volume prévu.
        assignments: {
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
            phase: true,
            observedVolume: true,
            volume15: true,
            uom: true,
            observedTempC: true,
            isOffSpec: true,
            ullageVariancePct: true,
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

    const product = operation.deal.product;

    // Ordre de la séquence tel que déclaré dans le schéma (§ 22/08/2026) —
    // même idiome que seed-lot2.ts : Object.values() d'un enum Prisma en
    // restitue les libellés dans l'ordre de déclaration, qui FAIT FOI (le
    // trigger `enforce_phase_sequence` s'appuie sur ce même ordre côté base,
    // via enum_range). Aucune étape suivante à l'arrêt ou depuis CLOTURE.
    const sequence = Object.values(OperationPhase);
    const rang = sequence.indexOf(operation.phase);
    const nextPhase =
      operation.haltedAt || rang < 0 || rang >= sequence.length - 1 ? null : sequence[rang + 1];

    return {
      id: operation.id,
      reference: operation.reference,
      phase: operation.phase,
      nextPhase,
      phaseSequence: sequence,
      types: operation.operationTypes.map((t) => ({
        sequence: t.sequence,
        code: t.operationType.code,
        label: t.operationType.label,
      })),
      haltedAt: operation.haltedAt,
      haltType: operation.haltType,
      haltReason: operation.haltReason,
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
      // Un moyen par ligne, dans l'ordre où ils ont été affectés.
      means: operation.assignments.map((a) => ({
        carrierName: a.carrier?.legalName ?? null,
        vehicleRegistration: a.vehicle?.registration ?? null,
        vehicleIdentifier: a.vehicleIdentifier,
        driverName: a.driver?.fullName ?? null,
        driverPhone: a.driver?.phone ?? null,
      })),
      hse: {
        riskLevel: operation.hseRiskLevel,
        // Validation de l'ÉTAPE COURANTE — plus un seul indicateur global
        // (§ 22/08/2026) : chaque étape porte sa propre validation.
        validatedAt:
          operation.hseChecks.find((check) => check.phase === operation.phase)?.validatedAt ??
          null,
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
        phase: m.phase,
        observedVolume: toNumber(m.observedVolume),
        volume15: toNumber(m.volume15),
        uom: m.uom,
        observedTempC: toNumberOrNull(m.observedTempC),
        isOffSpec: m.isOffSpec,
        ullageVariancePct: toNumberOrNull(m.ullageVariancePct),
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
        // Le contact sur place vient du CLIENT de l'affaire, pas du site :
        // un lieu partagé par plusieurs clients n'a pas de contact qui lui
        // soit propre (§ 6.2) — c'est l'affaire qui porte la relation
        // commerciale, jamais le lieu lui-même.
        deal: {
          select: {
            client: {
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
        phase: { in: SITE_HISTORY_PHASES },
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
        phase: true,
        plannedVolume: true,
        uom: true,
        plannedLoadingDate: true,
        actualLoadingDate: true,
        actualDischargeDate: true,
        // Le volume qui compte est celui du relevé DECHARGEMENT faisant
        // autorité (§ 8.1, § 25/08/2026 : un relevé ne porte plus qu'un
        // bout — voir schema.prisma). Un seul par (opération, étape),
        // garanti par index unique partiel en base.
        measurements: {
          where: { isAuthoritative: true, phase: OperationPhase.DECHARGEMENT },
          take: 1,
          select: { volume15: true },
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
      clientLegalName: operation.deal.client.legalName,
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
      requirements: site.requirements.map((r) => ({
        label: r.type.label,
        description: r.type.description,
        detail: r.detail,
        isBlocking: r.isBlocking,
      })),
      contacts: operation.deal.client.contacts.map((contact) => ({
        fullName: contact.fullName,
        role: contact.role,
        phone: contact.phone,
        email: contact.email,
      })),
      history: previous.map((row) => ({
        reference: row.reference,
        phase: row.phase,
        // Ce qui s'est réellement passé prime sur ce qui était prévu.
        date: row.actualDischargeDate ?? row.actualLoadingDate ?? row.plannedLoadingDate,
        plannedVolume: toNumber(row.plannedVolume),
        deliveredVolume: row.measurements[0]
          ? toNumber(row.measurements[0].volume15)
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

  /**
   * Historique personnel, paginé.
   *
   * ⚠️ DOIT PRÉCÉDER `@Get(':id')` CI-DESSOUS. NestJS route dans l'ordre de
   *    déclaration : après `:id`, une requête sur `/history` s'y ferait
   *    happer en premier, et `ParseUUIDPipe` la rejetterait avant même
   *    d'atteindre ce gestionnaire-ci.
   */
  @Get('history')
  @FieldRoles(FieldRole.FIELD_AGENT, FieldRole.HSE_CONTROLLER)
  history(
    @Query('page') page: string | undefined,
    @Req() req: { auth: { sub: string; role?: string } },
  ): Promise<FieldOperationHistoryPage> {
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    return this.service.history({ id: req.auth.sub, role: req.auth.role }, pageNum);
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
