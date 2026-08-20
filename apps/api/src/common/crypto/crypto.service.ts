import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../config/env.config';

/**
 * Paramètres Argon2id — SOURCE UNIQUE pour tout ce qui vit dans le graphe
 * Nest (les trois contrôleurs de création de compte, `AuthService`).
 *
 * ⚠️ Toute création ou vérification de mot de passe ICI doit passer par
 *    `hashPassword`/`verifyPassword` ci-dessous, jamais recopier ces valeurs.
 *    Seuls `prisma/seed.ts` et `prisma/bootstrap-admin.ts` en portent leur
 *    propre copie identique, en dehors du graphe Nest par construction
 *    (scripts autonomes exécutés par `tsx`, jamais par l'application) — la
 *    valeur doit néanmoins rester rigoureusement la même partout : un second
 *    jeu, même légèrement différent, produirait des empreintes valides à la
 *    création mais rejetées à la connexion.
 */
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/**
 * Chiffrement des secrets TOTP au repos et empreintes de jetons.
 *
 * Un secret TOTP en clair en base équivaut à un second facteur inexistant :
 * qui lit la table peut générer les codes. AES-256-GCM apporte en outre
 * l'authentification du chiffré — une altération est détectée au déchiffrement.
 */
@Injectable()
export class CryptoService {
  private static readonly ALGO = 'aes-256-gcm';
  private static readonly IV_BYTES = 12; // Recommandation NIST pour GCM.

  constructor(private readonly config: AppConfig) {}

  encryptSecret(plain: string): string {
    const iv = randomBytes(CryptoService.IV_BYTES);
    const cipher = createCipheriv(CryptoService.ALGO, this.config.totpKey, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // iv.tag.chiffré — tout est nécessaire au déchiffrement, rien n'est secret
    // hors la clé elle-même.
    return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
  }

  decryptSecret(payload: string): string {
    const [ivB64, tagB64, dataB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new Error('Secret chiffré malformé');
    }
    const decipher = createDecipheriv(
      CryptoService.ALGO,
      this.config.totpKey,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Empreinte d'un jeton — c'est elle qu'on stocke, jamais le jeton. */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Comparaison à temps constant : une comparaison naïve fuit par le timing. */
  safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  randomId(): string {
    return randomBytes(16).toString('hex');
  }

  hashPassword(plain: string): Promise<string> {
    return hash(plain, ARGON2);
  }

  /** Ne lève jamais : un hachage malformé ou absent doit refuser, pas planter. */
  verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
    return verify(passwordHash, plain).catch(() => false);
  }
}
