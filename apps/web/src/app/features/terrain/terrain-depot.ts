import { DepotEvenement, FieldQueueService } from '../../core/field-queue.service';

/** Ce que l'écran doit afficher après avoir mis un événement en file. */
export interface CompteRenduDepot {
  /** Vrai seulement si l'effet est EN BASE : c'est ce qui autorise à recharger. */
  acquis: boolean;
  info: string | null;
  erreur: string | null;
}

/**
 * Met un événement en file et traduit son sort en compte rendu.
 *
 * Partagé par tous les écrans de saisie pour que les quatre issues soient
 * traitées de la même façon partout. Les distinguer n'est pas un raffinement :
 * elles n'appellent pas la même conduite, et les confondre ferait perdre du
 * travail.
 *
 *   ACQUIS    l'effet est en base — l'écran peut recharger et repartir de zéro.
 *   REFUSE    jugé et refusé. L'identifiant est brûlé : l'événement ne repart
 *             JAMAIS. Le motif est affiché intégralement, et l'agent est invité
 *             à REFAIRE l'action, ce qui produira un événement neuf.
 *   SUSPENDU  n'a pas été jugé — un refus antérieur sur la même opération le
 *             précède. Il reste en file, inchangé, et repartira seul.
 *   en file   la requête n'a pas abouti. Rien n'est perdu, rien n'est acquis.
 */
export async function deposer(
  file: FieldQueueService,
  depot: DepotEvenement,
): Promise<CompteRenduDepot> {
  const produit = await file.deposer(depot);
  const courant = file.evenements().find((e) => e.id === produit.id);

  switch (courant?.etat) {
    case 'ACQUIS':
      return { acquis: true, info: 'Enregistré.', erreur: null };
    case 'REFUSE':
      return {
        acquis: false,
        info: null,
        erreur: courant.motif ?? 'Refusé par le serveur, sans motif exploitable.',
      };
    case 'SUSPENDU':
      return {
        acquis: false,
        info:
          courant.motif ??
          'Conservé : un refus antérieur sur cette opération doit être résolu d’abord.',
        erreur: null,
      };
    default:
      return {
        acquis: false,
        info: 'Mis en file. L’envoi reprendra dès que le serveur répondra.',
        erreur: null,
      };
  }
}

/** Message d'erreur du serveur, intégral — jamais résumé, jamais tronqué. */
export function messageServeur(e: unknown, defaut: string): string {
  const corps = (e as { error?: { message?: string | string[] } })?.error?.message;
  if (Array.isArray(corps)) return corps.join(' · ');
  if (typeof corps === 'string' && corps !== '') return corps;
  return defaut;
}
