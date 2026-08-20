/**
 * ===========================================================================
 *  BOOTSTRAP — premier compte DG d'une base VIDE
 *  Réf. DEPLOIEMENT.md § 4, DEPLOIEMENT_STAGING.md § 3
 *
 *  `db:deploy` (migration seule, jamais de semis — voir l'avertissement sur
 *  le service `migrator` de docker-compose.yml) laisse la base sans le
 *  moindre compte : ni tiers, ni utilisateur, ni les comptes fictifs du
 *  jeu de démonstration. C'est voulu pour les référentiels métier, mais un
 *  compte pour SE CONNECTER doit bien exister de quelque part — ce script
 *  crée ce premier compte, et rien d'autre.
 *
 *  Trois variables d'environnement, aucun repli :
 *    BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_PASSWORD
 *
 *  Sûr à rejouer : si un compte DG existe déjà, le script l'annonce et ne
 *  fait rien — jamais un second DG fantôme créé par erreur d'automatisation.
 *
 *  Ensuite, tout autre compte (interne, terrain, portail) se crée depuis
 *  l'écran « Gérer les utilisateurs » (DG/IT_ADMIN) ou, pour un accès
 *  portail, depuis la fiche d'un tiers — jamais en rejouant ce script.
 * ===========================================================================
 */
import { hash } from '@node-rs/argon2';
import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

/** Identique à `CryptoService`/`AuthService` côté application — voir leur en-tête. */
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(`${key} est requis pour créer le premier compte DG.`);
  }
  return value;
}

async function main(): Promise<void> {
  const existing = await prisma.user.count({ where: { role: UserRole.DG } });
  if (existing > 0) {
    console.log(`→ Un compte DG existe déjà (${existing}) : rien à faire.`);
    return;
  }

  const email = requireEnv('BOOTSTRAP_ADMIN_EMAIL');
  const fullName = requireEnv('BOOTSTRAP_ADMIN_NAME');
  const password = requireEnv('BOOTSTRAP_ADMIN_PASSWORD');

  const passwordHash = await hash(password, ARGON2);
  await prisma.user.create({
    data: {
      email,
      fullName,
      role: UserRole.DG,
      passwordHash,
      mustChangePassword: true,
    },
  });

  console.log(`→ Compte DG créé : ${email}`);
  console.log('  Changement de mot de passe imposé à la première connexion.');
}

main()
  .catch((error: unknown) => {
    console.error('Échec du bootstrap :', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
