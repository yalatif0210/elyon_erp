import { Injectable } from '@nestjs/common';
import { ThrottlerException, ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

/**
 * Limitation de débit, avec un message destiné à un être humain.
 *
 * Le guard d'origine remonte « ThrottlerException: Too Many Requests » —
 * le nom de la classe technique, en anglais, sans indication de délai. Un
 * utilisateur qui tape son mot de passe n'a aucun moyen de comprendre ce
 * qu'on lui demande de faire.
 */
@Injectable()
export class LocalizedThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(
    _context: unknown,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const seconds = Math.max(1, Math.ceil(detail.timeToBlockExpire));
    const delay =
      seconds >= 60
        ? `${Math.ceil(seconds / 60)} minute(s)`
        : `${seconds} seconde(s)`;

    throw new ThrottlerException(
      `Trop de tentatives depuis ce poste. Réessayez dans ${delay}. ` +
        `Cette limite protège les comptes contre les essais de mot de passe en série.`,
    );
  }
}
