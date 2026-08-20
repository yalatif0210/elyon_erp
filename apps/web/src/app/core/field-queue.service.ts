import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { JournalIndexedDb, journalDisponible } from './field-journal-persistant';
import { FieldSessionService, nouvelIdentifiant } from './field-session.service';
import { FieldVocabularyService } from './field-vocabulary.service';

/**
 * Durée de conservation locale des événements DÉJÀ RÉGLÉS.
 *
 * Ce n'est pas une règle de gestion mais une borne d'hygiène du stockage de
 * l'appareil : ce qui est acquis ou refusé vit désormais sur le SERVEUR, qui
 * en est la source de vérité — les refus restent consultables par
 * `/api/field/sync/rejections`. La copie locale n'existe que pour que l'agent
 * puisse relire les motifs sans réseau. Elle n'est donc pas paramétrable, au
 * même titre que le nom de la base locale.
 *
 * ⚠️ Ce qui n'est PAS réglé n'est jamais purgé, quel que soit son âge : une
 *    opération restée trois semaines hors réseau doit repartir entière.
 */
const RETENTION_JOURS = 30;

/**
 * Natures d'événement du journal terrain.
 *
 * Ce n'est pas une valeur métier paramétrable mais le CONTRAT de la route de
 * synchronisation : chaque nature désigne le DTO du domaine contre lequel sa
 * charge utile sera validée (table `CHARGE_UTILE` du serveur). Un nom inventé
 * ici ne serait pas « une option de moins », il ferait refuser l'événement.
 */
export type FieldEventType =
  | 'CHECK_OPENED'
  | 'CHECK_ITEM_RECORDED'
  | 'CHECK_VALIDATED'
  | 'CHECK_REJECTED'
  | 'MEASUREMENT_RECORDED'
  | 'STATUS_ADVANCED'
  | 'HSE_EVENT_DECLARED';

/**
 * Sort d'un événement DANS LA FILE — à distinguer du sort rendu par le serveur.
 *
 *   EN_ATTENTE  produit, pas encore présenté
 *   ENVOI       présenté, réponse pas encore reçue
 *   ACQUIS      ACCEPTED, ou déjà connu du serveur : l'effet est en base
 *   REFUSE      REJECTED : jugé et refusé. NE REPART JAMAIS.
 *   SUSPENDU    DEFERRED : PAS jugé. Repartira, inchangé, même identifiant.
 */
export type EtatEnvoi = 'EN_ATTENTE' | 'ENVOI' | 'ACQUIS' | 'REFUSE' | 'SUSPENDU';

/** Ce que le serveur rend pour chaque événement présenté. */
type SortServeur = 'ACCEPTED' | 'REJECTED' | 'DEFERRED';

interface SyncOutcome {
  id: string;
  status: SortServeur;
  reason?: string;
}

export interface SyncReport {
  received: number;
  accepted: number;
  rejected: number;
  deferred: number;
  alreadyKnown: number;
  outcomes: SyncOutcome[];
}

/**
 * Un événement du journal local.
 *
 * Les champs jusqu'à `longitude` composent le message envoyé au serveur et ne
 * changent JAMAIS après la mise en file — surtout pas `id`, `sequence` et
 * `deviceTimestamp`. Les suivants sont locaux : ils servent l'affichage de la
 * file et ne franchissent pas le réseau.
 */
export interface EvenementTerrain {
  id: string;
  operationId: string;
  type: FieldEventType;
  payload: Record<string, unknown>;
  sequence: number;
  deviceTimestamp: string;
  latitude?: number;
  longitude?: number;

  /** Confort d'affichage — jamais transmis. */
  reference: string;
  /** Ce que l'agent a fait, dit dans ses termes. Jamais transmis. */
  intitule: string;
  etat: EtatEnvoi;
  /** Motif rendu par le serveur, INTÉGRAL. */
  motif?: string;
  presentations: number;
  regleLe?: string;
}

/** Ce que l'appelant fournit ; le reste est produit par la file. */
export interface DepotEvenement {
  operationId: string;
  reference: string;
  type: FieldEventType;
  intitule: string;
  payload: Record<string, unknown>;
}

/**
 * JOURNAL LOCAL — l'interface que la version persistante devra respecter.
 *
 * Elle est ASYNCHRONE alors que l'implémentation en mémoire n'en a aucun
 * besoin : c'est délibéré. IndexedDB ne rend que des promesses ; une interface
 * synchrone obligerait, le jour où le hors-ligne sera tranché, à reprendre
 * chaque appelant — c'est-à-dire tous les écrans de saisie. Le coût est nul
 * aujourd'hui, l'économie est totale demain.
 */
export interface JournalTerrain {
  ajouter(e: EvenementTerrain): Promise<void>;
  remplacer(e: EvenementTerrain): Promise<void>;
  tous(): Promise<EvenementTerrain[]>;
  prochainRang(): Promise<number>;
}

/**
 * Journal EN MÉMOIRE — désormais le REPLI, plus le mode normal.
 *
 * Il ne sert que là où le stockage local est indisponible : navigation privée,
 * stockage désactivé par une politique d'entreprise. Ce cas est SIGNALÉ à
 * l'agent, jamais silencieux — c'est précisément la situation où il ne faut
 * pas éteindre la tablette avant d'avoir retrouvé du réseau.
 */
export class JournalMemoire implements JournalTerrain {
  private readonly lignes: EvenementTerrain[] = [];

  async ajouter(e: EvenementTerrain): Promise<void> {
    this.lignes.push(e);
  }

  async remplacer(e: EvenementTerrain): Promise<void> {
    const rang = this.lignes.findIndex((l) => l.id === e.id);
    if (rang >= 0) this.lignes[rang] = e;
  }

  async tous(): Promise<EvenementTerrain[]> {
    return [...this.lignes];
  }

  /**
   * Rang suivant dans le journal.
   *
   * Le serveur trie par `sequence` À L'INTÉRIEUR d'une opération : c'est
   * l'ordre de PRODUCTION qui fait foi, pas celui de l'envoi. Un compteur
   * unique pour tout le journal suffit donc, et garantit en plus que deux
   * événements de la même opération ne partagent jamais un rang.
   */
  async prochainRang(): Promise<number> {
    return this.lignes.length === 0
      ? 0
      : Math.max(...this.lignes.map((l) => l.sequence)) + 1;
  }
}

/**
 * FILE D'ENVOI DU TERRAIN.
 *
 * TOUT passe par elle, même en ligne : un écran ne fait jamais d'appel direct
 * à `/api/field/sync`. C'est ce qui rendra le hors-ligne ajoutable en
 * remplaçant le seul `JournalMemoire`, sans toucher un écran.
 *
 * ⚠️ LES TROIS SORTS, ET CE QU'ILS IMPOSENT
 *
 *   ACCEPTED — l'effet est en base. L'événement sort de la file.
 *
 *   déjà connu — le serveur a reconnu l'identifiant et rend le sort qu'il
 *     avait eu. Ce n'est pas un doublon, c'est un RENVOI : rien n'a été
 *     réappliqué. Le sort rendu est traité comme les autres, ce qui règle du
 *     même coup le cas du renvoi d'un événement autrefois refusé.
 *
 *   REJECTED — jugé, refusé, et l'identifiant est BRÛLÉ : le journal du
 *     serveur est en ajout seul, le renvoyer retomberait sur la même ligne et
 *     rendrait le même refus indéfiniment. L'événement est donc sorti de la
 *     file d'envoi et conservé en lecture, avec son motif. Corriger, pour
 *     l'agent, c'est REFAIRE L'ACTION : un événement neuf, un identifiant
 *     neuf. Aucun chemin de cette classe ne permet de repostuler un refusé.
 *
 *   DEFERRED — N'A PAS ÉTÉ JUGÉ. Un événement antérieur de la même opération
 *     a été refusé, et le serveur a délibérément refusé de le journaliser pour
 *     que la tablette puisse le représenter. Il reste donc en file, INCHANGÉ —
 *     même identifiant, même rang, même horodatage. Le régénérer ferait perdre
 *     l'idempotence ; l'abandonner ferait perdre le travail.
 */
@Injectable({ providedIn: 'root' })
export class FieldQueueService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(FieldSessionService);
  private readonly vocabulaire = inject(FieldVocabularyService);

  /**
   * Journal local.
   *
   * Démarre en mémoire et bascule sur le stockage persistant dès qu'il est
   * ouvert. Ce n'est pas une course : `initialiser()` est appelé par le cadre
   * terrain avant tout écran de saisie, et l'interface est asynchrone de bout
   * en bout — un événement déposé entre-temps serait recopié.
   */
  private journal: JournalTerrain = new JournalMemoire();

  /**
   * Vrai quand les saisies survivent à l'extinction de la tablette.
   *
   * Affiché à l'agent. Un « faux » silencieux serait le pire des cas : il
   * travaillerait une journée hors réseau en croyant son travail à l'abri.
   */
  readonly stockageDurable = signal(false);
  readonly avertissementStockage = signal<string | null>(null);

  /**
   * Ouvre le stockage local et REPREND ce qui attendait.
   *
   * ⚠️ Les événements laissés en état « ENVOI » repassent EN ATTENTE.
   *
   *    Cet état signifie « parti, verdict inconnu » : la tablette s'est éteinte
   *    entre l'envoi et la réponse. Les abandonner perdrait le travail ; les
   *    renvoyer ne risque RIEN, puisque l'identifiant vient de l'appareil — le
   *    serveur reconnaîtra un renvoi et rendra le sort déjà prononcé, sans
   *    rien réappliquer. C'est exactement ce pour quoi l'identifiant est
   *    produit ici plutôt que là-bas.
   */
  async initialiser(): Promise<void> {
    const { journal, durable, avertissement } = await journalDisponible();
    this.stockageDurable.set(durable);
    this.avertissementStockage.set(avertissement);

    if (journal) {
      // Ce que la mémoire portait déjà est recopié : un événement déposé avant
      // l'ouverture du stockage ne doit pas se volatiliser à la bascule.
      for (const e of await this.journal.tous()) await journal.ajouter(e);
      this.journal = journal;

      // Les acquittés et les refusés anciens ne repartent plus : on les garde
      // quelques jours, le temps que l'agent ait lu les motifs.
      if (journal instanceof JournalIndexedDb) {
        await journal.purger(RETENTION_JOURS);
      }
    }

    for (const e of await this.journal.tous()) {
      if (e.etat === 'ENVOI') await this.majEtat(e, { etat: 'EN_ATTENTE' });
    }

    await this.recharger();
    await this.envoyer();
  }

  private readonly lignes = signal<EvenementTerrain[]>([]);
  readonly evenements = this.lignes.asReadonly();

  /** À présenter au serveur : jamais un refusé, jamais un acquis. */
  readonly enAttente = computed(() =>
    this.lignes().filter((e) => e.etat === 'EN_ATTENTE' || e.etat === 'SUSPENDU'),
  );
  readonly refuses = computed(() => this.lignes().filter((e) => e.etat === 'REFUSE'));
  readonly acquis = computed(() => this.lignes().filter((e) => e.etat === 'ACQUIS'));

  readonly envoiEnCours = signal(false);

  /**
   * Échec de TRANSPORT — la requête n'a pas abouti, donc RIEN n'a été jugé.
   * Distinct d'un refus : les événements restent en attente et repartiront.
   */
  readonly erreurTransport = signal<string | null>(null);
  readonly dernierRapport = signal<SyncReport | null>(null);

  /** Dernière position connue, apposée sur les événements produits ensuite. */
  private position: { latitude: number; longitude: number } | null = null;
  private veille: number | null = null;

  /**
   * Suivi de position, démarré par le cadre terrain.
   *
   * L'horodatage et la position voyagent dans l'ENVELOPPE de l'événement, et
   * le serveur les préfère à tout ce que la charge utile pourrait dire : un
   * relevé fait à 14 h 32 s'est fait à 14 h 32, quelle que soit l'heure à
   * laquelle il remonte. Un refus de l'utilisateur est sans conséquence — les
   * deux champs sont facultatifs.
   */
  suivrePosition(): void {
    if (this.veille !== null || !('geolocation' in navigator)) return;
    this.veille = navigator.geolocation.watchPosition(
      (p) => {
        this.position = { latitude: p.coords.latitude, longitude: p.coords.longitude };
      },
      () => {
        // Refus ou signal absent : on n'insiste pas et on n'alerte pas. La
        // position est un plus de traçabilité, jamais une condition du travail.
        this.position = null;
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 },
    );
  }

  arreterPosition(): void {
    if (this.veille !== null) {
      navigator.geolocation.clearWatch(this.veille);
      this.veille = null;
    }
  }

  /**
   * Met un événement en file, puis tente de l'envoyer.
   *
   * L'identifiant est produit ICI, sur l'appareil : c'est lui qui rend l'envoi
   * idempotent. Le laisser au serveur dupliquerait tout ce qu'une coupure
   * réseau interrompt entre l'écriture en base et l'accusé de réception.
   */
  async deposer(depot: DepotEvenement): Promise<EvenementTerrain> {
    const evenement: EvenementTerrain = {
      id: nouvelIdentifiant(),
      operationId: depot.operationId,
      type: depot.type,
      payload: depot.payload,
      sequence: await this.journal.prochainRang(),
      deviceTimestamp: new Date().toISOString(),
      ...(this.position ?? {}),
      reference: depot.reference,
      intitule: depot.intitule,
      etat: 'EN_ATTENTE',
      presentations: 0,
    };

    await this.journal.ajouter(evenement);
    await this.recharger();
    await this.envoyer();
    return evenement;
  }

  /**
   * Présente au serveur tout ce qui attend.
   *
   * Un seul envoi à la fois : deux lots concurrents porteraient les mêmes
   * identifiants, et le second ne récolterait que des « déjà connus » — sans
   * dommage, mais sans intérêt non plus.
   */
  async envoyer(): Promise<void> {
    if (this.envoiEnCours()) return;

    const lot = this.enAttente();
    if (lot.length === 0) return;

    this.envoiEnCours.set(true);
    this.erreurTransport.set(null);
    for (const e of lot) await this.majEtat(e, { etat: 'ENVOI' });
    await this.recharger();

    try {
      const rapport = await firstValueFrom(
        this.http.post<SyncReport>('/api/field/sync', {
          deviceId: this.session.appareil,
          events: lot.map(versFilaire),
        }),
      );
      await this.appliquer(lot, rapport);
      this.dernierRapport.set(rapport);
    } catch (erreur) {
      // Aucun sort n'a été rendu : tout retourne en attente, à l'identique.
      // Remettre les événements « en attente » et non « en erreur » est le
      // point sur lequel repose la reprise après coupure.
      for (const e of lot) await this.majEtat(e, { etat: 'EN_ATTENTE' });
      this.erreurTransport.set(messageDeRefus(erreur));
    } finally {
      this.envoiEnCours.set(false);
      await this.recharger();
    }
  }

  private async appliquer(lot: EvenementTerrain[], rapport: SyncReport): Promise<void> {
    const parId = new Map(rapport.outcomes.map((o) => [o.id, o]));
    const maintenant = new Date().toISOString();

    for (const e of lot) {
      const sort = parId.get(e.id);

      // Sort absent du rapport : le serveur ne s'est pas prononcé. On garde,
      // on ne devine pas — l'alternative serait de perdre l'événement pour une
      // réponse incomplète.
      if (!sort) {
        await this.majEtat(e, { etat: 'EN_ATTENTE' });
        continue;
      }

      // Un refus énumère souvent les valeurs admises : on les retient plutôt
      // que de les laisser défiler. Voir `FieldVocabularyService`.
      this.vocabulaire.apprendreDuRefus(sort.reason);

      switch (sort.status) {
        case 'ACCEPTED':
          await this.majEtat(e, { etat: 'ACQUIS', regleLe: maintenant, motif: undefined });
          break;
        case 'REJECTED':
          await this.majEtat(e, { etat: 'REFUSE', regleLe: maintenant, motif: sort.reason });
          break;
        case 'DEFERRED':
          // Reste en file, strictement inchangé. Il repartira au prochain
          // envoi, une fois le refus qui le précède résolu.
          await this.majEtat(e, { etat: 'SUSPENDU', motif: sort.reason });
          break;
      }
    }
  }

  private async majEtat(
    e: EvenementTerrain,
    changement: Partial<Pick<EvenementTerrain, 'etat' | 'motif' | 'regleLe'>>,
  ): Promise<void> {
    const suivant: EvenementTerrain = {
      ...e,
      ...changement,
      presentations: changement.etat === 'ENVOI' ? e.presentations + 1 : e.presentations,
    };
    await this.journal.remplacer(suivant);
  }

  private async recharger(): Promise<void> {
    this.lignes.set(await this.journal.tous());
  }
}

/**
 * Réduit un événement à ce que le serveur attend — et rien de plus.
 *
 * Les champs d'affichage (`reference`, `intitule`, `etat`, `motif`) restent à
 * quai : le DTO du serveur refuse les champs inconnus, et un envoi qui les
 * porterait serait rejeté en bloc.
 */
function versFilaire(e: EvenementTerrain) {
  return {
    id: e.id,
    operationId: e.operationId,
    type: e.type,
    payload: e.payload,
    sequence: e.sequence,
    deviceTimestamp: e.deviceTimestamp,
    ...(e.latitude !== undefined ? { latitude: e.latitude } : {}),
    ...(e.longitude !== undefined ? { longitude: e.longitude } : {}),
  };
}

/**
 * Message d'un échec HTTP, INTÉGRAL.
 *
 * Les motifs du serveur sont rédigés pour l'agent, seul sur site : ils disent
 * quoi faire. Les tronquer ou les remplacer par « une erreur est survenue »
 * renverrait l'agent au bureau pour une information qu'il avait déjà.
 */
export function messageDeRefus(erreur: unknown, defaut = 'Envoi impossible.'): string {
  const corps = (erreur as { error?: { message?: string | string[] } })?.error?.message;
  if (Array.isArray(corps)) return corps.join(' · ');
  if (typeof corps === 'string' && corps !== '') return corps;

  const statut = (erreur as { status?: number })?.status;
  if (statut === 0) {
    return 'Le serveur n’a pas répondu. Les événements restent en file et repartiront au prochain envoi.';
  }
  const message = (erreur as { message?: string })?.message;
  return message ?? defaut;
}
