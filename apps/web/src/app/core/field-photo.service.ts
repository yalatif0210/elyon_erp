import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FieldSessionService } from './field-session.service';

/**
 * ===========================================================================
 *  FILE D'ENVOI DES PHOTOS
 *  Réf. SPECIFICATIONS.md § 10.2
 *
 *  « Les photos ne transitent pas dans le flux d'événements — compression sur
 *    l'appareil, file d'envoi séparée avec reprise. Sinon une opération à
 *    vingt photos bloque toute la synchronisation. »
 *
 *  ⚠️ FILE SÉPARÉE DE CELLE DES ÉVÉNEMENTS, ET C'EST TOUT L'INTÉRÊT.
 *
 *     Un point de contrôle renseigné pèse quelques centaines d'octets et doit
 *     partir tout de suite : c'est lui qui débloque l'opération. Une photo
 *     pèse deux mégaoctets et peut attendre le réseau. Les mêler ferait
 *     dépendre le premier de la seconde — un chargement resterait bloqué parce
 *     qu'une photo de scellé n'est pas passée.
 *
 *  L'IDEMPOTENCE EST LA MÊME QUE POUR LES ÉVÉNEMENTS : un identifiant produit
 *  ICI, sur l'appareil. Une reprise après coupure retombe sur la même ligne
 *  côté serveur, qui la rend sans rien réécrire.
 * ===========================================================================
 */

export type EtatPhoto = 'EN_ATTENTE' | 'ENVOI' | 'ACQUISE' | 'REFUSEE';

export interface PhotoTerrain {
  /** Produit sur l'appareil — la clé de l'idempotence. */
  clientUuid: string;
  checkItemId?: string;
  hseEventId?: string;
  /** Aperçu local, affiché avant même que l'envoi ait abouti. */
  apercu: string;
  fichier: Blob;
  nom: string;
  octets: number;
  capturedAt: string;
  etat: EtatPhoto;
  motif?: string;
  /** Identifiant serveur, une fois la pièce acquise. */
  idServeur?: string;
}

/**
 * Compression AVANT envoi.
 *
 * Une tablette récente produit des clichés de 4 à 8 Mo ; le plafond serveur
 * est réglé bien en dessous, et la liaison du terrain encore plus bas. Réduire
 * ici est donc la condition pour que la photo parte — pas une optimisation.
 *
 * Le format de sortie est JPEG quelle que soit l'entrée : c'est le seul que
 * toutes les tablettes savent produire par canevas, et le HEIC de certains
 * appareils n'est pas admis côté serveur.
 */
async function comprimer(fichier: File, cotéMax = 1600, qualite = 0.72): Promise<Blob> {
  const image = await chargerImage(fichier);

  const facteur = Math.min(1, cotéMax / Math.max(image.width, image.height));
  const largeur = Math.round(image.width * facteur);
  const hauteur = Math.round(image.height * facteur);

  const canevas = document.createElement('canvas');
  canevas.width = largeur;
  canevas.height = hauteur;
  const contexte = canevas.getContext('2d');
  if (!contexte) return fichier;
  contexte.drawImage(image, 0, 0, largeur, hauteur);

  const compresse = await new Promise<Blob | null>((resoudre) =>
    canevas.toBlob(resoudre, 'image/jpeg', qualite),
  );

  // Si la compression n'aboutit pas, ou rend PLUS LOURD qu'à l'entrée — cas
  // réel sur un cliché déjà très compressé — on garde l'original. Envoyer
  // sciemment plus gros au nom de la compression n'aurait aucun sens.
  if (!compresse || compresse.size >= fichier.size) return fichier;
  return compresse;
}

function chargerImage(fichier: Blob): Promise<HTMLImageElement> {
  return new Promise((resoudre, rejeter) => {
    const url = URL.createObjectURL(fichier);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resoudre(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      rejeter(new Error('Fichier illisible comme image.'));
    };
    image.src = url;
  });
}

function motifDe(erreur: unknown, defaut: string): string {
  const e = erreur as { error?: { message?: string | string[] }; message?: string };
  const m = e?.error?.message;
  if (Array.isArray(m)) return m.join(' · ');
  if (typeof m === 'string') return m;
  return e?.message ?? defaut;
}

@Injectable({ providedIn: 'root' })
export class FieldPhotoService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(FieldSessionService);

  private readonly lignes = signal<PhotoTerrain[]>([]);
  readonly photos = this.lignes.asReadonly();

  readonly enAttente = computed(() =>
    this.lignes().filter((p) => p.etat === 'EN_ATTENTE' || p.etat === 'ENVOI'),
  );
  readonly refusees = computed(() => this.lignes().filter((p) => p.etat === 'REFUSEE'));

  /** Photos rattachées à un point de contrôle, pour l'affichage. */
  pourPoint(checkItemId: string): PhotoTerrain[] {
    return this.lignes().filter((p) => p.checkItemId === checkItemId);
  }

  /**
   * Met une photo en file et tente de l'envoyer.
   *
   * L'aperçu est disponible IMMÉDIATEMENT, avant tout envoi : l'agent doit
   * voir ce qu'il vient de prendre pour juger s'il recommence, sans attendre
   * un réseau qu'il n'a peut-être pas.
   */
  async ajouter(
    fichier: File,
    rattachement: { checkItemId?: string; hseEventId?: string },
  ): Promise<void> {
    let contenu: Blob = fichier;
    try {
      contenu = await comprimer(fichier);
    } catch {
      // Illisible comme image — un PDF d'autorisation, par exemple. On l'envoie
      // tel quel : le serveur dira s'il l'admet, avec la liste des types.
      contenu = fichier;
    }

    const photo: PhotoTerrain = {
      clientUuid: crypto.randomUUID(),
      ...rattachement,
      apercu: URL.createObjectURL(contenu),
      fichier: contenu,
      nom: fichier.name || 'photo.jpg',
      octets: contenu.size,
      capturedAt: new Date().toISOString(),
      etat: 'EN_ATTENTE',
    };

    this.lignes.update((l) => [...l, photo]);
    await this.envoyer();
  }

  /**
   * Présente au serveur tout ce qui attend, UNE PHOTO À LA FOIS.
   *
   * En série et non en parallèle : la liaison du terrain est étroite, et
   * quatre envois concurrents se partagent la bande passante sans qu'aucun
   * n'aboutisse. Une par une, chacune est acquise dès qu'elle passe.
   */
  async envoyer(): Promise<void> {
    for (const photo of this.lignes().filter((p) => p.etat === 'EN_ATTENTE')) {
      this.majEtat(photo.clientUuid, { etat: 'ENVOI', motif: undefined });

      const corps = new FormData();
      corps.append('clientUuid', photo.clientUuid);
      if (photo.checkItemId) corps.append('checkItemId', photo.checkItemId);
      if (photo.hseEventId) corps.append('hseEventId', photo.hseEventId);
      corps.append('capturedAt', photo.capturedAt);
      corps.append('deviceTimestamp', new Date().toISOString());
      corps.append('file', photo.fichier, photo.nom);

      try {
        const rendu = await firstValueFrom(
          this.http.post<{ id: string; alreadyPresent?: boolean }>(
            '/api/field/attachments',
            corps,
          ),
        );
        this.majEtat(photo.clientUuid, { etat: 'ACQUISE', idServeur: rendu.id });
      } catch (erreur) {
        const statut = (erreur as { status?: number }).status ?? 0;
        // Panne de RÉSEAU (statut 0) : rien n'a été jugé, la photo repart.
        // Refus du SERVEUR : le motif dit quoi faire — compresser, changer de
        // format — et l'agent doit le lire, pas le voir disparaître dans une
        // reprise silencieuse.
        this.majEtat(photo.clientUuid, {
          etat: statut === 0 ? 'EN_ATTENTE' : 'REFUSEE',
          motif:
            statut === 0
              ? undefined
              : motifDe(erreur, 'Pièce refusée par le serveur, sans motif exploitable.'),
        });
      }
    }
  }

  /** Retire une photo refusée que l'agent renonce à envoyer. */
  retirer(clientUuid: string): void {
    const photo = this.lignes().find((p) => p.clientUuid === clientUuid);
    if (photo) URL.revokeObjectURL(photo.apercu);
    this.lignes.update((l) => l.filter((p) => p.clientUuid !== clientUuid));
  }

  private majEtat(clientUuid: string, changement: Partial<PhotoTerrain>): void {
    this.lignes.update((l) =>
      l.map((p) => (p.clientUuid === clientUuid ? { ...p, ...changement } : p)),
    );
  }
}
