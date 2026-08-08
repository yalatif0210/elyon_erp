import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { BehaviorSubject, catchError, filter, switchMap, take, throwError } from 'rxjs';
import { FieldSessionService } from './field-session.service';

/** Empêche N requêtes simultanées de déclencher N rafraîchissements. */
let enCours = false;
const rafraichi$ = new BehaviorSubject<string | null>(null);

/**
 * Porte le jeton TERRAIN, et lui seul, sur `/api/field`.
 *
 * Deux intercepteurs coexistent volontairement plutôt qu'un seul qui saurait
 * choisir : chacun ne connaît qu'un réalm et ne peut donc pas présenter le
 * mauvais jeton. L'intercepteur bureautique laisse passer `/api/field` sans y
 * toucher, celui-ci ignore tout le reste.
 *
 * Le rafraîchissement est sérialisé, pour la même raison que côté bureau : la
 * rotation du jeton de rafraîchissement révoque la session au rejeu, et deux
 * appels concurrents déconnecteraient l'agent au premier écran chargé — c'est
 * à dire au pire moment, sur site.
 */
export const fieldAuthInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/field')) return next(req);

  const session = inject(FieldSessionService);

  const routeOuverte =
    req.url.includes('/auth/login') || req.url.includes('/auth/refresh');
  const jeton = session.jeton;

  const porteuse =
    jeton && !routeOuverte
      ? req.clone({ setHeaders: { Authorization: `Bearer ${jeton}` } })
      : req;

  return next(porteuse).pipe(
    catchError((erreur: unknown) => {
      if (!(erreur instanceof HttpErrorResponse) || erreur.status !== 401 || routeOuverte) {
        return throwError(() => erreur);
      }

      if (!session.jetonRafraichissement) {
        session.vider();
        return throwError(() => erreur);
      }

      if (enCours) {
        return rafraichi$.pipe(
          filter((j): j is string => j !== null),
          take(1),
          switchMap((frais) =>
            next(req.clone({ setHeaders: { Authorization: `Bearer ${frais}` } })),
          ),
        );
      }

      enCours = true;
      rafraichi$.next(null);

      return session.rafraichir().pipe(
        switchMap((res) => {
          enCours = false;
          rafraichi$.next(res.accessToken);
          return next(req.clone({ setHeaders: { Authorization: `Bearer ${res.accessToken}` } }));
        }),
        catchError((echec: unknown) => {
          enCours = false;
          session.vider();
          return throwError(() => echec);
        }),
      );
    }),
  );
};
