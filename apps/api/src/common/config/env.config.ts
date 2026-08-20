import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsString, Length, Max, Min, validateSync } from 'class-validator';

/**
 * Configuration typée et validée AU DÉMARRAGE.
 *
 * Une variable manquante ou aberrante doit faire échouer le lancement, pas
 * produire un comportement dégradé silencieux six heures plus tard — un secret
 * JWT vide accepterait toutes les signatures.
 */
export class EnvironmentVariables {
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: string = 'production';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  REDIS_URL!: string;

  /** Secrets distincts : un même secret pour l'accès et le rafraîchissement
   *  permettrait de présenter un refresh token comme un access token. */
  @IsString()
  @Length(32, 512)
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @Length(32, 512)
  JWT_REFRESH_SECRET!: string;

  /** Clé AES-256-GCM protégeant les secrets TOTP au repos : 64 caractères hex. */
  @IsString()
  @Length(64, 64)
  TOTP_ENCRYPTION_KEY!: string;

  @IsString()
  CORS_ALLOWED_ORIGINS: string = '';

  @IsString()
  @Length(3, 3)
  PIVOT_CURRENCY: string = 'USD';

  @IsString()
  @Length(3, 3)
  LOCAL_CURRENCY: string = 'XOF';

  @IsString()
  @Length(2, 2)
  FISCAL_COUNTRY: string = 'CI';
}

export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  const parsed = plainToInstance(EnvironmentVariables, raw, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });

  const errors = validateSync(parsed, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `  · ${e.property} : ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Configuration invalide, démarrage refusé :\n${details}`);
  }
  return parsed;
}

/** Durées de vie des jetons. Accès court, rafraîchissement rotatif. */
export const TOKEN_TTL = {
  /** Un access token volé n'est exploitable que quelques minutes. */
  accessSeconds: 15 * 60,
  /** Rotation à chaque usage : un refresh token rejoué est détecté. */
  refreshSeconds: 7 * 24 * 60 * 60,
} as const;

/**
 * Politique de verrouillage après échecs de connexion — VALEURS DE REPLI.
 *
 * La politique effective est lue en base à chaque échec, sous les clés
 * `LOGIN_MAX_FAILED_ATTEMPTS` et `LOGIN_LOCK_MINUTES` : c'est une règle de
 * gestion, elle se règle par écran, pas par livraison. Ces deux nombres ne
 * servent que si la ligne a disparu ou devient illisible — auquel cas le
 * système garde une politique plutôt que de n'en avoir aucune.
 */
export const LOGIN_POLICY = {
  maxFailedAttempts: 5,
  lockMinutes: 15,
} as const;

@Injectable()
export class AppConfig {
  constructor(private readonly env: EnvironmentVariables) {}

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get corsOrigins(): string[] {
    return this.env.CORS_ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  get accessSecret(): string {
    return this.env.JWT_ACCESS_SECRET;
  }

  get refreshSecret(): string {
    return this.env.JWT_REFRESH_SECRET;
  }

  get totpKey(): Buffer {
    return Buffer.from(this.env.TOTP_ENCRYPTION_KEY, 'hex');
  }

  get redisUrl(): string {
    return this.env.REDIS_URL;
  }

  /**
   * Connexion Redis au format attendu par BullMQ — un objet, pas une URL.
   *
   * BullMQ exige `maxRetriesPerRequest: null` : ses commandes bloquantes
   * (`BRPOPLPUSH` et consorts) attendent le temps qu'il faut, et une limite de
   * tentatives leur ferait échouer une attente normale.
   */
  get redisConnection(): { host: string; port: number; password?: string; maxRetriesPerRequest: null } {
    const url = new URL(this.env.REDIS_URL);
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      password: url.password || undefined,
      maxRetriesPerRequest: null,
    };
  }

  get port(): number {
    return this.env.PORT;
  }
}
