import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { BehaviorSubject, catchError, filter, switchMap, take, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** Empêche N requêtes simultanées de déclencher N rafraîchissements. */
let refreshing = false;
const refreshed$ = new BehaviorSubject<string | null>(null);

/**
 * Porte le jeton, et rejoue une fois la requête après rafraîchissement.
 *
 * Le rafraîchissement est sérialisé : plusieurs 401 concurrents attendent le
 * même appel. Sans cela, chaque requête consommerait un jeton de
 * rafraîchissement différent — et la rotation côté serveur, qui révoque la
 * session sur rejeu, déconnecterait l'utilisateur au premier écran chargé.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  /*
   * ⚠️ Le réalm TERRAIN est laissé intact, et sans `catchError`.
   *
   *    Un jeton bureautique présenté sur `/api/field` serait refusé, et le
   *    401 qui s'ensuit déclencherait ici un rafraîchissement bureautique puis
   *    un `auth.clear()` : la console interne se déconnecterait toute seule
   *    parce que la tablette a travaillé. La séparation des réalms n'a de sens
   *    que si elle vaut aussi pour la gestion des échecs.
   */
  if (req.url.startsWith('/api/field')) return next(req);

  const auth = inject(AuthService);

  const isAuthRoute = req.url.includes('/auth/login') || req.url.includes('/auth/refresh');
  const token = auth.accessToken;

  const authorized =
    token && !isAuthRoute
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req;

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401 || isAuthRoute) {
        return throwError(() => error);
      }

      if (!auth.refreshToken) {
        auth.clear();
        return throwError(() => error);
      }

      if (refreshing) {
        return refreshed$.pipe(
          filter((t): t is string => t !== null),
          take(1),
          switchMap((fresh) =>
            next(req.clone({ setHeaders: { Authorization: `Bearer ${fresh}` } })),
          ),
        );
      }

      refreshing = true;
      refreshed$.next(null);

      return auth.refresh().pipe(
        switchMap((res) => {
          refreshing = false;
          refreshed$.next(res.accessToken);
          return next(req.clone({ setHeaders: { Authorization: `Bearer ${res.accessToken}` } }));
        }),
        catchError((refreshError: unknown) => {
          refreshing = false;
          auth.clear();
          return throwError(() => refreshError);
        }),
      );
    }),
  );
};
