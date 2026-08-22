#!/usr/bin/env node
/**
 * ===========================================================================
 *  INJECTION DU SQL MÉTIER DANS LES MIGRATIONS PRISMA
 *
 *  LE PROBLÈME
 *  -----------
 *  Prisma ne modélise ni les CHECK, ni les triggers, ni les vues, ni les
 *  privilèges. Appliquer ces objets « à côté » des migrations les rend
 *  invisibles à l'historique : au `prisma migrate dev` suivant, Prisma rejoue
 *  les migrations dans une base de travail, compare avec la base réelle,
 *  constate un écart et propose de tout réinitialiser. En production, cela
 *  signifie perdre les données ; en développement, cela signifie perdre les
 *  invariants à chaque évolution du schéma.
 *
 *  LA SOLUTION
 *  -----------
 *  Le SQL de prisma/sql/ est APPENDÉ au fichier migration.sql généré. Il fait
 *  dès lors partie de l'historique : la base de travail le rejoue, la
 *  comparaison est identique, aucune dérive n'est détectée. Les contraintes
 *  survivent à toutes les migrations ultérieures.
 *
 *  USAGE
 *  -----
 *    node scripts/prepare-migrations.mjs init          Première migration
 *    node scripts/prepare-migrations.mjs <nom>         Migration suivante
 *
 *  Le script est idempotent : un marqueur empêche toute double injection.
 * ===========================================================================
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(API_ROOT, 'prisma', 'migrations');
const SQL_DIR = join(API_ROOT, 'prisma', 'sql');
const MARKER = '-- @erp:business-sql-injected';

/** Fichiers injectés, dans cet ordre — les triggers dépendent des tables. */
const SQL_FILES = [
  // Dépose les vues qui dépendent de fonctions recréées plus bas. EN PREMIER,
  // sans quoi PostgreSQL refuse de remplacer ces fonctions — et l'échec
  // n'apparaît qu'à la migration SUIVANTE, sur un changement sans rapport.
  '00_prelude.sql',
  '01_business_constraints.sql',
  // Opposabilité des dérogations : DÉFINIE AVANT les verrous qui l'appellent.
  '13_derogations_opposables.sql',
  // Statut de conformité calculé à la lecture : AVANT la vue qui l'appelle.
  '14_conformite_dans_le_temps.sql',
  '02_audit_immutability.sql',
  '03_views_and_functions.sql',
  '05_lot2_invariants.sql',
  '06_lot2_views.sql',
  '07_apurement_avances.sql',
  '08_bareme_de_couts.sql',
  '09_reprise_invariants.sql',
  '10_types_operation.sql',
  '11_journal_terrain.sql',
  '12_exigence_photo.sql',
  '16_sites_de_livraison.sql',
  // Après 05, dont il remplace trois CHECK.
  '17_arrondi_devise.sql',
  '18_perte_volume_statistique.sql',
  '19_verrou_credit.sql',
  '20_tarif_transporteur.sql',
  '21_referentiels_administrables.sql',
  // Valeurs par défaut des réglages système : aucune dépendance d'ordre —
  // `system_settings` existe depuis le socle Prisma, et `ON CONFLICT DO
  // NOTHING` ne heurte jamais une valeur déjà réglée par un exploitant.
  '39_parametres_systeme_par_defaut.sql',
  // Exercice comptable et données budgétaires : AVANT 25, qui les lit, et
  // AVANT 22, dont deux sources de tâches lisent la couverture budgétaire.
  '24_exercice_et_budget.sql',
  '25_pilotage_financier.sql',
  // L'assiette d'absorption est un volume, pas un chiffre d'affaires.
  '26_assiette_en_volume.sql',
  // CRM et tableau de bord : AVANT 22, dont la file lit les alertes CRM.
  '27_crm_pipeline.sql',
  '28_tableau_operationnel.sql',
  // Performance par commercial : lit le CRM (27) et la bande de marge (06).
  '32_performance_commerciale.sql',
  // La performance se lit sur une période : 32 crée la vue, 33 la borne.
  '33_performance_par_periode.sql',
  // Une prévision reste dans les bornes de son exercice.
  '29_prevision_dans_les_bornes.sql',
  // Issus de l'audit : la facturation est bornée, l'encaissement est dérivé.
  '30_facturation_bornee.sql',
  '31_encaissement_fiable.sql',
  // L'assiette et les charges fixes se dérivent : APRÈS 25 (prévision en
  // vigueur) et 29 (durée réelle de l'exercice), qu'il lit tous deux.
  '34_budget_indirect_derive.sql',
  // Fin de la transition : l'exercice porte seul ses conditions financières.
  // APRÈS 24, qui définit les fonctions qu'il remplace.
  '35_fin_de_transition.sql',
  // Verrou de clôture : lit generated_documents, qui existe déjà côté Prisma —
  // aucune dépendance d'ordre avec les fichiers précédents.
  '36_cloture_operation.sql',
  // Remplace la fonction du trigger de séparation des tâches HSE posé par 05 :
  // APRÈS lui, qui la définit une première fois.
  '37_suppleance_hse_delegation.sql',
  // Le rejet s'appuie sur la même table de délégations : APRÈS elle.
  '38_rejet_checklist_hse.sql',
  // La file de tâches lit TOUTES les vues précédentes : elle vient en dernier.
  '22_file_de_taches.sql',
  // Paramètres requis : AVANT 15, dont deux règles d'invariant les lisent.
  '23_parametres_obligatoires.sql',
  // L'audit permanent vient EN DERNIER : il lit tout ce qui précède.
  '15_audit_complet.sql',
  // Les privilèges viennent EN DERNIER : ils portent sur des objets que les
  // fichiers précédents viennent de créer.
  '04_grants.sql',
];

const migrationName = process.argv[2] ?? 'init';

function capture(command, args) {
  return execFileSync(command, args, { cwd: API_ROOT, encoding: 'utf8' });
}

function latestMigrationDir() {
  if (!existsSync(MIGRATIONS_DIR)) return null;
  const dirs = readdirSync(MIGRATIONS_DIR)
    .filter((entry) => statSync(join(MIGRATIONS_DIR, entry)).isDirectory())
    .sort();
  return dirs.length > 0 ? join(MIGRATIONS_DIR, dirs[dirs.length - 1]) : null;
}

/** Base de travail jetable : Prisma y rejoue l'historique pour calculer l'écart. */
function shadowUrl() {
  if (process.env.SHADOW_DATABASE_URL) return process.env.SHADOW_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL absent.');
  return base.replace(/\/([^/?]+)(\?|$)/, '/$1_shadow$2');
}

/**
 * `migrate diff` exige que la base de travail EXISTE — contrairement à
 * `migrate dev`, qui la crée au vol. On la crée donc soi-même, faute de quoi
 * la commande échoue sur tout environnement neuf : conteneur, CI ou serveur.
 *
 * L'échec est ignoré : le cas courant est qu'elle existe déjà.
 */
function ensureShadowDatabase() {
  const url = new URL(shadowUrl());
  const dbName = url.pathname.replace(/^\//, '');
  const maintenance = new URL(shadowUrl());
  maintenance.pathname = '/postgres';

  try {
    execFileSync('npx', ['prisma', 'db', 'execute', '--url', maintenance.toString(), '--stdin'], {
      cwd: API_ROOT,
      input: `CREATE DATABASE "${dbName}";`,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log(`  ✓ base de travail « ${dbName} » créée`);
  } catch {
    // Existe déjà, ou droits insuffisants — le diff dira si c'est bloquant.
  }
}

// ---------------------------------------------------------------------------
//  1. Calculer l'écart entre l'historique de migration et le schéma courant.
//
//  `migrate dev --create-only` serait le chemin naturel, mais il EXIGE une
//  confirmation interactive dès qu'il détecte une perte de données — colonne
//  ou table supprimée. Impossible en conteneur, en CI ou sur un serveur.
//
//  `migrate diff` fait le même calcul sans rien demander. La contrepartie est
//  qu'il n'avertit pas : c'est à la relecture du migration.sql généré de
//  repérer un DROP non voulu. D'où l'affichage des opérations destructrices
//  ci-dessous.
// ---------------------------------------------------------------------------
console.log(`→ Génération de la migration « ${migrationName} »…`);
ensureShadowDatabase();

let diffSql = '';
try {
  diffSql = capture('npx', [
    'prisma', 'migrate', 'diff',
    '--from-migrations', './prisma/migrations',
    '--to-schema-datamodel', './prisma/schema.prisma',
    '--shadow-database-url', shadowUrl(),
    '--script',
  ]);
} catch (error) {
  console.error('✗ Calcul de l’écart impossible.');
  console.error(error.stderr?.toString() ?? error.message);
  process.exit(1);
}

const isEmpty = /^\s*(--\s*This is an empty migration\.?\s*)?$/i.test(diffSql);

// Signaler les opérations destructrices : migrate diff ne le fait pas.
const destructive = diffSql
  .split('\n')
  .filter((l) => /^\s*(DROP TABLE|DROP COLUMN|ALTER TABLE .* DROP COLUMN|DROP TYPE)/i.test(l));
if (destructive.length > 0) {
  console.log('\n  ⚠️  Opérations destructrices détectées — à relire avant application :');
  for (const line of destructive) console.log(`     ${line.trim()}`);
  console.log('');
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
let after = join(MIGRATIONS_DIR, `${stamp}_${migrationName}`);
mkdirSync(after, { recursive: true });

// ---------------------------------------------------------------------------
//  Le préambule est joué DEUX FOIS : avant le DDL, et à sa place habituelle.
//
//  ⚠️ SANS LA PREMIÈRE PASSE, TOUTE SUPPRESSION DE TABLE OU DE COLONNE ÉCHOUE.
//
//     PostgreSQL refuse de déposer un objet dont une VUE dépend, et Prisma
//     génère `DROP TABLE ...` sans CASCADE — délibérément, car un CASCADE
//     aveugle emporterait ce qu'on ne voulait pas perdre. Le DDL généré passe
//     donc AVANT le SQL métier, alors que les vues à déposer ne le sont
//     qu'APRÈS. La migration échoue sur un message qui ne désigne pas la
//     cause : « cannot drop column fiscal_year because view X depends on it ».
//
//     Déposer les vues d'abord lève l'obstacle. Elles ne portent aucune
//     donnée, elles sont toutes recréées plus bas dans la même migration, et
//     `IF EXISTS` rend la double dépose sans effet.
// ---------------------------------------------------------------------------
const preambule = readFileSync(join(SQL_DIR, '00_prelude.sql'), 'utf8');
const preDdl =
  '-- ─── Préambule joué AVANT le DDL : voir scripts/prepare-migrations.mjs ───\n' +
  '-- Les vues bloqueraient toute suppression de table ou de colonne.\n\n' +
  preambule +
  '\n\n-- ─── Fin du préambule — DDL généré par Prisma ci-dessous ───\n\n';

writeFileSync(join(after, 'migration.sql'), preDdl + (isEmpty ? '' : diffSql), 'utf8');
console.log(`  ✓ ${isEmpty ? 'aucun changement de schéma' : 'écart de schéma'} → ${after}`);

// ---------------------------------------------------------------------------
//  Cas « SQL seul » : corriger un trigger, une vue ou une contrainte sans
//  toucher au schéma Prisma. Le dossier est créé quand même — sans lui, le
//  script injecterait le SQL dans la migration précédente, DÉJÀ APPLIQUÉE,
//  ce qui changerait son empreinte et casserait tout `migrate deploy` futur.
// ---------------------------------------------------------------------------
if (isEmpty) {
  writeFileSync(
    join(after, 'migration.sql'),
    preDdl +
      '-- Migration sans changement de schéma Prisma : correctif SQL seul.\n' +
      '-- Le contenu utile est injecté ci-dessous depuis prisma/sql/.\n',
    'utf8',
  );
}

// ---------------------------------------------------------------------------
//  2. Injecter le SQL métier à la fin de la migration.
// ---------------------------------------------------------------------------
const migrationFile = join(after, 'migration.sql');

if (!existsSync(migrationFile)) {
  console.error(`✗ Fichier introuvable : ${migrationFile}`);
  process.exit(1);
}

if (readFileSync(migrationFile, 'utf8').includes(MARKER)) {
  console.log('  SQL métier déjà présent dans cette migration — injection ignorée.');
  process.exit(0);
}

const banner = `

${MARKER}
-- ===========================================================================
--  SQL MÉTIER — injecté par scripts/prepare-migrations.mjs
--
--  NE PAS DÉPLACER hors de ce fichier : il doit faire partie de l'historique
--  de migration, faute de quoi Prisma détectera une dérive de schéma et
--  proposera une réinitialisation de la base.
--
--  Source : prisma/sql/ — modifier là-bas, puis regénérer une migration.
-- ===========================================================================
`;

appendFileSync(migrationFile, banner, 'utf8');

for (const file of SQL_FILES) {
  const path = join(SQL_DIR, file);
  if (!existsSync(path)) {
    console.error(`✗ Fichier SQL manquant : ${path}`);
    process.exit(1);
  }
  appendFileSync(migrationFile, `\n\n-- ─── ${file} ${'─'.repeat(Math.max(0, 60 - file.length))}\n\n`, 'utf8');
  appendFileSync(migrationFile, readFileSync(path, 'utf8'), 'utf8');
  console.log(`  ✓ ${file}`);
}

console.log(`\n→ SQL métier injecté dans ${migrationFile}`);
console.log('  Appliquer avec : npx prisma migrate deploy');
