import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * ===========================================================================
 *  STOCKAGE DES PIÈCES JOINTES
 *  Réf. SPECIFICATIONS.md § 10.2
 *
 *  LE BINAIRE N'EST JAMAIS EN BASE. La base porte une CLÉ et une EMPREINTE ;
 *  le fichier vit à côté. Stocker les photos en colonne gonfle chaque
 *  sauvegarde, chaque réplication et chaque restauration d'un volume qui n'a
 *  rien de transactionnel.
 *
 *  ADRESSAGE PAR LE CONTENU
 *  ------------------------
 *  La clé est dérivée de l'empreinte SHA-256 du fichier, pas d'un compteur ni
 *  d'un horodatage. Trois conséquences, toutes voulues :
 *
 *    · la même photo renvoyée deux fois n'occupe la place qu'UNE fois — et
 *      une tablette qui reprend un envoi interrompu renvoie exactement le
 *      même contenu ;
 *    · l'écriture est idempotente : réécrire le même octet au même endroit
 *      n'a aucun effet, donc une reprise n'a rien à défaire ;
 *    · l'intégrité se vérifie sans registre annexe — le nom EST la preuve.
 *
 *  UNE SEULE IMPLÉMENTATION, DERRIÈRE UNE INTERFACE
 *  ------------------------------------------------
 *  Le disque suffit et ne coûte rien : aucun conteneur supplémentaire, aucune
 *  mémoire réservée, aucune surface d'exploitation en plus. Passer un jour à
 *  un stockage objet ne doit toutefois pas obliger à rouvrir les appelants —
 *  d'où cette façade, dont ils ne connaissent que `put`, `read` et `exists`.
 *
 *  ⚠️ Le conteneur de l'API est en LECTURE SEULE. La racine ci-dessous est le
 *     seul chemin monté en écriture ; toute autre destination échouera au
 *     démarrage, et c'est le comportement voulu.
 * ===========================================================================
 */

export interface StoredObject {
  /** Chemin logique — c'est ce que la base conserve. */
  storageKey: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  /** Vrai si le contenu était DÉJÀ là : un renvoi, pas un doublon. */
  alreadyPresent: boolean;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  /**
   * Racine du stockage. Paramétrable par l'environnement parce que le chemin
   * dépend du montage, non du métier : ce n'est pas une donnée de
   * fonctionnement que l'exploitant réglerait depuis un écran.
   */
  private readonly root = resolve(process.env.STORAGE_ROOT ?? '/var/lib/erp/uploads');

  /**
   * Écrit un contenu et rend sa clé.
   *
   * Le fichier est rangé sous deux niveaux tirés de son empreinte. Un seul
   * répertoire finirait par contenir des dizaines de milliers d'entrées, ce
   * que la plupart des systèmes de fichiers supportent mal — et qui rend tout
   * `ls` d'exploitation inutilisable.
   */
  async put(contenu: Buffer, mimeType: string): Promise<StoredObject> {
    const sha256 = createHash('sha256').update(contenu).digest('hex');
    const storageKey = join(sha256.slice(0, 2), sha256.slice(2, 4), sha256);
    const chemin = this.absolu(storageKey);

    const deja = await this.exists(storageKey);
    if (!deja) {
      await mkdir(dirname(chemin), { recursive: true });
      // `flag: 'wx'` échoue si le fichier existe : deux envois simultanés du
      // même contenu ne doivent pas se marcher dessus en cours d'écriture.
      // L'échec est bénin — le contenu est le même, par construction.
      try {
        await writeFile(chemin, contenu, { flag: 'wx' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }

    return {
      storageKey,
      sha256,
      sizeBytes: contenu.length,
      mimeType,
      alreadyPresent: deja,
    };
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await stat(this.absolu(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  /** Flux de lecture — le fichier n'est jamais chargé entier en mémoire. */
  read(storageKey: string): NodeJS.ReadableStream {
    return createReadStream(this.absolu(storageKey));
  }

  /**
   * Contenu entier, en mémoire — réservé aux usages qui en ont réellement
   * besoin, comme l'incrustation d'une photo dans un PDF généré côté serveur
   * (`QRCode.toDataURL` suit le même principe). Tout le reste doit passer par
   * `read()`.
   */
  async readBuffer(storageKey: string): Promise<Buffer> {
    return readFile(this.absolu(storageKey));
  }

  /**
   * Chemin absolu, avec vérification d'ÉCHAPPEMENT.
   *
   * La clé vient de la base, donc d'une valeur qui y a été écrite un jour. Un
   * `../..` glissé dans une clé lors d'une reprise de données ferait lire ou
   * écrire n'importe où sur le disque du conteneur. Le contrôle est sur le
   * chemin RÉSOLU, seul moyen fiable — un filtrage de la chaîne se contourne.
   */
  private absolu(storageKey: string): string {
    const chemin = resolve(this.root, storageKey);
    if (chemin !== this.root && !chemin.startsWith(this.root + sep)) {
      throw new Error(`Clé de stockage hors de la racine : ${storageKey}`);
    }
    return chemin;
  }

  /**
   * Vérifie au démarrage que la racine est accessible EN ÉCRITURE.
   *
   * Sans cela, la panne se découvre au premier envoi de photo, sur le terrain,
   * par l'agent — le pire endroit et le pire moment. Ici, elle se voit dans le
   * journal de démarrage.
   */
  async onModuleInit(): Promise<void> {
    try {
      await mkdir(this.root, { recursive: true });
      const sonde = join(this.root, '.ecriture');
      await writeFile(sonde, '');
      this.logger.log(`Stockage des pièces jointes : ${this.root}`);
    } catch (error) {
      this.logger.error(
        `Stockage INACCESSIBLE EN ÉCRITURE (${this.root}) : ${(error as Error).message}. ` +
          'Aucune photo ne pourra être remontée du terrain. Vérifiez le volume monté sur ce chemin.',
      );
    }
  }
}
