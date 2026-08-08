import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfig, TOKEN_TTL } from '../common/config/env.config';
import { CryptoService } from '../common/crypto/crypto.service';
import { RedisService } from '../common/redis/redis.service';
import { AccessTokenPayload, Realm, RefreshTokenPayload } from '../common/auth/realm';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface SubjectIdentity {
  id: string;
  realm: Realm;
  role?: string;
  partnerId?: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Émet une paire de jetons pour une nouvelle session.
   *
   * L'identifiant de session (sid) encode le réalm et le sujet, ce qui permet
   * de révoquer d'un coup toutes les sessions d'un compte lors d'un changement
   * de mot de passe ou d'une désactivation.
   */
  async issue(subject: SubjectIdentity): Promise<TokenPair> {
    const sid = `${subject.realm}:${subject.id}:${this.crypto.randomId()}`;
    return this.sign(subject, sid);
  }

  /**
   * Rotation : le jeton présenté est consommé, une nouvelle paire est émise.
   *
   * Un refresh token ne sert qu'UNE fois. S'il est rejoué — parce qu'il a été
   * volé et déjà utilisé par l'attaquant, ou l'inverse — l'empreinte stockée ne
   * correspond plus et la session entière est révoquée. Le vol devient
   * détectable au lieu de rester silencieux.
   */
  async rotate(refreshToken: string): Promise<{ pair: TokenPair; subject: RefreshTokenPayload }> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Jeton de rafraîchissement invalide');
    }

    const presented = this.crypto.hashToken(refreshToken);
    const matches = await this.redis.matchRefresh(payload.sid, presented);
    if (!matches) {
      // Rejeu ou jeton périmé : on révoque par précaution plutôt que de
      // simplement refuser — l'incident peut signaler une compromission.
      await this.redis.revokeSession(payload.sid);
      throw new UnauthorizedException('Jeton de rafraîchissement rejoué ou expiré');
    }

    const pair = await this.sign(
      { id: payload.sub, realm: payload.realm },
      payload.sid,
      /* preserveClaims */ refreshToken,
    );
    return { pair, subject: payload };
  }

  async revoke(sid: string): Promise<void> {
    await this.redis.revokeSession(sid);
  }

  async revokeAll(realm: Realm, subjectId: string): Promise<number> {
    return this.redis.revokeAllForSubject(realm, subjectId);
  }

  /**
   * Révoque toutes les sessions SAUF celle en cours.
   *
   * Employé au changement de mot de passe : l'utilisateur vient de prouver
   * qui il est, le déconnecter de son propre poste serait gratuit. Les autres
   * jetons, eux, doivent tomber — un mot de passe changé après compromission
   * ne vaut rien si le jeton déjà volé survit jusqu'à son expiration.
   */
  async revokeAllExcept(realm: Realm, subjectId: string, keepSid: string): Promise<number> {
    return this.redis.revokeAllForSubject(realm, subjectId, keepSid);
  }

  // -------------------------------------------------------------------------

  private async sign(
    subject: SubjectIdentity,
    sid: string,
    previousRefresh?: string,
  ): Promise<TokenPair> {
    // Sur rotation, on reprend rôle et partnerId du jeton précédent : ils
    // n'ont pas à être rechargés, et un changement de rôle doit passer par
    // une révocation explicite plutôt que par une élévation silencieuse.
    let role = subject.role;
    let partnerId = subject.partnerId;
    if (previousRefresh) {
      const decoded = this.jwt.decode(previousRefresh) as Partial<AccessTokenPayload> | null;
      role = decoded?.role ?? role;
      partnerId = decoded?.partnerId ?? partnerId;
    }

    const accessPayload: AccessTokenPayload = {
      sub: subject.id,
      realm: subject.realm,
      sid,
      ...(role ? { role } : {}),
      ...(partnerId ? { partnerId } : {}),
    };

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.accessSecret,
      expiresIn: TOKEN_TTL.accessSeconds,
    });

    const refreshToken = await this.jwt.signAsync(
      { sub: subject.id, realm: subject.realm, sid, ...(role ? { role } : {}), ...(partnerId ? { partnerId } : {}) },
      { secret: this.config.refreshSecret, expiresIn: TOKEN_TTL.refreshSeconds },
    );

    await this.redis.storeRefresh(sid, this.crypto.hashToken(refreshToken));

    return { accessToken, refreshToken, expiresIn: TOKEN_TTL.accessSeconds };
  }
}
