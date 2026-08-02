import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, UserRole } from './auth.service';

/** Redirige vers la connexion si la session est absente. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) return true;
  return router.createUrlTree(['/connexion']);
};

/**
 * Filtrage par rôle côté client.
 *
 * Confort d'affichage UNIQUEMENT : il évite de proposer un écran qui renverra
 * 403. L'autorisation réelle est celle du serveur, elle-même doublée des
 * invariants en base. Ne jamais considérer ce guard comme une protection.
 */
export const roleGuard = (...roles: UserRole[]): CanActivateFn => {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (auth.hasRole(...roles)) return true;
    return router.createUrlTree(['/tableau-de-bord']);
  };
};
