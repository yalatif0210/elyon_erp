import { EvenementTerrain, JournalTerrain } from './field-queue.service';

/**
 * ===========================================================================
 *  JOURNAL LOCAL PERSISTANT
 *  Réf. SPECIFICATIONS.md § 10.2
 *
 *  Décision de la direction, 6 août 2026 :
 *
 *    « Non, je n'accepte pas qu'une journée de terrain sans réseau se perde
 *      si la tablette s'éteint. »
 *
 *  Le journal en mémoire vive perdait tout à l'extinction, au rechargement de
 *  page, et même à la mise en veille prolongée sur certaines tablettes. Une
 *  journée de contrôles HSE saisis sur un site sans couverture disparaissait
 *  sans que rien ne l'annonce.
 *
 *  POURQUOI INDEXEDDB, ET PAS `localStorage`
 *  -----------------------------------------
 *  `localStorage` est SYNCHRONE — il gèle l'interface le temps d'écrire — et
 *  plafonne autour de 5 Mo pour l'ensemble du domaine, photos comprises. Une
 *  journée de terrain le remplit. IndexedDB est asynchrone, se compte en
 *  centaines de mégaoctets, et stocke les binaires sans les encoder.
 *
 *  ⚠️ CE QUE CELA NE GARANTIT PAS
 *
 *     Le navigateur peut ÉVINCER ce stockage : quand l'espace manque, ou après
 *     des semaines sans ouvrir l'application — notablement sur iPad. On demande
 *     donc la persistance durable (`navigator.storage.persist()`), qui la
 *     réduit sans l'écarter. C'est la limite propre au navigateur, celle qu'une
 *     application installée n'aurait pas ; elle est assumée et écrite au § 10.2.
 *
 *     La parade réelle reste la même : envoyer tôt et souvent. Le journal local
 *     est un filet, pas un coffre.
 * ===========================================================================
 */

const BASE = 'elyon-terrain';
const VERSION = 1;
const MAGASIN = 'evenements';

function ouvrir(): Promise<IDBDatabase> {
  return new Promise((resoudre, rejeter) => {
    const requete = indexedDB.open(BASE, VERSION);
    requete.onupgradeneeded = () => {
      const base = requete.result;
      if (!base.objectStoreNames.contains(MAGASIN)) {
        // Clé = l'identifiant produit sur l'appareil, celui-là même qui rend
        // la synchronisation idempotente côté serveur. Réutiliser la même clé
        // des deux côtés évite qu'un événement existe ici sous une identité et
        // là-bas sous une autre.
        base.createObjectStore(MAGASIN, { keyPath: 'id' });
      }
    };
    requete.onsuccess = () => resoudre(requete.result);
    requete.onerror = () => rejeter(requete.error);
  });
}

function promesse<T>(requete: IDBRequest<T>): Promise<T> {
  return new Promise((resoudre, rejeter) => {
    requete.onsuccess = () => resoudre(requete.result);
    requete.onerror = () => rejeter(requete.error);
  });
}

export class JournalIndexedDb implements JournalTerrain {
  private base: Promise<IDBDatabase> | null = null;

  private connexion(): Promise<IDBDatabase> {
    this.base ??= ouvrir();
    return this.base;
  }

  async ajouter(e: EvenementTerrain): Promise<void> {
    await this.ecrire(e);
  }

  async remplacer(e: EvenementTerrain): Promise<void> {
    await this.ecrire(e);
  }

  private async ecrire(e: EvenementTerrain): Promise<void> {
    const base = await this.connexion();
    const t = base.transaction(MAGASIN, 'readwrite');
    // `put` et non `add` : l'ajout et le remplacement sont la même écriture,
    // la clé étant l'identifiant de l'événement. Distinguer les deux ferait
    // échouer un enregistrement d'état sur un événement déjà connu.
    t.objectStore(MAGASIN).put(e);
    await new Promise<void>((resoudre, rejeter) => {
      t.oncomplete = () => resoudre();
      t.onerror = () => rejeter(t.error);
      t.onabort = () => rejeter(t.error);
    });
  }

  async tous(): Promise<EvenementTerrain[]> {
    const base = await this.connexion();
    const t = base.transaction(MAGASIN, 'readonly');
    const lignes = await promesse(t.objectStore(MAGASIN).getAll() as IDBRequest<EvenementTerrain[]>);
    // Trié par rang de production : c'est l'ordre dans lequel le serveur les
    // rejouera, et celui dans lequel l'agent doit les lire.
    return lignes.sort((a, b) => a.sequence - b.sequence);
  }

  async prochainRang(): Promise<number> {
    const lignes = await this.tous();
    return lignes.length === 0 ? 0 : Math.max(...lignes.map((l) => l.sequence)) + 1;
  }

  /**
   * Purge des événements RÉGLÉS et anciens.
   *
   * Ce qui a été accepté ou refusé n'a plus à repartir : le serveur en garde
   * trace, et les refus restent consultables par `/api/field/sync/rejections`.
   * On les conserve néanmoins quelques jours, le temps que l'agent ait vu les
   * motifs — les effacer à l'acquittement ferait disparaître un refus sous les
   * yeux de qui vient de le lire.
   *
   * ⚠️ Ce qui n'a PAS été réglé n'est jamais purgé, quel que soit son âge.
   *    Une opération restée trois semaines hors réseau doit repartir entière.
   */
  async purger(joursDeRetention: number): Promise<number> {
    const limite = Date.now() - joursDeRetention * 86_400_000;
    const lignes = await this.tous();
    const aEffacer = lignes.filter(
      (l) =>
        (l.etat === 'ACQUIS' || l.etat === 'REFUSE') &&
        l.regleLe !== undefined &&
        new Date(l.regleLe).getTime() < limite,
    );
    if (aEffacer.length === 0) return 0;

    const base = await this.connexion();
    const t = base.transaction(MAGASIN, 'readwrite');
    const magasin = t.objectStore(MAGASIN);
    for (const l of aEffacer) magasin.delete(l.id);
    await new Promise<void>((resoudre) => {
      t.oncomplete = () => resoudre();
      t.onerror = () => resoudre();
    });
    return aEffacer.length;
  }
}

/**
 * Le journal utilisable sur cet appareil.
 *
 * ⚠️ IndexedDB peut être ABSENT : navigation privée sur certains navigateurs,
 *    stockage désactivé par une politique d'entreprise. On retombe alors sur
 *    la mémoire vive — mais le repli est SIGNALÉ, jamais silencieux : c'est
 *    exactement la situation où l'agent doit savoir qu'il ne faut pas éteindre
 *    la tablette avant d'avoir retrouvé du réseau.
 */
export async function journalDisponible(): Promise<{
  journal: JournalTerrain | null;
  durable: boolean;
  avertissement: string | null;
}> {
  if (typeof indexedDB === 'undefined') {
    return {
      journal: null,
      durable: false,
      avertissement:
        'Le stockage local est indisponible sur cette tablette : vos saisies ne survivront pas à une fermeture de l’application. Envoyez-les dès que vous retrouvez du réseau, et n’éteignez pas la tablette avant.',
    };
  }

  const journal = new JournalIndexedDb();
  try {
    await journal.tous();
  } catch {
    return {
      journal: null,
      durable: false,
      avertissement:
        'Le stockage local n’a pas pu être ouvert : vos saisies ne survivront pas à une fermeture de l’application. Envoyez-les dès que vous retrouvez du réseau.',
    };
  }

  // Persistance DURABLE : sans elle, le navigateur peut évincer le stockage
  // quand l'espace manque. La demande est accordée ou refusée par le système,
  // sans recours — on rend la réponse plutôt que de la supposer.
  let durable = false;
  try {
    durable = (await navigator.storage?.persist?.()) ?? false;
  } catch {
    durable = false;
  }

  return {
    journal,
    durable,
    avertissement: durable
      ? null
      : 'Vos saisies sont conservées sur la tablette, mais le système peut les effacer s’il manque d’espace. Envoyez-les dès que vous retrouvez du réseau.',
  };
}
