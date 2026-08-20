import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { FieldVocabularyService } from './field-vocabulary.service';

// ===========================================================================
//  Objets de LECTURE — copie fidèle des vues terrain du serveur
//
//  Les interfaces ci-dessous reprennent, champ pour champ, celles de
//  `field-operations.controller.ts`. Elles ne les ÉLARGISSENT jamais : la vue
//  terrain est une liste blanche construite pour qu'aucun prix, aucune marge,
//  aucun encours n'atteigne la tablette (§ 10.3). Déclarer ici un champ que le
//  serveur ne rend pas laisserait croire qu'on peut l'afficher, et le premier
//  écran qui l'afficherait irait le chercher ailleurs — par les routes
//  internes, c'est-à-dire à côté du cloisonnement.
//
//  Les dates sont des `string` : c'est du JSON, pas des `Date`.
// ===========================================================================

/** Pourquoi l'opération figure dans la liste de l'agent. */
export type FieldListingReason = 'ASSIGNED' | 'AWAITING_HSE_VALIDATION';

export interface FieldOperationSummary {
  id: string;
  reference: string;
  status: string;
  transportMode: string;
  plannedVolume: number;
  uom: string;
  plannedLoadingDate: string | null;
  actualLoadingDate: string | null;
  originLocation: string;
  destinationLocation: string;
  clientLegalName: string;
  siteName: string | null;
  productName: string;
  hseRiskLevel: string;
  listedBecause: FieldListingReason;
  checksAwaitingValidation: string[];
}

export interface FieldProductView {
  code: string;
  name: string;
  referenceDensity15: number;
  viscosityCst: number | null;
  flashPointC: number | null;
  maxSulphurPct: number | null;
}

export interface FieldMeansView {
  carrierName: string | null;
  vehicleRegistration: string | null;
  vehicleIdentifier: string | null;
  driverName: string | null;
  driverPhone: string | null;
}

export interface FieldChecklistView {
  id: string;
  phase: string;
  validatedAt: string | null;
  itemsTotal: number;
  itemsPending: number;
  blockingPending: number;
}

export interface FieldMeasurementView {
  measurementDate: string;
  loadedVolume15: number;
  dischargedVolume15: number;
  uom: string;
  observedTempC: number | null;
  isOffSpec: boolean;
}

export interface FieldIncidentView {
  reference: string;
  type: string;
  severity: string;
  occurredAt: string;
  title: string;
}

export interface FieldDocumentView {
  id: string;
  kind: string;
  reference: string;
  mimeType: string;
  generatedAt: string;
  isSealed: boolean;
  /** Natures de signataires déjà enregistrées — pas leur identité. */
  signatureKinds: string[];
}

export interface FieldReferenceDocumentView {
  id: string;
  type: string;
  title: string;
  mimeType: string;
  expiryDate: string | null;
}

export interface FieldOperationDetail {
  id: string;
  reference: string;
  status: string;
  transportMode: string;
  plannedVolume: number;
  uom: string;
  plannedLoadingDate: string | null;
  actualLoadingDate: string | null;
  actualDischargeDate: string | null;
  originLocation: string;
  destinationLocation: string;
  clientLegalName: string;
  site: { id: string; name: string; city: string | null } | null;
  product: FieldProductView;
  means: FieldMeansView | null;
  hse: { riskLevel: string; validatedAt: string | null; checks: FieldChecklistView[] };
  measurements: FieldMeasurementView[];
  incidents: FieldIncidentView[];
  documents: FieldDocumentView[];
  referenceDocuments: FieldReferenceDocumentView[];
}

export interface FieldSiteContactView {
  fullName: string;
  role: string | null;
  phone: string | null;
  email: string | null;
}

export interface FieldSiteHistoryEntry {
  reference: string;
  status: string;
  date: string | null;
  plannedVolume: number;
  deliveredVolume: number | null;
  uom: string;
  incidents: FieldIncidentView[];
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
    defaultHseRiskLevel: string;
  };
  /** Ce que le site exige — badge, créneau, permis, escorte (§ 6.2). */
  requirements: {
    label: string;
    description: string | null;
    detail: string;
    isBlocking: boolean;
  }[];
  contacts: FieldSiteContactView[];
  history: FieldSiteHistoryEntry[];
}

// --- Checklists détaillées : `/api/field/hse` --------------------------------

/**
 * Un point de contrôle instancié sur l'opération.
 *
 * `level` est le niveau FIGÉ à l'ouverture de la checklist, pas celui du
 * modèle d'aujourd'hui : une révision du modèle ne requalifie pas après coup
 * ce qui a été contrôlé sur le terrain. On l'affiche tel que le serveur le
 * rend, sans le traduire.
 */
export interface FieldCheckItem {
  id: string;
  level: string;
  outcome: string;
  recordedValue: string | null;
  comment: string | null;
  recordedAt: string | null;
  recordedByFieldUser: { fullName: string } | null;
  item: {
    code: string;
    label: string;
    guidance: string | null;
    /**
     * Régime photographique du point (§ 7.1 bis).
     *
     * INTERDITE n'est pas « facultative non utilisée » : la prise de vue est
     * proscrite en zone ATEX et chez certains clients. Afficher l'appareil
     * photo là met l'agent en faute.
     */
    photoPolicy: 'FORBIDDEN' | 'OPTIONAL' | 'REQUIRED';
    requiresPhoto: boolean;
    requiresSignature: boolean;
    requiresValue: boolean;
    valueLabel: string | null;
    displayOrder: number;
  };
}

export interface FieldCheck {
  id: string;
  operationId: string;
  phase: string;
  validatedAt: string | null;
  validatedByFieldUser: { fullName: string; role: string } | null;
  validatedByUser: { fullName: string; role: string } | null;
  rejectedAt: string | null;
  rejectedByFieldUser: { fullName: string; role: string } | null;
  rejectedByUser: { fullName: string; role: string } | null;
  rejectionReason: string | null;
  template: { code: string; label: string; version: number } | null;
  items: FieldCheckItem[];
}

/** Refus conservé par le serveur — survit à la perte de la file locale. */
export interface FieldRejection {
  id: string;
  operationId: string;
  type: string;
  sequence: number;
  deviceTimestamp: string;
  receivedAt: string;
  rejectionReason: string | null;
  operation: { reference: string } | null;
}

/**
 * NIVEAU BLOQUANT — unique jeton d'énumération repris du contrat serveur.
 *
 * Ce n'est pas une liste de niveaux de contrôle : c'est la SENTINELLE du
 * verrou HSE, celle sur laquelle la base elle-même s'appuie (« aucun
 * chargement tant qu'un point BLOCKING n'est pas PASSED »). Sans elle,
 * l'interface ne pourrait pas rendre visible ce qui bloque, et le § 4 de la
 * commande — « un point bloquant doit se voir immédiatement comme tel » —
 * serait impossible à tenir.
 *
 * Les autres niveaux ne sont jamais énumérés : ils s'affichent tels que
 * l'API les rend.
 */
export const NIVEAU_BLOQUANT = 'BLOCKING';

@Injectable({ providedIn: 'root' })
export class FieldApiService {
  private readonly http = inject(HttpClient);
  private readonly vocabulaire = inject(FieldVocabularyService);
  private readonly base = '/api/field';

  /**
   * Liste de travail. Le serveur borne déjà le périmètre par l'affectation :
   * aucun filtre d'appelant n'est transmis, il serait sans effet et laisserait
   * croire que la tablette choisit ce qu'elle voit.
   */
  operations(): Observable<FieldOperationSummary[]> {
    return this.http
      .get<FieldOperationSummary[]>(`${this.base}/operations`)
      .pipe(tap((lignes) => lignes.forEach((l) => this.retenirResume(l))));
  }

  operation(id: string): Observable<FieldOperationDetail> {
    return this.http
      .get<FieldOperationDetail>(`${this.base}/operations/${id}`)
      .pipe(tap((detail) => this.retenirDetail(detail)));
  }

  site(operationId: string): Observable<FieldSiteSheet> {
    return this.http
      .get<FieldSiteSheet>(`${this.base}/operations/${operationId}/site`)
      .pipe(tap((fiche) => this.retenirFiche(fiche)));
  }

  checks(operationId: string): Observable<FieldCheck[]> {
    return this.http
      .get<FieldCheck[]>(`${this.base}/hse/operations/${operationId}/checks`)
      .pipe(
        tap((checks) =>
          checks.forEach((c) => {
            this.vocabulaire.noter('phase', c.phase);
            c.items.forEach((i) => this.vocabulaire.noter('outcome', i.outcome));
          }),
        ),
      );
  }

  /**
   * Déclenche la génération du rapport d'exécution et du bon de livraison.
   *
   * Asynchrone côté serveur (file BullMQ, rendu Chromium) : le retour ne
   * porte que l'identifiant de la tâche. L'écran doit recharger le dossier de
   * l'opération quelques secondes plus tard pour voir apparaître les pièces.
   */
  genererCloture(operationId: string): Observable<{ jobId: string }> {
    return this.http.post<{ jobId: string }>(
      `${this.base}/documents/operations/${operationId}/closure`,
      {},
    );
  }

  /**
   * Signature d'une pièce (rapport ou bon de livraison).
   *
   * Scelle AUTOMATIQUEMENT dès que les signataires requis y sont — c'est le
   * serveur qui le décide (`DocumentsService.seal`), jamais cet écran : la
   * réponse ne dit pas si la pièce est scellée, il faut recharger le dossier.
   */
  signerDocument(
    documentId: string,
    dto: {
      kind: string;
      signatoryName: string;
      signatoryCapacity: string;
    },
  ): Observable<unknown> {
    return this.http.post(`${this.base}/documents/${documentId}/signatures`, dto);
  }

  /**
   * Refus enregistrés par le serveur.
   *
   * La file de la tablette vit en mémoire : un rechargement de page l'efface,
   * pas les refus. Cette route est donc le seul endroit où un agent retrouve
   * ce qui a été refusé avant le rechargement — et pourquoi son opération
   * n'avance plus.
   */
  refus(depuis?: string): Observable<FieldRejection[]> {
    let params = new HttpParams();
    if (depuis) params = params.set('since', depuis);
    return this.http.get<FieldRejection[]>(`${this.base}/sync/rejections`, { params });
  }

  // --- Alimentation du vocabulaire ----------------------------------------
  //
  //  Chaque lecture nourrit les listes de choix des écrans de saisie. C'est le
  //  seul moyen dont dispose la tablette pour connaître les valeurs admises
  //  sans les inscrire en dur — voir `FieldVocabularyService`.

  private retenirResume(l: FieldOperationSummary): void {
    // `to` et non `status` : c'est le nom du champ dans `TransitionDto`, donc
    // celui que porteront les messages de refus.
    this.vocabulaire.noter('to', l.status);
    this.vocabulaire.noter('uom', l.uom);
    this.vocabulaire.noterListe('phase', l.checksAwaitingValidation);
  }

  private retenirDetail(d: FieldOperationDetail): void {
    this.vocabulaire.noter('to', d.status);
    this.vocabulaire.noter('uom', d.uom);
    this.vocabulaire.noterListe(
      'phase',
      d.hse.checks.map((c) => c.phase),
    );
    for (const i of d.incidents) {
      this.vocabulaire.noter('type', i.type);
      this.vocabulaire.noter('severity', i.severity);
    }
    for (const m of d.measurements) this.vocabulaire.noter('uom', m.uom);
  }

  private retenirFiche(f: FieldSiteSheet): void {
    for (const ligne of f.history) {
      this.vocabulaire.noter('to', ligne.status);
      this.vocabulaire.noter('uom', ligne.uom);
      for (const i of ligne.incidents) {
        this.vocabulaire.noter('type', i.type);
        this.vocabulaire.noter('severity', i.severity);
      }
    }
  }
}
