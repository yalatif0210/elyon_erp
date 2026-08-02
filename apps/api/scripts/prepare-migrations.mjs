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
  '01_business_constraints.sql',
  '02_audit_immutability.sql',
  '03_views_and_functions.sql',
  '04_grants.sql',
];

const migrationName = process.argv[2] ?? 'init';

function run(command, args) {
  execFileSync(command, args, { cwd: API_ROOT, stdio: 'inherit' });
}

function latestMigrationDir() {
  if (!existsSync(MIGRATIONS_DIR)) return null;
  const dirs = readdirSync(MIGRATIONS_DIR)
    .filter((entry) => statSync(join(MIGRATIONS_DIR, entry)).isDirectory())
    .sort();
  return dirs.length > 0 ? join(MIGRATIONS_DIR, dirs[dirs.length - 1]) : null;
}

// ---------------------------------------------------------------------------
//  1. Générer la migration sans l'appliquer.
//     --create-only produit le fichier SQL et s'arrête : il reste modifiable.
// ---------------------------------------------------------------------------
console.log(`→ Génération de la migration « ${migrationName} »…`);

const before = latestMigrationDir();
run('npx', ['prisma', 'migrate', 'dev', '--name', migrationName, '--create-only', '--skip-generate']);
let after = latestMigrationDir();

// ---------------------------------------------------------------------------
//  Cas « SQL seul » : corriger un trigger, une vue ou une contrainte sans
//  toucher au schéma Prisma.
//
//  Prisma ne génère alors AUCUNE migration. Sans ce traitement, le script
//  injecterait le SQL dans la dernière migration — DÉJÀ APPLIQUÉE —, ce qui
//  changerait son empreinte et ferait échouer tout `migrate deploy` ultérieur
//  sur les environnements où elle est enregistrée.
//
//  On crée donc nous-mêmes un dossier de migration vide, que Prisma appliquera
//  comme n'importe quel autre. Le SQL de prisma/sql/ étant idempotent, le
//  rejouer intégralement est sans effet de bord.
// ---------------------------------------------------------------------------
if (!after || after === before) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  after = join(MIGRATIONS_DIR, `${stamp}_${migrationName}`);
  mkdirSync(after, { recursive: true });
  writeFileSync(
    join(after, 'migration.sql'),
    '-- Migration sans changement de schéma Prisma : correctif SQL seul.\n' +
      '-- Le contenu utile est injecté ci-dessous depuis prisma/sql/.\n',
    'utf8',
  );
  console.log('  Aucun changement de schéma — migration SQL seule créée.');
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
