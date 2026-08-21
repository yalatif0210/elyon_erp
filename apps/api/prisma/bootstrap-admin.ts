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

/**
 * `.trim()` sur la valeur retournée, pas seulement sur le test de vacuité :
 * une variable d'environnement posée dans un fichier `.env` embarque
 * facilement un saut de ligne final invisible à la saisie — le même défaut
 * que celui constaté ce jour même sur un secret GitHub Actions
 * (`STAGING_DEPLOY_PATH`, voir deploy-staging.yml) et sur un mot de passe
 * provisoire copié-collé pour un compte terrain. Un mot de passe haché
 * AVEC ce saut de ligne ne correspondrait plus jamais à la même valeur
 * saisie proprement à la connexion.
 */
function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
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

  // .toLowerCase() : la connexion normalise TOUJOURS l'adresse ainsi avant
  // de chercher en base (voir AuthService.loginInternal) — un courriel posé
  // ici avec la moindre majuscule créerait un compte que son titulaire ne
  // retrouverait jamais à la connexion.
  const email = requireEnv('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
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
