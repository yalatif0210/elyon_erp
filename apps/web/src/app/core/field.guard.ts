import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { FieldSessionService } from './field-session.service';

/** Renvoie vers la connexion terrain si la session de la tablette est absente. */
export const fieldGuard: CanActivateFn = () => {
  const session = inject(FieldSessionService);
  const router = inject(Router);
  if (session.connecte()) return true;
  return router.createUrlTree(['/terrain/connexion']);
};
