import {
  ForbiddenException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import { CommercialSegment, Prisma, UserRole } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';
import { Realm, RequireRealm, Roles, Screen, SkipAudit } from '../common/auth/realm';
import { Page, PaginationQuery, paginate } from '../common/http/pagination.dto';
import { FxService } from '../common/money/fx.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { findReferential, rolesDeLecture, vocabulaires } from './registry';

/**
 * Lecture des référentiels du lot 1.
 *
 * Ces données sont administrées, peu volumineuses et très lues : elles
 * alimentent les listes déroulantes de toute l'application. Les écritures
 * relèvent de la console d'administration et sont traitées séparément, avec
 * les contrôles de rôle correspondants.
 */
@Injectable()
export class ReferentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
  ) {}

  /**
   * Cours courant du pivot vers la devise locale d'affichage.
   *
   * Sert les écrans qui agrègent eux-mêmes des lignes déjà converties au
   * pivot (ex. les statistiques de tête de la console Achats) : elles n'ont
   * plus qu'à multiplier par ce cours pour restituer un total en XOF, jamais
   * en pivot.
   */
  async pivotLocalRate() {
    const [pivot, local, rate] = await Promise.all([
      this.fx.pivotCode(),
      this.fx.localCode(),
      this.fx.pivotToLocalRate(),
    ]);
    return { pivot, local, rate };
  }

  /** Libellés des énumérations sans référentiel propre (voir registry.ts). */
  vocabulaires() {
    return vocabulaires();
  }

  currencies() {
    return this.prisma.currency.findMany({
      where: { isActive: true },
      orderBy: [{ isPivot: 'desc' }, { isLocal: 'desc' }, { code: 'asc' }],
      select: {
        code: true,
        name: true,
        symbol: true,
        decimalPlaces: true,
        isPivot: true,
        isLocal: true,
        isFunctional: true,
        isDocumentEligible: true,
        pegCurrencyCode: true,
        pegRate: true,
      },
    });
  }

  products() {
    return this.prisma.product.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  /** Répertoire des postes de coûts — les deux axes, nature et variabilité. */
  costPosts() {
    return this.prisma.costPost.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
      include: { costPool: { select: { code: true, label: true, allocationBasis: true } } },
    });
  }

  /**
   * Types d'opération proposés à la création (§ 7.1).
   *
   * Le nombre de checklists rattachées est renvoyé avec chaque type : un type
   * qui n'en porte aucune n'apporte aucun contrôle, et celui qui compose le
   * déroulé doit pouvoir s'en apercevoir au moment où il choisit, pas au
   * moment où la checklist s'ouvre vide.
   */
  async operationTypes(segment?: CommercialSegment) {
    const rows = await this.prisma.operationType.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
      include: {
        _count: { select: { checklists: { where: { isActive: true, isCurrent: true } } } },
      },
    });

    // Une liste de segments VIDE vaut « tous » — la même convention que les
    // checklists. Filtrer sur l'appartenance stricte masquerait les types
    // génériques, c'est-à-dire la majorité.
    return rows
      .filter((t) => !segment || t.segments.length === 0 || t.segments.includes(segment))
      .map(({ _count, ...t }) => ({ ...t, checklistCount: _count.checklists }));
  }

  /**
   * Modèles de checklist HSE — servis pour ALIMENTER LES LISTES DE CHOIX.
   *
   * Sans cette lecture, le champ « Modèle de checklist » de l'écran de
   * paramétrage retombe en saisie libre et l'utilisateur doit deviner le code
   * exact : une faute de frappe rattache un point de contrôle à rien, et le
   * point n'est jamais opposé sur le terrain.
   */
  hseChecklists() {
    return this.prisma.hseChecklistTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ code: 'asc' }],
      select: {
        id: true,
        code: true,
        label: true,
        version: true,
        isCurrent: true,
        operationTypes: { select: { code: true, label: true } },
        _count: { select: { items: true } },
      },
    });
  }

  /**
   * Exigences d'un site de livraison — consultables partout où le site apparaît.
   *
   * Une seule lecture pour tous les écrans qui en ont besoin : préparation
   * d'opération, dossier d'opération, fiche de site sur la tablette. Deux
   * lectures finiraient par diverger, et c'est l'agent devant la barrière qui
   * en paierait le prix.
   */
  siteRequirements(siteId: string) {
    return this.prisma.siteRequirement.findMany({
      where: { siteId: siteId, isActive: true, type: { isActive: true } },
      orderBy: { type: { displayOrder: 'asc' } },
      select: {
        id: true,
        detail: true,
        isBlocking: true,
        type: { select: { code: true, label: true, description: true } },
      },
    });
  }

  /**
   * Sites, filtrés par USAGE.
   *
   * ⚠️ L'USAGE EST UNE DONNÉE DU LIEU, PAS UNE DÉDUCTION SUR SA NATURE.
   *
   *    Rien ici ne présume qu'une station-service ne charge pas, ni qu'un
   *    dépôt ne reçoit pas : c'est l'exploitant qui déclare, site par site, ce
   *    que le lieu sait faire. Une station-service EST un lieu de chargement
   *    dans ce métier — on y prend du produit pour dépanner un client, et le
   *    système ne doit pas en décider à la place de qui le sait.
   *
   *    Le filtre ne fait donc que refléter ce qui a été déclaré. Un lieu qui
   *    porte les deux usages apparaît dans les deux listes — c'est le cas que
   *    l'ancien modèle obligeait à dupliquer.
   */
  sites(usage?: 'LOADING' | 'DELIVERY') {
    return this.prisma.site.findMany({
      where: {
        isActive: true,
        ...(usage ? { usages: { has: usage as never } } : {}),
      },
      orderBy: [{ city: 'asc' }, { name: 'asc' }],
      select: {
        id: true, code: true, name: true, city: true, usages: true,
        accessInstructions: true, openingHours: true, safetyInstructions: true,
        defaultHseRiskLevel: true,
        requirements: {
          where: { isActive: true },
          orderBy: { type: { displayOrder: 'asc' } },
          select: {
            id: true, detail: true, isBlocking: true,
            type: { select: { code: true, label: true, description: true } },
          },
        },
      },
    });
  }

  /** Taux d'absorption courants — dénominateur budgété (§ 14.2). */
  absorptionRates(fiscalYear: number) {
    return this.prisma.absorptionRate.findMany({
      // L'exercice est désormais une RÉFÉRENCE, plus un entier libre. On le
      // désigne toujours par son millésime — c'est ainsi qu'un humain le
      // nomme — mais la jointure garantit qu'il existe.
      where: { fiscalYear: { year: fiscalYear }, isCurrent: true },
      include: {
        costPool: {
          select: { code: true, label: true, allocationBasis: true, segments: true, variability: true },
        },
        fiscalYear: { select: { year: true, label: true, status: true } },
      },
      orderBy: { costPool: { code: 'asc' } },
    });
  }

  /**
   * Numéros de version encore libres pour une identité donnée.
   *
   * ⚠️ LES VERSIONS SE COMPTENT PAR IDENTITÉ, PAS GLOBALEMENT.
   *
   *    La version 1 du pool Administration 2026 et la version 1 du pool HSE
   *    2026 coexistent normalement. Les numéros libres dépendent donc du pool
   *    ET de l'exercice déjà choisis dans le formulaire — c'est pourquoi cette
   *    route prend les valeurs d'identité en paramètres plutôt que de rendre
   *    une liste fixe.
   *
   *    `suivant` est le premier numéro libre : c'est celui que l'écran
   *    présélectionne. Dans la quasi-totalité des cas on enchaîne 1, 2, 3, et
   *    faire lire cent lignes pour cliquer sur « 4 » serait plus pénible que
   *    sûr — sans retirer la possibilité d'en choisir un autre.
   */
  async versionsLibres(key: string, identite: Record<string, string>) {
    const spec = findReferential(key);
    if (!spec) {
      throw new NotFoundException(`Référentiel « ${key} » inconnu.`);
    }

    const champ = spec.fields.find((f) => f.type === 'version');
    if (!champ) {
      throw new NotFoundException(
        `Le référentiel « ${key} » ne porte pas de champ de version : il n'est pas historisé.`,
      );
    }

    // On ne retient que les champs d'identité RENSEIGNÉS. Tant que le
    // formulaire est incomplet, la liste porte sur ce qui est déjà choisi —
    // et non sur rien, ce qui laisserait croire que tout est libre.
    //
    // ⚠️ LES RÉFÉRENCES ARRIVENT EN CLÉ LISIBLE, PAS EN IDENTIFIANT.
    //
    //    L'écran envoie « ADM » et « 2026 » : c'est ce qu'il affiche, et c'est
    //    ce que l'utilisateur a choisi. Les colonnes, elles, portent des UUID.
    //    Sans cette résolution, PostgreSQL reçoit « ADM » pour un uuid et
    //    rejette la requête entière — la liste de versions retombait alors sur
    //    son repli 1 à 100, donc proposait des numéros DÉJÀ PRIS. Le défaut se
    //    serait vu à l'écriture, sur un conflit d'unicité incompréhensible.
    const where: Record<string, unknown> = {};
    for (const nom of spec.identity) {
      if (nom === champ.name) continue;
      const brut = identite[nom];
      if (brut === undefined || brut === '') continue;

      const decl = spec.fields.find((f) => f.name === nom);

      if (decl?.type === 'reference' && nom.endsWith('Id')) {
        const cible = findReferential(decl.refTable ?? '');
        const refKey = decl.refKey ?? 'code';
        // Le type de la clé lisible est LU dans le référentiel visé : un
        // exercice se désigne par son millésime, qui est un entier.
        const champCle = cible?.fields.find((f) => f.name === refKey);
        const valeur =
          champCle?.type === 'integer' || champCle?.type === 'number' ? Number(brut) : brut;

        const delegateCible = (this.prisma as unknown as Record<string, unknown>)[
          cible?.model ?? ''
        ] as { findFirst: (a: unknown) => Promise<Record<string, unknown> | null> } | undefined;

        const row = await delegateCible?.findFirst({
          where: { [refKey]: valeur },
          select: { id: true },
        });
        // Référence inconnue : aucune ligne ne peut exister pour elle, donc
        // toutes les versions sont libres. On le dit en filtrant sur un
        // identifiant impossible plutôt qu'en ignorant le critère — l'ignorer
        // rendrait la liste des versions d'un AUTRE pool.
        where[nom] = row?.['id'] ?? '00000000-0000-0000-0000-000000000000';
        continue;
      }

      where[nom] =
        decl?.type === 'integer' || decl?.type === 'number' ? Number(brut) : brut;
    }

    const delegate = (this.prisma as unknown as Record<string, unknown>)[spec.model] as {
      findMany: (a: unknown) => Promise<Record<string, unknown>[]>;
    };

    const lignes = await delegate.findMany({
      where,
      select: { [champ.name]: true },
      take: 500,
    });

    const prises = new Set(lignes.map((l) => Number(l[champ.name])));
    // Cent numéros : au-delà, ce n'est plus une révision, c'est une saisie qui
    // part en boucle. La borne est ici, dans une seule expression, plutôt que
    // répétée dans l'écran et dans l'import.
    const toutes = Array.from({ length: 100 }, (_, i) => i + 1);
    const libres = toutes.filter((n) => !prises.has(n));

    return {
      champ: champ.name,
      prises: [...prises].sort((a, b) => a - b),
      libres,
      suivant: libres[0] ?? null,
    };
  }

  /** Grille des seuils de marge — plancher direct et seuil minimum (§ 5.4). */
  marginThresholds() {
    return this.prisma.marginThreshold.findMany({
      where: { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
      orderBy: [{ segment: 'asc' }, { effectiveFrom: 'desc' }],
      include: { product: { select: { code: true, name: true } } },
    });
  }

  /** Grille de tolérance d'écart de volume (§ 8.3). */
  ullageTolerances() {
    return this.prisma.ullageTolerance.findMany({
      where: { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
      orderBy: { effectiveFrom: 'desc' },
      include: { product: { select: { code: true, name: true } } },
    });
  }

  /** Taux de change en vigueur, tous types confondus. */
  fxRates() {
    return this.prisma.fxRate.findMany({
      where: { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
      orderBy: [{ baseCurrencyCode: 'asc' }, { effectiveFrom: 'desc' }],
      take: 100,
    });
  }

  /** Prix administrés en vigueur — référence consultable (§ 5.3). */
  administeredPrices() {
    return this.prisma.administeredPrice.findMany({
      where: { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
      orderBy: [{ referenceType: 'asc' }, { effectiveFrom: 'desc' }],
      include: { product: { select: { code: true, name: true } } },
      take: 100,
    });
  }

  /**
   * Répertoire des tiers.
   *
   * ⚠️ Le PLAFOND et le STATUT de crédit ne sortent que pour les rôles qui y
   *    ont droit. Les autres ont besoin de la liste — pour choisir un client,
   *    un transporteur, un site — pas de son risque financier. Les retirer de
   *    la sélection plutôt que de refuser la route entière : le coordinateur
   *    logistique doit pouvoir choisir un transporteur.
   */
  async partners(
    query: PaginationQuery & { type?: string },
    role?: UserRole,
  ): Promise<Page<unknown>> {
    const voitLeCredit =
      role === UserRole.DG ||
      role === UserRole.FINANCE_CFO ||
      role === UserRole.ACCOUNTANT ||
      role === UserRole.CCOO;
    const where = {
      isActive: true,
      ...(query.type ? { type: query.type as never } : {}),
      ...(query.search
        ? {
            OR: [
              { legalName: { contains: query.search, mode: 'insensitive' as const } },
              { code: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.partner.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { legalName: 'asc' },
        // ⚠️ CE QUI SORT EST ÉNUMÉRÉ, ET LE RISQUE CRÉDIT EN EST ABSENT SAUF
        //    POUR QUI Y A DROIT.
        //
        //    La requête rendait le modèle ENTIER — plafond, statut et
        //    approbateur de crédit compris — à tout rôle interne, alors que la
        //    route dédiée (`/supervision/credit-exposure`) répond 403 au
        //    coordinateur logistique. Une habilitation ne vaut rien si une
        //    autre porte l'ignore.
        //
        //    Énuméré plutôt que masqué : une colonne ajoutée demain ne sortira
        //    pas par défaut. C'est le bon sens du défaut sur une route qui
        //    sert des données de risque.
        select: {
          id: true,
          code: true,
          legalName: true,
          type: true,
          countryCode: true,
          segment: true,
          taxpayerAccountNumber: true,
          rccmNumber: true,
          taxRegime: true,
          isVatExempt: true,
          vatExemptionReference: true,
          isGovernmentInstitution: true,
          paymentTermsDays: true,
          supplierTermsDays: true,
          isActive: true,
          ...(voitLeCredit
            ? {
                creditLimit: true as const,
                creditLimitCurrencyCode: true as const,
                creditStatus: true as const,
              }
            : {}),
          // Le site de livraison ne se choisit plus depuis la fiche tiers : il
          // vient du référentiel autonome des sites (`GET .../sites?usage=
          // DELIVERY`), qui l'expose déjà avec ses exigences — un lieu peut
          // servir plusieurs clients, il n'appartient pas à l'un d'eux (§ 6.2).
          _count: { select: { complianceRecords: true, vehicles: true, drivers: true } },
        },
      }),
      this.prisma.partner.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  /** Paramètres métier — seuils, taux de financement, préavis d'alerte. */
  settings() {
    return this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
  }

  /**
   * Lecture d'un référentiel désigné par sa CLÉ DE REGISTRE.
   *
   * Sert les référentiels qu'aucune route spécifique ne couvre — seize sur
   * vingt-neuf au moment où cette méthode a été écrite. Le registre est la
   * seule source : un référentiel ajouté devient lisible sans qu'on écrive
   * quoi que ce soit ici.
   *
   * ⚠️ PLAFOND À 500 LIGNES, ET C'EST DÉLIBÉRÉ.
   *
   *    Cette lecture alimente des listes déroulantes. Au-delà de quelques
   *    centaines d'entrées, une liste déroulante n'est plus utilisable et il
   *    faut une recherche — le plafond fait apparaître le besoin au lieu de
   *    laisser l'écran ramer en silence sur dix mille lignes.
   */
  async parReferentiel(
    key: string,
    role?: UserRole,
    pagination: { page?: number; pageSize?: number; search?: string; filter?: Record<string, string> } = {},
  ) {
    const spec = findReferential(key);
    if (!spec) {
      throw new NotFoundException(
        `Référentiel « ${key} » inconnu. Les référentiels disponibles sont ceux du registre.`,
      );
    }

    // Le rôle se vérifie ICI, sur les rôles dérivés du registre : le
    // décorateur de route ignore quelle clé sera demandée.
    if (role && !rolesDeLecture(key).includes(role)) {
      throw new ForbiddenException(
        `Votre rôle ne donne pas accès au référentiel « ${spec.label} ».`,
      );
    }

    const delegate = (this.prisma as unknown as Record<string, unknown>)[spec.model] as {
      findMany: (a: unknown) => Promise<Record<string, unknown>[]>;
      count: (a: unknown) => Promise<number>;
    };
    if (!delegate) {
      throw new NotFoundException(`Référentiel « ${key} » sans table associée.`);
    }

    // ⚠️ LES RÉFÉRENCES SONT RENDUES LISIBLES, PAS BRUTES.
    //
    //    Une ligne rendue telle quelle porte « 6b7c54a9-a952-… » là où
    //    l'exploitant a choisi « exercice 2026 ». Un écran de consultation
    //    qui affiche des identifiants techniques ne se consulte pas : il se
    //    referme.
    //
    //    Le nom de la relation n'est pas DEVINÉ en retirant « Id » : il est lu
    //    dans le modèle lui-même. La convention tient aujourd'hui ; le jour où
    //    une relation s'en écarte, deviner échouerait à l'exécution, sur cet
    //    écran-là seulement, et sans rien expliquer.
    const modele = Prisma.dmmf.datamodel.models.find(
      (m) => m.name.toLowerCase() === spec.model.toLowerCase(),
    );
    const relations: Record<string, { relation: string; cle: string }> = {};
    const relationsListe: Record<string, { relation: string; cle: string }> = {};
    const include: Record<string, unknown> = {};

    for (const f of spec.fields) {
      if (f.type !== 'reference' || !f.name.endsWith('Id')) continue;
      const rel = modele?.fields.find(
        (x) => x.kind === 'object' && (x.relationFromFields ?? []).includes(f.name),
      );
      if (!rel) continue;
      const cleLisible = f.refKey ?? 'code';
      relations[f.name] = { relation: rel.name, cle: cleLisible };
      include[rel.name] = { select: { [cleLisible]: true } };
    }

    // ⚠️ UNE `referenceList` PORTÉE PAR UNE VRAIE RELATION (PAS UN TABLEAU
    //    SCALAIRE) N'ÉTAIT JAMAIS INCLUSE — LA COLONNE RESTAIT VIDE PARTOUT.
    //
    //    La boucle ci-dessus ne reconnaît que les références SIMPLES (`xxxId`,
    //    relation vers UNE ligne). Un modèle de checklist HSE porte ses types
    //    d'opération par une relation plusieurs-à-plusieurs (`operationTypes`,
    //    § `relation` sur le champ) : sans `include`, Prisma ne rend aucune
    //    donnée sur cette relation, et « Ce qui est enregistré » affichait un
    //    tiret sur toutes les lignes — pas une absence de types couverts, une
    //    absence de lecture.
    for (const f of spec.fields) {
      if (f.type !== 'referenceList' || f.scalarList || !f.relation) continue;
      const rel = modele?.fields.find((x) => x.kind === 'object' && x.name === f.relation);
      if (!rel) continue;
      const cleLisible = f.refKey ?? 'code';
      relationsListe[f.name] = { relation: rel.name, cle: cleLisible };
      include[rel.name] = { select: { [cleLisible]: true } };
    }

    // ⚠️ UN TABLEAU SCALAIRE D'UUID (`scalarList: true`) N'EST PAS UNE
    //    RELATION PRISMA — AUCUN `include` NE PEUT LE RÉSOUDRE.
    //
    //    `allowedProductIds` sur un véhicule en est un : la boucle
    //    précédente l'ignore explicitement (`f.scalarList`), et sans lecture
    //    séparée, l'écran affichait les UUID bruts — « d16090f6-…,
    //    e859a8ce-… » — au lieu des codes produit. La résolution se fait donc
    //    à part, une fois les lignes lues : recherche groupée sur la table
    //    visée, pas une requête par ligne.
    const champsListeScalaire = spec.fields.filter(
      (f) => f.type === 'referenceList' && f.scalarList && f.refTable,
    );

    // ⚠️ LA COUPURE MUETTE À 500 LIGNES EST REMPLACÉE PAR UNE VRAIE PAGINATION.
    //
    //    L'écran affichait « 500 ligne(s) » sans distinguer 500 d'« au moins
    //    500 ». Les prix publiés et les cours de change franchissent ce seuil
    //    en moins d'un an : on aurait conclu qu'une ligne n'existe pas alors
    //    qu'elle était au-delà de la coupure.
    //
    //    La recherche porte sur les colonnes TEXTE du référentiel, celles dans
    //    lesquelles un humain cherche. Chercher dans un identifiant technique
    //    n'aurait aucun sens ; chercher dans un montant non plus.
    const cle = spec.identity[0];
    const page = Math.max(1, Number(pagination.page ?? 1));
    // ⚠️ `pageSize: 0` VEUT DIRE « TOUT », ET IL FAUT QUE CELA EXISTE.
    //
    //    En corrigeant la coupure muette à 500, j'ai fait passer la route des
    //    listes déroulantes par une page de 200 : le même défaut, à un seuil
    //    plus bas. Une liste de choix tronquée est pire qu'une liste longue —
    //    l'élément absent n'est pas signalé, il est simplement introuvable.
    //
    //    La consultation demande donc une page ; les listes de choix demandent
    //    tout, explicitement.
    const tout = Number(pagination.pageSize) === 0;
    const pageSize = tout
      ? Number.MAX_SAFE_INTEGER
      : Math.min(200, Math.max(5, Number(pagination.pageSize ?? 50)));
    const recherche = (pagination.search ?? '').trim();

    const modeleTexte = Prisma.dmmf.datamodel.models.find(
      (m) => m.name.toLowerCase() === spec.model.toLowerCase(),
    );
    const colonnesTexte = (modeleTexte?.fields ?? [])
      .filter((f) => f.kind === 'scalar' && f.type === 'String' && !f.isList && f.name !== 'id')
      .filter((f) => spec.fields.some((d) => d.name === f.name))
      .map((f) => f.name);

    // ⚠️ LE FILTRE N'ACCEPTE QUE DES COLONNES RÉELLEMENT DÉCLARÉES AU
    //    RÉFÉRENTIEL — jamais une clé arbitraire venue de l'appelant, qui
    //    atteindrait sinon une colonne quelconque du modèle Prisma, exposée
    //    ou non par ce référentiel.
    const filtre = pagination.filter ?? {};
    const filtreValide: Record<string, string> = {};
    for (const [champ, valeur] of Object.entries(filtre)) {
      if (spec.fields.some((f) => f.name === champ)) filtreValide[champ] = valeur;
    }

    const where =
      recherche && colonnesTexte.length > 0
        ? {
            OR: colonnesTexte.map((c) => ({
              [c]: { contains: recherche, mode: 'insensitive' as const },
            })),
            ...filtreValide,
          }
        : filtreValide;

    const [lignes, total] = await Promise.all([
      delegate.findMany({
        where,
        orderBy: { [cle]: 'asc' },
        ...(tout ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
        ...(Object.keys(include).length > 0 ? { include } : {}),
      }),
      delegate.count({ where }),
    ]);

    // Résolution des tableaux scalaires (§ ci-dessus) : une recherche groupée
    // par champ, sur l'UNION des identifiants portés par toutes les lignes de
    // la page — jamais une requête par ligne.
    const scalarListMaps = new Map<string, Map<string, string>>();
    for (const f of champsListeScalaire) {
      const ids = new Set<string>();
      for (const l of lignes) {
        for (const id of (l[f.name] as string[] | undefined) ?? []) ids.add(id);
      }
      if (ids.size === 0) continue;
      const cible = findReferential(f.refTable ?? '');
      const refKey = f.refKey ?? 'code';
      const delegateCible = (this.prisma as unknown as Record<string, unknown>)[
        cible?.model ?? ''
      ] as { findMany: (a: unknown) => Promise<Record<string, unknown>[]> } | undefined;
      const trouves =
        (await delegateCible?.findMany({
          where: { id: { in: [...ids] } },
          select: { id: true, [refKey]: true },
        })) ?? [];
      const map = new Map<string, string>();
      for (const r of trouves) map.set(r.id as string, String(r[refKey]));
      scalarListMaps.set(f.name, map);
    }

    // La clé lisible est posée À CÔTÉ de l'identifiant, jamais à sa place :
    // l'écran de consultation montre l'une, la modification a besoin de
    // l'autre.
    const items = lignes.map((l) => {
      const lisible: Record<string, unknown> = {};
      for (const [champ, { relation, cle: k }] of Object.entries(relations)) {
        const cible = l[relation] as Record<string, unknown> | null | undefined;
        if (cible) lisible[champ] = cible[k];
      }
      // Une relation plusieurs-à-plusieurs rend un TABLEAU de lignes, jamais
      // une seule : la clé lisible de chacune, jointe pour l'affichage.
      for (const [champ, { relation, cle: k }] of Object.entries(relationsListe)) {
        const cibles = l[relation] as Record<string, unknown>[] | undefined;
        if (cibles) lisible[champ] = cibles.map((c) => c[k]).join(', ');
      }
      // Tableau scalaire d'UUID : la même jointure, mais depuis la carte
      // construite ci-dessus plutôt que depuis un `include` Prisma.
      for (const f of champsListeScalaire) {
        const valeurs = l[f.name] as string[] | undefined;
        if (valeurs && valeurs.length > 0) {
          const map = scalarListMaps.get(f.name);
          lisible[f.name] = valeurs.map((id) => map?.get(id) ?? id).join(', ');
        }
      }
      return { ...l, _lisible: lisible };
    });

    return {
      items,
      page,
      pageSize,
      total,
      totalPages: tout ? 1 : Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}

/**
 * Toute propriété d'un DTO doit porter un décorateur de validation : avec
 * `forbidNonWhitelisted`, class-transformer matérialise la propriété même
 * absente de la requête, et le validateur la rejette comme non déclarée.
 */
class PartnerQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(['CLIENT', 'PROSPECT', 'SUPPLIER', 'CARRIER', 'INSPECTOR'])
  type?: string;
}

@Controller('api/internal/referentials')
@RequireRealm(Realm.INTERNAL)
@SkipAudit()
export class ReferentialsController {
  constructor(private readonly service: ReferentialsService) {}

  @Get('currencies')
  @Screen('referentiels')
  currencies() {
    return this.service.currencies();
  }

  @Get('fx-rates')
  fxRates() {
    return this.service.fxRates();
  }

  @Get('pivot-local-rate')
  pivotLocalRate() {
    return this.service.pivotLocalRate();
  }

  // Ouvert à tout rôle interne authentifié, sans @Roles ni @Screen : ces
  // libellés alimentent des formulaires opérationnels (déclaration HSE,
  // règlement d'une facture, relance, pièce de conformité), pas un écran
  // d'administration.
  @Get('vocabulaires')
  vocabulaires() {
    return this.service.vocabulaires();
  }

  @Get('products')
  products() {
    return this.service.products();
  }

  @Get('administered-prices')
  administeredPrices() {
    return this.service.administeredPrices();
  }

  /**
   * ⚠️ CETTE ROUTE SERT DES DONNÉES DE RISQUE CLIENT.
   *
   *    `partners()` rend le modèle entier, plafond de crédit et statut de
   *    crédit compris. Elle ne portait AUCUN contrôle de rôle : le
   *    coordinateur logistique, à qui `/supervision/credit-exposure` répond
   *    403, y lisait les plafonds et les encours de tous les clients.
   *
   *    L'habilitation posée ailleurs ne vaut rien si une autre porte l'ignore.
   */
  @Get('partners')
  @Roles(
    UserRole.DG,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.CCOO,
    UserRole.ASSISTANT_DG,
    UserRole.SALES_REP,
    UserRole.LOGISTICS_COORD,
  )
  @Screen('tiers')
  partners(@Query() query: PartnerQuery, @Req() req: { auth: { role?: UserRole } }) {
    return this.service.partners(query, req.auth.role);
  }

  @Get('cost-posts')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT, UserRole.CCOO, UserRole.LOGISTICS_COORD)
  costPosts() {
    return this.service.costPosts();
  }

  @Get('operation-types')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD, UserRole.SALES_REP)
  operationTypes(@Query('segment') segment?: CommercialSegment) {
    return this.service.operationTypes(segment);
  }

  @Get('sites/:id/requirements')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD, UserRole.SALES_REP)
  siteRequirements(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.siteRequirements(id);
  }

  @Get('sites')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD, UserRole.SALES_REP)
  sites(@Query('usage') usage?: 'LOADING' | 'DELIVERY') {
    return this.service.sites(usage);
  }

  @Get('hse-checklists')
  @Roles(UserRole.DG, UserRole.CCOO, UserRole.LOGISTICS_COORD)
  hseChecklists() {
    return this.service.hseChecklists();
  }

  @Get('absorption-rates')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.ACCOUNTANT)
  absorptionRates(@Query('fiscalYear') fiscalYear?: string) {
    return this.service.absorptionRates(Number(fiscalYear) || new Date().getUTCFullYear());
  }

  @Get('margin-thresholds')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO, UserRole.ACCOUNTANT)
  marginThresholds() {
    return this.service.marginThresholds();
  }

  @Get('ullage-tolerances')
  @Roles(UserRole.DG, UserRole.FINANCE_CFO, UserRole.CCOO, UserRole.LOGISTICS_COORD)
  ullageTolerances() {
    return this.service.ullageTolerances();
  }

  @Get('settings')
  @Roles(UserRole.DG, UserRole.IT_ADMIN, UserRole.FINANCE_CFO)
  settings() {
    return this.service.settings();
  }

  /**
   * Numéros de version libres — DÉCLARÉE AVANT `:key`, sans quoi celle-ci
   * l'avalerait et rendrait « référentiel versions-libres inconnu ».
   */
  /**
   * CONSULTATION PAGINÉE D'UN RÉFÉRENTIEL.
   *
   * ⚠️ UN CHEMIN DISTINCT, ET CE N'EST PAS UN DOUBLON.
   *
   *    `GET /referentials/:key` est arbitré par les routes dédiées : treize
   *    référentiels y répondent par leur liste ENTIÈRE, parce que c'est ce
   *    qu'il faut pour remplir une liste déroulante. L'écran de consultation
   *    passait donc par elles pour la moitié des réglages, sans pagination ni
   *    recherche — et sans que rien ne distingue les deux cas à l'écran.
   *
   *    Deux besoins, deux chemins : la liste entière pour choisir, la page
   *    pour consulter.
   */
  @Get(':key/lignes')
  @Roles(
    UserRole.DG,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.CCOO,
    UserRole.LOGISTICS_COORD,
    UserRole.ASSISTANT_DG,
    UserRole.IT_ADMIN,
    UserRole.SALES_REP,
  )
  lignes(
    @Param('key') key: string,
    @Req() req: { auth: { role: UserRole } },
    @Query() query: { page?: string; pageSize?: string; search?: string },
  ) {
    return this.service.parReferentiel(key, req.auth.role, {
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
      search: query.search,
    });
  }

  @Get(':key/versions-libres')
  @Roles(
    UserRole.DG,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.CCOO,
    UserRole.IT_ADMIN,
  )
  versionsLibres(@Param('key') key: string, @Query() query: Record<string, string>) {
    return this.service.versionsLibres(key, query);
  }

  /**
   * LECTURE GÉNÉRIQUE D'UN RÉFÉRENTIEL DÉCLARÉ AU REGISTRE.
   *
   * ⚠️ LES ROUTES DE LECTURE ÉTAIENT UNE LISTE TENUE À LA MAIN.
   *
   *    Treize routes écrites une à une, face à VINGT-NEUF référentiels déclarés
   *    au registre. Seize étaient donc écrivables et illisibles — et un
   *    référentiel qu'on ne peut pas lire ne peut pas alimenter une liste
   *    déroulante.
   *
   *    Conséquence constatée : cinq champs de référence retombaient en saisie
   *    libre, dont `fiscalYearId` sur les trois écrans du paramétrage financier
   *    — taux de financement, budget de charges fixes, prévision de vente.
   *    Autrement dit, le premier geste du CFO consistait à recopier à la main
   *    un identifiant technique.
   *
   *    Le registre sait déjà quels référentiels existent. Une liste tenue en
   *    parallèle finit toujours par diverger : on n'oublie pas d'ajouter le
   *    référentiel, on oublie d'ajouter sa route.
   *
   * ⚠️ DÉCLARÉE EN DERNIER, ET CE N'EST PAS UN DÉTAIL.
   *
   *    NestJS retient la PREMIÈRE route qui correspond. Placée plus haut,
   *    `:key` avalerait `currencies`, `partners` et toutes les autres — avec
   *    leurs filtres de rôle et leur pagination. Les routes spécifiques
   *    gardent donc la main ; celle-ci ne sert que ce qu'aucune ne couvre.
   *
   * ⚠️ LE RÔLE SE VÉRIFIE PAR RÉFÉRENTIEL, PAS PAR ROUTE.
   *
   *    Une seule liste de rôles couvrait les vingt-huit référentiels. Le
   *    coordinateur logistique lisait donc les prix d'achat fournisseurs, et
   *    l'affaire lui montrant déjà le prix de vente, la marge se calculait de
   *    tête. La règle « un coordinateur logistique ne voit pas les marges »
   *    était défaite par la route la plus générique de l'application.
   *
   *    Le décorateur ne peut pas exprimer cela : il ignore quelle clé sera
   *    demandée. Le contrôle se fait donc DANS la méthode, sur les rôles
   *    dérivés du registre. Le décorateur ne garde qu'un rôle de première
   *    barrière contre les rôles qui n'ont rien à faire ici.
   */
  @Get(':key')
  @Roles(
    UserRole.DG,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.CCOO,
    UserRole.LOGISTICS_COORD,
    UserRole.ASSISTANT_DG,
    UserRole.IT_ADMIN,
    UserRole.SALES_REP,
  )
  /**
   * ⚠️ REND UN TABLEAU SIMPLE, ET C'EST VOULU.
   *
   *    Cette route alimente les LISTES DÉROULANTES : elles ont besoin de la
   *    liste entière, pas d'une page. Lui avoir fait rendre une page a cassé
   *    d'un coup tous ses appelants — la recette a signalé la régression au
   *    passage suivant, ce qui est exactement son office.
   *
   *    La consultation paginée vit sur `/:key/lignes`, au-dessus.
   */
  async generique(
    @Param('key') key: string,
    @Query() filter: Record<string, string>,
    @Req() req: { auth: { role: UserRole } },
  ) {
    const page = await this.service.parReferentiel(key, req.auth.role, { pageSize: 0, filter });
    return page.items;
  }
}
