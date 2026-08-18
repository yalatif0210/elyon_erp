import { Injectable, NotFoundException } from '@nestjs/common';
import { FieldRole, HseCheckOutcome, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * ===========================================================================
 *  PÉRIMÈTRE DU TERRAIN — DÉFINITION UNIQUE
 *  Réf. SPECIFICATIONS.md § 10.3
 *
 *  POURQUOI CE SERVICE EXISTE
 *  --------------------------
 *  Le périmètre était défini TROIS FOIS — dans les opérations, dans la
 *  synchronisation, dans les pièces jointes — et les copies avaient déjà
 *  divergé : celle de la lecture exigeait une checklist entièrement
 *  renseignée, celles de l'écriture non. Le contrôleur HSE pouvait donc
 *  ÉCRIRE sur des opérations qu'il ne pouvait pas AFFICHER. Un périmètre
 *  d'écriture doit être au plus égal au périmètre de lecture, jamais
 *  supérieur.
 *
 *  Pire : un contrôleur terrain entier — celui des contrôles HSE — déléguait
 *  à un service qui n'avait aucune notion de périmètre. Ses quatre routes
 *  adressaient leurs objets par identifiant nu. Un agent lisait la checklist
 *  d'une opération qui ne lui était pas affectée, et le contrôleur HSE
 *  pouvait valider celle d'un autre client — c'est-à-dire OUVRIR LE VERROU
 *  HSE AVANT CHARGEMENT sur une opération étrangère.
 *
 *  D'où ce service : une seule définition, et des vérifications nommées que
 *  chaque route terrain appelle AVANT de déléguer. Le jour où le périmètre
 *  change, il change en un seul endroit.
 *
 *  ⚠️ LE CLOISONNEMENT PORTE SUR DEUX NIVEAUX.
 *
 *     Vérifier que l'opération est bien affectée à l'agent NE SUFFIT PAS : un
 *     identifiant de point de contrôle, de checklist ou de pièce jointe pris
 *     ailleurs permettrait d'écrire dans le dossier d'un autre client par la
 *     porte de derrière. Le rattachement de l'objet à son opération est donc
 *     vérifié à chaque accès, et pas seulement l'opération elle-même.
 * ===========================================================================
 */

export interface FieldActor {
  id: string;
  role: FieldRole | string | undefined;
}

/**
 * Une checklist ATTEND le contrôleur lorsqu'elle est entièrement renseignée
 * et pas encore validée.
 *
 * Un point encore en attente rend la validation impossible : la checklist
 * n'attend alors pas le contrôleur, elle attend l'agent. C'est la définition
 * qu'applique `HseService.validateCheck`, et elle ne doit pas en diverger.
 */
const CHECKLIST_ATTEND_LE_CONTROLEUR: Prisma.OperationHseCheckWhereInput = {
  validatedAt: null,
  items: { none: { outcome: HseCheckOutcome.PENDING } },
};

/**
 * Message IDENTIQUE pour « n'existe pas » et « pas la vôtre ».
 *
 * Les distinguer indiquerait à qui cherche que l'objet existe, et par
 * recoupement qu'un client est servi ce jour-là.
 */
const INTROUVABLE =
  'Cet élément ne figure pas dans votre affectation, ou n’existe pas. Revenez à votre liste d’opérations.';

@Injectable()
export class FieldScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Le périmètre, en clause `WHERE`. LA définition — il n'y en a pas d'autre.
   *
   * L'agent voit ce qui lui est affecté. Le contrôleur HSE voit en plus les
   * opérations dont une checklist attend sa validation : elles ne lui sont pas
   * affectées, et il ne peut pas valider ce qu'il ne peut pas ouvrir.
   */
  where(actor: FieldActor): Prisma.OperationWhereInput {
    const affectee: Prisma.OperationWhereInput = { fieldAgentId: actor.id };
    if (actor.role !== FieldRole.HSE_CONTROLLER) return affectee;
    return {
      OR: [affectee, { hseChecks: { some: CHECKLIST_ATTEND_LE_CONTROLEUR } }],
    };
  }

  /**
   * Rôle EFFECTIF, suppléance comprise (§ 3.4, dérogation HSE_DELEGATION).
   *
   * ⚠️ POURQUOI ICI, ET PAS DANS LE JETON.
   *
   *    Le jeton d'accès ne doit JAMAIS élever silencieusement un rôle : c'est
   *    la garantie posée par `TokenService.sign` (« un changement de rôle
   *    doit passer par une révocation explicite, pas par une élévation
   *    silencieuse »). Baker la suppléance dans le jeton la ferait survivre à
   *    sa révocation jusqu'à l'expiration du jeton — l'inverse de ce que « je
   *    révoque la suppléance » doit vouloir dire.
   *
   *    La fenêtre de suppléance est donc vérifiée EN BASE, à chaque appel, sur
   *    le rôle DÉCLARÉ (`field_users.role`) — jamais réécrite. Un agent
   *    suppléant reste un agent : il en a seulement, pour la fenêtre en cours,
   *    les prérogatives du contrôleur HSE.
   */
  async effectiveActor(actor: FieldActor): Promise<FieldActor> {
    if (actor.role === FieldRole.HSE_CONTROLLER) return actor;
    const suppleance = await this.prisma.delegation.findFirst({
      where: {
        delegatedRole: FieldRole.HSE_CONTROLLER,
        delegateFieldUserId: actor.id,
        revokedAt: null,
        startsAt: { lte: new Date() },
        endsAt: { gte: new Date() },
      },
      select: { id: true },
    });
    return suppleance ? { ...actor, role: FieldRole.HSE_CONTROLLER } : actor;
  }

  /** L'opération est-elle dans mon périmètre ? Sinon : introuvable. */
  async assertOperation(operationId: string, actor: FieldActor): Promise<string> {
    const effectif = await this.effectiveActor(actor);
    const trouvee = await this.prisma.operation.findFirst({
      where: { AND: [{ id: operationId }, this.where(effectif)] },
      select: { id: true },
    });
    if (!trouvee) throw new NotFoundException(INTROUVABLE);
    return trouvee.id;
  }

  /**
   * La checklist appartient-elle à une opération de mon périmètre ?
   *
   * Rend l'identifiant de l'opération : l'appelant en a besoin, et le
   * redemander ferait une seconde lecture non cloisonnée.
   */
  async assertCheck(checkId: string, actor: FieldActor): Promise<string> {
    const effectif = await this.effectiveActor(actor);
    const check = await this.prisma.operationHseCheck.findFirst({
      where: { id: checkId, operation: this.where(effectif) },
      select: { operationId: true },
    });
    if (!check) throw new NotFoundException(INTROUVABLE);
    return check.operationId;
  }

  /** Le point de contrôle appartient-il à une opération de mon périmètre ? */
  async assertCheckItem(itemId: string, actor: FieldActor): Promise<string> {
    const effectif = await this.effectiveActor(actor);
    const item = await this.prisma.operationHseCheckItem.findFirst({
      where: { id: itemId, check: { operation: this.where(effectif) } },
      select: { check: { select: { operationId: true } } },
    });
    if (!item) throw new NotFoundException(INTROUVABLE);
    return item.check.operationId;
  }

  /**
   * L'événement HSE appartient-il à une opération de mon périmètre ?
   *
   * Un événement SANS opération — un quasi-accident survenu au dépôt, hors
   * mission — reste déclarable : il n'a pas de dossier auquel se rattacher, et
   * l'exiger reviendrait à le faire taire.
   */
  async assertHseEvent(eventId: string, actor: FieldActor): Promise<void> {
    const effectif = await this.effectiveActor(actor);
    const evenement = await this.prisma.hseEvent.findFirst({
      where: {
        id: eventId,
        OR: [{ operationId: null }, { operation: this.where(effectif) }],
      },
      select: { id: true },
    });
    if (!evenement) throw new NotFoundException(INTROUVABLE);
  }

  /** Le message d'introuvable, pour les appelants qui le rendent eux-mêmes. */
  get introuvable(): string {
    return INTROUVABLE;
  }
}
