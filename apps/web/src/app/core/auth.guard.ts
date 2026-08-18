import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService, UserRole } from './auth.service';

/** Redirige vers la connexion si la session est absente. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) return true;
  return router.createUrlTree(['/connexion']);
};

/**
 * Filtrage par RÔLE côté client - réservé aux routes D'ACTION (une création,
 * jamais un écran de consultation).
 *
 * Confort d'affichage UNIQUEMENT : il évite de proposer une action que le
 * serveur refusera. L'autorisation réelle est celle du `@Roles()` serveur,
 * elle-même doublée des invariants en base. Ne jamais considérer ce guard
 * comme une protection.
 *
 * ⚠️ PAS POUR UN ÉCRAN : voir `screenGuard`. Une route de consultation dont
 *    la visibilité doit pouvoir être réglée par le DG (§ paramétrage 17/08)
 *    n'a rien à faire ici - `roleGuard` ignore entièrement la table
 *    `RoleScreenAccess`, par construction.
 */
export const roleGuard = (...roles: UserRole[]): CanActivateFn => {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (auth.hasRole(...roles)) return true;
    return router.createUrlTree(['/tableau-de-bord']);
  };
};

/**
 * Filtrage par ÉCRAN côté client (§ paramétrage 17/08).
 *
 * Même confort UNIQUEMENT que `roleGuard` - l'autorisation réelle est le
 * `@Screen()` posé sur la route de lecture côté serveur, résolu contre
 * `RoleScreenAccess`. Ce guard lit le MÊME ensemble que le menu
 * (`AuthService.visibleScreens$()`, chargé une fois par session) : les deux
 * ne peuvent pas diverger, ils interrogent la même source.
 */
export const screenGuard = (key: string): CanActivateFn => {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    return auth.visibleScreens$().pipe(
      map((screens) => (screens.includes(key) ? true : router.createUrlTree(['/tableau-de-bord']))),
    );
  };
};
