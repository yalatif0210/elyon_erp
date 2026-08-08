import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig, TOKEN_TTL } from '../config/env.config';

/**
 * Redis porte l'état des sessions : jetons de rafraîchissement et révocations.
 *
 * Pourquoi Redis et non la base : ces enregistrements ont une durée de vie
 * naturelle et un volume d'écriture élevé (une rotation à chaque
 * rafraîchissement). Le TTL natif évite d'accumuler des lignes mortes et un
 * balayage périodique.
 *
 * La table `user_sessions` conserve en parallèle une trace durable des
 * connexions internes, à des fins d'audit — elle ne fait pas autorité sur
 * la validité d'un jeton.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;

  constructor(private readonly config: AppConfig) {}

  onModuleInit(): void {
    this.client = new Redis(this.config.redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }

  async ping(): Promise<boolean> {
    return (await this.client.ping()) === 'PONG';
  }

  // --- Jetons de rafraîchissement ------------------------------------------

  private refreshKey(sid: string): string {
    return `refresh:${sid}`;
  }

  private revokedKey(sid: string): string {
    return `revoked:${sid}`;
  }

  /**
   * Enregistre l'empreinte du jeton de rafraîchissement. Le jeton lui-même
   * n'est jamais stocké : une fuite de Redis ne permettrait pas de se
   * connecter.
   */
  async storeRefresh(sid: string, tokenHash: string): Promise<void> {
    await this.client.set(this.refreshKey(sid), tokenHash, 'EX', TOKEN_TTL.refreshSeconds);
  }

  async matchRefresh(sid: string, tokenHash: string): Promise<boolean> {
    const stored = await this.client.get(this.refreshKey(sid));
    return stored !== null && stored === tokenHash;
  }

  /**
   * Révoque une session. Le marqueur survit à la durée de vie de l'access
   * token : sans cela, un jeton émis juste avant la déconnexion resterait
   * accepté jusqu'à son expiration.
   */
  async revokeSession(sid: string): Promise<void> {
    await Promise.all([
      this.client.del(this.refreshKey(sid)),
      this.client.set(this.revokedKey(sid), '1', 'EX', TOKEN_TTL.accessSeconds + 60),
    ]);
  }

  async isSessionRevoked(sid: string): Promise<boolean> {
    return (await this.client.exists(this.revokedKey(sid))) === 1;
  }

  /**
   * Révoque toutes les sessions d'un compte — désactivation, mot de passe changé.
   *
   * `keepSid` permet d'épargner la session courante. On l'EXCLUT du balayage
   * plutôt que de la révoquer puis la rétablir : une session brièvement
   * marquée révoquée serait rejetée par le guard entre les deux écritures.
   */
  async revokeAllForSubject(realm: string, subjectId: string, keepSid?: string): Promise<number> {
    const pattern = `refresh:${realm}:${subjectId}:*`;
    let cursor = '0';
    let count = 0;
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      for (const key of keys) {
        const sid = key.replace('refresh:', '');
        if (sid === keepSid) continue;
        await this.revokeSession(sid);
        count += 1;
      }
    } while (cursor !== '0');
    return count;
  }
}
