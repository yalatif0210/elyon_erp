import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ActorType, AuditAction, UserRole } from '@prisma/client';
import { IsArray, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { Realm, RequireRealm, Roles } from '../common/auth/realm';
import { SettingsService } from '../common/config/settings.service';
import { humaniseCheck } from '../common/filters/prisma-exception.filter';
import { PrismaService } from '../common/prisma/prisma.service';
import { FieldSpec, REFERENTIALS, ReferentialSpec, findReferential } from './registry';

// ===========================================================================
//  DTO

// ===========================================================================
class UpsertRowDto {
  @IsObject() values!: Record<string, unknown>;

  /** Obligatoire sur une table historisée : on trace pourquoi la valeur change. */
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
class ImportDto {

  /** Lignes déjà décomposées en colonnes — le fichier est lu côté client. */
  @IsArray() rows!: Record<string, unknown>[];
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;

  /** Vrai pour n'obtenir que le rapport, sans rien écrire. */
  @IsOptional() dryRun?: boolean;
}

// ===========================================================================
//  Conversion et validation

// ===========================================================================

export interface RowError {
  line: number;
  field?: string;
  message: string;
}

/**
 * Convertit une valeur brute vers le type attendu.
 *
 * ⚠️ Les nombres acceptent la VIRGULE décimale et l'espace comme séparateur de
 *    milliers : c'est ce qu'un tableur francophone produit, et refuser
 *    « 1 234,56 » ferait rejeter la moitié d'un fichier légitime.
 */
export function coerce(field: FieldSpec, raw: unknown): unknown {
  if (raw === null || raw === undefined || raw === '') return null;
  const text = String(raw).trim();
  if (text === '') return null;
  switch (field.type) {
    case 'number':
    case 'integer': {
      const cleaned = text.replace(/\s| | /g, '').replace(',', '.');
      const n = Number(cleaned);
      if (!Number.isFinite(n)) throw new Error(`« ${text} » n’est pas un nombre`);
      if (field.type === 'integer' && !Number.isInteger(n)) {
        throw new Error(`« ${text} » doit être un entier`);
      }
      return n;
    }
    case 'boolean': {
      const t = text.toLowerCase();
      if (['1', 'true', 'vrai', 'oui', 'x', 'o'].includes(t)) return true;
      if (['0', 'false', 'faux', 'non', 'n'].includes(t)) return false;
      throw new Error(`« ${text} » n’est ni vrai ni faux`);
    }
    case 'date': {
      // ISO, ou jour/mois/année — le format qu'un tableur francophone rend.
      const fr = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(text);
      const iso = fr ? `${fr[3]}-${fr[2]}-${fr[1]}` : text.slice(0, 10);
      const d = new Date(`${iso}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime())) throw new Error(`« ${text} » n’est pas une date`);
      return d;
    }
    case 'enum': {
      // ⚠️ ON COMPARE SANS TENIR COMPTE DE LA CASSE, ET ON REND LA VALEUR
      //    DÉCLARÉE — PAS LA SAISIE MISE EN MAJUSCULES.
      //
      //    L'ancienne version faisait `toUpperCase()` puis cherchait le
      //    résultat dans la liste. Ça marche tant que toutes les énumérations
      //    sont en majuscules — c'est le cas de celles de Prisma. Ça échoue
      //    sur toute liste écrite en minuscules : « number » devenait
      //    « NUMBER », absent de la liste, et la ligne était refusée avec un
      //    message absurde qui reprenait la valeur pourtant admise.
      //
      //    Conséquence constatée : le champ « Type » des PARAMÈTRES SYSTÈME
      //    était impossible à renseigner, donc AUCUN paramètre n'était
      //    modifiable depuis l'interface. La règle « toute donnée doit être
      //    administrable » se trouvait défaite sur la table qui la porte.
      const trouve = field.values?.find((v) => v.toLowerCase() === text.toLowerCase());
      if (!trouve) {
        throw new Error(`« ${text} » — valeurs admises : ${field.values?.join(', ')}`);
      }
      return trouve;
    }
    case 'enumList': {
      // Séparateurs tolérés : virgule, point-virgule, barre verticale. Un
      // tableur francophone en produit l'un ou l'autre selon la colonne, et
      // exiger le bon rendrait le fichier rejeté pour une raison de forme.
      const saisies = text
        .split(/[,;|]/)
        .map((v) => v.trim())
        .filter(Boolean);
      // Même correction que pour `enum` : on compare sans la casse et on rend
      // la valeur DÉCLARÉE. Toutes les listes employées ici viennent
      // aujourd'hui d'énumérations Prisma, donc en majuscules — le défaut ne
      // mordait pas encore. Il aurait mordu à la première liste en minuscules.
      const inconnues = saisies.filter(
        (v) => !field.values?.some((admise) => admise.toLowerCase() === v.toLowerCase()),
      );
      if (inconnues.length > 0) {
        throw new Error(
          `« ${inconnues.join(', ')} » — valeurs admises : ${field.values?.join(', ')}`,
        );
      }
      return saisies.map(
        (v) => field.values?.find((admise) => admise.toLowerCase() === v.toLowerCase()) ?? v,
      );
    }
    case 'referenceList': {
      // Les codes sont résolus plus tard, quand la base est accessible : ici
      // on ne fait que découper. Une résolution dans un convertisseur pur le
      // rendrait dépendant d'un accès distant, donc intestable.
      return text
        .split(/[,;|]/)
        .map((v) => v.trim())
        .filter(Boolean);
    }
    default:
      return text;
  }
}

// ===========================================================================
//  Service

// ===========================================================================

/**
 * Paramétrage des référentiels (SPECIFICATIONS.md § 1.1 bis).
 *
 * Un seul service sert TOUTES les tables administrables, pilotées par le
 * registre. L'alternative — un contrôleur par référentiel — se paie au
 * dixième : la validation, l'historisation et le rapport de rejet finissent
 * par diverger d'une table à l'autre.
 *
 * DEUX COMPORTEMENTS D'ÉCRITURE :
 *
 *   mutable     l'objet se corrige sur place.
 *   historised  l'écriture CLÔT la ligne en vigueur et en crée une nouvelle.
 *               Rien n'est jamais réécrit : un taux, un prix ou un seuil
 *               gouvernent des calculs déjà produits.
 */
@Injectable()

export class ParametersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Le cache de lecture des paramètres (30 s) est vidé dès qu'une valeur est
   * écrite ici. Sans cela, celui qui corrige un seuil dans l'urgence le voit
   * sans effet pendant une demi-minute, le ressaisit, et finit par douter de
   * l'écran plutôt que du délai.
   *
   * On vide TOUT plutôt que la seule clé touchée : un import en pose plusieurs
   * d'un coup, et le coût d'une relecture est une requête indexée.
   */
  private refreshSettingsCache(spec: ReferentialSpec): void {
    if (spec.model === 'systemSetting') this.settings.invalidate();
  }

  /** Le registre lui-même : il pilote aussi l'interface de saisie. */
  catalogue() {
    return REFERENTIALS.map((r) => ({
      key: r.key,
      label: r.label,
      nature: r.nature,
      identity: r.identity,
      caution: r.caution ?? null,
      fields: r.fields,
    }));
  }

  private delegate(spec: ReferentialSpec): {
    findFirst: (a: unknown) => Promise<Record<string, unknown> | null>;
    findMany: (a: unknown) => Promise<Record<string, unknown>[]>;
    create: (a: unknown) => Promise<Record<string, unknown>>;
    update: (a: unknown) => Promise<Record<string, unknown>>;
    updateMany: (a: unknown) => Promise<{ count: number }>;
  } {
    const d = (this.prisma as unknown as Record<string, unknown>)[spec.model];
    if (!d) throw new NotFoundException(`Référentiel « ${spec.key} » introuvable`);
    return d as never;
  }

  /**
   * Traduit les références lisibles en identifiants techniques.
   *
   * Un fichier porte « DIESEL », pas un UUID. Exiger l'identifiant rendrait
   * l'import inutilisable par la personne qui tient le référentiel.
   */
  private async resolveReferences(
    spec: ReferentialSpec,
    values: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const out = { ...values };

    /**
     * La clé lisible d'un référentiel n'est pas toujours du texte.
     *
     * ⚠️ `String(valeur)` était appliqué sans condition, et Prisma refusait :
     *    « Argument `year`: Expected IntFilter or Int, provided String ». Un
     *    exercice comptable se désigne par son MILLÉSIME — un entier. Toute
     *    référence à clé numérique était donc impossible à saisir, à l'écran
     *    comme à l'import.
     *
     *    Le type n'est pas deviné : il est LU dans la déclaration du
     *    référentiel visé. Le registre sait déjà que `year` est un entier, il
     *    serait absurde de le redire ici — et une seconde déclaration finirait
     *    par diverger de la première.
     */
    const cleLisible = (refTable: string | undefined, refKey: string, valeur: unknown) => {
      const cible = findReferential(refTable ?? '');
      const champ = cible?.fields.find((f) => f.name === refKey);
      return champ?.type === 'integer' || champ?.type === 'number'
        ? Number(valeur)
        : String(valeur);
    };

    // Listes de références : on traduit chaque code en identifiant, puis on
    // pose un `set`. La liste fournie REMPLACE l'ancienne — y ajouter au lieu
    // de remplacer rendrait impossible de retirer un élément par import, et
    // un référentiel dont on ne peut rien retirer finit par tout contenir.
    for (const field of spec.fields) {
      if (field.type !== 'referenceList' || out[field.name] == null) continue;
      const target = findReferential(field.refTable ?? '');
      if (!target) continue;

      const codes = out[field.name] as string[];
      const ids: { id: string }[] = [];
      for (const code of codes) {
        const row = await this.delegate(target).findFirst({
          where: {
            [field.refKey ?? 'code']: cleLisible(field.refTable, field.refKey ?? 'code', code),
          },
          select: { id: true },
        });
        if (!row) {
          throw new Error(
            `${field.label} : « ${code} » ne correspond à aucun ${target.label.toLowerCase()}`,
          );
        }
        ids.push({ id: String(row['id']) });
      }
      // ⚠️ DEUX FORMES D'ÉCRITURE POUR UNE MÊME SAISIE.
      //
      //    Une RELATION attend `{ set: [{id}] }` ; une COLONNE TABLEAU attend
      //    `['uuid', …]`. L'utilisateur saisit la même chose — des codes
      //    séparés par des virgules — mais écrire l'une pour l'autre échoue au
      //    moment de l'écriture, pas à la déclaration.
      out[field.name] = field.scalarList ? ids.map((r) => r.id) : { set: ids };
    }

    for (const field of spec.fields) {
      if (field.type !== 'reference' || out[field.name] == null) continue;
      // Les clés naturelles (code devise) sont stockées telles quelles.
      if (!field.name.endsWith('Id')) continue;
      const target = findReferential(field.refTable ?? '');
      if (!target) continue;
      const row = await this.delegate(target).findFirst({
        where: {
          [field.refKey ?? 'code']: cleLisible(
            field.refTable,
            field.refKey ?? 'code',
            out[field.name],
          ),
        },
        select: { id: true },
      });
      if (!row) {
        throw new Error(
          `${field.label} : « ${String(out[field.name])} » ne correspond à aucun ${target.label.toLowerCase()}`,
        );
      }
      out[field.name] = row['id'];
    }
    return out;
  }

  /** Valide et convertit une ligne. Les erreurs sont CUMULÉES, pas la première. */
  private prepare(spec: ReferentialSpec, raw: Record<string, unknown>, line: number) {
    const values: Record<string, unknown> = {};
    const errors: RowError[] = [];

    // Un champ dont la CONVERSION a échoué ne doit pas être signalé une
    // seconde fois comme manquant : une cause, un message. Deux lignes de
    // rapport pour une seule faute font douter de l'exactitude du reste.
    const failed = new Set<string>();

    for (const field of spec.fields) {
      const present = Object.prototype.hasOwnProperty.call(raw, field.name);
      if (!present) continue;
      try {
        values[field.name] = coerce(field, raw[field.name]);
      } catch (e) {
        failed.add(field.name);
        errors.push({ line, field: field.name, message: `${field.label} : ${(e as Error).message}` });
      }
    }

    for (const field of spec.fields) {
      if (failed.has(field.name)) continue;
      if (field.required && (values[field.name] == null || values[field.name] === '')) {
        errors.push({ line, field: field.name, message: `${field.label} est obligatoire` });
      }
    }
    const unknownColumns = Object.keys(raw).filter(
      (k) => !spec.fields.some((f) => f.name === k),
    );
    for (const column of unknownColumns) {
      errors.push({ line, field: column, message: `Colonne inconnue « ${column} » — ignorée` });
    }
    return { values, errors };
  }

  /**
   * Écrit une ligne. Sur une table historisée, clôt d'abord la précédente.
   *
   * La clôture pose `effectiveTo` à la veille de la nouvelle entrée en
   * vigueur : deux lignes ne doivent jamais se recouvrir, sinon la résolution
   * d'un prix ou d'un seuil devient dépendante de l'ordre de lecture.
   */
  private async writeOne(
    spec: ReferentialSpec,
    values: Record<string, unknown>,
    actorId: string,
    reason?: string,
  ): Promise<{ created: boolean; id: string }> {
    const delegate = this.delegate(spec);
    const identityWhere = Object.fromEntries(
      spec.identity.map((k) => [k, values[k] ?? null]),
    );
    if (spec.nature === 'historised') {
      const from = values[spec.effectiveFrom ?? 'effectiveFrom'] as Date | undefined;
      if (from && spec.effectiveTo) {
        const scope = Object.fromEntries(
          spec.identity
            .filter((k) => k !== spec.effectiveFrom)
            .map((k) => [k, values[k] ?? null]),
        );
        const dayBefore = new Date(from);
        dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
        await delegate.updateMany({
          where: { ...scope, [spec.effectiveTo]: null, [spec.effectiveFrom!]: { lt: from } },
          data: { [spec.effectiveTo]: dayBefore },
        });
      }
      const existing = await delegate.findFirst({ where: identityWhere, select: { id: true } });
      if (existing) {
        throw new Error(
          'Une ligne existe déjà pour cette clé et cette date d’entrée en vigueur. Une donnée historisée ne se réécrit pas : publiez-la à une autre date.',
        );
      }
      const created = await delegate.create({ data: values });
      await this.trace(spec, AuditAction.CREATE, created, actorId, reason);
      return { created: true, id: String(created['id'] ?? '') };
    }
    const existing = await delegate.findFirst({ where: identityWhere });
    if (existing) {
      // ⚠️ TOUTES LES TABLES N'ONT PAS DE COLONNE `id`.
      //
      //    `system_settings` a pour clé primaire sa CLÉ, pas un identifiant
      //    technique. La condition était écrite `{ id: existing.id ?? identité }` :
      //    le repli se retrouvait DANS l'objet, ce qui produisait
      //    `where: { id: { key: '…' } }` — que Prisma refuse.
      //
      //    Le repli doit porter sur l'objet entier. Conséquence du défaut :
      //    aucun paramètre système n'était modifiable depuis l'interface, alors
      //    que c'est précisément la table qui porte la règle « toute donnée
      //    doit être administrable ».
      const cible = existing['id'] ? { id: existing['id'] } : identityWhere;
      const updated = await delegate.update({ where: cible, data: values });
      await this.trace(spec, AuditAction.UPDATE, updated, actorId, reason, existing);
      return { created: false, id: String(updated['id'] ?? updated[spec.identity[0]] ?? '') };
    }
    const created = await delegate.create({ data: values });
    await this.trace(spec, AuditAction.CREATE, created, actorId, reason);
    return { created: true, id: String(created['id'] ?? '') };
  }

  private trace(
    spec: ReferentialSpec,
    action: AuditAction,
    after: unknown,
    actorId: string,
    reason?: string,
    before?: unknown,
  ) {
    return this.audit.record({
      actorType: ActorType.INTERNAL_USER,
      actorId,
      action,
      entityType: spec.model,
      entityId: (after as Record<string, unknown>)?.['id'] as string | undefined,
      before,
      after: reason ? { ...(after as object), motif: reason } : after,
    });
  }

  /** Saisie unitaire. */
  async upsert(key: string, dto: UpsertRowDto, actorId: string, role: UserRole) {
    const spec = this.requireWritable(key, role);
    const { values, errors } = this.prepare(spec, dto.values, 1);
    const blocking = errors.filter((e) => !e.message.includes('ignorée'));
    if (blocking.length > 0) {
      throw new BadRequestException({ message: 'Ligne refusée', errors: blocking });
    }
    if (spec.nature === 'historised' && !dto.reason) {
      throw new BadRequestException(
        'Un motif est exigé : cette donnée est historisée et gouverne des calculs déjà produits.',
      );
    }
    try {
      const resolved = await this.resolveReferences(spec, values);
      const written = await this.writeOne(spec, resolved, actorId, dto.reason);
      this.refreshSettingsCache(spec);
      return written;
    } catch (e) {
      // Même nettoyage qu'à l'import : la requête Prisma en clair n'aide pas
      // celui qui corrige une valeur, et expose la structure interne.
      throw new BadRequestException(firstLine((e as Error).message));
    }
  }

  /**
   * Import de fichier, avec RAPPORT DE REJET LIGNE À LIGNE.
   *
   * Une ligne fautive ne fait pas échouer le fichier : les lignes valides
   * passent, les autres sont rendues avec leur numéro et la raison exacte.
   * Un import tout-ou-rien sur trois cents lignes se solde par un abandon.
   */
  async importRows(key: string, dto: ImportDto, actorId: string, role: UserRole) {
    const spec = this.requireWritable(key, role);
    if (spec.nature === 'historised' && !dto.reason) {
      throw new BadRequestException(
        'Un motif est exigé pour importer dans une table historisée.',
      );
    }
    const rejected: RowError[] = [];
    const warnings: RowError[] = [];
    // Une ligne peut porter PLUSIEURS fautes. On compte les LIGNES écartées,
    // pas les messages : « 6 rejetées sur 6 » quand 2 ont été créées est un
    // rapport qui se contredit, et fait douter de tout le reste.
    const rejectedLines = new Set<number>();
    let created = 0;
    let updated = 0;
    for (let i = 0; i < dto.rows.length; i += 1) {
      // Numéro tel que l'utilisateur le voit dans son tableur : l'entête
      // occupe la ligne 1, la première donnée est donc en ligne 2.
      const line = i + 2;
      const { values, errors } = this.prepare(spec, dto.rows[i], line);
      const blocking = errors.filter((e) => !e.message.includes('ignorée'));
      warnings.push(...errors.filter((e) => e.message.includes('ignorée')));
      if (blocking.length > 0) {
        rejected.push(...blocking);
        rejectedLines.add(line);
        continue;
      }
      if (dto.dryRun) {
        created += 1;
        continue;
      }
      try {
        const resolved = await this.resolveReferences(spec, values);
        const r = await this.writeOne(spec, resolved, actorId, dto.reason);
        if (r.created) created += 1;
        else updated += 1;
      } catch (e) {
        rejected.push({ line, message: firstLine((e as Error).message) });
        rejectedLines.add(line);
      }
    }
    // En simulation, `created` compte les lignes qui AURAIENT été écrites :
    // rien n'a changé en base, il n'y a rien à invalider.
    if (!dto.dryRun && created + updated > 0) this.refreshSettingsCache(spec);

    return {
      referential: spec.key,
      simulation: dto.dryRun === true,
      lues: dto.rows.length,
      creees: created,
      modifiees: updated,
      rejetees: rejectedLines.size,
      rejets: rejected,
      avertissements: dedupe(warnings),
    };
  }

  /** Gabarit d'import — les colonnes attendues, dans l'ordre, avec leur aide. */
  template(key: string) {
    const spec = findReferential(key);
    if (!spec) throw new NotFoundException(`Référentiel « ${key} » introuvable`);
    return {
      referential: spec.key,
      label: spec.label,
      nature: spec.nature,
      caution: spec.caution ?? null,
      colonnes: spec.fields.map((f) => ({
        nom: f.name,
        libelle: f.label,
        type: f.type,
        obligatoire: f.required === true,
        valeurs: f.values ?? null,
        aide: f.help ?? null,
      })),
    };
  }

  private requireWritable(key: string, role: UserRole): ReferentialSpec {
    const spec = findReferential(key);
    if (!spec) throw new NotFoundException(`Référentiel « ${key} » introuvable`);
    if (!spec.writeRoles.includes(role)) {
      throw new ForbiddenException(
        `L’écriture sur « ${spec.label} » est réservée à : ${spec.writeRoles.join(', ')}.`,
      );
    }
    return spec;
  }
}

/**
 * Les erreurs Prisma arrivent avec la requête complète en clair. On n'en garde
 * que la raison : afficher un fragment de code à quelqu'un qui corrige un
 * fichier de prix ne l'aide pas, et expose la structure interne.
 */
function firstLine(message: string): string {
  // Une contrainte métier a sa traduction — la même que celle servie par le
  // filtre d'exceptions. Deux formulations pour une même règle, selon le
  // chemin emprunté, dérouteraient l'utilisateur.
  const humanised = humaniseCheck(message);
  if (humanised !== message) return humanised;

  const OTHER = /(?:Argument .+ is missing|Unique constraint failed)[^\n]*/i;
  const other = OTHER.exec(message);
  if (other) return other[0].trim();

  const lines = message.trim().split('\n').filter(Boolean);
  return (lines[lines.length - 1] ?? message).trim().slice(0, 300);
}

function dedupe(errors: RowError[]): RowError[] {
  const seen = new Set<string>();
  return errors.filter((e) => {
    const k = `${e.field}|${e.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ===========================================================================
//  Contrôleur

// ===========================================================================

@Controller('api/internal/parameters')
@RequireRealm(Realm.INTERNAL)

export class ParametersController {
  constructor(private readonly service: ParametersService) {}

  /** Catalogue des tables administrables — pilote l'écran de paramétrage. */

  @Get()
  @Roles(
    UserRole.DG,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.CCOO,
    UserRole.LOGISTICS_COORD,
    UserRole.SALES_REP,
    UserRole.IT_ADMIN,
  )
  catalogue() {
    return this.service.catalogue();
  }

  @Get(':key/template')
  @Roles(
    UserRole.DG,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.CCOO,
    UserRole.LOGISTICS_COORD,
    UserRole.SALES_REP,
    UserRole.IT_ADMIN,
  )
  template(@Param('key') key: string) {
    return this.service.template(key);
  }

  /**
   * Saisie unitaire. Le rôle autorisé dépend du RÉFÉRENTIEL, pas de la route :
   * la matrice est portée par le registre, et le service la fait respecter.
   */
  @Post(':key')
  @Roles(
    UserRole.DG,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.CCOO,
    UserRole.LOGISTICS_COORD,
    UserRole.SALES_REP,
    UserRole.IT_ADMIN,
  )
  upsert(
    @Param('key') key: string,
    @Body() dto: UpsertRowDto,
    @Req() req: { auth: { sub: string; role: UserRole } },
  ) {
    return this.service.upsert(key, dto, req.auth.sub, req.auth.role);
  }

  /** Import de fichier. `dryRun` rend le rapport sans rien écrire. */

  @Post(':key/import')
  @Roles(
    UserRole.DG,
    UserRole.FINANCE_CFO,
    UserRole.ACCOUNTANT,
    UserRole.CCOO,
    UserRole.LOGISTICS_COORD,
    UserRole.SALES_REP,
    UserRole.IT_ADMIN,
  )
  import(
    @Param('key') key: string,
    @Body() dto: ImportDto,
    @Req() req: { auth: { sub: string; role: UserRole } },
  ) {
    return this.service.importRows(key, dto, req.auth.sub, req.auth.role);
  }
}
